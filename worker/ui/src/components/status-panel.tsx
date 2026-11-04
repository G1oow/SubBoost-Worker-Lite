import * as React from "react";
import { CircleAlert, CircleCheck, Clock, RefreshCw, TriangleAlert } from "lucide-react";
import { Icon } from "@subboost/ui/components/ui/icon";
import { Card, CardContent, CardHeader, CardTitle } from "@subboost/ui/components/ui/card";
import { LoadingButton } from "@subboost/ui/motion/loading-button";
import { GrowBar } from "@subboost/ui/motion/grow-bar";
import { MotionItem, MotionList } from "@subboost/ui/motion/motion-list";
import { cn } from "@subboost/ui/lib/utils";
import { useToast } from "@subboost/ui/components/ui/toaster";
import { formatDateTime, formatDuration, formatRelativeTime } from "../lib/format";
import { buildRefreshBoard, type RefreshEntry, type RefreshTone } from "../lib/refresh-board";
import type { AppState } from "../lib/types";

export type StatusPanelProps = {
  state: AppState;
  onRefresh: () => Promise<void>;
  refreshing: boolean;
};

/** 结论条的外观：颜色全部来自主题令牌，明暗两套都成立 */
const TONE_STYLE: Record<RefreshTone, { box: string; icon: React.ReactNode }> = {
  ok: {
    box: "border-emerald-500/30 bg-emerald-500/10",
    icon: <Icon icon={CircleCheck} size="lg" className="text-emerald-400" />,
  },
  warn: {
    box: "border-amber-500/30 bg-amber-500/10",
    icon: <Icon icon={TriangleAlert} size="lg" className="text-amber-400" />,
  },
  error: {
    box: "border-red-500/30 bg-red-500/10",
    icon: <Icon icon={CircleAlert} size="lg" className="text-red-400" />,
  },
  idle: {
    box: "border-ink/10 bg-ink/5",
    icon: <Icon icon={Clock} size="lg" className="text-fg-40" />,
  },
};

/** 顶部 KPI 小格 */
function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-card-border bg-surface px-3 py-2.5">
      <p className="text-[11px] text-fg-50">{label}</p>
      <p className="mt-1 truncate text-base font-semibold leading-none tabular-nums text-fg sm:text-lg">{value}</p>
      {hint ? <p className="mt-1 truncate text-[11px] tabular-nums text-fg-40">{hint}</p> : null}
    </div>
  );
}


/**
 * 一条结果：状态点 + 名称 + 占比，下面一条增长条。
 *
 * 条上不再骑节点数：占比已经在行右侧，节点总数在顶部指标格里，
 * 条只需要表达"这一项占多少"，数字贴上去反而让条与文字互相挤压。
 */
function EntryRow({ entry }: { entry: RefreshEntry }) {
  return (
    <MotionItem as="li" itemKey={`${entry.kind}-${entry.id}`}>
      <div
        className={cn(
          "rounded-xl border px-3 pb-2.5 pt-2.5 transition-[border-color,background-color] duration-200",
          entry.ok ? "border-ink/10 bg-ink/[0.03]" : "border-red-500/30 bg-red-500/10"
        )}
      >
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", entry.ok ? "bg-emerald-400" : "bg-red-400")}
          />
          <span className="min-w-0 flex-1 truncate text-sm text-fg-80">{entry.name}</span>
          <span className="shrink-0 text-xs tabular-nums text-fg-50">{entry.share}%</span>
        </div>

        <GrowBar
          className="mt-3"
          percent={entry.share}
          count={entry.nodeCount}
          fillClassName={entry.ok ? "bg-gradient-to-r from-primary-500 to-indigo-400" : "bg-red-400"}
        />

        {entry.error ? (
          <p className="mt-2 break-words text-[11px] leading-relaxed text-red-300">{entry.error}</p>
        ) : null}
      </div>
    </MotionItem>
  );
}
function EntryGroup({ title, entries }: { title: string; entries: RefreshEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-fg-60">{title}</p>
        <span className="text-[11px] tabular-nums text-fg-40">{entries.length} 项</span>
      </div>
      <MotionList as="ul" className="space-y-2" animateOnMount>
        {entries.map((entry) => (
          <EntryRow key={`${entry.kind}-${entry.id}`} entry={entry} />
        ))}
      </MotionList>
    </div>
  );
}


export function StatusPanel({ state, onRefresh, refreshing }: StatusPanelProps) {
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
          <p className="text-sm text-fg-50">还没有刷新记录，点击「立即刷新」抓取上游节点。</p>
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

            <EntryGroup title="源" entries={board.sources} />
            <EntryGroup title="订阅" entries={board.subscriptions} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
