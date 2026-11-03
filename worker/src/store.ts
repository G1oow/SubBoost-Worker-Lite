import { buildDefaultUserConfig } from "@subboost/core/config/defaults";
import { decryptString, encryptString, generateToken, sha256Hex } from "./crypto";
import { ApiError } from "./errors";
import {
  KEY_CONFIG,
  KEY_LOCK,
  KEY_SOURCES,
  KEY_STATUS,
  KEY_SUBS,
  TTL_CACHE,
  TTL_LOCK,
  TTL_SNAPSHOT,
  type CacheRecord,
  type SnapshotRecord,
  type SourceDto,
  type SourceInput,
  type SourceSummary,
  type StatusRecord,
  type StoredSource,
  type StoredSubscription,
  type SubscriptionDto,
} from "./types";

export function tokenIndexKey(tokenHash: string): string {
  return `tokidx:${tokenHash}`;
}

export function snapshotKey(sourceId: string): string {
  return `nodes:${sourceId}`;
}

export function cacheKey(subscriptionId: string): string {
  return `cache:${subscriptionId}`;
}

function randomId(): string {
  return generateToken().slice(0, 22);
}

function requireEncryptionKey(env: Env): string {
  const secret = env.ENCRYPTION_KEY?.trim();
  if (!secret) throw new ApiError(503, "CONFIGURATION_ERROR", "ENCRYPTION_KEY 未配置");
  return secret;
}

async function readJsonArray<T>(kv: KVNamespace, key: string): Promise<T[]> {
  const value = await kv.get(key, "json");
  return Array.isArray(value) ? (value as T[]) : [];
}

