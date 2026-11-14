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
} from "@dnd-kit/sortable";
import { cn } from "@subboost/ui/lib/utils";
import { defaultItemLabel, resolveReorder, sortableAnnouncements } from "@subboost/ui/lib/sortable-order";

export type SortableGridProps = {
  ids: string[];
  onReorder: (ids: string[]) => void;
  /** 读屏播报与手柄可访问名用的展示名：默认回退到 id，但 id 对用户没有意义，调用方应传入 */
  labelOf?: (id: string) => string;
  disabled?: boolean;
  /** 网格类（间距等）；列数由预设动态决定，走 `style` 或调用方自己的类 */
  className?: string;
  /** 列模板由调用方算好传进来：3/4/5 列与窄屏降级都靠它 */
  style?: React.CSSProperties;
  children: React.ReactNode;
};

/**
 * 网格版拖拽排序容器：与 `SortableList` 同一套传感器、播报与判定逻辑，
 * 只把排序策略换成 `rectSortingStrategy`（按二维矩形判定，跨行也能落位）。
 *
 * 内部仍是 `<ul>`，条目继续用 `SortableItem` / `SortableHandle`——
 * 网格只由 CSS（`grid` + 列模板）表达，行数随条目数自动延伸。
 */
export function SortableGrid({
  ids,
  onReorder,
  labelOf = defaultItemLabel,
  disabled = false,
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
    const next = resolveReorder(ids, active, over, disabled);
    if (next) onReorder(next);
  };

  const announcements = React.useMemo(() => sortableAnnouncements(labelOf), [labelOf]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        screenReaderInstructions: {
          draggable: "按空格键拾起卡片，使用方向键移动，再按空格键放下；按 Escape 取消。",
        },
        announcements,
      }}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy} disabled={disabled}>
        <ul style={style} className={cn("grid", className)}>
          {children}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
