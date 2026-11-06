/**
 * 「生成配置 → 规则」可视化编辑的纯逻辑。
 *
 * 草稿就是一份原始配置对象：这里的函数只改自己负责的字段
 * （enabledGroups / enabledRules / customRules / customRuleSets / builtinRuleEdits / ruleOrder），
 * 其余字段原样透传，可视化不认识的内容不会因为编辑而丢失。
 *
 * 顺序一律交给 core 的 resolveFullRuleOrder：界面上的行号就是生成出来的行号。
 */
import { DEFAULT_SUBBOOST_CONFIG, buildDefaultUserConfig } from "@subboost/core/config/defaults";
import { CATEGORY_INFO, PROXY_GROUP_MODULES, type ProxyGroupModule } from "@subboost/core/generator/proxy-groups";
import {
  EXPERIMENTAL_CN_RULE,
  buildRuleOrderView,
  getCustomRuleSetOrderKey,
  resolveFullRuleOrder,
  resolveModuleName,
  type GeneratedRuleEntry,
  type RulesGenerateOptions,
} from "@subboost/core/generator/rules";
import { stableJsonStringify } from "@subboost/core/node-identity";
import { normalizeProxyGroupTargetRef } from "@subboost/core/proxy-group-targets";
import { chainRelayGroupName } from "@subboost/core/subscription/chain-nodes";
import { normalizeProxyChains } from "@subboost/core/subscription/config-utils";
import {
  createCustomRuleId,
  ensureCustomRuleId,
  getCustomRuleOrderKey,
  isCustomRuleType,
} from "@subboost/core/rules/custom-rule-utils";
import { DEFAULT_RULE_PROVIDER_BASE_URL, type RuleSetInfo } from "@subboost/core/rules/metadata";
import { allocateRuleSetId, normalizeBuiltinRuleEdits, normalizeRuleModelFromConfig } from "@subboost/core/rules/rule-model";
import type {
  CustomProxyGroup,
  CustomRule,
  CustomRuleSet,
  ProxyGroupRuleTarget,
  RuleSetBehavior,
  TemplateType,
} from "@subboost/core/types/config";

export type ConfigRecord = Record<string, unknown>;

/** 🚀 节点选择是多数分组的默认出口，🐟 漏网之鱼承接 MATCH：两者关掉会让整份配置失去兜底 */
export const LOCKED_MODULE_IDS: ReadonlySet<string> = new Set(["select", "final"]);

const MODULE_BY_ID = new Map(PROXY_GROUP_MODULES.map((module) => [module.id, module]));
const BUILTIN_POLICIES = ["DIRECT", "REJECT"] as const;

export const CUSTOM_RULE_TYPE_META: Record<CustomRule["type"], { label: string; placeholder: string }> = {
  DOMAIN: { label: "DOMAIN · 完整域名", placeholder: "www.example.com" },
  "DOMAIN-SUFFIX": { label: "DOMAIN-SUFFIX · 域名后缀", placeholder: "example.com" },
  "DOMAIN-KEYWORD": { label: "DOMAIN-KEYWORD · 域名关键字", placeholder: "example" },
  "IP-CIDR": { label: "IP-CIDR · IPv4 网段", placeholder: "192.0.2.0/24" },
  "IP-CIDR6": { label: "IP-CIDR6 · IPv6 网段", placeholder: "2001:db8::/32" },
  GEOIP: { label: "GEOIP · 国家/地区 IP", placeholder: "CN" },
  GEOSITE: { label: "GEOSITE · 域名分类", placeholder: "category-ads-all" },
  "PROCESS-NAME": { label: "PROCESS-NAME · 进程名", placeholder: "curl" },
  "DST-PORT": { label: "DST-PORT · 目标端口", placeholder: "443" },
  "SRC-PORT": { label: "SRC-PORT · 来源端口", placeholder: "8080" },
};

/** 生成器只对 IP 网段规则追加 no-resolve，其他类型写了也会被忽略 */
export function supportsNoResolve(type: string): boolean {
  return type === "IP-CIDR" || type === "IP-CIDR6";
}

// ---------------------------------------------------------------------------
// 读取：与 buildGenerateOptionsFromConfig 的宽松规范化保持一致
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is ConfigRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = typeof item === "string" ? item.trim() : "";
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function readRawList(config: ConfigRecord, field: string): unknown[] {
  const value = config[field];
  return Array.isArray(value) ? value : [];
}

function readTemplate(config: ConfigRecord): TemplateType {
  const value = config.template;
  return value === "minimal" || value === "full" ? value : "standard";
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function readNameOverrides(config: ConfigRecord): Record<string, string> {
  if (!isRecord(config.proxyGroupNameOverrides)) return {};
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(config.proxyGroupNameOverrides)) {
    const key = rawKey.trim();
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (key && value) out[key] = value;
  }
  return out;
}

/** 没写 enabledGroups（或写了空数组）时，生成器按模板默认分组处理 */
export function getEnabledModuleIds(config: ConfigRecord): string[] {
  const list = readStringList(config.enabledGroups);
  return list.length > 0 ? list : [...buildDefaultUserConfig(readTemplate(config)).enabledGroups];
}

function parseCustomRule(item: unknown, index: number): CustomRule | null {
  if (!isRecord(item)) return null;
  const type = item.type;
  if (typeof type !== "string" || !isCustomRuleType(type)) return null;
  const value = typeof item.value === "string" ? item.value.trim() : "";
  const target =
    normalizeProxyGroupTargetRef(item.target) ?? (typeof item.target === "string" ? item.target.trim() : "");
  if (!value || !target) return null;
  return ensureCustomRuleId(
    {
      id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : undefined,
      type,
      value,
      target,
      ...(typeof item.noResolve === "boolean" ? { noResolve: item.noResolve } : {}),
    },
    index
  );
}

