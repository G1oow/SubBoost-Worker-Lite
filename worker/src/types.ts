import type { ParsedNode } from "@subboost/core/types/node";
import type { SubscriptionResponseInfo } from "@subboost/core/subscription/subscription-response-info";

// KV key 常量
export const KEY_SOURCES = "meta:sources";
export const KEY_SUBS = "meta:subs";
export const KEY_CONFIG = "meta:config";
export const KEY_STATUS = "meta:status";
export const KEY_LOCK = "meta:refresh-lock";

// TTL（秒）
export const TTL_SNAPSHOT = 604800; // 7 天
export const TTL_CACHE = 172800; // 48 小时
export const TTL_LOCK = 600; // 10 分钟

// 业务上限
export const MAX_SOURCES = 50;
export const MAX_SUBSCRIPTIONS = 20;
export const MAX_SOURCE_NAME_LENGTH = 80;
export const MAX_NODE_NAME_LENGTH = 120;
export const MAX_NODE_RENAMES = 4000;
export const MAX_PREVIEW_NODES = 500;
export const MAX_USER_AGENT_LENGTH = 200;
export const MAX_MANUAL_TEXT_BYTES = 512 * 1024;
export const MAX_PARSE_ERRORS = 20;
export const REFRESH_CONCURRENCY = 4;
export const REFRESH_SOFT_DEADLINE_MS = 12 * 60 * 1000;
/**
 * 订阅按需生成（客户端拉取且无缓存）时的抓取预算。
 * 客户端有连接超时，不能像定时刷新那样等 12 分钟：
 * 超过这个时间就不再发起新的抓取，用已有快照先返回可用的 YAML。
 */
export const ON_DEMAND_SOFT_DEADLINE_MS = 20 * 1000;
/** 按需生成时的抓取并发上限，与 Workers 同时 6 连接的限制对齐 */
export const ON_DEMAND_CONCURRENCY = 6;

export type SourceKind = "remote" | "manual";

export type SourceInput = {
  // 全量替换保存时携带既有 id，可保留该源的快照；缺省视为新建
  id?: string;
  name: string;
  kind: SourceKind;
  url?: string;
  manualText?: string;
  enabled?: boolean;
  userAgent?: string;
  // 节点显示名覆盖表（key 见 nodeRenameKey）
  nodeRenames?: NodeRenames;
};

export type SourceDto = {
  id: string;
  name: string;
  kind: SourceKind;
  url?: string;
  manualText?: string;
  enabled: boolean;
  userAgent?: string;
  nodeRenames?: NodeRenames;
  createdAt: string;
  updatedAt: string;
};

/**
 * 源的轻量视图：只含订阅生成需要的路由信息，不含解密后的 URL / 节点文本。
 * 用于缓存命中路径，避免为了判断 kind 而解密每个源的完整 payload。
 */
export type SourceSummary = {
  id: string;
  kind: SourceKind;
  enabled: boolean;
  nodeRenames?: NodeRenames;
};

export type StoredSource = {
  id: string;
  name: string;
  kind: SourceKind;
  payloadEnc: string;
  enabled: boolean;
  userAgent?: string;
  nodeRenames?: NodeRenames;
  createdAt: string;
  updatedAt: string;
};

export type StoredSubscription = {
  id: string;
  name: string;
  tokenHash: string;
  tokenEnc: string;
  sourceIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type SubscriptionDto = {
  id: string;
  name: string;
  sourceIds: string[];
  link: string;
  createdAt: string;
  updatedAt: string;
};

export type SnapshotRecord = {
  sourceId: string;
  nodes: ParsedNode[];
  nodeCount: number;
  fetchedAt: string;
  userInfo?: SubscriptionResponseInfo;
  parseErrors: string[];
};

export type CacheRecord = {
  subscriptionId: string;
  yaml: string;
  nodeCount: number;
  generatedAt: string;
  configHash: string;
};

export type SourceRefreshStatus = {
  sourceId: string;
  ok: boolean;
  nodeCount?: number;
  error?: string;
};

export type SubscriptionRefreshStatus = {
  subscriptionId: string;
  ok: boolean;
  nodeCount?: number;
  error?: string;
};

export type StatusRecord = {
  lastRunAt: string;
  lastTrigger: "cron" | "manual";
  durationMs: number;
  sources: SourceRefreshStatus[];
  subscriptions: SubscriptionRefreshStatus[];
};

/**
 * 节点显示名覆盖表：key 由 nodeRenameKey(node) 生成（节点内容指纹，不含名称），
 * value 是用户为这个节点设置的显示名。保存后立即作用于订阅生成与节点列表。
 */
export type NodeRenames = Record<string, string>;

export type NodeSummary = {
  // 稳定的节点标识（内容指纹哈希），供前端回写重命名映射
  key: string;
  // 最终展示名（已应用重命名）
  name: string;
  // 解析出来的原始名称（未应用重命名）
  originName: string;
  type: string;
  server?: string;
  port?: number;
  renamed: boolean;
};

