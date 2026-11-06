import type { ChainSelector, ProxyChain, ProxyGroupGroupType } from "../types/config";
import { isProxyGroupGroupType } from "../types/config";
import type { ParsedNode } from "../types/node";
import { getNodeSourceIds, resolveEffectiveSourceIds } from "./node-source-state";

/**
 * 链式代理的节点解析。
 *
 * 链是严格两跳：前置（中转）→ 落地。选择器先按源限定范围，再按节点名跑 include/exclude 正则；
 * 解析结果同时供生成器与管理端计数使用，两边看到的节点集合必须一致。
 */

export type ProxyChainStatus =
  /** 前置与落地都有节点 */
  | "ok"
  /** 落地有节点、前置为空：前置组只放 REJECT（mihomo 空组 = COMPATIBLE = 直连） */
  | "empty-relay"
  /** 落地为空：整条链不生成 */
  | "empty-landing"
  /** 链被停用 */
  | "disabled"
  /** include/exclude 正则写坏 */
  | "invalid-regex"
  /** 组名与既有分组或其他链重复 */
  | "name-conflict"
  /** 缺 name 等结构性错误 */
  | "invalid";

export type ResolvedProxyChain = {
  id: string;
  name: string;
  exitGroupName: string;
  relayGroupName: string;
  relayNodes: string[];
  landingNodes: string[];
  exitGroupType: ProxyGroupGroupType;
  relayGroupType: ProxyGroupGroupType;
  testUrl?: string;
  status: ProxyChainStatus;
  /** 是否真的会写进配置 */
  active: boolean;
  error?: string;
};

export const CHAIN_RELAY_GROUP_SUFFIX = " · 前置";

export function chainRelayGroupName(name: string): string {
  return `${name.trim()}${CHAIN_RELAY_GROUP_SUFFIX}`;
}

/** 编译后的选择器：正则只编译一次，落地与前置两轮筛选共用 */
type CompiledChainSelector = {
  include: RegExp | null;
  exclude: RegExp | null;
  /** `null` = 不限源 */
  sourceIds: Set<string> | null;
};

type CompileResult =
  | { ok: true; value: CompiledChainSelector }
  | { ok: false; error: string };

type RegexResult = { ok: true; value: RegExp | null } | { ok: false; error: string };

function compileChainRegex(pattern: string | undefined, label: string): RegexResult {
  const raw = typeof pattern === "string" ? pattern.trim() : "";
  if (!raw) return { ok: true, value: null };
  try {
    // 与分流组高级筛选保持一致：忽略大小写
    return { ok: true, value: new RegExp(raw, "i") };
  } catch {
    return { ok: false, error: `${label} 不是有效的正则表达式` };
  }
}

function compileChainSelector(
  selector: ChainSelector | undefined,
  nodes: ParsedNode[]
): CompileResult {
  const include = compileChainRegex(selector?.includeRegex, "匹配正则");
  if (!include.ok) return include;
  const exclude = compileChainRegex(selector?.excludeRegex, "排除正则");
  if (!exclude.ok) return exclude;
  return {
    ok: true,
    value: {
      include: include.value,
      exclude: exclude.value,
      // 陈旧源 id 不参与限定：全部命中不到现存源时按「不限源」处理
      sourceIds: resolveEffectiveSourceIds(selector?.sourceIds ?? [], nodes),
    },
  };
}

/** 按编译好的选择器挑节点，顺序沿用传入的节点顺序（即订阅里节点的真实顺序） */
function filterChainNodes(nodes: ParsedNode[], selector: CompiledChainSelector): ParsedNode[] {
  return nodes.filter((node) => {
    const name = typeof node.name === "string" ? node.name : "";
    if (selector.sourceIds && !getNodeSourceIds(node).some((id) => selector.sourceIds?.has(id))) {
      return false;
    }
    if (selector.include && !selector.include.test(name)) return false;
    if (selector.exclude && selector.exclude.test(name)) return false;
    return true;
  });
}

export type ChainNodeSelection = { nodes: ParsedNode[]; error?: string };

/**
 * 按选择器挑节点。
 *
 * 顺序沿用传入的节点顺序（即订阅里节点的真实顺序），保证界面计数与生成结果一致。
 */
export function selectChainNodes(
  selector: ChainSelector | undefined,
  nodes: ParsedNode[]
): ChainNodeSelection {
  const compiled = compileChainSelector(selector, nodes);
  if (!compiled.ok) return { nodes: [], error: compiled.error };
  return { nodes: filterChainNodes(nodes, compiled.value) };
}

function normalizeGroupType(value: unknown, fallback: ProxyGroupGroupType): ProxyGroupGroupType {
  return isProxyGroupGroupType(value) ? value : fallback;
}

export type ResolveProxyChainsOptions = {
  chains: ProxyChain[] | undefined;
  nodes: ParsedNode[];
  /** 已存在的分组名（模块组、自定义组、旧中转组）：重名时该链跳过 */
  reservedGroupNames?: Iterable<string>;
};

type ChainDraft = {
  resolved: ResolvedProxyChain;
  /** 落地没通过校验时为空；通过后用于第二轮筛前置 */
  compiledRelay?: CompiledChainSelector;
};

