import { describe, expect, it } from "vitest";
import type { ProxyChain } from "../types/config";
import type { ParsedNode } from "../types/node";
import {
  CHAIN_RELAY_GROUP_SUFFIX,
  activeProxyChains,
  chainRelayGroupName,
  mapLandingNodesToExitGroups,
  resolveProxyChains,
  selectChainNodes,
} from "./chain-nodes";

function node(name: string, patch: Record<string, unknown> = {}): ParsedNode {
  return {
    name,
    type: "ss",
    server: "ss.example.com",
    port: 8388,
    cipher: "aes-128-gcm",
    password: "secret",
    ...patch,
  } as ParsedNode;
}

const NODES: ParsedNode[] = [
  node("中转-东京", { _sourceIds: ["source-relay"] }),
  node("中转-大阪", { _sourceIds: ["source-relay"] }),
  node("落地-洛杉矶", { _sourceIds: ["source-landing"] }),
  node("落地-圣何塞", { _sourceIds: ["source-landing"] }),
];

function chain(patch: Partial<ProxyChain> = {}): ProxyChain {
  return {
    id: "chain-1",
    name: "🇺🇸 美国",
    relay: { sourceIds: [], includeRegex: "中转" },
    landing: { sourceIds: [], includeRegex: "落地" },
    ...patch,
  };
}

