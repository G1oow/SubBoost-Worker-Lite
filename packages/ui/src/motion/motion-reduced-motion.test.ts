// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `useReducedMotion()` 读的是 motion-dom 的模块级单例（prefersReducedMotion.current），
 * 在首次调用时才用 matchMedia 初始化一次。vitest 默认把 node_modules 外部化，
 * `vi.resetModules()` 清不掉那份状态，`vi.stubGlobal("matchMedia")` 也就赶不上。
 *
 * 所以这个文件只做一件事：把 hook 本身 mock 成 true，
 * 单独验证 GrowBar 在「用户要求减少动态效果」时的分支。
 */

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return { ...actual, useReducedMotion: () => true };
});

afterEach(() => {
  cleanup();
});

/** 让 Motion 推进若干帧（jsdom 不做布局，但 transform 会被写进内联样式） */
async function ticks(times = 2) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
  }
}

function scaleXOf(element: HTMLElement): number {
  const raw = element.style.transform || getComputedStyle(element).transform;
  if (!raw || raw === "none") return 1;
  const matrix = /matrix\(([^,]+),/u.exec(raw);
  if (matrix) return Number.parseFloat(matrix[1]);
  const scaleX = /scaleX\(([-\d.]+)\)/u.exec(raw);
  if (scaleX) return Number.parseFloat(scaleX[1]);
  return 1;
}

describe("GrowBar with reduced motion", () => {
  it("lands on the target within a couple of frames instead of animating", async () => {
    const { GrowBar } = await import("./grow-bar");
    const { container } = render(React.createElement(GrowBar, { percent: 80, count: 4 }));

    // 只要两帧：真的在跑弹簧的话，两帧内不可能推进到 80%
    await ticks(2);

    const fill = container.querySelector(".origin-left") as HTMLElement;
    expect(scaleXOf(fill)).toBeCloseTo(0.8, 2);
    // 读屏拿到的仍是稳定终值
    expect(container.querySelector(".sr-only")?.textContent).toBe("4");
  });

  it("still applies the final fill width", async () => {
    const { GrowBar } = await import("./grow-bar");
    const { container } = render(React.createElement(GrowBar, { percent: 55, count: 3 }));

    await ticks(2);

    const fill = container.querySelector(".origin-left") as HTMLElement;
    // 终值必须一次到位：27% 之类的中间值都不算通过
    expect(scaleXOf(fill)).toBeCloseTo(0.55, 2);
  });
});