export function readCustomRules(config: ConfigRecord): { rules: CustomRule[]; invalidCount: number } {
  const raw = readRawList(config, "customRules");
  const rules = raw.map(parseCustomRule).filter((rule): rule is CustomRule => Boolean(rule));
  return { rules, invalidCount: raw.length - rules.length };
}

/**
 * 给没写 id 的自定义规则补上生成器会推导出的同一个 id。
 *
 * 推导出的 id 带着数组下标，删掉前面一条就会整体漂移，ruleOrder 随之失效；
 * 所以任何会改动 customRules 结构的操作都先把 id 固定下来。
 */
function materializeCustomRuleIds(raw: unknown[]): unknown[] {
  const used = new Set<string>();
  return raw.map((item, index) => {
    const parsed = parseCustomRule(item, index);
    if (!parsed || !isRecord(item)) return item;
    let id = parsed.id;
    if (used.has(id)) {
      id = `${parsed.id}-${index + 1}`;
      while (used.has(id)) id = `${id}-1`;
    }
    used.add(id);
    return item.id === id ? item : { ...item, id };
  });
}

function findCustomRuleIndex(raw: unknown[], id: string): number {
  return raw.findIndex((item, index) => parseCustomRule(item, index)?.id === id);
}

function findCustomRuleSetIndex(raw: unknown[], id: string): number {
  return raw.findIndex((item) => isRecord(item) && typeof item.id === "string" && item.id.trim() === id);
}

function readDialerGroupNames(config: ConfigRecord): string[] {
  return readRawList(config, "dialerProxyGroups")
    .filter((item): item is ConfigRecord => isRecord(item) && item.enabled !== false)
    .map((item) => (typeof item.name === "string" ? item.name.trim() : ""))
    .filter(Boolean);
}

/** 启用中的链：`id` → 出口组名。规则目标用 `chain:<id>` 引用，不认链名的字符串写法 */
function readChainGroupRefs(config: ConfigRecord): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const item of readRawList(config, "proxyChains")) {
    if (!isRecord(item) || item.enabled === false) continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name });
  }
  return out;
}

type TargetContext = {
  enabledModules: Set<string>;
  overrides: Record<string, string>;
  moduleIdByName: Map<string, string>;
  /** 全部自定义分组（含已停用的），只用来认名字与给出准确提示 */
  customGroups: CustomProxyGroup[];
  /** 全部链（含已停用的），同上：只为认 id 与给出准确提示 */
  chains: { id: string; name: string; enabled: boolean }[];
  fallback: string;
};

function buildTargetContext(config: ConfigRecord, enabledModules: string[]): TargetContext {
  const overrides = readNameOverrides(config);
  const customGroups = normalizeRuleModelFromConfig(config).customProxyGroups;
  const chains = readChainGroupRefs(config).map((chain) => ({ ...chain, enabled: true }));
  for (const item of readRawList(config, "proxyChains")) {
    if (!isRecord(item) || item.enabled !== false) continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (id && name) chains.push({ id, name, enabled: false });
  }
  const enabledSet = new Set(enabledModules);
  const leading = customGroups
    .find((group) => group.enabled !== false && group.memberSource === "filtered-nodes")
    ?.name.trim();
  // 生成器回退到第一个代理组：先是按节点筛选的自定义分组，其次是 🚀 节点选择
  const firstModule = ["select", "auto", ...PROXY_GROUP_MODULES.map((module) => module.id)].find((id) =>
    enabledSet.has(id)
  );
  return {
    enabledModules: enabledSet,
    overrides,
    moduleIdByName: new Map(PROXY_GROUP_MODULES.map((module) => [resolveModuleName(module.id, overrides), module.id])),
    customGroups,
    chains,
    fallback: leading || (firstModule ? resolveModuleName(firstModule, overrides) : "DIRECT"),
  };
}

/**
 * 组装给 core 规则函数的参数。
 *
 * 可用策略目标里放的是「生成后一定存在的组名」+ DIRECT/REJECT，让指向未开启分组的目标
 * 在预览里也显示回退结果；写成字符串、又认不出来的目标可能是节点名，界面拿不到节点，
 * 只能原样保留，由行内提示与服务端预览兜底。
 */
