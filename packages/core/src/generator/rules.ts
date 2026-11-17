import type { BuiltinRuleEdits, CustomRule, CustomRuleSet, ProxyGroupRuleTarget } from "@subboost/core/types/config";
import type { CustomProxyGroup } from "@subboost/core/types/config";
import { getCustomRuleOrderKey } from "@subboost/core/rules/custom-rule-utils";
import { resolveProxyGroupModuleName } from "@subboost/core/proxy-group-name";
import { resolveProxyGroupTargetName, type ChainGroupRef } from "@subboost/core/proxy-group-targets";
import {
  BUILTIN_CUSTOM_RULE_ANCHOR,
  BUILTIN_EXTRA_RULES,
  BUILTIN_RULE_ORDER,
  PROXY_GROUP_MODULES,
  type ProxyGroupModule,
  type ProxyGroupRule,
} from "./proxy-group-modules";
import { getEffectiveModuleRules, getModuleRuleOrderKey } from "./module-rules";
import { createPolicyTargetResolver } from "./policy-targets";
import {
  buildManualDomainRuleTexts,
  buildManualProcessRuleTexts,
  type ManualDomains,
} from "@subboost/core/rules/manual-domains";

type CustomRuleLike = Pick<CustomRule, "id" | "type" | "value" | "target" | "noResolve">;
type CustomRuleSetLike = Pick<CustomRuleSet, "id" | "name" | "behavior" | "path" | "target" | "noResolve">;

export type GeneratedRuleEntryKind = "module" | "custom-rule" | "custom-rule-set" | "special";

export interface GeneratedRuleEntry {
  key: string;
  text: string;
  kind: GeneratedRuleEntryKind;
  sourceLabel: string;
  summary: string;
  target: string;
  noResolve: boolean;
  editable: boolean;
  enabled: boolean;
}

export interface RulesGenerateOptions {
  enabledModules: string[];
  customRules: CustomRuleLike[];
  customRuleSets?: CustomRuleSetLike[];
  customProxyGroups?: CustomProxyGroup[];
  /** 启用的链：规则目标可以把 chain:<id> 指向出口组名 */
  chainGroups?: ChainGroupRef[];
  builtinRuleEdits?: BuiltinRuleEdits;
  proxyGroupNameOverrides?: Record<string, string>;
  ruleOrder?: string[];
  availablePolicyTargets?: string[];
  fallbackPolicyTarget?: string;
  /** 手动域名三表（直连 / 代理 / 拦截），目标分别是 国内直连 / 自动选择 / 广告拦截 */
  manualDomains?: ManualDomains;
  /** 手动进程规则：进程名或完整 Clash 规则，默认目标 DIRECT */
  manualProcessRules?: string[];
  /** Steam 流量是否走「Steam 代理」（关掉即全部 DIRECT） */
  steamViaProxy?: boolean;
  /** Steam 下载 CDN 是否也走代理 */
  steamDownloadViaProxy?: boolean;
}

/**
 * 内置分组（= 分流规则目标）的固定 id
 *
 * 「手动选择」既是兜底出口（MATCH），也是脚本里 `steamGroup` 之外的默认选择组。
 */
export const BUILTIN_MODULE_IDS = {
  select: "select",
  auto: "auto",
  cn: "cn",
  ad: "ad",
  steam: "steam",
} as const;

export function resolveModuleName(moduleId: string, overrides?: Record<string, string>): string {
  const mod = PROXY_GROUP_MODULES.find((m) => m.id === moduleId);
  if (!mod) return moduleId;
  return resolveProxyGroupModuleName(mod, overrides?.[moduleId]);
}

export function resolveModuleNameFromModule(module: ProxyGroupModule, overrides?: Record<string, string>): string {
  return resolveModuleName(module.id, overrides);
}

export { getEffectiveModuleRules };

function buildModuleNameMap(overrides?: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    PROXY_GROUP_MODULES.map((module) => [module.id, resolveModuleNameFromModule(module, overrides)])
  );
}

function getEnabledCustomProxyGroups(customProxyGroups: CustomProxyGroup[]): CustomProxyGroup[] {
  return customProxyGroups.filter((group) => group && group.enabled !== false);
}

