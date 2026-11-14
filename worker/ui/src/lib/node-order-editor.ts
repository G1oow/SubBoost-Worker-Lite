import { isRenameKey } from "@subboost/core/node-rename-key";
import { REGION_PRESETS, detectNodeRegion } from "@subboost/core/proxy-group-advanced";
import type { CanvasNodeSummary } from "./types";

/**
 * 「节点排序」画布的纯逻辑。
 *
 * 三件事必须能脱离 DOM 断言，所以都放这里：
 * - 顺序表与配置的读写（`config.nodeOrder`）；
 * - 画布顺序与「未加载节点」的合并（保存时不能把没显示出来的条目丢掉）；
 * - 过滤态下的调序（隐藏项占位不动）。
 */

/** 配置里的字段名：内容指纹数组，语义见 `@subboost/core/subscription/node-order` */
export const NODE_ORDER_CONFIG_KEY = "nodeOrder";

/** 列数是纯显示偏好，跟浏览器走，不进配置 */
export const GRID_COLUMNS_STORAGE_KEY = "subboost-node-grid-columns";
export const SELECTED_SUBSCRIPTIONS_STORAGE_KEY = "subboost-node-grid-subscriptions";

export const GRID_COLUMN_PRESETS = [3, 4, 5] as const;
export type GridColumns = (typeof GRID_COLUMN_PRESETS)[number];
export const DEFAULT_GRID_COLUMNS: GridColumns = 4;

/** 超过这个节点数就提示可能卡顿并关掉入场动画 */
export const CANVAS_HEAVY_THRESHOLD = 400;

function readIdentityList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRenameKey(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

export function readNodeOrder(config: Record<string, unknown>): string[] {
  return readIdentityList(config[NODE_ORDER_CONFIG_KEY]);
}

/** 写回顺序：空表就把字段删掉，别在配置里留一个空数组 */
export function writeNodeOrder(
  config: Record<string, unknown>,
  order: string[]
): Record<string, unknown> {
  const next = readIdentityList(order);
  const rest = { ...config };
  if (next.length === 0) {
    delete rest[NODE_ORDER_CONFIG_KEY];
    return rest;
  }
  rest[NODE_ORDER_CONFIG_KEY] = next;
  return rest;
}

/**
 * 把画布顺序合并进已保存的顺序表。
 *
 * 画布只铺勾选订阅的节点，所以保存时不能直接用画布顺序整体覆盖：
 * 已保存但这次没显示出来的条目（别的订阅的节点、超出上限被截断的节点）
 * 要按它们在旧顺序里的相对位置插回去——插在「旧顺序里它后面第一个仍在画布的节点」之前，
 * 后面已经没有画布节点的就追加到末尾。
 */
export function mergeOrderWithCanvas(savedOrder: string[], canvasOrder: string[]): string[] {
  const canvasKeys: string[] = [];
  const canvasSet = new Set<string>();
  for (const key of readIdentityList(canvasOrder)) {
    if (canvasSet.has(key)) continue;
    canvasSet.add(key);
    canvasKeys.push(key);
  }

  const seen = new Set<string>();
  const before = new Map<string, string[]>();
  const tail: string[] = [];
  let anchor: string | null = null;
  for (let index = savedOrder.length - 1; index >= 0; index -= 1) {
    const key = savedOrder[index];
    if (!isRenameKey(key) || seen.has(key)) continue;
    seen.add(key);
    if (canvasSet.has(key)) {
      anchor = key;
      continue;
    }
    if (anchor) {
      const list = before.get(anchor) ?? [];
      list.unshift(key);
      before.set(anchor, list);
    } else {
      tail.unshift(key);
    }
  }

  const out: string[] = [];
  for (const key of canvasKeys) {
    const pending = before.get(key);
    if (pending) out.push(...pending);
    out.push(key);
  }
  out.push(...tail);
  return out;
}

/**
 * 把「可见项的新顺序」写回完整顺序：隐藏项占位不动。
 *
 * 过滤态下拖拽只给出可见项的重排结果（dnd-kit 只看得到渲染出来的卡片），
 * 直接拿它覆盖完整顺序会把没显示出来的节点顺序打乱，所以按「可见槽位」回填。
 * 不过滤时可见槽位就是全部槽位，等价于直接替换。
 */
export function applyVisibleOrder(
  order: string[],
  visibleKeys: string[],
  nextVisibleOrder: string[]
): string[] {
  const visibleSet = new Set(visibleKeys);
  const slots: number[] = [];
  for (let index = 0; index < order.length; index += 1) {
    if (visibleSet.has(order[index])) slots.push(index);
  }
  if (slots.length === 0 || nextVisibleOrder.length !== slots.length) return order;

  const next = [...order];
  slots.forEach((slot, index) => {
    next[slot] = nextVisibleOrder[index];
  });
  return next;
}

/** 搜索框过滤：名称与协议都参与匹配，空查询原样返回 */
export function filterCanvasNodes<T extends { name: string; type: string }>(nodes: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return nodes;
  return nodes.filter(
    (node) => node.name.toLowerCase().includes(needle) || node.type.toLowerCase().includes(needle)
  );
}

const REGION_RANK = new Map(REGION_PRESETS.map((preset, index) => [preset.id, index]));

/**
 * 按地区一键排序：地区顺序取自分组筛选用的 `REGION_PRESETS`（美国→香港→日本→…→其他），
 * 同地区按名称排序，未识别地区排在最后。
 */
export function autoOrderByRegion(nodes: CanvasNodeSummary[]): string[] {
  const fallbackRank = REGION_PRESETS.length;
  return [...nodes]
    .map((node) => ({ node, rank: REGION_RANK.get(detectNodeRegion(node.name)) ?? fallbackRank }))
    .sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank;
      return left.node.name.localeCompare(right.node.name, "zh-Hans-CN");
    })
    .map((item) => item.node.key);
}

