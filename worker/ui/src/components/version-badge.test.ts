// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import { REPOSITORY_URL } from "../lib/docs-links";
import type { UpdateNotice } from "../lib/update-notice";

/**
 * 页头版本徽章与 Logo 链接的行为测试。
 *
 * 两件事都只在真实 DOM 里成立：红点是绝对定位的小圆点、弹窗要点击才展开；
 * Logo 的跳转目标写在 `<a href>` 上，静态渲染看不出「点了会不会走」。
 */

const UPDATE: UpdateNotice = {
  latestVersion: "0.26.0",
  releaseUrl: "https://github.com/example/repo/releases",
};

function renderShell(overrides: Record<string, unknown> = {}) {
  return render(
    React.createElement(
      AppShell,
      {
        title: "SubBoost Lite",
        version: "0.25.0",
        onLogout: () => {},
        ...overrides,
      },
      React.createElement("p", null, "content")
    )
  );
}

beforeEach(() => {
  // jsdom 自带真实 document：主题读取与 Dialog portal 都需要它
  document.documentElement.setAttribute("data-theme", "dark");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("页头 Logo", () => {
  it("在新标签里打开 GitHub 仓库", () => {
    renderShell();
    const link = screen.getByRole("link", { name: /在 GitHub 上打开/ });
    expect(link.getAttribute("href")).toBe(REPOSITORY_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    // 外链必须带 noreferrer/noopener，否则新标签能通过 window.opener 反向操作本页
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});

describe("版本徽章", () => {
  it("没有新版本时只是一行静态文字，不点红点", () => {
    renderShell();
    expect(screen.getByText("v0.25.0")).toBeTruthy();
    expect(document.querySelector(".bg-update-dot")).toBeNull();
    expect(screen.queryByRole("button", { name: /发现新版本/ })).toBeNull();
  });

  it("检测到新版本时点红点，点开是更新说明弹窗", () => {
    renderShell({ updateNotice: UPDATE });
    const badge = screen.getByRole("button", { name: /发现新版本 v0\.26\.0/ });
    expect(badge.querySelector(".bg-update-dot")).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(badge);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/发现新版本 v0\.26\.0/)).toBeTruthy();
    expect(within(dialog).getByText(/当前运行的是 v0\.25\.0/)).toBeTruthy();
    const github = within(dialog).getByRole("link", { name: /前往 GitHub/ });
    expect(github.getAttribute("href")).toBe(UPDATE.releaseUrl);
  });

  it("点「忽略此版本」把版本号回传给上层并收起弹窗", () => {
    const onDismissUpdate = vi.fn();
    renderShell({ updateNotice: UPDATE, onDismissUpdate });

    fireEvent.click(screen.getByRole("button", { name: /发现新版本 v0\.26\.0/ }));
    fireEvent.click(screen.getByRole("button", { name: "忽略此版本" }));

    expect(onDismissUpdate).toHaveBeenCalledWith("0.26.0");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
