import * as React from "react";
import { CircleAlert, CircleCheck, Clock, RefreshCw, TriangleAlert } from "lucide-react";
import { Icon } from "@subboost/ui/components/ui/icon";
import { EmptyState } from "@subboost/ui/components/ui/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@subboost/ui/components/ui/card";
import { LoadingButton } from "@subboost/ui/motion/loading-button";
import { GrowBar } from "@subboost/ui/motion/grow-bar";
import { cn } from "@subboost/ui/lib/utils";
import { useToast } from "@subboost/ui/components/ui/toaster";
import { SortableHandle, SortableItem, SortableList } from "@subboost/ui/components/ui/sortable-list";
import { mergeReorder, orderRefreshEntries } from "../lib/order-entries";
import { formatDateTime, formatDuration, formatRelativeTime } from "../lib/format";
import { buildRefreshBoard, type RefreshEntry, type RefreshTone } from "../lib/refresh-board";
import type { AppState } from "../lib/types";

export type StatusPanelProps = {
  state: AppState;
  onRefresh: () => Promise<void>;
  refreshing: boolean;
  onReorderSources?: (ids: string[]) => Promise<void>;
  onReorderSubscriptions?: (ids: string[]) => Promise<void>;
};

/** 结论条的外观：颜色全部来自主题令牌，明暗两套都成立 */
const TONE_STYLE: Record<RefreshTone, { box: string; icon: React.ReactNode }> = {
  ok: {
    box: "border-success-note-border bg-success-note-bg",
    icon: <Icon icon={CircleCheck} size="lg" className="text-success-note-fg" />,
  },
  warn: {
    box: "border-warning-note-border bg-warning-note-bg",
    icon: <Icon icon={TriangleAlert} size="lg" className="text-warning-note-fg" />,
  },
  error: {
    box: "border-danger-note-border bg-danger-note-bg",
    icon: <Icon icon={CircleAlert} size="lg" className="text-danger-note-fg" />,
  },
  idle: {
    box: "border-ink/10 bg-ink/5",
    icon: <Icon icon={Clock} size="lg" className="text-fg-45" />,
  },
};

/** 顶部 KPI 小格 */
function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-card-border bg-surface px-3 py-2.5">
      <p className="text-2xs text-fg-45">{label}</p>
      <p className="mt-1 truncate text-base font-semibold leading-none tabular-nums text-fg sm:text-lg">{value}</p>
      {hint ? <p className="mt-1 truncate text-2xs tabular-nums text-fg-45">{hint}</p> : null}
    </div>
  );
}


/**
 * 一条结果：状态点 + 名称 + 占比，下面一条增长条。
 *
 * 条上不再骑节点数：占比已经在行右侧，节点总数在顶部指标格里，
 * 条只需要表达"这一项占多少"，数字贴上去反而让条与文字互相挤压。
 */
function EntryRow({ entry, disabled = false }: { entry: RefreshEntry; disabled?: boolean }) {
  return (
    <SortableItem id={entry.id} label={entry.name} disabled={disabled}>
      <div
        className={cn(
          "group rounded-xl border py-2.5 pl-9 pr-3 transition-[border-color,background-color] duration-200",
          entry.ok ? "border-ink/10 bg-ink/[0.03]" : "border-danger-note-border bg-danger-note-bg"
        )}
      >
        <SortableHandle />
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", entry.ok ? "bg-emerald-400" : "bg-red-400")}
          />
          <span className="min-w-0 flex-1 truncate text-sm text-fg-80">{entry.name}</span>
          <span className="shrink-0 text-xs tabular-nums text-fg-45">{entry.share}%</span>
        </div>

        <GrowBar
          className="mt-3"
          percent={entry.share}
          count={entry.nodeCount}
          fillClassName={entry.ok ? "bg-gradient-to-r from-primary-500 to-indigo-400" : "bg-red-400"}
        />

        {entry.error ? (
          <p className="mt-2 break-words text-2xs leading-relaxed text-danger-note-fg">{entry.error}</p>
        ) : null}
      </div>
    </SortableItem>
  );
}
function EntryGroup({ title, entries, onReorder }: { title: string; entries: RefreshEntry[]; onReorder?: (ids: string[]) => Promise<void> }) {
  const { toast } = useToast();
  const [saving, setSaving] = React.useState(false);
  const [orderedIds, setOrderedIds] = React.useState<string[] | null>(null);
  const entryIds = entries.map((entry) => entry.id);
  const visibleIds = orderedIds && orderedIds.length === entryIds.length && orderedIds.every((id) => entryIds.includes(id))
    ? orderedIds : entryIds;
  const visibleEntries = visibleIds.map((id) => entries.find((entry) => entry.id === id)!);
  const reorder = async (ids: string[]) => {
    if (!onReorder || saving) return;
    setOrderedIds(ids);
    setSaving(true);
    try {
      await onReorder(ids);
    } catch (err) {
      setOrderedIds(null);
      toast({ variant: "destructive", title: "排序保存失败", description: err instanceof Error ? err.message : "请重试" });
    } finally {
      setSaving(false);
    }
  };
  if (entries.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-fg-60">{title}</p>
        <span className="text-2xs tabular-nums text-fg-45">{entries.length} 项</span>
      </div>
      <SortableList ids={visibleIds} onReorder={(ids) => void reorder(ids)} labelOf={(id) => entries.find((entry) => entry.id === id)?.name ?? id} disabled={saving || !onReorder} className="space-y-2">
        {visibleEntries.map((entry) => (
          <EntryRow key={`${entry.kind}-${entry.id}`} entry={entry} disabled={saving || !onReorder || !entries.some((item) => item.id === entry.id)} />
        ))}
      </SortableList>
    </div>
  );
}


