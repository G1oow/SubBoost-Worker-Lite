import * as React from "react";
import { formatCount } from "./format";

const EASE_OUT_CUBIC = (progress: number) => 1 - Math.pow(1 - progress, 3);

/** 回调 ref：把承载数字的元素交给 hook，由 rAF 直接写文本 */
export type AnimatedNumberRef = (node: HTMLSpanElement | null) => void;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * 数字变化时的缓动过渡，用于仪表板的计数动画。
 *
 * 返回 `[挂到元素上的 ref, 终值]`：终值直接用于渲染，首帧与静态渲染都是它。
 *
 * 三个刻意的设计：
 *
 * 1. **不走 React state**。逐帧 `setState` 会让 4 张统计卡每秒重渲染约 240 次，
 *    主线程被占满，同一帧里的页面入场动画只能掉帧 —— 用户看到的是"卡顿 + 抖动"。
 *    这里用 rAF 直接写 `textContent`，React 全程不参与。
 *    因为 children 始终是终值且渲染间不变，React 不会反过来覆盖写入的文本。
 * 2. **尊重 `prefers-reduced-motion`**。此前没有这个分支，
 *    要求减少动态效果的用户依然会看到数字滚动，属于无障碍缺陷。
 * 3. **用回调 ref 而不是 ref 对象**：ref 对象的 `.current` 在渲染期不可读，
 *    包在返回值里只会给调用方制造 `react-hooks/refs` 告警。
 */
export function useAnimatedNumber(
  value: number,
  durationMs = 640
): [AnimatedNumberRef, number] {
  const nodeRef = React.useRef<HTMLSpanElement | null>(null);
  const previous = React.useRef(value);

  const attach = React.useCallback<AnimatedNumberRef>((node) => {
    nodeRef.current = node;
  }, []);

  React.useEffect(() => {
    const node = nodeRef.current;
    const from = previous.current;
    previous.current = value;
    if (!node) return;

    const settle = () => {
      node.textContent = formatCount(value);
    };

    if (
      from === value ||
      durationMs <= 0 ||
      prefersReducedMotion() ||
      typeof requestAnimationFrame !== "function"
    ) {
      settle();
      return;
    }

    let frame: number | null = null;
    const start = typeof performance !== "undefined" ? performance.now() : Date.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const next = progress >= 1 ? value : Math.round(from + (value - from) * EASE_OUT_CUBIC(progress));
      node.textContent = formatCount(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };
  }, [value, durationMs]);

  return [attach, value];
}
