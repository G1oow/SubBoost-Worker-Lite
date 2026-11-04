"use client";

import * as React from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { cn } from "@subboost/ui/lib/utils";
import { GROW_BAR_SPRING } from "@subboost/ui/motion/tokens";

export type GrowBarProps = {
  /** 目标占比 0–100 */
  percent: number;
  /**
   * 与条形同源的稳定数值（例如节点数），只写进 `sr-only` 供读屏朗读。
   * 刻意不渲染视觉数字：见下方组件的说明。
   */
  count?: number;
  /** 进度条填充色（渐变或纯色） */
  fillClassName?: string;
  /** 轨道高度 */
  heightClassName?: string;
  className?: string;
};

/**
 * 物理弹簧驱动的进度条。
 *
 * 这里**不再渲染骑在条末端的数字标签**，原因有三条：
 *
 * 1. 定位只能用 `left`：标签要跟着填充末端走，而条本身是 `scaleX` 驱动的，
 *    两者不是同一个坐标系，只能把 `left` 设成 `max(1rem, {progress}%)`。
 *    `left` 是布局属性 —— 每帧都要重排 + 重绘，一行列表滚动时尤其贵。
 * 2. 数字逐帧改 `textContent`：文本每次变化都要重新排版与栅格化，
 *    在大字号下就是肉眼可见的「文字在抖」。
 * 3. 数值信息在行的右侧已经有百分比（`{share}%`）与指标格里的节点总数，
 *    条上再骑一个数字属于同一信息的第三次重复。
 *
 * 现在条只做一件事：由**单一** MotionValue 驱动 `scaleX`，全程走合成线程，
 * 不触发布局、不重排文字。数值仍以 `sr-only` 保留，读屏读到的是稳定终值。
 *
 * 另外刻意用 `scaleX` 而不是动画 `width`：width 每帧都要重算布局，
 * scaleX 只走合成线程，动画期间不掉帧。
 */
export function GrowBar({
  percent,
  count,
  fillClassName,
  heightClassName = "h-1",
  className,
}: GrowBarProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  const reduceMotion = useReducedMotion();

  // 弹簧从 0 起步推进到目标占比；数据变化时从当前值继续，不会跳回起点
  const progress = useMotionValue(0);

  React.useEffect(() => {
    // 尊重「减少动态效果」：直接落到终点，不做增长过程
    if (reduceMotion) {
      progress.set(clamped);
      return;
    }

    const controls = animate(progress, clamped, GROW_BAR_SPRING);
    return () => controls.stop();
  }, [clamped, progress, reduceMotion]);

  const scaleX = useTransform(progress, (value) => value / 100);

  return (
    <div className={cn("relative", className)}>
      <div className={cn("w-full overflow-hidden rounded-full bg-ink/10", heightClassName)}>
        <motion.div
          className={cn("h-full origin-left rounded-full", fillClassName)}
          style={{ scaleX }}
        />
      </div>

      {/* 视觉部分随动画变化，读屏需要稳定的最终值 */}
      {typeof count === "number" ? <span className="sr-only">{count}</span> : null}
    </div>
  );
}
