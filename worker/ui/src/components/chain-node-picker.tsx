import * as React from "react";
import { RefreshCw, Search, X } from "lucide-react";
import { Badge } from "@subboost/ui/components/ui/badge";
import { Button } from "@subboost/ui/components/ui/button";
import { EmptyState } from "@subboost/ui/components/ui/empty-state";
import { Icon } from "@subboost/ui/components/ui/icon";
import { IconButton } from "@subboost/ui/components/ui/icon-button";
import { Input } from "@subboost/ui/components/ui/input";
import { InlineNote } from "@subboost/ui/components/ui/inline-note";
import { ProtocolBadge } from "@subboost/ui/components/ui/protocol-badge";
import { cn } from "@subboost/ui/lib/utils";
import type { ChainNodeRef } from "@subboost/core/types/config";
import type { NodeSummary, SourceNodesResponse } from "../lib/types";

/** 单次加载的节点条的渲染上限：节点太多的源分批展开，避免一次铺几百行 */
export const NODE_PICKER_PAGE = 50;

export type ChainNodeLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: SourceNodesResponse };

export type ChainNodePickerProps = {
  /** 当前选中的源名，用于空态文案 */
  sourceName: string;
  /** 选中节点的加载状态；没选源时为空 */
  state: ChainNodeLoadState | null;
  /** 该侧已选的引用（用于高亮与计数） */
  selected: readonly ChainNodeRef[];
  /** 选中的源 id：决定 ref 的 `sourceId` */
  sourceId: string | null;
  onToggle: (ref: ChainNodeRef) => void;
  onRetry?: () => void;
  disabled?: boolean;
};

function matchesQuery(node: NodeSummary, query: string): boolean {
  if (!query) return true;
  const haystack = `${node.name} ${node.originName} ${node.type} ${node.server ?? ""}`.toLowerCase();
  return haystack.includes(query);
}

/**
 * 「先选源，再选节点」里的节点列表。
 *
 * 只做选择，不做改名：改名仍走「源管理」，这里按内容指纹引用，改名后引用不失效。
 * 已选节点以 chips 单列在下方，顺序即组成员顺序，可移除、可调序。
 */
