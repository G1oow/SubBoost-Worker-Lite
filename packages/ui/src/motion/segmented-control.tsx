"use client";

import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@subboost/ui/lib/utils";
import { PILL_TRANSITION } from "@subboost/ui/motion/tokens";

export type SegmentedOption = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** 右侧小徽标，例如数量提示 */
  badge?: string | number;
};

export type SegmentedControlProps = {
  options: SegmentedOption[];
  activeId: string;
  onSelect: (id: string) => void;
  /** 无障碍名称，必填：控件本身是 tablist，需要能被朗读 */
  label: string;
  /**
   * 滑块共享布局的命名空间。同一页面上出现多个分段控件时必须各不相同，
   * 否则滑块会跨控件飞来飞去。
   */
  layoutGroupId: string;
  className?: string;
  optionClassName?: string;
};

/**
 * macOS / iOS 风格的分段选择器。
 *
 * 高亮块用 Motion 的 `layoutId` 做共享布局：切换时由 Motion 自己测量起止位置并插值，
 * 不需要手写 offsetLeft / getBoundingClientRect，也就不会出现测量与布局不同步的错位。
 */
export function SegmentedControl({
  options,
  activeId,
  onSelect,
  label,
  layoutGroupId,
  className,
  optionClassName,
}: SegmentedControlProps) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-2xl border border-seg-track-border bg-seg-track p-1.5 shadow-(--seg-track-shadow) [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      {options.map((option) => {
        const active = option.id === activeId;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-current={active ? "page" : undefined}
            onClick={() => onSelect(option.id)}
            className={cn(
              "relative flex shrink-0 items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
              // 选中项用配套前景令牌：深色白字、浅色是同色系深蓝，
              // 比统一写 text-fg 更贴合蓝紫胶囊的色相
              active ? "text-seg-active-fg" : "text-fg-60 hover:text-fg-80",
              optionClassName
            )}
          >
            {active ? (
              <motion.span
                aria-hidden="true"
                layoutId={`${layoutGroupId}-active-pill`}
                className="absolute inset-0 rounded-xl border border-seg-active-border bg-seg-active shadow-(--seg-active-shadow)"
                transition={PILL_TRANSITION}
              />
            ) : null}
            <span className="relative z-10 flex items-center gap-2 whitespace-nowrap">
              {option.icon ? (
                <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center">
                  {option.icon}
                </span>
              ) : null}
              {option.label}
              {option.badge === undefined || option.badge === "" ? null : (
                <span className="rounded-full bg-ink/10 px-1.5 text-2xs leading-4 tabular-nums text-fg-60">
                  {option.badge}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
