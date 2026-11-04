"use client";

import * as React from "react";
import type { LucideIcon, LucideProps } from "lucide-react";
import { cn } from "@subboost/ui/lib/utils";

/**
 * 全站图标的唯一出口。
 *
 * 约定：
 * - 图标一律来自 lucide-react，业务代码通过本组件渲染，不直接导入 lucide 图标
 *   （`scripts/check-ui-consistency.cjs` 会拒绝绕过）。
 * - 尺寸只用下面五档，避免出现 13px、18px 这类一次性尺寸。
 * - 描边默认 1.75：lucide 自带的 2 在 14–16px 下偏重，1.75 在高 DPI 屏上更干净，
 *   同时保持线框风格的识别度。
 * - 图标默认是装饰性的（`aria-hidden`）；需要被读屏念出来时传 `label`。
 */
export const ICON_STROKE_WIDTH = 1.75;

export const ICON_SIZE_CLASS = {
  xs: "size-3",
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5",
  xl: "size-6",
} as const;

export type IconSize = keyof typeof ICON_SIZE_CLASS;

export interface IconProps extends Omit<LucideProps, "ref" | "size" | "icon" | "iconNode"> {
  icon: LucideIcon;
  /**
   * 尺寸档位。容器已经用 `[&_svg]:size-*` 统一控制时不要传，
   * 那种情况下父选择器特异性更高，会盖掉这里的类。
   */
  size?: IconSize;
  /** 有独立语义时传入（会输出 `role="img"` + `aria-label`），装饰性图标不要传。 */
  label?: string;
}

const Icon = React.forwardRef<SVGSVGElement, IconProps>(function Icon(
  { icon: Glyph, size, label, className, strokeWidth = ICON_STROKE_WIDTH, ...props },
  ref
) {
  return (
    <Glyph
      ref={ref}
      strokeWidth={strokeWidth}
      className={cn(size && ICON_SIZE_CLASS[size], className)}
      {...(label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true })}
      {...props}
    />
  );
});
Icon.displayName = "Icon";

export { Icon };
export type { LucideIcon };
