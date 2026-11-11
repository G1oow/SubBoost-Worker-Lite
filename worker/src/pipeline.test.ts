import yaml from "js-yaml";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCacheETag,
  computeConfigHash,
  computeSubscriptionCacheHash,
  generateSubscription,
  getOrGenerateSubscription,
  normalizeConfigForGeneration,
  previewConfig,
  refreshAll,
  type PipelineDeps,
} from "./pipeline";
import { createStore, snapshotKey } from "./store";
import { nodeRenameKey } from "./node-renames";
import { MemoryKV } from "./test-utils/memory-kv";
import type { CacheRecord } from "./types";
import type { ParsedNode } from "@subboost/core/types/node";
import { stableJsonStringify } from "@subboost/core/node-identity";
import { sha256Hex } from "./crypto";

const ENCRYPTION_KEY = "pipeline-test-key-0123456789";

function ssNode(name: string, port: number): string {
  const payload = Buffer.from(`aes-256-gcm:password`).toString("base64").replace(/=+$/, "");
  return `ss://${payload}@example.com:${port}#${name}`;
}

function base64Subscription(lines: string[]): string {
  return Buffer.from(lines.join("\n")).toString("base64");
}

function okResponse(text: string, headers: Record<string, string> = {}) {
  return { status: 200, headers, text, finalUrl: "https://example.com/sub" };
}

type Harness = {
  kv: MemoryKV;
  store: ReturnType<typeof createStore>;
  deps: PipelineDeps;
  clock: { set: (values: number[]) => void };
};

async function createHarness(): Promise<Harness> {
  const kv = new MemoryKV();
  const env = { SUBBOOST_KV: kv as unknown as KVNamespace, ENCRYPTION_KEY } as unknown as Env;
  const store = createStore(env);
  let queue: number[] = [];
  const fallback = Date.parse("2026-10-12T00:00:00.000Z");
  const clock = {
    set(values: number[]) {
      queue = [...values];
    },
  };
  const deps: PipelineDeps = {
    store,
    fetchText: (async () => okResponse("")) as unknown as PipelineDeps["fetchText"],
    now: () => new Date(queue.length > 0 ? (queue.shift() as number) : fallback),
    defaultUserAgent: "mihomo/test",
  };
  return { kv, store, deps, clock };
}

function proxiesFrom(yamlText: string): Array<{ name: string }> {
  const parsed = yaml.load(yamlText) as { proxies: Array<{ name: string }> };
  return parsed.proxies;
}

function groupNamesFrom(yamlText: string): string[] {
  const parsed = yaml.load(yamlText) as { "proxy-groups"?: Array<{ name: string }> };
  return (parsed["proxy-groups"] ?? []).map((group) => group.name);
}

