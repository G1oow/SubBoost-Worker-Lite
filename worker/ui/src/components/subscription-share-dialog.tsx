import * as React from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Check, Copy, Download, ExternalLink, QrCode, ShieldAlert } from "lucide-react";
import { Button } from "@subboost/ui/components/ui/button";
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
}: SubscriptionShareContentProps) {
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
            value={subscription.link}
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
          {subscription.link}
        </p>
      </div>

      <p className="flex items-start gap-1.5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
        <ShieldAlert aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
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
          <Download aria-hidden="true" />
          保存二维码
        </LoadingButton>
        <Button type="button" variant="secondary" onClick={onOpenLink} className="w-full sm:w-auto">
          <ExternalLink aria-hidden="true" />
          打开链接
        </Button>
        <Button type="button" onClick={onCopy} className="w-full sm:w-auto">
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
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
};

export function SubscriptionShareDialog({ subscription, onClose }: SubscriptionShareDialogProps) {
  const { toast } = useToast();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);

  // 切换到另一条订阅时清掉上一条的状态
  React.useEffect(() => {
    setCopied(false);
    setDownloading(false);
  }, [subscription?.id]);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    if (!subscription) return;
    const ok = await copyTextToClipboard(subscription.link);
    if (!ok) {
      toast({ variant: "warning", title: "复制失败", description: "请手动选择链接复制。" });
      return;
    }
    setCopied(true);
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
    window.open(subscription.link, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog open={subscription !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode aria-hidden="true" className="h-4 w-4 text-fg-60" />
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
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
