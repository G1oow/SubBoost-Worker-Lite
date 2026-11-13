import type { RefreshEntry } from "./refresh-board";

/** 最近刷新是只读快照：在界面上按现有实体顺序展示，已删除的旧条目保持原相对顺序置后。 */
export function orderRefreshEntries(entries: RefreshEntry[], ids: string[]): RefreshEntry[] {
  const positions = new Map(ids.map((id, index) => [id, index]));
  return entries
    .map((entry, index) => ({ entry, index, position: positions.get(entry.id) ?? ids.length + index }))
    .sort((a, b) => a.position - b.position)
    .map(({ entry }) => entry);
}

/**
 * 把拖拽结果合并成可以提交的完整顺序。
 *
 * 刷新记录里可能还留着已删除的对象：它们只读、不能参与排序，必须从提交里剔掉；
 * 反过来，当前集合里没出现在拖拽结果中的 id 要按原顺序补回末尾，
 * 否则后端「id 集合必须完全一致」的校验会直接 409。
 */
export function mergeReorder(ids: string[], currentIds: string[]): string[] {
  const known = new Set(currentIds);
  return [...ids.filter((id) => known.has(id)), ...currentIds.filter((id) => !ids.includes(id))];
}
