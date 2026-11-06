"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@subboost/ui/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-focus-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-primary-500/50 bg-primary-500/20 text-primary-200",
        secondary: "border-ink/15 bg-ink/5 text-fg-70",
        destructive: "border-danger-note-border bg-danger-note-bg text-danger-note-fg",
        outline: "text-fg-70 border-ink/20 bg-transparent",
        success: "border-success-note-border bg-success-note-bg text-success-note-fg",
        warning: "border-warning-note-border bg-warning-note-bg text-warning-note-fg",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