describe("generateSubscription", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
  });

  it("deduplicates identical nodes across sources and keeps first occurrence", async () => {
    const shared = ssNode("shared", 8388);
    const onlyA = ssNode("onlyA", 8389);
    const onlyB = ssNode("onlyB", 8390);
    h.deps.fetchText = (async (url: string) => {
      if (url === "https://a.example.com/sub") return okResponse(base64Subscription([shared, onlyA]));
      return okResponse(base64Subscription([shared, onlyB]));
    }) as unknown as PipelineDeps["fetchText"];

    const sources = await h.store.saveSources([
      { name: "a", kind: "remote", url: "https://a.example.com/sub" },
      { name: "b", kind: "remote", url: "https://b.example.com/sub" },
    ]);
    const { dto } = await h.store.createSubscription({ name: "all", sourceIds: [] });
    const sub = await h.store.findSubscriptionByToken(dto.link.split("/sub/")[1]);
    expect(sub).not.toBeNull();

    const result = await generateSubscription(h.deps, sub!, { onDemand: true });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(proxiesFrom(result.cache.yaml)).toHaveLength(3);
    expect(result.cache.nodeCount).toBe(3);
  });

  it("keeps the historical snapshot when one source fails", async () => {
    h.deps.fetchText = (async (url: string) => {
      if (url === "https://good.example.com/sub") {
        return okResponse(base64Subscription([ssNode("good", 8388)]));
      }
      return { status: 500, headers: {}, text: "boom", finalUrl: url };
    }) as unknown as PipelineDeps["fetchText"];

    const sources = await h.store.saveSources([
      { name: "good", kind: "remote", url: "https://good.example.com/sub" },
      { name: "bad", kind: "remote", url: "https://bad.example.com/sub" },
    ]);
    // 预置 bad 源的历史快照
    const badId = sources[1].id;
    await h.store.putSnapshot({
      sourceId: badId,
      nodes: [{ name: "old", type: "ss", server: "example.com", port: 9999, cipher: "aes-256-gcm", password: "x" }],
      nodeCount: 1,
      fetchedAt: "2026-10-01T00:00:00.000Z",
      parseErrors: [],
    });

    const refresh = await refreshAll(h.deps, { trigger: "manual" });
    expect("status" in refresh).toBe(true);
    if (!("status" in refresh)) return;
    const badStatus = refresh.status.sources.find((item) => item.sourceId === badId);
    expect(badStatus?.ok).toBe(false);
    const goodStatus = refresh.status.sources.find((item) => item.sourceId === sources[0].id);
    expect(goodStatus?.ok).toBe(true);

    // 保护性快照：bad 源的快照未被覆盖
    const snapshot = await h.store.getSnapshot(badId);
    expect(snapshot?.nodeCount).toBe(1);
    expect(snapshot?.fetchedAt).toBe("2026-10-01T00:00:00.000Z");
  });

  it("only includes nodes from the subscription's sourceIds", async () => {
    h.deps.fetchText = (async (url: string) => {
      if (url === "https://a.example.com/sub") return okResponse(base64Subscription([ssNode("a", 8388)]));
      return okResponse(base64Subscription([ssNode("b", 8389)]));
    }) as unknown as PipelineDeps["fetchText"];

    const sources = await h.store.saveSources([
      { name: "a", kind: "remote", url: "https://a.example.com/sub" },
      { name: "b", kind: "remote", url: "https://b.example.com/sub" },
    ]);
    await h.store.putSnapshot({
      sourceId: sources[0].id,
      nodes: [{ name: "a", type: "ss", server: "example.com", port: 8388, cipher: "aes-256-gcm", password: "x" }],
      nodeCount: 1,
      fetchedAt: "2026-10-01T00:00:00.000Z",
      parseErrors: [],
    });
    await h.store.putSnapshot({
      sourceId: sources[1].id,
      nodes: [{ name: "b", type: "ss", server: "example.com", port: 8389, cipher: "aes-256-gcm", password: "x" }],
      nodeCount: 1,
      fetchedAt: "2026-10-01T00:00:00.000Z",
      parseErrors: [],
    });

    const { dto } = await h.store.createSubscription({ name: "one", sourceIds: [sources[0].id] });
    const sub = await h.store.findSubscriptionByToken(dto.link.split("/sub/")[1]);
    const result = await generateSubscription(h.deps, sub!, { onDemand: false });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(proxiesFrom(result.cache.yaml).map((p) => p.name)).toEqual(["a"]);
  });

  it("只生成订阅勾选的链，未勾选的链不出现", async () => {
    const sources = await h.store.saveSources([{ name: "a", kind: "manual", manualText: `${ssNode("a", 8388)}\n${ssNode("b", 8389)}` }]);
    await h.store.putSnapshot({
      sourceId: sources[0].id,
      nodes: [
        { name: "a", type: "ss", server: "example.com", port: 8388, cipher: "aes-256-gcm", password: "x" },
        { name: "b", type: "ss", server: "example.com", port: 8389, cipher: "aes-256-gcm", password: "x" },
      ],
      nodeCount: 2,
      fetchedAt: "2026-10-01T00:00:00.000Z",
      parseErrors: [],
    });
    const nodeA = { name: "a", type: "ss", server: "example.com", port: 8388, cipher: "aes-256-gcm", password: "x" } as ParsedNode;
    const nodeB = { name: "b", type: "ss", server: "example.com", port: 8389, cipher: "aes-256-gcm", password: "x" } as ParsedNode;
    await h.store.putConfig({
      enabledGroups: ["select", "auto", "final"],
      proxyChains: [
        {
          id: "chain-on",
          name: "🇺🇸 已勾选链",
          relayNodes: [{ sourceId: sources[0].id, nodeKey: nodeRenameKey(nodeA as never) }],
          landingNodes: [{ sourceId: sources[0].id, nodeKey: nodeRenameKey(nodeB as never) }],
        },
        {
          id: "chain-off",
          name: "🇯🇵 未勾选链",
          relayNodes: [{ sourceId: sources[0].id, nodeKey: nodeRenameKey(nodeA as never) }],
          landingNodes: [{ sourceId: sources[0].id, nodeKey: nodeRenameKey(nodeB as never) }],
        },
      ],
    });

    const { dto } = await h.store.createSubscription({ name: "勾了链", sourceIds: [], chainIds: ["chain-on"] });
    const sub = await h.store.findSubscriptionByToken(dto.link.split("/sub/")[1]);
    const result = await generateSubscription(h.deps, sub!, { onDemand: false });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const parsed = yaml.load(result.cache.yaml) as Record<string, unknown>;
    const groupNames = ((parsed["proxy-groups"] ?? []) as Array<{ name: string }>).map((group) => group.name);
    expect(groupNames).toContain("🇺🇸 已勾选链");
    expect(groupNames).not.toContain("🇯🇵 未勾选链");
    // 落地节点被出口组顶替，且带上前置组的 dialer-proxy
    const landing = proxiesFrom(result.cache.yaml).find((proxy) => proxy.name === "b") as unknown as Record<string, unknown>;
    expect(landing["dialer-proxy"]).toBe("🇺🇸 已勾选链 · 前置");
  });

  it("链引用的源即使没勾进订阅也参与生成", async () => {
    const sources = await h.store.saveSources([
      { name: "订阅源", kind: "manual", manualText: ssNode("a", 8388) },
      { name: "链专用源", kind: "manual", manualText: ssNode("b", 8389) },
    ]);
    const nodeA = { name: "a", type: "ss", server: "example.com", port: 8388, cipher: "aes-256-gcm", password: "x" } as ParsedNode;
    const nodeB = { name: "b", type: "ss", server: "example.com", port: 8389, cipher: "aes-256-gcm", password: "x" } as ParsedNode;
    await h.store.putSnapshot({
      sourceId: sources[0].id,
      nodes: [nodeA],
      nodeCount: 1,
      fetchedAt: "2026-10-01T00:00:00.000Z",
      parseErrors: [],
    });
    await h.store.putSnapshot({
      sourceId: sources[1].id,
      nodes: [nodeB],
      nodeCount: 1,
      fetchedAt: "2026-10-01T00:00:00.000Z",
      parseErrors: [],
    });
    await h.store.putConfig({
      enabledGroups: ["select", "auto", "final"],
      proxyChains: [
        {
          id: "chain-1",
          name: "🇺🇸 跨源链",
          relayNodes: [{ sourceId: sources[0].id, nodeKey: nodeRenameKey(nodeA as never) }],
          landingNodes: [{ sourceId: sources[1].id, nodeKey: nodeRenameKey(nodeB as never) }],
        },
      ],
    });

    // 订阅只勾了第一个源，链的落地来自第二个源
    const { dto } = await h.store.createSubscription({
      name: "跨源",
      sourceIds: [sources[0].id],
      chainIds: ["chain-1"],
    });
    const sub = await h.store.findSubscriptionByToken(dto.link.split("/sub/")[1]);
    const result = await generateSubscription(h.deps, sub!, { onDemand: false });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(proxiesFrom(result.cache.yaml).map((proxy) => proxy.name)).toEqual(["a", "b"]);
  });

  it("高级分组的按源过滤真正生效，且 _sourceIds 不进 YAML", async () => {
    const sources = await h.store.saveSources([
      { name: "a", kind: "remote", url: "https://a.example.com/sub" },
      { name: "b", kind: "remote", url: "https://b.example.com/sub" },
    ]);
    await h.store.putSnapshot({
      sourceId: sources[0].id,
      nodes: [{ name: "a", type: "ss", server: "example.com", port: 8388, cipher: "aes-256-gcm", password: "x" }],
      nodeCount: 1,
      fetchedAt: "2026-10-01T00:00:00.000Z",
      parseErrors: [],
    });
    await h.store.putSnapshot({
      sourceId: sources[1].id,
      nodes: [{ name: "b", type: "ss", server: "example.com", port: 8389, cipher: "aes-256-gcm", password: "x" }],
      nodeCount: 1,
      fetchedAt: "2026-10-01T00:00:00.000Z",
      parseErrors: [],
    });
    await h.store.putConfig({
      enabledGroups: ["select", "auto", "final"],
      proxyGroupAdvanced: { final: { sourceIds: [sources[0].id] } },
    });

    const { dto } = await h.store.createSubscription({ name: "all", sourceIds: [] });
    const sub = await h.store.findSubscriptionByToken(dto.link.split("/sub/")[1]);
    const result = await generateSubscription(h.deps, sub!, { onDemand: false });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    // 内部标记只用于生成期，不能漏进订阅
    expect(result.cache.yaml).not.toContain("_sourceIds");

    const parsed = yaml.load(result.cache.yaml) as {
      "proxy-groups": Array<{ name: string; proxies: string[] }>;
    };
    const finalGroup = parsed["proxy-groups"].find((group) => group.name === "🐟 漏网之鱼");
    expect(finalGroup?.proxies).toContain("a");
    expect(finalGroup?.proxies).not.toContain("b");
  });

  it("returns no-nodes when no snapshot has nodes", async () => {
    await h.store.saveSources([{ name: "empty", kind: "manual", manualText: "ss://x" }]);
    const { dto } = await h.store.createSubscription({ name: "empty", sourceIds: [] });
    const sub = await h.store.findSubscriptionByToken(dto.link.split("/sub/")[1]);
    const result = await generateSubscription(h.deps, sub!, { onDemand: false });
    expect(result).toEqual({ kind: "no-nodes" });
  });
});

