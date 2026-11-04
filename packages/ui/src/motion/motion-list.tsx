"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@subboost/ui/lib/utils";
import {
  LIST_ITEM_MOTION,
  LIST_ITEM_TRANSITION,
  LIST_LAYOUT_TRANSITION,
  REVEAL_MOTION,
  REVEAL_TRANSITION,
} from "@subboost/ui/motion/tokens";

export type MotionListProps = {
  as?: "ul" | "ol" | "div";
  className?: string;
  children: React.ReactNode;
  /** 首次挂载是否播放进场动画。默认关闭：首屏一次性播十几条会显得很吵 */
  animateOnMount?: boolean;
  /**
   * 退场策略。`popLayout` 让离场项立即脱离布局，其余项由 layout 立刻滑动补位；
   * `sync` 保留离场项的占位直到动画结束，内容行高会随展开改变时用它避免抖动。
   */
  mode?: "popLayout" | "sync";
};

/**
 * 支持增删与 FLIP 重排的列表容器。
 *
 * - `<AnimatePresence mode="popLayout">`：被移除的项会完整播完淡出离场动画，
 *   同时立刻从布局中脱开，其余项由 layout 平滑滑动填充空位（FLIP）。
 * - 只动画 `opacity` / `y`，由 Motion 统一接管 transform。
 */
export function MotionList({
  as = "div",
  className,
  children,
  animateOnMount = false,
  mode = "popLayout",
}: MotionListProps) {
  const Component = motion[as];
  return (
    <AnimatePresence mode={mode} initial={animateOnMount}>
      <Component className={className}>{children}</Component>
    </AnimatePresence>
  );
}

export type MotionItemProps = {
  as?: "li" | "div" | "tr";
  className?: string;
  children: React.ReactNode;
  /**
   * 同一列表内的稳定唯一键。作为 layout 的身份标识，必须由业务数据提供，
   * 不要用数组下标，否则删除中间项时 FLIP 会认错元素。
   */
  itemKey: string;
  /**
   * 是否参与 FLIP 重排。表格行默认关闭：`<tr>` 的布局由表格算法决定，
   * layout 测量出来的位置和实际渲染不一致，删除时会看到行先跳一下再滑。
   */
  layout?: boolean;
};


/**
 * 列表中的单项：进场、离场与（可选）FLIP 重排。
 *
 * 进场只淡入，不做位移（以前是 `y: 8 → 0`）：位移会被提升为合成层并按非整数
 * 设备像素平移，整块纹理被插值采样 —— 行内文字在动画期间发虚。顺带的好处是
 * 向下的位移不再被滚动容器计入 scrollHeight，容器内外可以共用同一套入场。
 *
 * `layout="position"` 只插值位置，不插值尺寸。用完整的 `layout` 时 Motion 会用
 * scaleX/scaleY 模拟宽高变化，行内文字随之被横向或纵向压扁——这也是"文字抖动"
 * 的一个来源。卡片列表里行高本来就不需要两帧过渡。
 */
export function MotionItem({
  as = "li",
  className,
  children,
  itemKey,
  layout = as !== "tr",
}: MotionItemProps) {
  const Component = motion[as];
  return (
    <Component
      key={itemKey}
      initial={LIST_ITEM_MOTION.initial}
      animate={LIST_ITEM_MOTION.animate}
      exit={LIST_ITEM_MOTION.exit}
      transition={{
        ...LIST_ITEM_TRANSITION,
        layout: LIST_LAYOUT_TRANSITION,
      }}
      /*
       * layout="position" 只插值位置，不插值尺寸。
       * 传布尔 true 时 Motion 会用 scaleX/scaleY 模拟宽高变化，
       * 行内文字随之被横向或纵向压扁 —— 这也是"文字抖动"的一个来源。
       */
      layout={layout ? "position" : false}
      className={cn(className)}
    >
      {children}
    </Component>
  );
}

export type MotionRevealProps = {
  /** 展开状态。收起时会播完整离场动画再测量高度为 0 */
  open: boolean;
  className?: string;
  children: React.ReactNode;
  id?: string;
};

/**
 * 可折叠内容区：高度由内容决定，用 `height: auto` 让 Motion 自己测量。
 * 不用 CSS `grid-template-rows: 0fr/1fr` 是因为它在 Safari 上会有一次性跳变，
 * 而且无法和上面的 FLIP 列表保持一致的时间曲线。
 */
export function MotionReveal({ open, className, children, id }: MotionRevealProps) {
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="reveal"
          id={id}
          initial={REVEAL_MOTION.initial}
          animate={REVEAL_MOTION.animate}
          exit={REVEAL_MOTION.exit}
          transition={REVEAL_TRANSITION}
          className={cn("overflow-hidden", className)}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
