import { buildGenerateOptionsFromConfig } from "@subboost/core/subscription/config-utils";
import { generateClashYaml } from "@subboost/core/generator";
import { buildNodeContentKey, stableJsonStringify } from "@subboost/core/node-identity";
import type { SubscriptionResponseInfo } from "@subboost/core/subscription/subscription-response-info";
import type { ParsedNode } from "@subboost/core/types/node";
import { sha256Hex } from "./crypto";
import { refreshSource, sanitizeErrorMessage, type RefreshSourceResult } from "./sources";
import { applyNodeRenames } from "./node-renames";
import type { fetchText } from "./safe-fetch";
import type { Store } from "./store";
import {
  ON_DEMAND_CONCURRENCY,
  ON_DEMAND_SOFT_DEADLINE_MS,
  REFRESH_CONCURRENCY,
  REFRESH_SOFT_DEADLINE_MS,
  type CacheRecord,
  type SnapshotRecord,
  type SourceDto,
  type SourceRefreshStatus,
  type StatusRecord,
  type StoredSubscription,
  type SubscriptionRefreshStatus,
} from "./types";


export type PipelineDeps = {
  store: Store;
  fetchText: typeof fetchText;
  now: () => Date;
  defaultUserAgent: string;
};

export type GenerateSubscriptionResult =
  | { kind: "ok"; cache: CacheRecord; info: SubscriptionResponseInfo | null }
  | { kind: "no-nodes" };

export type GetOrGenerateResult =
  | {
      kind: "ok";
      sub: StoredSubscription;
      cache: CacheRecord;
      info: SubscriptionResponseInfo | null;
    }
  | { kind: "not-found" }
  | { kind: "no-nodes" };

export async function computeConfigHash(config: Record<string, unknown>): Promise<string> {
  return sha256Hex(stableJsonStringify(config));
}

/**
 * 生成前规范化配置：`dnsYaml` 为空白字符串时视为未提供。
 * 生成器把任何字符串类型的 `dnsYaml` 都当作显式基础配置并跳过默认 general 段，
 * 而 `buildDefaultUserConfig` 的默认值恰好是空串，直接透传会丢失 mixed-port/dns 等默认段。
 */
export function normalizeConfigForGeneration(config: Record<string, unknown>): Record<string, unknown> {
  if (typeof config.dnsYaml === "string" && config.dnsYaml.trim() === "") {
    const rest = { ...config };
    delete rest.dnsYaml;
    return rest;
  }
  return config;
}