async function readJson<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const value = await kv.get(key, "json");
  return value === null || value === undefined ? null : (value as T);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createStore(env: Env) {
  const kv = env.SUBBOOST_KV;

  async function listStoredSources(): Promise<StoredSource[]> {
    return readJsonArray<StoredSource>(kv, KEY_SOURCES);
  }

  /**
   * 轻量源列表：不做 payload 解密，只保留生成订阅所需的路由信息。
   * 订阅缓存命中路径只需要 kind / enabled / nodeRenames，
   * 走 listSources() 会把每个手动源的整段节点文本都解一遍，纯属浪费。
   */
  async function listSourceSummaries(): Promise<SourceSummary[]> {
    // 与 listSources 一致：未配置密钥时 fail closed
    requireEncryptionKey(env);
    const stored = await listStoredSources();
    return stored.map((item) => ({
      id: item.id,
      kind: item.kind,
      enabled: item.enabled,
      ...(item.nodeRenames && Object.keys(item.nodeRenames).length > 0
        ? { nodeRenames: item.nodeRenames }
        : {}),
    }));
  }

  async function toSourceDto(stored: StoredSource): Promise<SourceDto> {
    const secret = requireEncryptionKey(env);
    let payload: string;
    try {
      payload = await decryptString(stored.payloadEnc, secret);
    } catch {
      throw new ApiError(
        500,
        "INTERNAL_ERROR",
        "源数据解密失败，请重新录入源（ENCRYPTION_KEY 可能已更换）"
      );
    }
    return {
      id: stored.id,
      name: stored.name,
      kind: stored.kind,
      ...(stored.kind === "remote" ? { url: payload } : { manualText: payload }),
      enabled: stored.enabled,
      ...(stored.userAgent ? { userAgent: stored.userAgent } : {}),
      ...(stored.nodeRenames && Object.keys(stored.nodeRenames).length > 0
        ? { nodeRenames: stored.nodeRenames }
        : {}),
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    };
  }

  async function listSources(): Promise<SourceDto[]> {
    // 即使当前没有源也校验密钥，保证未配置密钥时 fail closed
    requireEncryptionKey(env);
    const stored = await listStoredSources();
    return Promise.all(stored.map((item) => toSourceDto(item)));
  }

  async function saveSources(inputs: SourceInput[]): Promise<SourceDto[]> {
    const secret = requireEncryptionKey(env);
    const existing = await listStoredSources();
    const existingById = new Map(existing.map((item) => [item.id, item]));
    const now = new Date().toISOString();
    const nextIds = new Set<string>();

    const stored: StoredSource[] = [];
    for (const input of inputs) {
      const previous = existingById.get(input.id ?? "");
      const id = previous?.id ?? randomId();
      nextIds.add(id);
      const payload = input.kind === "remote" ? input.url ?? "" : input.manualText ?? "";
      const nodeRenames =
        input.nodeRenames && Object.keys(input.nodeRenames).length > 0 ? input.nodeRenames : undefined;
      stored.push({
        id,
        name: input.name,
        kind: input.kind,
        payloadEnc: await encryptString(payload, secret),
        enabled: input.enabled ?? true,
        ...(input.userAgent ? { userAgent: input.userAgent } : {}),
        ...(nodeRenames ? { nodeRenames } : {}),
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      });
    }

    await kv.put(KEY_SOURCES, JSON.stringify(stored));

    // 删除已移除源的快照（尽力而为，失败不影响保存结果）
    for (const item of existing) {
      if (nextIds.has(item.id)) continue;
      try {
        await kv.delete(snapshotKey(item.id));
      } catch {
        // ignore
      }
    }

    // 源集合或节点改名都会影响已生成的 YAML：清掉订阅缓存，下次访问重新生成
    const subs = await listStoredSubscriptions();
    for (const sub of subs) {
      try {
        await kv.delete(cacheKey(sub.id));
      } catch {
        // ignore
      }
    }

    return Promise.all(stored.map((item) => toSourceDto(item)));
  }

  async function listStoredSubscriptions(): Promise<StoredSubscription[]> {
    return readJsonArray<StoredSubscription>(kv, KEY_SUBS);
  }

  async function toSubscriptionDto(
    stored: StoredSubscription,
    origin: string
  ): Promise<SubscriptionDto> {
    const secret = requireEncryptionKey(env);
    let token: string;
    try {
      token = await decryptString(stored.tokenEnc, secret);
    } catch {
      throw new ApiError(
        500,
        "INTERNAL_ERROR",
        "订阅数据解密失败，请重新创建订阅（ENCRYPTION_KEY 可能已更换）"
      );
    }
    return {
      id: stored.id,
      name: stored.name,
      sourceIds: stored.sourceIds,
      link: `${origin}/sub/${token}`,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    };
  }

  async function listSubscriptions(origin: string): Promise<SubscriptionDto[]> {
    requireEncryptionKey(env);
    const stored = await listStoredSubscriptions();
    return Promise.all(stored.map((item) => toSubscriptionDto(item, origin)));
  }

  async function writeSubscriptions(subs: StoredSubscription[]): Promise<void> {
    await kv.put(KEY_SUBS, JSON.stringify(subs));
  }

  async function createSubscription(input: {
    name: string;
    sourceIds: string[];
  }): Promise<{ dto: SubscriptionDto; token: string }> {
    const secret = requireEncryptionKey(env);
    const subs = await listStoredSubscriptions();
    const token = generateToken();
    const tokenHash = await sha256Hex(token);
    const now = new Date().toISOString();
    const stored: StoredSubscription = {
      id: randomId(),
      name: input.name,
      tokenHash,
      tokenEnc: await encryptString(token, secret),
      sourceIds: input.sourceIds,
      createdAt: now,
      updatedAt: now,
    };
    subs.push(stored);
    await writeSubscriptions(subs);
    await kv.put(tokenIndexKey(tokenHash), stored.id);
    return { dto: await toSubscriptionDto(stored, ""), token };
  }

  async function deleteSubscription(id: string): Promise<boolean> {
    const subs = await listStoredSubscriptions();
    const target = subs.find((item) => item.id === id);
    if (!target) return false;
    await writeSubscriptions(subs.filter((item) => item.id !== id));
    await kv.delete(tokenIndexKey(target.tokenHash));
    await kv.delete(cacheKey(id));
    return true;
  }

  async function rotateSubscriptionToken(
    id: string,
    origin: string
  ): Promise<SubscriptionDto | null> {
    const secret = requireEncryptionKey(env);
    const subs = await listStoredSubscriptions();
    const index = subs.findIndex((item) => item.id === id);
    if (index < 0) return null;

    const previous = subs[index];
    const token = generateToken();
    const tokenHash = await sha256Hex(token);
    const updated: StoredSubscription = {
      ...previous,
      tokenHash,
      tokenEnc: await encryptString(token, secret),
      updatedAt: new Date().toISOString(),
    };
    subs[index] = updated;
    await writeSubscriptions(subs);
    await kv.delete(tokenIndexKey(previous.tokenHash));
    await kv.put(tokenIndexKey(tokenHash), updated.id);
    return toSubscriptionDto(updated, origin);
  }

  /**
   * 更新订阅的名称与所含源。链接与 token 保持不变，
   * 但源集合变化会改变生成的 YAML，因此必须清掉该订阅的缓存。
   */
  async function updateSubscription(
    id: string,
    patch: { name?: string; sourceIds?: string[] },
    origin: string
  ): Promise<SubscriptionDto | null> {
    const subs = await listStoredSubscriptions();
    const index = subs.findIndex((item) => item.id === id);
    if (index < 0) return null;

    const previous = subs[index];
    const updated: StoredSubscription = {
      ...previous,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.sourceIds !== undefined ? { sourceIds: patch.sourceIds } : {}),
      updatedAt: new Date().toISOString(),
    };
    subs[index] = updated;
    await writeSubscriptions(subs);
    await kv.delete(cacheKey(id));
    return toSubscriptionDto(updated, origin);
  }

  async function findSubscriptionByToken(token: string): Promise<StoredSubscription | null> {
    const tokenHash = await sha256Hex(token);
    const id = await kv.get(tokenIndexKey(tokenHash), "text");
    if (!id) return null;
    const subs = await listStoredSubscriptions();
    const target = subs.find((item) => item.id === id && item.tokenHash === tokenHash);
    return target ?? null;
  }

  async function getConfig(): Promise<{ config: Record<string, unknown>; isDefault: boolean }> {
    const stored = await readJson<Record<string, unknown>>(kv, KEY_CONFIG);
    if (!isPlainObject(stored)) {
      return { config: buildDefaultUserConfig("standard") as unknown as Record<string, unknown>, isDefault: true };
    }
    return { config: stored, isDefault: false };
  }

  async function putConfig(config: Record<string, unknown>): Promise<void> {
    await kv.put(KEY_CONFIG, JSON.stringify(config));
  }

  async function resetConfig(): Promise<void> {
    await kv.delete(KEY_CONFIG);
  }

  async function getSnapshot(sourceId: string): Promise<SnapshotRecord | null> {
    return readJson<SnapshotRecord>(kv, snapshotKey(sourceId));
  }

  // Workers 批量读上限是 100 个 key，超过就分片并发读（每片仍只算 1 次操作）
  const KV_BULK_READ_LIMIT = 100;

  /**
   * 批量读取多个源的快照，返回与 sourceIds 等长的数组（缺失为 null）。
   * 走 KV 批量读：N 个源只消耗 ⌈N/100⌉ 次外部操作，而不是 N 次串行往返。
   */
  async function getSnapshots(sourceIds: string[]): Promise<Array<SnapshotRecord | null>> {
    if (sourceIds.length === 0) return [];

    const chunks: string[][] = [];
    for (let index = 0; index < sourceIds.length; index += KV_BULK_READ_LIMIT) {
      chunks.push(sourceIds.slice(index, index + KV_BULK_READ_LIMIT));
    }

    const maps = await Promise.all(
      chunks.map(
        (chunk) => kv.get(chunk.map((id) => snapshotKey(id)), "json") as Promise<Map<string, unknown>>
      )
    );

    const values = new Map<string, unknown>();
    for (const map of maps) {
      for (const [key, value] of map) values.set(key, value);
    }

    return sourceIds.map((id) => {
      const value = values.get(snapshotKey(id));
      return value === null || value === undefined ? null : (value as SnapshotRecord);
    });
  }

  async function putSnapshot(record: SnapshotRecord): Promise<void> {
    await kv.put(snapshotKey(record.sourceId), JSON.stringify(record), {
      expirationTtl: TTL_SNAPSHOT,
    });
  }

  async function deleteSnapshot(sourceId: string): Promise<void> {
    await kv.delete(snapshotKey(sourceId));
  }

  async function getCache(subId: string): Promise<CacheRecord | null> {
    return readJson<CacheRecord>(kv, cacheKey(subId));
  }

  async function putCache(record: CacheRecord): Promise<void> {
    await kv.put(cacheKey(record.subscriptionId), JSON.stringify(record), {
      expirationTtl: TTL_CACHE,
    });
  }

  async function deleteCache(subId: string): Promise<void> {
    await kv.delete(cacheKey(subId));
  }

  async function getStatus(): Promise<StatusRecord | null> {
    return readJson<StatusRecord>(kv, KEY_STATUS);
  }

  async function putStatus(status: StatusRecord): Promise<void> {
    await kv.put(KEY_STATUS, JSON.stringify(status));
  }

  async function acquireLock(owner: string): Promise<boolean> {
    const existing = await kv.get(KEY_LOCK, "text");
    if (existing) return false;
    await kv.put(KEY_LOCK, owner, { expirationTtl: TTL_LOCK });
    return true;
  }

  async function releaseLock(owner: string): Promise<void> {
    const existing = await kv.get(KEY_LOCK, "text");
    if (existing === owner) await kv.delete(KEY_LOCK);
  }

  return {
    listSources,
    listSourceSummaries,
    listStoredSources,
    listStoredSubscriptions,
    saveSources,
    listSubscriptions,
    createSubscription,
    deleteSubscription,
    updateSubscription,
    rotateSubscriptionToken,
    findSubscriptionByToken,
    getConfig,
    putConfig,
    resetConfig,
    getSnapshot,
    getSnapshots,
    putSnapshot,
    deleteSnapshot,
    getCache,
    putCache,
    deleteCache,
    getStatus,
    putStatus,
    acquireLock,
    releaseLock,
  };
}

export type Store = ReturnType<typeof createStore>;


