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
/**
 * 「节点排序」画布一次加载的节点上限。
 *
 * 画布是全量渲染的（跨行拖拽排序与虚拟化不兼容），上千张卡片还能拖，
 * 再多就该让用户缩小勾选的订阅范围。超过上限时响应带 `truncated` 标记，界面如实提示。
 */
export const MAX_CANVAS_NODES = 1000;
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

/**
 * 短链码：8 字符 base64url（`[A-Za-z0-9_-]`），作为 `/s/<code>` 的路径段。
 * 每订阅最多一条，与 token 相互独立：撤销/轮换一边不影响另一边的其他语义。
 */
export const SHORT_CODE_LENGTH = 8;
export const SHORT_CODE_PATTERN = /^[A-Za-z0-9_-]{8}$/;

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
  /** 勾选的链（链在这条订阅里充当「一个源」）：只有点名的链才会生成 */
  chainIds: string[];
  createdAt: string;
  updatedAt: string;
  // 已生成的短链码（不加密：随机生成的公开定位符，不是秘密材料）
  shortCode?: string;
};

export type SubscriptionDto = {
  id: string;
  name: string;
  sourceIds: string[];
  chainIds: string[];
  link: string;
  // 已生成短链时才有值：`${origin}/s/${shortCode}`
  shortLink?: string;
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
  /**
   * YAML 内容的 sha256 摘要（hex）。订阅响应的 ETag 由它派生：
   * 只有内容真的变了 ETag 才变，「节点数与字节长度恰好相同」的不同内容也不会被误判成未更新。
   * 升级前写入的旧记录没有这个字段，读取侧按需补算。
   */
  contentHash?: string;
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


/**
 * 画布里的一个节点卡片。
 *
 * 比 `NodeSummary` 多带来源与标记：卡片要显示源名、按源高亮，
 * 信息节点/链落地节点在画布上要与普通节点区分开。
 */
export type CanvasNodeSummary = NodeSummary & {
  /** 归属于哪个源（同一节点出现在多个源时取首个源） */
  sourceId?: string;
  sourceName?: string;
  /** 机场信息节点：会进 🚀 节点选择，但业务组会过滤掉 */
  infoNode?: boolean;
  /** 被链式代理当作落地节点（组里已被出口组顶替） */
  chainLanding?: boolean;
};

/** `GET /api/subscriptions/:id/nodes` 的响应 */
export type SubscriptionCanvasNodes = {
  subscription: { id: string; name: string };
  /** 该订阅合并去重后的节点总数（未截断） */
  nodeCount: number;
  /** 节点数超过上限、只返回了前 MAX_CANVAS_NODES 个 */
  truncated: boolean;
  /** 参与合并的源（按实际顺序），界面用它说明「排序覆盖哪些源」 */
  sources: Array<{ id: string; name: string; nodeCount: number; missingSnapshot: boolean }>;
  nodes: CanvasNodeSummary[];
};
