// Cloudflare Workers 绑定类型的最小本地声明。
// 说明（对应 Plan U10 / K13）：不把 @cloudflare/workers-types 放进 tsconfig 的 types，
// 避免它与被 import 的 packages/core（TextDecoder / URLSearchParams / Buffer）产生类型冲突；
// 这里只声明 Worker 运行时实际用到的少数全局类型，且不修改 packages/core。
interface KVNamespace {
  get(key: string, type?: "text"): Promise<string | null>;
  get(key: string, type: "json"): Promise<unknown>;
  // 批量读：一次操作返回多个 key，未命中的 key 值为 null（Workers 上限 100 个 key）
  get(keys: string[], type: "json"): Promise<Map<string, unknown>>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string }): Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
  }>;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledController {
  readonly cron: string;
}

interface Env {
  SUBBOOST_KV: KVNamespace;
  ASSETS: Fetcher;
  // Secret：管理 API 的唯一凭证
  ADMIN_TOKEN?: string;
  // Secret：AES-256-GCM 派生密钥的原始材料
  ENCRYPTION_KEY?: string;
  // var：应用展示名，缺省 "SubBoost Lite"
  APP_NAME?: string;
  // var：覆盖默认上游抓取 UA
  DEFAULT_USER_AGENT?: string;
}