function customTargetIsDisabled(
  target: ProxyGroupRuleTarget,
  customProxyGroups: CustomProxyGroup[]
): boolean {
  const disabled = customProxyGroups.filter((group) => group && group.enabled === false);
  if (disabled.length === 0) return false;
  if (typeof target === "object" && target?.kind === "custom") {
    return disabled.some((group) => group.id === target.id);
  }
  if (typeof target === "string") {
    const name = target.trim();
    return Boolean(name) && disabled.some((group) => group.name.trim() === name);
  }
  return false;
}

const PRESET_MODULE_RULE_ORDER_KEYS = BUILTIN_RULE_ORDER.map((key) => `module:${key}`);
const PRESET_MODULE_RULE_ORDER_KEY_SET = new Set(PRESET_MODULE_RULE_ORDER_KEYS);
const ALL_MODULE_IDS = PROXY_GROUP_MODULES.map((module) => module.id);
const MODULE_BY_ID = new Map(PROXY_GROUP_MODULES.map((module) => [module.id, module]));

let canonicalPresetRuleIndex: Map<string, number> | null = null;

/**
 * 全部内置规则（含未开启模块）在规范生成顺序里的位置。
 * 持久化顺序缺了某条内置规则时，按它在这里的后继找插回锚点。
 */
function getCanonicalPresetRuleIndex(): Map<string, number> {
  if (!canonicalPresetRuleIndex) {
    const keys = buildCanonicalRuleEntries({
      enabledModules: ALL_MODULE_IDS,
      customRules: [],
      customRuleSets: [],
    }).preMatchEntries
      .map((entry) => entry.key)
      .filter((key) => PRESET_MODULE_RULE_ORDER_KEY_SET.has(key));
    canonicalPresetRuleIndex = new Map(keys.map((key, index) => [key, index]));
  }
  return canonicalPresetRuleIndex;
}

/** 组装一条内置规则的文本：`<文字规则前半段>,<目标>[,no-resolve]` */
function buildBuiltinRuleText(rule: ProxyGroupRule, target: string, noResolve: boolean): string {
  const head = rule.text ?? "";
  return `${head},${target}${noResolve ? ",no-resolve" : ""}`;
}

function buildModuleRuleEntry(
  module: ProxyGroupModule,
  rule: ProxyGroupRule,
  builtinRuleEdits?: BuiltinRuleEdits,
  proxyGroupNameOverrides?: Record<string, string>,
  customProxyGroups: CustomProxyGroup[] = [],
  chainGroups: ChainGroupRef[] = [],
  resolvePolicyTarget: (target: string) => string = (target) => target,
  /** 目标覆盖：Steam 路由开关把整组规则的目标改成 DIRECT / Steam 代理 */
  targetOverride?: string
): GeneratedRuleEntry {
  const key = getModuleRuleOrderKey(module.id, rule.id);
  const edit = builtinRuleEdits?.[key];
  const moduleName = resolveModuleNameFromModule(module, proxyGroupNameOverrides);
  const defaultTarget = targetOverride ?? rule.policyTarget ?? moduleName;
  const targetName = resolveProxyGroupTargetName(edit?.target || defaultTarget, {
    moduleNames: buildModuleNameMap(proxyGroupNameOverrides),
    customProxyGroups,
    chainGroups,
    fallbackTarget: defaultTarget,
  });
  const target = resolvePolicyTarget(targetName);
  const noResolve = Boolean(rule.noResolve);

  return {
    key,
    text: buildBuiltinRuleText(rule, target, noResolve),
    kind: "module",
    sourceLabel: moduleName,
    summary: rule.name,
    target,
    noResolve,
    editable: false,
    enabled: edit?.enabled !== false,
  };
}

function buildCustomRuleEntry(
  rule: CustomRuleLike,
  moduleNames: Record<string, string>,
  customProxyGroups: CustomProxyGroup[] = [],
  chainGroups: ChainGroupRef[] = [],
  resolvePolicyTarget: (target: string) => string = (target) => target
): GeneratedRuleEntry {
  const noResolve = Boolean(rule.noResolve) && (rule.type === "IP-CIDR" || rule.type === "IP-CIDR6");
  const target = resolvePolicyTarget(
    resolveProxyGroupTargetName(rule.target, { moduleNames, customProxyGroups, chainGroups })
  );
  let text = `${rule.type},${rule.value},${target}`;
  if (noResolve) text += ",no-resolve";

  return {
    key: getCustomRuleOrderKey(rule.id),
    text,
    kind: "custom-rule",
    sourceLabel: "自定义规则",
    summary: rule.value,
    target,
    noResolve,
    editable: true,
    enabled: true,
  };
}

