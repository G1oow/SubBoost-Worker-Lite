import * as React from "react";
import { Check, Copy, Link2, Pencil, Plus, QrCode, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@subboost/ui/components/ui/badge";
import { Button } from "@subboost/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@subboost/ui/components/ui/card";
import { confirmDialog } from "@subboost/ui/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@subboost/ui/components/ui/dialog";
import { FormField } from "@subboost/ui/components/ui/form-field";
import { IconButton } from "@subboost/ui/components/ui/icon-button";
import { Input } from "@subboost/ui/components/ui/input";
import { useToast } from "@subboost/ui/components/ui/toaster";
import { MotionItem, MotionList } from "@subboost/ui/motion/motion-list";
import { copyTextToClipboard } from "@subboost/ui/lib/clipboard";
import { cn } from "@subboost/ui/lib/utils";
import type { AppState, SubscriptionDto } from "../lib/types";
import { SubscriptionShareDialog } from "./subscription-share-dialog";

export type SubscriptionUpdatePatch = {
  name?: string;
  sourceIds?: string[];
};

export type SubscriptionsPanelProps = {
  state: AppState;
  onCreate: (input: { name: string; sourceIds: string[] }) => Promise<void>;
  onRotate: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** 修改已创建订阅的名称与所含源（链接不变） */
  onUpdate?: (id: string, patch: SubscriptionUpdatePatch) => Promise<void>;
};

export function SubscriptionsPanel({
  state,
  onCreate,
  onRotate,
  onDelete,
  onUpdate,
}: SubscriptionsPanelProps) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [sharingId, setSharingId] = React.useState<string | null>(null);
  // 由 id 派生而非保存快照，轮换/改名后弹窗自动跟着更新
  const sharing = React.useMemo(
    () => state.subscriptions.find((item) => item.id === sharingId) ?? null,
    [state.subscriptions, sharingId]
  );

  const sourceNameById = React.useMemo(
    () => new Map(state.sources.map((source) => [source.id, source.name])),
    [state.sources]
  );

  const openCreate = () => {
    setEditingId(null);
    setName("");
    setSelected([]);
    setError("");
    setOpen(true);
  };

  const openEdit = (subscription: SubscriptionDto) => {
    setEditingId(subscription.id);
    setName(subscription.name);
    setSelected(subscription.sourceIds);
    setError("");
    setOpen(true);
  };

  const toggleSource = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("请填写订阅名称");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        if (!onUpdate) {
          setError("当前版本不支持修改订阅。");
          return;
        }
        await onUpdate(editingId, { name: name.trim(), sourceIds: selected });
        toast({ variant: "success", title: "已更新订阅", description: "链接保持不变，下次访问即按新源生成。" });
      } else {
        await onCreate({ name: name.trim(), sourceIds: selected });
        toast({ variant: "success", title: "已创建订阅" });
      }
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async (subscription: SubscriptionDto) => {
    const ok = await copyTextToClipboard(subscription.link);
    if (!ok) {
      toast({ variant: "warning", title: "复制失败", description: "请手动选择链接复制。" });
      return;
    }
    setCopiedId(subscription.id);
    window.setTimeout(() => setCopiedId((current) => (current === subscription.id ? null : current)), 1500);
  };

  const handleRotate = async (subscription: SubscriptionDto) => {
    const confirmed = await confirmDialog({
      title: "轮换订阅 token？",
      description: `「${subscription.name}」的旧链接会立即失效，需要把新链接重新导入客户端。`,
      confirmText: "轮换",
      variant: "warning",
    });
    if (!confirmed) return;
    try {
      await onRotate(subscription.id);
      toast({ variant: "success", title: "已轮换 token" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "轮换失败",
        description: err instanceof Error ? err.message : "轮换失败",
      });
    }
  };

  const handleDelete = async (subscription: SubscriptionDto) => {
    const confirmed = await confirmDialog({
      title: "删除订阅？",
      description: `删除「${subscription.name}」后其订阅链接立即失效，且不可恢复。`,
      confirmText: "删除",
      variant: "destructive",
    });
    if (!confirmed) return;
    try {
      await onDelete(subscription.id);
      toast({ variant: "success", title: "已删除订阅" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "删除失败",
        description: err instanceof Error ? err.message : "删除失败",
      });
    }
  };

  const renderBoundSources = (subscription: SubscriptionDto) => {
    if (subscription.sourceIds.length === 0) {
      return <Badge variant="secondary">全部启用源</Badge>;
    }
    const names = subscription.sourceIds.map((id) => sourceNameById.get(id) ?? "已删除的源");
    const visible = names.slice(0, 2);
    return (
      <div className="flex flex-wrap items-center gap-1">
        {visible.map((item, index) => (
          <Badge key={`${item}-${index}`} variant="outline" className="max-w-[120px] truncate">
            {item}
          </Badge>
        ))}
        {names.length > visible.length ? (
          <Badge variant="secondary">+{names.length - visible.length}</Badge>
        ) : null}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="space-y-1">
          <CardTitle>订阅链接</CardTitle>
          <p className="text-xs text-fg-45">随时修改名称或所含源，链接本身不会变化。</p>
        </div>
        <Button
          onClick={openCreate}
          disabled={state.sources.length === 0}
          className="w-full shrink-0 sm:w-auto"
        >
          <Plus aria-hidden="true" />
          创建订阅
        </Button>
      </CardHeader>
      <CardContent>
        {state.sources.length === 0 ? (
          <div className="animate-fade-in-up rounded-xl border border-dashed border-ink/15 px-4 py-10 text-center">
            <Link2 aria-hidden="true" className="mx-auto mb-2 h-6 w-6 text-fg-35" />
            <p className="text-sm text-fg-50">请先添加源，再创建订阅链接。</p>
          </div>
        ) : state.subscriptions.length === 0 ? (
          <p className="text-sm text-fg-50">还没有订阅，点击「创建订阅」生成一条链接。</p>
        ) : (
          /*
           * 与「源管理」保持一致：每条订阅是一张独立卡片，而不是表格行。
           * 表格的列宽由算法强制对齐，链接这种长度不定的内容会把「操作」列
           * 推得很远；卡片里链接单独占一行，能完整读到前缀，操作也贴在固定位置。
           */
          <MotionList as="ul" className="space-y-2.5" animateOnMount>
            {state.subscriptions.map((subscription) => (
              <MotionItem as="li" key={subscription.id} itemKey={subscription.id}>
                {/* 窄屏把五个操作收到第二行并贴右：一行放不下名称 + 链接 + 五个图标 */}
                <div className="flex flex-col gap-2 rounded-xl border border-card-border bg-surface px-3 py-3 transition-[border-color,box-shadow] duration-200 hover:border-card-border-hover hover:shadow-(--card-shadow-hover) sm:flex-row sm:items-center sm:gap-3 sm:px-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-fg">{subscription.name}</span>
                      {renderBoundSources(subscription)}
                    </div>
                    {/* 链接单占一行：表格里被压成一列，前缀都读不全 */}
                    <p className="truncate font-mono text-[11px] text-fg-45" title={subscription.link}>
                      {subscription.link}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
                    <IconButton
                      label={`分享 ${subscription.name} 二维码`}
                      variant="ghost"
                      onClick={() => setSharingId(subscription.id)}
                    >
                      <QrCode aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      label={`复制 ${subscription.name} 链接`}
                      variant="ghost"
                      onClick={() => handleCopy(subscription)}
                    >
                      <Check
                        aria-hidden="true"
                        className={cn(
                          copiedId === subscription.id ? "animate-icon-pop text-emerald-400" : "hidden"
                        )}
                      />
                      <Copy
                        aria-hidden="true"
                        className={cn(copiedId === subscription.id ? "hidden" : undefined)}
                      />
                    </IconButton>
                    {onUpdate ? (
                      <IconButton
                        label={`修改 ${subscription.name} 的源`}
                        variant="ghost"
                        onClick={() => openEdit(subscription)}
                      >
                        <Pencil aria-hidden="true" />
                      </IconButton>
                    ) : null}
                    <IconButton
                      label={`轮换 ${subscription.name} token`}
                      variant="ghost"
                      onClick={() => handleRotate(subscription)}
                    >
                      <RefreshCw aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      label={`删除 ${subscription.name}`}
                      variant="ghost"
                      onClick={() => handleDelete(subscription)}
                    >
                      <Trash2 aria-hidden="true" />
                    </IconButton>
                  </div>
                </div>
              </MotionItem>
            ))}
          </MotionList>
        )}
      </CardContent>

      <SubscriptionShareDialog subscription={sharing} onClose={() => setSharingId(null)} />

      <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "修改订阅" : "创建订阅"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormField label="名称" required>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：默认订阅"
              />
            </FormField>

            <div className="space-y-2">
              <p className="text-sm font-medium text-fg-80">绑定源</p>
              <p className="text-xs text-fg-45">
                不选择任何源表示使用全部启用源；勾选后只聚合这些源。
              </p>
              {/* 勾选/取消只是改变高亮，不需要进离场动画；FLIP 负责重排 */}
              <MotionList as="div" className="grid gap-2" mode="sync">
                {state.sources.map((source) => {
                  const checked = selected.includes(source.id);
                  return (
                    <MotionItem as="div" key={source.id} itemKey={source.id}>
                      <button
                        type="button"
                        onClick={() => toggleSource(source.id)}
                        aria-pressed={checked}
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition-all duration-200",
                          checked
                            ? "border-primary-500/50 bg-primary-500/20 text-fg"
                            : "border-ink/10 bg-ink/5 text-fg-70 hover:-translate-y-px hover:bg-ink/10"
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className={cn(
                              "flex h-4 w-4 items-center justify-center rounded border transition-colors",
                              checked ? "border-primary-500 bg-primary-500/70" : "border-ink/25"
                            )}
                          >
                            {checked ? <Check className="h-3 w-3 text-fg" /> : null}
                          </span>
                          {source.name}
                        </span>
                        <span className="text-xs text-fg-45">
                          {source.kind === "remote" ? "远程" : "手动"}
                          {source.enabled ? "" : " · 已停用"}
                        </span>
                      </button>
                    </MotionItem>
                  );
                })}
              </MotionList>
            </div>

            {error ? (
              <p className="text-sm text-red-400" role="alert">
                {error}
              </p>
            ) : null}

            <DialogFooter className="gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "保存中…" : editingId ? "保存修改" : "创建"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
