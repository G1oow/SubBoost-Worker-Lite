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

/** 拖拽目标：dnd-kit 的 active / over 都有 id，唯一差别是 over 可能为 null */
export type DragTarget = { id: string | number } | null | undefined;

/**
 * 落点语义：
 * - `insert`（默认，自动补位）：把被拖的项插到落点，沿途的项依次顺延一格；
 * - `swap`：被拖的项与落点上的项直接交换位置，其余项原地不动。
 */
export type SortableDropMode = "insert" | "swap";

type DropPair = { from: number; to: number };

/**
 * 把「拖到了哪两项上」的判空收在一处，insert 与 swap 共用：
 *
 * - `disabled`：列表整体禁用（保存进行中）时不重排；
 * - `active` / `over` 缺失：没拾起或没落在任何项上；
 * - 两者同一项：拾起又原地放下；
 * - id 不在 `ids` 里：拖拽结果来自过期数据，宁可不动作也不能写出错误顺序。
 */
function resolveDropPair(
  ids: string[],
  active: DragTarget,
  over: DragTarget,
  disabled: boolean
): DropPair | null {
  if (disabled || !active || !over) return null;
  const activeId = String(active.id);
  const overId = String(over.id);
  if (activeId === overId) return null;

  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0) return null;
  return { from, to };
}

/** 补位语义：算出拖拽结束后的新顺序；不该重排时返回 null */
export function resolveReorder(
  ids: string[],
  active: DragTarget,
  over: DragTarget,
  disabled = false
): string[] | null {
  const pair = resolveDropPair(ids, active, over, disabled);
  if (!pair) return null;

  const next = [...ids];
  const [moved] = next.splice(pair.from, 1);
  next.splice(pair.to, 0, moved);
  return next;
}

/**
 * 交换语义：被拖的项与落点上的项互换位置，中间与两侧的项都不动。
 * 判定与 `resolveReorder` 完全一致，只是落位方式不同。
 */
export function resolveSwap(
  ids: string[],
  active: DragTarget,
  over: DragTarget,
  disabled = false
): string[] | null {
  const pair = resolveDropPair(ids, active, over, disabled);
  if (!pair) return null;

  const next = [...ids];
  [next[pair.from], next[pair.to]] = [next[pair.to], next[pair.from]];
  return next;
}

/** 按落点语义选实现：组件只传 mode，不再自己分支 */
export function resolveDrop(
  ids: string[],
  active: DragTarget,
  over: DragTarget,
  disabled = false,
  mode: SortableDropMode = "insert"
): string[] | null {
  return mode === "swap"
    ? resolveSwap(ids, active, over, disabled)
    : resolveReorder(ids, active, over, disabled);
}

/**
 * 带锁定的落位：锁定的条目钉在自己的下标上，其余条目在剩下的槽位里按同一套语义重排。
 *
 * - 被拖的条目自己锁定 → 不动（调用方也应把它设为不可拖）；
 * - 落点是被锁定的条目：
 *   - 交换语义 → 不动，锁着的卡片不参与互换；
 *   - 补位语义 → 落到「它前面有几个未锁定槽位」这个边界上，锁定条目自身位置不变。
 */
export function resolveDropWithLocked(
  ids: string[],
  active: DragTarget,
  over: DragTarget,
  disabled: boolean,
  mode: SortableDropMode,
  locked: ReadonlySet<string>
): string[] | null {
  if (locked.size === 0) return resolveDrop(ids, active, over, disabled, mode);
  if (disabled || !active || !over) return null;

  const activeId = String(active.id);
  const overId = String(over.id);
  if (activeId === overId) return null;

  const activeIndex = ids.indexOf(activeId);
  const overIndex = ids.indexOf(overId);
  if (activeIndex < 0 || overIndex < 0) return null;
  // 锁定的条目拖不动：宁可不动作，也不能让锁定失效
  if (locked.has(activeId)) return null;

  const slotIndices: number[] = [];
  for (let index = 0; index < ids.length; index += 1) {
    if (!locked.has(ids[index])) slotIndices.push(index);
  }
  const unlockedIds = slotIndices.map((slot) => ids[slot]);
  const from = unlockedIds.indexOf(activeId);

  let to: number;
  if (locked.has(overId)) {
    if (mode === "swap") return null;
    let before = 0;
    for (const slot of slotIndices) {
      if (slot < overIndex) before += 1;
    }
    to = before;
  } else {
    to = unlockedIds.indexOf(overId);
  }
  if (from < 0 || to < 0 || from === to) return null;

  const nextUnlocked = [...unlockedIds];
  if (mode === "swap") {
    [nextUnlocked[from], nextUnlocked[to]] = [nextUnlocked[to], nextUnlocked[from]];
  } else {
    const [moved] = nextUnlocked.splice(from, 1);
    nextUnlocked.splice(to, 0, moved);
  }

  const next = [...ids];
  slotIndices.forEach((slot, index) => {
    next[slot] = nextUnlocked[index];
  });
  return next;
}

/**
 * 读屏播报文案。
 *
 * dnd-kit 默认播报是英文，而且直接念内部 id（`Draggable item <uuid> was dropped over ...`），
 * 对中文用户既听不懂也认不出是哪一项，所以统一换成条目名。
 * 交换语义下换成「与…交换位置」，否则读屏会报出一个与实际结果不符的动作。
 */
export function sortableAnnouncements(
  labelOf: (id: string) => string,
  mode: SortableDropMode = "insert"
): Announcements {
  const swapping = mode === "swap";
  return {
    onDragStart: ({ active }) => `已拾起「${labelOf(String(active.id))}」`,
    onDragOver: ({ active, over }) => {
      if (!over) return "";
      const name = labelOf(String(active.id));
      const target = labelOf(String(over.id));
      return swapping ? `「${name}」将与「${target}」交换位置` : `「${name}」移动到「${target}」的位置`;
    },
    onDragEnd: ({ active, over }) => {
      if (!over) return "";
      const name = labelOf(String(active.id));
      const target = labelOf(String(over.id));
      return swapping ? `「${name}」已与「${target}」交换位置` : `「${name}」已放在「${target}」的位置`;
    },
    onDragCancel: ({ active }) => `已取消排序，「${labelOf(String(active.id))}」回到原位`,
  };
}
