import { describe, expect, it } from "vitest";
import yaml from "js-yaml";
import type { ParsedNode } from "@subboost/core/types/node";
import type { ChainNodeRef } from "@subboost/core/types/config";
import { nodeRenameKey } from "@subboost/core/node-rename-key";
import { generateClashYaml } from "./index";
import { stripDanglingDialerProxy } from "./chain";
import { buildGenerateOptionsFromConfig } from "../subscription/config-utils";

/**
 * mihomo 加载配置时会校验 dialer-proxy 的引用（`config/utils.go` 的 validateDialerProxies）：
 * 目标既不在 proxies 也不在 proxy-groups 里，整份配置直接校验失败，客户端提示
 * 「订阅已保存，但未能确认已应用到内核」。所以生成物必须满足这条不变量。
 */

const SRC = "src-1";

function ss(name: string, host: string, patch: Record<string, unknown> = {}): ParsedNode {
  return {
    name,
    type: "ss",
    server: host,
    port: 8388,
    cipher: "aes-128-gcm",
    password: "secret",
    _sourceIds: [SRC],
    ...patch,
  } as ParsedNode;
}

const RELAY = ss("SG-前置", "relay.example.com");
const LANDING = ss("落地-VLESS-Reality-A1", "landing.example.com", {
  type: "vless",
  uuid: "0000",
  tls: true,
});
const LANDING2 = ss("美国落地", "us.example.com");
const OTHER = ss("香港节点", "hk.example.com");
const NODES = [RELAY, LANDING, LANDING2, OTHER];

function ref(node: ParsedNode): ChainNodeRef {
  return { sourceId: SRC, nodeKey: nodeRenameKey(node) };
}

/** 引用一个已经失效的内容指纹（源更新后节点内容变了就是这个状态） */
const STALE: ChainNodeRef = { sourceId: SRC, nodeKey: "stale-fingerprint" };

type Audit = {
  /** 指向前置组的节点：name → dialer-proxy */
  linked: Array<{ node: string; dialer: string }>;
  /** 指向了配置里不存在的名字 */
  dangling: Array<{ node: string; dialer: string }>;
  groupNames: string[];
};

function audit(config: Record<string, unknown>): Audit {
  const text = generateClashYaml(buildGenerateOptionsFromConfig(config, { nodes: NODES }));
  const parsed = yaml.load(text) as Record<string, unknown>;
  const proxies = (parsed.proxies ?? []) as Array<Record<string, unknown>>;
  const groups = (parsed["proxy-groups"] ?? []) as Array<Record<string, unknown>>;
  const known = new Set<string>([
    "DIRECT",
    "REJECT",
    ...proxies.map((proxy) => String(proxy.name)),
    ...groups.map((group) => String(group.name)),
  ]);

  const linked = proxies
    .filter((proxy) => typeof proxy["dialer-proxy"] === "string")
    .map((proxy) => ({ node: String(proxy.name), dialer: String(proxy["dialer-proxy"]) }));

  return {
    linked,
    dangling: linked.filter((item) => !known.has(item.dialer)),
    groupNames: groups.map((group) => String(group.name)),
  };
}

function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("stripDanglingDialerProxy", () => {
  it("摘掉指向不存在名字的 dialer-proxy，其余字段原样保留", () => {
    const nodes = [
      { ...ss("落地", "landing.example.com"), "dialer-proxy": "存在的组" },
      { ...ss("落地2", "landing2.example.com"), "dialer-proxy": "不存在的组" },
    ] as ParsedNode[];

    const out = stripDanglingDialerProxy(nodes, ["存在的组"]);

    expect(out[0]).toMatchObject({ name: "落地", "dialer-proxy": "存在的组" });
    expect(out[1]).toMatchObject({ name: "落地2" });
    expect(out[1]).not.toHaveProperty("dialer-proxy");
  });

  it("名字两侧空白不算数：按修剪后的值比对", () => {
    const nodes = [{ ...ss("落地", "landing.example.com"), "dialer-proxy": "  组A  " }] as ParsedNode[];
    expect(stripDanglingDialerProxy(nodes, ["组A"])[0]).toHaveProperty("dialer-proxy", "  组A  ");
    expect(stripDanglingDialerProxy(nodes, ["组B"])[0]).not.toHaveProperty("dialer-proxy");
  });

  it("没有悬空引用时返回原数组，不制造无谓的拷贝", () => {
    const nodes = [{ ...ss("落地", "landing.example.com"), "dialer-proxy": "组A" }] as ParsedNode[];
    expect(stripDanglingDialerProxy(nodes, ["组A"])).toBe(nodes);
  });

  it("非字符串的 dialer-proxy 不动", () => {
    const nodes = [{ ...ss("落地", "landing.example.com"), "dialer-proxy": 1 }] as unknown as ParsedNode[];
    expect(stripDanglingDialerProxy(nodes, [])[0]).toHaveProperty("dialer-proxy", 1);
  });
});

