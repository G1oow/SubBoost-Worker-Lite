import { describe, expect, it } from "vitest";
import { nodeRenameKey } from "../node-rename-key";
import type { ChainNodeRef, ProxyChain } from "../types/config";
import type { ParsedNode } from "../types/node";
import {
  CHAIN_RELAY_GROUP_SUFFIX,
  activeProxyChains,
  chainRelayGroupName,
  collectChainSourceIds,
  mapLandingNodesToExitGroups,
  resolveChainNodes,
  resolveProxyChains,
} from "./chain-nodes";

function ss(host: string, name: string, sourceIds: string[]): ParsedNode {
  return {
    name,
    type: "ss",
    server: host,
    port: 8388,
    cipher: "aes-128-gcm",
    password: "secret",
    _sourceIds: sourceIds,
  } as ParsedNode;
}

const RELAY_SRC = "source-relay";
const LANDING_SRC = "source-landing";

const NODES: ParsedNode[] = [
  ss("relay-1.example.com", "中转-东京", [RELAY_SRC]),
  ss("relay-2.example.com", "中转-大阪", [RELAY_SRC]),
  ss("landing-1.example.com", "落地-洛杉矶", [LANDING_SRC]),
  ss("landing-2.example.com", "落地-圣何塞", [LANDING_SRC]),
];

function ref(sourceId: string, node: ParsedNode): ChainNodeRef {
  return { sourceId, nodeKey: nodeRenameKey(node) };
}

const TOKYO = NODES[0];
const OSAKA = NODES[1];
const LA = NODES[2];
const SJ = NODES[3];

function chain(patch: Partial<ProxyChain> = {}): ProxyChain {
  return {
    id: "chain-1",
    name: "🇺🇸 美国",
    relayNodes: [ref(RELAY_SRC, TOKYO), ref(RELAY_SRC, OSAKA)],
    landingNodes: [ref(LANDING_SRC, LA), ref(LANDING_SRC, SJ)],
    ...patch,
  };
}

describe("resolveChainNodes", () => {
  it("按引用精确挑节点，顺序沿用节点顺序", () => {
    const picked = resolveChainNodes(chain(), NODES);
    expect(picked.relay).toEqual(["中转-东京", "中转-大阪"]);
    expect(picked.landing).toEqual(["落地-洛杉矶", "落地-圣何塞"]);
    expect(picked.issues).toEqual([]);
  });

  it("同一个源里的两个节点可以分别当前置和落地", () => {
    const sameSource = chain({
      relayNodes: [ref(RELAY_SRC, TOKYO)],
      landingNodes: [ref(RELAY_SRC, OSAKA)],
    });
    const picked = resolveChainNodes(sameSource, NODES);
    expect(picked.relay).toEqual(["中转-东京"]);
    expect(picked.landing).toEqual(["中转-大阪"]);
    expect(picked.issues).toEqual([]);
  });

  it("同一个节点被两个源共用时，引用任一源都能命中", () => {
    const shared = ss("shared.example.com", "共享节点", [RELAY_SRC, LANDING_SRC]);
    const picked = resolveChainNodes(
      { relayNodes: [ref(RELAY_SRC, shared)], landingNodes: [ref(LANDING_SRC, shared)] },
      [shared]
    );
    // 前后是同一个节点时按落地优先剔除前置，但两侧都命中过
    expect(picked.landing).toEqual(["共享节点"]);
    expect(picked.relay).toEqual([]);
    expect(picked.droppedSelfRelay).toBe(1);
    expect(picked.issues).toEqual([]);
  });

  it("引用失效时记 issue：源整个不在 vs 节点不在", () => {
    const picked = resolveChainNodes(
      {
        relayNodes: [{ sourceId: "source-deleted", nodeKey: "0123456789abcdef" }],
        landingNodes: [ref(LANDING_SRC, LA), { sourceId: LANDING_SRC, nodeKey: "0123456789abcdef" }],
      },
      NODES
    );
    expect(picked.relay).toEqual([]);
    expect(picked.landing).toEqual(["落地-洛杉矶"]);
    expect(picked.issues.map((issue) => issue.reason)).toEqual(["missing-node", "missing-source"]);
  });

  it("前置与自己的落地重叠时按落地优先剔除", () => {
    const picked = resolveChainNodes(
      { relayNodes: [ref(LANDING_SRC, LA), ref(RELAY_SRC, TOKYO)], landingNodes: [ref(LANDING_SRC, LA)] },
      NODES
    );
    expect(picked.relay).toEqual(["中转-东京"]);
    expect(picked.landing).toEqual(["落地-洛杉矶"]);
    expect(picked.droppedSelfRelay).toBe(1);
  });

  it("残缺数据不抛异常", () => {
    const picked = resolveChainNodes(
      { relayNodes: [null, 3, {}, { sourceId: " ", nodeKey: "x" }] as unknown as ChainNodeRef[], landingNodes: [] },
      [TOKYO as unknown as ParsedNode]
    );
    expect(picked.relay).toEqual([]);
    expect(picked.landing).toEqual([]);
  });
});

