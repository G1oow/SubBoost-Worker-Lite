import type { ParsedNode } from "../types/node";

export const ORIGIN_NAME_KEY = "_originName";
export const SOURCE_IDS_KEY = "_sourceIds";

export function makeUniqueName(baseName: string, used: Set<string>): string {
  const base = baseName.trim() || "未命名节点";
  if (!used.has(base)) return base;

  let i = 2;
  let candidate = `${base} (${i})`;
  while (used.has(candidate)) {
    i += 1;
    candidate = `${base} (${i})`;
  }
  return candidate;
}

export function withUniqueNodeNames(newNodes: ParsedNode[], usedNames: Set<string>): ParsedNode[] {
  const result: ParsedNode[] = [];
  for (const node of newNodes) {
    const base = (node.name || "").toString();
    const uniqueName = makeUniqueName(base, usedNames);
    usedNames.add(uniqueName);
    result.push(uniqueName === node.name ? node : ({ ...node, name: uniqueName } as ParsedNode));
  }
  return result;
}

export function getNodeOriginName(node: ParsedNode): string {
  const record = node as unknown as Record<string, unknown>;
  if (typeof record[ORIGIN_NAME_KEY] === "string" && record[ORIGIN_NAME_KEY].trim()) {
    return String(record[ORIGIN_NAME_KEY]);
  }
  return node.name;
}

export function normalizeNodeOriginName(node: ParsedNode): ParsedNode {
  const record = node as unknown as Record<string, unknown>;
  const origin = getNodeOriginName(node);
  return origin === record[ORIGIN_NAME_KEY]
    ? node
    : ({ ...record, [ORIGIN_NAME_KEY]: origin } as unknown as ParsedNode);
}

export function getNodeSourceIds(node: ParsedNode): string[] {
  const record = node as unknown as Record<string, unknown>;
  const raw = record[SOURCE_IDS_KEY];
  if (!Array.isArray(raw)) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
/**
 * 汇总这批节点上真实存在的源 id。
 *
 * 配置里保存的源 id 可能已经指向被删除的源，用它做严格过滤会把组里的节点全部筛空，
 * 所以调用方要先拿到「真实存在的源」再决定要不要过滤。
 */
export function collectNodeSourceIds(nodes: ParsedNode[]): Set<string> {
  const out = new Set<string>();
  for (const node of nodes) {
    for (const id of getNodeSourceIds(node)) out.add(id);
  }
  return out;
}

/**
 * 把配置里写的源 id 收敛成真正生效的过滤集合。
 *
 * 返回 `null` 表示「不过滤」：没写源 id，或者写的 id 没有一个命中现存的源
 * （陈旧配置不该把整组节点打空）。
 */
export function resolveEffectiveSourceIds(
  requested: string[],
  nodes: ParsedNode[]
): Set<string> | null {
  const trimmed = requested.map((id) => id.trim()).filter(Boolean);
  if (trimmed.length === 0) return null;
  const known = collectNodeSourceIds(nodes);
  const effective = trimmed.filter((id) => known.has(id));
  return effective.length > 0 ? new Set(effective) : null;
}


export function withNodeSourceId(node: ParsedNode, sourceId: string): ParsedNode {
  const sid = (sourceId || "").trim();
  if (!sid) return node;

  const record = node as unknown as Record<string, unknown>;
  const originName =
    typeof record[ORIGIN_NAME_KEY] === "string" && String(record[ORIGIN_NAME_KEY]).trim()
      ? String(record[ORIGIN_NAME_KEY])
      : node.name;

  const currentSourceIds = getNodeSourceIds(node);
  const nextSourceIds = currentSourceIds.includes(sid) ? currentSourceIds : [...currentSourceIds, sid];

  return ({
    ...record,
    [ORIGIN_NAME_KEY]: originName,
    [SOURCE_IDS_KEY]: nextSourceIds,
  } as unknown as ParsedNode);
}

export function withoutNodeSourceIds(node: ParsedNode, removedSourceIds: Set<string>): ParsedNode | null {
  const sourceIds = getNodeSourceIds(node);
  if (sourceIds.length === 0) return node;

  const nextSourceIds = sourceIds.filter((id) => !removedSourceIds.has(id));
  if (nextSourceIds.length === sourceIds.length) return node;
  if (nextSourceIds.length === 0) return null;

  const record = node as unknown as Record<string, unknown>;
  return ({ ...record, [SOURCE_IDS_KEY]: nextSourceIds } as unknown as ParsedNode);
}

export function keepOnlyValidNodeSourceIds(node: ParsedNode, validSourceIds: Set<string>): ParsedNode | null {
  const sourceIds = getNodeSourceIds(node);
  if (sourceIds.length === 0) return node;

  const nextSourceIds = sourceIds.filter((id) => validSourceIds.has(id));
  if (nextSourceIds.length === 0) return null;
  if (nextSourceIds.length === sourceIds.length) return node;

  const record = node as unknown as Record<string, unknown>;
  return ({ ...record, [SOURCE_IDS_KEY]: nextSourceIds } as unknown as ParsedNode);
}
