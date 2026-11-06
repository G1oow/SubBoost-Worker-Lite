import { Check, Copy, Link2, Unlink } from "lucide-react";
import { Button } from "@subboost/ui/components/ui/button";
import { Icon } from "@subboost/ui/components/ui/icon";
import { LoadingButton } from "@subboost/ui/motion/loading-button";

export type ShortLinkSectionProps = {
  /** 已生成的短链；缺省表示还没有 */
  link?: string;
  /** 生成/撤销进行中 */
  busy?: boolean;
  /** 短链刚复制成功 */
  copied?: boolean;
  /** 父级未提供处理函数时隐藏入口 */
  onCreate?: () => void;
  onCopy?: () => void;
  onRevoke?: () => void;
};

/**
 * 订阅短链区块：未生成时只给一个入口，生成后展示短链本身与复制/撤销操作。
 *
 * 与弹窗解耦，单独渲染即可测试三种状态；颜色一律走主题令牌，
 * 保证深色/浅色两套主题下都有足够对比度。
 */
export function ShortLinkSection({
  link,
  busy = false,
  copied = false,
  onCreate,
  onCopy,
  onRevoke,
}: ShortLinkSectionProps) {
  if (!link) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-ink/10 bg-ink/5 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-fg-60">
          短链是这条订阅的 8 字符别名，内容与原链接完全一致，适合手抄或贴进字数受限的地方。
        </p>
        <LoadingButton
          type="button"
          variant="secondary"
          size="sm"
          onClick={onCreate}
          loading={busy}
          loadingLabel="生成中…"
          className="w-full shrink-0 sm:w-auto"
        >
          <Icon icon={Link2} />
          生成短链
        </LoadingButton>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-ink/10 bg-ink/5 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-fg-70">短链</p>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="secondary" size="sm" onClick={onCopy}>
            <Icon icon={copied ? Check : Copy} className={copied ? "animate-icon-pop text-success-note-fg" : undefined} />
            {copied ? "已复制" : "复制短链"}
          </Button>
          <LoadingButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRevoke}
            loading={busy}
            loadingLabel="撤销中…"
          >
            <Icon icon={Unlink} />
            撤销短链
          </LoadingButton>
        </div>
      </div>
      <p className="select-all break-all rounded-lg border border-ink/10 bg-surface px-2.5 py-2 font-mono text-xs leading-relaxed text-fg-60">
        {link}
      </p>
    </div>
  );
}