async function runWithConcurrency<T, R>(
  limit: number,
  items: T[],
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

function targetSources<T extends { id: string; enabled: boolean }>(
  sub: StoredSubscription,
  sources: T[]
): T[] {
  const enabled = sources.filter((source) => source.enabled);
  if (sub.sourceIds.length === 0) return enabled;
  const byId = new Map(enabled.map((source) => [source.id, source]));
  return sub.sourceIds
    .map((id) => byId.get(id))
    .filter((source): source is T => Boolean(source));
}

function aggregateUserInfo(
  targets: ReadonlyArray<{ kind: string }>,
  snapshots: Array<SnapshotRecord | null>
): SubscriptionResponseInfo | null {
  const remoteSnapshots: SnapshotRecord[] = [];
  for (let index = 0; index < targets.length; index += 1) {
    if (targets[index].kind !== "remote") continue;
    const snapshot = snapshots[index];
    if (!snapshot) return null;
    remoteSnapshots.push(snapshot);
  }
  if (remoteSnapshots.length === 0) return null;

  let upload = 0;
  let download = 0;
  let total = 0;
  let expire: number | undefined;
  for (const snapshot of remoteSnapshots) {
    const info = snapshot.userInfo;
    if (
      !info ||
      typeof info.upload !== "number" ||
      typeof info.download !== "number" ||
      typeof info.total !== "number"
    ) {
      return null;
    }
    upload += info.upload;
    download += info.download;
    total += info.total;
    if (typeof info.expire === "number") {
      expire = expire === undefined ? info.expire : Math.min(expire, info.expire);
    }
  }

  return {
    upload,
    download,
    total,
    ...(expire !== undefined ? { expire } : {}),
  };
}

export async function generateSubscription(
  deps: PipelineDeps,
  sub: StoredSubscription,
  opts: {
    onDemand: boolean;
    // 调用方已读过配置时直接传入，避免同一次请求里重复读 KV
    config?: Record<string, unknown>;
  }
): Promise<GenerateSubscriptionResult> {
  const { store } = deps;
  const sources = await store.listSources();
  const targets = targetSources(sub, sources);
  const deadline = opts.onDemand
    ? deps.now().getTime() + ON_DEMAND_SOFT_DEADLINE_MS
    : Number.POSITIVE_INFINITY;

  // 一次批量读拿到全部快照（N 个源只消耗 ⌈N/100⌉ 次 KV 操作），
  // 避免原来是 N 次串行往返。
  const existing = await store.getSnapshots(targets.map((source) => source.id));

  // 缺快照且允许按需抓取时并发补齐：串行抓取会让客户端一直等到超时。
  // 单个源失败不阻塞整体，用已有快照继续出结果。
  const snapshots = await runWithConcurrency(
    ON_DEMAND_CONCURRENCY,
    targets.map((source, index) => ({ source, index })),
    async ({ source, index }): Promise<SnapshotRecord | null> => {
      const snapshot = existing[index];
      if (snapshot || !opts.onDemand) return snapshot;
      // 超过预算就不再发起新的抓取，宁可返回不完整但可用的配置
      if (deps.now().getTime() > deadline) return null;
      const refreshed = await refreshSource(source, {
        fetchText: deps.fetchText,
        defaultUserAgent: deps.defaultUserAgent,
        now: deps.now,
      });
      if (!refreshed.ok) return null;
      try {
        await store.putSnapshot(refreshed.snapshot);
      } catch {
        // 写快照失败不影响本次输出，下次拉取会重试
      }
      return refreshed.snapshot;
    }
  );

  const seen = new Set<string>();
  const nodes: ParsedNode[] = [];
  for (let index = 0; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index];
    if (!snapshot) continue;
    // 同一份快照的节点数不超过源上限，重命名只影响展示名，不影响去重身份
    const renames = targets[index]?.nodeRenames;
    for (const node of snapshot.nodes) {
      const key = buildNodeContentKey(node);
      if (seen.has(key)) continue;
      seen.add(key);
      nodes.push(applyNodeRenames(node, renames));
    }
  }

  if (nodes.length === 0) return { kind: "no-nodes" };

  const config = opts.config ?? (await store.getConfig()).config;
  const options = buildGenerateOptionsFromConfig(normalizeConfigForGeneration(config), { nodes });
  const yaml = generateClashYaml(options);
  const info = aggregateUserInfo(targets, snapshots);

  const cache: CacheRecord = {
    subscriptionId: sub.id,
    yaml,
    nodeCount: nodes.length,
    generatedAt: deps.now().toISOString(),
    configHash: await computeConfigHash(config),
  };
  await store.putCache(cache);
  return { kind: "ok", cache, info };
}

export async function getOrGenerateSubscription(
  deps: PipelineDeps,
  token: string
): Promise<GetOrGenerateResult> {
  const { store } = deps;
  const sub = await store.findSubscriptionByToken(token);
  if (!sub) return { kind: "not-found" };

  const { config } = await store.getConfig();
  const configHash = await computeConfigHash(config);
  const cached = await store.getCache(sub.id);
  if (cached && cached.configHash === configHash) {
    return { kind: "ok", sub, cache: cached, info: await resolveCachedInfo(deps, sub) };
  }

  try {
    const generated = await generateSubscription(deps, sub, { onDemand: true, config });
    if (generated.kind === "no-nodes") {
      // 可用节点为 0 时按 F6 返回 503，不复用旧缓存
      return { kind: "no-nodes" };
    }
    return { kind: "ok", sub, cache: generated.cache, info: generated.info };
  } catch (err) {
    // 生成抛错（如配置非法）：有旧缓存则回退并记录状态，否则向上抛
    if (cached) {
      await recordGenerationError(deps, sub.id, err);
      return { kind: "ok", sub, cache: cached, info: await resolveCachedInfo(deps, sub) };
    }
    throw err;
  }
}

/**
 * 缓存命中时重建 subscription-userinfo。
 * 只读源的轻量摘要（不解密 payload），并批量读快照，
 * 让这条最高频的路径保持常数级 KV 往返。
 */
