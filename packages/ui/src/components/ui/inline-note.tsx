"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { Icon } from "@subboost/ui/components/ui/icon";
import { cn } from "@subboost/ui/lib/utils";

/**
 * 状态提示（警告 / 失败 / 成功）。
 *
 * 以前各页面自己拼 `border-warning-note-border bg-warning-note-bg text-warning-note-fg` 这类组合，
 * 同一句「格式无效，生成时会被忽略」在不同页面能有三种底色、两种字号、两种内边距。
 * 这里把「底色 + 描边 + 前景 + 图标」收成一组主题令牌（见 theme.css 的 *-note-*），
 * 页面上只选 tone，不再自己配颜色。
 */
export type InlineNoteTone = "warning" | "danger" | "success";

export type InlineNoteVariant = "boxed" | "plain";

export type InlineNoteProps = {
  tone?: InlineNoteTone;
  children: React.ReactNode;
  /** 默认按 tone 取图标；传 null 表示不要图标 */
  icon?: React.ReactNode | null;
  /** 校验错误、生成失败这类需要立刻朗读的内容传 true，会补 role="alert" */
  alert?: boolean;
  /** boxed：带底色描边的块提示；plain：只有图标与文字的行内附注 */
  variant?: InlineNoteVariant;
  className?: string;
};

const TONE_META: Record<InlineNoteTone, { icon: LucideIcon; box: string }> = {
  warning: {
    icon: TriangleAlert,
    box: "border-warning-note-border bg-warning-note-bg text-warning-note-fg",
  },
  danger: {
    icon: CircleAlert,
    box: "border-danger-note-border bg-danger-note-bg text-danger-note-fg",
  },
  success: {
    icon: CircleCheck,
    box: "border-success-note-border bg-success-note-bg text-success-note-fg",
  },
};

function InlineNote({
  tone = "warning",
  children,
  icon,
  alert = false,
  variant = "boxed",
  className,
}: InlineNoteProps) {
  const meta = TONE_META[tone];
  return (
    <div
      role={alert ? "alert" : undefined}
      className={cn(
        "flex items-start gap-1.5 text-2xs leading-relaxed",
        meta.box,
        variant === "boxed" ? "rounded-xl border px-3 py-2" : "border-0 bg-transparent",
        className
      )}
    >
      {icon === null ? null : (
        <span className="mt-px shrink-0">
          {icon ?? <Icon icon={meta.icon} size="sm" />}
        </span>
      )}
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}

export { InlineNote };
