import { beforeEach, describe, expect, it } from "vitest";
import { buildDefaultUserConfig } from "@subboost/core/config/defaults";
import { createStore, shortCodeKey, snapshotKey, tokenIndexKey } from "./store";
import { MemoryKV } from "./test-utils/memory-kv";
import { KEY_SOURCES, TTL_CACHE, TTL_LOCK, TTL_SNAPSHOT } from "./types";

const ENCRYPTION_KEY = "unit-test-encryption-key-0123456789";

function createEnv(): { env: Env; kv: MemoryKV } {
  const kv = new MemoryKV();
  const env = { SUBBOOST_KV: kv as unknown as KVNamespace, ENCRYPTION_KEY } as unknown as Env;
  return { env, kv };
}

describe("createStore sources", () => {
  let kv: MemoryKV;
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    const created = createEnv();
    kv = created.kv;
    store = createStore(created.env);
  });

  it("encrypts payload at rest and decrypts on read", async () => {
    const [saved] = await store.saveSources([
      { name: "remote", kind: "remote", url: "https://example.com/sub?token=abc" },
    ]);
    expect(saved.url).toBe("https://example.com/sub?token=abc");

    const raw = JSON.parse(kv.raw(KEY_SOURCES) as string) as Array<{ payloadEnc: string }>;
    expect(raw).toHaveLength(1);
    expect(raw[0].payloadEnc.startsWith("v1:")).toBe(true);
    expect(raw[0].payloadEnc).not.toContain("example.com");

    const listed = await store.listSources();
    expect(listed[0].url).toBe("https://example.com/sub?token=abc");
  });

  it("stores manual text encrypted and returns manualText", async () => {
    const [saved] = await store.saveSources([
      { name: "manual", kind: "manual", manualText: "ss://abc" },
    ]);
    expect(saved.manualText).toBe("ss://abc");
    expect(saved.url).toBeUndefined();
    const listed = await store.listSources();
    expect(listed[0].manualText).toBe("ss://abc");
  });

  it("deletes snapshots for removed sources and keeps snapshots of retained sources", async () => {
    const [first, second] = await store.saveSources([
      { name: "a", kind: "manual", manualText: "ss://a" },
      { name: "b", kind: "manual", manualText: "ss://b" },
    ]);
    for (const source of [first, second]) {
      await store.putSnapshot({
        sourceId: source.id,
        nodes: [],
        nodeCount: 0,
        fetchedAt: new Date().toISOString(),
        parseErrors: [],
      });
    }
    expect(kv.has(snapshotKey(first.id))).toBe(true);
    expect(kv.has(snapshotKey(second.id))).toBe(true);

    await store.saveSources([{ id: first.id, name: "a", kind: "manual", manualText: "ss://a" }]);
    const remaining = await store.listStoredSources();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(first.id);
    // 被移除源的快照删除，保留源的快照仍在
    expect(kv.has(snapshotKey(second.id))).toBe(false);
    expect(kv.has(snapshotKey(first.id))).toBe(true);
  });

  it("keeps ids stable when inputs carry an id", async () => {
    const [first] = await store.saveSources([{ name: "a", kind: "manual", manualText: "ss://a" }]);
    const [updated] = await store.saveSources([
      { id: first.id, name: "a2", kind: "manual", manualText: "ss://a2" },
    ]);
    expect(updated.id).toBe(first.id);
    expect(updated.createdAt).toBe(first.createdAt);
  });

  it("reorders sources without changing ciphertext, timestamps, snapshot or subscription cache", async () => {
    const [first, second] = await store.saveSources([
      { name: "a", kind: "manual", manualText: "ss://a" },
      { name: "b", kind: "manual", manualText: "ss://b" },
    ]);
    const { dto } = await store.createSubscription({ name: "sample", sourceIds: [first.id] });
    await store.putCache({ subscriptionId: dto.id, yaml: "proxies: []", nodeCount: 0, generatedAt: first.createdAt, configHash: "test" });
    await store.putSnapshot({ sourceId: first.id, nodes: [], nodeCount: 0, fetchedAt: first.createdAt, parseErrors: [] });
    const original = JSON.parse(kv.raw(KEY_SOURCES) as string) as Array<{ id: string }>;
    expect((await store.reorderSources([second.id, first.id])).map((item) => item.id)).toEqual([second.id, first.id]);
    expect(JSON.parse(kv.raw(KEY_SOURCES) as string)).toEqual([...original].reverse());
    expect(kv.has(snapshotKey(first.id))).toBe(true);
    expect(await store.getCache(dto.id)).toMatchObject({ yaml: "proxies: []" });
    for (const ids of [[first.id], [first.id, first.id], [first.id, "missing"]]) {
      await expect(store.reorderSources(ids)).rejects.toMatchObject({ status: 409 });
    }
  });

  it("throws CONFIGURATION_ERROR when ENCRYPTION_KEY is missing", async () => {
    const kvOnly = new MemoryKV();
    const storeWithoutKey = createStore({ SUBBOOST_KV: kvOnly as unknown as KVNamespace } as unknown as Env);
    await expect(storeWithoutKey.listSources()).rejects.toMatchObject({
      status: 503,
      code: "CONFIGURATION_ERROR",
    });
  });
});