describe("selectChainNodes", () => {
  it("空选择器返回全部节点", () => {
    expect(selectChainNodes({ sourceIds: [] }, NODES).nodes.map((n) => n.name)).toEqual([
      "中转-东京",
      "中转-大阪",
      "落地-洛杉矶",
      "落地-圣何塞",
    ]);
  });

  it("include/exclude 正则按忽略大小写匹配节点名", () => {
    const picked = selectChainNodes(
      { sourceIds: [], includeRegex: "中转", excludeRegex: "大阪" },
      NODES
    );
    expect(picked.nodes.map((n) => n.name)).toEqual(["中转-东京"]);

    const upper = selectChainNodes({ sourceIds: [], includeRegex: "东京" }, [
      node("东京-01"),
      node("US-01"),
    ]);
    expect(upper.nodes.map((n) => n.name)).toEqual(["东京-01"]);
  });

  it("按源限定范围", () => {
    const picked = selectChainNodes({ sourceIds: ["source-landing"] }, NODES);
    expect(picked.nodes.map((n) => n.name)).toEqual(["落地-洛杉矶", "落地-圣何塞"]);
  });

  it("陈旧源 id 不参与限定，不会把选择器打成空集", () => {
    const picked = selectChainNodes({ sourceIds: ["source-deleted"] }, NODES);
    expect(picked.nodes).toHaveLength(4);

    const mixed = selectChainNodes({ sourceIds: ["source-deleted", "source-relay"] }, NODES);
    expect(mixed.nodes.map((n) => n.name)).toEqual(["中转-东京", "中转-大阪"]);
  });

  it("正则写坏时返回错误且不抛异常", () => {
    const picked = selectChainNodes({ sourceIds: [], includeRegex: "(" }, NODES);
    expect(picked.nodes).toEqual([]);
    expect(picked.error).toContain("匹配正则");
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
    });
  });

  it("链名首尾空白被裁掉，前置组名由链名派生", () => {
    const [resolved] = resolveProxyChains({
      chains: [chain({ name: "  美国  " })],
      nodes: NODES,
    });
    expect(resolved.exitGroupName).toBe("美国");
    expect(resolved.relayGroupName).toBe(chainRelayGroupName("美国"));
  });

  it("落地为空时整条链不生成", () => {
    const [resolved] = resolveProxyChains({
      chains: [chain({ landing: { sourceIds: [], includeRegex: "不存在" } })],
      nodes: NODES,
    });
    expect(resolved).toMatchObject({ status: "empty-landing", active: false });
    expect(resolved.error).toContain("落地");
  });

  it("前置为空仍然生成：前置组只有 REJECT", () => {
    const [resolved] = resolveProxyChains({
      chains: [chain({ relay: { sourceIds: [], includeRegex: "不存在" } })],
      nodes: NODES,
    });
    expect(resolved).toMatchObject({ status: "empty-relay", active: true, relayNodes: [] });
    expect(resolved.error).toContain("REJECT");
  });

  it("正则为空串等于不限制", () => {
    const [resolved] = resolveProxyChains({
      chains: [
        chain({
          relay: { sourceIds: [], includeRegex: "   ", excludeRegex: "" },
          landing: { sourceIds: ["source-landing"] },
        }),
      ],
      nodes: NODES,
    });
    // 前置不写正则 = 不限制，但落地节点仍按「落地优先」被剔除，只剩两个中转节点
    expect(resolved.relayNodes).toEqual(["中转-东京", "中转-大阪"]);
    expect(resolved.landingNodes).toHaveLength(2);
  });

  it("正则写坏时该链不生成", () => {
    const [resolved] = resolveProxyChains({
      chains: [chain({ landing: { sourceIds: [], excludeRegex: "[" } })],
      nodes: NODES,
    });
    expect(resolved).toMatchObject({ status: "invalid-regex", active: false });
  });

  it("停用与缺名字都不生成", () => {
    const [disabled] = resolveProxyChains({ chains: [chain({ enabled: false })], nodes: NODES });
    expect(disabled).toMatchObject({ status: "disabled", active: false });

    const [invalid] = resolveProxyChains({ chains: [chain({ id: "  " })], nodes: NODES });
    expect(invalid).toMatchObject({ status: "invalid", active: false });
  });

  it("与既有分组重名时跳过该链，不覆盖", () => {
    const [resolved] = resolveProxyChains({
      chains: [chain({ name: "🚀 节点选择" })],
      nodes: NODES,
      reservedGroupNames: ["🚀 节点选择", "⚡ 自动选择"],
    });
    expect(resolved).toMatchObject({ status: "name-conflict", active: false });
  });

  it("前置组名撞上既有分组也算冲突", () => {
    const [resolved] = resolveProxyChains({
      chains: [chain({ name: "美国" })],
      nodes: NODES,
      reservedGroupNames: [`美国${CHAIN_RELAY_GROUP_SUFFIX}`],
    });
    expect(resolved).toMatchObject({ status: "name-conflict", active: false });
  });

  it("多条链撞名时先到先得", () => {
    const resolved = resolveProxyChains({
      chains: [chain({ id: "a", name: "美国" }), chain({ id: "b", name: "美国" })],
      nodes: NODES,
    });
    expect(resolved[0]).toMatchObject({ active: true, status: "ok" });
    expect(resolved[1]).toMatchObject({ active: false, status: "name-conflict" });
  });

  it("落地优先：靠前的链先占节点，后一条链落地为空则不生成", () => {
    const resolved = resolveProxyChains({
      chains: [
        chain({ id: "a", name: "美国 A", landing: { sourceIds: [], includeRegex: "落地-洛杉矶" } }),
        chain({ id: "b", name: "美国 B", landing: { sourceIds: [], includeRegex: "落地-洛杉矶" } }),
      ],
      nodes: NODES,
    });
    expect(resolved[0]).toMatchObject({ active: true, landingNodes: ["落地-洛杉矶"] });
    expect(resolved[1]).toMatchObject({ active: false, status: "empty-landing" });
  });

  it("任何链的落地都不会被别的链当成前置（避免经自己中转）", () => {
    const resolved = resolveProxyChains({
      chains: [
        chain({ id: "a", name: "美国 A", landing: { sourceIds: [], includeRegex: "落地-洛杉矶" } }),
        chain({
          id: "b",
          name: "美国 B",
          relay: { sourceIds: [], includeRegex: "落地" },
          landing: { sourceIds: [], includeRegex: "落地-圣何塞" },
        }),
      ],
      nodes: NODES,
    });
    // A 的落地是洛杉矶，所以 B 的前置里不能出现它，只剩圣何塞（B 自己的落地也被剔除）
    expect(resolved[1]).toMatchObject({ relayNodes: [], status: "empty-relay", active: true });
  });

  it("本链前置与落地重叠时按落地优先剔除", () => {
    const [resolved] = resolveProxyChains({
      chains: [
        chain({
          name: "美国",
          relay: { sourceIds: [], includeRegex: "落地" },
          landing: { sourceIds: [], includeRegex: "落地-洛杉矶" },
        }),
      ],
      nodes: NODES,
    });
    expect(resolved.relayNodes).toEqual(["落地-圣何塞"]);
    expect(resolved.landingNodes).toEqual(["落地-洛杉矶"]);
  });

  it("组类型可配，非法值回默认", () => {
    const [resolved] = resolveProxyChains({
      chains: [
        chain({
          exitGroupType: "url-test",
          relayGroupType: "fallback",
          testUrl: "  https://example.com/generate_204  ",
        }),
      ],
      nodes: NODES,
    });
    expect(resolved.exitGroupType).toBe("url-test");
    expect(resolved.relayGroupType).toBe("fallback");
    expect(resolved.testUrl).toBe("https://example.com/generate_204");

    const [fallbackTypes] = resolveProxyChains({
      chains: [chain({ exitGroupType: "nope" as never, relayGroupType: undefined })],
      nodes: NODES,
    });
    expect(fallbackTypes.exitGroupType).toBe("select");
    expect(fallbackTypes.relayGroupType).toBe("url-test");
  });

  it("容忍空配置与非法条目", () => {
    expect(resolveProxyChains({ chains: undefined, nodes: NODES })).toEqual([]);
    expect(resolveProxyChains({ chains: [null as never], nodes: NODES })).toEqual([]);
    const [resolved] = resolveProxyChains({ chains: [chain()], nodes: [] as ParsedNode[] });
    expect(resolved).toMatchObject({ status: "empty-landing", active: false });
  });
});

