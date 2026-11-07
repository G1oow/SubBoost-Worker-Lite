import * as React from "react";
import { ArrowDown, ArrowUp, Link2, Plus, Trash2 } from "lucide-react";
import { Badge, type BadgeProps } from "@subboost/ui/components/ui/badge";
import { Button } from "@subboost/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@subboost/ui/components/ui/card";
import { confirmDialog } from "@subboost/ui/components/ui/confirm-dialog";
import { EmptyState } from "@subboost/ui/components/ui/empty-state";
import { FormField } from "@subboost/ui/components/ui/form-field";
import { Icon } from "@subboost/ui/components/ui/icon";
import { IconButton } from "@subboost/ui/components/ui/icon-button";
import { Input } from "@subboost/ui/components/ui/input";
import { InlineNote } from "@subboost/ui/components/ui/inline-note";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@subboost/ui/components/ui/select";
import { Switch } from "@subboost/ui/components/ui/switch";
import { cn } from "@subboost/ui/lib/utils";
import { DisclosureChevron } from "@subboost/ui/motion/disclosure-chevron";
import { MotionReveal } from "@subboost/ui/motion/motion-list";
import type { ChainNodeRef, ProxyChain, ProxyGroupGroupType } from "@subboost/core/types/config";
import { MAX_CHAIN_NODES } from "@subboost/core/types/config";
import { collectReservedGroupNames } from "@subboost/core/generator/index";
import { normalizeRuleModelFromConfig } from "@subboost/core/rules/rule-model";
import { readNameOverrides } from "../lib/rule-editor";
import {
  CHAIN_GROUP_TYPE_OPTIONS,
  chainGroupNames,
  chainNodesOf,
  chainStatusMeta,
  createChain,
  hasChainNode,
  mergePreviewStatus,
  moveChain,
  moveChainNode,
  patchChain,
  readChains,
  readLegacyDialerGroups,
  refKey,
  removeChain,
  removeChainNode,
  toggleChain,
  toggleChainNode,
  validateChain,
  writeChains,
  type ChainNodeSide,
  type ChainStatusTone,
  type ConfigRecord,
} from "../lib/chain-editor";
import { ChainNodeChips, ChainNodePicker, type ChainNodeLoadState } from "./chain-node-picker";
import type { ConfigPreviewChain, SourceDto, SourceNodesResponse } from "../lib/types";
import { prefersReducedMotion } from "../lib/view-transition";

export type ConfigChainsSectionProps = {
  config: ConfigRecord;
  /** 全部源：选择器里只列已启用的那些 */
  sources: SourceDto[];
  /** 服务端预览里每条链的状态；还没预览过就不传 */
  previewChains?: ConfigPreviewChain[];
  /** 读取某个源的节点（链的节点就是从这里挑的） */
  onLoadNodes?: (sourceId: string) => Promise<SourceNodesResponse>;
  onChange: (next: ConfigRecord) => void;
};

const TONE_BADGE: Record<ChainStatusTone, BadgeProps["variant"]> = {
  ok: "success",
  warning: "warning",
  danger: "destructive",
  muted: "secondary",
};

/** 与规则列表同一个时长：新建或挪动后高亮那一条，长列表里不至于找不到它去了哪 */
const HIGHLIGHT_MS = 1600;

function chainDisplayName(chain: ProxyChain, index: number): string {
  const name = chain.name.trim();
  return name || `第 ${index + 1} 条链`;
}

function chainDomId(id: string): string {
  return `chain-${id}`;
}

/** 一条链两侧各自「正在查看的源」：前置单选，落地可多选 */
type SideSources = { relay: string | null; landing: string[] };

function initialSideSources(chain: ProxyChain): SideSources {
  const unique = (refs: ChainNodeRef[]) => [...new Set(refs.map((ref) => ref.sourceId))];
  return {
    relay: unique(chain.relayNodes)[0] ?? null,
    landing: unique(chain.landingNodes),
  };
}