describe("previewConfig", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
  });

  async function dumpKv(kv: MemoryKV): Promise<Array<[string, string | undefined]>> {
    const { keys } = await kv.list();
    return keys.map(({ name }) => [name, kv.raw(name)]);
  }

  it("previews a draft from existing snapshots only and writes nothing", async () => {
    const fetchSpy = vi.fn(async () => okResponse(base64Subscription([ssNode("fresh", 8400)])));
    h.deps.fetchText = fetchSpy as unknown as PipelineDeps["fetchText"];
    const sources = await h.store.saveSources([
      { name: "a", kind: "remote", url: "https://a.example.com/sub" },
      { name: "b", kind: "remote", url: "https://b.example.com/sub" },
      { name: "off", kind: "remote", url: "https://c.example.com/sub", enabled: false },
    ]);
    await h.store.putSnapshot({
      sourceId: sources[0].id,
      nodes: [{ name: "a", type: "ss", server: "example.com", port: 8388, cipher: "aes-256-gcm", password: "x" }],
      nodeCount: 1,
      fetchedAt: "2026-10-01T00:00:00.000Z",
      parseErrors: [],
    });
    await h.store.putSnapshot({
      sourceId: sources[2].id,
      nodes: [{ name: "off", type: "ss", server: "example.com", port: 8390, cipher: "aes-256-gcm", password: "x" }],
      nodeCount: 1,
      fetchedAt: "2026-10-01T00:00:00.000Z",
      parseErrors: [],
    });
    const before = await dumpKv(h.kv);

    const result = await previewConfig(h.deps, {
      enabledGroups: ["select", "auto", "final"],
      customRules: [{ id: "r1", type: "DOMAIN-SUFFIX", value: "example.org", target: "DIRECT" }],
    });

    expect(result).toEqual({
      ok: true,
      preview: {
        // 停用的源不参与；b 没有快照，预览也不替它去抓上游
        sourceCount: 2,
        snapshotCount: 1,
        nodeCount: 1,
        proxyGroupCount: 3,
        ruleProviderCount: 0,
        rules: ["DOMAIN-SUFFIX,example.org,DIRECT", "MATCH,🐟 漏网之鱼"],
        chains: [],
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await dumpKv(h.kv)).toEqual(before);
  });

  it("预览返回每条链的匹配数量与不生成的原因", async () => {
    const sources = await h.store.saveSources([
      { name: "relay", kind: "remote", url: "https://relay.example.com/sub" },
      { name: "landing", kind: "remote", url: "https://landing.example.com/sub" },
    ]);
    const relayNode = { name: "中转东京", type: "ss", server: "example.com", port: 8391, cipher: "aes-256-gcm", password: "x" } as ParsedNode;
    const landingNode = { name: "落地洛杉矶", type: "ss", server: "example.com", port: 8392, cipher: "aes-256-gcm", password: "x" } as ParsedNode;
    await h.store.putSnapshot({
      sourceId: sources[0].id,
      nodes: [relayNode],
      nodeCount: 1,
      fetchedAt: "2026-10-01T00:00:00.000Z",
      parseErrors: [],
    });
    await h.store.putSnapshot({
      sourceId: sources[1].id,
      nodes: [landingNode],
      nodeCount: 1,
      fetchedAt: "2026-10-01T00:00:00.000Z",
      parseErrors: [],
    });

    const relayRef = { sourceId: sources[0].id, nodeKey: nodeRenameKey(relayNode as never) };
    const landingRef = { sourceId: sources[1].id, nodeKey: nodeRenameKey(landingNode as never) };
    const result = await previewConfig(h.deps, {
      enabledGroups: ["select", "auto", "final"],
      proxyChains: [
        {
          id: "chain-1",
          name: "🇺🇸 美国链",
          relayNodes: [relayRef],
          landingNodes: [landingRef],
        },
        {
          id: "chain-2",
          name: "🇺🇸 空链",
          relayNodes: [relayRef],
          landingNodes: [{ sourceId: sources[1].id, nodeKey: "0000000000000000" }],
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.chains).toEqual([
      expect.objectContaining({
        id: "chain-1",
        exitGroupName: "🇺🇸 美国链",
        relayGroupName: "🇺🇸 美国链 · 前置",
        relayCount: 1,
        landingCount: 1,
        status: "ok",
        active: true,
      }),
      expect.objectContaining({
        id: "chain-2",
        relayCount: 0,
        landingCount: 0,
        status: "empty-landing",
        active: false,
      }),
    ]);
  });

  it("resolves preview chains against the same node set generation uses", async () => {
    // 两个同名节点：生成会做唯一化改名，预览若用原始快照解析，落地数量就会对不上
    const sources = await h.store.saveSources([
      { name: "演示源", kind: "remote", url: "https://demo.example.com/sub" },
    ]);
    const relayNode = { name: "中转东京", type: "ss", server: "example.com", port: 8391, cipher: "aes-256-gcm", password: "x" } as ParsedNode;
    const landingNode = { name: "落地", type: "ss", server: "example.com", port: 8392, cipher: "aes-256-gcm", password: "x" } as ParsedNode;
    await h.store.putSnapshot({
      sourceId: sources[0].id,
      nodes: [relayNode, landingNode],
      nodeCount: 2,
      fetchedAt: "2026-10-01T00:00:00.000Z",
      parseErrors: [],
    });

    const result = await previewConfig(h.deps, {
      enabledGroups: ["select", "auto", "final"],
      proxyChains: [
        {
          id: "chain-x",
          name: "🇺🇸 一致性链",
          relayNodes: [{ sourceId: sources[0].id, nodeKey: nodeRenameKey(relayNode as never) }],
          landingNodes: [{ sourceId: sources[0].id, nodeKey: nodeRenameKey(landingNode as never) }],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [chain] = result.preview.chains;
    // 状态与计数必须与真正生成的结果一致：能生成、落地就是 1 个
    expect(chain).toMatchObject({ status: "ok", active: true, landingCount: 1, relayCount: 1 });
  });

  it("returns generation failures as a result instead of throwing", async () => {
    const result = await previewConfig(h.deps, { dnsYaml: "dns: [" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("YAML");
  });
});

describe("getOrGenerateSubscription", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
  });

  it("returns not-found for an unknown token", async () => {
    await expect(getOrGenerateSubscription(h.deps, "unknown")).resolves.toEqual({
      kind: "not-found",
    });
  });

  it("regenerates when the config hash changes", async () => {
    await h.store.saveSources([{ name: "m", kind: "manual", manualText: ssNode("m", 8388) }]);
    const { dto, token } = await h.store.createSubscription({ name: "s", sourceIds: [] });

    const first = await getOrGenerateSubscription(h.deps, token);
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") return;
    const firstHash = first.cache.configHash;
    expect(proxiesFrom(first.cache.yaml)).toHaveLength(1);

    await h.store.putConfig({ mixedPort: 45678 });
    const second = await getOrGenerateSubscription(h.deps, token);
    expect(second.kind).toBe("ok");
    if (second.kind !== "ok") return;
    expect(second.cache.configHash).not.toBe(firstHash);
    const parsed = yaml.load(second.cache.yaml) as Record<string, unknown>;
    expect(parsed["mixed-port"]).toBe(45678);
    expect(dto.id).toBe(second.sub.id);
  });

  it("reuses the cache when the config hash matches", async () => {
    await h.store.saveSources([{ name: "m", kind: "manual", manualText: ssNode("m", 8388) }]);
    const { token } = await h.store.createSubscription({ name: "s", sourceIds: [] });
    const first = await getOrGenerateSubscription(h.deps, token);
    expect(first.kind).toBe("ok");
    const cached: CacheRecord | null = await h.store.getCache(first.kind === "ok" ? first.sub.id : "");
    const second = await getOrGenerateSubscription(h.deps, token);
    expect(second.kind).toBe("ok");
    if (second.kind !== "ok") return;
    expect(second.cache.generatedAt).toBe(cached?.generatedAt);
  });

  /**
   * 回归：源节点内容更新后（节点数与 YAML 字节长度都没变），ETag 必须跟着内容变。
   * 否则客户端带 If-None-Match 会一直拿到 304、继续沿用旧节点，直到用户重新绑定源。
   */
  it("节点数相同但节点内容变化时 ETag 必须变化", async () => {
    const [source] = await h.store.saveSources([{ name: "m", kind: "manual", manualText: ssNode("seed", 8388) }]);
    const { token, dto } = await h.store.createSubscription({ name: "s", sourceIds: [source.id] });

    const nodesOn = (server: string) =>
      [
        { name: "n1", type: "ss", server, port: 8388, cipher: "aes-256-gcm", password: "x" },
        { name: "n2", type: "ss", server, port: 8389, cipher: "aes-256-gcm", password: "x" },
      ] as unknown as ParsedNode[];

    await h.store.putSnapshot({
      sourceId: source.id,
      nodes: nodesOn("a1.example.com"),
      nodeCount: 2,
      fetchedAt: "2026-10-01T00:00:00.000Z",
      parseErrors: [],
    });
    const first = await getOrGenerateSubscription(h.deps, token);
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") return;
    const firstEtag = await buildCacheETag(first.cache);

    // 模拟源被刷新后的重新生成：节点数与 YAML 长度都一样，只有节点内容不同
    await h.store.putSnapshot({
      sourceId: source.id,
      nodes: nodesOn("b1.example.com"),
      nodeCount: 2,
      fetchedAt: "2026-10-02T00:00:00.000Z",
      parseErrors: [],
    });
    await h.store.deleteCache(dto.id);
    const second = await getOrGenerateSubscription(h.deps, token);
    expect(second.kind).toBe("ok");
    if (second.kind !== "ok") return;

    expect(second.cache.yaml).not.toBe(first.cache.yaml);
    // 前提守护：长度与节点数都相同 —— 只按「节点数 + 长度」算 ETag 的旧实现必然给出同一个值
    expect(second.cache.yaml.length).toBe(first.cache.yaml.length);
    expect(second.cache.nodeCount).toBe(first.cache.nodeCount);
    expect(await buildCacheETag(second.cache)).not.toBe(firstEtag);
  });

  it("重新生成内容完全相同的 YAML 时 ETag 保持不变", async () => {
    const [source] = await h.store.saveSources([{ name: "m", kind: "manual", manualText: ssNode("seed", 8388) }]);
    const { token, dto } = await h.store.createSubscription({ name: "s", sourceIds: [source.id] });
    await h.store.putSnapshot({
      sourceId: source.id,
      nodes: [
        { name: "n1", type: "ss", server: "a1.example.com", port: 8388, cipher: "aes-256-gcm", password: "x" },
      ] as unknown as ParsedNode[],
      nodeCount: 1,
      fetchedAt: "2026-10-01T00:00:00.000Z",
      parseErrors: [],
    });

    const first = await getOrGenerateSubscription(h.deps, token);
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") return;

    await h.store.deleteCache(dto.id);
    const again = await getOrGenerateSubscription(h.deps, token);
    expect(again.kind).toBe("ok");
    if (again.kind !== "ok") return;

    // 内容没变时 ETag 必须稳定，否则客户端每次都要重新下载整份 YAML
    expect(again.cache.yaml).toBe(first.cache.yaml);
    expect(await buildCacheETag(again.cache)).toBe(await buildCacheETag(first.cache));
  });
  it("升级前没有 contentHash 的旧缓存记录也按内容摘要算 ETag", async () => {
    const [source] = await h.store.saveSources([{ name: "m", kind: "manual", manualText: ssNode("m", 8388) }]);
    const { token } = await h.store.createSubscription({ name: "s", sourceIds: [source.id] });
    const first = await getOrGenerateSubscription(h.deps, token);
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") return;

    // 模拟升级前写入的缓存记录：没有 contentHash（KV 序列化也会丢掉 undefined）
    const legacy = { ...first.cache, contentHash: undefined };
    await h.store.putCache(legacy);

    const etag = await buildCacheETag(legacy);
    expect(etag).toBe(await buildCacheETag(first.cache));
    // 不能退回旧口径（配置哈希 + 节点数 + 长度），否则又会出现假命中
    expect(etag).not.toBe(
      `"${first.cache.configHash.slice(0, 16)}-${first.cache.nodeCount}-${first.cache.yaml.length}"`
    );
  });
  it("returns no-nodes when every source is empty", async () => {
    await h.store.saveSources([{ name: "m", kind: "manual", manualText: "ss://x" }]);
    const { token } = await h.store.createSubscription({ name: "s", sourceIds: [] });
    const result = await getOrGenerateSubscription(h.deps, token);
    expect(result.kind).toBe("no-nodes");
  });
});

describe("refreshAll", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
  });

  it("returns skipped when the lock is already held", async () => {
    await h.store.acquireLock("someone-else");
    await expect(refreshAll(h.deps, { trigger: "cron" })).resolves.toEqual({ skipped: "locked" });
  });

  it("records cron trigger and duration", async () => {
    await h.store.saveSources([{ name: "m", kind: "manual", manualText: ssNode("m", 8388) }]);
    const result = await refreshAll(h.deps, { trigger: "cron" });
    expect("status" in result).toBe(true);
    if (!("status" in result)) return;
    expect(result.status.lastTrigger).toBe("cron");
    expect(result.status.durationMs).toBeGreaterThanOrEqual(0);
    const stored = await h.store.getStatus();
    expect(stored?.lastTrigger).toBe("cron");
    // 锁应被释放
    await expect(h.store.acquireLock("again")).resolves.toBe(true);
  });

  it("stops starting new fetches after the soft deadline", async () => {
    const t0 = Date.parse("2026-10-12T00:00:00.000Z");
    // now() 调用顺序：owner、startedAt、源 a 的截止检查（通过）、源 b 的截止检查（超时）
    h.clock.set([t0, t0 + 1000, t0 + 1000, t0 + 13 * 60 * 1000]);
    const fetchImpl = vi.fn(async (url: string) =>
      okResponse(base64Subscription([ssNode(url, 8388)]))
    );
    h.deps.fetchText = fetchImpl as unknown as PipelineDeps["fetchText"];

    const sources = await h.store.saveSources([
      { name: "a", kind: "remote", url: "https://a.example.com/sub" },
      { name: "b", kind: "remote", url: "https://b.example.com/sub" },
    ]);
    const result = await refreshAll(h.deps, { trigger: "manual" });
    expect("status" in result).toBe(true);
    if (!("status" in result)) return;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const bStatus = result.status.sources.find((item) => item.sourceId === sources[1].id);
    expect(bStatus?.ok).toBe(false);
    expect(bStatus?.error).toBe("deadline-exceeded");
  });

  it("aggregates userinfo only when every remote source provides all fields", async () => {
    h.deps.fetchText = (async (url: string) => {
      if (url === "https://a.example.com/sub") {
        return okResponse(base64Subscription([ssNode("a", 8388)]), {
          "subscription-userinfo": "upload=1; download=2; total=3; expire=1900000000",
        });
      }
      return okResponse(base64Subscription([ssNode("b", 8389)]), {
        "subscription-userinfo": "upload=10; download=20; total=30; expire=1800000000",
      });
    }) as unknown as PipelineDeps["fetchText"];

    await h.store.saveSources([
      { name: "a", kind: "remote", url: "https://a.example.com/sub" },
      { name: "b", kind: "remote", url: "https://b.example.com/sub" },
    ]);
    const { token } = await h.store.createSubscription({ name: "s", sourceIds: [] });
    const result = await getOrGenerateSubscription(h.deps, token);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.info).toEqual({ upload: 11, download: 22, total: 33, expire: 1800000000 });
  });

  it("returns null userinfo when only one source provides it", async () => {
    h.deps.fetchText = (async (url: string) => {
      if (url === "https://a.example.com/sub") {
        return okResponse(base64Subscription([ssNode("a", 8388)]), {
          "subscription-userinfo": "upload=1; download=2; total=3; expire=1900000000",
        });
      }
      return okResponse(base64Subscription([ssNode("b", 8389)]));
    }) as unknown as PipelineDeps["fetchText"];

    await h.store.saveSources([
      { name: "a", kind: "remote", url: "https://a.example.com/sub" },
      { name: "b", kind: "remote", url: "https://b.example.com/sub" },
    ]);
    const { token } = await h.store.createSubscription({ name: "s", sourceIds: [] });
    const result = await getOrGenerateSubscription(h.deps, token);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.info).toBeNull();
  });

  it("ignores manual sources when aggregating userinfo", async () => {
    h.deps.fetchText = (async () =>
      okResponse(base64Subscription([ssNode("a", 8388)]), {
        "subscription-userinfo": "upload=1; download=2; total=3; expire=1900000000",
      })) as unknown as PipelineDeps["fetchText"];

    await h.store.saveSources([
      { name: "a", kind: "remote", url: "https://a.example.com/sub" },
      { name: "m", kind: "manual", manualText: ssNode("m", 8389) },
    ]);
    const { token } = await h.store.createSubscription({ name: "s", sourceIds: [] });
    const result = await getOrGenerateSubscription(h.deps, token);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.info).toEqual({ upload: 1, download: 2, total: 3, expire: 1900000000 });
  });

  it("writes a cache with TTL and a stable config hash", async () => {
    await h.store.saveSources([{ name: "m", kind: "manual", manualText: ssNode("m", 8388) }]);
    const { token, dto } = await h.store.createSubscription({ name: "s", sourceIds: [] });
    const result = await getOrGenerateSubscription(h.deps, token);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(h.kv.expirationTtls.get(`cache:${dto.id}`)).toBe(172800);
    const { config } = await h.store.getConfig();
    const stored = await h.store.findSubscriptionByToken(token);
    expect(result.cache.configHash).toBe(await computeSubscriptionCacheHash(config, stored!));
    expect(h.kv.has(snapshotKey((await h.store.listSources())[0].id))).toBe(true);
    // 缓存记录带上 YAML 内容摘要：ETag 由它派生，内容变了才会变
    expect(result.cache.contentHash).toBe(await sha256Hex(result.cache.yaml));
  });

  it("勾选链后即使配置没变也会重新生成，前置组随之出现", async () => {
    const sources = await h.store.saveSources([
      { name: "m", kind: "manual", manualText: `${ssNode("relay", 8388)}\n${ssNode("landing", 8389)}` },
    ]);
    const relayNode = {
      name: "relay",
      type: "ss",
      server: "example.com",
      port: 8388,
      cipher: "aes-256-gcm",
      password: "x",
    } as ParsedNode;
    const landingNode = {
      name: "landing",
      type: "ss",
      server: "example.com",
      port: 8389,
      cipher: "aes-256-gcm",
      password: "x",
    } as ParsedNode;
    await h.store.putSnapshot({
      sourceId: sources[0].id,
      nodes: [relayNode, landingNode],
      nodeCount: 2,
      fetchedAt: "2026-10-01T00:00:00.000Z",
      parseErrors: [],
    });
    await h.store.putConfig({
      enabledGroups: ["select", "auto", "final"],
      proxyChains: [
        {
          id: "chain-e2e",
          name: "跨源链",
          relayNodes: [{ sourceId: sources[0].id, nodeKey: nodeRenameKey(relayNode as never) }],
          landingNodes: [{ sourceId: sources[0].id, nodeKey: nodeRenameKey(landingNode as never) }],
        },
      ],
    });

    const { token, dto } = await h.store.createSubscription({ name: "s", sourceIds: [], chainIds: [] });
    const before = await getOrGenerateSubscription(h.deps, token);
    expect(before.kind).toBe("ok");
    if (before.kind !== "ok") return;
    expect(groupNamesFrom(before.cache.yaml)).not.toContain("跨源链");

    // 只改订阅的链勾选，配置一个字都不动
    await h.store.updateSubscription(dto.id, { chainIds: ["chain-e2e"] }, "");
    const after = await getOrGenerateSubscription(h.deps, token);
    expect(after.kind).toBe("ok");
    if (after.kind !== "ok") return;
    expect(groupNamesFrom(after.cache.yaml)).toEqual(expect.arrayContaining(["跨源链", "跨源链 · 前置"]));
    const landing = proxiesFrom(after.cache.yaml).find((proxy) => proxy.name === "landing") as unknown as
      | Record<string, unknown>
      | undefined;
    expect(landing?.["dialer-proxy"]).toBe("跨源链 · 前置");
  });

  it("缓存哈希包含订阅勾选与生成器版本", async () => {
    const { config } = await h.store.getConfig();
    const base = { sourceIds: [] as string[], chainIds: [] as string[] };
    const current = await computeSubscriptionCacheHash(config, base);
    expect(current).toBe(await computeSubscriptionCacheHash(config, base));
    expect(await computeSubscriptionCacheHash(config, { sourceIds: [], chainIds: ["x"] })).not.toBe(current);
    expect(await computeSubscriptionCacheHash(config, { sourceIds: ["s"], chainIds: [] })).not.toBe(current);
    expect(current).not.toBe(await computeConfigHash(config));
  });

  it("升级前只按配置哈希留下的旧缓存不再复用", async () => {
    await h.store.saveSources([{ name: "m", kind: "manual", manualText: ssNode("m", 8388) }]);
    const { token } = await h.store.createSubscription({ name: "s", sourceIds: [] });
    const first = await getOrGenerateSubscription(h.deps, token);
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") return;

    // 旧口径：哈希只由 config 决定，代码升级不会让它失效
    const { config } = await h.store.getConfig();
    const legacyHash = await sha256Hex(stableJsonStringify(config));
    await h.store.putCache({ ...first.cache, yaml: "legacy: true", configHash: legacyHash });

    const second = await getOrGenerateSubscription(h.deps, token);
    expect(second.kind).toBe("ok");
    if (second.kind !== "ok") return;
    expect(second.cache.yaml).not.toBe("legacy: true");
    expect(second.cache.configHash).toBe(await computeSubscriptionCacheHash(config, second.sub));
  });
});


