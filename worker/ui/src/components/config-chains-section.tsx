import * as React from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, TriangleAlert } from "lucide-react";
import { Badge, type BadgeProps } from "@subboost/ui/components/ui/badge";
import { Button } from "@subboost/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@subboost/ui/components/ui/card";
import { confirmDialog } from "@subboost/ui/components/ui/confirm-dialog";
import { FormField } from "@subboost/ui/components/ui/form-field";
import { Icon } from "@subboost/ui/components/ui/icon";
import { IconButton } from "@subboost/ui/components/ui/icon-button";
import { Input } from "@subboost/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@subboost/ui/components/ui/select";
import { Switch } from "@subboost/ui/components/ui/switch";
import { cn } from "@subboost/ui/lib/utils";
import type { ChainSelector, ProxyChain, ProxyGroupGroupType } from "@subboost/core/types/config";
import { collectReservedGroupNames } from "@subboost/core/generator/index";
import { normalizeRuleModelFromConfig } from "@subboost/core/rules/rule-model";
import { readNameOverrides } from "../lib/rule-editor";
import {
  CHAIN_GROUP_TYPE_OPTIONS,
  chainGroupNames,
  chainStatusMeta,
  createChain,
  mergePreviewStatus,
  moveChain,
  patchChain,
  patchChainSelector,
  readChains,
  readLegacyDialerGroups,
  removeChain,
  toggleChain,
  toggleChainSource,
  validateChain,
  writeChains,
  type ChainSelectorSide,
  type ChainStatusTone,
  type ConfigRecord,
} from "../lib/chain-editor";
import type { ConfigPreviewChain, SourceDto } from "../lib/types";

export type ConfigChainsSectionProps = {
  config: ConfigRecord;
  /** 全部源：选择器里只列已启用的那些 */
  sources: SourceDto[];
  /** 服务端预览里每条链的状态；还没预览过就不传 */
  previewChains?: ConfigPreviewChain[];
  onChange: (next: ConfigRecord) => void;
};

const TONE_BADGE: Record<ChainStatusTone, BadgeProps["variant"]> = {
  ok: "success",
  warning: "warning",
  danger: "destructive",
  muted: "secondary",
};

/** 一个源都不选时的语义提示：两句都带「全部已启用源」，避免用户以为会匹配不到节点 */
const SELECTOR_ALL_SOURCES_HINT = "一个源都不选 = 全部已启用源";

function chainDisplayName(chain: ProxyChain, index: number): string {
  const name = chain.name.trim();
  return name || `第 ${index + 1} 条链`;
}

