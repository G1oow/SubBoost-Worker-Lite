// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app";
import { ADMIN_TOKEN_STORAGE_KEY } from "./lib/admin-token";
import type { AppState, StatusRecord } from "./lib/types";

/**
 * 守护「保存源之后自动刷新」这条回归：
 * 以前改完源必须回页头手动点一次刷新，节点快照与订阅缓存才会跟上；
 * 现在保存成功就自动跑一轮，失败只提示、不再把用户挡在旧数据上。
 */

const SOURCE: AppState["sources"][number] = {
  id: "s1",
  name: "示例源 A",
  kind: "remote",
  url: "https://example.com/sub?token=<token>",
  enabled: true,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

const STATE: AppState = {
  // 版本号只是占位：这条用例不断言版本，避免版本升级时跟着红
  app: { name: "SubBoost Lite", version: "0.0.0" },
  sources: [SOURCE],
  subscriptions: [
    {
      id: "sub1",
      name: "默认订阅",
      sourceIds: ["s1"],
      sourceMode: "explicit",
      chainIds: [],
      link: "https://worker.example.com/sub/tokenvalue",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
  ],
  config: {},
  configIsDefault: true,
  status: null,
};

const REFRESHED_STATUS: StatusRecord = {
  lastRunAt: "2026-10-12T00:00:00.000Z",
  lastTrigger: "manual",
  durationMs: 120,
  sources: [{ sourceId: "s1", ok: true, nodeCount: 3 }],
  subscriptions: [{ subscriptionId: "sub1", ok: true, nodeCount: 3 }],
};

type RecordedCall = { method: string; path: string };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** 按路由返回响应；`saveStatus` 用来模拟保存失败 */
function stubApi(options: { saveStatus?: number } = {}) {
  const calls: RecordedCall[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, path });

    if (path === "/api/state") return jsonResponse(STATE);
    if (path === "/api/sources" && method === "PUT") {
      const status = options.saveStatus ?? 200;
      if (status !== 200) return jsonResponse({ error: "源保存失败" }, status);
      const body = JSON.parse(String(init?.body ?? "{}")) as { sources: AppState["sources"] };
      return jsonResponse({ sources: body.sources });
    }
    if (path === "/api/refresh" && method === "POST") return jsonResponse({ status: REFRESHED_STATUS });
    return jsonResponse({ error: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchImpl);
  return {
    calls,
    refreshes: () => calls.filter((call) => call.method === "POST" && call.path === "/api/refresh"),
  };
}

/** 打开「示例源 A」的编辑弹窗并提交保存 */
async function saveSourceA() {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑 示例源 A" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
  return dialog;
}

/** jsdom 没有 ResizeObserver：Radix Select 的触发器要靠它，不 stub 会在渲染弹窗时抛错 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, "test-token");
  window.location.hash = "#/sources";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.location.hash = "";
});

describe("保存源后自动刷新", () => {
  it("保存成功后自动发起一轮刷新，并把结果写回状态", async () => {
    const api = stubApi();
    await saveSourceA();

    await waitFor(() => expect(api.refreshes()).toHaveLength(1));
    // 刷新结果落到 state.status：源卡片上的节点数随刷新一起更新，不用手动刷新页面
    await waitFor(() => expect(screen.getAllByText("3 个节点").length).toBeGreaterThan(0));
  });

  it("保存失败时不刷新，错误留在弹窗里", async () => {
    const api = stubApi({ saveStatus: 400 });
    const dialog = await saveSourceA();

    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect(api.refreshes()).toHaveLength(0);
  });
});
