import type { BuiltinRuleEdits, CustomRule, CustomRuleSet, ProxyGroupRuleTarget } from "@subboost/core/types/config";
import type { CustomProxyGroup } from "@subboost/core/types/config";
import { getCustomRuleOrderKey } from "@subboost/core/rules/custom-rule-utils";
import { resolveProxyGroupModuleName } from "@subboost/core/proxy-group-name";
import { resolveProxyGroupTargetName, type ChainGroupRef } from "@subboost/core/proxy-group-targets";
import { PROXY_GROUP_MODULES, type ProxyGroupModule, type ProxyGroupRule } from "./proxy-group-modules";
import { getEffectiveModuleRules, getModuleRuleOrderKey } from "./module-rules";
import { createPolicyTargetResolver } from "./policy-targets";

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
  experimentalCnUseCnRuleSet?: boolean;
  cnIpNoResolve?: boolean;
  ruleOrder?: string[];
  availablePolicyTargets?: string[];
  fallbackPolicyTarget?: string;
}

export const EXPERIMENTAL_CN_RULE: ProxyGroupRule = {
  id: "cn",
  name: "国内域名 (完整)",
  behavior: "domain",
  path: "geosite/cn.mrs",
};

/**
 * 规则生成顺序（按自上而下、首次命中即停原则）
 *
 * ⚠️ 顺序非常重要！子域名/特定服务必须在通用服务之前：
 * - 私有网络和高置信国内规则在服务父规则前，避免国内子服务被父规则抢先命中
 * - Gemini 在 AI/谷歌前（Gemini 用谷歌域名）
 * - 油管视频在谷歌前（YouTube 是谷歌子域名）
 * - 谷歌学术在谷歌前（谷歌学术属于谷歌域名）
 * - cn 完整域名规则是低置信补充，仍通过 special:experimental-cn 后置到 geolocation-!cn 之后
 */
const RULE_ORDER: string[] = [
  "ad",
  "private",
  "gemini",
  "ai",
  "cn",
  "youtube",
  "google-scholar",
  "education",
  "cloud",
  "google",
  "telegram",
  "github",
  "microsoft",
  "apple",
  "twitter",
  "meta",
  "discord",
  "social-other",
  "netflix",
  "disney",
  "streaming-west",
  "streaming-asia",
  "steam",
  "gaming-pc",
  "gaming-console",
  "dev-tools",
  "storage",
  "payment",
  "crypto",
  "news",
  "shopping",
  "adult",
  "global",
];

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

const PRESET_MODULE_RULE_ORDER_KEYS = PROXY_GROUP_MODULES.flatMap((module) =>
  module.rules.map((rule) => getModuleRuleOrderKey(module.id, rule.id))
);
const PRESET_MODULE_RULE_ORDER_KEY_SET = new Set(PRESET_MODULE_RULE_ORDER_KEYS);
const ALL_MODULE_IDS = PROXY_GROUP_MODULES.map((module) => module.id);

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