export function ChainNodePicker({
  sourceName,
  state,
  selected,
  sourceId,
  onToggle,
  onRetry,
  disabled = false,
}: ChainNodePickerProps) {
  const [query, setQuery] = React.useState("");
  const [limit, setLimit] = React.useState(NODE_PICKER_PAGE);
  const normalizedQuery = query.trim().toLowerCase();

  const selectedKeys = React.useMemo(
    () => new Set(selected.filter((ref) => ref.sourceId === sourceId).map((ref) => ref.nodeKey)),
    [selected, sourceId]
  );

  React.useEffect(() => {
    setLimit(NODE_PICKER_PAGE);
  }, [sourceId, normalizedQuery]);

  if (!sourceId) {
    return (
      <EmptyState className="px-3 py-5 text-xs">先在下面选一个源，再回来挑节点。</EmptyState>
    );
  }

  if (!state || state.status === "loading") {
    return (
      <div className="space-y-1.5" aria-busy="true">
        {[0, 1, 2].map((index) => (
          <div key={index} className="skeleton h-10 w-full animate-shimmer" aria-hidden="true" />
        ))}
        <p className="text-2xs text-fg-45">正在读取「{sourceName}」的节点…</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger-note-border bg-danger-note-bg px-3 py-2">
        <p className="min-w-0 break-words text-xs text-danger-note-fg">{state.message}</p>
        {onRetry ? (
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            <Icon icon={RefreshCw} />
            重试
          </Button>
        ) : null}
      </div>
    );
  }

  const nodeSource = state.data.source;
  const nodes = state.data.nodes;
  const visible = nodes.filter((node) => matchesQuery(node, normalizedQuery));
  const shown = visible.slice(0, limit);

  return (
    <div className="space-y-2">
      {nodeSource.enabled === false ? (
        <InlineNote variant="plain" alert>
          这个源已停用：可以选节点，但要先启用该源才会生成。
        </InlineNote>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xs text-fg-45">
          {`共 ${nodes.length} 个节点 · 已选 ${selectedKeys.size} 个`}
          {state.data.nodeCount > nodes.length ? `（仅列出前 ${nodes.length} 个）` : ""}
        </p>
        {nodes.length > 6 ? (
          <div className="relative w-full sm:w-52">
            <Icon
              icon={Search}
              size="sm"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-45"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索名称 / 协议 / 服务器"
              aria-label={`搜索「${nodeSource.name}」的节点`}
              className="h-9 pl-8 text-base sm:h-8 sm:text-xs"
            />
          </div>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <EmptyState className="px-3 py-5 text-xs">
          {nodes.length === 0
            ? "这个源还没有节点快照，回「仪表板」刷新一次即可看到。"
            : "没有匹配的节点。"}
        </EmptyState>
      ) : (
        // 选中态只改颜色，不位移：列表在滚动容器里，位移会让文字发虚
        <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
          {shown.map((node) => {
            const checked = selectedKeys.has(node.key);
            return (
              <li key={node.key}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={checked}
                  onClick={() => onToggle({ sourceId: nodeSource.id, nodeKey: node.key })}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-xs transition-[border-color,background-color] duration-200",
                    checked
                      ? "border-primary-500/50 bg-primary-500/20 text-fg"
                      : "border-ink/10 bg-ink/5 text-fg-70 hover:border-ink/20 hover:bg-ink/10",
                    disabled && "cursor-not-allowed opacity-60"
                  )}
                >
                  <ProtocolBadge type={node.type} className="shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{node.name}</span>
                    <span className="block truncate text-2xs text-fg-45">
                      {node.renamed ? `原名 ${node.originName}` : node.originName}
                      {node.server ? ` · ${node.server}${node.port ? `:${node.port}` : ""}` : ""}
                    </span>
                  </span>
                  {checked ? <Badge variant="secondary" className="shrink-0">已选</Badge> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {visible.length > shown.length ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setLimit((current) => current + NODE_PICKER_PAGE)}
        >
          {`再列出 ${Math.min(NODE_PICKER_PAGE, visible.length - shown.length)} 个`}
        </Button>
      ) : null}

      {state.data.parseErrors.length > 0 ? (
        <p className="text-2xs text-warning-note-fg">
          {`${state.data.parseErrors.length} 条节点解析失败：${state.data.parseErrors.slice(0, 2).join("；")}`}
        </p>
      ) : null}
    </div>
  );
}

export type ChainNodeChipsProps = {
  refs: readonly ChainNodeRef[];
  /** ref → 展示名；解析不到的引用返回 undefined，渲染成「已失效」 */
  labelOf: (ref: ChainNodeRef) => string | undefined;
  /** 是否允许调序（只有前置需要：顺序即组成员顺序） */
  reorderable?: boolean;
  onRemove: (ref: ChainNodeRef) => void;
  onMove?: (index: number, delta: -1 | 1) => void;
  emptyHint: string;
};

/** 某一侧已选节点的 chips：可移除，前置还可调序 */
export function ChainNodeChips({
  refs,
  labelOf,
  reorderable = false,
  onRemove,
  onMove,
  emptyHint,
}: ChainNodeChipsProps) {
  if (refs.length === 0) {
    return <p className="text-2xs text-fg-45">{emptyHint}</p>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {refs.map((ref, index) => {
        const label = labelOf(ref);
        return (
          <li
            key={`${ref.sourceId}:${ref.nodeKey}`}
            className={cn(
              "flex items-center gap-1 rounded-lg border px-2 py-1 text-2xs",
              label ? "border-ink/10 bg-ink/5 text-fg-70" : "border-warning-note-border bg-warning-note-bg text-warning-note-fg"
            )}
          >
            {reorderable && refs.length > 1 ? (
              <>
                <button
                  type="button"
                  aria-label={`前置节点 ${label ?? "已失效节点"} 上移`}
                  disabled={index === 0}
                  onClick={() => onMove?.(index, -1)}
                  className="text-fg-45 hover:text-fg disabled:opacity-40"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`前置节点 ${label ?? "已失效节点"} 下移`}
                  disabled={index === refs.length - 1}
                  onClick={() => onMove?.(index, 1)}
                  className="text-fg-45 hover:text-fg disabled:opacity-40"
                >
                  ↓
                </button>
              </>
            ) : null}
            <span className="max-w-[16rem] break-all">{label ?? "引用已失效"}</span>
            <IconButton
              label={`移除 ${label ?? "已失效节点"}`}
              variant="ghost"
              onClick={() => onRemove(ref)}
              className="min-h-6 min-w-6"
            >
              <Icon icon={X} size="xs" />
            </IconButton>
          </li>
        );
      })}
    </ul>
  );
}
