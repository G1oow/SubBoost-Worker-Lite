import * as React from "react";
import {
  Activity,
  ArrowRight,
  Boxes,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock,
  Gauge,
  Layers,
  Link2,
  RefreshCw,
  Server,
  Sparkles,
  TriangleAlert,
  Waypoints,
} from "lucide-react";
import { Badge, badgeVariants } from "@subboost/ui/components/ui/badge";
import { Button } from "@subboost/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@subboost/ui/components/ui/card";
import { ProtocolBadge } from "@subboost/ui/components/ui/protocol-badge";
import { MotionItem, MotionList, MotionReveal } from "@subboost/ui/motion/motion-list";
import { SpotlightCard } from "@subboost/ui/motion/spotlight-card";
import { cn } from "@subboost/ui/lib/utils";
import { formatCount, formatDuration, formatPercent, formatRelativeTime } from "../lib/format";
import { useAnimatedNumber } from "../lib/use-animated-number";
import { SourceNodesInline, type SourceNodesLoadState } from "./source-nodes-inline";
import type {
  AppState,
  DashboardSourceStat,
  DashboardStats,
  PageId,
  ProtocolCount,
  SourceNodesResponse,
} from "../lib/types";

export type DashboardPanelProps = {
  state: AppState;
  stats: DashboardStats | null;
  statsLoading?: boolean;
  refreshing?: boolean;
  onRefresh: () => Promise<void>;
  onNavigate: (page: PageId) => void;
  /** 展开「源健康」某一行时读取该源的节点列表 */
  onLoadNodes?: (sourceId: string) => Promise<SourceNodesResponse>;
};

function AnimatedCount({ value, className }: { value: number; className?: string }) {
  const animated = useAnimatedNumber(value);
  return <span className={cn("tabular-nums", className)}>{formatCount(animated)}</span>;
}

function StatCard({
  label,
  value,
  hint,
  icon,
  accent,
  onClick,
  className,
}: {
  label: string;
  value: number;
  hint: React.ReactNode;
  icon: React.ReactNode;
  accent: string;
  onClick?: () => void;
  className?: string;
}) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-fg-50">{label}</p>
        <span aria-hidden="true" className={cn("shrink-0", accent)}>
          {icon}
        </span>
      </div>
      <p className="mt-2.5 text-2xl font-semibold leading-none text-fg sm:mt-3 sm:text-3xl">
        <AnimatedCount value={value} />
      </p>
      <p className="mt-1.5 text-[11px] text-fg-45 sm:mt-2">{hint}</p>
    </>
  );

  return (
    <SpotlightCard className={cn("p-3.5 sm:p-4", className)} data-testid="dashboard-stat-card">
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {content}
        </button>
      ) : (
        content
      )}
    </SpotlightCard>
  );
}