function buildCustomRuleSetEntry(
  ruleSet: CustomRuleSetLike,
  moduleNames: Record<string, string>,
  customProxyGroups: CustomProxyGroup[] = [],
  chainGroups: ChainGroupRef[] = [],
  resolvePolicyTarget: (target: string) => string = (target) => target
): GeneratedRuleEntry {
  const noResolve = Boolean(ruleSet.noResolve);
  const target = resolvePolicyTarget(
    resolveProxyGroupTargetName(ruleSet.target, { moduleNames, customProxyGroups, chainGroups })
  );
  let text = `RULE-SET,${ruleSet.id},${target}`;
  if (noResolve) text += ",no-resolve";

  return {
    key: getCustomRuleSetOrderKey(ruleSet.id),
    text,
    kind: "custom-rule-set",
    sourceLabel: "自定义规则集",
    summary: ruleSet.name,
    target,
    noResolve,
    editable: true,
    enabled: true,
  };
}

function buildOrderedEditableEntries(
  customRules: CustomRuleLike[],
  customRuleSets: CustomRuleSetLike[],
  ruleOrder?: string[],
  moduleNames: Record<string, string> = {},
  customProxyGroups: CustomProxyGroup[] = [],
  chainGroups: ChainGroupRef[] = [],
  resolvePolicyTarget: (target: string) => string = (target) => target
): GeneratedRuleEntry[] {
  const defaultEntries: GeneratedRuleEntry[] = [
    ...customRules.map((rule) =>
      buildCustomRuleEntry(rule, moduleNames, customProxyGroups, chainGroups, resolvePolicyTarget)
    ),
    ...customRuleSets.map((ruleSet) =>
      buildCustomRuleSetEntry(ruleSet, moduleNames, customProxyGroups, chainGroups, resolvePolicyTarget)
    ),
  ];
  const editableKeys = defaultEntries.map((entry) => entry.key);
  const normalizedEditableOrder = normalizeEditableRuleOrderKeys(ruleOrder, editableKeys);
  const byKey = new Map(defaultEntries.map((entry) => [entry.key, entry]));

  return normalizedEditableOrder.map((key) => byKey.get(key)).filter(Boolean) as GeneratedRuleEntry[];
}

function buildSpecialRuleEntry(
  key: string,
  text: string,
  summary: string,
  target: string
): GeneratedRuleEntry {
  return {
    key,
    text,
    kind: "special",
    sourceLabel: "系统规则",
    summary,
    target,
    noResolve: false,
    editable: false,
    enabled: true,
  };
}

export function getCustomRuleSetOrderKey(ruleSetId: string): string {
  return `custom-rule-set:${ruleSetId}`;
}

function normalizeRuleOrderInput(ruleOrder: string[] | undefined): string[] {
  if (!Array.isArray(ruleOrder)) return [];
  const next: string[] = [];
  const seen = new Set<string>();
  for (const rawKey of ruleOrder) {
    const key = typeof rawKey === "string" ? rawKey.trim() : "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(key);
  }
  return next;
}

function normalizeEditableRuleOrderKeys(ruleOrder: string[] | undefined, editableRuleKeys: string[]): string[] {
  if (editableRuleKeys.length === 0) return [];
  const editableSet = new Set(editableRuleKeys);
  const cleaned = normalizeRuleOrderInput(ruleOrder);
  const next: string[] = [];
  const used = new Set<string>();

  for (const key of cleaned) {
    if (!editableSet.has(key) || used.has(key)) continue;
    used.add(key);
    next.push(key);
  }

  for (const key of editableRuleKeys) {
    if (used.has(key)) continue;
    used.add(key);
    next.push(key);
  }

  return next;
}

