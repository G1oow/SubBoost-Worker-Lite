import * as React from "react";
import { Search } from "lucide-react";
import { Icon } from "@subboost/ui/components/ui/icon";
import { Badge } from "@subboost/ui/components/ui/badge";
import { Button } from "@subboost/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@subboost/ui/components/ui/dialog";
import { FormField } from "@subboost/ui/components/ui/form-field";
import { Input } from "@subboost/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@subboost/ui/components/ui/select";
import { SwitchField } from "@subboost/ui/components/ui/switch-field";
import { Textarea } from "@subboost/ui/components/ui/textarea";
import { cn } from "@subboost/ui/lib/utils";
import { parseCustomRuleBatchImport } from "@subboost/core/rules/custom-rule-batch-import";
import { CUSTOM_RULE_TYPES } from "@subboost/core/rules/custom-rule-utils";
import { normalizeRuleModelFromConfig } from "@subboost/core/rules/rule-model";
import { ALL_RULES, RULE_CATEGORIES, type RuleSetInfo } from "@subboost/core/rules-database";
import type { CustomRule, RuleSetBehavior } from "@subboost/core/types/config";
import {
  CUSTOM_RULE_TYPE_META,
  catalogRuleSetPath,
  findCatalogRuleSet,
  inspectRuleSetLink,
  listRuleTargetNames,
  readCustomRules,
  reservedRuleSetIds,
  supportsNoResolve,
  validateCustomRuleInput,
  type ConfigRecord,
  type CustomRuleInput,
  type CustomRuleSetInput,
  type ImportedEntry,
  type RuleRow,
  type RuleTargetOption,
  type RuleTargetValue,
} from "../lib/rule-editor";

const CATALOG_RESULT_LIMIT = 40;

function defaultTargetValue(options: RuleTargetOption[]): RuleTargetValue {
  return options.find((option) => option.value === "module:select")?.value ?? options[0]?.value ?? "policy:DIRECT";
}

type ControlProps = { id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean | "true" | "false" };

type TargetSelectProps = ControlProps & {
  value: RuleTargetValue;
  /** 当前值不在可选范围里（历史配置里的节点名、自定义分组）时展示用的名字 */
  currentLabel?: string;
  options: RuleTargetOption[];
  onChange: (value: RuleTargetValue) => void;
};

