// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../lib/types";
import { SubscriptionsPanel } from "./subscriptions-panel";

/**
 * 守护「修改订阅的绑定源时报 400 源不存在」这条回归：
 * 源被删掉后，订阅的 sourceIds 里仍留着它的 id。旧实现把整份 sourceIds 当成勾选态
 * 直接回传，后端校验必然 400，而界面上根本看不到那个 id，用户无从下手。
 */

/** 源已被删除，但订阅里仍保留的残留 id */
const DANGLING_SOURCE_ID = "dangling-source-id";

const STATE: AppState = {
  // 版本号只是占位：这条用例不断言版本，避免版本升级时跟着红
  app: { name: "SubBoost Lite", version: "0.0.0" },
  sources: [
    {
      id: "s1",
      name: "示例源 A",
      kind: "remote",
      url: "https://example.com/sub?token=<token>",
      enabled: true,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
  ],
  subscriptions: [
    {
      id: "sub1",
      name: "默认订阅",
      sourceIds: ["s1", DANGLING_SOURCE_ID],
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

const noopAsync = async () => {};
afterEach(cleanup);

/**
 * jsdom 没有 ResizeObserver：弹窗里的 Radix Switch 通过 use-size 依赖它，
 * 不 stub 的话一打开「修改订阅」就抛 ResizeObserver is not defined。
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});
afterEach(cleanup);

describe("SubscriptionsPanel 修改订阅的绑定源", () => {
  it("只提交现存源，残留的已删除源不再让后端 400", async () => {
    const onUpdate = vi.fn(noopAsync);
    render(
      React.createElement(SubscriptionsPanel, {
        state: STATE,
        onCreate: noopAsync,
        onRotate: noopAsync,
        onDelete: noopAsync,
        onUpdate,
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "修改 默认订阅 的源" }));

    // 弹窗要说明这个订阅还挂着已删除的源，而不是让用户面对一串看不见的 id
    expect(await screen.findByText(/1 个已被删除的源/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate).toHaveBeenCalledWith("sub1", {
      name: "默认订阅",
      sourceIds: ["s1"],
      sourceMode: "explicit",
      chainIds: [],
    });
  });

  it("没有残留源时不存在误导性提示", async () => {
    render(
      React.createElement(SubscriptionsPanel, {
        state: {
          ...STATE,
          subscriptions: [{ ...STATE.subscriptions[0], sourceIds: ["s1"] }],
        },
        onCreate: noopAsync,
        onRotate: noopAsync,
        onDelete: noopAsync,
        onUpdate: noopAsync,
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "修改 默认订阅 的源" }));
    expect(await screen.findByRole("button", { name: "保存修改" })).toBeTruthy();
    expect(screen.queryByText(/已被删除的源/)).toBeNull();
  });
});

describe("SubscriptionsPanel 没有可用绑定源", () => {
  it("卡片红字说明只会输出提示节点，并且不显示成「全部启用源」", () => {
    render(
      React.createElement(SubscriptionsPanel, {
        state: {
          ...STATE,
          subscriptions: [{ ...STATE.subscriptions[0], sourceIds: [], sourceMode: "explicit" }],
        },
        onCreate: noopAsync,
        onRotate: noopAsync,
        onDelete: noopAsync,
      })
    );

    expect(screen.getByText("未绑定源")).toBeTruthy();
    expect(screen.getByText(/绑定的源已被删除/)).toBeTruthy();
    expect(screen.getByText(/当前订阅暂无绑定源/)).toBeTruthy();
    expect(screen.queryByText("全部启用源")).toBeNull();
  });

  it("关掉「聚合全部启用源」后保存，提交的是 explicit 的空绑定而不是 all", async () => {
    const onUpdate = vi.fn(noopAsync);
    render(
      React.createElement(SubscriptionsPanel, {
        state: {
          ...STATE,
          subscriptions: [{ ...STATE.subscriptions[0], sourceIds: [], sourceMode: "all" }],
        },
        onCreate: noopAsync,
        onRotate: noopAsync,
        onDelete: noopAsync,
        onUpdate,
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "修改 默认订阅 的源" }));
    fireEvent.click(await screen.findByRole("switch", { name: /聚合全部启用源/ }));
    // 一个源都没勾：必须明说只会剩一个提示节点，而不是悄悄回到全部启用源
    expect(await screen.findByText(/没有勾选任何源/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate).toHaveBeenCalledWith("sub1", {
      name: "默认订阅",
      sourceIds: [],
      sourceMode: "explicit",
      chainIds: [],
    });
  });
});
