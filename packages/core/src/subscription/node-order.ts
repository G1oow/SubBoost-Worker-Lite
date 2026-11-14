import { isRenameKey, nodeRenameKey } from "../node-rename-key";
import type { ParsedNode } from "../types/node";

/**
 * 节点自定义顺序（`config.nodeOrder`）。
 *
 * 语义：
 * - 键是节点内容指纹（`nodeRenameKey`），与改名表、链引用同一套实现：改名不影响命中，
 *   上游改凭据/端口等身份字段后键改变，等价于「旧节点消失 + 新节点出现」。
 * - 顺序表里出现且当前存在的节点按表的先后排在前面，其余节点保持原相对顺序追加在末尾。
 *   这条规则保证「新增节点不会插进用户排好的位置」，也保证条目指向暂时消失的节点时不丢顺序。
 */

/** 顺序表条目上限：5000 个节点足够覆盖 10 个源 × 500 节点的画布上限还有余量 */
export const MAX_NODE_ORDER_ENTRIES = 5000;

/** 校验并清理顺序表：非指纹字符串、重复项一律丢弃，超长截断。 */
export function normalizeNodeOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRenameKey(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
    if (out.length >= MAX_NODE_ORDER_ENTRIES) break;
  }
  return out;
}

/**
 * 按顺序表稳定重排节点。
 *
 * 返回新数组；顺序表为空或没有任何命中时原样返回入参，避免调用方白拷贝一次大数组。
 */
export function applyNodeOrder<T extends ParsedNode>(nodes: T[], order: string[]): T[] {
  if (order.length === 0 || nodes.length === 0) return nodes;

  const byKey = new Map<string, T>();
  for (const node of nodes) {
    const key = nodeRenameKey(node);
    // 上游已按内容指纹去重；这里保留首次出现只是兜底
    if (!byKey.has(key)) byKey.set(key, node);
  }

  const used = new Set<string>();
  const head: T[] = [];
  for (const key of order) {
    const node = byKey.get(key);
    if (!node || used.has(key)) continue;
    used.add(key);
    head.push(node);
  }
  if (head.length === 0) return nodes;

  const out = [...head];
  for (const node of nodes) {
    const key = nodeRenameKey(node);
    if (used.has(key)) continue;
    used.add(key);
    out.push(node);
  }
  return out;
}