describe("createStore subscriptions", () => {
  let kv: MemoryKV;
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    const created = createEnv();
    kv = created.kv;
    store = createStore(created.env);
  });

  it("creates a subscription with a 43-char token and token index", async () => {
    const { dto, token } = await store.createSubscription({ name: "default", sourceIds: [] });
    expect(token).toHaveLength(43);
    expect(dto.link).toBe(`/sub/${token}`);

    const storedRaw = JSON.parse(kv.raw("meta:subs") as string) as Array<{ tokenHash: string; tokenEnc: string }>;
    expect(storedRaw).toHaveLength(1);
    expect(storedRaw[0].tokenEnc.startsWith("v1:")).toBe(true);
    expect(kv.has(tokenIndexKey(storedRaw[0].tokenHash))).toBe(true);

    const found = await store.findSubscriptionByToken(token);
    expect(found?.id).toBe(dto.id);
  });

  it("reorders subscriptions without rotating credentials or invalidating cache", async () => {
    const first = await store.createSubscription({ name: "a", sourceIds: [] });
    const second = await store.createSubscription({ name: "b", sourceIds: [] });
    await store.putCache({ subscriptionId: first.dto.id, yaml: "proxies: []", nodeCount: 0, generatedAt: first.dto.createdAt, configHash: "test" });
    const raw = JSON.parse(kv.raw("meta:subs") as string) as Array<{ id: string }>;
    expect((await store.reorderSubscriptions([second.dto.id, first.dto.id], "https://example.com")).map((item) => item.id))
      .toEqual([second.dto.id, first.dto.id]);
    expect(JSON.parse(kv.raw("meta:subs") as string)).toEqual([...raw].reverse());
    expect(await store.findSubscriptionByToken(first.token)).toMatchObject({ id: first.dto.id });
    expect(await store.getCache(first.dto.id)).toMatchObject({ yaml: "proxies: []" });
    await expect(store.reorderSubscriptions([first.dto.id, first.dto.id], "https://example.com"))
      .rejects.toMatchObject({ status: 409 });
  });

  it("rotates the token so the old token stops resolving", async () => {
    const { dto, token } = await store.createSubscription({ name: "default", sourceIds: [] });
    const rotated = await store.rotateSubscriptionToken(dto.id, "https://worker.example.com");
    expect(rotated).not.toBeNull();
    expect(rotated?.link.startsWith("https://worker.example.com/sub/")).toBe(true);

    await expect(store.findSubscriptionByToken(token)).resolves.toBeNull();
    const newToken = rotated?.link.split("/sub/")[1] as string;
    await expect(store.findSubscriptionByToken(newToken)).resolves.toMatchObject({ id: dto.id });
  });

  it("deletes subscription, token index and cache", async () => {
    const { dto, token } = await store.createSubscription({ name: "default", sourceIds: [] });
    await store.putCache({
      subscriptionId: dto.id,
      yaml: "proxies: []",
      nodeCount: 0,
      generatedAt: new Date().toISOString(),
      configHash: "hash",
    });
    await expect(store.deleteSubscription(dto.id)).resolves.toBe(true);
    await expect(store.findSubscriptionByToken(token)).resolves.toBeNull();
    await expect(store.getCache(dto.id)).resolves.toBeNull();
  });

  it("creates an idempotent short link and indexes the code", async () => {
    const { dto } = await store.createSubscription({ name: "default", sourceIds: [] });
    const origin = "https://worker.example.com";

    const first = await store.createShortLink(dto.id, origin);
    expect(first?.shortLink).toMatch(/^https:\/\/worker\.example\.com\/s\/[A-Za-z0-9_-]{8}$/);
    const code = (first?.shortLink as string).split("/s/").pop() as string;
    expect(kv.raw(shortCodeKey(code))).toBe(dto.id);
    await expect(store.findSubscriptionByShortCode(code)).resolves.toMatchObject({ id: dto.id });

    // 幂等：重复生成返回同一个短码，也不会多出一条订阅记录
    const second = await store.createShortLink(dto.id, origin);
    expect(second?.shortLink).toBe(first?.shortLink);
    await expect(store.listStoredSubscriptions()).resolves.toHaveLength(1);
  });

  it("revokes the short link and drops its index", async () => {
    const { dto } = await store.createSubscription({ name: "default", sourceIds: [] });
    const origin = "https://worker.example.com";
    const created = await store.createShortLink(dto.id, origin);
    const code = (created?.shortLink as string).split("/s/").pop() as string;

    const revoked = await store.revokeShortLink(dto.id, origin);
    expect(revoked?.shortLink).toBeUndefined();
    expect(kv.has(shortCodeKey(code))).toBe(false);
    await expect(store.findSubscriptionByShortCode(code)).resolves.toBeNull();

    // 重复撤销与未知订阅
    await expect(store.revokeShortLink(dto.id, origin)).resolves.toMatchObject({ id: dto.id });
    await expect(store.createShortLink("missing", origin)).resolves.toBeNull();
    await expect(store.revokeShortLink("missing", origin)).resolves.toBeNull();
  });

  it("drops the short link when rotating the token", async () => {
    const { dto } = await store.createSubscription({ name: "default", sourceIds: [] });
    const created = await store.createShortLink(dto.id, "https://worker.example.com");
    const code = (created?.shortLink as string).split("/s/").pop() as string;

    const rotated = await store.rotateSubscriptionToken(dto.id, "https://worker.example.com");
    expect(rotated?.shortLink).toBeUndefined();
    await expect(store.findSubscriptionByShortCode(code)).resolves.toBeNull();
    expect(kv.has(shortCodeKey(code))).toBe(false);
  });

  it("drops the short link when deleting the subscription", async () => {
    const { dto } = await store.createSubscription({ name: "default", sourceIds: [] });
    const created = await store.createShortLink(dto.id, "https://worker.example.com");
    const code = (created?.shortLink as string).split("/s/").pop() as string;

    await expect(store.deleteSubscription(dto.id)).resolves.toBe(true);
    expect(kv.has(shortCodeKey(code))).toBe(false);
    await expect(store.findSubscriptionByShortCode(code)).resolves.toBeNull();
  });

  it("rejects malformed short codes without a KV read", async () => {
    const before = kv.operationCount;
    await expect(store.findSubscriptionByShortCode("../../etc/passwd")).resolves.toBeNull();
    await expect(store.findSubscriptionByShortCode("short")).resolves.toBeNull();
    expect(kv.operationCount).toBe(before);
  });
});

