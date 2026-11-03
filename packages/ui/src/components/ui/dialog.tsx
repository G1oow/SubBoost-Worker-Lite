"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@subboost/ui/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-overlay backdrop-blur-sm",
      "data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

// 居中容器：用 grid 的 place-items 居中，不再依赖 translate-*。
// Tailwind v4 的 translate-x/y-* 写的是独立的 translate 属性，
// 与进出场关键帧里的 translate 是同一个属性，必然互相覆盖：
// 动画期间居中定位被整个吞掉，弹窗会从错误位置飞入、结束再跳回原点。
// 把定位交给容器后，内容元素上的 translate 只归动画所有。
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <div className="pointer-events-none fixed inset-0 z-50 grid place-items-end p-0 sm:place-items-center sm:p-4">
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          // 弹窗底色是不透明的（--surface 在明暗主题下都没有 alpha），
          // 再叠 glass-card 的 backdrop-blur-xl 只会在每帧对整块背景做 24px 模糊，
          // 既看不出效果又拖慢开合动画。这里直接给不透明底色 + 边框阴影。
          // 窄屏改成贴底的抽屉形态：键盘弹出时内容区不会被顶出视口，拇指也够得到底部按钮。
          // dvh 而不是 vh：移动浏览器地址栏收起/展开时 vh 不变，会让弹窗下沿被遮住。
          "pointer-events-auto relative grid w-full max-w-lg gap-3 rounded-t-2xl border border-ink/10 bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-(--popover-shadow) max-h-[92dvh] overflow-y-auto custom-scrollbar sm:gap-4 sm:rounded-2xl sm:p-6 sm:pb-6 sm:max-h-[85vh]",
          "data-[state=open]:animate-modal-in data-[state=closed]:animate-modal-out",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-2 top-2 rounded-lg p-2 opacity-70 transition-all hover:opacity-100 hover:bg-ink/5 focus:outline-none focus:ring-2 focus:ring-focus-ring disabled:pointer-events-none sm:right-4 sm:top-4 sm:p-1">
          <X className="h-4 w-4 text-fg-60" />
          <span className="sr-only">关闭</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </div>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight text-fg",
      className
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-fg-50", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
