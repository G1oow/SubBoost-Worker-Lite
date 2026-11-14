import * as React from "react";
import { ArrowDownWideNarrow, RotateCcw, Search, Sparkles } from "lucide-react";
import { Badge } from "@subboost/ui/components/ui/badge";
import { Button } from "@subboost/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@subboost/ui/components/ui/card";
import { confirmDialog } from "@subboost/ui/components/ui/confirm-dialog";
import { EmptyState } from "@subboost/ui/components/ui/empty-state";
import { Icon } from "@subboost/ui/components/ui/icon";
import { InlineNote } from "@subboost/ui/components/ui/inline-note";
import { Input } from "@subboost/ui/components/ui/input";
import { ProtocolBadge } from "@subboost/ui/components/ui/protocol-badge";
import { SortableGrid } from "@subboost/ui/components/ui/sortable-grid";
import { SortableItem } from "@subboost/ui/components/ui/sortable-list";
import { cn } from "@subboost/ui/lib/utils";
import { SegmentedControl } from "@subboost/ui/motion/segmented-control";
import {
  CANVAS_HEAVY_THRESHOLD,
  GRID_COLUMN_PRESETS,
  applyVisibleOrder,
  autoOrderByRegion,
  filterCanvasNodes,
  mergeOrderWithCanvas,
  readGridColumns,
  readNodeOrder,
  readSelectedSubscription,
  rebuildCanvasOrder,
  saveGridColumns,
  saveSelectedSubscription,
  summarizeCanvasCoverage,
  writeNodeOrder,
  type GridColumns,
} from "../lib/node-order-editor";
import type { ConfigRecord } from "../lib/rule-editor";
import type { CanvasNodeSummary, SubscriptionDto, SubscriptionNodesResponse } from "../lib/types";

export type ConfigNodesSectionProps = {
  config: ConfigRecord;
  /** 全部订阅：一次只加载其中一条（不改变订阅包含的源） */
  subscriptions: SubscriptionDto[];
  /** 读取所选订阅合并后的节点；`order: "source"` 用于「重置为源顺序」 */
  onLoadSubscriptionNodes?: (
    subscriptionId: string,
    options?: { order?: "saved" | "source" }
  ) => Promise<SubscriptionNodesResponse>;
  onChange: (next: ConfigRecord) => void;
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: SubscriptionNodesResponse }
  | { status: "error"; message: string };

const COLUMN_OPTIONS = GRID_COLUMN_PRESETS.map((value) => ({ id: String(value), label: `${value} 列` }));

/** 记忆恢复：丢掉已删除的订阅；没记住（首次进页）就默认选第一条 */
function initialSelection(subscriptions: SubscriptionDto[]): string | null {
  const remembered = readSelectedSubscription();
  if (remembered && subscriptions.some((item) => item.id === remembered)) return remembered;
  return subscriptions[0]?.id ?? null;
}

