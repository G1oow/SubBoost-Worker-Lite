/**
 * 「生成配置 → 链式代理」可视化编辑的纯逻辑。
 *
 * 草稿仍然是一份原始配置对象：这里的函数只读写顶层 `proxyChains`，其余字段
 * （包括旧的 `dialerProxyGroups`）原样透传，本页对它只读。
 *
 * 写回时按「默认值不落盘」处理：`enabled` 为真、组类型等于默认值、空正则与空测速
 * 地址都不写进 JSON。这样「关掉再打开」「改回默认类型」不会和已保存配置产生等价
 * 但换写法的 diff。链条目内部的未知字段在本页编辑时会被规范化丢掉（core 的
 * `ProxyChain` schema 是固定的，真要写别的字段请用高级 JSON）。
 *
 * 组名规则与生成器一致：出口组名 = `name`，前置组名 = `${name} · 前置`
 * （直接复用 core 的 `chainRelayGroupName`，避免两边后缀漂移）。
 */
import { CHAIN_RELAY_GROUP_SUFFIX, chainRelayGroupName } from "@subboost/core/subscription/chain-nodes";
import {
  isProxyGroupGroupType,
  type ChainSelector,
  type ProxyChain,
  type ProxyGroupGroupType,
} from "@subboost/core/types/config";
import type { ConfigRecord } from "./rule-editor";
import type { ConfigPreviewChain } from "./types";

export type { ConfigRecord };
export { CHAIN_RELAY_GROUP_SUFFIX };

/** 配置里的顶层字段名 */
export const CHAINS_FIELD = "proxyChains";

export const DEFAULT_EXIT_GROUP_TYPE: ProxyGroupGroupType = "select";
export const DEFAULT_RELAY_GROUP_TYPE: ProxyGroupGroupType = "url-test";
export const DEFAULT_CHAIN_NAME_PREFIX = "链式代理";

/** 组类型下拉：顺序与 core 的 PROXY_GROUP_GROUP_TYPES 一致 */
export const CHAIN_GROUP_TYPE_OPTIONS: ReadonlyArray<{ value: ProxyGroupGroupType; label: string }> = [
  { value: "select", label: "select · 手动选择" },
  { value: "url-test", label: "url-test · 自动测速" },
  { value: "fallback", label: "fallback · 故障转移" },
  { value: "load-balance", label: "load-balance · 负载均衡" },
  { value: "direct-first", label: "direct-first · 优先直连" },
  { value: "reject-first", label: "reject-first · 优先拒绝" },
];