describe("activeProxyChains / mapLandingNodesToExitGroups", () => {
  const resolved = resolveProxyChains({
    chains: [
      chain({ id: "a", name: "美国 A", landing: { sourceIds: [], includeRegex: "落地-洛杉矶" } }),
      chain({ id: "b", name: "美国 B", landing: { sourceIds: [], includeRegex: "落地-圣何塞" } }),
      chain({ id: "c", name: "美国 C", enabled: false }),
    ],
    nodes: NODES,
  });

  it("只保留会写进配置的链", () => {
    expect(activeProxyChains(resolved).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("落地节点映射到各自的出口组", () => {
    const map = mapLandingNodesToExitGroups(activeProxyChains(resolved));
    expect(map.get("落地-洛杉矶")).toBe("美国 A");
    expect(map.get("落地-圣何塞")).toBe("美国 B");
    expect(map.get("中转-东京")).toBeUndefined();
  });
});

describe("链式代理的失败分支", () => {
  it("前置正则写坏时该链不生成", () => {
    const [resolved] = resolveProxyChains({
      chains: [chain({ relay: { sourceIds: [], includeRegex: "(" } })],
      nodes: NODES,
    });
    expect(resolved).toMatchObject({ status: "invalid-regex", active: false });
    expect(resolved.error).toContain("匹配正则");
  });

  it("落地排除正则写坏时该链不生成", () => {
    const [resolved] = resolveProxyChains({
      chains: [chain({ landing: { sourceIds: [], excludeRegex: "[" } })],
      nodes: NODES,
    });
    expect(resolved).toMatchObject({ status: "invalid-regex", active: false });
    expect(resolved.error).toContain("排除正则");
  });

  it("选择器的排除正则非法时返回错误而不是抛异常", () => {
    const picked = selectChainNodes({ sourceIds: [], excludeRegex: "[" }, NODES);
    expect(picked.nodes).toEqual([]);
    expect(picked.error).toContain("排除正则");
  });
});

describe("链式代理的防御分支", () => {
  it("id/name 不是字符串时标记为配置不完整", () => {
    const [resolved] = resolveProxyChains({
      chains: [
        {
          id: 123 as never,
          name: undefined as never,
          relay: { sourceIds: [] },
          landing: { sourceIds: [] },
        },
      ],
      nodes: NODES,
    });
    expect(resolved).toMatchObject({ status: "invalid", active: false });
  });

  it("同一个落地节点只会归属到最先声明它的出口组", () => {
    const resolved = activeProxyChains(
      resolveProxyChains({
        chains: [
          chain({ id: "a", name: "美国 A", landing: { sourceIds: [], includeRegex: "落地-洛杉矶" } }),
        ],
        nodes: NODES,
      })
    );
    const map = mapLandingNodesToExitGroups([...resolved, ...resolved]);
    expect(map.size).toBe(1);
    expect(map.get("落地-洛杉矶")).toBe("美国 A");
  });
});
