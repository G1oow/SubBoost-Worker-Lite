"use client";

import * as React from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  type SortingStrategy,
} from "@dnd-kit/sortable";
import { SortableLayoutAnimationContext } from "@subboost/ui/components/ui/sortable-list";
import { cn } from "@subboost/ui/lib/utils";
import {
  defaultItemLabel,
  resolveDropWithLocked,
  sortableAnnouncements,
  type SortableDropMode,
} from "@subboost/ui/lib/sortable-order";
/** 没传 `locked` 时的共享空集合：避免每次渲染都新建 Set 让下游 memo 失效 */
const EMPTY_LOCKED: ReadonlySet<string> = new Set<string>();


export type SortableGridProps = {
  ids: string[];
  onReorder: (ids: string[]) => void;
  /** 读屏播报与手柄可访问名用的展示名：默认回退到 id，但 id 对用户没有意义，调用方应传入 */
  labelOf?: (id: string) => string;
  disabled?: boolean;
  /**
   * 落点语义：
   * - `insert`（默认）：插到落点，沿途卡片依次让位（自动补位动画）；
   * - `swap`：与落点上的卡片直接交换位置，其余卡片不动。
   */
  mode?: SortableDropMode;
  /**
   * 拖拽经过的卡片变化时回调。交换模式没有位移预览，调用方拿它高亮目标卡片；
   * `null` 表示当前没有落点（离开卡片或拖拽结束）。
   */
  onOverChange?: (id: string | null) => void;
  /**
   * 锁定的卡片（按 id）：钉在自己的下标上，不参与重排。调用方还应把它们设为不可拖。
   */
  locked?: ReadonlySet<string>;
  /** 网格类（间距等）；列数由预设动态决定，走 `style` 或调用方自己的类 */
  className?: string;
  /** 列模板由调用方算好传进来：3/4/5 列与窄屏降级都靠它 */
  style?: React.CSSProperties;
  children: React.ReactNode;
};

/**
 * 交换模式不画位移预览。
 *
 * 这里以前用 dnd-kit 的 `rectSwappingStrategy`（把被扫到的卡片挪到被拖卡片的原槽位），有两个硬伤：
 * 1. 指针扫过一串卡片时，每张被扫到的卡片都要整块飞过去再飞回来，动作大得像乱跳；
 * 2. 松手那一下 `items` 已经换了顺序、`rects` 还是旧测量值，策略用新下标重算会得出一个
 *    等于拖拽位移的假 transform —— 换上去的卡片会从指针位置再滑回自己槽位一次。
 *
 * 交换本来就该是"松手那一刻直接换"，所以这里什么都不位移：除了跟手的被拖卡片，其余卡片原地不动，
 * 目标卡片由调用方用描边高亮。
 */
const NO_SHIFT_PREVIEW: SortingStrategy = () => null;

/**
 * 策略跟着落点语义走：补位用 `rectSortingStrategy`（沿途项依次平移，与实际插入结果一致），
 * 交换用不做位移的预览。
 */
const STRATEGIES: Record<SortableDropMode, SortingStrategy> = {
  insert: rectSortingStrategy,
  swap: NO_SHIFT_PREVIEW,
};

const INSTRUCTIONS: Record<SortableDropMode, string> = {
  insert: "按空格键拾起卡片，使用方向键移动，再按空格键放下；按 Escape 取消。",
  swap: "按空格键拾起卡片，使用方向键选到目标卡片，再按空格键与它交换位置；按 Escape 取消。",
};

/**
 * 网格版拖拽排序容器：与 `SortableList` 同一套传感器、播报与判定逻辑，
 * 只把排序策略换成二维矩形判定（跨行也能落位）。
 *
 * 内部仍是 `<ul>`，条目继续用 `SortableItem` / `SortableHandle`——
 * 网格只由 CSS（`grid` + 列模板）表达，行数随条目数自动延伸。
 */
export function SortableGrid({
  ids,
  onReorder,
  labelOf = defaultItemLabel,
  disabled = false,
  mode = "insert",
  onOverChange,
  locked = EMPTY_LOCKED,
  className,
  style,
  children,
}: SortableGridProps) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    onOverChange?.(null);
    const next = resolveDropWithLocked(ids, active, over, disabled, mode, locked);
    if (next) onReorder(next);
  };

  const announcements = React.useMemo(() => sortableAnnouncements(labelOf, mode), [labelOf, mode]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      onDragOver={({ over }) => onOverChange?.(over ? String(over.id) : null)}
      onDragCancel={() => onOverChange?.(null)}
      accessibility={{
        screenReaderInstructions: { draggable: INSTRUCTIONS[mode] },
        announcements,
      }}
    >
      <SortableLayoutAnimationContext.Provider value={mode === "insert"}>
        <SortableContext items={ids} strategy={STRATEGIES[mode]} disabled={disabled}>
          <ul style={style} className={cn("grid", className)} data-drop-mode={mode}>
            {children}
          </ul>
        </SortableContext>
      </SortableLayoutAnimationContext.Provider>
    </DndContext>
  );
}