export function buildRuleOptions(config: ConfigRecord): RulesGenerateOptions {
  const model = normalizeRuleModelFromConfig(config);
  const enabledModules = getEnabledModuleIds(config);
  const customRules = readCustomRules(config).rules;
  const ctx = buildTargetContext(config, enabledModules);
  const activeGroups = ctx.customGroups.filter((group) => group.enabled !== false);
  const groupNames = [
    ...activeGroups.filter((group) => group.memberSource === "filtered-nodes").map((group) => group.name.trim()),
    ...enabledModules.filter((id) => MODULE_BY_ID.has(id)).map((id) => resolveModuleName(id, ctx.overrides)),
    ...activeGroups.filter((group) => group.memberSource !== "filtered-nodes").map((group) => group.name.trim()),
    ...readDialerGroupNames(config),
    ...ctx.chains.filter((chain) => chain.enabled).map((chain) => chain.name),
  ];
  const known = new Set<string>([
    ...groupNames,
    ...BUILTIN_POLICIES,
    ...ctx.moduleIdByName.keys(),
    ...ctx.customGroups.map((group) => group.name.trim()),
    ...ctx.chains.map((chain) => chain.name),
  ]);
  const passthrough = [
    ...customRules.map((rule) => rule.target),
    ...model.customRuleSets.map((ruleSet) => ruleSet.target),
    ...Object.values(model.builtinRuleEdits).map((edit) => edit.target),
  ].filter((target): target is string => typeof target === "string" && !known.has(target.trim()));

  return {
    enabledModules,
    customRules,
    customRuleSets: model.customRuleSets,
    customProxyGroups: model.customProxyGroups,
    // 链目标只在启用时才有出口组；停用的链由 resolveProxyGroupTargetName 回退到兜底组
    chainGroups: ctx.chains.filter((chain) => chain.enabled).map(({ id, name }) => ({ id, name })),
    builtinRuleEdits: model.builtinRuleEdits,
    proxyGroupNameOverrides: ctx.overrides,
    experimentalCnUseCnRuleSet: readBoolean(
      config.experimentalCnUseCnRuleSet,
      DEFAULT_SUBBOOST_CONFIG.experimentalCnUseCnRuleSet
    ),
    cnIpNoResolve: readBoolean(config.cnIpNoResolve, DEFAULT_SUBBOOST_CONFIG.cnIpNoResolve),
    ruleOrder: readStringList(config.ruleOrder),
    availablePolicyTargets: [...new Set([...groupNames, ...BUILTIN_POLICIES, ...passthrough])],
    fallbackPolicyTarget: ctx.fallback,
  };
}

// ---------------------------------------------------------------------------
// 目标：下拉框的值是带前缀的字符串，与配置里的 ref / 字符串互转
// ---------------------------------------------------------------------------

/**
 * `module:<id>` | `policy:DIRECT` | `policy:REJECT` | `custom:<id>` | `chain:<id>` | `raw:<原样字符串>`
 *
 * 链用 `chain:<链 id>` 而不是组名：链改名后目标仍然有效。
 */
export type RuleTargetValue = string;

export type RuleTargetOption = { value: RuleTargetValue; label: string };

function toTargetValue(target: ProxyGroupRuleTarget, ctx: TargetContext): RuleTargetValue {
  const ref = normalizeProxyGroupTargetRef(target);
  if (ref) return `${ref.kind}:${ref.id}`;
  const name = typeof target === "string" ? target.trim() : "";
  if ((BUILTIN_POLICIES as readonly string[]).includes(name)) return `policy:${name}`;
  const moduleId = ctx.moduleIdByName.get(name);
  if (moduleId) return `module:${moduleId}`;
  const group = ctx.customGroups.find((item) => item.name.trim() === name);
  if (group) return `custom:${group.id}`;
  return `raw:${name}`;
}

export function fromTargetValue(value: RuleTargetValue): ProxyGroupRuleTarget {
  const separator = value.indexOf(":");
  const kind = value.slice(0, separator);
  const rest = value.slice(separator + 1);
  if (kind === "module" || kind === "custom" || kind === "chain") return { kind, id: rest };
  return rest;
}

function describeTarget(value: RuleTargetValue, ctx: TargetContext): { label: string; warning: string | null } {
  const separator = value.indexOf(":");
  const kind = value.slice(0, separator);
  const rest = value.slice(separator + 1);
  if (kind === "policy") return { label: rest, warning: null };
  if (kind === "module") {
    const name = MODULE_BY_ID.has(rest) ? resolveModuleName(rest, ctx.overrides) : rest;
    return ctx.enabledModules.has(rest)
      ? { label: name, warning: null }
      : { label: name, warning: `「${name}」未开启，生成时回退到「${ctx.fallback}」` };
  }
  if (kind === "custom") {
    const group = ctx.customGroups.find((item) => item.id === rest);
    if (!group) return { label: rest, warning: `自定义分组「${rest}」不存在，生成时回退到「${ctx.fallback}」` };
    return group.enabled === false
      ? { label: group.name, warning: `自定义分组「${group.name}」已停用，生成时回退到「${ctx.fallback}」` }
      : { label: group.name, warning: null };
  }
  if (kind === "chain") {
    const chain = ctx.chains.find((item) => item.id === rest);
    if (!chain) return { label: rest, warning: `链「${rest}」不存在，生成时回退到「${ctx.fallback}」` };
    const relayGroupName = chainRelayGroupName(chain.name);
    return chain.enabled
      ? { label: chain.name, warning: null }
      : {
          label: chain.name,
          warning: `链「${chain.name}」已停用，出口组与「${relayGroupName}」都不生成，回退到「${ctx.fallback}」`,
        };
  }
  return {
    label: rest,
    warning: `「${rest}」不是已开启的分流组；订阅里没有同名节点时会回退到「${ctx.fallback}」`,
  };
}

/**
 * 规则可选的目标：已开启的分流组 + 启用中的链出口组 + DIRECT/REJECT（不支持直接指向单个节点）
 *
 * 链排在分流组后面、固定策略前面，让「走这条链」和「直接走某个组」在列表里分得清。
 */
export function listRuleTargetOptions(config: ConfigRecord): RuleTargetOption[] {
  const enabled = new Set(getEnabledModuleIds(config));
  const overrides = readNameOverrides(config);
  const chains = readChainGroupRefs(config);
  return [
    ...PROXY_GROUP_MODULES.filter((module) => enabled.has(module.id)).map((module) => ({
      value: `module:${module.id}`,
      label: resolveModuleName(module.id, overrides),
    })),
    ...readDialerGroupNames(config).map((name) => ({ value: `raw:${name}`, label: name })),
    ...chains.map((chain) => ({ value: `chain:${chain.id}`, label: chain.name })),
    { value: "policy:DIRECT", label: "DIRECT（直连）" },
    { value: "policy:REJECT", label: "REJECT（拒绝）" },
  ];
}