// ---------------------------------------------------------------------------
// 读取：对残缺数据宽容
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 去空白、去重，保持出现顺序 */
function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = readString(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function normalizeGroupType(value: unknown, fallback: ProxyGroupGroupType): ProxyGroupGroupType {
  return isProxyGroupGroupType(value) ? value : fallback;
}

/** 选择器：`sourceIds` 永远存在，空正则不落字段 */
export function readChainSelector(value: unknown): ChainSelector {
  const record = isRecord(value) ? value : {};
  const selector: ChainSelector = { sourceIds: readStringList(record.sourceIds) };
  const include = readString(record.includeRegex);
  if (include) selector.includeRegex = include;
  const exclude = readString(record.excludeRegex);
  if (exclude) selector.excludeRegex = exclude;
  return selector;
}

/** 缺 id / id 重复时补一个稳定的兜底 id，界面拿它当 key 与预览状态的对照键 */
function dedupeId(base: string, used: Set<string>): string {
  let id = base;
  for (let suffix = 2; used.has(id); suffix += 1) id = `${base}-${suffix}`;
  used.add(id);
  return id;
}

function readChain(item: unknown, index: number, usedIds: Set<string>): ProxyChain | null {
  if (!isRecord(item)) return null;
  const id = dedupeId(readString(item.id) || `chain-${index + 1}`, usedIds);
  const chain: ProxyChain = {
    id,
    name: readString(item.name),
    enabled: item.enabled !== false,
    relay: readChainSelector(item.relay),
    landing: readChainSelector(item.landing),
    exitGroupType: normalizeGroupType(item.exitGroupType, DEFAULT_EXIT_GROUP_TYPE),
    relayGroupType: normalizeGroupType(item.relayGroupType, DEFAULT_RELAY_GROUP_TYPE),
  };
  const testUrl = readString(item.testUrl);
  if (testUrl) chain.testUrl = testUrl;
  return chain;
}

/** 读 `proxyChains`：非数组当空；条目缺字段补默认；不是对象的条目直接忽略 */
export function readChains(config: ConfigRecord): ProxyChain[] {
  const raw = config[CHAINS_FIELD];
  if (!Array.isArray(raw)) return [];
  const usedIds = new Set<string>();
  const chains: ProxyChain[] = [];
  raw.forEach((item, index) => {
    const chain = readChain(item, index, usedIds);
    if (chain) chains.push(chain);
  });
  return chains;
}

// ---------------------------------------------------------------------------
// 写回：默认值不落盘，没有链就删掉字段
// ---------------------------------------------------------------------------

function writeChainSelector(selector: ChainSelector | undefined): ChainSelector {
  const next: ChainSelector = { sourceIds: readStringList(selector?.sourceIds) };
  const include = readString(selector?.includeRegex);
  if (include) next.includeRegex = include;
  const exclude = readString(selector?.excludeRegex);
  if (exclude) next.excludeRegex = exclude;
  return next;
}

function writeChain(chain: ProxyChain): ProxyChain {
  const next: ProxyChain = {
    id: chain.id,
    name: chain.name.trim(),
    relay: writeChainSelector(chain.relay),
    landing: writeChainSelector(chain.landing),
  };
  if (chain.enabled === false) next.enabled = false;
  const exitGroupType = normalizeGroupType(chain.exitGroupType, DEFAULT_EXIT_GROUP_TYPE);
  if (exitGroupType !== DEFAULT_EXIT_GROUP_TYPE) next.exitGroupType = exitGroupType;
  const relayGroupType = normalizeGroupType(chain.relayGroupType, DEFAULT_RELAY_GROUP_TYPE);
  if (relayGroupType !== DEFAULT_RELAY_GROUP_TYPE) next.relayGroupType = relayGroupType;
  const testUrl = readString(chain.testUrl);
  if (testUrl) next.testUrl = testUrl;
  return next;
}

/** 把链列表写回配置；一条都没有时删掉字段，不留空数组残留 */
export function writeChains(config: ConfigRecord, chains: readonly ProxyChain[]): ConfigRecord {
  if (chains.length === 0) {
    const { [CHAINS_FIELD]: _previous, ...rest } = config;
    return rest;
  }
  return { ...config, [CHAINS_FIELD]: chains.map(writeChain) };
}

// ---------------------------------------------------------------------------
// 新建
// ---------------------------------------------------------------------------

/**
 * 新链 id。与 core 的 `createCustomRuleId` 同一套写法（时间戳 + 6 位随机后缀），
 * 只是前缀换成 `chain`：不依赖数组下标，挪动/删除都不会漂移。
 */
export function createChainId(usedIds: Iterable<string> = []): string {
  const used = new Set(usedIds);
  let id = `chain-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  while (used.has(id)) id = `chain-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return id;
}

/** 默认名「链式代理 N」，N 取当前没被占用的最小序号 */
export function nextChainName(existing: readonly ProxyChain[] = []): string {
  const used = new Set(existing.map((chain) => chain.name.trim()).filter(Boolean));
  for (let index = 1; index <= used.size + 1; index += 1) {
    const name = `${DEFAULT_CHAIN_NAME_PREFIX} ${index}`;
    if (!used.has(name)) return name;
  }
  return `${DEFAULT_CHAIN_NAME_PREFIX} ${used.size + 1}`;
}

/** 新建一条链：默认名、两个空选择器（= 全部已启用源）、默认组类型 */
export function createChain(existing: readonly ProxyChain[] = []): ProxyChain {
  return {
    id: createChainId(existing.map((chain) => chain.id)),
    name: nextChainName(existing),
    enabled: true,
    relay: { sourceIds: [] },
    landing: { sourceIds: [] },
    exitGroupType: DEFAULT_EXIT_GROUP_TYPE,
    relayGroupType: DEFAULT_RELAY_GROUP_TYPE,
  };
}

// ---------------------------------------------------------------------------
// 列表操作：都返回新数组
// ---------------------------------------------------------------------------

export function moveChain<T extends ProxyChain>(list: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (!Number.isInteger(index) || !Number.isInteger(delta) || target < 0 || target >= list.length) {
    return [...list];
  }
  const next = [...list];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

export function toggleChain<T extends ProxyChain>(list: readonly T[], id: string, enabled: boolean): T[] {
  return list.map((chain) => (chain.id === id ? { ...chain, enabled } : chain));
}

export function removeChain<T extends ProxyChain>(list: readonly T[], id: string): T[] {
  return list.filter((chain) => chain.id !== id);
}

export function patchChain<T extends ProxyChain>(list: readonly T[], id: string, patch: Partial<ProxyChain>): T[] {
  return list.map((chain) => (chain.id === id ? { ...chain, ...patch } : chain));
}

export type ChainSelectorSide = "relay" | "landing";

/** 只改某一个选择器：`sourceIds`、`includeRegex`、`excludeRegex` 都可以单独改 */
export function patchChainSelector<T extends ProxyChain>(
  list: readonly T[],
  id: string,
  side: ChainSelectorSide,
  patch: Partial<ChainSelector>
): T[] {
  return list.map((chain) =>
    chain.id === id ? { ...chain, [side]: { ...chain[side], ...patch } } : chain
  );
}

/** 切换某个选择器里的一条源（`sourceIds` 为空表示全部已启用源） */
export function toggleChainSource<T extends ProxyChain>(
  list: readonly T[],
  id: string,
  side: ChainSelectorSide,
  sourceId: string
): T[] {
  return list.map((chain) => {
    if (chain.id !== id) return chain;
    const current = chain[side];
    const has = current.sourceIds.includes(sourceId);
    const sourceIds = has
      ? current.sourceIds.filter((item) => item !== sourceId)
      : [...current.sourceIds, sourceId];
    return { ...chain, [side]: { ...current, sourceIds } };
  });
}

// ---------------------------------------------------------------------------
// 本地校验
// ---------------------------------------------------------------------------

export type ChainValidation = {
  /** 空名：出口组名就是链名，不能留空 */
  nameError: string | null;
  /** 出口组/前置组与其他链生成的组名重复（生成时这条链会被跳过） */
  nameConflictError: string | null;
  relayIncludeError: string | null;
  relayExcludeError: string | null;
  landingIncludeError: string | null;
  landingExcludeError: string | null;
  ok: boolean;
};

/** 编译正则；空值与非法值都返回 null / 可读错误，绝不抛异常 */
export function compileChainRegex(pattern: string | undefined, label: string): string | null {
  const raw = typeof pattern === "string" ? pattern.trim() : "";
  if (!raw) return null;
  try {
    new RegExp(raw, "i");
    return null;
  } catch {
    return `${label}不是有效的正则表达式`;
  }
}

/** 出口组名与前置组名：与生成器同一套规则 */
export function chainGroupNames(chain: Pick<ProxyChain, "name">): { exitGroupName: string; relayGroupName: string } {
  const name = chain.name.trim();
  return { exitGroupName: name, relayGroupName: chainRelayGroupName(name) };
}

/**
 * 单条链的本地校验。重名只看「其他链会生成的组名」：出口组与前置组同名在非空链名
 * 下不可能出现（前缀后缀不同），真正会撞的是两条链取名相同或一条链取成了
 * 「X · 前置」而另一条叫 X。
 */
export function validateChain(chain: ProxyChain, all: readonly ProxyChain[] = []): ChainValidation {
  const name = chain.name.trim();
  const relayIncludeError = compileChainRegex(chain.relay?.includeRegex, "前置 · 匹配正则 ");
  const relayExcludeError = compileChainRegex(chain.relay?.excludeRegex, "前置 · 排除正则 ");
  const landingIncludeError = compileChainRegex(chain.landing?.includeRegex, "落地 · 匹配正则 ");
  const landingExcludeError = compileChainRegex(chain.landing?.excludeRegex, "落地 · 排除正则 ");

  const taken = new Set<string>();
  for (const other of all) {
    if (other.id === chain.id) continue;
    const otherName = other.name.trim();
    if (!otherName) continue;
    taken.add(otherName);
    taken.add(chainRelayGroupName(otherName));
  }
  const { exitGroupName, relayGroupName } = chainGroupNames(chain);
  const conflict =
    name !== "" && (taken.has(exitGroupName) || taken.has(relayGroupName) || exitGroupName === relayGroupName);
  const nameConflictError = conflict
    ? `组名「${name}」与其他链生成的组名重复，生成时这条链会被跳过`
    : null;
  const nameError = name === "" ? "请填写链名：它就是出口组名，不能留空" : null;

  return {
    nameError,
    nameConflictError,
    relayIncludeError,
    relayExcludeError,
    landingIncludeError,
    landingExcludeError,
    ok:
      nameError === null &&
      nameConflictError === null &&
      relayIncludeError === null &&
      relayExcludeError === null &&
      landingIncludeError === null &&
      landingExcludeError === null,
  };
}

// ---------------------------------------------------------------------------
// 与服务端预览合并
// ---------------------------------------------------------------------------

export type ChainWithPreview = {
  chain: ProxyChain;
  /** 预览里没有这条链（新增或刚改过、还没重新校验）时为 null */
  preview: ConfigPreviewChain | null;
};

/** 按 id 把预览状态贴回每条链；预览里没有的条目视为「未预览」 */
export function mergePreviewStatus(
  chains: readonly ProxyChain[],
  previewChains: readonly ConfigPreviewChain[] | null | undefined
): ChainWithPreview[] {
  const byId = new Map<string, ConfigPreviewChain>();
  for (const entry of previewChains ?? []) {
    if (entry && typeof entry.id === "string" && entry.id) byId.set(entry.id, entry);
  }
  return chains.map((chain) => ({ chain, preview: byId.get(chain.id) ?? null }));
}

export type ChainStatusTone = "ok" | "warning" | "danger" | "muted";

export type ChainStatusMeta = { label: string; description: string; tone: ChainStatusTone };

/** 预览状态 → 中文文案（与服务端 ProxyChainStatus 一一对应） */
export const CHAIN_STATUS_META: Record<ConfigPreviewChain["status"], ChainStatusMeta> = {
  ok: {
    label: "正常",
    description: "前置与落地都有节点，两个组都会生成。",
    tone: "ok",
  },
  "empty-relay": {
    label: "前置无节点，落地不可用",
    description: "前置组只放 REJECT，这条链的落地节点暂时选不了。",
    tone: "warning",
  },
  "empty-landing": {
    label: "落地无节点，不生成",
    description: "落地选择器没匹配到任何节点，整条链不会写进配置。",
    tone: "danger",
  },
  disabled: {
    label: "已停用",
    description: "这条链不会生成。",
    tone: "muted",
  },
  "invalid-regex": {
    label: "正则无效",
    description: "include/exclude 正则编译失败，这条链不会生成。",
    tone: "danger",
  },
  "name-conflict": {
    label: "组名冲突",
    description: "组名与既有分组或其他链重复，这条链会被跳过。",
    tone: "danger",
  },
  invalid: {
    label: "配置不完整",
    description: "缺少 id 或链名，这条链不会生成。",
    tone: "danger",
  },
};

export const UNPREVIEWED_STATUS_META: ChainStatusMeta = {
  label: "未预览",
  description: "还没有服务端预览结果。",
  tone: "muted",
};

export function chainStatusMeta(status: ConfigPreviewChain["status"] | null | undefined): ChainStatusMeta {
  return status ? CHAIN_STATUS_META[status] ?? UNPREVIEWED_STATUS_META : UNPREVIEWED_STATUS_META;
}

// ---------------------------------------------------------------------------
// 旧中转组（只读展示）
// ---------------------------------------------------------------------------

export type LegacyDialerGroup = {
  id: string;
  name: string;
  enabled: boolean;
  type: string;
  relayCount: number;
  targetCount: number;
};

/** 旧的 `dialerProxyGroups`：本页只读，编辑走高级 JSON */
export function readLegacyDialerGroups(config: ConfigRecord): LegacyDialerGroup[] {
  const raw = config.dialerProxyGroups;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index): LegacyDialerGroup | null => {
      if (!isRecord(item)) return null;
      return {
        id: readString(item.id) || `dialer-${index + 1}`,
        name: readString(item.name),
        enabled: item.enabled !== false,
        type: readString(item.type) || "select",
        relayCount: readStringList(item.relayNodes).length,
        targetCount: readStringList(item.targetNodes).length,
      };
    })
    .filter((item): item is LegacyDialerGroup => Boolean(item));
}