/** 窄屏只放两列：三列以上时卡片里的名称会被压成一两个字 */
function useNarrowLayout(): boolean {
  const [narrow, setNarrow] = React.useState(false);
  React.useEffect(() => {
    // jsdom 与部分老环境没有 matchMedia：拿不到就按宽屏处理，不影响排序本身
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 639px)");
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return narrow;
}

/**
 * 「节点排序」画布。
 *
 * 排序结果写进 `config.nodeOrder`（内容指纹数组），保存后作用于订阅输出：
 * `proxies:` 段与各组内节点的先后同时按它排列。
 *
 * 订阅是**单选**：一次只铺一条订阅的节点。选中的订阅只决定加载范围，
 * 不改变订阅本身包含的源——不同订阅的节点集合本来就不同，这一点不能靠画布决定。
 * 顺序本身是全局一条：其它订阅的节点按源顺序排在已排序节点之后。
 */
export function ConfigNodesSection({
  config,
  subscriptions,
  onLoadSubscriptionNodes,
  onChange,
}: ConfigNodesSectionProps) {
  const savedOrder = React.useMemo(() => readNodeOrder(config), [config]);
  const savedSignature = savedOrder.join(",");

  const [selectedId, setSelectedId] = React.useState<string | null>(() => initialSelection(subscriptions));
  const [columns, setColumns] = React.useState<GridColumns>(() => readGridColumns());
  const [query, setQuery] = React.useState("");
  const [highlightSourceId, setHighlightSourceId] = React.useState<string | null>(null);
  const [loads, setLoads] = React.useState<Record<string, LoadState>>({});
  const [canvasOrder, setCanvasOrder] = React.useState<string[]>([]);
  const requested = React.useRef(new Set<string>());
  const narrow = useNarrowLayout();

  // 订阅被删掉后同步选择与记忆
  React.useEffect(() => {
    setSelectedId((current) => {
      if (current && subscriptions.some((item) => item.id === current)) return current;
      return subscriptions[0]?.id ?? null;
    });
  }, [subscriptions]);

  React.useEffect(() => {
    saveSelectedSubscription(selectedId);
  }, [selectedId]);

  const loadOne = React.useCallback(
    async (subscriptionId: string, options?: { order?: "saved" | "source" }) => {
      if (!onLoadSubscriptionNodes) return;
      requested.current.add(subscriptionId);
      setLoads((current) => ({ ...current, [subscriptionId]: { status: "loading" } }));
      try {
        const data = await onLoadSubscriptionNodes(subscriptionId, options);
        setLoads((current) => ({ ...current, [subscriptionId]: { status: "ready", data } }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "读取节点失败";
        setLoads((current) => ({ ...current, [subscriptionId]: { status: "error", message } }));
      }
    },
    [onLoadSubscriptionNodes]
  );

  // 选择变化时补拉还没拉过的那条订阅，来回切换不重复请求
  React.useEffect(() => {
    if (!selectedId) return;
    if (requested.current.has(selectedId)) return;
    void loadOne(selectedId);
  }, [selectedId, loadOne]);

  const state = selectedId ? loads[selectedId] : undefined;
  const response = state?.status === "ready" ? state.data : null;
  const loadedNodes = React.useMemo(() => response?.nodes ?? [], [response]);
  const loadedKeys = React.useMemo(() => loadedNodes.map((node) => node.key), [loadedNodes]);
  const loadedSignature = loadedKeys.join(",");

  // 数据到了或已保存顺序变了，重建画布顺序：已保存的在前，用户拖过但没保存的段落保留
  React.useEffect(() => {
    setCanvasOrder((current) => rebuildCanvasOrder(current, loadedKeys, savedOrder));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadedKeys/savedOrder 用签名比较足够，避免数组身份抖动导致的重建
  }, [loadedSignature, savedSignature]);

  const nodeByKey = React.useMemo(() => new Map(loadedNodes.map((node) => [node.key, node])), [loadedNodes]);
  const displayNodes = React.useMemo(
    () => canvasOrder.map((key) => nodeByKey.get(key)).filter((node): node is CanvasNodeSummary => Boolean(node)),
    [canvasOrder, nodeByKey]
  );
  const visibleNodes = React.useMemo(() => filterCanvasNodes(displayNodes, query), [displayNodes, query]);
  const visibleKeys = React.useMemo(() => visibleNodes.map((node) => node.key), [visibleNodes]);

  const coverage = summarizeCanvasCoverage(response);
  const missingSnapshots = response?.sources.filter((source) => source.missingSnapshot).map((source) => source.name) ?? [];

  const commitOrder = React.useCallback(
    (nextDisplayOrder: string[]) => {
      const nextCanvas = rebuildCanvasOrder(nextDisplayOrder, loadedKeys, []);
      setCanvasOrder(nextCanvas);
      onChange(writeNodeOrder(config, mergeOrderWithCanvas(savedOrder, nextCanvas)));
    },
    [config, loadedKeys, onChange, savedOrder]
  );

  const handleReorder = (nextVisible: string[]) => {
    commitOrder(applyVisibleOrder(displayNodes.map((node) => node.key), visibleKeys, nextVisible));
  };

  const handleAutoRegion = () => {
    commitOrder(autoOrderByRegion(displayNodes));
  };

  const handleReset = async () => {
    const hiddenSaved = savedOrder.filter((key) => !nodeByKey.has(key)).length;
    const confirmed = await confirmDialog({
      title: "清除全部自定义顺序？",
      description:
        hiddenSaved > 0
          ? `画布当前加载 ${loadedKeys.length} 个节点，另有 ${hiddenSaved} 个已保存的排序条目不在画布中。重置会把它们一起清掉，全部回到按源顺序，需要点保存才生效。`
          : "所有节点会回到按源顺序排列，需要点保存才生效。",
      confirmText: "重置",
      variant: "warning",
    });
    if (!confirmed) return;
    onChange(writeNodeOrder(config, []));
    setCanvasOrder([]);
    if (!selectedId) return;
    requested.current.clear();
    setLoads({});
    void loadOne(selectedId, { order: "source" });
  };

  const changeColumns = (id: string) => {
    const next = Number.parseInt(id, 10) as GridColumns;
    setColumns(next);
    saveGridColumns(next);
  };

  /** 单选但仍是 roving 语义：方向键在订阅之间移动选择，Tab 只落一次 */
  const handleRadioKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (subscriptions.length === 0) return;
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!forward && !backward) return;
    event.preventDefault();
    const currentIndex = subscriptions.findIndex((item) => item.id === selectedId);
    const from = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (from + (forward ? 1 : -1) + subscriptions.length) % subscriptions.length;
    setSelectedId(subscriptions[nextIndex].id);
  };

  const effectiveColumns = narrow ? 2 : columns;
  const heavy = loadedKeys.length > CANVAS_HEAVY_THRESHOLD;
  const selectedSubscription = subscriptions.find((item) => item.id === selectedId) ?? null;

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle>节点排序</CardTitle>
          <p className="text-xs leading-relaxed text-fg-45">
            拖拽卡片决定节点的先后，保存后写进 <span className="font-mono text-2xs">proxies</span> 段与各组内的节点顺序，
            客户端「排序=默认」看到的就是这份顺序。一次只排一条订阅的节点，其它订阅的节点按源顺序排在已排序节点之后。
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div
            role="radiogroup"
            aria-label="选择订阅"
            tabIndex={-1}
            onKeyDown={handleRadioKeyDown}
            className="flex flex-wrap items-center gap-2"
          >
            {subscriptions.length === 0 ? (
              <p className="text-xs text-fg-45">还没有订阅，先去「订阅链接」建一条。</p>
            ) : (
              subscriptions.map((subscription) => {
                const active = subscription.id === selectedId;
                return (
                  <Button
                    key={subscription.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    tabIndex={active || !selectedId ? 0 : -1}
                    size="sm"
                    variant={active ? "secondary" : "ghost"}
                    onClick={() => setSelectedId(subscription.id)}
                    className={cn("max-w-full", active && "border-focus-ring")}
                  >
                    <span className="truncate">{subscription.name}</span>
                  </Button>
                );
              })
            )}
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl
                label="每行显示几个节点"
                layoutGroupId="node-canvas-columns"
                options={COLUMN_OPTIONS}
                activeId={String(columns)}
                onSelect={changeColumns}
              />
              <span className="text-2xs text-fg-35">
                {narrow ? "窄屏固定 2 列" : "只影响显示，不影响保存的顺序"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0">
                <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-35">
                  <Icon icon={Search} size="sm" />
                </span>
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索节点名或协议"
                  aria-label="搜索节点"
                  className="h-9 pl-8 text-xs sm:h-9"
                />
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={handleAutoRegion} disabled={displayNodes.length === 0}>
                <Icon icon={Sparkles} />
                按地区排序
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => void handleReset()} disabled={displayNodes.length === 0}>
                <Icon icon={RotateCcw} />
                重置为源顺序
              </Button>
            </div>
          </div>

          {response && response.sources.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="按源高亮">
              <span className="text-2xs text-fg-35">按源高亮</span>
              {response.sources.map((source) => {
                const active = highlightSourceId === source.id;
                return (
                  <Button
                    key={source.id}
                    type="button"
                    size="sm"
                    variant={active ? "secondary" : "ghost"}
                    aria-pressed={active}
                    onClick={() => setHighlightSourceId(active ? null : source.id)}
                  >
                    {source.name}
                    <span className="text-2xs tabular-nums text-fg-35">{source.nodeCount}</span>
                  </Button>
                );
              })}
            </div>
          ) : null}

          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-45" role="status">
            <Icon icon={ArrowDownWideNarrow} size="sm" className="text-fg-35" />
            <span className="tabular-nums">已加载 {coverage.loaded} 个节点</span>
            {coverage.truncated > 0 ? (
              <span className="tabular-nums text-warning-note-fg">
                · 另有 {coverage.truncated} 个超出画布上限，按源顺序排在末尾
              </span>
            ) : (
              <span>· 其它订阅的节点不在画布中，输出时按源顺序排在末尾</span>
            )}
          </p>

          {heavy ? (
            <InlineNote tone="warning">
              画布上有 {loadedKeys.length} 个节点，拖拽可能掉帧；建议拆成多条订阅分别排。
            </InlineNote>
          ) : null}
          {missingSnapshots.length > 0 ? (
            <InlineNote tone="warning">
              {missingSnapshots.join("、")} 还没有节点快照，画布与订阅输出都会缺这些节点，去「源管理」刷新一次。
            </InlineNote>
          ) : null}
          {state?.status === "error" ? (
            <InlineNote tone="danger" alert>
              <span className="break-all">{state.message}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1 h-7 px-2"
                onClick={() => {
                  if (!selectedId) return;
                  requested.current.delete(selectedId);
                  void loadOne(selectedId);
                }}
              >
                重试
              </Button>
            </InlineNote>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-sm">
            画布{selectedSubscription ? ` · ${selectedSubscription.name}` : ""}
          </CardTitle>
          <p className="text-2xs text-fg-35">按住卡片拖动排序；也可用空格拾起、方向键移动</p>
        </CardHeader>
        <CardContent>
          {!selectedId ? (
            <EmptyState>选一条订阅后，这里会铺出它的节点卡片。</EmptyState>
          ) : state?.status === "loading" || !state ? (
            <p className="py-6 text-center text-xs text-fg-45">正在读取节点…</p>
          ) : state.status === "error" ? (
            <EmptyState>读取节点失败，按上面的提示重试。</EmptyState>
          ) : loadedNodes.length === 0 ? (
            <EmptyState>这条订阅还没有可排序的节点快照。先去「源管理」刷新源，再回到这里。</EmptyState>
          ) : visibleNodes.length === 0 ? (
            <EmptyState>没有匹配「{query}」的节点。</EmptyState>
          ) : (
            <SortableGrid
              ids={visibleKeys}
              onReorder={handleReorder}
              labelOf={(key) => nodeByKey.get(key)?.name ?? key}
              className="gap-2.5"
              style={{ gridTemplateColumns: `repeat(${effectiveColumns}, minmax(0, 1fr))` }}
            >
              {visibleNodes.map((node) => {
                const index = canvasOrder.indexOf(node.key);
                const highlighted = highlightSourceId !== null && highlightSourceId === node.sourceId;
                return (
                  <SortableItem key={node.key} id={node.key} label={node.name} activator="card">
                    <div
                      className={cn(
                        "group relative flex h-full flex-col gap-1.5 rounded-xl border bg-surface px-3 py-2.5",
                        "transition-colors duration-200 hover:border-card-border-hover",
                        highlighted ? "border-card-border-hover bg-ink/5" : "border-card-border"
                      )}
                    >
                      <div className="flex items-start gap-1.5">
                        <span
                          className="min-w-0 flex-1 truncate text-xs font-medium text-fg"
                          title={node.renamed ? `${node.name}（原名：${node.originName}）` : node.name}
                        >
                          {node.name}
                        </span>
                        <span className="shrink-0 text-2xs tabular-nums text-fg-35">{index + 1}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <ProtocolBadge type={node.type} />
                        {node.sourceName ? <span className="truncate text-2xs text-fg-45">{node.sourceName}</span> : null}
                        {node.renamed ? <Badge variant="secondary">改名</Badge> : null}
                        {node.infoNode ? <Badge variant="outline">信息</Badge> : null}
                        {node.chainLanding ? <Badge variant="outline">链落地</Badge> : null}
                      </div>
                    </div>
                  </SortableItem>
                );
              })}
            </SortableGrid>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