describe("生成的配置里 dialer-proxy 必须指向真实存在的组", () => {
  const chain = (patch: Record<string, unknown> = {}) => ({
    id: "chain-sg",
    name: "SG",
    relayNodes: [ref(RELAY)],
    landingNodes: [ref(LANDING)],
    ...patch,
  });

  const cases: Array<[string, Record<string, unknown>]> = [
    ["基础链", { proxyChains: [chain()] }],
    ["前置为空", { proxyChains: [chain({ relayNodes: [] })] }],
    ["前置引用失效", { proxyChains: [chain({ relayNodes: [STALE] })] }],
    ["落地引用失效", { proxyChains: [chain({ landingNodes: [STALE] })] }],
    ["前置与落地同节点", { proxyChains: [chain({ relayNodes: [ref(LANDING)] })] }],
    ["前置组 reject-first", { proxyChains: [chain({ relayGroupType: "reject-first" })] }],
    ["前置组 direct-first 且前置为空", { proxyChains: [chain({ relayNodes: [], relayGroupType: "direct-first" })] }],
    ["前置组 load-balance", { proxyChains: [chain({ relayGroupType: "load-balance" })] }],
    ["出口组 direct-first", { proxyChains: [chain({ exitGroupType: "direct-first" })] }],
    ["按 proxyGroupOrder 重排", { proxyChains: [chain()], proxyGroupOrder: ["module:select", "chain:chain-sg"] }],
    ["链被停用", { proxyChains: [chain({ enabled: false })] }],
    ["链名撞内置分组", { proxyChains: [chain({ name: "🚀 节点选择" })] }],
    ["链名撞自定义组", { proxyChains: [chain()], customProxyGroups: [{ id: "c1", name: "SG", members: [] }] }],
    [
      "链名撞旧中转组",
      {
        proxyChains: [chain()],
        dialerProxyGroups: [
          { id: "d1", name: "SG", relayNodes: [String(OTHER.name)], targetNodes: [String(RELAY.name)] },
        ],
      },
    ],
    [
      "旧中转组与链共存",
      {
        proxyChains: [chain()],
        dialerProxyGroups: [
          { id: "d1", name: "旧中转", relayNodes: [String(OTHER.name)], targetNodes: [String(LANDING2.name)] },
        ],
      },
    ],
    [
      "两条链抢同一落地",
      {
        proxyChains: [
          chain(),
          { id: "chain-b", name: "USA", relayNodes: [ref(OTHER)], landingNodes: [ref(LANDING)] },
        ],
      },
    ],
    [
      "一条链的前置是另一条链的落地",
      {
        proxyChains: [
          chain(),
          { id: "chain-b", name: "USA", relayNodes: [ref(LANDING)], landingNodes: [ref(OTHER)] },
        ],
      },
    ],
    ["最小分组开关", { proxyChains: [chain()], enabledGroups: ["select", "auto", "final"] }],
  ];

  it.each(cases)("%s：不产生悬空引用", (_label, config) => {
    expect(audit(config).dangling).toEqual([]);
  });

  it("正常链仍然把落地节点挂到前置组上", () => {
    const { linked, groupNames } = audit({ proxyChains: [chain()] });
    expect(groupNames).toContain("SG · 前置");
    expect(linked).toContainEqual({ node: "落地-VLESS-Reality-A1", dialer: "SG · 前置" });
  });

  it("随机组合下始终满足不变量", () => {
    const chainNames = ["SG", "USA", "🇺🇸 美国链", "🚀 节点选择", "⚡ 自动选择", "SG · 前置", ""];
    const customNames = ["SG", "自定义组", "🚀 节点选择", "SG · 前置"];
    const refPool = [ref(RELAY), ref(LANDING), ref(LANDING2), ref(OTHER), STALE];
    const orderKeys = [
      "module:select",
      "module:auto",
      "chain:chain-1",
      "chain:chain-1:relay",
      "custom:c1",
      "dialer:d1",
      "name:SG",
    ];
    const enabledSets = [
      undefined,
      ["select", "auto", "final"],
      ["select", "auto", "ad", "private", "cn", "global", "final"],
    ];
    const rand = mulberry32(20261108);
    const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)];
    const failures: string[] = [];

    for (let round = 0; round < 300; round += 1) {
      const proxyChains = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, index) => ({
        id: rand() < 0.2 ? "chain-1" : `chain-${index + 1}`,
        name: pick(chainNames),
        relayNodes: Array.from({ length: Math.floor(rand() * 3) }, () => pick(refPool)),
        landingNodes: Array.from({ length: 1 + Math.floor(rand() * 2) }, () => pick(refPool)),
        ...(rand() < 0.3 ? { exitGroupType: pick(["select", "url-test", "direct-first", "reject-first"]) } : {}),
        ...(rand() < 0.3
          ? { relayGroupType: pick(["select", "url-test", "load-balance", "reject-first", "direct-first"]) }
          : {}),
        ...(rand() < 0.15 ? { enabled: false } : {}),
      }));
      const customProxyGroups = Array.from({ length: Math.floor(rand() * 2) }, (_, index) => ({
        id: `c${index + 1}`,
        name: pick(customNames),
        members: [],
        ...(rand() < 0.2 ? { enabled: false } : {}),
      }));
      const dialerProxyGroups = Array.from({ length: Math.floor(rand() * 2) }, (_, index) => ({
        id: `d${index + 1}`,
        name: pick(["旧中转", "SG · 前置", "旧中转2"]),
        relayNodes: [pick([String(RELAY.name), String(OTHER.name)])],
        targetNodes: [pick([String(LANDING.name), String(LANDING2.name)])],
        ...(rand() < 0.2 ? { enabled: false } : {}),
      }));
      const config: Record<string, unknown> = {
        proxyChains,
        ...(customProxyGroups.length > 0 ? { customProxyGroups } : {}),
        ...(dialerProxyGroups.length > 0 ? { dialerProxyGroups } : {}),
        ...(rand() < 0.4 ? { proxyGroupOrder: [pick(orderKeys), pick(orderKeys), pick(orderKeys)] } : {}),
        ...(rand() < 0.4 ? { enabledGroups: pick(enabledSets) } : {}),
      };

      const { dangling } = audit(config);
      if (dangling.length > 0) {
        failures.push(`round ${round}: ${JSON.stringify(dangling)} config=${JSON.stringify(config)}`);
      }
    }

    expect(failures).toEqual([]);
  });
});