describe("normalizeConfigForGeneration", () => {
  it("drops a blank dnsYaml and keeps everything else", () => {
    expect(normalizeConfigForGeneration({ dnsYaml: "", mixedPort: 1 })).toEqual({ mixedPort: 1 });
    expect(normalizeConfigForGeneration({ dnsYaml: "  \n", mixedPort: 1 })).toEqual({ mixedPort: 1 });
  });

  it("keeps an explicit base config yaml and configs without dnsYaml untouched", () => {
    const explicit = { dnsYaml: "mixed-port: 1234\n", mixedPort: 1 };
    expect(normalizeConfigForGeneration(explicit)).toBe(explicit);
    const plain = { mixedPort: 1 };
    expect(normalizeConfigForGeneration(plain)).toBe(plain);
  });
});

describe("default config base sections", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
    await h.store.saveSources([{ name: "m", kind: "manual", manualText: ssNode("m", 8388) }]);
  });

  it("emits the default general section although the stored default config carries an empty dnsYaml", async () => {
    const { token } = await h.store.createSubscription({ name: "s", sourceIds: [] });
    const { config } = await h.store.getConfig();
    expect(config.dnsYaml).toBe("");

    const result = await getOrGenerateSubscription(h.deps, token);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const parsed = yaml.load(result.cache.yaml) as Record<string, unknown>;
    expect(parsed["mixed-port"]).toBe(7897);
    expect(parsed.dns).toBeDefined();
  });

  it("applies mixedPort edits made on the full default config", async () => {
    const { token } = await h.store.createSubscription({ name: "s", sourceIds: [] });
    const { config } = await h.store.getConfig();
    await h.store.putConfig({ ...config, mixedPort: 45678 });

    const result = await getOrGenerateSubscription(h.deps, token);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const parsed = yaml.load(result.cache.yaml) as Record<string, unknown>;
    expect(parsed["mixed-port"]).toBe(45678);
  });

  it("lets a non-empty dnsYaml override the default base sections", async () => {
    const { token } = await h.store.createSubscription({ name: "s", sourceIds: [] });
    const { config } = await h.store.getConfig();
    await h.store.putConfig({ ...config, dnsYaml: "mixed-port: 1234\n" });

    const result = await getOrGenerateSubscription(h.deps, token);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const parsed = yaml.load(result.cache.yaml) as Record<string, unknown>;
    expect(parsed["mixed-port"]).toBe(1234);
  });
});