async function resolveCachedInfo(
  deps: PipelineDeps,
  sub: StoredSubscription
): Promise<SubscriptionResponseInfo | null> {
  const summaries = await deps.store.listSourceSummaries();
  const targets = targetSources(sub, summaries);
  if (targets.every((source) => source.kind !== "remote")) return null;
  const snapshots = await deps.store.getSnapshots(targets.map((source) => source.id));
  return aggregateUserInfo(targets, snapshots);
}

async function recordGenerationError(
  deps: PipelineDeps,
  subscriptionId: string,
  err: unknown
): Promise<void> {
  try {
    const message = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
    const status = await deps.store.getStatus();
    const now = deps.now().toISOString();
    await deps.store.putStatus({
      lastRunAt: status?.lastRunAt ?? now,
      lastTrigger: status?.lastTrigger ?? "manual",
      durationMs: status?.durationMs ?? 0,
      sources: status?.sources ?? [],
      subscriptions: [
        ...(status?.subscriptions ?? []),
        { subscriptionId, ok: false, error: message },
      ],
    });
  } catch {
    // 状态写入失败不应影响订阅输出
  }
}

export async function refreshAll(
  deps: PipelineDeps,
  opts: { trigger: "cron" | "manual" }
): Promise<{ status: StatusRecord } | { skipped: "locked" }> {
  const { store } = deps;
  const owner = `${opts.trigger}-${deps.now().toISOString()}`;
  const acquired = await store.acquireLock(owner);
  if (!acquired) return { skipped: "locked" };

  const startedAt = deps.now();
  const startedMs = startedAt.getTime();
  const deadline = startedMs + REFRESH_SOFT_DEADLINE_MS;

  try {
    const sources = await store.listSources();
    const subs = await store.listStoredSubscriptions();
    const enabled = sources.filter((source) => source.enabled);

    const sourceResults = await runWithConcurrency(
      REFRESH_CONCURRENCY,
      enabled,
      async (source): Promise<RefreshSourceResult> => {
        if (deps.now().getTime() > deadline) {
          return { ok: false, error: "deadline-exceeded" };
        }
        const result = await refreshSource(source, {
          fetchText: deps.fetchText,
          defaultUserAgent: deps.defaultUserAgent,
          now: deps.now,
        });
        if (result.ok) {
          try {
            await store.putSnapshot(result.snapshot);
          } catch (err) {
            return { ok: false, error: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) };
          }
        }
        return result;
      }
    );

    const sourceStatuses: SourceRefreshStatus[] = enabled.map((source, index) => {
      const result = sourceResults[index];
      if (result.ok) {
        return { sourceId: source.id, ok: true, nodeCount: result.snapshot.nodeCount };
      }
      return { sourceId: source.id, ok: false, error: result.error };
    });

    const subscriptionStatuses: SubscriptionRefreshStatus[] = [];
    for (const sub of subs) {
      try {
        const generated = await generateSubscription(deps, sub, { onDemand: false });
        if (generated.kind === "ok") {
          subscriptionStatuses.push({
            subscriptionId: sub.id,
            ok: true,
            nodeCount: generated.cache.nodeCount,
          });
        } else {
          subscriptionStatuses.push({
            subscriptionId: sub.id,
            ok: false,
            error: "no-nodes",
          });
        }
      } catch (err) {
        subscriptionStatuses.push({
          subscriptionId: sub.id,
          ok: false,
          error: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)),
        });
      }
    }

    const status: StatusRecord = {
      lastRunAt: startedAt.toISOString(),
      lastTrigger: opts.trigger,
      durationMs: Math.max(0, deps.now().getTime() - startedMs),
      sources: sourceStatuses,
      subscriptions: subscriptionStatuses,
    };
    await store.putStatus(status);
    return { status };
  } finally {
    await store.releaseLock(owner);
  }
}

/**
 * 缓存内容的 ETag。
 * 只由「输出内容」决定：配置哈希 + 节点数 + YAML 长度，
 * 因此快照重抓但节点没变时 ETag 不变，客户端继续命中 304。
 */
export function buildCacheETag(cache: CacheRecord): string {
  return `"${cache.configHash.slice(0, 16)}-${cache.nodeCount}-${cache.yaml.length}"`;
}
