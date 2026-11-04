import { FlaskConical } from "lucide-react";
import { Icon } from "@subboost/ui/components/ui/icon";

/**
 * 演示模式提示条。
 *
 * 预览站里的数据全部来自浏览器内存，与任何真实订阅无关；
 * 这个提示条的作用是说清这件事，避免访问者把演示数据当成真实数据。
 */
export function DemoBanner() {
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-3 z-50 flex justify-center px-3"
    >
      <p className="pointer-events-auto flex max-w-full items-center gap-1.5 rounded-full border border-ink/10 bg-surface-raised px-3 py-1.5 text-center text-xs text-fg-60 shadow-sm">
        <Icon icon={FlaskConical} size="xs" className="shrink-0 text-fg-45" />
        演示模式 · 数据只存在浏览器内存，刷新即重置
      </p>
    </div>
  );
}