describe("createStore TTLs and config", () => {
  let kv: MemoryKV;
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    const created = createEnv();
    kv = created.kv;
    store = createStore(created.env);
  });

  it("uses the documented TTLs", async () => {
    await store.putSnapshot({
      sourceId: "s1",
      nodes: [],
      nodeCount: 0,
      fetchedAt: new Date().toISOString(),
      parseErrors: [],
    });
    await store.putCache({
      subscriptionId: "sub1",
      yaml: "proxies: []",
      nodeCount: 0,
      generatedAt: new Date().toISOString(),
      configHash: "h",
    });
    await store.acquireLock("owner");

    expect(kv.expirationTtls.get(snapshotKey("s1"))).toBe(TTL_SNAPSHOT);
    expect(kv.expirationTtls.get("cache:sub1")).toBe(TTL_CACHE);
    expect(kv.expirationTtls.get("meta:refresh-lock")).toBe(TTL_LOCK);
  });

  it("returns the standard default config when unset", async () => {
    const result = await store.getConfig();
    expect(result.isDefault).toBe(true);
    expect(result.config).toEqual(buildDefaultUserConfig("standard"));
  });

  it("round-trips a custom config and resets to default", async () => {
    await store.putConfig({ mixedPort: 1234 });
    const stored = await store.getConfig();
    expect(stored.isDefault).toBe(false);
    expect(stored.config.mixedPort).toBe(1234);
    await store.resetConfig();
    const reset = await store.getConfig();
    expect(reset.isDefault).toBe(true);
  });

  it("acquires and releases the refresh lock", async () => {
    await expect(store.acquireLock("a")).resolves.toBe(true);
    await expect(store.acquireLock("b")).resolves.toBe(false);
    await store.releaseLock("b");
    await expect(store.acquireLock("b")).resolves.toBe(false);
    await store.releaseLock("a");
    await expect(store.acquireLock("b")).resolves.toBe(true);
  });
});