export function StatusPanel({ state, onRefresh, refreshing, onReorderSources, onReorderSubscriptions }: StatusPanelProps) {
  const { toast } = useToast();
  const status = state.status;

  const board = React.useMemo(() => {
    const sourceNames = new Map(state.sources.map((source) => [source.id, source.name]));
    const subscriptionNames = new Map(state.subscriptions.map((sub) => [sub.id, sub.name]));
    return buildRefreshBoard(status, {
      source: (id) => sourceNames.get(id),
      subscription: (id) => subscriptionNames.get(id),
    });
  }, [status, state.sources, state.subscriptions]);
  const orderedSources = board ? orderRefreshEntries(board.sources, state.sources.map((source) => source.id)) : [];
  const orderedSubscriptions = board ? orderRefreshEntries(board.subscriptions, state.subscriptions.map((sub) => sub.id)) : [];
  const handleRefresh = async () => {
    try {
      await onRefresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "刷新失败";
      toast({
        variant: message.includes("刷新进行中") ? "warning" : "destructive",
        title: message.includes("刷新进行中") ? "刷新进行中" : "刷新失败",
        description: message,
      });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="space-y-1">
          <CardTitle>刷新状态</CardTitle>
          <p className="text-xs text-fg-45">最近一次刷新各环节的结果与节点占比。</p>
        </div>
        <LoadingButton
          onClick={handleRefresh}
          loading={refreshing}
          loadingLabel="刷新中…"
          className="w-full shrink-0 sm:w-auto"
        >
          <Icon icon={RefreshCw} />
          立即刷新
        </LoadingButton>
      </CardHeader>
      <CardContent className="space-y-4">
        {board === null ? (
          <EmptyState>还没有刷新记录，点击「立即刷新」抓取上游节点。</EmptyState>
        ) : (
          <>
            {/*
              汇总条：结论文字 + 一条按"成功占比"增长的进度条。
              条的百分比 = 成功对象占全部对象的比例，全部成功时满格。
            */}
            <div className={cn("rounded-xl border px-4 py-3", TONE_STYLE[board.tone].box)}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0">{TONE_STYLE[board.tone].icon}</span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-medium text-fg">{board.headline}</p>
                  <p className="break-words text-xs text-fg-60">{board.detail}</p>
                </div>
              </div>
              <GrowBar
                className="mt-3"
                percent={board.total !== 0 ? Math.round((board.okCount / board.total) * 100) : 0}
                count={board.totalNodes}
                fillClassName={
                  board.tone === "error"
                    ? "bg-red-400"
                    : board.tone === "warn"
                      ? "bg-gradient-to-r from-amber-500 to-amber-400"
                      : "bg-gradient-to-r from-primary-500 to-indigo-400"
                }
              />
            </div>

            {/* 窄屏也保持两列：四个 KPI 一屏看完，单列会把看板拉得过长 */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric
                label="最近刷新"
                value={formatRelativeTime(status?.lastRunAt)}
                hint={formatDateTime(status?.lastRunAt)}
              />
              <Metric
                label="触发方式"
                value={status?.lastTrigger === "cron" ? "定时" : "手动"}
                hint="自动刷新每 12 小时"
              />
              <Metric label="耗时" value={formatDuration(status?.durationMs)} hint="本轮抓取与生成" />
              <Metric
                label="节点总数"
                value={String(board.totalNodes)}
                hint={`${board.okCount} 成功 / ${board.failedCount} 失败`}
              />
            </div>
            {/* 刷新记录里可能留着已删除对象：提交前用 mergeReorder 剔除并把现存 id 补全 */}
            <EntryGroup
              title="源"
              entries={orderedSources}
              onReorder={onReorderSources ? (ids) => onReorderSources(mergeReorder(ids, state.sources.map((source) => source.id))) : undefined}
            />
            <EntryGroup
              title="订阅"
              entries={orderedSubscriptions}
              onReorder={onReorderSubscriptions ? (ids) => onReorderSubscriptions(mergeReorder(ids, state.subscriptions.map((sub) => sub.id))) : undefined}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
