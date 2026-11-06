"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@subboost/ui/lib/utils";

/*
 * 动效只走颜色：hover 150ms 渐变，按下瞬间切到更深一档的按压底色（active:duration-75），
 * 松开再按 150ms 回弹。按压不做缩放 —— scale 会把带文字的按钮提升为合成层，
 * 按下的那一下文字发虚；也不做全量过渡 —— 那会把 box-shadow 一起纳入过渡，
 * 每帧重算阴影。规范见 docs/frontend-guidelines.md「动效」。
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-[color,background-color,border-color,opacity] duration-150 ease-out active:duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-btn-primary-border bg-btn-primary text-btn-primary-fg hover:bg-btn-primary-hover active:bg-btn-primary-active hover:border-btn-primary-border-hover shadow-(--btn-primary-shadow) hover:shadow-(--btn-primary-shadow-hover)",
        destructive:
          "border border-btn-danger-border bg-btn-danger text-btn-danger-fg hover:bg-btn-danger-hover active:bg-btn-danger-active hover:border-btn-danger-border-hover shadow-(--btn-danger-shadow) hover:shadow-(--btn-danger-shadow-hover)",
        outline:
          "border border-btn-outline-border bg-btn-outline hover:bg-btn-outline-hover active:bg-btn-outline-active text-btn-outline-fg hover:text-btn-outline-fg-hover shadow-(--btn-outline-shadow)",
        secondary:
          "bg-btn-outline hover:bg-btn-outline-hover active:bg-btn-outline-active text-btn-outline-fg hover:text-btn-outline-fg-hover border border-btn-outline-border shadow-(--btn-outline-shadow)",
        ghost: "hover:bg-ink/5 active:bg-ink/10 text-fg-60 hover:text-fg",
        link: "text-indigo-400 underline-offset-4 hover:underline hover:text-indigo-300",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-12 rounded-xl px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
