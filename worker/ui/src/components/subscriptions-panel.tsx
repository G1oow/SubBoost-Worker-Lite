import * as React from "react";
import {
  Check,
  Copy,
  KeyRound,
  Link2,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  Smartphone,
  Trash2,
} from "lucide-react";
import { Icon } from "@subboost/ui/components/ui/icon";
import { Badge } from "@subboost/ui/components/ui/badge";
import { Button } from "@subboost/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@subboost/ui/components/ui/card";
import { EmptyState } from "@subboost/ui/components/ui/empty-state";
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
import { LoadingButton } from "@subboost/ui/motion/loading-button";
import { copyTextToClipboard } from "@subboost/ui/lib/clipboard";
import { cn } from "@subboost/ui/lib/utils";
import type { AppState, ChainOption, SubscriptionDto } from "../lib/types";
import { SubscriptionAgeDialog } from "./subscription-age-dialog";
import { SubscriptionImportDialog } from "./subscription-import-dialog";
import { SubscriptionShareDialog } from "./subscription-share-dialog";

export type SubscriptionUpdatePatch = {
  name?: string;
  sourceIds?: string[];
  chainIds?: string[];
};

export type SubscriptionsPanelProps = {
  state: AppState;
  /** 可勾选的链：链在订阅里就是一个源 */
  chains?: ChainOption[];
  onCreate: (input: { name: string; sourceIds: string[]; chainIds: string[] }) => Promise<void>;
  onRotate: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** 修改已创建订阅的名称与所含源/链（链接不变） */
  onUpdate?: (id: string, patch: SubscriptionUpdatePatch) => Promise<void>;
  /** 为订阅生成短链（已有短链时幂等返回同一条） */
  onCreateShortLink?: (id: string) => Promise<void>;
  /** 撤销订阅短链，原 token 链接不受影响 */
  onRevokeShortLink?: (id: string) => Promise<void>;
};

/**
 * 订阅可能仍引用已被删除的源：卡片上这些 id 会渲染成「已删除的源」。
 * 它们既不在勾选列表里，也绝不能提交回后端 —— PATCH 会以「源不存在：<id>」直接 400，
 * 用户看到一个看不见的 id 无从下手。这里是唯一剔除它们的地方。
 */