describe("cache-hit path stays cheap", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
  });

  it("keeps the cached response path at a constant number of KV operations", async () => {
    await h.store.saveSources(
      Array.from({ length: 12 }, (_, index) => ({
        name: `m${index}`,
        kind: "manual" as const,
        manualText: ssNode(`m${index}`, 8400 + index),
      }))
    );
    const { token } = await h.store.createSubscription({ name: "s", sourceIds: [] });
    await getOrGenerateSubscription(h.deps, token);

    const before = h.kv.operationCount;
    const result = await getOrGenerateSubscription(h.deps, token);
    const used = h.kv.operationCount - before;

    expect(result.kind).toBe("ok");
    // 与源数量无关：tokidx + subs + config + cache + sources = 5。
    // 全 manual 源时 resolveCachedInfo 会提前返回，连快照都不读。
    expect(used).toBe(5);
  });


  it("keeps the path constant even when every source is remote", async () => {
    h.deps.fetchText = (async (url: string) =>
      okResponse(base64Subscription([ssNode(url.slice(-8), 8388 + url.length)]), {
        "subscription-userinfo": "upload=1; download=2; total=3",
      })) as unknown as PipelineDeps["fetchText"];

    await h.store.saveSources(
      Array.from({ length: 12 }, (_, index) => ({
        name: `r${index}`,
        kind: "remote" as const,
        url: `https://r${index}.example.com/sub`,
      }))
    );
    const { token } = await h.store.createSubscription({ name: "s", sourceIds: [] });
    const first = await getOrGenerateSubscription(h.deps, token);
    expect(first.kind).toBe("ok");

    const before = h.kv.operationCount;
    const second = await getOrGenerateSubscription(h.deps, token);
    const used = h.kv.operationCount - before;

    expect(second.kind).toBe("ok");
    if (second.kind !== "ok") return;
    // 12 个 remote 源仍然只是 6 次操作（快照走一次批量读），不随源数量线性增长
    expect(used).toBe(6);
    expect(second.info).toEqual({ upload: 12, download: 24, total: 36 });
  });
  it("reads all snapshots with a single bulk KV operation", async () => {
    const sources = await h.store.saveSources(
      Array.from({ length: 8 }, (_, index) => ({
        name: `m${index}`,
        kind: "manual" as const,
        manualText: ssNode(`m${index}`, 8500 + index),
      }))
    );
    await Promise.all(
      sources.map((source, index) =>
        h.store.putSnapshot({
          sourceId: source.id,
          nodes: [{ name: `m${index}`, type: "ss", server: "example.com", port: 8500 + index, cipher: "aes-256-gcm", password: "x" }],
          nodeCount: 1,
          fetchedAt: "2026-10-01T00:00:00.000Z",
          parseErrors: [],
        })
      )
    );

    const before = h.kv.operationCount;
    const snapshots = await h.store.getSnapshots(sources.map((source) => source.id));
    // 8 个源只算 1 次外部操作
    expect(h.kv.operationCount - before).toBe(1);
    expect(snapshots).toHaveLength(8);
    expect(snapshots.every((snapshot) => snapshot !== null)).toBe(true);
  });

  it("returns null entries for missing snapshots without failing the batch", async () => {
    const [source] = await h.store.saveSources([
      { name: "m", kind: "manual", manualText: ssNode("m", 8388) },
    ]);
    const snapshots = await h.store.getSnapshots([source.id, "missing-id"]);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toBeNull();
    expect(snapshots[1]).toBeNull();
  });
});

