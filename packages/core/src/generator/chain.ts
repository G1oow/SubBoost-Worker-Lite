/**
 * 中转代理组生成器 (dialer-proxy 语法)
 * 
 * 实现原理：
 * 1. 创建中转代理组（proxy-group），包含用于中转的节点
 * 2. 给目标节点添加 dialer-proxy 属性，指向中转代理组
 */

import type { ParsedNode } from "@subboost/core/types/node";
import type { DialerProxyGroup } from "@subboost/core/types/template-config";
import { DEFAULT_LOAD_BALANCE_STRATEGY, type ProxyGroup, type ProxyGroupGroupType } from "@subboost/core/types/config";
import { DEFAULT_SUBBOOST_CONFIG } from "@subboost/core/config/defaults";
import { buildTypedProxyGroup, uniqueProxyNames } from "./proxy-group-type";

export interface DialerProxyGroupConfig {
  id: string;
  name: string;
  relayNodes: string[];      // 中转节点
  targetNodes: string[];     // 使用此中转的目标节点
  type: ProxyGroupGroupType;
}

function resolveDialerGroupProxies(group: DialerProxyGroup): string[] {
  if (group.type === "direct-first") return uniqueProxyNames(["DIRECT", ...group.relayNodes]);
  if (group.type === "reject-first") return uniqueProxyNames(["REJECT", ...group.relayNodes]);
  return uniqueProxyNames(group.relayNodes);
}

/**
 * 生成中转代理组（作为 proxy-groups 的一部分）
 */
export function generateDialerProxyGroups(
  groups: DialerProxyGroup[],
  testUrl: string = DEFAULT_SUBBOOST_CONFIG.testUrl,
  testInterval: number = DEFAULT_SUBBOOST_CONFIG.testInterval,
  proxyProviderNames: string[] = []
): Array<Record<string, unknown>> {
  const providerUse = proxyProviderNames.length > 0 ? { use: proxyProviderNames } : {};
  return groups
    .map((group) => ({ group, proxies: resolveDialerGroupProxies(group) }))
    .filter(({ proxies }) => proxies.length > 0)
    .map((group) => {
      return buildTypedProxyGroup({
        name: group.group.name,
        groupType: group.group.type,
        proxies: group.proxies,
        testUrl: group.group.type === "url-test" ? group.group.testUrl || testUrl : testUrl,
        testInterval,
        strategy: group.group.strategy ?? DEFAULT_LOAD_BALANCE_STRATEGY,
        extraFields: providerUse,
        urlTestLazy: true,
      });
    });
}

/**
 * 给目标节点添加 dialer-proxy 属性
 * 返回修改后的节点列表
 */
export function applyDialerProxy(
  nodes: ParsedNode[],
  groups: DialerProxyGroup[]
): ParsedNode[] {
  // 构建节点名 -> 中转组名的映射
  const nodeToDialer = new Map<string, string>();

  for (const group of groups) {
    for (const targetNode of group.targetNodes) {
      // 一个节点只能使用一个中转组
      if (!nodeToDialer.has(targetNode)) {
        nodeToDialer.set(targetNode, group.name);
      }
    }
  }

  // 修改节点，添加 dialer-proxy
  return nodes.map((node) => {
    const dialerName = nodeToDialer.get(node.name);
    if (dialerName) {
      return {
        ...node,
        "dialer-proxy": dialerName,
      } as ParsedNode & { "dialer-proxy": string };
    }
    return node;
  });
}

/**
 * 输出前的最后一道闸：`dialer-proxy` 只能指向配置里真实存在的名字。
 *
 * mihomo 在加载期做引用校验（`proxy [X] dialer-proxy [Y] not found`），悬空的
 * `dialer-proxy` 会让整份配置校验失败，客户端连内核都应用不上。上游任何一环漏掉
 * 前置组（组被过滤、链被跳过、重名覆盖）都会留下这种引用，所以统一在这里兜底：
 * 认不出来的名字就当没链过，节点退回单跳，至少整份订阅还能用。
 */
export function stripDanglingDialerProxy(
  nodes: ParsedNode[],
  availableNames: Iterable<string>
): ParsedNode[] {
  const allowed = new Set<string>();
  for (const name of availableNames) {
    if (typeof name === "string" && name) allowed.add(name);
  }

  let changed = false;
  const out = nodes.map((node) => {
    const record = node as unknown as Record<string, unknown>;
    const raw = record["dialer-proxy"];
    if (typeof raw !== "string") return node;
    const dialer = raw.trim();
    if (dialer && allowed.has(dialer)) return node;
    changed = true;
    const { ["dialer-proxy"]: _dropped, ...rest } = record;
    return rest as unknown as ParsedNode;
  });

  return changed ? out : nodes;
}

