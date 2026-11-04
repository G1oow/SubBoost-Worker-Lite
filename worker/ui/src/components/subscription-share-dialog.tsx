import * as React from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Check, Copy, Download, ExternalLink, QrCode, ShieldAlert } from "lucide-react";
import { Button } from "@subboost/ui/components/ui/button";
import { confirmDialog } from "@subboost/ui/components/ui/confirm-dialog";
import { Icon } from "@subboost/ui/components/ui/icon";
import { LoadingButton } from "@subboost/ui/motion/loading-button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@subboost/ui/components/ui/dialog";
import { useToast } from "@subboost/ui/components/ui/toaster";
import { copyTextToClipboard } from "@subboost/ui/lib/clipboard";
import { buildQrFileName, downloadQrPng } from "@subboost/ui/lib/qr-download";
import type { SubscriptionDto } from "../lib/types";
import { ShortLinkSection } from "./subscription-short-link";

/** 二维码留白（模块数），低于 4 会影响部分扫码器识别 */
const QR_MARGIN_SIZE = 4;

export type SubscriptionShareContentProps = {
  subscription: SubscriptionDto;
  /** 交给 canvas 的 ref，用于导出 PNG */
  canvasRef?: React.Ref<HTMLCanvasElement>;
  copied?: boolean;
  downloading?: boolean;
  onCopy?: () => void;
  onDownload?: () => void;
  onOpenLink?: () => void;
  /** 短链生成/撤销进行中 */
  shortBusy?: boolean;
  /** 短链刚复制成功 */
  shortCopied?: boolean;
  onCreateShortLink?: () => void;
  onCopyShortLink?: () => void;
  onRevokeShortLink?: () => void;
};

/** 与弹窗解耦的分享内容，便于直接渲染和测试 */
export function SubscriptionShareContent({
  subscription,
  canvasRef,
  copied = false,
  downloading = false,
  onCopy,
  onDownload,
  onOpenLink,
  shortBusy = false,
  shortCopied = false,
  onCreateShortLink,
  onCopyShortLink,
  onRevokeShortLink,
}: SubscriptionShareContentProps) {
  // 生成短链后，二维码与「复制/打开」都指向短链；原链接仍完整展示，方便已在用的客户端继续使用
  const shortLink = subscription.shortLink;
  const shareLink = shortLink ?? subscription.link;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-fg">{subscription.name}</p>
        <p className="text-xs text-fg-45">用手机客户端扫描二维码，或复制链接手动导入。</p>
      </div>

      <div className="flex justify-center rounded-2xl border border-ink/10 bg-ink/5 px-3 py-4 sm:px-4 sm:py-5">
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <QRCodeCanvas
            ref={canvasRef}
            value={shareLink}
            size={200}
            level="M"
            marginSize={QR_MARGIN_SIZE}
            bgColor="#ffffff"
            fgColor="#000000"
            title={`${subscription.name} 订阅二维码`}
            // 画布内容对辅助技术不可读，链接由下方文本提供
            aria-hidden="true"
            data-testid="subscription-share-qr"
            // 200px 在 320px 宽的小屏上会顶到弹窗内边距，按容器等比收缩
            className="h-auto max-w-full"
          />
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium text-fg-70">订阅链接</p>
        <p className="select-all break-all rounded-xl border border-ink/10 bg-ink/5 px-3 py-2 font-mono text-xs leading-relaxed text-fg-60">
          {shareLink}
        </p>
        {shortLink ? (
          <p className="select-all break-all text-[11px] leading-relaxed text-fg-45">
            原始链接：{subscription.link}
          </p>
        ) : null}
      </div>

      <ShortLinkSection
        link={shortLink}
        busy={shortBusy}
        copied={shortCopied}
        onCreate={onCreateShortLink}
        onCopy={onCopyShortLink}
        onRevoke={onRevokeShortLink}
      />

      <p className="flex items-start gap-1.5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
        <Icon icon={ShieldAlert} size="sm" className="mt-px shrink-0" />
        <span>链接等同于访问凭据，拿到即可拉取订阅，请只分享给本人设备。</span>
      </p>

      {/* 窄屏把三个按钮堆叠铺满：一行三个中文按钮在 320px 下会被压成两行且对齐错乱 */}
      <DialogFooter className="flex-col gap-2 sm:flex-row">
        <LoadingButton
          type="button"
          variant="secondary"
          onClick={onDownload}
          loading={downloading}
          loadingLabel="保存中…"
          className="w-full sm:w-auto"
        >
          <Icon icon={Download} />
          保存二维码
        </LoadingButton>
        <Button type="button" variant="secondary" onClick={onOpenLink} className="w-full sm:w-auto">
          <Icon icon={ExternalLink} />
          打开链接
        </Button>
        <Button type="button" onClick={onCopy} className="w-full sm:w-auto">
          {copied ? <Icon icon={Check} className="animate-icon-pop text-emerald-400" /> : <Icon icon={Copy} />}
          {copied ? "已复制" : "复制链接"}
        </Button>
      </DialogFooter>
    </div>
  );
}

