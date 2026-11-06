"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Icon, type IconSize } from "@subboost/ui/components/ui/icon";
import { cn } from "@subboost/ui/lib/utils";

export type DisclosureChevronProps = {
  /** 对应的折叠区是否展开：展开时箭头朝上 */
  open: boolean;
  /** 容器已用 [&_svg]:size-* 统一尺寸时不要传（父选择器会覆盖档位类） */
  size?: IconSize;
  className?: string;
};

/**
 * 折叠区的展开箭头。
 *
 * 时长与曲线和 MotionReveal（REVEAL_TRANSITION：0.22s、EASE_OUT）一致，
 * 箭头转完的那一刻正好是内容展开完毕。旋转作用在 16px 的纯图标上，没有可读文字，
 * 不受「文字只驱动 opacity」的限制；reduced-motion 下由 motion-safe 去掉过渡。
 */
export function DisclosureChevron({ open, size, className }: DisclosureChevronProps) {
  return (
    <Icon
      icon={ChevronDown}
      size={size}
      className={cn(
        "shrink-0 motion-safe:transition-transform motion-safe:duration-220 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]",
        open && "rotate-180",
        className
      )}
    />
  );
}