/**
 * 解析全部链。
 *
 * 冲突在生成期消解，不拦保存：
 * - 落地优先、靠前的链优先：节点一旦被前面的链分配为落地，后面的链不能再拿它做落地；
 * - 任何链的前置都不能包含任何链的落地（否则落地节点会经自己中转，mihomo 直接加载失败）；
 * - 单条链内前置与落地重叠同样按「落地优先」剔除。
 *
 * 返回包含不生成的链（`active: false`），供管理端与预览展示原因。
 */
export function resolveProxyChains(options: ResolveProxyChainsOptions): ResolvedProxyChain[] {
  const reserved = new Set<string>();
  for (const raw of options.reservedGroupNames ?? []) {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (name) reserved.add(name);
  }
  const nodes = Array.isArray(options.nodes) ? options.nodes : [];
  const chains = Array.isArray(options.chains) ? options.chains : [];

  const drafts: ChainDraft[] = [];
  // 已分配给某条链的落地节点：后面的链不能再拿来当落地，也不能当任何链的前置
  const claimedLanding = new Set<string>();

  const pushInactive = (
    base: Omit<ResolvedProxyChain, "status" | "active">,
    status: ProxyChainStatus,
    error?: string
  ) => {
    drafts.push({
      resolved: { ...base, status, active: false, ...(error ? { error } : {}) },
    });
  };

  for (const chain of chains) {
    if (!chain || typeof chain !== "object") continue;
    const id = typeof chain.id === "string" ? chain.id.trim() : "";
    const name = typeof chain.name === "string" ? chain.name.trim() : "";
    const exitGroupName = name;
    const relayGroupName = chainRelayGroupName(name);
    const base: Omit<ResolvedProxyChain, "status" | "active"> = {
      id,
      name,
      exitGroupName,
      relayGroupName,
      relayNodes: [],
      landingNodes: [],
      exitGroupType: normalizeGroupType(chain.exitGroupType, "select"),
      relayGroupType: normalizeGroupType(chain.relayGroupType, "url-test"),
      ...(typeof chain.testUrl === "string" && chain.testUrl.trim()
        ? { testUrl: chain.testUrl.trim() }
        : {}),
    };

    if (!id || !name) {
      pushInactive(base, "invalid", "链缺少 id 或名称");
      continue;
    }

    if (chain.enabled === false) {
      pushInactive(base, "disabled");
      continue;
    }

    if (reserved.has(exitGroupName) || reserved.has(relayGroupName) || exitGroupName === relayGroupName) {
      pushInactive(base, "name-conflict", `组名「${exitGroupName}」与现有分组重复，这条链不会生成`);
      continue;
    }

    const landingSelector = compileChainSelector(chain.landing, nodes);
    if (!landingSelector.ok) {
      pushInactive(base, "invalid-regex", landingSelector.error);
      continue;
    }
    const relaySelector = compileChainSelector(chain.relay, nodes);
    if (!relaySelector.ok) {
      pushInactive(base, "invalid-regex", relaySelector.error);
      continue;
    }

    const landingNodes = filterChainNodes(nodes, landingSelector.value)
      .map((node) => node.name)
      .filter((nodeName) => typeof nodeName === "string" && nodeName && !claimedLanding.has(nodeName));
    if (landingNodes.length === 0) {
      pushInactive(base, "empty-landing", "没有节点匹配落地选择器，这条链不会生成");
      continue;
    }

    // 这条链会生成，名字从此被占用（后面的链撞名要跳过）
    reserved.add(exitGroupName);
    reserved.add(relayGroupName);
    for (const nodeName of landingNodes) claimedLanding.add(nodeName);

    drafts.push({
      resolved: { ...base, landingNodes, status: "ok", active: true },
      compiledRelay: relaySelector.value,
    });
  }

  // 第二轮才定前置：要先把所有链的落地收齐，前置才能避开任意链的落地（否则会转成自环）
  for (const draft of drafts) {
    if (!draft.resolved.active || !draft.compiledRelay) continue;
    const relayNodes = filterChainNodes(nodes, draft.compiledRelay)
      .map((node) => node.name)
      .filter((nodeName) => typeof nodeName === "string" && nodeName && !claimedLanding.has(nodeName));
    draft.resolved = {
      ...draft.resolved,
      relayNodes,
      status: relayNodes.length > 0 ? "ok" : "empty-relay",
      ...(relayNodes.length === 0 ? { error: "前置没有可用节点，前置组只放 REJECT" } : {}),
    };
  }

  return drafts.map((draft) => draft.resolved);
}

/** 会写进配置的链 */
export function activeProxyChains(chains: ResolvedProxyChain[]): ResolvedProxyChain[] {
  return chains.filter((chain) => chain.active);
}

/**
 * 落地节点 → 出口组名。
 *
 * 生成代理组时用它把「节点」的坑位原地换成「出口组」，从而让落地节点只能经出口组到达。
 */
export function mapLandingNodesToExitGroups(activeChains: ResolvedProxyChain[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const chain of activeChains) {
    for (const nodeName of chain.landingNodes) {
      if (!out.has(nodeName)) out.set(nodeName, chain.exitGroupName);
    }
  }
  return out;
}