function buildModuleRuleEntry(
  module: ProxyGroupModule,
  rule: ProxyGroupRule,
  builtinRuleEdits?: BuiltinRuleEdits,
  proxyGroupNameOverrides?: Record<string, string>,
  cnIpNoResolve?: boolean,
  customProxyGroups: CustomProxyGroup[] = [],
  chainGroups: ChainGroupRef[] = [],
  resolvePolicyTarget: (target: string) => string = (target) => target
): GeneratedRuleEntry {
  const key = getModuleRuleOrderKey(module.id, rule.id);
  const edit = builtinRuleEdits?.[key];
  const defaultTarget = resolveModuleNameFromModule(module, proxyGroupNameOverrides);
  const moduleNames = buildModuleNameMap(proxyGroupNameOverrides);
  const targetName = resolveProxyGroupTargetName(edit?.target || defaultTarget, {
    moduleNames,
    customProxyGroups,
    chainGroups,
    fallbackTarget: defaultTarget,
  });
  const target = resolvePolicyTarget(targetName);
  const noResolve =
    module.id === "cn" && rule.id === "cn-ip" && typeof cnIpNoResolve === "boolean"
      ? cnIpNoResolve
      : Boolean(rule.noResolve);
  let text = `RULE-SET,${rule.id},${target}`;
  if (noResolve) text += ",no-resolve";

  return {
    key,
    text,
    kind: "module",
    sourceLabel: defaultTarget,
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
  const allSet = new Set([...allRuleKeys, ...PRESET_MODULE_RULE_ORDER_KEYS]);
  const editableSet = new Set(editableRuleKeys);
  return normalizeRuleOrderInput(ruleOrder).some((key) => allSet.has(key) && !editableSet.has(key));
}

/**
 * 把持久化顺序里缺失的内置规则插回规范位置：紧贴在它之后第一条已在顺序里的内置规则前面。
 *
 * 不能追加到末尾：末尾在 `geolocation-!cn` 之后，那条规则会先吃掉所有境外域名，
 * 后开启模块的规则（或新版本新增的预设规则）就永远命中不到。
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

function buildCanonicalRuleEntries(options: Omit<RulesGenerateOptions, "ruleOrder">): CanonicalRuleEntries {
  const {
    enabledModules,
    customRules,
    customRuleSets = [],
    customProxyGroups = [],
    chainGroups = [],
    builtinRuleEdits,
    proxyGroupNameOverrides,
    experimentalCnUseCnRuleSet,
    cnIpNoResolve,
    availablePolicyTargets,
    fallbackPolicyTarget,
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
  const emittedRuleKeys = new Set<string>();
  let insertedEditableEntries = false;

  const pushEditableEntries = () => {
    if (insertedEditableEntries || editableEntries.length === 0) return;
    insertedEditableEntries = true;
    entries.push(...editableEntries);
  };

  const pushModuleRuleEntry = (module: ProxyGroupModule, rule: ProxyGroupRule) => {
    const entry = buildModuleRuleEntry(
      module,
      rule,
      builtinRuleEdits,
      proxyGroupNameOverrides,
      cnIpNoResolve,
      activeCustomProxyGroups,
      chainGroups,
      resolvePolicyTarget
    );
    if (emittedRuleKeys.has(entry.key)) return;
    emittedRuleKeys.add(entry.key);
    entries.push(entry);
  };

  const pushAppleTvPlusAtCanonicalPosition = () => {
    if (!enabledSet.has("streaming-west")) return;
    const streamingWestModule = PROXY_GROUP_MODULES.find((item) => item.id === "streaming-west");
    if (!streamingWestModule) return;

    const appleTvPlusRule = streamingWestModule.rules.find((rule) => rule.id === "apple-tvplus");
    if (!appleTvPlusRule) return;

    // Keep the existing generated order without turning Apple TV+ into a special system rule.
    pushModuleRuleEntry(streamingWestModule, appleTvPlusRule);
  };

  const processedModules = new Set<string>();

  for (const moduleId of RULE_ORDER) {
    if (!insertedEditableEntries && moduleId === "gemini") {
      pushEditableEntries();
    }

    if (moduleId === "apple") {
      pushAppleTvPlusAtCanonicalPosition();
    }

    if (!enabledSet.has(moduleId)) continue;
    processedModules.add(moduleId);

    const ruleModule = PROXY_GROUP_MODULES.find((item) => item.id === moduleId);
    if (!ruleModule) continue;

    for (const rule of ruleModule.rules) {
      pushModuleRuleEntry(ruleModule, rule);
    }
  }

  for (const ruleModule of PROXY_GROUP_MODULES) {
    if (!enabledSet.has(ruleModule.id)) continue;
    if (processedModules.has(ruleModule.id)) continue;
    if (ruleModule.id === "final") continue;

    for (const rule of ruleModule.rules) {
      pushModuleRuleEntry(ruleModule, rule);
    }
  }

  pushEditableEntries();

  if (Boolean(experimentalCnUseCnRuleSet) && enabledSet.has("cn")) {
    const target = resolvePolicyTarget(resolveModuleName("cn", proxyGroupNameOverrides));
    entries.push(
      buildSpecialRuleEntry("special:experimental-cn", `RULE-SET,${EXPERIMENTAL_CN_RULE.id},${target}`, EXPERIMENTAL_CN_RULE.name, target)
    );
  }

  const finalTarget = resolvePolicyTarget(
    enabledSet.has("final")
      ? resolveModuleName("final", proxyGroupNameOverrides)
      : fallbackPolicyTarget ?? resolveModuleName("select", proxyGroupNameOverrides)
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
    experimentalCnUseCnRuleSet: options.experimentalCnUseCnRuleSet,
    cnIpNoResolve: options.cnIpNoResolve,
    availablePolicyTargets: options.availablePolicyTargets,
    fallbackPolicyTarget: options.fallbackPolicyTarget,
  });

  const allRuleKeys = preMatchEntries.map((entry) => entry.key);
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
 * 结果与开启了哪些模块无关（实验性 cn 规则除外），所以在界面上开关模块不会打乱其他规则的位置；
 * 可视化编辑保存时整体写回 `ruleOrder`，之后再开启的模块直接落在自己的位置上。
 * 实际生效的顺序是它按当前开启状态过滤后的子序列（见 `resolveAppliedRuleOrder`）。
 */
export function resolveFullRuleOrder(options: RulesGenerateOptions): string[] {
  const { preMatchEntries } = buildCanonicalRuleEntries({ ...options, enabledModules: ALL_MODULE_IDS });
  const universeKeys = preMatchEntries.map((entry) => entry.key);
  const editableRuleKeys = getLegacyEditableRuleKeys(preMatchEntries);
  const persistedOrder = normalizePersistedRuleOrder(options);

  if (persistedOrder.length === 0) {
    return universeKeys;
  }

  if (!usesFullRuleOrder(persistedOrder, editableRuleKeys, universeKeys)) {
    return applyEditableOnlyOrder(
      editableRuleKeys,
      universeKeys,
      normalizeEditableRuleOrderKeys(persistedOrder, editableRuleKeys)
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
    experimentalCnUseCnRuleSet: options.experimentalCnUseCnRuleSet,
    cnIpNoResolve: options.cnIpNoResolve,
    availablePolicyTargets: options.availablePolicyTargets,
    fallbackPolicyTarget: options.fallbackPolicyTarget,
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
