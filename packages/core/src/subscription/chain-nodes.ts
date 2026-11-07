import { nodeRenameKey } from "../node-rename-key";
import type { ChainNodeRef, ProxyChain, ProxyGroupGroupType } from "../types/config";
import { isProxyGroupGroupType } from "../types/config";
import type { ParsedNode } from "../types/node";
import { getNodeSourceIds } from "./node-source-state";

/**
 * 链式代理的节点解析。
 *
 * 链是严格两跳：前置（中转）→ 落地。节点按引用来（源 id + 内容指纹），不再靠正则猜；
 * 解析结果同时供生成器与管理端计数使用，两边看到的节点集合必须一致。
 */

export type ProxyChainStatus =
  /** 前置与落地都有节点 */
  | "ok"
  /** 落地有节点、前置为空：前置组只放 REJECT（mihomo 空组 = COMPATIBLE = 直连） */
  | "empty-relay"
  /** 落地为空：整条链不生成 */
  | "empty-landing"
  /** 有引用解析不到（源被删/停用，或节点已不存在） */
  | "missing-refs"
  /** 链被停用 */
  | "disabled"
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
  /** 解析不到的引用数量 */
  missingRefs: number;
  error?: string;
};

export const CHAIN_RELAY_GROUP_SUFFIX = " · 前置";

export function chainRelayGroupName(name: string): string {
  return `${name.trim()}${CHAIN_RELAY_GROUP_SUFFIX}`;
}

type ChainNodeRefIssue = { ref: ChainNodeRef; reason: "missing-source" | "missing-node" };

export type ChainNodeSelection = {
  relay: string[];
  landing: string[];
  issues: ChainNodeRefIssue[];
  /** 落在链自己落地集合里、因此被剔除的前置引用数 */
  droppedSelfRelay: number;
};

