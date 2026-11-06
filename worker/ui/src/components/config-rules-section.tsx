import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Crosshair,
  FileUp,
  Library,
  ListOrdered,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Icon } from "@subboost/ui/components/ui/icon";
import { Badge } from "@subboost/ui/components/ui/badge";
import { Button } from "@subboost/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@subboost/ui/components/ui/card";
import { EmptyState } from "@subboost/ui/components/ui/empty-state";
import { IconButton } from "@subboost/ui/components/ui/icon-button";
import { Input } from "@subboost/ui/components/ui/input";
import { InlineNote } from "@subboost/ui/components/ui/inline-note";
import { Switch } from "@subboost/ui/components/ui/switch";
import { SwitchField } from "@subboost/ui/components/ui/switch-field";
import { cn } from "@subboost/ui/lib/utils";
import {
  buildModuleToggleGroups,
  buildRuleEditorView,
  deleteCustomRule,
  deleteCustomRuleSet,
  importCustomEntries,
  listRuleTargetOptions,
  moveRule,
  moveRuleToLine,
  saveCustomRule,
  saveCustomRuleSet,
  setBuiltinRuleEnabled,
  setBuiltinRuleTarget,
  setModuleEnabled,
  type ConfigRecord,
  type RuleRow,
} from "../lib/rule-editor";
import { prefersReducedMotion } from "../lib/view-transition";
import {
  BatchImportDialog,
  BuiltinTargetDialog,
  CustomRuleDialog,
  CustomRuleSetDialog,
  MoveToLineDialog,
} from "./config-rule-dialogs";

export type ConfigRulesSectionProps = {
  config: ConfigRecord;
  onChange: (next: ConfigRecord) => void;
};

type RowFilter = "all" | "custom" | "builtin" | "attention";

const FILTERS: Array<{ id: RowFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "custom", label: "自定义" },
  { id: "builtin", label: "内置" },
  { id: "attention", label: "需留意" },
];

/** 对话框状态：关闭时只把 open 置 false、保留快照，淡出动画期间内容不跳变 */
type DialogSlot = { open: boolean; row: RuleRow | null };
const CLOSED: DialogSlot = { open: false, row: null };
const HIGHLIGHT_MS = 1600;

function matchesFilter(row: RuleRow, filter: RowFilter): boolean {
  if (filter === "custom") return row.movable;
  if (filter === "builtin") return row.kind === "module";
  if (filter === "attention") return Boolean(row.targetWarning);
  return true;
}

function matchesQuery(row: RuleRow, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return [row.text, row.summary, row.detail, row.sourceLabel].some((text) => text.toLowerCase().includes(needle));
}

function rowDomId(key: string): string {
  return `rule-row-${key}`;
}

function moveButtonLabel(name: string, direction: -1 | 1): string {
  return `${direction < 0 ? "上移" : "下移"} ${name}`;
}

function rowName(row: RuleRow): string {
  return row.summary || row.text;
}

function kindLabel(row: RuleRow): string {
  if (row.kind === "module") return row.sourceLabel;
  if (row.kind === "custom-rule") return "自定义规则";
  if (row.kind === "custom-rule-set") return "规则集";
  return "系统规则";
}

