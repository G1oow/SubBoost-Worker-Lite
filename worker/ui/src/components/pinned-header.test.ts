// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import { PINNED_HEADER_THRESHOLD } from "../lib/scroll-header";

/**
 * 吸顶工具条的行为测试。
 *
 * 滚动监听、rAF 节流、挂载/卸载、回到顶部都只活在 effect 与事件回调里，
 * node 环境下的 renderToStaticMarkup 完全跑不到，所以这里用 jsdom 真跑一遍。
 * 只用 createElement（不用 JSX）：vitest 的 include 只匹配 *.test.ts。
 */

const NAV_ITEMS = [
  { id: "dashboard", label: "仪表板" },
  { id: "sources", label: "源管理", badge: 2 },
];

/**
 * 工具条上不允许出现的工具类。
 *
 * 位移/缩放/过渡都会把这条 fixed 层变成"栅格化一次再逐帧平移"的合成层，
 * 压在它下面的内容会被插值采样糊掉 —— 滚动时顶栏文字与工具条下方的卡片发虚，
 * 就是这条机制（见上一轮"动效发虚与卡片震颤"的结论）。
 */
const FORBIDDEN_MOTION_CLASSES = [/\b-?translate-[xy]-/u, /\btransform\b/u, /\bscale-\d/u, /\btransition-/u];

let scrollToSpy: ReturnType<typeof vi.spyOn>;

function setScrollY(value: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value });
}

/** 跑完 rAF 节流的一帧 */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

/** 模拟一次滚动到指定偏移 */
async function scrollToOffset(value: number) {
  setScrollY(value);
  await act(async () => {
    fireEvent.scroll(window);
  });
  await settle();
}

function renderShell(overrides: Record<string, unknown> = {}) {
  return render(
    React.createElement(
      AppShell,
      {
        title: "SubBoost Lite",
        version: "test",
        onLogout: () => {},
        navItems: NAV_ITEMS,
        activeNav: "sources",
        onNavigate: () => {},
        onRefresh: () => {},
        ...overrides,
      },
      React.createElement("p", null, "content")
    )
  );
}

function pinnedBar(container: HTMLElement): HTMLElement {
  const element = container.querySelector("[data-pinned-header]");
  expect(element, "吸顶工具条未挂载").not.toBeNull();
  return element as HTMLElement;
}

beforeEach(() => {
  setScrollY(0);
  scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setScrollY(0);
});

describe("页头与吸顶工具条的分工", () => {
  it("页面在顶部时完全不存在吸顶层，页头仍是普通内容", () => {
    const { container } = renderShell();
    const header = container.querySelector("header") as HTMLElement;
    expect(header).not.toBeNull();
    // 常驻会压住正文；页头只负责"最上面那块内容"
    expect(header.className).not.toContain("sticky");
    expect(header.className).not.toContain("fixed");
    expect(header.className).not.toContain("bg-header");
    // 关键：未吸顶时整条没挂载。DOM 里不存在常驻的固定层，
    // 滚动时的栅格化路径与没有这条工具条时完全一致。
    expect(container.querySelector("[data-pinned-header]")).toBeNull();
  });

  it("滚过阈值后浮现，且整条没有任何位移/过渡类", async () => {
    const { container } = renderShell();
    await scrollToOffset(PINNED_HEADER_THRESHOLD + 120);
    const bar = pinnedBar(container);

    expect(bar.className).toContain("fixed");
    expect(bar.className).toContain("animate-fade-in");
    // 实心表面压着下文滚动，不做毛玻璃
    expect(bar.className).toContain("bg-header");
    expect(bar.className).not.toContain("backdrop-blur");
    // 出场只许跑只驱动 opacity 的关键帧；位移/过渡一律不许
    for (const pattern of FORBIDDEN_MOTION_CLASSES) {
      expect(bar.className, `吸顶条出现了 ${pattern}`).not.toMatch(pattern);
    }
    // 内联样式里也不能偷偷写位移
    expect(bar.style.translate).toBe("");
    expect(bar.style.transform).toBe("");

    // 品牌徽章是条内第一项，兼"回到顶部"
    expect(within(bar).getByLabelText("回到顶部")).toBeTruthy();
    expect(within(bar).getByText("SubBoost Lite")).toBeTruthy();
    // 操作入口都跟着滚到位
    expect(within(bar).getByLabelText("立即刷新")).toBeTruthy();
    expect(within(bar).getByLabelText("切换到浅色主题")).toBeTruthy();
    expect(within(bar).getByLabelText("退出登录")).toBeTruthy();
    // 桌面端导航胶囊也在条内，滚动到长列表中间时仍可切页
    const activeTab = within(bar).getByRole("tab", { name: /源管理/ });
    expect(activeTab.getAttribute("aria-selected")).toBe("true");
  });

  it("滚回顶部后整条卸载，不留隐藏的固定层", async () => {
    const { container } = renderShell();
    await scrollToOffset(PINNED_HEADER_THRESHOLD + 120);
    expect(container.querySelector("[data-pinned-header]")).not.toBeNull();

    await scrollToOffset(0);
    expect(container.querySelector("[data-pinned-header]")).toBeNull();
  });

  it("正好停在阈值上不切换，避免同一个位置来回闪", async () => {
    const { container } = renderShell();
    await scrollToOffset(PINNED_HEADER_THRESHOLD);
    expect(container.querySelector("[data-pinned-header]")).toBeNull();
    await scrollToOffset(PINNED_HEADER_THRESHOLD + 1);
    expect(container.querySelector("[data-pinned-header]")).not.toBeNull();
  });
});

describe("吸顶工具条上的操作", () => {
  it("点品牌徽章平滑回到顶部", async () => {
    const { container } = renderShell();
    await scrollToOffset(PINNED_HEADER_THRESHOLD + 200);
    fireEvent.click(within(pinnedBar(container)).getByLabelText("回到顶部"));
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("在吸顶状态换页时把滚动位置归零，否则看起来像没切成功", async () => {
    const onNavigate = vi.fn();
    const { container } = renderShell({ onNavigate });
    await scrollToOffset(PINNED_HEADER_THRESHOLD + 200);

    fireEvent.click(within(pinnedBar(container)).getByRole("tab", { name: /仪表板/ }));
    expect(onNavigate).toHaveBeenCalledWith("dashboard");
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
  });
});
