import type { Announcements } from "@dnd-kit/core";

/**
 * 拖拽排序的纯逻辑：判定与播报文案都放这里，组件只负责接线。
 * 抽出来是因为这些分支（没落在任何项上、落在自己身上、列表已禁用、id 不在当前列表里）
 * 都要能脱离 DOM 断言，而组件文件本身不该为了覆盖率去模拟指针事件。
 */

/** 默认的条目名回退：内部 id 对用户没有意义，调用方应尽量传 labelOf */
export function defaultItemLabel(id: string): string {
  return id;
}

/**
 * 算出拖拽结束后的新顺序；不该重排时返回 null。
/** 拖拽目标：dnd-kit 的 active / over 都有 id，唯一差别是 over 可能为 null */
export type DragTarget = { id: string | number } | null | undefined;

/**
 * 算出拖拽结束后的新顺序；不该重排时返回 null。
 *
 * - `disabled`：列表整体禁用（保存进行中）时不重排；
 * - `active` / `over` 缺失：没拾起或没落在任何项上；
 * - 两者同一项：拾起又原地放下；
 * - id 不在 `ids` 里：拖拽结果来自过期数据，宁可不动作也不能写出错误顺序。
 *
 * 判空全部收在这里而不是组件里，是为了让组件只做接线、这些边界能脱离 DOM 断言。
 */
export function resolveReorder(
  ids: string[],
  active: DragTarget,
  over: DragTarget,
  disabled = false
): string[] | null {
  if (disabled || !active || !over) return null;
  const activeId = String(active.id);
  const overId = String(over.id);
  if (activeId === overId) return null;

  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0) return null;

  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * 读屏播报文案。
 *
 * dnd-kit 默认播报是英文，而且直接念内部 id（`Draggable item <uuid> was dropped over ...`），
 * 对中文用户既听不懂也认不出是哪一项，所以统一换成条目名。
 */
export function sortableAnnouncements(labelOf: (id: string) => string): Announcements {
  return {
    onDragStart: ({ active }) => `已拾起「${labelOf(String(active.id))}」`,
    onDragOver: ({ active, over }) =>
      over ? `「${labelOf(String(active.id))}」移动到「${labelOf(String(over.id))}」的位置` : "",
    onDragEnd: ({ active, over }) =>
      over ? `「${labelOf(String(active.id))}」已放在「${labelOf(String(over.id))}」的位置` : "",
    onDragCancel: ({ active }) => `已取消排序，「${labelOf(String(active.id))}」回到原位`,
  };
}