function normalizeFullRuleOrderKeys(ruleOrder: string[] | undefined, allRuleKeys: string[]): string[] {
  const allSet = new Set(allRuleKeys);
  return normalizeRuleOrderInput(ruleOrder).filter(
    (key) => allSet.has(key) || PRESET_MODULE_RULE_ORDER_KEY_SET.has(key)
  );
}

function applyEditableOnlyOrder(editableRuleKeys: string[], allRuleKeys: string[], editableOrder: string[]): string[] {
  const editableSet = new Set(editableRuleKeys);
  let editableIndex = 0;
  return allRuleKeys.map((key) => {
    if (!editableSet.has(key)) return key;
    const nextKey = editableOrder[editableIndex];
    editableIndex += 1;
    return nextKey ?? key;
  });
}

function getLegacyEditableRuleKeys(entries: GeneratedRuleEntry[]): string[] {
  return entries
    .filter((entry) => entry.kind === "custom-rule" || entry.kind === "custom-rule-set")
    .map((entry) => entry.key);
}

function usesFullRuleOrder(ruleOrder: string[] | undefined, editableRuleKeys: string[], allRuleKeys: string[]): boolean {
  const allSet = new Set([...allRuleKeys, ...PRESET_MODULE_RULE_ORDER_KEY_SET]);
  const editableSet = new Set(editableRuleKeys);
  return normalizeRuleOrderInput(ruleOrder).some((key) => allSet.has(key) && !editableSet.has(key));
}

/**
 * 把持久化顺序里缺失的内置规则插回规范位置：紧贴在它之后第一条已在顺序里的内置规则前面。
 *
 * 不能追加到末尾：末尾在 `GEOSITE,cn` 之后，那条规则会先吃掉所有国内域名，
 * 插回去的内置规则就永远命中不到。
 * 只认内置规则作锚点、插在后继之前，用户自己排好的自定义规则相对它们的先后不变。
 */
function insertPresetRuleAtCanonicalAnchor(orderedKeys: string[], presentKeys: Set<string>, key: string): boolean {
  const canonicalIndex = getCanonicalPresetRuleIndex();
  const index = canonicalIndex.get(key);
  if (index === undefined) return false;

  let successor: string | undefined;
  let successorIndex = Number.POSITIVE_INFINITY;
  for (const candidate of presentKeys) {
    const candidateIndex = canonicalIndex.get(candidate);
    if (candidateIndex === undefined || candidateIndex <= index || candidateIndex >= successorIndex) continue;
    successor = candidate;
    successorIndex = candidateIndex;
  }
  if (!successor) return false;

  orderedKeys.splice(orderedKeys.indexOf(successor), 0, key);
  return true;
}

function insertMissingEditableKeys(
  orderedKeys: string[],
  universeKeys: string[],
  editableRuleKeys: string[],
  missingEditableKeys: string[]
): void {
  const editableSet = new Set(editableRuleKeys);
  const firstEditableIndex = universeKeys.findIndex((key) => editableSet.has(key));

  for (let prevIndex = firstEditableIndex - 1; prevIndex >= 0; prevIndex -= 1) {
    const resultIndex = orderedKeys.indexOf(universeKeys[prevIndex]);
    if (resultIndex < 0) continue;
    orderedKeys.splice(resultIndex + 1, 0, ...missingEditableKeys);
    return;
  }

  for (let nextIndex = firstEditableIndex + missingEditableKeys.length; nextIndex < universeKeys.length; nextIndex += 1) {
    const resultIndex = orderedKeys.indexOf(universeKeys[nextIndex]);
    if (resultIndex < 0) continue;
    orderedKeys.splice(resultIndex, 0, ...missingEditableKeys);
    return;
  }

  orderedKeys.push(...missingEditableKeys);
}

export function hasFullRuleOrderKeys(ruleOrder: string[] | undefined): boolean {
  return normalizeRuleOrderInput(ruleOrder).some((key) => key.startsWith("module:") || key.startsWith("special:"));
}

type CanonicalRuleEntries = {
  preMatchEntries: GeneratedRuleEntry[];
  matchEntry: GeneratedRuleEntry;
};

/** 未挂在分组对象上的内置规则（GEO 兜底段的两条） */
const EXTRA_RULES_BY_KEY = new Map(BUILTIN_EXTRA_RULES.map((rule) => [rule.key, rule]));