function protocolWidth(item: ProtocolCount, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.max(2, Math.round((item.count / total) * 100))}%`;
}

function buildFallbackSourceStats(state: AppState): DashboardSourceStat[] {
  const statusById = new Map((state.status?.sources ?? []).map((item) => [item.sourceId, item]));
  return state.sources.map((source) => {
    const status = statusById.get(source.id);
    return {
      sourceId: source.id,
      name: source.name,
      kind: source.kind,
      enabled: source.enabled,
      nodeCount: status?.nodeCount ?? 0,
      renamedCount: Object.keys(source.nodeRenames ?? {}).length,
      fetchedAt: null,
      ok: status ? status.ok : null,
      ...(status?.error ? { error: status.error } : {}),
      protocols: [],
    };
  });
}

const MAX_COLLAPSED_SOURCES = 6;

export function DashboardPanel({
  state,
  stats,
  statsLoading = false,
  refreshing = false,
  onRefresh,
  onNavigate,
  onLoadNodes,
}: DashboardPanelProps) {
  const sourceStats = React.useMemo(
    () => stats?.sourceStats ?? buildFallbackSourceStats(state),
    [stats, state]
  );

  const [expandedSourceId, setExpandedSourceId] = React.useState<string | null>(null);
  const [sourceNodes, setSourceNodes] = React.useState<Record<string, SourceNodesLoadState>>({});
  const [showAllSources, setShowAllSources] = React.useState(false);

  const loadSourceNodes = React.useCallback(
    async (sourceId: string) => {
      if (!onLoadNodes) {
        setSourceNodes((current) => ({
          ...current,
          [sourceId]: { status: "error", message: "当前版本不支持读取节点列表。" },
        }));
        return;
      }
      setSourceNodes((current) => ({ ...current, [sourceId]: { status: "loading" } }));
      try {
        const data = await onLoadNodes(sourceId);
        setSourceNodes((current) => ({ ...current, [sourceId]: { status: "ready", data } }));
      } catch (err) {
        setSourceNodes((current) => ({
          ...current,
          [sourceId]: {
            status: "error",
            message: err instanceof Error ? err.message : "加载节点失败",
          },
        }));
      }
    },
    [onLoadNodes]
  );

  // 再点一次同一行就收起；首次展开时才请求节点，之后复用缓存
  const toggleSourceNodes = (sourceId: string) => {
    if (expandedSourceId === sourceId) {
      setExpandedSourceId(null);
      return;
    }
    setExpandedSourceId(sourceId);
    if (!sourceNodes[sourceId]) void loadSourceNodes(sourceId);
  };

  const enabledSources = stats?.sources.enabled ?? state.sources.filter((item) => item.enabled).length;
  const totalSources = stats?.sources.total ?? state.sources.length;
  const remoteSources = stats?.sources.remote ?? state.sources.filter((item) => item.kind === "remote").length;
  const manualSources = stats?.sources.manual ?? state.sources.filter((item) => item.kind === "manual").length;
  const totalSubscriptions = stats?.subscriptions.total ?? state.subscriptions.length;
  const allSourceSubscriptions =
    stats?.subscriptions.allSources ?? state.subscriptions.filter((item) => item.sourceIds.length === 0).length;
  const totalNodes =
    stats?.nodes.total ??
    (state.status?.sources.reduce((sum, item) => sum + (item.nodeCount ?? 0), 0) ?? 0);
  const renamedNodes = stats?.nodes.renamed ?? 0;
  const protocols = stats?.nodes.protocols ?? [];
  const warnings = stats?.warnings ?? [];

  const lastRunAt = stats?.lastRun?.at ?? state.status?.lastRunAt ?? null;
  const lastRunTrigger = stats?.lastRun?.trigger ?? state.status?.lastTrigger ?? null;
  const lastRunDuration = stats?.lastRun?.durationMs ?? state.status?.durationMs ?? null;
  const failedSources = stats?.lastRun?.sourceFailed ?? 0;

  const health =
    warnings.some((item) => item.level === "error")
      ? { label: "需要处理", variant: "destructive" as const }
      : warnings.length > 0
        ? { label: "有提醒", variant: "warning" as const }
        : totalSources === 0
          ? { label: "待配置", variant: "outline" as const }
          : { label: "运行正常", variant: "success" as const };

  const visibleSourceStats = showAllSources
    ? sourceStats
    : sourceStats.slice(0, MAX_COLLAPSED_SOURCES);

  return (
    <div className="space-y-6">
      <SpotlightCard className="animate-rise p-4 sm:p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={health.variant} className="gap-1">
                {health.variant === "success" ? (
                  <CircleCheck aria-hidden="true" className="h-3 w-3" />
                ) : health.variant === "destructive" ? (
                  <CircleAlert aria-hidden="true" className="h-3 w-3" />
                ) : (
                  <Sparkles aria-hidden="true" className="h-3 w-3" />
                )}
                {health.label}
              </Badge>
              <span className="text-xs text-fg-45">{state.app.name}</span>
            </div>
            <h2 className="text-lg font-semibold text-fg sm:text-2xl">
              {enabledSources > 0 ? `${formatCount(enabledSources)} 个源正在供节点` : "先添加一个源开始聚合"}
            </h2>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-50">
              <span className="inline-flex items-center gap-1">
                <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                最近刷新 {formatRelativeTime(lastRunAt)}
              </span>
              {lastRunTrigger ? (
                <span>触发方式：{lastRunTrigger === "cron" ? "定时" : "手动"}</span>
              ) : null}
              <span>耗时 {formatDuration(lastRunDuration)}</span>
              <span>自动刷新：每 12 小时</span>
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Button onClick={() => void onRefresh()} disabled={refreshing} className="w-full sm:w-auto">
              <RefreshCw aria-hidden="true" className={refreshing ? "animate-spin" : undefined} />
              {refreshing ? "刷新中…" : "立即刷新"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => onNavigate("subscriptions")}
              className="w-full sm:w-auto"
            >
              订阅链接
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      </SpotlightCard>

      {/*
        这四张卡固定、不增删也不换序，不需要 Motion 的列表语义。
        改用与页面其他卡片同一套 animate-rise + stagger：
        同为 0.44s / 16px 的 CSS 关键帧，观感才一致。
      */}
      {/* 窄屏两列：四个指标一屏内可对比，滚动距离比单列少一半 */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          className="animate-rise stagger-1"
          label="源"
          value={totalSources}
          icon={<Server className="h-4 w-4" />}
          accent="text-primary-300"
          hint={`${enabledSources} 启用 · ${remoteSources} 远程 / ${manualSources} 手动`}
          onClick={() => onNavigate("sources")}
        />
        <StatCard
          className="animate-rise stagger-2"
          label="订阅链接"
          value={totalSubscriptions}
          icon={<Link2 className="h-4 w-4" />}
          accent="text-indigo-300"
          hint={`${allSourceSubscriptions} 条使用全部启用源`}
          onClick={() => onNavigate("subscriptions")}
        />
        <StatCard
          className="animate-rise stagger-3"
          label="可用节点"
          value={totalNodes}
          icon={<Boxes className="h-4 w-4" />}
          accent="text-emerald-300"
          hint={renamedNodes > 0 ? `${renamedNodes} 个已改名` : "来自启用源的节点快照"}
          onClick={() => onNavigate("sources")}
        />
        <StatCard
          className="animate-rise stagger-4"
          label="刷新失败源"
          value={failedSources}
          icon={<Gauge className="h-4 w-4" />}
          accent={failedSources > 0 ? "text-red-300" : "text-fg-40"}
          hint={failedSources > 0 ? "展开提醒查看错误" : "上次刷新全部成功"}
          onClick={() => onNavigate("status")}
        />
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <Card className="animate-rise">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <Waypoints aria-hidden="true" className="h-4 w-4 text-primary-300" />
                协议分布
              </CardTitle>
              <p className="text-xs text-fg-45">按启用源解析出的节点协议统计</p>
            </div>
            <Badge variant="secondary">{protocols.length} 种</Badge>
          </CardHeader>
          <CardContent>
            {statsLoading && protocols.length === 0 ? (
              <div className="space-y-3">
                {[0, 1, 2, 3].map((index) => (
                  <div key={index} className="skeleton h-8 w-full animate-shimmer" aria-hidden="true" />
                ))}
              </div>
            ) : protocols.length === 0 ? (
              <p className="py-6 text-center text-sm text-fg-45">
                还没有节点数据，刷新一次或等待定时任务抓取。
              </p>
            ) : (
              <MotionList as="ul" className="space-y-3" animateOnMount>
                {protocols.map((item) => (
                  <MotionItem key={item.type} itemKey={item.type} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-2">
                        <ProtocolBadge type={item.type} />
                        <span className="text-fg-60">{formatCount(item.count)} 个节点</span>
                      </span>
                      <span className="text-fg-45">{formatPercent(item.count, totalNodes)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
                      <div
                        className="bar-fill animate-bar-grow h-full rounded-full bg-gradient-to-r from-primary-500 to-indigo-400"
                        style={{ width: protocolWidth(item, totalNodes) }}
                      />
                    </div>
                  </MotionItem>
                ))}
              </MotionList>
            )}
          </CardContent>
        </Card>

        <Card className="animate-rise">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers aria-hidden="true" className="h-4 w-4 text-primary-300" />
                源健康
              </CardTitle>
              <p className="text-xs text-fg-45">节点数与最近一次刷新结果</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onNavigate("sources")}>
              管理源
              <ArrowRight aria-hidden="true" />
            </Button>
          </CardHeader>
          <CardContent>
            {sourceStats.length === 0 ? (
              <p className="py-6 text-center text-sm text-fg-45">还没有源。</p>
            ) : (
              <MotionList
                as="ul"
                className="space-y-2"
                animateOnMount
                /* 展开/收起时行高变化，用 sync 保留离场占位，避免行在滑动中抖动 */
                mode="sync"
              >
                {visibleSourceStats.map((item) => {
                  const expanded = expandedSourceId === item.sourceId;
                  const panelId = `source-nodes-${item.sourceId}`;
                  return (
                    <MotionItem key={item.sourceId} itemKey={item.sourceId}>
                      <button
                        type="button"
                        onClick={() => toggleSourceNodes(item.sourceId)}
                        aria-expanded={expanded}
                        aria-controls={panelId}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors duration-200",
                          expanded
                            ? "border-primary-500/40 bg-primary-500/10"
                            : "border-ink/10 bg-ink/5 hover:border-ink/25 hover:bg-ink/10"
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "h-2 w-2 shrink-0 rounded-full",
                            !item.enabled
                              ? "bg-fg-30"
                              : item.ok === false
                                ? "animate-badge-pulse bg-red-400"
                                : item.ok === true
                                  ? "bg-emerald-400"
                                  : "bg-fg-40"
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-fg-80">{item.name}</span>
                          <span className="block text-[11px] text-fg-40">
                            {item.kind === "remote" ? "远程" : "手动"}
                            {item.enabled ? "" : " · 已停用"}
                            {item.renamedCount > 0 ? ` · 改名 ${item.renamedCount}` : ""}
                          </span>
                        </span>
                        <span
                          className={badgeVariants({
                            variant: item.ok === false ? "destructive" : "secondary",
                          })}
                        >
                          {formatCount(item.nodeCount)}
                        </span>
                        <ChevronDown
                          aria-hidden="true"
                          className={cn(
                            "h-4 w-4 shrink-0 text-fg-40 transition-transform duration-300",
                            expanded && "rotate-180 text-primary-200"
                          )}
                        />
                      </button>
                      <MotionReveal open={expanded} id={panelId}>
                        <div className="mt-2 rounded-xl border border-ink/10 bg-ink/5 p-3">
                          <SourceNodesInline
                            state={sourceNodes[item.sourceId] ?? { status: "loading" }}
                            onRetry={() => void loadSourceNodes(item.sourceId)}
                            onOpenSourceManager={() => onNavigate("sources")}
                            emptyHint={
                              item.kind === "manual"
                                ? "该源还没有可解析的节点文本。"
                                : "还没有节点快照，先刷新一次即可看到节点。"
                            }
                          />
                        </div>
                      </MotionReveal>
                    </MotionItem>
                  );
                })}
              </MotionList>
            )}
            {sourceStats.length > MAX_COLLAPSED_SOURCES ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 w-full"
                aria-expanded={showAllSources}
                onClick={() => setShowAllSources((current) => !current)}
              >
                {showAllSources ? "收起" : `展开全部 ${sourceStats.length} 个源`}
                <ChevronDown
                  aria-hidden="true"
                  className={cn("transition-transform duration-300", showAllSources && "rotate-180")}
                />
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {warnings.length > 0 ? (
        <Card className="animate-rise border-amber-500/30">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert aria-hidden="true" className="h-4 w-4 text-amber-400" />
              提醒
            </CardTitle>
            <Badge variant="warning">{warnings.length}</Badge>
          </CardHeader>
          <CardContent>
            <MotionList as="ul" className="space-y-2" animateOnMount>
              {warnings.map((item, index) => (
                <MotionItem
                  key={`${item.level}-${index}`}
                  itemKey={`${item.level}-${index}`}
                  className={cn(
                    "flex items-start gap-2 rounded-xl border px-3 py-2 text-xs",
                    item.level === "error"
                      ? "border-red-500/30 bg-red-500/10 text-red-200"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-200"
                  )}
                >
                  <CircleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="break-words">{item.message}</span>
                </MotionItem>
              ))}
            </MotionList>
          </CardContent>
        </Card>
      ) : null}

      <Card className="animate-rise">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity aria-hidden="true" className="h-4 w-4 text-primary-300" />
            快捷操作
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-3">
          <Button variant="secondary" onClick={() => onNavigate("sources")}>
            <Server aria-hidden="true" />
            导入 / 管理源
          </Button>
          <Button variant="secondary" onClick={() => onNavigate("subscriptions")}>
            <Link2 aria-hidden="true" />
            创建订阅链接
          </Button>
          <Button variant="secondary" onClick={() => onNavigate("config")}>
            <Sparkles aria-hidden="true" />
            调整生成配置
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
