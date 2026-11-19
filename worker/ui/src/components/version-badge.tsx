import * as React from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@subboost/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@subboost/ui/components/ui/dialog";
import { Icon } from "@subboost/ui/components/ui/icon";
import { cn } from "@subboost/ui/lib/utils";
import type { UpdateNotice } from "../lib/update-notice";

/**
 * 页头的版本徽章。
 *
 * 没有新版本时就是一行静态文字；检测到新版本时变成可点的按钮，右上角点红点，
 * 点开是一张小卡片：去哪儿更新、或者忽略这个版本。
 *
 * 窄屏隐藏（`hidden sm:inline-block`）是既有约定：375px 下标题与三个操作按钮已经
 * 占满一行，再塞一个徽章会把标题挤成省略号。红点因此只在 ≥sm 可见。
 */

/** 徽章外观：静态徽章与按钮共用，保证两种状态下尺寸一致 */
const BADGE_CLASS =
  "hidden shrink-0 rounded-full border border-ink/10 bg-ink/5 px-2 py-0.5 text-2xs text-fg-45 sm:inline-block";

export type VersionBadgeProps = {
  version: string;
  /** 检测到新版本时传入；为空表示没有可提示的更新 */
  update?: UpdateNotice | null;
  /** 用户点了「忽略此版本」 */
  onDismiss?: (latestVersion: string) => void;
};

export function VersionBadge({ version, update, onDismiss }: VersionBadgeProps) {
  const [open, setOpen] = React.useState(false);

  if (!update) {
    return <span className={BADGE_CLASS}>v{version}</span>;
  }

  const dismiss = () => {
    onDismiss?.(update.latestVersion);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`发现新版本 v${update.latestVersion}`}
        aria-label={`当前版本 v${version}，发现新版本 v${update.latestVersion}，查看详情`}
        className={cn(
          BADGE_CLASS,
          "relative transition-colors hover:border-ink/20 hover:text-fg-60",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        )}
      >
        v{version}
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-update-dot ring-2 ring-page"
        />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>发现新版本 v{update.latestVersion}</DialogTitle>
            <DialogDescription>
              当前运行的是 v{version}，仓库里已经发布了 v{update.latestVersion}。
            </DialogDescription>
          </DialogHeader>
          <p className="text-xs leading-relaxed text-fg-45">
            更新方式是重新拉取仓库并部署（推送即自动部署的实例从 GitHub 重新构建即可）。
            忽略后只在出现更新的版本时再次提示。
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={dismiss}>
              忽略此版本
            </Button>
            <Button asChild>
              <a href={update.releaseUrl} target="_blank" rel="noreferrer noopener">
                <Icon icon={ExternalLink} />
                前往 GitHub
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