describe("on-demand refresh", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
  });

  it("fetches missing snapshots concurrently instead of serially", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    h.deps.fetchText = (async (url: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return okResponse(base64Subscription([ssNode(url.slice(-8), 8388)]));
    }) as unknown as PipelineDeps["fetchText"];

    await h.store.saveSources(
      Array.from({ length: 6 }, (_, index) => ({
        name: `r${index}`,
        kind: "remote" as const,
        url: `https://r${index}.example.com/sub`,
      }))
    );
    const { token } = await h.store.createSubscription({ name: "s", sourceIds: [] });
    const result = await getOrGenerateSubscription(h.deps, token);

    expect(result.kind).toBe("ok");
    // 串行实现下 maxInFlight 恒为 1
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("still returns a usable config when one on-demand fetch fails", async () => {
    h.deps.fetchText = (async (url: string) => {
      if (url.includes("bad")) return { status: 500, headers: {}, text: "boom", finalUrl: url };
      return okResponse(base64Subscription([ssNode("ok", 8388)]));
    }) as unknown as PipelineDeps["fetchText"];

    await h.store.saveSources([
      { name: "good", kind: "remote", url: "https://good.example.com/sub" },
      { name: "bad", kind: "remote", url: "https://bad.example.com/sub" },
    ]);
    const { token } = await h.store.createSubscription({ name: "s", sourceIds: [] });
    const result = await getOrGenerateSubscription(h.deps, token);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.cache.nodeCount).toBe(1);
  });
});