describe("resolveProxyChains", () => {
  it("正常两跳解析出前置组与出口组", () => {
    const [resolved] = resolveProxyChains({ chains: [chain()], nodes: NODES });
    expect(resolved).toMatchObject({
      id: "chain-1",
      name: "🇺🇸 美国",
      exitGroupName: "🇺🇸 美国",
      relayGroupName: `🇺🇸 美国${CHAIN_RELAY_GROUP_SUFFIX}`,
      relayNodes: ["中转-东京", "中转-大阪"],
      landingNodes: ["落地-洛杉矶", "落地-圣何塞"],
      exitGroupType: "select",
      relayGroupType: "url-test",
      status: "ok",
      active: true,
      missingRefs: 0,
    });
  });

  it("链名首尾空白被裁掉，前置组名由链名派生", () => {
    const [resolved] = resolveProxyChains({ chains: [chain({ name: "  美国  " })], nodes: NODES });
    expect(resolved.exitGroupName).toBe("美国");
    expect(resolved.relayGroupName).toBe(chainRelayGroupName("美国"));
  });

  it("没选落地节点时整条链不生成", () => {
    const [resolved] = resolveProxyChains({ chains: [chain({ landingNodes: [] })], nodes: NODES });
    expect(resolved).toMatchObject({ status: "empty-landing", active: false });
    expect(resolved.error).toContain("落地");
    expect(resolved.landingNodes).toEqual([]);
  });

  it("落地引用全部失效时也不生成，并给出重新选择的提示", () => {
    const [resolved] = resolveProxyChains({
      chains: [chain({ landingNodes: [{ sourceId: "source-deleted", nodeKey: "0123456789abcdef" }] })],
      nodes: NODES,
    });
    expect(resolved).toMatchObject({ status: "empty-landing", active: false, missingRefs: 1 });
    expect(resolved.error).toContain("已经不在了");
  });

  it("落地部分失效时仍然生成，状态标为「部分引用失效」", () => {
    const [resolved] = resolveProxyChains({
      chains: [
        chain({
          landingNodes: [ref(LANDING_SRC, LA), { sourceId: LANDING_SRC, nodeKey: "0123456789abcdef" }],
        }),
      ],
      nodes: NODES,
    });
    expect(resolved).toMatchObject({ status: "missing-refs", active: true, missingRefs: 1 });
    expect(resolved.landingNodes).toEqual(["落地-洛杉矶"]);
    expect(resolved.error).toContain("失效");
  });

  it("前置为空仍然生成：前置组只有 REJECT", () => {
    const [resolved] = resolveProxyChains({ chains: [chain({ relayNodes: [] })], nodes: NODES });
    expect(resolved).toMatchObject({ status: "empty-relay", active: true, relayNodes: [] });
    expect(resolved.error).toContain("REJECT");
  });

  it("前置与落地指向同一个节点时，前置按落地优先被剔除", () => {
    const [resolved] = resolveProxyChains({
      chains: [{ ...chain(), relayNodes: [ref(LANDING_SRC, LA)], landingNodes: [ref(LANDING_SRC, LA)] }],
      nodes: NODES,
    });
    expect(resolved.relayNodes).toEqual([]);
    expect(resolved.status).toBe("empty-relay");
  });

  it("多条链先到先得：落地节点被前面占用后，后一条链不生成", () => {
    const chains = [
      chain(),
      chain({ id: "chain-2", name: "🇺🇸 美国二", relayNodes: [], landingNodes: [ref(LANDING_SRC, LA)] }),
    ];
    const resolved = resolveProxyChains({ chains, nodes: NODES });
    expect(resolved[0].active).toBe(true);
    expect(resolved[1]).toMatchObject({ status: "empty-landing", active: false });
  });

  it("任何链的前置都不能包含任何链的落地", () => {
    const chains = [
      chain({ id: "a", name: "A", landingNodes: [ref(LANDING_SRC, LA)] }),
      // 第二条把第一条的落地当前置 → 会被剔除，只剩自己的前置
      chain({ id: "b", name: "B", relayNodes: [ref(LANDING_SRC, LA), ref(RELAY_SRC, TOKYO)] }),
    ];
    const resolved = resolveProxyChains({ chains, nodes: NODES });
    expect(resolved[1].relayNodes).toEqual(["中转-东京"]);
  });

  it("与内置分组重名时跳过该链", () => {
    const [resolved] = resolveProxyChains({
      chains: [chain({ name: "🚀 节点选择" })],
      nodes: NODES,
      reservedGroupNames: ["🚀 节点选择"],
    });
    expect(resolved).toMatchObject({ status: "name-conflict", active: false });
  });

  it("后一条链撞上前一条链的组名时跳过", () => {
    const resolved = resolveProxyChains({
      chains: [chain({ id: "a", name: "同名" }), chain({ id: "b", name: "同名" })],
      nodes: NODES,
    });
    expect(resolved[0].active).toBe(true);
    expect(resolved[1]).toMatchObject({ status: "name-conflict", active: false });
  });

  it("停用的链保留在结果里但标记为不生成", () => {
    const [resolved] = resolveProxyChains({ chains: [chain({ enabled: false })], nodes: NODES });
    expect(resolved).toMatchObject({ status: "disabled", active: false });
    expect(resolved.landingNodes).toEqual([]);
  });

  it("缺 id / 名称判为不完整", () => {
    const resolved = resolveProxyChains({
      chains: [chain({ id: " " }), chain({ id: "x", name: "  " })],
      nodes: NODES,
    });
    expect(resolved.map((item) => item.status)).toEqual(["invalid", "invalid"]);
  });

  it("activeProxyChains 只留会生成的链", () => {
    const resolved = resolveProxyChains({ chains: [chain(), chain({ id: "b", enabled: false })], nodes: NODES });
    expect(activeProxyChains(resolved).map((item) => item.id)).toEqual(["chain-1"]);
  });
});

describe("mapLandingNodesToExitGroups", () => {
  it("落地节点映射到出口组，重复时以首次为准", () => {
    const config = resolveProxyChains({ chains: [chain()], nodes: NODES });
    const map = mapLandingNodesToExitGroups([...config, ...config]);
    expect(map.size).toBe(2);
    expect(map.get("落地-洛杉矶")).toBe("🇺🇸 美国");
  });
});

describe("collectChainSourceIds", () => {
  it("收集启用链引用到的源，去重并保持顺序", () => {
    expect(collectChainSourceIds([chain(), chain({ id: "b" })])).toEqual([RELAY_SRC, LANDING_SRC]);
  });

  it("停用的链不贡献源，残缺数据不抛异常", () => {
    expect(collectChainSourceIds([chain({ enabled: false })])).toEqual([]);
    expect(collectChainSourceIds([{ id: "x", name: "X" } as unknown as ProxyChain])).toEqual([]);
    expect(collectChainSourceIds(undefined)).toEqual([]);
  });
});
