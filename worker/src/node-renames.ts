import { isSubscriptionInfoNodeName } from "@subboost/core/subscription/info-node-name";
import { getNodeOriginName, getNodeSourceIds } from "@subboost/core/subscription/node-source-state";
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

export function toNodeSummary(node: ParsedNode, renames?: NodeRenames): NodeSummary {
  const key = nodeRenameKey(node);
  const originName = nodeOriginName(node);
  const renamed = renames?.[key];
  return {
    key,
    name: renamed ?? originName,
    originName,
    type: nodeType(node),
    ...(nodeServer(node) ? { server: nodeServer(node) } : {}),
    ...(nodePort(node) !== undefined ? { port: nodePort(node) } : {}),
    renamed: Boolean(renamed && renamed !== originName),
  };
}

export function collectNodeSummaries(
  nodes: ParsedNode[],
  renames?: NodeRenames,
  limit = MAX_PREVIEW_NODES
): NodeSummary[] {
  return nodes.slice(0, limit).map((node) => toNodeSummary(node, renames));
}

export function countRenamedNodes(nodes: ParsedNode[], renames?: NodeRenames): number {
  if (!renames) return 0;
  let count = 0;
  for (const node of nodes) {
    const next = renames[nodeRenameKey(node)];
    if (next && next !== nodeOriginName(node)) count += 1;
  }
  return count;
}

/**
 * 校验并清理客户端提交的重命名表：丢弃非法 key、空名称、超长名称与超出上限的条目。
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
