import * as React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@subboost/ui/components/ui/button";
import { IconButton } from "@subboost/ui/components/ui/icon-button";
import { ProtocolBadge } from "@subboost/ui/components/ui/protocol-badge";
import { cn } from "@subboost/ui/lib/utils";
import { formatCount, formatRelativeTime } from "../lib/format";
import type { SourceNodesResponse } from "../lib/types";

/** 仪表板上「源健康」行展开后的节点加载状态 */
export type SourceNodesLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: SourceNodesResponse };

/** 单次渲染的节点条数，节点多的源分批展开，避免一次渲染几百行 */
export const INLINE_NODE_PAGE = 30;

export type SourceNodesInlineProps = {
  state: SourceNodesLoadState;
  /** 重新读取该源的节点（刷新后快照可能已变化） */
  onRetry?: () => void;
  /** 跳到源管理页做改名等操作 */
  onOpenSourceManager?: () => void;
  emptyHint?: string;
};

/**
 * 只读的节点预览列表，供仪表板内联展开使用。
 * 改名仍走源管理页，这里只负责「看得见」。
 */
export function SourceNodesInline({
  state,
  onRetry,
  onOpenSourceManager,
  emptyHint = "还没有节点快照，先刷新一次即可看到节点。",
}: SourceNodesInlineProps) {
  const [limit, setLimit] = React.useState(INLINE_NODE_PAGE);

  if (state.status === "loading") {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2].map((index) => (
          <div key={index} className="skeleton h-9 w-full animate-shimmer" aria-hidden="true" />
        ))}
        <p className="text-[11px] text-fg-40">正在读取节点…</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2">
        <p className="min-w-0 break-words text-xs text-red-200">{state.message}</p>
        {onRetry ? (
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            重试
          </Button>
        ) : null}
      </div>
    );
  }

  const { data } = state;
  const nodes = data.nodes;
  const visible = nodes.slice(0, limit);
  const hidden = nodes.length - visible.length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-fg-45">
          共 {formatCount(data.nodeCount)} 个节点
          {data.renamedCount > 0 ? ` · 已改名 ${formatCount(data.renamedCount)} 个` : ""}
          {data.fetchedAt ? ` · 抓取于 ${formatRelativeTime(data.fetchedAt)}` : ""}
          {data.nodeCount > nodes.length ? ` · 仅列出前 ${formatCount(nodes.length)} 个` : ""}
        </p>
        <div className="flex items-center gap-1">
          {onOpenSourceManager ? (
            <Button type="button" variant="ghost" size="sm" onClick={onOpenSourceManager}>
              去改名
            </Button>
          ) : null}
          {onRetry ? (
            <IconButton label="重新读取节点" variant="ghost" onClick={onRetry}>
              <RefreshCw aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
      </div>

      {nodes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink/15 px-3 py-4 text-center text-[11px] text-fg-45">
          {emptyHint}
        </p>
      ) : (
        <ul className="max-h-[45dvh] space-y-1 overflow-y-auto pr-1 sm:max-h-[260px]">
          {visible.map((node, index) => (
            <li
              key={node.key}
              className={cn(
                "animate-settle-in flex items-center gap-2 rounded-lg border px-2.5 py-1.5",
                node.renamed ? "border-primary-500/30 bg-primary-500/10" : "border-ink/10 bg-ink/5"
              )}
              style={{ animationDelay: `${Math.min(index, 8) * 25}ms` }}
            >
              <ProtocolBadge type={node.type} className="shrink-0" />
              <div className="min-w-0 flex-1">
                {/* 原名是背景信息，放在上方作为说明；节点名是要认的那一行，放在下方 */}
                <p className="truncate text-[11px] text-fg-40">
                  {node.renamed ? `原名 ${node.originName || "—"}` : node.originName || "—"}
                  {node.server ? ` · ${node.server}${node.port ? `:${node.port}` : ""}` : ""}
                </p>
                <p
                  className={cn(
                    "mt-0.5 truncate text-xs",
                    node.renamed ? "text-primary-200" : "text-fg-80"
                  )}
                >
                  {node.name || "未命名节点"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {hidden > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => setLimit((current) => current + INLINE_NODE_PAGE)}
        >
          再显示 {formatCount(Math.min(INLINE_NODE_PAGE, hidden))} 个
        </Button>
      ) : null}

      {data.parseErrors.length > 0 ? (
        <p className="text-[11px] text-amber-400">
          {formatCount(data.parseErrors.length)} 条节点解析失败：
          {data.parseErrors.slice(0, 2).join("；")}
        </p>
      ) : null}
    </div>
  );
}