export function ConfigChainsSection({
  config,
  sources,
  previewChains,
  onLoadNodes,
  onChange,
}: ConfigChainsSectionProps) {
  const chains = React.useMemo(() => readChains(config), [config]);
  const merged = React.useMemo(() => mergePreviewStatus(chains, previewChains), [chains, previewChains]);
  const legacyGroups = React.useMemo(() => readLegacyDialerGroups(config), [config]);
  const enabledSources = React.useMemo(() => sources.filter((source) => source.enabled), [sources]);
  const sourceNames = React.useMemo(
    () => new Map(sources.map((source) => [source.id, source.name])),
    [sources]
  );
  // 生成期已占用的组名：链名撞上它们时会被跳过，本地校验要一起看
  const reservedGroupNames = React.useMemo(
    () =>
      collectReservedGroupNames({
        customProxyGroups: normalizeRuleModelFromConfig(config).customProxyGroups,
        // 只为取名字，投影成最小字段即可
        dialerProxyGroups: readLegacyDialerGroups(config).map((group) => ({ name: group.name }) as never),
        proxyGroupNameOverrides: readNameOverrides(config),
      }),
    [config]
  );

  const applyChains = React.useCallback(
    (next: ProxyChain[]) => onChange(writeChains(config, next)),
    [config, onChange]
  );

  /*
   * 折叠状态：新建的链默认展开（刚建就要选节点），其余默认收起。
   * 只持有一个 expandedId，点开一条就收起别的，避免整页同时铺开三栏。
   */
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const toggleExpanded = (id: string) => setExpandedId((current) => (current === id ? null : id));
  const [highlightId, setHighlightId] = React.useState<string | null>(null);
  /** 挪动后把焦点放回同一张卡片的同一个按钮：React 重排时会把该节点摘下再插回，焦点掉到 body */
  const [focusTarget, setFocusTarget] = React.useState<{ id: string; label: string } | null>(null);

  /*
   * 节点列表缓存：按源缓存一次加载结果，切换链条目或来回改选源都不重复请求。
   * 请求代次用 ref 计，避免快速切换时旧响应覆盖新状态。
   */
  const nodeCache = React.useRef(new Map<string, ChainNodeLoadState>());
  const [, forceRender] = React.useReducer((tick: number) => tick + 1, 0);
  const requestIds = React.useRef(new Map<string, number>());

  const loadNodes = React.useCallback(
    (sourceId: string, options: { force?: boolean } = {}) => {
      if (!onLoadNodes) return;
      if (!options.force) {
        const cached = nodeCache.current.get(sourceId);
        if (cached && cached.status !== "error") return;
      }
      const requestId = (requestIds.current.get(sourceId) ?? 0) + 1;
      requestIds.current.set(sourceId, requestId);
      nodeCache.current.set(sourceId, { status: "loading" });
      forceRender();
      void (async () => {
        try {
          const data = await onLoadNodes(sourceId);
          if (requestIds.current.get(sourceId) !== requestId) return;
          nodeCache.current.set(sourceId, { status: "ready", data });
        } catch (err) {
          if (requestIds.current.get(sourceId) !== requestId) return;
          nodeCache.current.set(sourceId, {
            status: "error",
            message: err instanceof Error ? err.message : "加载节点失败",
          });
        }
        forceRender();
      })();
    },
    [onLoadNodes]
  );

  /** ref → 展示名：只在已加载的节点里找，找不到就是引用失效 */
  const labelOfRef = React.useCallback((ref: ChainNodeRef): string | undefined => {
    const state = nodeCache.current.get(ref.sourceId);
    if (!state || state.status !== "ready") return undefined;
    const node = state.data.nodes.find((item) => item.key === ref.nodeKey);
    return node?.name;
  }, []);

  React.useEffect(() => {
    if (!highlightId) return;
    document.getElementById(chainDomId(highlightId))?.scrollIntoView({
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
    const timer = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightId]);

  React.useEffect(() => {
    if (!focusTarget) return;
    setFocusTarget(null);
    // 挪到头/尾后原按钮会变成 disabled：Chrome 会让它失焦，这种情况同样要接管焦点
    const active = document.activeElement;
    if (active && active !== document.body && !(active instanceof HTMLButtonElement && active.disabled)) return;
    const buttons = Array.from(
      document.getElementById(chainDomId(focusTarget.id))?.querySelectorAll<HTMLButtonElement>("button") ?? []
    ).filter((button) => !button.disabled);
    const byLabel = (label: string) => buttons.find((button) => button.getAttribute("aria-label") === label);
    // 到了头/尾就交给反方向的按钮，键盘用户还能接着挪回来
    const opposite = focusTarget.label.startsWith("上移")
      ? focusTarget.label.replace("上移", "下移")
      : focusTarget.label.replace("下移", "上移");
    (byLabel(focusTarget.label) ?? byLabel(opposite) ?? buttons[0])?.focus({ preventScroll: true });
  }, [focusTarget]);

  const handleCreate = () => {
    const created = createChain(chains);
    applyChains([...chains, created]);
    setExpandedId(created.id);
    setHighlightId(created.id);
  };

  const handleMove = (chain: ProxyChain, index: number, delta: -1 | 1) => {
    applyChains(moveChain(chains, index, delta));
    setHighlightId(chain.id);
    // 未命名的链用序号兜底显示名，挪动后序号跟着变，所以按新位置取按钮名
    setFocusTarget({ id: chain.id, label: `${delta < 0 ? "上移" : "下移"} ${chainDisplayName(chain, index + delta)}` });
  };

  const handleDelete = async (chain: ProxyChain, index: number) => {
    const name = chainDisplayName(chain, index);
    const confirmed = await confirmDialog({
      title: `删除「${name}」？`,
      description:
        "这条链的出口组与前置组都会从生成结果里移除，勾选了它的订阅也不再生成它，指过来的规则会回退到兜底分组。此操作不可撤销，保存后生效。",
      confirmText: "删除",
      variant: "destructive",
    });
    if (!confirmed) return;
    applyChains(removeChain(chains, chain.id));
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="space-y-1">
            <CardTitle>链式代理</CardTitle>
            {/* 中文说明写成单个字符串：JSX 换行会在中文之间折出一个多余的空格 */}
            <p className="text-xs leading-relaxed text-fg-45">
              {[
                "每条链先选源、再挑具体节点当「前置 → 落地」，同一个源的不同节点也可以成链。",
                "建好的链在订阅里就是一个源：勾选它的订阅才会生成，落地节点只能经出口组到达。",
              ].join("")}
            </p>
          </div>
          <Button onClick={handleCreate} className="w-full shrink-0 sm:w-auto">
            <Icon icon={Plus} />
            新建链
          </Button>
        </CardHeader>
        <CardContent>
          {merged.length === 0 ? (
            <EmptyState>还没有链式代理，点击「新建链」创建第一条。</EmptyState>
          ) : (
            <ol aria-label="链式代理" className="space-y-2">
              {merged.map(({ chain, preview }, index) => (
                <ChainCard
                  key={chain.id}
                  chain={chain}
                  index={index}
                  total={merged.length}
                  validation={validateChain(chain, chains, reservedGroupNames)}
                  preview={preview}
                  sources={sources}
                  enabledSources={enabledSources}
                  sourceNames={sourceNames}
                  expanded={expandedId === chain.id}
                  highlighted={highlightId === chain.id}
                  nodeStateOf={(sourceId) => nodeCache.current.get(sourceId) ?? null}
                  onLoadNodes={onLoadNodes ? (sourceId, force) => loadNodes(sourceId, { force }) : undefined}
                  labelOfRef={labelOfRef}
                  onToggleExpanded={() => toggleExpanded(chain.id)}
                  onPatch={(patch) => applyChains(patchChain(chains, chain.id, patch))}
                  onToggleNode={(side, ref) => applyChains(toggleChainNode(chains, chain.id, side, ref))}
                  onRemoveNode={(side, ref) => applyChains(removeChainNode(chains, chain.id, side, ref))}
                  onMoveNode={(side, nodeIndex, delta) =>
                    applyChains(moveChainNode(chains, chain.id, side, nodeIndex, delta))
                  }
                  onToggleEnabled={(enabled) => applyChains(toggleChain(chains, chain.id, enabled))}
                  onMove={(delta) => handleMove(chain, index, delta)}
                  onDelete={() => void handleDelete(chain, index)}
                />
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {legacyGroups.length > 0 ? (
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle>旧中转组（只读，可在高级 JSON 中编辑）</CardTitle>
            <p className="text-xs leading-relaxed text-fg-45">
              {`配置里还有 ${legacyGroups.length} 个 `}
              <code>dialerProxyGroups</code>
              {" 条目，它们继续按原样生成，这里是只读展示；要改请到「高级 JSON」。"}
            </p>
          </CardHeader>
          <CardContent>
            <ul aria-label="旧中转组" className="space-y-1.5">
              {legacyGroups.map((group) => (
                <li
                  key={group.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-ink/10 bg-surface px-3 py-2 text-xs"
                >
                  <Badge variant={group.enabled ? "secondary" : "outline"}>
                    {group.enabled ? "启用" : "已停用"}
                  </Badge>
                  <span className="break-all text-fg-80">{group.name || "（未命名）"}</span>
                  <span className="text-fg-45">{group.type}</span>
                  <span className="text-fg-45">{`中转 ${group.relayCount} 个节点 · 落地 ${group.targetCount} 个节点`}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

type ChainCardProps = {
  chain: ProxyChain;
  index: number;
  total: number;
  validation: ReturnType<typeof validateChain>;
  preview: ConfigPreviewChain | null;
  /** 全部源：已停用的也要能显示名字与「已停用」提示 */
  sources: SourceDto[];
  enabledSources: SourceDto[];
  /** 全部源的 id → 名字 */
  sourceNames: Map<string, string>;
  /** 卡片的折叠状态由父级持有：新建或点摘要行时只展开它，收起其余 */
  expanded: boolean;
  /** 刚新建或刚挪动过：短暂高亮描边 */
  highlighted: boolean;
  nodeStateOf: (sourceId: string) => ChainNodeLoadState | null;
  onLoadNodes?: (sourceId: string, force?: boolean) => void;
  labelOfRef: (ref: ChainNodeRef) => string | undefined;
  onToggleExpanded: () => void;
  onPatch: (patch: Partial<ProxyChain>) => void;
  onToggleNode: (side: ChainNodeSide, ref: ChainNodeRef) => void;
  onRemoveNode: (side: ChainNodeSide, ref: ChainNodeRef) => void;
  onMoveNode: (side: ChainNodeSide, index: number, delta: -1 | 1) => void;
  onToggleEnabled: (enabled: boolean) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
};

/**
 * 一条链 = 一个列表项，外观按「一个节点」呈现（序号 + 链名 + 链路标记 + 计数）。
 *
 * 摘要行在展开与收起时保持同一个结构：链名输入框放进正文，而不是把摘要行替换成输入框，
 * 否则每次开合摘要行高度都会跳一下。正文由 MotionReveal 按需挂载。
 */
function ChainCard({
  chain,
  index,
  total,
  validation,
  preview,
  sources,
  enabledSources,
  sourceNames,
  expanded,
  highlighted,
  nodeStateOf,
  onLoadNodes,
  labelOfRef,
  onToggleExpanded,
  onPatch,
  onToggleNode,
  onRemoveNode,
  onMoveNode,
  onToggleEnabled,
  onMove,
  onDelete,
}: ChainCardProps) {
  const name = chainDisplayName(chain, index);
  const { exitGroupName, relayGroupName } = chainGroupNames(chain);
  const status = chainStatusMeta(preview?.status);
  const enabled = chain.enabled !== false;
  const bodyId = `chain-body-${chain.id}`;
  const headerId = `chain-header-${chain.id}`;
  // 收起的卡片上没有输入框可聚焦，摘要行用 tabIndex 补齐键盘入口。
  // aria-controls 只在正文真的挂载时给，避免指向不存在的节点。
  const summaryProps = {
    id: headerId,
    role: "button" as const,
    tabIndex: 0,
    "aria-expanded": expanded,
    "aria-controls": expanded ? bodyId : undefined,
    onClick: onToggleExpanded,
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onToggleExpanded();
    },
  };

  return (
    <li
      id={chainDomId(chain.id)}
      data-chain-card={chain.id}
      className={cn(
        "rounded-xl border bg-surface transition-[border-color,background-color] duration-200",
        expanded ? "border-card-border-hover" : "border-card-border hover:border-card-border-hover",
        !enabled && "border-dashed",
        highlighted && "border-primary-400/70 bg-primary-500/10"
      )}
    >
      <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
        <div
          {...summaryProps}
          className="-mx-1 flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <span className="w-5 shrink-0 text-right font-mono text-xs tabular-nums text-fg-45" aria-hidden="true">
            {index + 1}
          </span>
          {/* 链路标记：链在这里当节点看，图标只做类型区分 */}
          <span className="shrink-0 text-fg-45" aria-hidden="true">
            <Icon icon={Link2} size="sm" />
          </span>
          <span className={cn("min-w-0 truncate text-sm font-medium", enabled ? "text-fg" : "text-fg-60")}>
            {name}
          </span>
          <span className="shrink-0 text-2xs tabular-nums text-fg-45">
            {`前置 ${chain.relayNodes.length} → 落地 ${chain.landingNodes.length}`}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
          <Switch checked={enabled} onCheckedChange={onToggleEnabled} aria-label={`启用 ${name}`} className="mr-1" />
          <IconButton
            label={`上移 ${name}`}
            variant="ghost"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            className="min-h-9 min-w-9"
          >
            <Icon icon={ArrowUp} />
          </IconButton>
          <IconButton
            label={`下移 ${name}`}
            variant="ghost"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            className="min-h-9 min-w-9"
          >
            <Icon icon={ArrowDown} />
          </IconButton>
          <IconButton label={`删除 ${name}`} variant="ghost" onClick={onDelete} className="min-h-9 min-w-9">
            <Icon icon={Trash2} />
          </IconButton>
          <IconButton
            label={expanded ? `收起 ${name}` : `展开 ${name}`}
            variant="ghost"
            aria-expanded={expanded}
            aria-controls={expanded ? bodyId : undefined}
            onClick={onToggleExpanded}
            className="min-h-9 min-w-9"
          >
            <DisclosureChevron open={expanded} />
          </IconButton>
        </div>
      </div>

      {/* 状态行常驻：收起的卡片也要能看出这条链为什么不生成；桌面端左侧与链名对齐 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-3 text-xs sm:pl-14" role="status">
        <Badge variant={TONE_BADGE[status.tone]}>{status.label}</Badge>
        {preview ? (
          <span className="tabular-nums text-fg-60">
            {`前置 ${preview.relayCount} 个节点 · 落地 ${preview.landingCount} 个节点`}
          </span>
        ) : null}
        <span className="text-fg-45">{status.description}</span>
        {preview?.error ? (
          <InlineNote variant="plain" alert>
            {preview.error}
          </InlineNote>
        ) : null}
        {/* 链名/落地错误展开时显示在正文里；收起后挪到这里，不至于藏起来 */}
        {!expanded && validation.nameError ? (
          <InlineNote variant="plain" alert>
            {validation.nameError}
          </InlineNote>
        ) : null}
        {!expanded && validation.landingEmptyError ? (
          <InlineNote variant="plain" alert>
            {validation.landingEmptyError}
          </InlineNote>
        ) : null}
        {validation.nameConflictError ? (
          <InlineNote variant="plain" alert>
            {validation.nameConflictError}
          </InlineNote>
        ) : null}
        {validation.nameTakenError ? (
          <InlineNote variant="plain" alert>
            {validation.nameTakenError}
          </InlineNote>
        ) : null}
      </div>

      {/* 正文按需挂载：收起后 DOM 里不留两段选择器与十几个输入框 */}
      <MotionReveal open={expanded} id={bodyId}>
        <div aria-labelledby={headerId} className="space-y-3 border-t border-ink/10 p-3">
          <FormField label="链名（也就是它在订阅里作为源的名字）" className="sm:max-w-sm" error={validation.nameError}>
            <Input
              value={chain.name}
              onChange={(event) => onPatch({ name: event.target.value })}
              placeholder="例如：落地美国"
              aria-invalid={validation.nameError !== null}
            />
          </FormField>
          <div className="grid gap-3 lg:grid-cols-3">
            <NodeSidePanel
              side="relay"
              title="① 前置（中转节点）"
              hint="先选源，再挑该源里的节点；可以有多个，顺序即前置组成员顺序。"
              chain={chain}
              sources={sources}
              enabledSources={enabledSources}
              sourceNames={sourceNames}
              nodeStateOf={nodeStateOf}
              onLoadNodes={onLoadNodes}
              labelOfRef={labelOfRef}
              error={null}
              warning={validation.selfRelayWarning}
              onToggleNode={(ref) => onToggleNode("relay", ref)}
              onRemoveNode={(ref) => onRemoveNode("relay", ref)}
              onMoveNode={(nodeIndex, delta) => onMoveNode("relay", nodeIndex, delta)}
            />
            <NodeSidePanel
              side="landing"
              title="② 落地（最终出口的节点）"
              hint="可跨多个源、也可以同一源里的不同节点；这里是出口组的成员。"
              chain={chain}
              sources={sources}
              enabledSources={enabledSources}
              sourceNames={sourceNames}
              nodeStateOf={nodeStateOf}
              onLoadNodes={onLoadNodes}
              labelOfRef={labelOfRef}
              error={validation.landingEmptyError}
              warning={null}
              onToggleNode={(ref) => onToggleNode("landing", ref)}
              onRemoveNode={(ref) => onRemoveNode("landing", ref)}
              onMoveNode={(nodeIndex, delta) => onMoveNode("landing", nodeIndex, delta)}
            />
            <GroupPanel
              chain={chain}
              exitGroupName={exitGroupName}
              relayGroupName={relayGroupName}
              onPatch={onPatch}
            />
          </div>
        </div>
      </MotionReveal>
    </li>
  );
}

type NodeSidePanelProps = {
  side: ChainNodeSide;
  title: string;
  hint: string;
  chain: ProxyChain;
  sources: SourceDto[];
  enabledSources: SourceDto[];
  sourceNames: Map<string, string>;
  nodeStateOf: (sourceId: string) => ChainNodeLoadState | null;
  onLoadNodes?: (sourceId: string, force?: boolean) => void;
  labelOfRef: (ref: ChainNodeRef) => string | undefined;
  error: string | null;
  warning: string | null;
  onToggleNode: (ref: ChainNodeRef) => void;
  onRemoveNode: (ref: ChainNodeRef) => void;
  onMoveNode: (index: number, delta: -1 | 1) => void;
};

/**
 * 一侧（前置或落地）的选择器：先选源，再挑该源里的节点。
 *
 * 前置是单选源（一次只挑一个源的节点），落地可多选源（跨源组合，也支持同源不同节点）。
 * 两侧都允许先选停用的源：链可能引用停用源的节点，能否生成由预览的「引用失效」状态说明。
 */
function NodeSidePanel({
  side,
  title,
  hint,
  chain,
  sources,
  enabledSources,
  sourceNames,
  nodeStateOf,
  onLoadNodes,
  labelOfRef,
  error,
  warning,
  onToggleNode,
  onRemoveNode,
  onMoveNode,
}: NodeSidePanelProps) {
  const selected = chainNodesOf(chain, side);
  const [sideSources, setSideSources] = React.useState<SideSources>(() => initialSideSources(chain));
  const activeSourceIds = React.useMemo(
    () => (side === "relay" ? (sideSources.relay ? [sideSources.relay] : []) : sideSources.landing),
    [side, sideSources]
  );

  // 选中的源一出现就按需拉节点：用户不必再点一次「加载」
  React.useEffect(() => {
    if (!onLoadNodes) return;
    for (const sourceId of activeSourceIds) onLoadNodes(sourceId);
  }, [activeSourceIds, onLoadNodes]);

  // 已选节点的源如果不在当前查看列表里（改过配置、或刚展开），补进来，否则看不到高亮
  React.useEffect(() => {
    const used = [...new Set(selected.map((ref) => ref.sourceId))];
    if (used.length === 0) return;
    setSideSources((current) => {
      if (side === "relay") {
        const next = current.relay ?? used[0];
        return next === current.relay ? current : { ...current, relay: next };
      }
      const missing = used.filter((id) => !current.landing.includes(id));
      return missing.length === 0 ? current : { ...current, landing: [...current.landing, ...missing] };
    });
  }, [selected, side]);

  const staleCount = selected.filter((ref) => labelOfRef(ref) === undefined).length;
  const atLimit = selected.length >= MAX_CHAIN_NODES;
  // 已停用的源也要能选，所以列表用全部源；名字从 sourceNames 兜底（含已删除的源 id）
  const visibleSources = sources;
  const scope = side === "relay" ? "前置" : "落地";

  const toggleSource = (sourceId: string) => {
    setSideSources((current) => {
      if (side === "relay") return { ...current, relay: sourceId };
      const has = current.landing.includes(sourceId);
      if (!has) return { ...current, landing: [...current.landing, sourceId] };
      // 收起正在查看的源时，只从查看列表里移除，已选节点保留
      return { ...current, landing: current.landing.filter((id) => id !== sourceId) };
    });
  };

  const removeSourceView = (sourceId: string) => {
    setSideSources((current) => ({ ...current, landing: current.landing.filter((id) => id !== sourceId) }));
  };

  return (
    <section aria-label={title} className="space-y-2.5 rounded-xl border border-ink/10 bg-ink/5 p-3">
      <div className="space-y-1">
        <h4 className="text-sm font-medium text-fg-80">{title}</h4>
        <p className="text-2xs leading-relaxed text-fg-45">{hint}</p>
      </div>

      {error ? (
        <InlineNote variant="plain" alert>
          {error}
        </InlineNote>
      ) : null}
      {warning ? <InlineNote variant="plain">{warning}</InlineNote> : null}

      {visibleSources.length === 0 ? (
        <InlineNote variant="plain">还没有任何源，先去「源管理」添加。</InlineNote>
      ) : (
        <div role="group" aria-label={`${scope}可选的源`} className="flex flex-wrap gap-1.5">
          {visibleSources.map((source) => {
            const checked = activeSourceIds.includes(source.id);
            return (
              <Button
                key={source.id}
                type="button"
                size="sm"
                variant={checked ? "default" : "secondary"}
                aria-pressed={checked}
                onClick={() => toggleSource(source.id)}
                title={source.enabled ? source.name : `${source.name}（已停用）`}
              >
                <span className="break-all">{source.name}</span>
                {source.enabled ? null : <span className="text-2xs opacity-70">停用</span>}
              </Button>
            );
          })}
        </div>
      )}

      {/* 落地可多选源：已展开查看的源列成 chips，便于逐个收起 */}
      {side === "landing" && sideSources.landing.length > 0 ? (
        <ul aria-label="正在查看的源" className="flex flex-wrap gap-1.5">
          {sideSources.landing.map((sourceId) => (
            <li key={sourceId}>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => removeSourceView(sourceId)}
                aria-label={`收起源 ${sourceNames.get(sourceId) ?? sourceId}`}
              >
                <span className="break-all">{sourceNames.get(sourceId) ?? sourceId}</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-2">
        {activeSourceIds.length === 0 ? (
          <EmptyState className="px-3 py-5 text-xs">
            {`先选${side === "relay" ? "一个" : "至少一个"}源，再从它的节点里挑。`}
          </EmptyState>
        ) : (
          activeSourceIds.map((sourceId) => (
            <ChainNodePicker
              key={sourceId}
              sourceId={sourceId}
              sourceName={sourceNames.get(sourceId) ?? sourceId}
              state={nodeStateOf(sourceId)}
              selected={selected}
              disabled={atLimit}
              onToggle={onToggleNode}
              onRetry={onLoadNodes ? () => onLoadNodes(sourceId, true) : undefined}
            />
          ))
        )}
      </div>

      <div className="space-y-1.5 border-t border-ink/10 pt-2.5">
        <p className="text-2xs text-fg-45">
          {`已选 ${selected.length}${atLimit ? `（上限 ${MAX_CHAIN_NODES}）` : ""}`}
          {staleCount > 0 ? ` · ${staleCount} 个引用已失效` : ""}
        </p>
        <ChainNodeChips
          refs={selected}
          labelOf={labelOfRef}
          reorderable={side === "relay"}
          onRemove={onRemoveNode}
          onMove={onMoveNode}
          emptyHint={side === "relay" ? "还没选前置节点（前置为空时前置组只放 REJECT）" : "还没选落地节点，这条链不会生成"}
        />
      </div>
    </section>
  );
}

type GroupPanelProps = {
  chain: ProxyChain;
  exitGroupName: string;
  relayGroupName: string;
  onPatch: (patch: Partial<ProxyChain>) => void;
};

function GroupPanel({ chain, exitGroupName, relayGroupName, onPatch }: GroupPanelProps) {
  const exitGroupType = chain.exitGroupType ?? "select";
  const relayGroupType = chain.relayGroupType ?? "url-test";

  return (
    <section aria-label="③ 出口组" className="space-y-3 rounded-xl border border-ink/10 bg-ink/5 p-3">
      <div className="space-y-1">
        <h4 className="text-sm font-medium text-fg-80">③ 出口组与前置组</h4>
        <p className="break-all text-2xs leading-relaxed text-fg-45">
          {`出口组「${exitGroupName || "待填写链名"}」，前置组「${relayGroupName}」名字自动派生。`}
        </p>
      </div>

      <FormField label="出口组类型">
        <ChainSelect
          value={exitGroupType}
          onValueChange={(value) => onPatch({ exitGroupType: value as ProxyGroupGroupType })}
        />
      </FormField>

      <FormField label="前置组类型">
        <ChainSelect
          value={relayGroupType}
          onValueChange={(value) => onPatch({ relayGroupType: value as ProxyGroupGroupType })}
        />
      </FormField>

      <FormField label="测速地址" description="前置组与出口组共用">
        <Input
          value={chain.testUrl ?? ""}
          onChange={(event) => onPatch({ testUrl: event.target.value })}
          placeholder="留空使用全局测速地址"
        />
      </FormField>
    </section>
  );
}

type ChainSelectProps = {
  value: ProxyGroupGroupType;
  onValueChange: (value: string) => void;
};

/** FormField 把 id 注入到这里，再转给真正可聚焦的触发器，标签与错误态才能关联上 */
function ChainSelect({ value, onValueChange, ...control }: ChainSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger {...control}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CHAIN_GROUP_TYPE_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