// ---------------------------------------------------------------------------
// 视图
// ---------------------------------------------------------------------------

export type RuleRow = {
  key: string;
  kind: GeneratedRuleEntry["kind"];
  /** 生成后的行号；停用的内置规则不输出，为 null */
  line: number | null;
  text: string;
  summary: string;
  /** 次要信息：内置规则的所属分组、规则集路径等 */
  detail: string;
  sourceLabel: string;
  enabled: boolean;
  movable: boolean;
  moduleId: string | null;
  targetValue: RuleTargetValue;
  targetLabel: string;
  targetWarning: string | null;
  /** 内置规则是否仍指向自己的分组 */
  defaultTarget: boolean;
  customRule?: CustomRule;
  customRuleSet?: CustomRuleSet;
};

export type RuleEditorView = {
  rows: RuleRow[];
  matchText: string;
  matchLine: number;
  counts: {
    /** 最终输出的规则行数（含 MATCH） */
    lines: number;
    builtin: number;
    builtinDisabled: number;
    customRules: number;
    customRuleSets: number;
  };
  /** 格式不对、生成时会被忽略的条目数 */
  invalid: { customRules: number; customRuleSets: number };
  /** 指向已停用自定义分组、当前不会生成的自定义条目数（只能在高级 JSON 中处理） */
  hiddenCustomEntries: number;
};

export function buildRuleEditorView(config: ConfigRecord): RuleEditorView {
  const options = buildRuleOptions(config);
  const { entries, matchEntry } = buildRuleOrderView(options);
  const ctx = buildTargetContext(config, options.enabledModules);
  const customRuleById = new Map(options.customRules.map((rule) => [getCustomRuleOrderKey(rule.id), rule as CustomRule]));
  const ruleSetById = new Map(
    (options.customRuleSets ?? []).map((ruleSet) => [getCustomRuleSetOrderKey(ruleSet.id), ruleSet as CustomRuleSet])
  );
  const edits = options.builtinRuleEdits ?? {};

  let line = 0;
  const rows = entries.map((entry): RuleRow => {
    if (entry.enabled) line += 1;
    const base = {
      key: entry.key,
      kind: entry.kind,
      line: entry.enabled ? line : null,
      text: entry.text,
      summary: entry.summary,
      sourceLabel: entry.sourceLabel,
      enabled: entry.enabled,
      movable: entry.editable,
    };

    if (entry.kind === "module") {
      const [, moduleId = "", ruleId = ""] = entry.key.split(":");
      const rule = MODULE_BY_ID.get(moduleId)?.rules.find((item) => item.id === ruleId);
      const editTarget = edits[entry.key]?.target;
      const targetValue = editTarget ? toTargetValue(editTarget, ctx) : `module:${moduleId}`;
      const target = describeTarget(targetValue, ctx);
      return {
        ...base,
        detail: rule?.path ?? "",
        moduleId,
        targetValue,
        targetLabel: target.label,
        targetWarning: target.warning,
        defaultTarget: targetValue === `module:${moduleId}`,
      };
    }

    if (entry.kind === "custom-rule" || entry.kind === "custom-rule-set") {
      const customRule = customRuleById.get(entry.key);
      const customRuleSet = ruleSetById.get(entry.key);
      const rawTarget = customRule?.target ?? customRuleSet?.target ?? entry.target;
      const targetValue = toTargetValue(rawTarget, ctx);
      const target = describeTarget(targetValue, ctx);
      return {
        ...base,
        detail: customRule ? customRule.type : customRuleSet?.path ?? "",
        moduleId: null,
        targetValue,
        targetLabel: target.label,
        targetWarning: target.warning,
        defaultTarget: false,
        ...(customRule ? { customRule } : {}),
        ...(customRuleSet ? { customRuleSet } : {}),
      };
    }

    return {
      ...base,
      detail: entry.key === "special:experimental-cn" ? `实验性：完整国内域名后置，${EXPERIMENTAL_CN_RULE.path}` : "",
      moduleId: null,
      targetValue: `raw:${entry.target}`,
      targetLabel: entry.target,
      targetWarning: null,
      defaultTarget: true,
    };
  });

  const { rules, invalidCount } = readCustomRules(config);
  const validRuleSets = options.customRuleSets ?? [];
  const shownKeys = new Set(rows.map((row) => row.key));
  const hiddenCustomEntries =
    rules.filter((rule) => !shownKeys.has(getCustomRuleOrderKey(rule.id))).length +
    validRuleSets.filter((ruleSet) => !shownKeys.has(getCustomRuleSetOrderKey(ruleSet.id))).length;

  return {
    rows,
    matchText: matchEntry.text,
    matchLine: line + 1,
    counts: {
      lines: line + 1,
      builtin: rows.filter((row) => row.kind === "module" && row.enabled).length,
      builtinDisabled: rows.filter((row) => row.kind === "module" && !row.enabled).length,
      customRules: rows.filter((row) => row.kind === "custom-rule").length,
      customRuleSets: rows.filter((row) => row.kind === "custom-rule-set").length,
    },
    invalid: {
      customRules: invalidCount,
      customRuleSets: readRawList(config, "customRuleSets").length - validRuleSets.length,
    },
    hiddenCustomEntries,
  };
}

export type ModuleToggle = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  locked: boolean;
  ruleCount: number;
  /** 有多少条自定义规则/规则集/内置改动把它当目标：关掉后这些规则会回退 */
  references: number;
};