/**
 * 重建画布顺序：已保存的顺序优先，其次保留用户这次拖出来的相对顺序，最后是刚拿到的新节点。
 *
 * 触发时机是「数据到了」或「已保存顺序变了」，所以不能无脑用 saved 覆盖：
 * 用户拖过但还没保存的那一段得留住，否则一刷新就跳回原位。
 */
export function rebuildCanvasOrder(
  current: string[],
  loadedKeys: string[],
  savedOrder: string[]
): string[] {
  const loadedSet = new Set(loadedKeys);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of savedOrder) {
    if (!loadedSet.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  for (const key of current) {
    if (!loadedSet.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  for (const key of loadedKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export type CanvasCoverage = {
  /** 画布上实际铺开的节点数 */
  loaded: number;
  /** 因为上限没进画布的节点数 */
  truncated: number;
};

/** 画布覆盖情况：只统计所选订阅「被上限截断」的部分，其它订阅的节点不在画布上 */
export function summarizeCanvasCoverage(
  response: { nodeCount: number; nodes: unknown[] } | null
): CanvasCoverage {
  if (!response) return { loaded: 0, truncated: 0 };
  return {
    loaded: response.nodes.length,
    truncated: Math.max(0, response.nodeCount - response.nodes.length),
  };
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readGridColumns(storage: Storage | null = safeStorage()): GridColumns {
  const raw = storage?.getItem(GRID_COLUMNS_STORAGE_KEY) ?? "";
  const parsed = Number.parseInt(raw, 10);
  return (GRID_COLUMN_PRESETS as readonly number[]).includes(parsed)
    ? (parsed as GridColumns)
    : DEFAULT_GRID_COLUMNS;
}

export function saveGridColumns(value: GridColumns, storage: Storage | null = safeStorage()): void {
  try {
    storage?.setItem(GRID_COLUMNS_STORAGE_KEY, String(value));
  } catch {
    // 隐私模式下写不进去：只是显示偏好，丢了不影响功能
  }
}

/**
 * 记住的是「哪一条订阅」（单选）。
 *
 * 早期版本把勾选集存成 JSON 数组，这里兼容读取：数组取第一项，
 * 老用户升级后不会看到画布突然变成空状态。
 */
export function readSelectedSubscription(storage: Storage | null = safeStorage()): string | null {
  const raw = (storage?.getItem(SELECTED_SUBSCRIPTIONS_STORAGE_KEY) ?? "").trim();
  if (!raw) return null;
  if (!raw.startsWith("[")) return raw.startsWith("{") ? null : raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const id = item.trim();
      if (id) return id;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSelectedSubscription(
  subscriptionId: string | null,
  storage: Storage | null = safeStorage()
): void {
  try {
    if (!subscriptionId) {
      storage?.removeItem(SELECTED_SUBSCRIPTIONS_STORAGE_KEY);
      return;
    }
    storage?.setItem(SELECTED_SUBSCRIPTIONS_STORAGE_KEY, subscriptionId);
  } catch {
    // 记忆失败只是下次要重新选
  }
}
