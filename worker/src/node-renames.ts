import { isSubscriptionInfoNodeName } from "@subboost/core/subscription/info-node-name";
import { getNodeOriginName, getNodeSourceIds } from "@subboost/core/subscription/node-source-state";
import { applyNodeNameTemplate } from "@subboost/core/node-name-template";
import type { ParsedNode } from "@subboost/core/types/node";
import {
  MAX_NODE_NAME_LENGTH,
  MAX_NODE_RENAMES,
  MAX_PREVIEW_NODES,
  type CanvasNodeSummary,
  type NodeRenames,
  type NodeSummary,
} from "./types";

/*
 * 键的计算与链式代理共用：改名表的 key 就是链的节点引用键（`ChainNodeRef.nodeKey`），
 * 两边必须同一套实现，否则「改名后链引用失效」。实现放在 core 的 node-rename-key。
 */
export { hashNodeKey, isRenameKey, nodeRenameKey } from "@subboost/core/node-rename-key";
import { isRenameKey, nodeRenameKey } from "@subboost/core/node-rename-key";

export function applyNodeRenames(node: ParsedNode, renames?: NodeRenames): ParsedNode {
  if (!renames) return node;
  const next = renames[nodeRenameKey(node)];
  if (!next || next === node.name) return node;
  return { ...(node as unknown as Record<string, unknown>), name: next } as unknown as ParsedNode;
}

/**
 * 批量改名规则的源级求值结果。
 *
 * 规则与手动改名在这里合成一份「指纹 → 最终名」：
/**
 * 源级命名求值结果。
 *
 * 命名模板与手动改名在这里合成一份「指纹 → 最终名」：
 * - 先按模板算出每个节点的名字（源内去重，避开手动改名的名字）；
 * - 再让手动改名覆盖——手动是用户逐字写的，优先级最高。
 *
 * 生成订阅与节点列表都走这一份结果，避免两条链路各算一遍算出不同名字。
 */
export type ResolvedNodeNames = Map<string, { name: string; source: "manual" | "template" }>;

export function resolveNodeNames(
  nodes: readonly ParsedNode[],
  renames?: NodeRenames,
  template?: string,
  sourceName?: string
): ResolvedNodeNames {
  const resolved: ResolvedNodeNames = new Map();
  const hasRenames = Boolean(renames && Object.keys(renames).length > 0);
  const hasTemplate = typeof template === "string" && template.trim().length > 0;
  if (!hasRenames && !hasTemplate) return resolved;

  // 手动改名先落位：既是最终结果，也是模板去重时要避开的已占用名字
  const manualKeys = new Set<string>();
  const manualNames = new Set<string>();
  for (const node of nodes) {
    const key = nodeRenameKey(node);
    const next = renames?.[key];
    if (!next || next === nodeOriginName(node)) continue;
    manualKeys.add(key);
    manualNames.add(next);
    resolved.set(key, { name: next, source: "manual" });
  }

  // 手动改名过的节点不参与模板求值：否则它们会先占掉一个去重后缀，
  // 让真正用模板命名的节点凭空跳到 (3)。模板只处理「还没被手动指定」的节点。
  const candidates =
    manualKeys.size > 0 ? nodes.filter((node) => !manualKeys.has(nodeRenameKey(node))) : nodes;
  const result = applyNodeNameTemplate(candidates, template, nodeRenameKey, manualNames, sourceName);
  for (const [key, hit] of result.hits) {
    if (!hit.applied) continue;
    resolved.set(key, { name: hit.after, source: "template" });
  }

  return resolved;
}
function nodeType(node: ParsedNode): string {
  return typeof node.type === "string" ? node.type : "unknown";
}

function nodeServer(node: ParsedNode): string | undefined {
  return typeof node.server === "string" && node.server.trim() ? node.server : undefined;
}

function nodePort(node: ParsedNode): number | undefined {
  return typeof node.port === "number" && Number.isFinite(node.port) ? node.port : undefined;
}

function nodeOriginName(node: ParsedNode): string {
  return typeof node.name === "string" ? node.name : "";
}