export type ModuleToggleGroup = { category: string; label: string; modules: ModuleToggle[] };

function targetModuleId(target: ProxyGroupRuleTarget | undefined, moduleIdByName: Map<string, string>): string | null {
  if (!target) return null;
  const ref = normalizeProxyGroupTargetRef(target);
  if (ref) return ref.kind === "module" ? ref.id : null;
  return typeof target === "string" ? moduleIdByName.get(target.trim()) ?? null : null;
}

export function buildModuleToggleGroups(config: ConfigRecord): ModuleToggleGroup[] {
  const enabled = new Set(getEnabledModuleIds(config));
  const overrides = readNameOverrides(config);
  const moduleIdByName = new Map(PROXY_GROUP_MODULES.map((module) => [resolveModuleName(module.id, overrides), module.id]));
  const model = normalizeRuleModelFromConfig(config);
  const references = new Map<string, number>();
  const count = (target: ProxyGroupRuleTarget | undefined) => {
    const id = targetModuleId(target, moduleIdByName);
    if (id) references.set(id, (references.get(id) ?? 0) + 1);
  };
  readCustomRules(config).rules.forEach((rule) => count(rule.target));
  model.customRuleSets.forEach((ruleSet) => count(ruleSet.target));
  Object.values(model.builtinRuleEdits).forEach((edit) => count(edit.target));

  const byCategory = new Map<string, ProxyGroupModule[]>();
  for (const module of PROXY_GROUP_MODULES) {
    byCategory.set(module.category, [...(byCategory.get(module.category) ?? []), module]);
  }

  return Object.entries(CATEGORY_INFO)
    .sort(([, a], [, b]) => a.order - b.order)
    .filter(([category]) => byCategory.has(category))
    .map(([category, info]) => ({
      category,
      label: info.name,
      modules: (byCategory.get(category) ?? []).map((module) => ({
        id: module.id,
        name: resolveModuleName(module.id, overrides),
        description: module.description,
        enabled: enabled.has(module.id),
        locked: LOCKED_MODULE_IDS.has(module.id),
        ruleCount: module.rules.length,
        references: references.get(module.id) ?? 0,
      })),
    }));
}

// ---------------------------------------------------------------------------
// 编辑操作：都返回新对象；写回的 ruleOrder 一律是覆盖全部模块的完整顺序
// ---------------------------------------------------------------------------

let editableSlotAnchor: string | null | undefined;

/** 规范顺序里紧跟在自定义规则段后面的那条内置规则：新增的自定义条目插在它前面 */
function getEditableSlotAnchor(): string | null {
  if (editableSlotAnchor === undefined) {
    const probe = "__editable-slot-probe__";
    const order = resolveFullRuleOrder({
      enabledModules: [],
      customRules: [{ id: probe, type: "DOMAIN", value: "example.com", target: "DIRECT" }],
    });
    const index = order.indexOf(getCustomRuleOrderKey(probe));
    editableSlotAnchor = index >= 0 ? order[index + 1] ?? null : null;
  }
  return editableSlotAnchor;
}

function insertEditableKeys(order: string[], keys: string[]): string[] {
  const inserting = new Set(keys);
  const next = order.filter((key) => !inserting.has(key));
  const anchor = getEditableSlotAnchor();
  const index = anchor ? next.indexOf(anchor) : -1;
  next.splice(index < 0 ? next.length : index, 0, ...keys);
  return next;
}

function fullOrderOf(config: ConfigRecord): string[] {
  return resolveFullRuleOrder(buildRuleOptions(config));
}

function withFullOrder(config: ConfigRecord): ConfigRecord {
  return { ...config, ruleOrder: fullOrderOf(config) };
}

function uniqueCustomRuleId(raw: unknown[]): string {
  const used = new Set(raw.map((item, index) => parseCustomRule(item, index)?.id).filter(Boolean));
  let id = createCustomRuleId();
  while (used.has(id)) id = createCustomRuleId();
  return id;
}

export function setModuleEnabled(config: ConfigRecord, moduleId: string, enabled: boolean): ConfigRecord {
  if (LOCKED_MODULE_IDS.has(moduleId) || !MODULE_BY_ID.has(moduleId)) return config;
  const current = getEnabledModuleIds(config);
  if (current.includes(moduleId) === enabled) return config;
  const toggle = (list: string[]) =>
    enabled ? [...list.filter((id) => id !== moduleId), moduleId] : list.filter((id) => id !== moduleId);
  const next: ConfigRecord = { ...config, enabledGroups: toggle(current) };
  // enabledRules 不参与生成，但它一直与 enabledGroups 同步维护：存在时跟着改，避免 JSON 里两份说法不一致
  if (Array.isArray(config.enabledRules)) next.enabledRules = toggle(readStringList(config.enabledRules));
  return withFullOrder(next);
}

export type CustomRuleInput = {
  type: CustomRule["type"];
  value: string;
  /** 下拉框的 value（`module:<id>` / `policy:X` / `custom:<id>` / `chain:<id>` / `raw:<名字>`） */
  target: RuleTargetValue;
  noResolve: boolean;
};

/** 对话框的 target 是下拉 value，落盘前要换回 ref / 字符串，否则 chain:<id> 会存成裸字符串 */
function customRuleFields(input: CustomRuleInput) {
  return {
    type: input.type,
    value: input.value.trim(),
    target: fromTargetValue(input.target),
    ...(supportsNoResolve(input.type) && input.noResolve ? { noResolve: true } : {}),
  };
}

