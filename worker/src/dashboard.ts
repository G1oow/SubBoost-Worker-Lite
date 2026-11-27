import type { SnapshotRecord, SourceDto, StatusRecord, SubscriptionDto } from "./types";
import { countRenamedNodes, protocolBreakdown } from "./node-renames";

export type ProtocolCount = { type: string; count: number };

export type DashboardSourceStat = {
  sourceId: string;
  name: string;
  kind: SourceDto["kind"];
  enabled: boolean;
  nodeCount: number;
  renamedCount: number;
  fetchedAt: string | null;
  // 最近一次刷新的结果；从未刷新过为 null
  ok: boolean | null;
  error?: string;
  protocols: ProtocolCount[];
};

export type DashboardLastRun = {
  at: string;
  trigger: StatusRecord["lastTrigger"];
  durationMs: number;
  sourceOk: number;
  sourceFailed: number;
  subscriptionOk: number;
  subscriptionFailed: number;
};

export type DashboardWarning = {
  level: "warning" | "error";
  message: string;
};

export type DashboardStats = {
  generatedAt: string;
  sources: { total: number; enabled: number; remote: number; manual: number };
  subscriptions: { total: number; allSources: number; scoped: number };
  nodes: { total: number; renamed: number; protocols: ProtocolCount[] };
  sourceStats: DashboardSourceStat[];
  lastRun: DashboardLastRun | null;
  warnings: DashboardWarning[];
};

export type BuildDashboardStatsInput = {
  sources: SourceDto[];
  subscriptions: SubscriptionDto[];
  status: StatusRecord | null;
  snapshots: Map<string, SnapshotRecord | null>;
  generatedAt: string;
};

function summarizeSource(
  source: SourceDto,
  snapshot: SnapshotRecord | null,
  status: StatusRecord | null
): DashboardSourceStat {
  const nodes = snapshot?.nodes ?? [];
  const statusItem = status?.sources.find((item) => item.sourceId === source.id);
  return {
    sourceId: source.id,
    name: source.name,
    kind: source.kind,
    enabled: source.enabled,
    nodeCount: nodes.length,
    renamedCount: countRenamedNodes(nodes, source.nodeRenames),
    fetchedAt: snapshot?.fetchedAt ?? null,
    ok: statusItem ? statusItem.ok : null,
    ...(statusItem?.error ? { error: statusItem.error } : {}),
    protocols: protocolBreakdown(nodes),
  };
}

/**
 * 把源 / 订阅 / 刷新状态 / 节点快照聚合成仪表板所需的一次性视图。
 * 纯函数：快照由调用方读取，方便单元测试。
 */
export function buildDashboardStats(input: BuildDashboardStatsInput): DashboardStats {
  const { sources, subscriptions, status, snapshots, generatedAt } = input;

  const sourceStats = sources.map((source) =>
    summarizeSource(source, snapshots.get(source.id) ?? null, status)
  );

  const enabledStats = sourceStats.filter((item) => item.enabled);
  const totalNodes = enabledStats.reduce((sum, item) => sum + item.nodeCount, 0);
  const renamedNodes = enabledStats.reduce((sum, item) => sum + item.renamedCount, 0);

  const protocolTotals = new Map<string, number>();
  for (const item of enabledStats) {
    for (const protocol of item.protocols) {
      protocolTotals.set(protocol.type, (protocolTotals.get(protocol.type) ?? 0) + protocol.count);
    }
  }
  const protocols = [...protocolTotals.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  const allSources = subscriptions.filter((item) => item.sourceMode === "all").length;
  const scoped = subscriptions.length - allSources;

  const lastRun: DashboardLastRun | null = status
    ? {
        at: status.lastRunAt,
        trigger: status.lastTrigger,
        durationMs: status.durationMs,
        sourceOk: status.sources.filter((item) => item.ok).length,
        sourceFailed: status.sources.filter((item) => !item.ok).length,
        subscriptionOk: status.subscriptions.filter((item) => item.ok).length,
        subscriptionFailed: status.subscriptions.filter((item) => !item.ok).length,
      }
    : null;

  const warnings: DashboardWarning[] = [];
  if (sources.length === 0) {
    warnings.push({ level: "warning", message: "还没有添加任何源，先导入一个上游订阅或手动节点。" });
  } else if (enabledStats.length === 0) {
    warnings.push({ level: "warning", message: "所有源都已停用，订阅将没有可用节点。" });
  }
  if (subscriptions.length === 0 && sources.length > 0) {
    warnings.push({ level: "warning", message: "还没有订阅链接，创建一条后即可导入客户端。" });
  }
  for (const item of sourceStats) {
    if (item.ok === false) {
      warnings.push({
        level: "error",
        message: `源「${item.name}」最近刷新失败${item.error ? `：${item.error}` : ""}`,
      });
    } else if (item.enabled && item.nodeCount === 0 && item.fetchedAt === null) {
      warnings.push({
        level: "warning",
        message: `源「${item.name}」还没有节点快照，订阅首次访问时会即时抓取。`,
      });
    }
  }
  for (const item of status?.subscriptions ?? []) {
    if (item.ok) continue;
    const name = subscriptions.find((sub) => sub.id === item.subscriptionId)?.name ?? item.subscriptionId;
    warnings.push({
      level: "error",
      message: `订阅「${name}」生成失败${item.error ? `：${item.error}` : ""}`,
    });
  }

  return {
    generatedAt,
    sources: {
      total: sources.length,
      enabled: enabledStats.length,
      remote: sources.filter((item) => item.kind === "remote").length,
      manual: sources.filter((item) => item.kind === "manual").length,
    },
    subscriptions: { total: subscriptions.length, allSources, scoped },
    nodes: { total: totalNodes, renamed: renamedNodes, protocols },
    sourceStats,
    lastRun,
    warnings,
  };
}
