// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * jsdom 环境里真正跑一遍 effect。
 *
 * motion-branches.test.ts 只能覆盖渲染分支：node 环境下 renderToStaticMarkup
 * 不执行 useEffect，而弹簧推进、ref 直接写文本、鼠标坐标写 CSS 变量
 * 这些逻辑全在 effect / 事件回调里。
 *
 * 本文件只用 createElement（不用 JSX）：vitest 的 include 只匹配 *.test.ts，
 * 改成 .test.tsx 会漏收。
 */

type GrowBarModule = typeof import("./grow-bar");
type SpotlightModule = typeof import("./spotlight-card");

async function loadGrowBar(): Promise<GrowBarModule> {
  return import("./grow-bar");
}

async function loadSpotlight(): Promise<SpotlightModule> {
  return import("./spotlight-card");
}

/**
 * 取元素当前的 scaleX。
 * jsdom 不解析 transform 语法：Motion 按能力探测写入的是 `scaleX(0.4)`
 * 这种独立函数形式，而非 matrix()，所以两种都要认。
 */
function scaleXOf(element: HTMLElement): number {
  const raw = element.style.transform || getComputedStyle(element).transform;
  if (!raw || raw === "none") return 1;

  const matrix = /matrix\(([^,]+),/u.exec(raw);
  if (matrix) return Number.parseFloat(matrix[1]);

  const scaleX = /scaleX\(([-\d.]+)\)/u.exec(raw);
  if (scaleX) return Number.parseFloat(scaleX[1]);

  const scale = /\bscale\(([-\d.]+)(?:,\s*[-\d.]+)?\)/u.exec(raw);
  if (scale) return Number.parseFloat(scale[1]);

  return 1;
}

/** 让 Motion 的弹簧推进若干帧 */
async function advance(frames = 40) {
  for (let i = 0; i < frames; i += 1) {
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
  }
}

const fillOf = (container: HTMLElement) => container.querySelector(".origin-left") as HTMLElement;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  // 不清理会把上一个用例的 DOM 留在 body 里，查询会命中旧节点
  cleanup();
  vi.unstubAllGlobals();
});

describe("GrowBar under a DOM", () => {
  it("scales the fill to the target percentage and lands exactly on it", async () => {
    const { GrowBar } = await loadGrowBar();
    const { container } = render(React.createElement(GrowBar, { percent: 40, count: 2 }));

    await advance(80);

    // 40% 的条：scaleX 必须正好是 0.4，多一点都不行
    expect(scaleXOf(fillOf(container))).toBeCloseTo(0.4, 2);
  });

  it("renders no visual number on the bar and hands the count to assistive tech", async () => {
    const { GrowBar } = await loadGrowBar();
    const { container } = render(React.createElement(GrowBar, { percent: 60, count: 3 }));

    await advance(20);

    // 条上方的数字标签已移除：DOM 里只剩 sr-only 这一处文本。
    // 视觉数字要逐帧改 textContent 并写 left 定位，是"文字抖动"的直接来源。
    const texts = container.querySelectorAll("span");
    expect(texts).toHaveLength(1);
    expect(texts[0]?.className).toBe("sr-only");
    expect(texts[0]?.textContent).toBe("3");
    // 也不能留下空出来的绝对定位标签
    expect(container.querySelector(".-translate-x-full")).toBeNull();
  });

  it("omits the assistive-tech text when no count is given", async () => {
    const { GrowBar } = await loadGrowBar();
    const { container } = render(React.createElement(GrowBar, { percent: 30 }));

    await advance(20);

    expect(container.querySelector(".sr-only")).toBeNull();
    expect(scaleXOf(fillOf(container))).toBeCloseTo(0.3, 2);
  });

  it("stops the animation on unmount instead of writing into a detached node", async () => {
    const { GrowBar } = await loadGrowBar();
    const { container, unmount } = render(React.createElement(GrowBar, { percent: 100, count: 5 }));

    await advance(3);
    unmount();

    // 卸载后继续推进不该抛错（effect 的 controls.stop() 生效）
    await expect(advance(5)).resolves.toBeUndefined();
    expect(container.querySelector(".origin-left")).toBeNull();
  });

  it("handles a mid-flight target change without restarting from zero", async () => {
    const { GrowBar } = await loadGrowBar();
    const { container, rerender } = render(
      React.createElement(GrowBar, { percent: 20, count: 1 })
    );

    await advance(30);
    const fill = fillOf(container);
    const before = scaleXOf(fill);

    rerender(React.createElement(GrowBar, { percent: 90, count: 5 }));
    await advance(80);

    const after = scaleXOf(fill);
    // 目标变大：从当前值继续推进，而不是退回 0 重来
    expect(after).toBeGreaterThan(before);
    expect(after).toBeCloseTo(0.9, 2);
  });

  it("treats a zero target as zero fill", async () => {
    const { GrowBar } = await loadGrowBar();
    const { container } = render(React.createElement(GrowBar, { percent: 0, count: 0 }));

    await advance(20);

    expect(scaleXOf(fillOf(container))).toBeCloseTo(0, 2);
    expect(container.querySelector(".sr-only")?.textContent).toBe("0");
  });

  it("clamps an out-of-range percentage instead of overflowing the track", async () => {
    const { GrowBar } = await loadGrowBar();
    const { container } = render(React.createElement(GrowBar, { percent: 180, count: 9 }));

    await advance(80);

    // 超过 100% 的输入必须被夹住，否则条会画到轨道外面
    expect(scaleXOf(fillOf(container))).toBeCloseTo(1, 2);
  });
});

