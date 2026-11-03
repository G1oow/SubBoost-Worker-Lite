"use client";

import * as React from "react";
import { cn } from "@subboost/ui/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          // 与 Input 一致：移动端起于 16px 避免 iOS 聚焦自动缩放，桌面回到 14px
          "flex min-h-[120px] w-full rounded-xl border border-field-border bg-field px-4 py-3 text-base text-fg placeholder:text-fg-40 focus:outline-none focus:ring-2 focus:ring-focus-ring focus:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 resize-none sm:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
