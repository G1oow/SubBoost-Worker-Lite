import * as React from "react";
import { KeyRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@subboost/ui/components/ui/dialog";
import { Icon } from "@subboost/ui/components/ui/icon";
import { useToast } from "@subboost/ui/components/ui/toaster";
import { copyTextToClipboard } from "@subboost/ui/lib/clipboard";
import { buildAgeLinks } from "../lib/share-links";
import type { AgeCapabilities, SubscriptionDto } from "../lib/types";
import {
  AgeMisconfiguredNotice,
  AgeOnlyNotice,
  AgeSection,
  AgeSetupHint,
} from "./subscription-share-sections";

export type SubscriptionAgeDialogProps = {
  /** 为 null 时弹窗关闭 */
  subscription: SubscriptionDto | null;
  onClose: () => void;
  /** age 加密通道能力；未配置时弹窗里给配置指引 */
  age?: AgeCapabilities;
};

/** 卡片上的「age 加密」按钮对应的弹窗：加密链接 + 复制 + 解密说明 */
export function SubscriptionAgeDialog({
  subscription,
  onClose,
  age,
}: SubscriptionAgeDialogProps) {
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

  const link = subscription?.shortLink ?? subscription?.link ?? "";

  const handleCopy = async () => {
    if (!subscription) return;
    const ok = await copyTextToClipboard(buildAgeLinks(link).binary);
    if (!ok) {
      toast({ variant: "warning", title: "复制失败", description: "请手动选择加密链接复制。" });
      return;
    }
    setCopied(true);
  };

  return (
    <Dialog open={subscription !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon icon={KeyRound} size="md" className="text-fg-60" />
            age 加密订阅
          </DialogTitle>
        </DialogHeader>

        {subscription ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-fg">{subscription.name}</p>

            {age?.misconfigured ? <AgeMisconfiguredNotice /> : null}
            {age?.only ? <AgeOnlyNotice /> : null}

            {age?.enabled ? (
              <AgeSection link={link} age={age} copied={copied} onCopy={handleCopy} />
            ) : (
              <AgeSetupHint />
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