function buildCanonicalRuleEntries(options: Omit<RulesGenerateOptions, "ruleOrder">): CanonicalRuleEntries {
  const {
    enabledModules,
    customRules,
    customRuleSets = [],
    customProxyGroups = [],
    chainGroups = [],
    builtinRuleEdits,
    proxyGroupNameOverrides,
    availablePolicyTargets,
    fallbackPolicyTarget,
    manualDomains,
    manualProcessRules = [],
    steamViaProxy = true,
    steamDownloadViaProxy = false,
  } = options;
  const entries: GeneratedRuleEntry[] = [];
  const enabledSet = new Set(enabledModules);
  const moduleNames = buildModuleNameMap(proxyGroupNameOverrides);
  const activeCustomProxyGroups = getEnabledCustomProxyGroups(customProxyGroups);
  const resolvePolicyTarget = createPolicyTargetResolver({ availablePolicyTargets, fallbackPolicyTarget });
  const editableEntries = buildOrderedEditableEntries(
    customRules.filter((rule) => !customTargetIsDisabled(rule.target, customProxyGroups)),
    customRuleSets.filter((ruleSet) => !customTargetIsDisabled(ruleSet.target, customProxyGroups)),
    undefined,
    moduleNames,
    activeCustomProxyGroups,
    chainGroups,
    resolvePolicyTarget
  );
  // Steam 路由开关：整组 Steam 规则的目标在「Steam 代理」和 DIRECT 之间切换
  const steamModuleName = moduleNames["steam"] ?? "";
  const steamRouteTarget = steamViaProxy ? steamModuleName : "DIRECT";
  const steamDownloadTarget = steamViaProxy && steamDownloadViaProxy ? steamModuleName : "DIRECT";
  const emittedRuleKeys = new Set<string>();
  let insertedEditableEntries = false;

  const pushEditableEntries = () => {
    if (insertedEditableEntries) return;
    insertedEditableEntries = true;
    // 脚本顺序：手动进程规则 → 手动域名三表 → 自定义完整规则/规则集
    for (const text of buildManualProcessRuleTexts(manualProcessRules)) {
      const target = "DIRECT";
      entries.push(
        buildSpecialRuleEntry(`manual-process:${text}`, text, text, resolvePolicyTarget(target))
      );
    }
    if (manualDomains) {
      const { texts } = buildManualDomainRuleTexts(manualDomains, {
        direct: moduleNames["cn"] ?? "国内直连",
        proxy: moduleNames["auto"] ?? "自动选择",
        reject: moduleNames["ad"] ?? "广告拦截",
      });
      for (const text of texts) {
        entries.push(buildSpecialRuleEntry(`manual-domain:${text}`, text, text, text.split(",")[2] ?? ""));
      }
    }
    if (editableEntries.length === 0) return;
    entries.push(...editableEntries);
  };
  for (const builtinKey of BUILTIN_RULE_ORDER) {
    // 自定义规则/规则集插在内置规则的「手动域名」位置（广告规则集之前）
    if (builtinKey === BUILTIN_CUSTOM_RULE_ANCHOR) pushEditableEntries();

    const [moduleId = "", ruleId = ""] = builtinKey.split(":");
    const module = MODULE_BY_ID.get(moduleId);
    if (!module) continue;

    // GEO 兜底段的两条规则不在分组对象上，用同一套键与目标解析规则补齐
    const extra = EXTRA_RULES_BY_KEY.get(builtinKey);
    const rule: ProxyGroupRule | undefined = extra
      ? { id: ruleId, name: extra.name, text: extra.text, noResolve: extra.noResolve }
      : module.rules.find((item) => item.id === ruleId);
    if (!rule) continue;

    // 分组关闭时它的规则不再生成；进程直连/本地回环这类「必须存在」的规则仍然保留
    const alwaysOn = rule.always === true;
    if (!alwaysOn && !enabledSet.has(moduleId)) continue;

    // Steam 规则的目标跟着两个开关走；其它分组用规则自身的 policyTarget / 组名
    const steamTarget =
      moduleId === BUILTIN_MODULE_IDS.steam
        ? rule.downloadCdn
          ? steamDownloadTarget
          : steamRouteTarget
        : undefined;
    const entry = buildModuleRuleEntry(
      module,
      rule,
      builtinRuleEdits,
      proxyGroupNameOverrides,
      activeCustomProxyGroups,
      chainGroups,
      resolvePolicyTarget,
      steamTarget
    );
    if (emittedRuleKeys.has(entry.key)) continue;
    emittedRuleKeys.add(entry.key);
    entries.push(entry);
  }

  pushEditableEntries();

  // 兜底出口固定是「手动选择」：只有它没开启/被筛掉时才退回生成期兜底目标
  const selectTarget = resolveModuleName(BUILTIN_MODULE_IDS.select, proxyGroupNameOverrides);
  const finalTarget = resolvePolicyTarget(
    enabledSet.has(BUILTIN_MODULE_IDS.select) ? selectTarget : fallbackPolicyTarget ?? selectTarget
  );
  return {
    preMatchEntries: entries,
    matchEntry: buildSpecialRuleEntry("special:match", `MATCH,${finalTarget}`, "MATCH", finalTarget),
  };
}