/** 新增或修改一条自定义规则；新增的落在自定义规则段末尾，返回新规则的排序 key */
export function saveCustomRule(
  config: ConfigRecord,
  input: CustomRuleInput,
  id?: string
): { config: ConfigRecord; key: string } {
  const raw = materializeCustomRuleIds(readRawList(config, "customRules"));
  const prepared: ConfigRecord = { ...config, customRules: raw };
  const index = id ? findCustomRuleIndex(raw, id) : -1;

  if (id && index >= 0) {
    const { noResolve: _previous, ...original } = raw[index] as ConfigRecord;
    const nextRaw = [...raw];
    nextRaw[index] = { ...original, ...customRuleFields(input), id };
    return { config: withFullOrder({ ...prepared, customRules: nextRaw }), key: getCustomRuleOrderKey(id) };
  }

  const previousOrder = fullOrderOf(prepared);
  const newId = uniqueCustomRuleId(raw);
  const key = getCustomRuleOrderKey(newId);
  return {
    config: {
      ...prepared,
      customRules: [...raw, { id: newId, ...customRuleFields(input) }],
      ruleOrder: insertEditableKeys(previousOrder, [key]),
    },
    key,
  };
}

export function deleteCustomRule(config: ConfigRecord, id: string): ConfigRecord {
  const raw = materializeCustomRuleIds(readRawList(config, "customRules"));
  const index = findCustomRuleIndex(raw, id);
  if (index < 0) return config;
  const prepared: ConfigRecord = { ...config, customRules: raw };
  const key = getCustomRuleOrderKey(id);
  return {
    ...prepared,
    customRules: raw.filter((_item, itemIndex) => itemIndex !== index),
    ruleOrder: fullOrderOf(prepared).filter((item) => item !== key),
  };
}

export type CustomRuleSetInput = {
  name: string;
  behavior: RuleSetBehavior;
  path: string;
  /** 下拉框的 value，落盘时由 customRuleSetFields 换成 ref */
  target: RuleTargetValue;
  noResolve: boolean;
  /** 新建时用于分配 id 的基础名（规则库条目 id 或链接文件名） */
  idHint?: string;
};

/** 规则集 id 同时是 rule-provider 名：不能与任何内置规则（含未开启模块）撞名 */
export function reservedRuleSetIds(config: ConfigRecord, exceptId?: string): string[] {
  return [
    ...PROXY_GROUP_MODULES.flatMap((module) => module.rules.map((rule) => rule.id)),
    EXPERIMENTAL_CN_RULE.id,
    ...normalizeRuleModelFromConfig(config).customRuleSets.map((ruleSet) => ruleSet.id).filter((id) => id !== exceptId),
  ];
}

/** 与 saveCustomRule 同理：下拉 value 在这里才换回 ref，避免 chain:<id> 存成裸字符串 */
function customRuleSetFields(input: CustomRuleSetInput) {
  return {
    name: input.name.trim(),
    behavior: input.behavior,
    path: input.path.trim(),
    target: fromTargetValue(input.target),
    ...(input.behavior === "ipcidr" && input.noResolve ? { noResolve: true } : {}),
  };
}

export function saveCustomRuleSet(
  config: ConfigRecord,
  input: CustomRuleSetInput,
  id?: string
): { config: ConfigRecord; key: string } {
  const raw = readRawList(config, "customRuleSets");
  const index = id ? findCustomRuleSetIndex(raw, id) : -1;

  if (id && index >= 0) {
    const { noResolve: _previous, ...original } = raw[index] as ConfigRecord;
    const nextRaw = [...raw];
    nextRaw[index] = { ...original, ...customRuleSetFields(input), id };
    return { config: withFullOrder({ ...config, customRuleSets: nextRaw }), key: getCustomRuleSetOrderKey(id) };
  }

  const previousOrder = fullOrderOf(config);
  const newId = allocateRuleSetId(input.idHint?.trim() || input.name, reservedRuleSetIds(config));
  const key = getCustomRuleSetOrderKey(newId);
  return {
    config: {
      ...config,
      customRuleSets: [...raw, { id: newId, ...customRuleSetFields(input) }],
      ruleOrder: insertEditableKeys(previousOrder, [key]),
    },
    key,
  };
}

export function deleteCustomRuleSet(config: ConfigRecord, id: string): ConfigRecord {
  const raw = readRawList(config, "customRuleSets");
  const index = findCustomRuleSetIndex(raw, id);
  if (index < 0) return config;
  const key = getCustomRuleSetOrderKey(id);
  return {
    ...config,
    customRuleSets: raw.filter((_item, itemIndex) => itemIndex !== index),
    ruleOrder: fullOrderOf(config).filter((item) => item !== key),
  };
}

/** 导入的规则集条目：target 与对话框一致存下拉 value，id 已在解析阶段分配 */
export type ImportedRuleSetEntry = Omit<CustomRuleSetInput, "noResolve"> & { id: string; noResolve?: boolean };

export type ImportedEntry =
  | { kind: "rule"; rule: CustomRuleInput }
  | { kind: "ruleSet"; ruleSet: ImportedRuleSetEntry };

