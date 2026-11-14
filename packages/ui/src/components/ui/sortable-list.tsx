"use client";

import * as React from "react";
import { GripVertical } from "lucide-react";
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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Icon } from "@subboost/ui/components/ui/icon";
import { cn } from "@subboost/ui/lib/utils";
import { defaultItemLabel, resolveReorder, sortableAnnouncements } from "@subboost/ui/lib/sortable-order";

export type SortableListProps = {
  ids: string[];
  onReorder: (ids: string[]) => void;
  /** 读屏播报与手柄可访问名用的展示名：默认回退到 id，但 id 对用户没有意义，调用方应传入 */
  labelOf?: (id: string) => string;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
};

/** 拖拽只从手柄开始，触摸长按后激活，不劫持列表滚动。 */
export function SortableList({
  ids,
  onReorder,
  labelOf = defaultItemLabel,
  disabled = false,
  className,
  children,
}: SortableListProps) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const next = resolveReorder(ids, active, over, disabled);
    if (next) onReorder(next);
  };

  // 播报文案是纯函数，交给 lib 里的 sortableAnnouncements，组件只负责接线
  const announcements = React.useMemo(() => sortableAnnouncements(labelOf), [labelOf]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        screenReaderInstructions: {
          draggable: "按空格键拾起卡片，使用上下方向键移动，再按空格键放下；按 Escape 取消。",
        },
        announcements,
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={disabled}>
        <ul className={className}>{children}</ul>
      </SortableContext>
    </DndContext>
  );
}

type SortableActivator = "handle" | "card";

type SortableItemContextValue = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners" | "setActivatorNodeRef"
> & { label: string; disabled: boolean; activator: SortableActivator };

const SortableItemContext = React.createContext<SortableItemContextValue | null>(null);

export type SortableItemProps = {
  id: string;
  /** 手柄的可访问名与读屏播报使用的条目名 */
  label: string;
  disabled?: boolean;
  /**
   * 拖拽从哪开始：
   * - `handle`（默认）：只从 `SortableHandle` 拖，适合一行一条的列表（卡片里有按钮/链接）；
   * - `card`：按住整张卡片就能拖，适合网格画布这类卡片本身没有交互的场合。
   */
  activator?: SortableActivator;
  children: React.ReactNode;
};

/**
 * 列表中的一项：只负责注册拖拽节点与接线，外观完全交给 `children` 里的卡片。
 *
 * 默认由卡片自己渲染手柄（见 `SortableHandle`）；`activator="card"` 时把监听与可访问属性
 * 挂到条目本身，整张卡片就是拖拽把手，不再需要（也不应再渲染）手柄。
 */
export function SortableItem({ id, label, disabled = false, activator = "handle", children }: SortableItemProps) {
  const { setNodeRef, transform, transition, isDragging, attributes, listeners, setActivatorNodeRef } =
    useSortable({ id, disabled });

  const value = React.useMemo<SortableItemContextValue>(
    () => ({ label, disabled, activator, attributes, listeners, setActivatorNodeRef }),
    [label, disabled, activator, attributes, listeners, setActivatorNodeRef]
  );

  const cardActivator = activator === "card";

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: isDragging ? undefined : transition,
      }}
      /*
       * 拖动中把卡片抬到最上层，其余项保持原样：不加位移或缩放，
       * 避免被拖动的卡片连同文字一起被插值重采样。
       *
       * 整卡拖拽时描边由卡片自己负责（监听挂在卡片外层 div 上，`[&>div]` 会命中那层壳），
       * 这里只保留抬升与轻微透明，不猜卡片结构。
       */
      className={cn(
        "relative list-none",
        isDragging && "z-10 opacity-90",
        isDragging && !cardActivator && "[&>div]:border-card-border-hover"
      )}
    >
      {cardActivator ? (
        /*
         * 整卡拖拽：监听与可访问属性（role=button、tabIndex、aria-roledescription）挂在卡片外层，
         * `<li>` 保留列表语义，读屏仍能按列表浏览。
         * `touch-pan-y` 让竖向滑动继续滚动页面，长按 220ms 才进入拖拽（见 SortableGrid 的传感器）。
         */
        <div
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="h-full cursor-grab touch-pan-y active:cursor-grabbing"
        >
          <SortableItemContext.Provider value={value}>{children}</SortableItemContext.Provider>
        </div>
      ) : (
        <SortableItemContext.Provider value={value}>{children}</SortableItemContext.Provider>
      )}
    </li>
  );
}

export type SortableHandleProps = {
  /** 覆盖默认名称（默认取 SortableItem 的 label） */
  label?: string;
  className?: string;
};

/**
 * 拖拽手柄：贴在卡片左侧内边距里的一个小把手，视觉上属于卡片本身。
 *
 * 分两层写是为了让「命中区够大」与「看起来足够小」同时成立：
 * - 外层 `<button>` 占满卡片高度（≥44px）、32px 宽，负责接指针与键盘；
 * - 内层 28px 圆角方块才是可见本体：14px 抓握图标、常态 `text-fg-35`、无底色，
 *   指针悬停或键盘聚焦时才浮出 `bg-ink/5` 与更亮的前景。
 *
 * 竖向位置用内边距而不是位移：窄屏卡片竖排、标题在第一行，`pt-2` 让图标正好落在标题行
 * 中线上；`sm` 起卡片横排、内容垂直居中，图标随之居中。全程没有 transform，
 * 不会把卡片内容提升为合成层（见 frontend-guidelines「已知陷阱」）。
 */
export function SortableHandle({ label, className }: SortableHandleProps = {}) {
  const context = React.useContext(SortableItemContext);
  if (!context) throw new Error("SortableHandle 必须渲染在 SortableItem 内部");
  const { label: itemLabel, disabled, activator, attributes, listeners, setActivatorNodeRef } = context;
  const name = label ?? itemLabel;

  // 整卡拖拽时监听已经挂在条目上，再渲染手柄只会多一个焦点目标
  if (activator === "card") return null;

  return (
    <button
      ref={setActivatorNodeRef}
      type="button"
      aria-label={`拖动排序 ${name}`}
      title={`拖动排序 ${name}`}
      disabled={disabled}
      {...attributes}
      {...listeners}
      className={cn(
        "group/handle absolute inset-y-0 left-1 flex w-8 cursor-grab touch-pan-y items-start justify-center pt-2",
        "sm:items-center sm:pt-0 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
    >
      <span
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-md text-fg-35 transition-colors duration-150",
          // 悬停整张卡片时先浮出一点，指针落到手柄上再加深：两级反馈，都不抢视线
          "group-hover:text-fg-60 group-hover/handle:bg-ink/5 group-hover/handle:text-fg-70",
          "group-focus-visible/handle:text-fg-70 group-focus-visible/handle:outline-2",
          "group-focus-visible/handle:outline-offset-2 group-focus-visible/handle:outline-focus-ring"
        )}
      >
        <Icon icon={GripVertical} size="xs" />
      </span>
    </button>
  );
}