export function normalizePersistedRuleOrder(options: RulesGenerateOptions): string[] {
  const { preMatchEntries } = buildCanonicalRuleEntries({
    enabledModules: options.enabledModules,
    customRules: options.customRules,
    customRuleSets: options.customRuleSets,
    customProxyGroups: options.customProxyGroups,
    builtinRuleEdits: options.builtinRuleEdits,
    proxyGroupNameOverrides: options.proxyGroupNameOverrides,
    availablePolicyTargets: options.availablePolicyTargets,
    fallbackPolicyTarget: options.fallbackPolicyTarget,
    manualDomains: options.manualDomains,
    manualProcessRules: options.manualProcessRules,
    steamViaProxy: options.steamViaProxy,
    steamDownloadViaProxy: options.steamDownloadViaProxy,
  });

  const allRuleKeys = preMatchEntries.map((entry) => entry.key).filter((key) => !key.startsWith("manual-"));
  const editableRuleKeys = getLegacyEditableRuleKeys(preMatchEntries);
  const cleaned = normalizeRuleOrderInput(options.ruleOrder);
  if (cleaned.length === 0) return [];

  if (usesFullRuleOrder(cleaned, editableRuleKeys, allRuleKeys)) {
    return normalizeFullRuleOrderKeys(cleaned, allRuleKeys);
  }

  return normalizeEditableRuleOrderKeys(cleaned, editableRuleKeys);
}

/**
 * 覆盖全部模块的完整规则顺序：所有内置规则（含未开启模块与已停用的）+ 自定义规则/规则集 + 系统规则。
 *
 * 结果与哪些分组开启无关，所以在界面上开关分组不会打乱其他规则的位置；
 * 可视化编辑保存时整体写回 `ruleOrder`，之后再开启的分组直接落在自己的位置上。
 * 实际生效的顺序是它按当前开启状态过滤后的子序列（见 `resolveAppliedRuleOrder`）。
 */
export function resolveFullRuleOrder(options: RulesGenerateOptions): string[] {
  const { preMatchEntries } = buildCanonicalRuleEntries({ ...options, enabledModules: ALL_MODULE_IDS });
  const manualKeys = preMatchEntries.map((entry) => entry.key).filter((key) => key.startsWith("manual-"));
  const universeKeys = preMatchEntries.map((entry) => entry.key).filter((key) => !key.startsWith("manual-"));
  const editableRuleKeys = getLegacyEditableRuleKeys(preMatchEntries);
  const persistedOrder = normalizePersistedRuleOrder(options);

  const withManualKeys = (keys: string[]) => {
    if (manualKeys.length === 0) return keys;
    const anchorIndex = keys.indexOf("module:ad:ad-set");
    const next = [...keys];
    next.splice(anchorIndex >= 0 ? anchorIndex : next.length, 0, ...manualKeys);
    return next;
  };

  if (persistedOrder.length === 0) {
    return withManualKeys(universeKeys);
  }

  if (!usesFullRuleOrder(persistedOrder, editableRuleKeys, universeKeys)) {
    return withManualKeys(
      applyEditableOnlyOrder(
        editableRuleKeys,
        universeKeys,
        normalizeEditableRuleOrderKeys(persistedOrder, editableRuleKeys)
      )
    );
  }

  const universeSet = new Set(universeKeys);
  const next = persistedOrder.filter((key) => universeSet.has(key));
  const present = new Set(next);
  const missingEditableKeys = editableRuleKeys.filter((key) => !present.has(key));

  if (missingEditableKeys.length > 0) {
    insertMissingEditableKeys(next, universeKeys, editableRuleKeys, missingEditableKeys);
    missingEditableKeys.forEach((key) => present.add(key));
  }

  for (const key of universeKeys) {
    if (present.has(key)) continue;
    if (!insertPresetRuleAtCanonicalAnchor(next, present, key)) next.push(key);
    present.add(key);
  }
  // 手动域名/进程规则位置由生成器固定（广告规则集之前），不参与可视化排序
  if (manualKeys.length > 0) {
    const anchorIndex = next.indexOf("module:ad:ad-set");
    next.splice(anchorIndex >= 0 ? anchorIndex : next.length, 0, ...manualKeys);
  }

  return next;
}