/** 批量导入：按导入文本的先后整体插到自定义规则段末尾 */
export function importCustomEntries(config: ConfigRecord, entries: ImportedEntry[]): ConfigRecord {
  if (entries.length === 0) return config;
  const raw = materializeCustomRuleIds(readRawList(config, "customRules"));
  const prepared: ConfigRecord = { ...config, customRules: raw };
  const previousOrder = fullOrderOf(prepared);
  const rules = [...raw];
  const ruleSets = [...readRawList(config, "customRuleSets")];
  const keys: string[] = [];

  for (const entry of entries) {
    if (entry.kind === "rule") {
      const id = uniqueCustomRuleId(rules);
      rules.push({ id, ...customRuleFields(entry.rule) });
      keys.push(getCustomRuleOrderKey(id));
      continue;
    }
    const { id, ...ruleSet } = entry.ruleSet;
    ruleSets.push({ id, ...customRuleSetFields({ ...ruleSet, noResolve: Boolean(ruleSet.noResolve) }) });
    keys.push(getCustomRuleSetOrderKey(id));
  }

  return {
    ...prepared,
    customRules: rules,
    customRuleSets: ruleSets,
    ruleOrder: insertEditableKeys(previousOrder, keys),
  };
}

function placeKey(order: string[], key: string, anchor: string, placement: "before" | "after"): string[] {
  const next = order.filter((item) => item !== key);
  const index = next.indexOf(anchor);
  if (index < 0) return order;
  next.splice(placement === "before" ? index : index + 1, 0, key);
  return next;
}

/** 上移/下移一行：只越过界面上相邻的那一行，内置规则之间的相对顺序不变 */
export function moveRule(config: ConfigRecord, key: string, direction: -1 | 1): ConfigRecord {
  const { entries, fullOrder } = buildRuleOrderView(buildRuleOptions(config));
  const index = entries.findIndex((entry) => entry.key === key);
  if (index < 0 || !entries[index].editable) return config;
  const neighbor = entries[index + direction];
  if (!neighbor) return config;
  return { ...config, ruleOrder: placeKey(fullOrder, key, neighbor.key, direction < 0 ? "before" : "after") };
}

/** 移动到第 N 行：移动后它就是生成结果里的第 N 行；超出末尾就放到 MATCH 之前 */
export function moveRuleToLine(config: ConfigRecord, key: string, line: number): ConfigRecord {
  const { entries, fullOrder } = buildRuleOrderView(buildRuleOptions(config));
  const current = entries.find((entry) => entry.key === key);
  if (!current?.editable || !Number.isFinite(line)) return config;
  const others = entries.filter((entry) => entry.key !== key);
  if (others.length === 0) return config;

  const wanted = Math.max(1, Math.floor(line));
  let count = 0;
  for (const entry of others) {
    if (!entry.enabled) continue;
    count += 1;
    if (count === wanted) return { ...config, ruleOrder: placeKey(fullOrder, key, entry.key, "before") };
  }
  return { ...config, ruleOrder: placeKey(fullOrder, key, others[others.length - 1].key, "after") };
}

function updateBuiltinEdit(config: ConfigRecord, key: string, update: (edit: ConfigRecord) => ConfigRecord): ConfigRecord {
  const edits: ConfigRecord = isRecord(config.builtinRuleEdits) ? { ...config.builtinRuleEdits } : {};
  const next = update(isRecord(edits[key]) ? { ...(edits[key] as ConfigRecord) } : {});
  if (Object.keys(next).length === 0) delete edits[key];
  else edits[key] = next;
  return withFullOrder({ ...config, builtinRuleEdits: edits });
}

export function setBuiltinRuleEnabled(config: ConfigRecord, key: string, enabled: boolean): ConfigRecord {
  return updateBuiltinEdit(config, key, (edit) => {
    const { enabled: _previous, ...rest } = edit;
    return enabled ? rest : { ...rest, enabled: false };
  });
}

export function setBuiltinRuleTarget(config: ConfigRecord, key: string, value: RuleTargetValue): ConfigRecord {
  const [, moduleId = ""] = key.split(":");
  return updateBuiltinEdit(config, key, (edit) => {
    const { target: _previous, ...rest } = edit;
    // 改回自己所属的分组就是「恢复默认」：不留一条没有意义的改动
    return value === `module:${moduleId}` ? rest : { ...rest, target: fromTargetValue(value) };
  });
}

// ---------------------------------------------------------------------------
// 与已保存配置对比
// ---------------------------------------------------------------------------

const VISUAL_FIELDS = [
  "enabledGroups",
  "enabledRules",
  "customRules",
  "customRuleSets",
  "builtinRuleEdits",
  "ruleOrder",
  "proxyChains",
] as const;
type VisualField = (typeof VISUAL_FIELDS)[number];

function semanticValue(config: ConfigRecord, field: VisualField): string {
  switch (field) {
    case "enabledGroups":
      return stableJsonStringify([...getEnabledModuleIds(config)].sort());
    case "enabledRules":
      return stableJsonStringify([...readStringList(config.enabledRules)].sort());
    case "customRules":
      return stableJsonStringify(materializeCustomRuleIds(readRawList(config, "customRules")));
    case "customRuleSets":
      return stableJsonStringify(readRawList(config, "customRuleSets"));
    case "builtinRuleEdits":
      return stableJsonStringify(normalizeBuiltinRuleEdits(config.builtinRuleEdits));
    case "ruleOrder":
      return stableJsonStringify(fullOrderOf(config));
    case "proxyChains":
      // 链页写回时总会补 sourceIds: [] 等默认值，按规范化后的语义比较
      return stableJsonStringify(normalizeProxyChains(config.proxyChains));
  }
}

/**
 * 可视化改动在语义上回到原值时（开关关了又开、规则挪走又挪回），把该字段恢复成已保存的原始写法。
 * 这样「改回去」就真的没有未保存的修改，JSON 里也不会多出一段等价但换了写法的内容。
 */