export function ConfigChainsSection({ config, sources, previewChains, onChange }: ConfigChainsSectionProps) {
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

  const handleCreate = () => applyChains([...chains, createChain(chains)]);

  const handleDelete = async (chain: ProxyChain, index: number) => {
    const name = chainDisplayName(chain, index);
    const confirmed = await confirmDialog({
      title: `删除「${name}」？`,
      description:
        "这条链的出口组与前置组都会从生成结果里移除，指过来时规则会回退到兜底分组。此操作不可撤销，保存后生效。",
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
                "严格两跳：前置 → 落地。",
                "每条启用的链生成两个组：出口组（链名，成员是落地节点）与前置组（链名 + 后缀，成员是前置节点），",
                "落地节点只能经出口组到达。",
                `当前共 ${chains.length} 条链。`,
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
            <p className="rounded-xl border border-dashed border-ink/15 px-4 py-8 text-center text-sm text-fg-50">
              还没有链式代理，点击「新建链」创建第一条。
            </p>
          ) : (
            <ol aria-label="链式代理" className="space-y-3">
              {merged.map(({ chain, preview }, index) => (
                <li key={chain.id}>
                  <ChainCard
                    chain={chain}
                    index={index}
                    total={merged.length}
                    validation={validateChain(chain, chains, reservedGroupNames)}
                    preview={preview}
                    enabledSources={enabledSources}
                    sourceNames={sourceNames}
                    onPatch={(patch) => applyChains(patchChain(chains, chain.id, patch))}
                    onPatchSelector={(side, patch) =>
                      applyChains(patchChainSelector(chains, chain.id, side, patch))
                    }
                    onToggleSource={(side, sourceId) =>
                      applyChains(toggleChainSource(chains, chain.id, side, sourceId))
                    }
                    onToggleEnabled={(enabled) => applyChains(toggleChain(chains, chain.id, enabled))}
                    onMove={(delta) => applyChains(moveChain(chains, index, delta))}
                    onDelete={() => void handleDelete(chain, index)}
                  />
                </li>
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
  enabledSources: SourceDto[];
  /** 全部源的 id → 名字，用来给已失效的 sourceId 显示可读名称 */
  sourceNames: Map<string, string>;
  onPatch: (patch: Partial<ProxyChain>) => void;
  onPatchSelector: (side: ChainSelectorSide, patch: Partial<ChainSelector>) => void;
  onToggleSource: (side: ChainSelectorSide, sourceId: string) => void;
  onToggleEnabled: (enabled: boolean) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
};

function ChainCard({
  chain,
  index,
  total,
  validation,
  preview,
  enabledSources,
  sourceNames,
  onPatch,
  onPatchSelector,
  onToggleSource,
  onToggleEnabled,
  onMove,
  onDelete,
}: ChainCardProps) {
  const name = chainDisplayName(chain, index);
  const { exitGroupName, relayGroupName } = chainGroupNames(chain);
  const status = chainStatusMeta(preview?.status);
  const enabled = chain.enabled !== false;

  return (
    <Card className={cn("overflow-hidden", !enabled && "border-dashed")} data-chain-card={chain.id}>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className="mt-2 w-5 shrink-0 text-right font-mono text-xs tabular-nums text-fg-45"
            aria-hidden="true"
          >
            {index + 1}
          </span>
          <FormField label="链名" className="min-w-0 flex-1" error={validation.nameError}>
            <Input
              value={chain.name}
              onChange={(event) => onPatch({ name: event.target.value })}
              placeholder="例如：落地美国"
              aria-invalid={validation.nameError !== null}
            />
          </FormField>
        </div>
        <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
          <span className="mr-1 text-xs text-fg-45" aria-hidden="true">
            启用
          </span>
          <Switch checked={enabled} onCheckedChange={onToggleEnabled} aria-label={`启用 ${name}`} />
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
          <IconButton
            label={`删除 ${name}`}
            variant="ghost"
            onClick={onDelete}
            className="min-h-9 min-w-9"
          >
            <Icon icon={Trash2} />
          </IconButton>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* 状态只来自服务端预览：本地校验的问题单独提示在各自输入框下面 */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" role="status">
          <Badge variant={TONE_BADGE[status.tone]}>{status.label}</Badge>
          <span className="text-fg-45">{status.description}</span>
          {preview ? (
            <span className="text-fg-60">
              {`· 前置 ${preview.relayCount} 个节点 · 落地 ${preview.landingCount} 个节点`}
            </span>
          ) : null}
        </div>
        {preview?.error ? (
          <p className="flex items-start gap-1.5 text-[11px] text-amber-400" role="alert">
            <Icon icon={TriangleAlert} size="sm" className="mt-px shrink-0" />
            <span className="break-words">{preview.error}</span>
          </p>
        ) : null}
        {validation.nameConflictError ? (
          <p className="flex items-start gap-1.5 text-[11px] text-amber-400" role="alert">
            <Icon icon={TriangleAlert} size="sm" className="mt-px shrink-0" />
            <span className="break-words">{validation.nameConflictError}</span>
          </p>
        ) : null}
        {validation.nameTakenError ? (
          <p className="flex items-start gap-1.5 text-[11px] text-amber-400" role="alert">
            <Icon icon={TriangleAlert} size="sm" className="mt-px shrink-0" />
            <span className="break-words">{validation.nameTakenError}</span>
          </p>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-3">
          <SelectorPanel
            side="relay"
            title="① 前置（中转节点）"
            selector={chain.relay}
            enabledSources={enabledSources}
            sourceNames={sourceNames}
            includeError={validation.relayIncludeError}
            excludeError={validation.relayExcludeError}
            onToggleSource={(sourceId) => onToggleSource("relay", sourceId)}
            onPatchSelector={(patch) => onPatchSelector("relay", patch)}
          />
          <SelectorPanel
            side="landing"
            title="② 落地（最终出口的节点）"
            selector={chain.landing}
            enabledSources={enabledSources}
            sourceNames={sourceNames}
            includeError={validation.landingIncludeError}
            excludeError={validation.landingExcludeError}
            onToggleSource={(sourceId) => onToggleSource("landing", sourceId)}
            onPatchSelector={(patch) => onPatchSelector("landing", patch)}
          />
          <GroupPanel
            chain={chain}
            exitGroupName={exitGroupName}
            relayGroupName={relayGroupName}
            onPatch={onPatch}
          />
        </div>
      </CardContent>
    </Card>
  );
}

type SelectorPanelProps = {
  side: ChainSelectorSide;
  title: string;
  selector: ChainSelector;
  enabledSources: SourceDto[];
  sourceNames: Map<string, string>;
  includeError: string | null;
  excludeError: string | null;
  onToggleSource: (sourceId: string) => void;
  onPatchSelector: (patch: Partial<ChainSelector>) => void;
};

function SelectorPanel({
  side,
  title,
  selector,
  enabledSources,
  sourceNames,
  includeError,
  excludeError,
  onToggleSource,
  onPatchSelector,
}: SelectorPanelProps) {
  // 已停用或已删除的源：勾选过就一定列出来，否则用户取消不掉，还会误以为范围正常
  const staleIds = selector.sourceIds.filter(
    (sourceId) => !enabledSources.some((source) => source.id === sourceId)
  );
  const scope = side === "relay" ? "前置" : "落地";
  return (
    <section aria-label={title} className="space-y-3 rounded-xl border border-ink/10 bg-ink/5 p-3">
      <div className="space-y-1">
        <h4 className="text-sm font-medium text-fg-80">{title}</h4>
        <p className="text-[11px] leading-relaxed text-fg-45">
          {`${SELECTOR_ALL_SOURCES_HINT}（当前 ${enabledSources.length} 个）。勾选的源只限定范围，再用正则筛节点名。`}
        </p>
      </div>

      {enabledSources.length === 0 && staleIds.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-amber-400">
          还没有已启用的源，这个选择器会匹配不到任何节点。
        </p>
      ) : (
        <div role="group" aria-label={`${scope}可选的源`} className="flex flex-wrap gap-1.5">
          {enabledSources.map((source) => {
            const checked = selector.sourceIds.includes(source.id);
            return (
              <Button
                key={source.id}
                type="button"
                size="sm"
                variant={checked ? "default" : "secondary"}
                aria-pressed={checked}
                onClick={() => onToggleSource(source.id)}
              >
                <span className="break-all">{source.name}</span>
              </Button>
            );
          })}
          {staleIds.map((sourceId) => (
            <Button
              key={sourceId}
              type="button"
              size="sm"
              variant="outline"
              aria-pressed
              onClick={() => onToggleSource(sourceId)}
              title="这个源已停用或被删除，取消勾选可去掉它"
            >
              <span className="break-all">{`${sourceNames.get(sourceId) ?? sourceId}（已失效）`}</span>
            </Button>
          ))}
        </div>
      )}

      {staleIds.length > 0 && enabledSources.length > 0 ? (
        <p className="text-[11px] leading-relaxed text-amber-400">
          勾选里有已失效的源，取消掉才按剩下这些源筛选。
        </p>
      ) : null}

      <FormField label="匹配正则" description="留空表示不限制节点名" error={includeError}>
        <Input
          value={selector.includeRegex ?? ""}
          onChange={(event) => onPatchSelector({ includeRegex: event.target.value })}
          placeholder="例如 香港|HK"
          aria-invalid={includeError !== null}
        />
      </FormField>
      <FormField label="排除正则" description="命中就剔除，优先于匹配正则" error={excludeError}>
        <Input
          value={selector.excludeRegex ?? ""}
          onChange={(event) => onPatchSelector({ excludeRegex: event.target.value })}
          placeholder="例如 过期|剩余"
          aria-invalid={excludeError !== null}
        />
      </FormField>
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
        <p className="break-all text-[11px] leading-relaxed text-fg-45">
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