export function resolveAppliedRuleOrder(options: RulesGenerateOptions): string[] {
  const { preMatchEntries } = buildCanonicalRuleEntries(options);
  const activeRuleKeySet = new Set(
    preMatchEntries.filter((entry) => entry.enabled !== false).map((entry) => entry.key)
  );
  return resolveFullRuleOrder(options).filter((key) => activeRuleKeySet.has(key));
}

export interface RuleOrderView {
  /** 已开启模块的全部内置规则（含已停用的）与自定义条目，按最终顺序排列 */
  entries: GeneratedRuleEntry[];
  matchEntry: GeneratedRuleEntry;
  /** 覆盖全部模块的完整顺序，可视化编辑保存时整体写回 `ruleOrder` */
  fullOrder: string[];
}

/** 给可视化编辑用：停用的内置规则也留在原位，便于就地重新启用 */
export function buildRuleOrderView(options: RulesGenerateOptions): RuleOrderView {
  const { preMatchEntries, matchEntry } = buildCanonicalRuleEntries(options);
  const fullOrder = resolveFullRuleOrder(options);
  const byKey = new Map(preMatchEntries.map((entry) => [entry.key, entry]));
  const entries = fullOrder
    .map((key) => byKey.get(key))
    .filter((entry): entry is GeneratedRuleEntry => Boolean(entry));
  return { entries, matchEntry, fullOrder };
}

export function buildGeneratedRuleEntries(options: RulesGenerateOptions): GeneratedRuleEntry[] {
  const { preMatchEntries, matchEntry } = buildCanonicalRuleEntries({
    enabledModules: options.enabledModules,
    customRules: options.customRules,
    customRuleSets: options.customRuleSets,
    customProxyGroups: options.customProxyGroups,
    chainGroups: options.chainGroups,
    builtinRuleEdits: options.builtinRuleEdits,
    proxyGroupNameOverrides: options.proxyGroupNameOverrides,
    availablePolicyTargets: options.availablePolicyTargets,
    fallbackPolicyTarget: options.fallbackPolicyTarget,
    manualDomains: options.manualDomains,
    manualProcessRules: options.manualProcessRules,
    steamViaProxy: options.steamViaProxy,
    steamDownloadViaProxy: options.steamDownloadViaProxy,
  });
  const orderKeys = resolveAppliedRuleOrder(options);
  const byKey = new Map(preMatchEntries.map((entry) => [entry.key, entry]));
  const orderedEntries = orderKeys
    .map((key) => byKey.get(key))
    .filter((entry): entry is GeneratedRuleEntry => Boolean(entry?.enabled));

  return [...orderedEntries, matchEntry];
}

export function generateRules(options: RulesGenerateOptions): string[] {
  return buildGeneratedRuleEntries(options).map((entry) => entry.text);
}

/** 供 index.ts 判断内置规则键是否仍然存在（未知键在解析配置时被拒绝） */
export function isBuiltinRuleKey(key: string): boolean {
  return PRESET_MODULE_RULE_ORDER_KEY_SET.has(key) || EXTRA_RULES_BY_KEY.has(key.replace(/^module:/, ""));
}