/** FormField 把 id 注入到这里，再转给真正可聚焦的触发器，标签才能关联上 */
function TargetSelect({ value, currentLabel, options, onChange, ...control }: TargetSelectProps) {
  const items = options.some((option) => option.value === value)
    ? options
    : [{ value, label: `${currentLabel ?? value}（当前值）` }, ...options];
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger {...control}>
        <SelectValue placeholder="选择目标" />
      </SelectTrigger>
      <SelectContent>
        {items.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type RuleTypeSelectProps = ControlProps & {
  value: string;
  onChange: (value: string) => void;
  includeRuleSet?: boolean;
};

function RuleTypeSelect({ value, onChange, includeRuleSet = false, ...control }: RuleTypeSelectProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger {...control}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CUSTOM_RULE_TYPES.map((type) => (
          <SelectItem key={type} value={type}>
            {CUSTOM_RULE_TYPE_META[type].label}
          </SelectItem>
        ))}
        {includeRuleSet ? <SelectItem value="RULE-SET">RULE-SET · .mrs 规则集链接</SelectItem> : null}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// 自定义规则
// ---------------------------------------------------------------------------

/** 关闭时把焦点还给打开它的按钮：受控对话框没有 DialogTrigger，Radix 自己找不到归还对象 */
export type CloseAutoFocusHandler = (event: Event) => void;

export type CustomRuleDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: ConfigRecord;
  /**
   * 编辑时传入打开那一刻的行快照；null 表示新增。
   * 关闭时保留快照（只把 open 置 false），淡出动画期间标题不会闪回「添加」。
   */
  editing: RuleRow | null;
  targetOptions: RuleTargetOption[];
  onSubmit: (input: CustomRuleInput, id?: string) => void;
  onCloseAutoFocus?: CloseAutoFocusHandler;
};

export function CustomRuleDialog({
  open,
  onOpenChange,
  config,
  editing,
  targetOptions,
  onSubmit,
  onCloseAutoFocus,
}: CustomRuleDialogProps) {
  const rule = editing?.customRule ?? null;
  const [type, setType] = React.useState<CustomRule["type"]>("DOMAIN-SUFFIX");
  const [value, setValue] = React.useState("");
  const [target, setTarget] = React.useState<RuleTargetValue>("policy:DIRECT");
  const [noResolve, setNoResolve] = React.useState(false);
  const [error, setError] = React.useState("");

  // 打开时按快照初始化；快照与选项在打开期间引用不变，不会冲掉正在编辑的内容
  React.useEffect(() => {
    if (!open) return;
    setType(editing?.customRule?.type ?? "DOMAIN-SUFFIX");
    setValue(editing?.customRule?.value ?? "");
    setTarget(editing?.targetValue ?? defaultTargetValue(targetOptions));
    setNoResolve(editing?.customRule?.noResolve ?? false);
    setError("");
  }, [open, editing, targetOptions]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    // target 保持下拉的 value 形状：落盘转换在 saveCustomRule 里统一做
    const input: CustomRuleInput = { type, value, target, noResolve };
    const problem = validateCustomRuleInput(input, config, rule?.id);
    if (problem) {
      setError(problem);
      return;
    }
    onSubmit(input, rule?.id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{rule ? "编辑自定义规则" : "添加自定义规则"}</DialogTitle>
          <DialogDescription>新规则排在自定义规则段的末尾，保存前都可以在列表里调整位置。</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField label="类型" required>
            <RuleTypeSelect value={type} onChange={(next) => setType(next as CustomRule["type"])} />
          </FormField>
          <FormField label="值" required error={error || undefined}>
            <Input
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setError("");
              }}
              placeholder={CUSTOM_RULE_TYPE_META[type].placeholder}
              autoComplete="off"
              spellCheck={false}
            />
          </FormField>
          <FormField label="目标" required description="只能选已开启的分流组或 DIRECT / REJECT。">
            <TargetSelect
              value={target}
              currentLabel={editing?.targetLabel}
              options={targetOptions}
              onChange={setTarget}
            />
          </FormField>
          {supportsNoResolve(type) ? (
            <SwitchField
              label="不解析域名（no-resolve）"
              description="只匹配直接用 IP 访问的连接，不为了这条规则去解析域名。"
              checked={noResolve}
              onCheckedChange={setNoResolve}
            />
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit">{rule ? "更新规则" : "添加规则"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 自定义规则集
// ---------------------------------------------------------------------------

type RuleSetSource = "catalog" | "link";

export type CustomRuleSetDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: ConfigRecord;
  editing: RuleRow | null;
  targetOptions: RuleTargetOption[];
  onSubmit: (input: CustomRuleSetInput, id?: string) => void;
  onCloseAutoFocus?: CloseAutoFocusHandler;
};

function matchesCatalogQuery(info: RuleSetInfo, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return [info.id, info.name, info.nameZh, RULE_CATEGORIES[info.category]?.name ?? ""].some((text) =>
    text.toLowerCase().includes(needle)
  );
}

export function CustomRuleSetDialog({
  open,
  onOpenChange,
  config,
  editing,
  targetOptions,
  onSubmit,
  onCloseAutoFocus,
}: CustomRuleSetDialogProps) {
  const ruleSet = editing?.customRuleSet ?? null;
  const [source, setSource] = React.useState<RuleSetSource>("catalog");
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<RuleSetInfo | null>(null);
  const [link, setLink] = React.useState("");
  const [manualBehavior, setManualBehavior] = React.useState<RuleSetBehavior>("domain");
  const [name, setName] = React.useState("");
  const [target, setTarget] = React.useState<RuleTargetValue>("policy:DIRECT");
  const [noResolve, setNoResolve] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    const current = editing?.customRuleSet ?? null;
    const catalogEntry = current ? findCatalogRuleSet(ALL_RULES, current.path) : null;
    setSource(current && !catalogEntry ? "link" : "catalog");
    setQuery("");
    setSelected(catalogEntry);
    setLink(current && !catalogEntry ? current.path : "");
    setManualBehavior(current?.behavior ?? "domain");
    setName(current?.name ?? "");
    setTarget(editing?.targetValue ?? defaultTargetValue(targetOptions));
    setNoResolve(current?.noResolve ?? false);
    setError("");
  }, [open, editing, targetOptions]);

  const results = React.useMemo(
    () => ALL_RULES.filter((info) => matchesCatalogQuery(info, query.trim())),
    [query]
  );
  const inspection = source === "link" && link.trim() ? inspectRuleSetLink(link) : null;
  const behavior: RuleSetBehavior | null =
    source === "catalog"
      ? selected?.behavior ?? null
      : inspection?.ok
        ? inspection.behavior ?? manualBehavior
        : null;

  const pick = (info: RuleSetInfo) => {
    setSelected(info);
    setError("");
    // 名称没手动改过才跟着换：避免用户写好的名字被下一次点选冲掉
    setName((current) => (!current.trim() || current === selected?.nameZh ? info.nameZh : current));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    let path = "";
    let idHint = "";
    let fallbackName = "";
    if (source === "catalog") {
      if (!selected) {
        setError("请先从规则库里选一个规则集");
        return;
      }
      path = catalogRuleSetPath(selected);
      idHint = selected.id;
      fallbackName = selected.nameZh;
    } else {
      if (!inspection) {
        setError("请填写规则集链接");
        return;
      }
      if (!inspection.ok) {
        setError(inspection.error);
        return;
      }
      path = inspection.path;
      idHint = inspection.name;
      fallbackName = inspection.name;
    }
    if (!behavior) {
      setError("请选择规则集类型");
      return;
    }
    const duplicate = normalizeRuleModelFromConfig(config).customRuleSets.some(
      (item) => item.id !== ruleSet?.id && item.path === path
    );
    if (duplicate) {
      setError("这个规则集已经添加过了");
      return;
    }
    onSubmit(
      {
        name: name.trim() || fallbackName,
        behavior,
        path,
        target,
        noResolve,
        idHint,
      },
      ruleSet?.id
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{ruleSet ? "编辑规则集" : "添加规则集"}</DialogTitle>
          <DialogDescription>
            从内置规则库挑选（离线索引，路径跟随规则源地址），或填写任意 .mrs 规则集链接。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-2" role="group" aria-label="规则集来源">
            {(
              [
                ["catalog", "规则库"],
                ["link", "链接"],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                type="button"
                size="sm"
                variant={source === id ? "default" : "secondary"}
                aria-pressed={source === id}
                onClick={() => {
                  setSource(id);
                  setError("");
                }}
              >
                {label}
              </Button>
            ))}
          </div>

          {source === "catalog" ? (
            <div className="space-y-2">
              <div className="relative">
                <Icon
                  icon={Search}
                  size="sm"
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-40"
                />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索名称或 id，例如 openai、流媒体"
                  aria-label="搜索规则库"
                  className="pl-9"
                />
              </div>
              <ul className="custom-scrollbar max-h-64 space-y-1 overflow-y-auto rounded-xl border border-ink/10 bg-ink/5 p-1.5">
                {results.slice(0, CATALOG_RESULT_LIMIT).map((info) => {
                  const active = selected?.id === info.id;
                  return (
                    <li key={info.id}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => pick(info)}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                          active ? "bg-primary-500/15 text-fg" : "text-fg-70 hover:bg-ink/5"
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{info.nameZh}</span>
                          <span className="block truncate font-mono text-[11px] text-fg-45">
                            {catalogRuleSetPath(info)}
                          </span>
                        </span>
                        <Badge variant="secondary" className="shrink-0">
                          {info.behavior === "ipcidr" ? "IP" : "域名"}
                        </Badge>
                      </button>
                    </li>
                  );
                })}
                {results.length === 0 ? (
                  <li className="px-3 py-6 text-center text-sm text-fg-45">没有匹配的规则集，可以改用链接添加。</li>
                ) : null}
              </ul>
              {results.length > CATALOG_RESULT_LIMIT ? (
                <p className="text-[11px] text-fg-45">
                  共 {results.length} 个匹配，只列出前 {CATALOG_RESULT_LIMIT} 个，继续输入可缩小范围。
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              <FormField label="规则集链接" required description="支持 http(s) 的 .mrs 文件。">
                <Input
                  value={link}
                  onChange={(event) => {
                    setLink(event.target.value);
                    setError("");
                  }}
                  placeholder="https://example.com/geosite/example.mrs"
                  autoComplete="off"
                  spellCheck={false}
                />
              </FormField>
              {inspection?.ok && inspection.behavior === null ? (
                <FormField label="规则集类型" required description="链接路径里没有 geosite / geoip，请手动指定。">
                  <BehaviorSelect value={manualBehavior} onChange={setManualBehavior} />
                </FormField>
              ) : null}
            </div>
          )}

          <FormField label="名称" description="只用于界面展示，生成时以分配到的 id 作为规则集名。">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={source === "catalog" ? selected?.nameZh ?? "选择后自动填写" : "默认取链接文件名"}
            />
          </FormField>
          <FormField label="目标" required>
            <TargetSelect value={target} currentLabel={editing?.targetLabel} options={targetOptions} onChange={setTarget} />
          </FormField>
          {behavior === "ipcidr" ? (
            <SwitchField
              label="不解析域名（no-resolve）"
              description="IP 规则集通常建议开启，避免为了匹配而额外解析域名。"
              checked={noResolve}
              onCheckedChange={setNoResolve}
            />
          ) : null}
          {error ? (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit">{ruleSet ? "更新规则集" : "添加规则集"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BehaviorSelect({
  value,
  onChange,
  ...control
}: ControlProps & { value: RuleSetBehavior; onChange: (value: RuleSetBehavior) => void }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as RuleSetBehavior)}>
      <SelectTrigger {...control}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="domain">域名（domain）</SelectItem>
        <SelectItem value="ipcidr">IP 网段（ipcidr）</SelectItem>
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// 批量导入
// ---------------------------------------------------------------------------

export type BatchImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: ConfigRecord;
  targetOptions: RuleTargetOption[];
  onImport: (entries: ImportedEntry[]) => void;
  onCloseAutoFocus?: CloseAutoFocusHandler;
};

const STATUS_LABEL = { ready: "可导入", skipped: "跳过", error: "错误", duplicate: "重复" } as const;
const PROBLEM_LIMIT = 30;

export function BatchImportDialog({
  open,
  onOpenChange,
  config,
  targetOptions,
  onImport,
  onCloseAutoFocus,
}: BatchImportDialogProps) {
  const [text, setText] = React.useState("");
  const [defaultType, setDefaultType] = React.useState<string>("DOMAIN-SUFFIX");
  const [defaultTarget, setDefaultTarget] = React.useState<RuleTargetValue>("policy:DIRECT");
  const [defaultNoResolve, setDefaultNoResolve] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setText("");
    setDefaultType("DOMAIN-SUFFIX");
    setDefaultTarget(defaultTargetValue(targetOptions));
    setDefaultNoResolve(false);
  }, [open, targetOptions]);

  const names = React.useMemo(() => listRuleTargetNames(config), [config]);
  const result = React.useMemo(() => {
    if (!text.trim()) return null;
    const valueByName = new Map(names.map((item) => [item.name, item.value]));
    const nameByValue = new Map(names.map((item) => [item.value, item.name]));
    // 解析器按名字比对目标与重复：已有条目里的 ref 也先换成名字，才能识别出重复
    const toName = (target: CustomRule["target"]) => {
      if (typeof target === "string") return target;
      return nameByValue.get(`${target.kind}:${target.id}`) ?? `${target.kind}:${target.id}`;
    };
    const parsed = parseCustomRuleBatchImport({
      text,
      defaultType: defaultType as CustomRule["type"] | "RULE-SET",
      defaultTarget: nameByValue.get(defaultTarget) ?? "",
      defaultNoResolve,
      targetOptions: names.map((item) => item.name),
      existingRules: readCustomRules(config).rules.map((rule) => ({ ...rule, target: toName(rule.target) })),
      existingRuleSets: normalizeRuleModelFromConfig(config).customRuleSets.map((ruleSet) => ({
        ...ruleSet,
        target: toName(ruleSet.target),
      })),
      reservedRuleSetIds: reservedRuleSetIds(config),
    });
    return { parsed, valueByName };
  }, [text, defaultType, defaultTarget, defaultNoResolve, names, config]);

  const problems = result?.parsed.items.filter((item) => item.status === "error" || item.status === "duplicate") ?? [];

  const handleImport = () => {
    if (!result?.parsed.canImport) return;
    const { parsed, valueByName } = result;
    const rules = [...parsed.rules];
    const ruleSets = [...parsed.ruleSets];
    // 导入条目里的 target 与对话框一致，都存下拉的 value，落盘时再由 fields 换回 ref
    const toTarget = (target: CustomRule["target"]): RuleTargetValue =>
      typeof target === "string" ? valueByName.get(target) ?? `raw:${target}` : `${target.kind}:${target.id}`;
    // 结果把规则与规则集分开放了，按原文行序重新交错，导入后的先后才与粘贴的文本一致
    const entries: ImportedEntry[] = parsed.items
      .filter((item) => item.status === "ready")
      .map((item): ImportedEntry | null => {
        if (item.rule?.type === "RULE-SET") {
          const ruleSet = ruleSets.shift();
          return ruleSet
            ? {
                kind: "ruleSet",
                ruleSet: {
                  id: ruleSet.id,
                  name: ruleSet.name,
                  behavior: ruleSet.behavior,
                  path: ruleSet.path,
                  target: toTarget(ruleSet.target),
                  noResolve: Boolean(ruleSet.noResolve),
                },
              }
            : null;
        }
        const rule = rules.shift();
        return rule
          ? {
              kind: "rule",
              rule: { type: rule.type, value: rule.value, target: toTarget(rule.target), noResolve: Boolean(rule.noResolve) },
            }
          : null;
      })
      .filter((entry): entry is ImportedEntry => Boolean(entry));
    onImport(entries);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>批量导入规则</DialogTitle>
          <DialogDescription>
            每行一条：<code className="font-mono">类型,值,目标[,no-resolve]</code>，也可以直接粘贴 YAML 的
            rules 列表；只写值的行使用下面的默认类型与目标。RULE-SET 行后面跟 .mrs 链接。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormField label="规则文本">
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="min-h-[160px] font-mono text-xs"
              placeholder={"DOMAIN-SUFFIX,example.com,DIRECT\nIP-CIDR,192.0.2.0/24,REJECT,no-resolve\nexample.org"}
              spellCheck={false}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="默认类型">
              <RuleTypeSelect value={defaultType} onChange={setDefaultType} includeRuleSet />
            </FormField>
            <FormField label="默认目标">
              <TargetSelect value={defaultTarget} options={targetOptions} onChange={setDefaultTarget} />
            </FormField>
          </div>
          <SwitchField
            label="默认加 no-resolve"
            description="只对只写了值、没写目标的行生效；生成时仅 IP 网段规则会带上它。"
            checked={defaultNoResolve}
            onCheckedChange={setDefaultNoResolve}
          />

          {result ? (
            <div className="space-y-2 rounded-xl border border-ink/10 bg-ink/5 p-3" aria-live="polite">
              <p className="text-sm text-fg-80">
                可导入 <span className="tabular-nums">{result.parsed.readyCount}</span> 条
                {result.parsed.skippedCount > 0 ? ` · 跳过 ${result.parsed.skippedCount} 行` : ""}
                {result.parsed.errorCount > 0 ? ` · 错误 ${result.parsed.errorCount} 行` : ""}
                {result.parsed.duplicateCount > 0 ? ` · 重复 ${result.parsed.duplicateCount} 行` : ""}
              </p>
              {problems.length > 0 ? (
                <ul className="custom-scrollbar max-h-40 space-y-1 overflow-y-auto text-[11px]">
                  {problems.slice(0, PROBLEM_LIMIT).map((item) => (
                    <li key={item.lineNumber} className="flex gap-2">
                      <span className="shrink-0 tabular-nums text-fg-45">第 {item.lineNumber} 行</span>
                      <span className={item.status === "error" ? "text-red-400" : "text-amber-400"}>
                        {STATUS_LABEL[item.status]}：{item.message}
                      </span>
                      <span className="min-w-0 truncate font-mono text-fg-45">{item.raw.trim()}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {problems.length > 0 ? (
                <p className="text-[11px] text-fg-45">有错误或重复的行时不能导入，修改或删掉这些行后再试。</p>
              ) : null}
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="button" onClick={handleImport} disabled={!result?.parsed.canImport}>
              {result?.parsed.canImport ? `导入 ${result.parsed.readyCount} 条` : "导入"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 内置规则目标、移动到指定行
// ---------------------------------------------------------------------------

export type BuiltinTargetDialogProps = {
  open: boolean;
  /** 打开那一刻的行快照，关闭时保留 */
  row: RuleRow | null;
  onOpenChange: (open: boolean) => void;
  targetOptions: RuleTargetOption[];
  onSubmit: (key: string, value: RuleTargetValue) => void;
  onCloseAutoFocus?: CloseAutoFocusHandler;
};

export function BuiltinTargetDialog({
  open,
  row,
  onOpenChange,
  targetOptions,
  onSubmit,
  onCloseAutoFocus,
}: BuiltinTargetDialogProps) {
  const [target, setTarget] = React.useState<RuleTargetValue>("");
  React.useEffect(() => {
    if (open && row) setTarget(row.targetValue);
  }, [open, row]);
  const defaultValue = row?.moduleId ? `module:${row.moduleId}` : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{row ? `修改目标 · ${row.summary}` : "修改目标"}</DialogTitle>
          <DialogDescription>
            {row ? `默认指向「${row.sourceLabel}」。改目标不会改变它在列表里的位置。` : null}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (row) onSubmit(row.key, target);
            onOpenChange(false);
          }}
        >
          <FormField label="目标" required>
            <TargetSelect value={target} currentLabel={row?.targetLabel} options={targetOptions} onChange={setTarget} />
          </FormField>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={target === defaultValue}
              onClick={() => setTarget(defaultValue)}
            >
              恢复默认目标
            </Button>
            <Button type="submit">确定</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type MoveToLineDialogProps = {
  open: boolean;
  /** 打开那一刻的行快照，关闭时保留 */
  row: RuleRow | null;
  /** 当前 MATCH 之前的最后一行 */
  maxLine: number;
  onOpenChange: (open: boolean) => void;
  onSubmit: (key: string, line: number) => void;
  onCloseAutoFocus?: CloseAutoFocusHandler;
};

export function MoveToLineDialog({
  open,
  row,
  maxLine,
  onOpenChange,
  onSubmit,
  onCloseAutoFocus,
}: MoveToLineDialogProps) {
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    if (!open || !row) return;
    setValue(row.line ? String(row.line) : "");
    setError("");
  }, [open, row]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>移动到指定行</DialogTitle>
          <DialogDescription>
            移动后这条规则就是生成结果里的第 N 行；填 {maxLine} 以上会放到 MATCH 之前的最后一行。
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const line = Number(value);
            if (!Number.isInteger(line) || line < 1) {
              setError("请输入正整数行号");
              return;
            }
            if (row) onSubmit(row.key, line);
            onOpenChange(false);
          }}
        >
          <FormField label="目标行号" required error={error || undefined}>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setError("");
              }}
            />
          </FormField>
          <DialogFooter className="gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit">移动</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