export type SubscriptionShareDialogProps = {
  /** 为 null 时弹窗关闭 */
  subscription: SubscriptionDto | null;
  onClose: () => void;
  /** 生成短链；成功后订阅数据由父级刷新，弹窗跟着重渲染 */
  onCreateShortLink?: () => Promise<void>;
  /** 撤销短链 */
  onRevokeShortLink?: () => Promise<void>;
};

export function SubscriptionShareDialog({
  subscription,
  onClose,
  onCreateShortLink,
  onRevokeShortLink,
}: SubscriptionShareDialogProps) {
  const { toast } = useToast();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);
  const [shortBusy, setShortBusy] = React.useState(false);
  const [shortCopied, setShortCopied] = React.useState(false);

  // 切换到另一条订阅时清掉上一条的状态
  React.useEffect(() => {
    setCopied(false);
    setDownloading(false);
    setShortBusy(false);
    setShortCopied(false);
  }, [subscription?.id]);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  React.useEffect(() => {
    if (!shortCopied) return;
    const timer = window.setTimeout(() => setShortCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [shortCopied]);

  // 复制与打开都跟随「当前分享链接」：有短链时就是短链
  const shareLink = subscription?.shortLink ?? subscription?.link ?? "";

  const handleCopy = async () => {
    if (!subscription) return;
    const ok = await copyTextToClipboard(shareLink);
    if (!ok) {
      toast({ variant: "warning", title: "复制失败", description: "请手动选择链接复制。" });
      return;
    }
    setCopied(true);
  };

  const handleCopyShort = async () => {
    if (!subscription?.shortLink) return;
    const ok = await copyTextToClipboard(subscription.shortLink);
    if (!ok) {
      toast({ variant: "warning", title: "复制失败", description: "请手动选择短链复制。" });
      return;
    }
    setShortCopied(true);
  };

  const handleDownload = async () => {
    if (!subscription) return;
    setDownloading(true);
    try {
      const ok = await downloadQrPng(canvasRef.current, buildQrFileName(subscription.name));
      if (!ok) {
        toast({ variant: "warning", title: "下载失败", description: "请改用复制链接导入客户端。" });
        return;
      }
      toast({ variant: "success", title: "已保存二维码" });
    } finally {
      setDownloading(false);
    }
  };

  const handleOpenLink = () => {
    if (!subscription) return;
    window.open(shareLink, "_blank", "noopener,noreferrer");
  };

  const handleCreateShort = async () => {
    if (!onCreateShortLink) return;
    setShortBusy(true);
    try {
      await onCreateShortLink();
      toast({ variant: "success", title: "已生成短链" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "生成短链失败",
        description: err instanceof Error ? err.message : "生成短链失败",
      });
    } finally {
      setShortBusy(false);
    }
  };

  const handleRevokeShort = async () => {
    if (!onRevokeShortLink) return;
    const confirmed = await confirmDialog({
      title: "撤销短链？",
      description: "撤销后短链立即失效，已导入短链的客户端需要改用原链接；原链接不受影响。",
      confirmText: "撤销",
      variant: "warning",
    });
    if (!confirmed) return;
    setShortBusy(true);
    try {
      await onRevokeShortLink();
      toast({ variant: "success", title: "已撤销短链" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "撤销失败",
        description: err instanceof Error ? err.message : "撤销失败",
      });
    } finally {
      setShortBusy(false);
    }
  };

  return (
    <Dialog open={subscription !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon icon={QrCode} size="md" className="text-fg-60" />
            分享订阅
          </DialogTitle>
        </DialogHeader>

        {subscription ? (
          <SubscriptionShareContent
            subscription={subscription}
            canvasRef={canvasRef}
            copied={copied}
            downloading={downloading}
            onCopy={handleCopy}
            onDownload={handleDownload}
            onOpenLink={handleOpenLink}
            shortBusy={shortBusy}
            shortCopied={shortCopied}
            onCreateShortLink={onCreateShortLink ? handleCreateShort : undefined}
            onCopyShortLink={handleCopyShort}
            onRevokeShortLink={onRevokeShortLink ? handleRevokeShort : undefined}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