describe("SpotlightCard under a DOM", () => {
  function renderCard(SpotlightCard: SpotlightModule["SpotlightCard"]) {
    return render(React.createElement(SpotlightCard, null, React.createElement("p", null, "内容")));
  }

  it("writes the cursor offset into CSS variables", async () => {
    const { SpotlightCard } = await loadSpotlight();
    const { container, getByTestId } = renderCard(SpotlightCard);

    const card = container.firstElementChild as HTMLElement;
    const glow = getByTestId("spotlight-layer") as HTMLElement;

    // jsdom 不做布局，固定一个已知矩形让偏移可验算
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 50,
      right: 400,
      bottom: 250,
      width: 300,
      height: 200,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    } as DOMRect);

    await act(async () => {
      fireEvent.mouseMove(card, { clientX: 180, clientY: 120 });
    });

    // 相对卡片左上角：180-100=80, 120-50=70
    expect(glow.style.getPropertyValue("--spotlight-x")).toBe("80px");
    expect(glow.style.getPropertyValue("--spotlight-y")).toBe("70px");
  });

  it("raises the glow on enter and hides it on leave", async () => {
    const { SpotlightCard } = await loadSpotlight();
    const { container, getByTestId } = renderCard(SpotlightCard);

    const card = container.firstElementChild as HTMLElement;
    const glow = getByTestId("spotlight-layer") as HTMLElement;

    expect(glow.style.getPropertyValue("--spotlight-opacity")).toBe("0");

    // React 的 onMouseEnter 由 mouseover 代理触发，直接派发 mouseenter 不会命中
    await act(async () => {
      fireEvent.mouseOver(card);
    });
    expect(glow.style.getPropertyValue("--spotlight-opacity")).toBe("1");

    await act(async () => {
      fireEvent.mouseOut(card, { relatedTarget: document.body });
    });
    expect(glow.style.getPropertyValue("--spotlight-opacity")).toBe("0");
  });

  it("survives a mousemove after the refs were cleared", async () => {
    const { SpotlightCard } = await loadSpotlight();
    const { container, unmount } = renderCard(SpotlightCard);

    const card = container.firstElementChild as HTMLElement;
    unmount();

    // 卸载后事件仍可能被派发（例如过渡期间），不能因为 ref 为 null 就抛错
    await act(async () => {
      card.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 1, clientY: 1 }));
    });
    expect(true).toBe(true);
  });
});
