import * as React from "react";

/**
 * 页头吸顶状态。
 *
 * 判定逻辑做成纯函数、订阅做成一个薄 hook，两者分开放：
 * 阈值与边界可以在 node 环境直接断言（不需要 jsdom），事件订阅只在浏览器里跑。
 * SSR / 测试环境读不到滚动位置时一律按"未吸顶"处理，产出的仍是完整页头。
 */

/**
 * 吸顶阈值（px）。
 *
 * 取 48：页头第一行（品牌 + 标题 + 操作按钮）基本读完，工具条才浮现。
 * 更小的值会让工具条在页头还完整可见时就整块盖上去，观感像"页头被切掉一截"。
 */
export const PINNED_HEADER_THRESHOLD = 48;

/** 读取当前滚动偏移；缺失或异常值兜底为 0（SSR、老浏览器、单测环境都没有 scrollY） */
export function readScrollOffset(target?: { scrollY?: number } | null): number {
  const source = target ?? (typeof window === "undefined" ? null : window);
  const value = source?.scrollY;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * 是否需要切到吸顶形态。
 *
 * 用 `>` 而不是 `>=`：正好停在阈值上时保持未吸顶，来回滚动不会在同一个位置上闪烁。
 * iOS 回弹（overscroll）时 scrollY 是负数，这里一并归零，避免倒着滚时提前吸顶。
 */
export function resolvePinnedHeader(
  offset: number,
  threshold: number = PINNED_HEADER_THRESHOLD
): boolean {
  const safeOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0;
  const safeThreshold = Number.isFinite(threshold)
    ? Math.max(0, threshold)
    : PINNED_HEADER_THRESHOLD;
  return safeOffset > safeThreshold;
}

/**
 * 滚动吸顶开关。
 *
 * 两个细节：
 * - 监听用 `passive: true`：滚动事件不阻塞合成线程，回调里也只做一次比较；
 * - 用 rAF 合并同一帧内的多次滚动事件，每帧最多 setState 一次，
 *   避免触控板高频 scroll 时 React 反复提交（那才会被感知成"滚动发涩"）。
 *
 * 状态没变化时 setState 同一个值，React 会直接跳过重渲染，所以这里不必自己保一份 ref。
 */
export function useScrollHeaderPinned(threshold: number = PINNED_HEADER_THRESHOLD): boolean {
  const [pinned, setPinned] = React.useState(false);

  React.useEffect(() => {
    let frame = 0;

    const sync = () => {
      frame = 0;
      const next = resolvePinnedHeader(readScrollOffset(), threshold);
      setPinned((current) => (current === next ? current : next));
    };

    const schedule = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(sync);
    };

    // 刷新页面时浏览器会恢复滚动位置（历史栈恢复也在 DOM 之后），首帧先对齐一次，
    // 否则"人已经在半页、工具条却仍是未吸顶"，要等下一次滚动才纠正。
    sync();
    window.addEventListener("scroll", schedule, { passive: true });
    // 移动端地址栏收放会改视口高度，引用位置随之变化，一并重算
    window.addEventListener("resize", schedule);

    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [threshold]);

  return pinned;
}
