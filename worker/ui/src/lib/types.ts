// 管理页与 Worker API 之间的 DTO 形状（对应 worker/src/types.ts 与 worker/src/dashboard.ts）
export type SourceKind = "remote" | "manual";

/** 节点显示名覆盖表：key 是节点内容指纹，value 是用户设置的显示名 */
export type NodeRenames = Record<string, string>;

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

export type SubscriptionDto = {
  id: string;
  name: string;
  sourceIds: string[];
  link: string;
  /** 已生成短链时才有值：`${origin}/s/${shortCode}`，与 link 输出同一份配置 */
  shortLink?: string;
  createdAt: string;
  updatedAt: string;
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

/** age 加密通道的实例能力（对应 worker/src/age.ts 的 AgeCapabilities） */
export type AgeCapabilities = {
  enabled: boolean;
  only: boolean;
  recipients: string[];
  misconfigured: boolean;
};

export type AppCapabilities = {
  age: AgeCapabilities;
};

export type AppState = {
  app: { name: string; version: string };
  sources: SourceDto[];
  subscriptions: SubscriptionDto[];
  config: Record<string, unknown>;
  configIsDefault: boolean;
  status: StatusRecord | null;
  /** 老版本 Worker 不返回这个字段，管理端按「未启用」处理 */
  capabilities?: AppCapabilities;
};

export type SourceInput = {
  id?: string;
  name: string;
  kind: SourceKind;
  url?: string;
  manualText?: string;
  enabled?: boolean;
  userAgent?: string;
  nodeRenames?: NodeRenames;
};

/** 解析出的节点摘要（名称 + 协议 + 身份字段） */
export type NodeSummary = {
  key: string;
  name: string;
  originName: string;
  type: string;
  server?: string;
  port?: number;
  renamed: boolean;
};

export type ParseNodesResponse = {
  nodes: NodeSummary[];
  totalParsed: number;
  totalFailed: number;
  errors: string[];
};

export type SourceNodesResponse = {
  source: {
    id: string;
    name: string;
    kind: SourceKind;
    enabled: boolean;
    nodeRenames: NodeRenames;
  };
  fetchedAt: string | null;
  nodeCount: number;
  renamedCount: number;
  nodes: NodeSummary[];
  parseErrors: string[];
};

export type ProtocolCount = { type: string; count: number };

export type DashboardSourceStat = {
  sourceId: string;
  name: string;
  kind: SourceKind;
  enabled: boolean;
  nodeCount: number;
  renamedCount: number;
  fetchedAt: string | null;
  ok: boolean | null;
  error?: string;
  protocols: ProtocolCount[];
};

export type DashboardLastRun = {
  at: string;
  trigger: "cron" | "manual";
  durationMs: number;
  sourceOk: number;
  sourceFailed: number;
  subscriptionOk: number;
  subscriptionFailed: number;
};

export type DashboardWarning = {
  level: "warning" | "error";
  message: string;
};

export type DashboardStats = {
  generatedAt: string;
  sources: { total: number; enabled: number; remote: number; manual: number };
  subscriptions: { total: number; allSources: number; scoped: number };
  nodes: { total: number; renamed: number; protocols: ProtocolCount[] };
  sourceStats: DashboardSourceStat[];
  lastRun: DashboardLastRun | null;
  warnings: DashboardWarning[];
};

/** 管理页顶部导航的页面 id */
export type PageId = "dashboard" | "sources" | "subscriptions" | "status" | "config";