function splitBoundSourceIds(
  sourceIds: string[],
  knownIds: Set<string>
): { selected: string[]; danglingCount: number } {
  const selected: string[] = [];
  let danglingCount = 0;
  for (const id of sourceIds) {
    if (knownIds.has(id)) selected.push(id);
    else danglingCount += 1;
  }
  return { selected, danglingCount };
}
export function SubscriptionsPanel({
  state,
  chains,
  onCreate,
  onRotate,
  onDelete,
  onUpdate,
  onCreateShortLink,
  onRevokeShortLink,
}: SubscriptionsPanelProps) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [selectedChains, setSelectedChains] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  /** 该订阅引用但已被删除的源数量：只用于弹窗提示，不参与提交 */
  const [danglingCount, setDanglingCount] = React.useState(0);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [sharingId, setSharingId] = React.useState<string | null>(null);
  const [importingId, setImportingId] = React.useState<string | null>(null);
  const [ageId, setAgeId] = React.useState<string | null>(null);
  const [shortBusyId, setShortBusyId] = React.useState<string | null>(null);
  const [shortCopiedId, setShortCopiedId] = React.useState<string | null>(null);
  // 由 id 派生而非保存快照，轮换/改名后弹窗自动跟着更新
  const sharing = React.useMemo(
    () => state.subscriptions.find((item) => item.id === sharingId) ?? null,
    [state.subscriptions, sharingId]
  );
  const importing = React.useMemo(
    () => state.subscriptions.find((item) => item.id === importingId) ?? null,
    [state.subscriptions, importingId]
  );
  const ageTarget = React.useMemo(
    () => state.subscriptions.find((item) => item.id === ageId) ?? null,
    [state.subscriptions, ageId]
  );

  /** 现存链的 id 集合：与源一样，用来过滤掉已被删除的引用 */
  const knownChainIds = React.useMemo(
    () => new Set((chains ?? []).map((chain) => chain.id)),
    [chains]
  );
  const chainNameById = React.useMemo(
    () => new Map((chains ?? []).map((chain) => [chain.id, chain.name])),
    [chains]
  );
  const sourceNameById = React.useMemo(
    () => new Map(state.sources.map((source) => [source.id, source.name])),
    [state.sources]
  );
  const knownSourceIds = React.useMemo(
    () => new Set(state.sources.map((source) => source.id)),
    [state.sources]
  );

  const openCreate = () => {
    setEditingId(null);
    setName("");
    setSelected([]);
    setSelectedChains([]);
    setDanglingCount(0);
    setError("");
    setOpen(true);
  };

  const openEdit = (subscription: SubscriptionDto) => {
    const { selected: bound, danglingCount: dangling } = splitBoundSourceIds(
      subscription.sourceIds,
      knownSourceIds
    );
    setEditingId(subscription.id);
    setName(subscription.name);
    // 已删除的源不能进勾选态，否则保存时会把看不见的 id 一起提交
    setSelected(bound);
    // 已删除的链同理：后端会以「链不存在」400
    setSelectedChains(subscription.chainIds.filter((chainId) => knownChainIds.has(chainId)));
    setDanglingCount(dangling);
    setError("");
    setOpen(true);
  };

  const toggleChain = (id: string) => {
    setSelectedChains((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
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
    // 兜底：只提交现存源/链，残留的已删除 id 会让后端 400
    const sourceIds = selected.filter((id) => knownSourceIds.has(id));
    const chainIds = selectedChains.filter((id) => knownChainIds.has(id));
    try {
      if (editingId) {
        if (!onUpdate) {
          setError("当前版本不支持修改订阅。");
          return;
        }
        await onUpdate(editingId, { name: name.trim(), sourceIds, chainIds });
        toast({ variant: "success", title: "已更新订阅", description: "链接保持不变，下次访问即按新源与链生成。" });
      } else {
        await onCreate({ name: name.trim(), sourceIds, chainIds });
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

  /** 卡片上的「生成短链」独立入口：生成成功后 shortLink 出现在同一张卡片上 */
  const handleCreateShortLink = async (subscription: SubscriptionDto) => {
    if (!onCreateShortLink) return;
    setShortBusyId(subscription.id);
    try {
      await onCreateShortLink(subscription.id);
      toast({ variant: "success", title: "已生成短链" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "生成短链失败",
        description: err instanceof Error ? err.message : "生成短链失败",
      });
    } finally {
      setShortBusyId((current) => (current === subscription.id ? null : current));
    }
  };

  const handleCopyShortLink = async (subscription: SubscriptionDto) => {
    if (!subscription.shortLink) return;
    const ok = await copyTextToClipboard(subscription.shortLink);
    if (!ok) {
      toast({ variant: "warning", title: "复制失败", description: "请手动选择短链复制。" });
      return;
    }
    setShortCopiedId(subscription.id);
    window.setTimeout(
      () => setShortCopiedId((current) => (current === subscription.id ? null : current)),
      1500
    );
  };

  const handleRotate = async (subscription: SubscriptionDto) => {
    const confirmed = await confirmDialog({
      title: "轮换订阅 token？",
      description: `「${subscription.name}」的旧链接与短链会立即失效，需要把新链接重新导入客户端。`,
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
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {/*
         * 截断必须落在 Badge 内部的文本容器上：
         * Badge 自身是 inline-flex，把 truncate 直接挂在它身上时 text-overflow
         * 在 flex 容器里各浏览器表现不一致（Chrome 出省略号，Firefox 直接切断），
         * 且 flex item 的 min-width:auto 会让长源名拒绝收缩、把同一行的订阅名挤走。
         */}
        {visible.map((item, index) => (
          <Badge
            key={`${item}-${index}`}
            variant="outline"
            title={item}
            className="min-w-0 max-w-[min(100%,11rem)]"
          >
            <span className="min-w-0 truncate">{item}</span>
          </Badge>
        ))}
        {names.length > visible.length ? (
          <Badge variant="secondary" className="shrink-0">
            +{names.length - visible.length}
          </Badge>
        ) : null}
      </div>
    );
  };

  /** 勾进订阅的链：链在这里就是一个源，带链路图标与「链」标记区别于真实源 */
  const renderBoundChains = (subscription: SubscriptionDto) => {
    if (subscription.chainIds.length === 0) return null;
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {subscription.chainIds.slice(0, 2).map((id) => {
          const label = chainNameById.get(id) ?? "已删除的链";
          return (
            <Badge key={id} variant="outline" title={`链式代理 · ${label}`} className="min-w-0 max-w-[min(100%,11rem)]">
              <Icon icon={Link2} size="xs" className="shrink-0 text-fg-45" />
              <span className="min-w-0 truncate">{label}</span>
            </Badge>
          );
        })}
        {subscription.chainIds.length > 2 ? (
          <Badge variant="secondary" className="shrink-0">
            +{subscription.chainIds.length - 2}
          </Badge>
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
          <Icon icon={Plus} />
          创建订阅
        </Button>
      </CardHeader>
      <CardContent>
        {state.sources.length === 0 ? (
          <EmptyState className="animate-fade-in-up" icon={<Icon icon={Link2} size="xl" />}>
            请先添加源，再创建订阅链接。
          </EmptyState>
        ) : state.subscriptions.length === 0 ? (
          <EmptyState>还没有订阅，点击「创建订阅」生成一条链接。</EmptyState>
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
                <div className="flex flex-col gap-2 rounded-xl border border-card-border bg-surface px-3 py-3 transition-[border-color,background-color] duration-200 hover:border-card-border-hover hover:bg-ink/[0.03] sm:flex-row sm:items-center sm:gap-3 sm:px-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {/* 名称自己可收缩：长名称先让位，而不是把源名胶囊挤出可视区 */}
                      <span className="min-w-0 max-w-full truncate text-sm font-medium text-fg">
                        {subscription.name}
                      </span>
                      {renderBoundSources(subscription)}
                      {renderBoundChains(subscription)}
                    </div>
                    {/* 链接单占一行：表格里被压成一列，前缀都读不全 */}
                    <p className="truncate font-mono text-2xs text-fg-45" title={subscription.link}>
                      {subscription.link}
                    </p>
                    {/* 短链独立成一个按钮：不翻弹窗也能生成，生成后短码直接显示在这一行 */}
                    {onCreateShortLink ? (
                      subscription.shortLink ? (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="flex min-w-0 items-center gap-1 text-2xs text-fg-60">
                            <Icon icon={Link2} size="xs" className="shrink-0 text-fg-45" />
                            <span
                              className="select-all break-all font-mono"
                              title={subscription.shortLink}
                            >
                              短链 {subscription.shortLink}
                            </span>
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopyShortLink(subscription)}
                          >
                            <Icon icon={shortCopiedId === subscription.id ? Check : Copy} />
                            {shortCopiedId === subscription.id ? "已复制" : "复制短链"}
                          </Button>
                        </div>
                      ) : (
                        <div>
                          <LoadingButton
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => handleCreateShortLink(subscription)}
                            loading={shortBusyId === subscription.id}
                            loadingLabel="生成中…"
                          >
                            <Icon icon={Link2} />
                            生成短链
                          </LoadingButton>
                        </div>
                      )
                    ) : null}
                  </div>
                  {/* 窄屏七个图标也要能换行：一键导入 / age 加密放在二维码左边 */}
                  <div className="flex shrink-0 flex-wrap items-center gap-1 self-end sm:self-auto">
                    <IconButton
                      label={`一键导入 ${subscription.name}`}
                      variant="ghost"
                      onClick={() => setImportingId(subscription.id)}
                    >
                      <Icon icon={Smartphone} />
                    </IconButton>
                    <IconButton
                      label={`${subscription.name} 的 age 加密订阅`}
                      variant="ghost"
                      onClick={() => setAgeId(subscription.id)}
                    >
                      <Icon icon={KeyRound} />
                    </IconButton>
                    <IconButton
                      label={`分享 ${subscription.name} 二维码`}
                      variant="ghost"
                      onClick={() => setSharingId(subscription.id)}
                    >
                      <Icon icon={QrCode} />
                    </IconButton>
                    <IconButton
                      label={`复制 ${subscription.name} 链接`}
                      variant="ghost"
                      onClick={() => handleCopy(subscription)}
                    >
                      <Icon
                        icon={Check}
                        className={cn(
                          copiedId === subscription.id ? "animate-icon-pop text-success-note-fg" : "hidden"
                        )}
                      />
                      <Icon
                        icon={Copy}
                        className={cn(copiedId === subscription.id ? "hidden" : undefined)}
                      />
                    </IconButton>
                    {onUpdate ? (
                      <IconButton
                        label={`修改 ${subscription.name} 的源`}
                        variant="ghost"
                        onClick={() => openEdit(subscription)}
                      >
                        <Icon icon={Pencil} />
                      </IconButton>
                    ) : null}
                    <IconButton
                      label={`轮换 ${subscription.name} token`}
                      variant="ghost"
                      onClick={() => handleRotate(subscription)}
                    >
                      <Icon icon={RefreshCw} />
                    </IconButton>
                    <IconButton
                      label={`删除 ${subscription.name}`}
                      variant="ghost"
                      onClick={() => handleDelete(subscription)}
                    >
                      <Icon icon={Trash2} />
                    </IconButton>
                  </div>
                </div>
              </MotionItem>
            ))}
          </MotionList>
        )}
      </CardContent>

      <SubscriptionShareDialog
        subscription={sharing}
        onClose={() => setSharingId(null)}
        onCreateShortLink={
          onCreateShortLink && sharing ? () => onCreateShortLink(sharing.id) : undefined
        }
        onRevokeShortLink={
          onRevokeShortLink && sharing ? () => onRevokeShortLink(sharing.id) : undefined
        }
        age={state.capabilities?.age}
      />

      <SubscriptionImportDialog
        subscription={importing}
        onClose={() => setImportingId(null)}
        ageOnly={state.capabilities?.age?.only === true}
      />

      <SubscriptionAgeDialog
        subscription={ageTarget}
        onClose={() => setAgeId(null)}
        age={state.capabilities?.age}
      />

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
              {editingId && danglingCount > 0 ? (
                <p className="text-xs text-warning-note-fg" role="status">
                  该订阅还挂着 {danglingCount} 个已被删除的源（下方列表不再显示它们），保存后会自动移除。
                </p>
              ) : null}
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
                          "flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition-[border-color,background-color,color] duration-200",
                          checked
                            ? "border-primary-500/50 bg-primary-500/20 text-fg"
                            : "border-ink/10 bg-ink/5 text-fg-70 hover:border-ink/20 hover:bg-ink/10"
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
                            {checked ? <Icon icon={Check} size="xs" className="text-fg" /> : null}
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

            {/* 链式代理：建好的链在这里就是一个源，只有勾选它的订阅才生成 */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-fg-80">链式代理（节点）</p>
              <p className="text-xs text-fg-45">
                链在配置里就是一个节点，勾选后整条链会生成到这条订阅里；没勾的链不会出现。
              </p>
              {(chains ?? []).length === 0 ? (
                <p className="text-xs text-fg-45">还没有链式代理，去「生成配置 → 链式代理」创建。</p>
              ) : (
                <div className="grid gap-2">
                  {(chains ?? []).map((chain) => {
                    const checked = selectedChains.includes(chain.id);
                    return (
                      <button
                        key={chain.id}
                        type="button"
                        onClick={() => toggleChain(chain.id)}
                        aria-pressed={checked}
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition-[border-color,background-color,color] duration-200",
                          checked
                            ? "border-primary-500/50 bg-primary-500/20 text-fg"
                            : "border-ink/10 bg-ink/5 text-fg-70 hover:border-ink/20 hover:bg-ink/10"
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            aria-hidden="true"
                            className={cn(
                              "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                              checked ? "border-primary-500 bg-primary-500/70" : "border-ink/25"
                            )}
                          >
                            {checked ? <Icon icon={Check} size="xs" className="text-fg" /> : null}
                          </span>
                          <Icon icon={Link2} size="xs" className="shrink-0 text-fg-45" />
                          <span className="min-w-0 truncate">{chain.name || "（未命名链）"}</span>
                        </span>
                        <span className="shrink-0 text-xs text-fg-45">
                          {chain.enabled ? "链式代理" : "链式代理 · 已停用"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {error ? (
              <p className="text-sm text-danger-note-fg" role="alert">
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