function normalizeRefs(list: unknown): ChainNodeRef[] {
  if (!Array.isArray(list)) return [];
  const out: ChainNodeRef[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const sourceId = typeof record.sourceId === "string" ? record.sourceId.trim() : "";
    const nodeKey = typeof record.nodeKey === "string" ? record.nodeKey.trim() : "";
    if (!sourceId || !nodeKey) continue;
    const key = `${sourceId}\u0000${nodeKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ sourceId, nodeKey });
  }
  return out;
}

/**
 * 按引用挑节点：节点必须来自引用里指定的源，且内容指纹一致。
 *
 * 顺序沿用传入的节点顺序（即订阅里节点的真实顺序），保证界面计数与生成结果一致。
 */
export function resolveChainNodes(
  chain: Pick<ProxyChain, "relayNodes" | "landingNodes">,
  nodes: ParsedNode[]
): ChainNodeSelection {
  const byRef = new Map<string, ParsedNode[]>();
  for (const node of nodes) {
    const name = typeof node.name === "string" ? node.name : "";
    if (!name) continue;
    const key = `${getNodeSourceIds(node).join(",")}`;
    // 先按 (源, 指纹) 建索引：同一内容在多源里各有一份，引用必须精确到源
    let nodeKey: string;
    try {
      nodeKey = nodeRenameKey(node);
    } catch {
      continue;
    }
    for (const sourceId of getNodeSourceIds(node)) {
      const indexKey = `${sourceId}\u0000${nodeKey}`;
      const list = byRef.get(indexKey);
      if (list) list.push(node);
      else byRef.set(indexKey, [node]);
    }
    void key;
  }

  const availableSourceIds = new Set<string>();
  for (const node of nodes) {
    for (const sourceId of getNodeSourceIds(node)) availableSourceIds.add(sourceId);
  }

  const issues: ChainNodeRefIssue[] = [];
  const picked: string[] = [];
  const seenNames = new Set<string>();
  const collect = (refs: ChainNodeRef[]): string[] => {
    const out: string[] = [];
    for (const ref of refs) {
      const hit = byRef.get(`${ref.sourceId}\u0000${ref.nodeKey}`)?.[0];
      if (!hit) {
        issues.push({
          ref,
          reason: availableSourceIds.has(ref.sourceId) ? "missing-node" : "missing-source",
        });
        continue;
      }
      if (out.includes(hit.name)) continue;
      out.push(hit.name);
    }
    return out;
  };

  const landing = collect(normalizeRefs(chain.landingNodes));
  for (const name of landing) seenNames.add(name);

  // 前置不能包含自己的落地（否则落地节点经自己中转，mihomo 直接加载失败）
  let droppedSelfRelay = 0;
  const relay: string[] = [];
  for (const name of collect(normalizeRefs(chain.relayNodes))) {
    if (seenNames.has(name)) {
      droppedSelfRelay += 1;
      continue;
    }
    relay.push(name);
  }

  void picked;
  return { relay, landing, issues, droppedSelfRelay };
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
  relayRefs?: ChainNodeRef[];
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
    base: Omit<ResolvedProxyChain, "status" | "active" | "missingRefs">,
    status: ProxyChainStatus,
    error?: string,
    missingRefs = 0
  ) => {
    drafts.push({
      resolved: { ...base, status, active: false, missingRefs, ...(error ? { error } : {}) },
    });
  };

  for (const chain of chains) {
    if (!chain || typeof chain !== "object") continue;
    const id = typeof chain.id === "string" ? chain.id.trim() : "";
    const name = typeof chain.name === "string" ? chain.name.trim() : "";
    const exitGroupName = name;
    const relayGroupName = chainRelayGroupName(name);
    const base = {
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
      pushInactive(
        base,
        "name-conflict",
        `组名「${exitGroupName}」与现有分组重复，这条链不会生成`
      );
      continue;
    }

    const selection = resolveChainNodes(chain, nodes);
    if (selection.landing.length === 0) {
      const reason =
        selection.issues.length > 0
          ? "落地引用的节点（或它所在的源）已经不在了，请重新选择"
          : "还没有选择落地节点，这条链不会生成";
      pushInactive(base, "empty-landing", reason, selection.issues.length);
      continue;
    }
    // 有落地但缺引用：可能只缺一部分，仍然可以生成，但要让用户看见
    const landingNodes = selection.landing.filter((nodeName) => !claimedLanding.has(nodeName));
    if (landingNodes.length === 0) {
      pushInactive(base, "empty-landing", "落地节点都被前面的链占用，这条链不会生成");
      continue;
    }

    // 这条链会生成，名字从此被占用（后面的链撞名要跳过）
    reserved.add(exitGroupName);
    reserved.add(relayGroupName);
    for (const nodeName of landingNodes) claimedLanding.add(nodeName);

    const missing = selection.issues.length;
    drafts.push({
      resolved: {
        ...base,
        landingNodes,
        status: missing > 0 ? "missing-refs" : "ok",
        active: true,
        missingRefs: missing,
        ...(missing > 0
          ? { error: `${missing} 个节点引用已失效（源被删除/停用或节点已不存在），已跳过` }
          : {}),
      },
      relayRefs: normalizeRefs(chain.relayNodes),
    });
  }

  // 第二轮才定前置：要先把所有链的落地收齐，前置才能避开任意链的落地（否则会转成自环）
  for (const draft of drafts) {
    if (!draft.resolved.active || !draft.relayRefs) continue;
    const selection = resolveChainNodes(
      { relayNodes: draft.relayRefs, landingNodes: [] },
      nodes
    );
    const relayNodes = selection.relay.filter((nodeName) => !claimedLanding.has(nodeName));
    const missingTotal = draft.resolved.missingRefs + selection.issues.length;
    // 前置为空只有在落地没有失效时才单列：既有失效又多前置的情况留给 missing-refs，信息更完整
    const status: ProxyChainStatus =
      relayNodes.length === 0 && draft.resolved.missingRefs === 0
        ? "empty-relay"
        : missingTotal > 0
          ? "missing-refs"
          : "ok";

    const errors: string[] = [];
    if (draft.resolved.missingRefs > 0) {
      errors.push(`${draft.resolved.missingRefs} 个落地引用已失效，已跳过`);
    }
    if (selection.issues.length > 0) {
      errors.push(`${selection.issues.length} 个前置引用已失效，已跳过`);
    }
    if (relayNodes.length === 0) {
      errors.push("前置没有可用节点，前置组只放 REJECT");
    }

    draft.resolved = {
      ...draft.resolved,
      relayNodes,
      missingRefs: missingTotal,
      status,
      ...(errors.length > 0 ? { error: errors.join("；") } : {}),
    };
    if (errors.length === 0) delete draft.resolved.error;
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

/**
 * 一组链引用到的源 id（去重）。
 *
 * 订阅生成时用：链的节点所在的源必须一起进快照集合，否则节点不在 `proxies` 里、组引用悬空。
 */
export function collectChainSourceIds(chains: ProxyChain[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const chain of Array.isArray(chains) ? chains : []) {
    if (!chain || typeof chain !== "object") continue;
    if (chain.enabled === false) continue;
    for (const ref of [...normalizeRefs(chain.relayNodes), ...normalizeRefs(chain.landingNodes)]) {
      if (seen.has(ref.sourceId)) continue;
      seen.add(ref.sourceId);
      out.push(ref.sourceId);
    }
  }
  return out;
}
