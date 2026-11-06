"use client";

import * as React from "react";
import { cn } from "@subboost/ui/lib/utils";

/**
 * 列表空状态：虚线框 + 居中一句说明（可选图标与操作）。
 *
 * 规则列表、链式代理、源列表、订阅列表原先各写一份 `rounded-xl border border-dashed ...`，
 * 描边色（ink/15、card-border）与字号（text-sm、text-xs）各不相同。统一收在这里，
 * 只传文案，需要时再加图标与操作。
 */
export type EmptyStateProps = {
  children: React.ReactNode;
  /** 可选图标：只做装饰，读屏由文案负责 */
  icon?: React.ReactNode;
  /** 可选操作，例如「新建链」按钮 */
  action?: React.ReactNode;
  className?: string;
};

function EmptyState({ children, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-dashed border-card-border px-4 py-8 text-center",
        className
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="text-fg-35">
          {icon}
        </span>
      ) : null}
      <p className="max-w-prose text-sm text-fg-45">{children}</p>
      {action}
    </div>
  );
}

export { EmptyState };
