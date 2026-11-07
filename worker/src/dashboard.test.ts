import { describe, expect, it } from "vitest";
import type { ParsedNode } from "@subboost/core/types/node";
import { buildDashboardStats } from "./dashboard";
import { nodeRenameKey } from "./node-renames";
import type { SnapshotRecord, SourceDto, StatusRecord, SubscriptionDto } from "./types";

function source(overrides: Partial<SourceDto> = {}): SourceDto {
  return {
    id: "s1",
    name: "机场 A",
    kind: "remote",
    url: "https://example.com/sub",
    enabled: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function node(name: string, type: string, port: number): ParsedNode {
  return {
    name,
    type,
    server: "example.com",
    port,
    cipher: "aes-256-gcm",
    password: "p",
  } as unknown as ParsedNode;
}

function snapshot(sourceId: string, nodes: ParsedNode[]): SnapshotRecord {
  return {
    sourceId,
    nodes,
    nodeCount: nodes.length,
    fetchedAt: "2026-10-12T00:00:00.000Z",
    parseErrors: [],
  };
}

function subscription(overrides: Partial<SubscriptionDto> = {}): SubscriptionDto {
  return {
    id: "sub1",
    name: "默认订阅",
    sourceIds: [],
    chainIds: [],
    link: "https://worker.example.com/sub/token",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

const STATUS: StatusRecord = {
  lastRunAt: "2026-10-12T00:00:00.000Z",
  lastTrigger: "cron",
  durationMs: 1234,
  sources: [
    { sourceId: "s1", ok: true, nodeCount: 3 },
    { sourceId: "s2", ok: false, error: "HTTP 502" },
  ],
  subscriptions: [{ subscriptionId: "sub1", ok: true, nodeCount: 3 }],
};

describe("buildDashboardStats", () => {
  it("aggregates source, subscription and node counts", () => {
    const s1 = source();
    const s2 = source({ id: "s2", name: "手动节点", kind: "manual", url: undefined, manualText: "ss://x" });
    const snapshots = new Map<string, SnapshotRecord | null>([
      ["s1", snapshot("s1", [node("a", "ss", 8001), node("b", "ss", 8002), node("c", "vless", 8003)])],
      ["s2", null],
    ]);

    const stats = buildDashboardStats({
      sources: [s1, s2],
      subscriptions: [subscription(), subscription({ id: "sub2", sourceIds: ["s1"] })],
      status: STATUS,
      snapshots,
      generatedAt: "2026-10-12T00:00:00.000Z",
    });

    expect(stats.sources).toEqual({ total: 2, enabled: 2, remote: 1, manual: 1 });
    expect(stats.subscriptions).toEqual({ total: 2, allSources: 1, scoped: 1 });
    expect(stats.nodes.total).toBe(3);
    expect(stats.nodes.protocols).toEqual([
      { type: "ss", count: 2 },
      { type: "vless", count: 1 },
    ]);
    expect(stats.lastRun).toMatchObject({ sourceOk: 1, sourceFailed: 1, subscriptionOk: 1 });
    expect(stats.sourceStats.map((item) => item.sourceId)).toEqual(["s1", "s2"]);
  });

  it("excludes disabled sources from node totals and protocol mix", () => {
    const enabled = source();
    const disabled = source({ id: "s2", name: "停用源", enabled: false });
    const snapshots = new Map<string, SnapshotRecord | null>([
      ["s1", snapshot("s1", [node("a", "ss", 8001)])],
      ["s2", snapshot("s2", [node("b", "trojan", 8443), node("c", "trojan", 8444)])],
    ]);

    const stats = buildDashboardStats({
      sources: [enabled, disabled],
      subscriptions: [],
      status: null,
      snapshots,
      generatedAt: "2026-10-12T00:00:00.000Z",
    });

    expect(stats.sources.enabled).toBe(1);
    expect(stats.nodes.total).toBe(1);
    expect(stats.nodes.protocols).toEqual([{ type: "ss", count: 1 }]);
    expect(stats.sourceStats[1]).toMatchObject({ enabled: false, nodeCount: 2 });
    expect(stats.lastRun).toBeNull();
  });

  it("counts renamed nodes per source", () => {
    const s1 = source();
    const renamedNode = node("香港 01", "ss", 8001);
    const plainNode = node("东京 02", "ss", 8002);
    s1.nodeRenames = { [nodeRenameKey(renamedNode)]: "HK-01" };
    const snapshots = new Map<string, SnapshotRecord | null>([
      ["s1", snapshot("s1", [renamedNode, plainNode])],
    ]);

    const stats = buildDashboardStats({
      sources: [s1],
      subscriptions: [subscription()],
      status: null,
      snapshots,
      generatedAt: "2026-10-12T00:00:00.000Z",
    });

    expect(stats.nodes.renamed).toBe(1);
    expect(stats.sourceStats[0].renamedCount).toBe(1);
  });

  it("collects actionable warnings", () => {
    const s1 = source();
    const s2 = source({ id: "s2", name: "手动节点", kind: "manual" });
    const stats = buildDashboardStats({
      sources: [s1, s2],
      subscriptions: [subscription({ id: "sub1", name: "默认订阅" })],
      status: {
        ...STATUS,
        sources: [{ sourceId: "s1", ok: false, error: "HTTP 502" }],
        subscriptions: [{ subscriptionId: "sub1", ok: false, error: "no-nodes" }],
      },
      snapshots: new Map<string, SnapshotRecord | null>([
        ["s1", snapshot("s1", [node("a", "ss", 8001)])],
        ["s2", null],
      ]),
      generatedAt: "2026-10-12T00:00:00.000Z",
    });

    const messages = stats.warnings.map((item) => item.message);
    expect(messages).toContain("源「机场 A」最近刷新失败：HTTP 502");
    expect(messages).toContain("源「手动节点」还没有节点快照，订阅首次访问时会即时抓取。");
    expect(messages).toContain("订阅「默认订阅」生成失败：no-nodes");
  });

  it("warns about an empty configuration", () => {
    const stats = buildDashboardStats({
      sources: [],
      subscriptions: [],
      status: null,
      snapshots: new Map(),
      generatedAt: "2026-10-12T00:00:00.000Z",
    });
    expect(stats.warnings.map((item) => item.message)).toEqual([
      "还没有添加任何源，先导入一个上游订阅或手动节点。",
    ]);
    expect(stats.nodes).toEqual({ total: 0, renamed: 0, protocols: [] });
  });
});