/** 按「已解析的显示名表」构造节点摘要；改名来源一并带出，供界面区分手动与模板 */
export function toNodeSummary(
  node: ParsedNode,
  renames?: NodeRenames,
  template?: string,
  sourceName?: string,
  resolved?: ResolvedNodeNames
): NodeSummary {
  const key = nodeRenameKey(node);
  const originName = nodeOriginName(node);
  const hit = (resolved ?? resolveNodeNames([node], renames, template, sourceName)).get(key);
  const name = hit?.name ?? originName;
  return {
    key,
    name,
    originName,
    type: nodeType(node),
    ...(nodeServer(node) ? { server: nodeServer(node) } : {}),
    ...(nodePort(node) !== undefined ? { port: nodePort(node) } : {}),
    renamed: Boolean(hit && name !== originName),
    ...(hit && name !== originName ? { renameSource: hit.source } : {}),
  };
}

export function collectNodeSummaries(
  nodes: ParsedNode[],
  renames?: NodeRenames,
  template?: string,
  sourceName?: string,
  limit = MAX_PREVIEW_NODES
): NodeSummary[] {
  // 只对要展示的这批节点求值：模板去重是按整源的，所以用整份 nodes 算解析表，
  // 再截断输出，保证「第 N 个节点的重名后缀」与生成链路一致。
  const resolved = resolveNodeNames(nodes, renames, template, sourceName);
  return nodes
    .slice(0, limit)
    .map((node) => toNodeSummary(node, renames, template, sourceName, resolved));
}

export function countRenamedNodes(
  nodes: ParsedNode[],
  renames?: NodeRenames,
  template?: string,
  sourceName?: string
): number {
  return resolveNodeNames(nodes, renames, template, sourceName).size;
}
/**
 * 返回 undefined 表示没有任何有效条目。
 */
export function sanitizeNodeRenames(input: unknown): NodeRenames | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const out: NodeRenames = {};
  let count = 0;
  for (const [rawKey, rawName] of Object.entries(input as Record<string, unknown>)) {
    if (count >= MAX_NODE_RENAMES) break;
    const key = rawKey.trim();
    if (!isRenameKey(key)) continue;
    if (typeof rawName !== "string") continue;
    const name = rawName.trim();
    if (!name || name.length > MAX_NODE_NAME_LENGTH) continue;
    out[key] = name;
    count += 1;
  }
  return count > 0 ? out : undefined;
}

/**
 * 画布卡片的摘要：比 `toNodeSummary` 多带来源与标记。
 *
 * 入参是「已经合并去重、已套用改名」的节点（`mergeSnapshotNodes` 的产物），
 * 所以展示名取 `node.name`、原名取 `_originName`——不能再用改名表反查，
 * 那一层的 name 已经是显示名，反查会把 originName 也变成显示名。
 *
 * `sourceNames` / `chainLandingKeys` 由调用方按订阅上下文准备好：
 * 同一节点出现在多个源时取首个源，链落地节点用内容指纹匹配。
 */
export function toCanvasNodeSummary(
  node: ParsedNode,
  context: { sourceNames: Map<string, string>; chainLandingKeys: Set<string> }
): CanvasNodeSummary {
  const key = nodeRenameKey(node);
  const originName = getNodeOriginName(node);
  const name = typeof node.name === "string" && node.name ? node.name : originName;
  const sourceId = getNodeSourceIds(node)[0];
  const sourceName = sourceId ? context.sourceNames.get(sourceId) : undefined;

  return {
    key,
    name,
    originName,
    type: nodeType(node),
    ...(nodeServer(node) ? { server: nodeServer(node) } : {}),
    ...(nodePort(node) !== undefined ? { port: nodePort(node) } : {}),
    renamed: name !== originName,
    ...(sourceId ? { sourceId } : {}),
    ...(sourceName ? { sourceName } : {}),
    ...(isSubscriptionInfoNodeName(name) ? { infoNode: true } : {}),
    ...(context.chainLandingKeys.has(key) ? { chainLanding: true } : {}),
  };
}

/** 协议分布（按节点数降序，同数量按协议名字典序）。 */
export function protocolBreakdown(nodes: ParsedNode[]): Array<{ type: string; count: number }> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const type = nodeType(node);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}