export function ConfigRulesSection({ config, onChange }: ConfigRulesSectionProps) {
  const view = React.useMemo(() => buildRuleEditorView(config), [config]);
  const moduleGroups = React.useMemo(() => buildModuleToggleGroups(config), [config]);
  const targetOptions = React.useMemo(() => listRuleTargetOptions(config), [config]);

  const [modulesOpen, setModulesOpen] = React.useState(false);
  const [filter, setFilter] = React.useState<RowFilter>("all");
  const [query, setQuery] = React.useState("");
  const [ruleDialog, setRuleDialog] = React.useState<DialogSlot>(CLOSED);
  const [ruleSetDialog, setRuleSetDialog] = React.useState<DialogSlot>(CLOSED);
  const [importOpen, setImportOpen] = React.useState(false);
  const [targetDialog, setTargetDialog] = React.useState<DialogSlot>(CLOSED);
  const [moveDialog, setMoveDialog] = React.useState<DialogSlot>(CLOSED);
  const [highlightKey, setHighlightKey] = React.useState<string | null>(null);
  /** 重排或删除后要把焦点放回哪一行的哪个按钮（label 为空就取该行第一个可用按钮） */
  const [focusTarget, setFocusTarget] = React.useState<{ key: string; label: string } | null>(null);
  /** 打开对话框的那个按钮：关闭后把焦点还给它（受控对话框没有 DialogTrigger，Radix 找不到归还对象） */
  const openerRef = React.useRef<HTMLElement | null>(null);

  const rememberOpener = () => {
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
  };

  const restoreOpenerFocus = React.useCallback((event: Event) => {
    const opener = openerRef.current;
    openerRef.current = null;
    if (!opener?.isConnected) return;
    event.preventDefault();
    opener.focus({ preventScroll: true });
  }, []);

  const openDialog = (open: (slot: DialogSlot) => void, row: RuleRow | null) => {
    rememberOpener();
    open({ open: true, row });
  };

  const trimmedQuery = query.trim();
  const filtering = filter !== "all" || trimmedQuery !== "";
  const visibleRows = view.rows.filter((row) => matchesFilter(row, filter) && matchesQuery(row, trimmedQuery));
  const enabledModuleCount = moduleGroups.reduce(
    (sum, group) => sum + group.modules.filter((module) => module.enabled).length,
    0
  );
  const moduleCount = moduleGroups.reduce((sum, group) => sum + group.modules.length, 0);
  const filterCounts: Record<RowFilter, number> = {
    all: view.rows.length,
    custom: view.rows.filter((row) => row.movable).length,
    builtin: view.rows.filter((row) => row.kind === "module").length,
    attention: view.rows.filter((row) => row.targetWarning).length,
  };

  // 新增或挪动后把那一行滚进视野并短暂高亮，长列表里不至于找不到它去了哪
  React.useEffect(() => {
    if (!highlightKey) return;
    document.getElementById(rowDomId(highlightKey))?.scrollIntoView({
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
    const timer = setTimeout(() => setHighlightKey(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightKey]);

  // React 重排列表时会把被移动的那一行整个摘下再插回，焦点随之丢到 body：
  // 键盘连按「下移」时要把焦点放回同一个按钮，删除后则交给相邻那一行
  React.useEffect(() => {
    if (!focusTarget) return;
    setFocusTarget(null);
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const buttons = Array.from(
      document.getElementById(rowDomId(focusTarget.key))?.querySelectorAll<HTMLButtonElement>("button") ?? []
    ).filter((button) => !button.disabled);
    const preferred = buttons.find((button) => button.getAttribute("aria-label") === focusTarget.label);
    (preferred ?? buttons[0])?.focus({ preventScroll: true });
  }, [focusTarget]);

  const applyAndFocus = (next: ConfigRecord, key: string) => {
    onChange(next);
    setHighlightKey(key);
  };

  const handleMove = (row: RuleRow, direction: -1 | 1) => {
    applyAndFocus(moveRule(config, row.key, direction), row.key);
    setFocusTarget({ key: row.key, label: moveButtonLabel(rowName(row), direction) });
  };

  const handleDelete = (row: RuleRow) => {
    const index = view.rows.indexOf(row);
    const neighbor = view.rows[index + 1] ?? view.rows[index - 1];
    if (row.customRule) onChange(deleteCustomRule(config, row.customRule.id));
    else if (row.customRuleSet) onChange(deleteCustomRuleSet(config, row.customRuleSet.id));
    if (neighbor) setFocusTarget({ key: neighbor.key, label: "" });
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="space-y-1">
            <CardTitle>分流组</CardTitle>
            {/* 中文说明写成单个字符串：JSX 换行会在中文之间折出一个多余的空格 */}
            <p className="text-xs text-fg-45">
              {`已开启 ${enabledModuleCount} / ${moduleCount} 个。关闭后它的内置规则不再生成；🚀 节点选择与 🐟 漏网之鱼负责兜底，不能关闭。`}
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => setModulesOpen((open) => !open)}
            aria-expanded={modulesOpen}
            aria-controls="config-module-toggles"
            className="w-full shrink-0 sm:w-auto"
          >
            <Icon icon={ChevronDown} className={cn("transition-transform duration-200", modulesOpen && "rotate-180")} />
            {modulesOpen ? "收起" : "调整分流组"}
          </Button>
        </CardHeader>
        {modulesOpen ? (
          <CardContent id="config-module-toggles" className="animate-fade-in space-y-4">
            {moduleGroups.map((group) => (
              <section key={group.category} aria-label={group.label} className="space-y-2">
                <h4 className="text-xs font-medium text-fg-45">{group.label}</h4>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {group.modules.map((module) => (
                    <SwitchField
                      key={module.id}
                      label={module.name}
                      description={
                        module.locked
                          ? "必选，不能关闭"
                          : [
                              module.description,
                              module.ruleCount > 0 ? `${module.ruleCount} 条规则` : "不含规则",
                              module.references > 0 ? `被 ${module.references} 条规则当作目标` : "",
                            ]
                              .filter(Boolean)
                              .join(" · ")
                      }
                      checked={module.enabled}
                      disabled={module.locked}
                      onCheckedChange={(checked) => onChange(setModuleEnabled(config, module.id, checked))}
                    />
                  ))}
                </div>
              </section>
            ))}
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="space-y-1">
            <CardTitle>规则顺序</CardTitle>
            <p className="text-xs leading-relaxed text-fg-45">
              {[
                `自上而下逐条匹配、命中即停。共输出 ${view.counts.lines} 条：内置 ${view.counts.builtin}`,
                view.counts.builtinDisabled > 0 ? `（另有 ${view.counts.builtinDisabled} 条已停用）` : "",
                ` · 自定义 ${view.counts.customRules} · 规则集 ${view.counts.customRuleSets}。`,
                "自定义条目可插到任意两条内置规则之间，内置规则之间的先后固定。",
              ].join("")}
            </p>
          </div>
          {/* 窄屏允许换行：三个按钮写全称，读屏才念得清楚是「添加」什么 */}
          <div className="flex shrink-0 flex-wrap gap-2 sm:flex-nowrap">
            <Button onClick={() => openDialog(setRuleDialog, null)}>
              <Icon icon={Plus} />
              添加规则
            </Button>
            <Button variant="secondary" onClick={() => openDialog(setRuleSetDialog, null)}>
              <Icon icon={Library} />
              添加规则集
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                rememberOpener();
                setImportOpen(true);
              }}
            >
              <Icon icon={FileUp} />
              批量导入
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {view.invalid.customRules > 0 || view.invalid.customRuleSets > 0 || view.hiddenCustomEntries > 0 ? (
            <InlineNote tone="warning">
              <div className="space-y-1">
                {view.invalid.customRules > 0 ? (
                  <p>有 {view.invalid.customRules} 条自定义规则格式无效，生成时会被忽略，可在「高级 JSON」里修改。</p>
                ) : null}
                {view.invalid.customRuleSets > 0 ? (
                  <p>有 {view.invalid.customRuleSets} 个规则集格式无效或 id 重复，生成时会被忽略。</p>
                ) : null}
                {view.hiddenCustomEntries > 0 ? (
                  <p>有 {view.hiddenCustomEntries} 条自定义条目指向已停用的自定义分组，当前不会生成。</p>
                ) : null}
              </div>
            </InlineNote>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div role="group" aria-label="筛选规则" className="flex flex-wrap gap-1.5">
              {FILTERS.map((item) => (
                <Button
                  key={item.id}
                  size="sm"
                  variant={filter === item.id ? "default" : "secondary"}
                  aria-pressed={filter === item.id}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                  <span className="tabular-nums opacity-70">{filterCounts[item.id]}</span>
                </Button>
              ))}
            </div>
            <div className="relative sm:w-64">
              <Icon
                icon={Search}
                size="sm"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-45"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索规则内容或分组"
                aria-label="搜索规则"
                className="pl-9"
              />
            </div>
          </div>
          {filtering ? (
            <p className="text-2xs text-fg-45">筛选或搜索时不能调整顺序，清除后即可上移、下移。</p>
          ) : null}

          <ol aria-label="最终规则" className="space-y-1.5">
            {visibleRows.map((row) => {
              const index = view.rows.indexOf(row);
              return (
                <RuleRowItem
                  key={row.key}
                  row={row}
                  highlighted={highlightKey === row.key}
                  reorderDisabled={filtering}
                  canMoveUp={index > 0}
                  canMoveDown={index < view.rows.length - 1}
                  onToggle={(enabled) => onChange(setBuiltinRuleEnabled(config, row.key, enabled))}
                  onEditTarget={() => openDialog(setTargetDialog, row)}
                  onMove={(direction) => handleMove(row, direction)}
                  onMoveTo={() => openDialog(setMoveDialog, row)}
                  onEdit={() => openDialog(row.customRule ? setRuleDialog : setRuleSetDialog, row)}
                  onDelete={() => handleDelete(row)}
                />
              );
            })}
          </ol>
          {visibleRows.length === 0 ? <EmptyState>没有符合条件的规则。</EmptyState> : null}
          {!filtering ? (
            <div className="flex items-start gap-3 rounded-xl border border-dashed border-card-border px-3 py-2.5">
              <span className="mt-0.5 w-8 shrink-0 text-right font-mono text-xs tabular-nums text-fg-45">
                {view.matchLine}
              </span>
              <div className="min-w-0 space-y-1">
                <p className="break-all font-mono text-xs text-fg-80">{view.matchText}</p>
                <p className="text-2xs text-fg-45">兜底规则：前面都没命中的流量走这里，固定在最后。</p>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <CustomRuleDialog
        open={ruleDialog.open}
        onOpenChange={(open) => setRuleDialog((slot) => ({ ...slot, open }))}
        config={config}
        editing={ruleDialog.row}
        targetOptions={targetOptions}
        onCloseAutoFocus={restoreOpenerFocus}
        onSubmit={(input, id) => {
          const result = saveCustomRule(config, input, id);
          applyAndFocus(result.config, result.key);
        }}
      />
      <CustomRuleSetDialog
        open={ruleSetDialog.open}
        onOpenChange={(open) => setRuleSetDialog((slot) => ({ ...slot, open }))}
        config={config}
        editing={ruleSetDialog.row}
        targetOptions={targetOptions}
        onCloseAutoFocus={restoreOpenerFocus}
        onSubmit={(input, id) => {
          const result = saveCustomRuleSet(config, input, id);
          applyAndFocus(result.config, result.key);
        }}
      />
      <BatchImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        config={config}
        targetOptions={targetOptions}
        onCloseAutoFocus={restoreOpenerFocus}
        onImport={(entries) => onChange(importCustomEntries(config, entries))}
      />
      <BuiltinTargetDialog
        open={targetDialog.open}
        row={targetDialog.row}
        onOpenChange={(open) => setTargetDialog((slot) => ({ ...slot, open }))}
        targetOptions={targetOptions}
        onCloseAutoFocus={restoreOpenerFocus}
        onSubmit={(key, value) => onChange(setBuiltinRuleTarget(config, key, value))}
      />
      <MoveToLineDialog
        open={moveDialog.open}
        row={moveDialog.row}
        maxLine={view.matchLine - 1}
        onOpenChange={(open) => setMoveDialog((slot) => ({ ...slot, open }))}
        onCloseAutoFocus={restoreOpenerFocus}
        onSubmit={(key, line) => applyAndFocus(moveRuleToLine(config, key, line), key)}
      />
    </>
  );
}

type RuleRowItemProps = {
  row: RuleRow;
  highlighted: boolean;
  reorderDisabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggle: (enabled: boolean) => void;
  onEditTarget: () => void;
  onMove: (direction: -1 | 1) => void;
  onMoveTo: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

function RuleRowItem({
  row,
  highlighted,
  reorderDisabled,
  canMoveUp,
  canMoveDown,
  onToggle,
  onEditTarget,
  onMove,
  onMoveTo,
  onEdit,
  onDelete,
}: RuleRowItemProps) {
  const name = rowName(row);
  return (
    <li
      id={rowDomId(row.key)}
      className={cn(
        // 与源/订阅列表一致：窄屏文本一行、操作换到第二行贴右
        "flex flex-col gap-2 rounded-xl border px-3 py-2.5 transition-[border-color,background-color] duration-200 sm:flex-row sm:items-center sm:gap-3",
        row.movable ? "border-primary-500/30 bg-primary-500/10" : "border-card-border bg-surface",
        !row.enabled && "border-dashed",
        highlighted && "border-primary-400/70 bg-primary-500/15"
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          className="mt-0.5 w-8 shrink-0 text-right font-mono text-xs tabular-nums text-fg-45"
          title={row.line ? `第 ${row.line} 行` : "已停用，不会生成"}
        >
          {row.line ?? "–"}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className={cn("break-all font-mono text-xs", row.enabled ? "text-fg-80" : "text-fg-45 line-through")}>
            {row.text}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-fg-45">
            <Badge variant={row.movable ? "default" : "secondary"} className="min-w-0 max-w-full">
              <span className="truncate">{kindLabel(row)}</span>
            </Badge>
            <span className="break-all">{name}</span>
            {row.kind === "custom-rule-set" || row.kind === "special" ? (
              <span className="break-all">{row.detail}</span>
            ) : null}
            {!row.enabled ? <span>已停用，不会生成</span> : null}
            {row.kind === "module" && !row.defaultTarget ? <span>已改目标</span> : null}
          </div>
          {row.targetWarning ? <InlineNote variant="plain">{row.targetWarning}</InlineNote> : null}
        </div>
      </div>

      {row.kind === "module" ? (
        <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
          <IconButton label={`修改 ${name} 的目标`} variant="ghost" onClick={onEditTarget} className="min-h-9 min-w-9">
            <Icon icon={Crosshair} />
          </IconButton>
          <Switch checked={row.enabled} onCheckedChange={onToggle} aria-label={`启用 ${name}`} />
        </div>
      ) : null}

      {row.movable ? (
        <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
          <IconButton
            label={moveButtonLabel(name, -1)}
            variant="ghost"
            disabled={reorderDisabled || !canMoveUp}
            onClick={() => onMove(-1)}
            className="min-h-9 min-w-9"
          >
            <Icon icon={ArrowUp} />
          </IconButton>
          <IconButton
            label={moveButtonLabel(name, 1)}
            variant="ghost"
            disabled={reorderDisabled || !canMoveDown}
            onClick={() => onMove(1)}
            className="min-h-9 min-w-9"
          >
            <Icon icon={ArrowDown} />
          </IconButton>
          <IconButton
            label={`把 ${name} 移到指定行`}
            variant="ghost"
            disabled={reorderDisabled}
            onClick={onMoveTo}
            className="min-h-9 min-w-9"
          >
            <Icon icon={ListOrdered} />
          </IconButton>
          <IconButton label={`编辑 ${name}`} variant="ghost" onClick={onEdit} className="min-h-9 min-w-9">
            <Icon icon={Pencil} />
          </IconButton>
          <IconButton label={`删除 ${name}`} variant="ghost" onClick={onDelete} className="min-h-9 min-w-9">
            <Icon icon={Trash2} />
          </IconButton>
        </div>
      ) : null}
    </li>
  );
}
