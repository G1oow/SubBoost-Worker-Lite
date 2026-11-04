"use client";

import * as React from "react";
import { cn } from "@subboost/ui/lib/utils";

export type SpotlightCardProps = Omit<React.HTMLAttributes<HTMLDivElement>, "children"> & {
  children: React.ReactNode;
  /** 聚光灯中心色。默认取品牌主色，传 rgba() 字符串可定制 */
  glowColor?: string;
  /** 光斑半径 px */
  radius?: number;
};

/**
 * 鼠标跟随的聚光灯卡片（Aceternity UI 风格）。
 *
 * 只用一个绝对定位的径向渐变浮层，坐标来自 `onMouseMove` 的局部偏移。
 * 刻意不在 mousemove 里 setState 触发 React 渲染：坐标直接写到 DOM 节点的
 * CSS 变量上，浏览器只需重绘渐变，不进入 React 的调度。悬停进出用 opacity 过渡。
 *
 * 关于光斑的铺满：光斑层是 `absolute inset-0`，但它的定位父级必须是真正的卡片框，
 * 所以这里的 className 只由外部决定内边距，不再写死 `p-5`。此前写得下 `p-5`，
 * 外部传 `p-6` 时两者叠加后 padding 变大、内层内容区缩进，光斑看起来只覆盖中间一块。
 */
export function SpotlightCard({
  children,
  className,
  glowColor = "color-mix(in oklab, var(--color-primary-500) 22%, transparent)",
  radius = 420,
  ...props
}: SpotlightCardProps) {
  const cardRef = React.useRef<HTMLDivElement>(null);
  const glowRef = React.useRef<HTMLDivElement>(null);

  const handleMouseMove = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    const glow = glowRef.current;
    if (!card || !glow) return;
    const rect = card.getBoundingClientRect();
    // 用相对卡片左上角的坐标，注意圆角外的区域也会命中（pointer-events 在卡片上）
    glow.style.setProperty("--spotlight-x", `${event.clientX - rect.left}px`);
    glow.style.setProperty("--spotlight-y", `${event.clientY - rect.top}px`);
  }, []);

  const handleMouseEnter = React.useCallback(() => {
    glowRef.current?.style.setProperty("--spotlight-opacity", "1");
  }, []);

  const handleMouseLeave = React.useCallback(() => {
    glowRef.current?.style.setProperty("--spotlight-opacity", "0");
  }, []);

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        // hover 只过渡边框：光斑本身用 opacity 过渡（纯合成层），
        // 不再叠 hover 阴影 —— 大范围模糊阴影进 transition 会逐帧重算整卡。
        "group/spotlight relative overflow-hidden rounded-2xl border border-card-border bg-surface shadow-(--surface-shadow) transition-[border-color] duration-200 hover:border-primary-500/40",
        className
      )}
      {...props}
    >
      {/* 光斑层：inset-0 必须落在真正的卡片边框内，才能覆盖四角与边缘 */}
      <div
        ref={glowRef}
        aria-hidden="true"
        data-testid="spotlight-layer"
        className="pointer-events-none absolute inset-0 z-0 transition-opacity duration-300 motion-reduce:hidden"
        style={
          {
            "--spotlight-opacity": "0",
            opacity: "var(--spotlight-opacity)",
            background: `radial-gradient(${radius}px circle at var(--spotlight-x, 50%) var(--spotlight-y, 50%), ${glowColor}, transparent 62%)`,
          } as React.CSSProperties
        }
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
