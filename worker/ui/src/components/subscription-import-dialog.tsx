import * as React from "react";
import { Check, Copy, Smartphone } from "lucide-react";
import { Button } from "@subboost/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@subboost/ui/components/ui/dialog";
import { Icon } from "@subboost/ui/components/ui/icon";
import { useToast } from "@subboost/ui/components/ui/toaster";
import { copyTextToClipboard } from "@subboost/ui/lib/clipboard";
import type { SubscriptionDto } from "../lib/types";
import { AgeOnlyNotice, ImportLinksSection } from "./subscription-share-sections";

export type SubscriptionImportDialogProps = {
  /** 为 null 时弹窗关闭 */
  subscription: SubscriptionDto | null;
  onClose: () => void;
  /** 实例只输出 age 密文时，一键导入没有意义，直接给提示 */
  ageOnly?: boolean;
};

/** 卡片上的「一键导入」按钮对应的弹窗：列客户端深链，手机上点一下就能导入 */
export function SubscriptionImportDialog({
  subscription,
  onClose,
  ageOnly = false,
}: SubscriptionImportDialogProps) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    setCopied(false);
  }, [subscription?.id]);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  // 与分享弹窗一致：有短链时以短链为准
  const link = subscription?.shortLink ?? subscription?.link ?? "";

  const handleCopy = async () => {
    if (!subscription) return;
    const ok = await copyTextToClipboard(link);
    if (!ok) {
      toast({ variant: "warning", title: "复制失败", description: "请手动选择链接复制。" });
      return;
    }
    setCopied(true);
  };

  return (
    <Dialog open={subscription !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon icon={Smartphone} size="md" className="text-fg-60" />
            一键导入
          </DialogTitle>
        </DialogHeader>

        {subscription ? (
          <div className="space-y-4">
            <p className="text-sm font-medium text-fg">{subscription.name}</p>
            {ageOnly ? (
              <AgeOnlyNotice />
            ) : (
              <>
                <ImportLinksSection link={link} heading={false} />
                <DialogFooter className="flex-col gap-2 sm:flex-row">
                  <Button type="button" onClick={handleCopy} className="w-full sm:w-auto">
                    {copied ? (
                      <Icon icon={Check} className="animate-icon-pop text-success-note-fg" />
                    ) : (
                      <Icon icon={Copy} />
                    )}
                    {copied ? "已复制" : "复制链接"}
                  </Button>
                </DialogFooter>
              </>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