export function reconcileWithBaseline(draft: ConfigRecord, baseline: ConfigRecord): ConfigRecord {
  let next = draft;
  for (const field of VISUAL_FIELDS) {
    if (stableJsonStringify(draft[field]) === stableJsonStringify(baseline[field])) continue;
    if (semanticValue(draft, field) !== semanticValue(baseline, field)) continue;
    next = { ...next };
    if (field in baseline) next[field] = baseline[field];
    else delete next[field];
  }
  return next;
}

export function isConfigChanged(draft: ConfigRecord, baseline: ConfigRecord): boolean {
  return stableJsonStringify(draft) !== stableJsonStringify(baseline);
}

// ---------------------------------------------------------------------------
// 输入校验与规则库
// ---------------------------------------------------------------------------

const IPV4_CIDR = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/u;
const PORT_SPEC = /^\d{1,5}(?:-\d{1,5})?(?:\/\d{1,5}(?:-\d{1,5})?)*$/u;

export function validateCustomRuleInput(
  input: Pick<CustomRuleInput, "type" | "value" | "target">,
  config: ConfigRecord,
  editingId?: string
): string | null {
  const value = input.value.trim();
  if (!value) return "请填写规则值";
  if (value.includes(",")) return "规则值不能包含逗号";
  // 进程名可以带空格（如 Google Chrome），其他类型的值里出现空白基本都是粘贴错了
  if (/[\r\n]/u.test(value) || (input.type !== "PROCESS-NAME" && /\s/u.test(value))) {
    return "规则值不能包含空白或换行";
  }

  if (input.type === "IP-CIDR") {
    const match = IPV4_CIDR.exec(value);
    const valid = match && match.slice(1, 5).every((part) => Number(part) <= 255) && Number(match[5]) <= 32;
    if (!valid) return "IP-CIDR 需要 IPv4 网段，例如 192.0.2.0/24";
  }
  if (input.type === "IP-CIDR6") {
    const match = /^([0-9a-f:.]+)\/(\d{1,3})$/iu.exec(value);
    if (!match || !match[1].includes(":") || Number(match[2]) > 128) {
      return "IP-CIDR6 需要 IPv6 网段，例如 2001:db8::/32";
    }
  }
  if ((input.type === "DST-PORT" || input.type === "SRC-PORT") && !isValidPortSpec(value)) {
    return "端口需为 1–65535 的数字或范围，例如 443、8000-9000";
  }

  const targetKey = stableJsonStringify(normalizeTargetForCompare(input.target));
  const duplicate = readCustomRules(config).rules.some(
    (rule) =>
      rule.id !== editingId &&
      rule.type === input.type &&
      rule.value.toLowerCase() === value.toLowerCase() &&
      stableJsonStringify(normalizeTargetForCompare(rule.target)) === targetKey
  );
  return duplicate ? "已经有一条相同的规则" : null;
}

function normalizeTargetForCompare(target: ProxyGroupRuleTarget): ProxyGroupRuleTarget {
  return normalizeProxyGroupTargetRef(target) ?? (typeof target === "string" ? target.trim() : "");
}

function isValidPortSpec(value: string): boolean {
  if (!PORT_SPEC.test(value)) return false;
  return value.split(/[/-]/u).every((part) => {
    const port = Number(part);
    return port >= 1 && port <= 65535;
  });
}

/** 规则库条目存成相对路径：跟随 ruleProviderBaseUrl，换镜像时不用逐条改 */
export function catalogRuleSetPath(info: RuleSetInfo): string {
  const prefix = `${DEFAULT_RULE_PROVIDER_BASE_URL}/`;
  return info.url.startsWith(prefix) ? info.url.slice(prefix.length) : info.url;
}

export function findCatalogRuleSet(catalog: readonly RuleSetInfo[], path: string): RuleSetInfo | null {
  return catalog.find((info) => catalogRuleSetPath(info) === path.trim()) ?? null;
}

export type RuleSetLinkInspection =
  | { ok: true; name: string; path: string; behavior: RuleSetBehavior | null }
  | { ok: false; error: string };

/**
 * 解析手填的 .mrs 链接。
 *
 * 校验口径与 core 的 parseManualRuleSetUrl 一致（http(s)、不带账号密码、.mrs 文件），
 * 区别是路径里没有 geosite/geoip 时不报错：自建规则集的地址不一定按这个目录组织，交给用户手选类型。
 */
export function inspectRuleSetLink(input: string): RuleSetLinkInspection {
  const path = input.trim();
  let url: URL;
  try {
    url = new URL(path);
  } catch {
    return { ok: false, error: "请输入有效的 http(s) 链接" };
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    return { ok: false, error: "请输入有效的 http(s) 链接，且不要带账号密码" };
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return { ok: false, error: "链接里的文件名编码无效" };
  }
  const filename = pathname.split("/").pop() ?? "";
  if (!/^.+\.mrs$/iu.test(filename)) return { ok: false, error: "目前只支持 .mrs 格式的规则集" };
  const behavior = /\/geoip\//iu.test(pathname) ? "ipcidr" : /\/geosite\//iu.test(pathname) ? "domain" : null;
  return { ok: true, name: filename.slice(0, -4), path, behavior };
}

/** 批量导入按名字匹配目标：分流组用最终显示名，内置策略用 DIRECT / REJECT 原名 */
export function listRuleTargetNames(config: ConfigRecord): Array<{ name: string; value: RuleTargetValue }> {
  return listRuleTargetOptions(config).map((option) => ({
    name: option.value.startsWith("policy:") ? option.value.slice("policy:".length) : option.label,
    value: option.value,
  }));
}
