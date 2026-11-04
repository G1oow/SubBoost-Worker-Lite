"use client";

import * as React from "react";
import { LoaderCircle } from "lucide-react";
import { Icon } from "@subboost/ui/components/ui/icon";
import { Button, type ButtonProps } from "@subboost/ui/components/ui/button";
import { cn } from "@subboost/ui/lib/utils";

export type LoadingButtonProps = ButtonProps & {
  /** 处于等待态：禁用按钮、图标换成旋转的 LoaderCircle、文案换成 loadingLabel */
  loading?: boolean;
  /** 等待态文案，省略时保持原 children */
  loadingLabel?: React.ReactNode;
};

/**
 * 带刷新等待态的按钮。
 *
 * 旋转动画用 Tailwind v4 内置的 `animate-spin`（纯 CSS，合成线程驱动），
 * 不引入 JS 动画；`disabled` 同时给到原生属性，避免等待期间重复提交。
 */
export function LoadingButton({
  loading = false,
  loadingLabel,
  disabled,
  children,
  className,
  ...props
}: LoadingButtonProps) {
  return (
    <Button
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(loading && "cursor-progress", className)}
      {...props}
    >
      {loading ? (
        <>
          <Icon icon={LoaderCircle} className="animate-spin" />
          {loadingLabel ?? children}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