/**
 * 获取所有使用中转的节点名称
 */
export function getDialerTargetNodes(groups: DialerProxyGroup[]): Set<string> {
  const targetNodes = new Set<string>();
  for (const group of groups) {
    for (const node of group.targetNodes) {
      targetNodes.add(node);
    }
  }
  return targetNodes;
}

/**
 * 获取所有中转节点名称（不应作为目标节点使用）
 */
export function getDialerRelayNodes(groups: DialerProxyGroup[]): Set<string> {
  const relayNodes = new Set<string>();
  for (const group of groups) {
    for (const node of group.relayNodes) {
      relayNodes.add(node);
    }
  }
  return relayNodes;
}

/**
 * 验证中转配置
 */
export function validateDialerConfig(
  nodes: ParsedNode[],
  group: DialerProxyGroup
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const nodeNames = new Set(nodes.map((n) => n.name));
  const builtinRelays = new Set<string>(["DIRECT"]);

  // 检查中转节点是否存在
  for (const relayNode of group.relayNodes) {
    if (builtinRelays.has(relayNode)) continue;
    if (!nodeNames.has(relayNode)) {
      errors.push(`中转节点 "${relayNode}" 不存在`);
    }
  }

  // 检查目标节点是否存在
  for (const targetNode of group.targetNodes) {
    if (!nodeNames.has(targetNode)) {
      errors.push(`目标节点 "${targetNode}" 不存在`);
    }
  }

  // 检查中转节点和目标节点是否有重叠
  const relaySet = new Set(group.relayNodes);
  for (const targetNode of group.targetNodes) {
    if (relaySet.has(targetNode)) {
      errors.push(`节点 "${targetNode}" 不能同时作为中转节点和目标节点`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/** 链式代理生成所需的组信息（由 chain-nodes 的解析结果投影而来） */
export type ChainProxyGroupSpec = {
  id: string;
  exitGroupName: string;
  relayGroupName: string;
  landingNodes: string[];
  relayNodes: string[];
  exitGroupType: ProxyGroupGroupType;
  relayGroupType: ProxyGroupGroupType;
  testUrl?: string;
};

/**
 * 把链翻译成内部的中转组描述，复用既有 dialer-proxy 机制。
 *
 * 前置为空时前置组只放 REJECT：链路显式失败，而不是留个空组被 mihomo 当成直连。
 */
export function buildChainDialerGroups(chains: ChainProxyGroupSpec[]): DialerProxyGroup[] {
  return chains.map((chain) => ({
    id: chain.id,
    name: chain.relayGroupName,
    type: chain.relayNodes.length > 0 ? chain.relayGroupType : "select",
    relayNodes: chain.relayNodes.length > 0 ? chain.relayNodes : ["REJECT"],
    targetNodes: chain.landingNodes,
    ...(chain.testUrl ? { testUrl: chain.testUrl } : {}),
  }));
}

/**
 * 生成出口组：成员是落地节点。
 *
 * 出口组只放节点，不引用 proxy-providers，避免落地范围被 provider 悄悄扩大。
 */
export function generateChainExitGroups(
  chains: ChainProxyGroupSpec[],
  testUrl: string = DEFAULT_SUBBOOST_CONFIG.testUrl,
  testInterval: number = DEFAULT_SUBBOOST_CONFIG.testInterval
): ProxyGroup[] {
  return chains.map((chain) => {
    const proxies = (() => {
      if (chain.exitGroupType === "direct-first") return uniqueProxyNames(["DIRECT", ...chain.landingNodes]);
      if (chain.exitGroupType === "reject-first") return uniqueProxyNames(["REJECT", ...chain.landingNodes]);
      return uniqueProxyNames(chain.landingNodes);
    })();
    return buildTypedProxyGroup({
      name: chain.exitGroupName,
      groupType: chain.exitGroupType,
      proxies,
      testUrl: chain.testUrl || testUrl,
      testInterval,
      strategy: DEFAULT_LOAD_BALANCE_STRATEGY,
      extraFields: {},
      urlTestLazy: true,
    });
  });
}
