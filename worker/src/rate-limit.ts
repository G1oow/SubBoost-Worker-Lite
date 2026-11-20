/**
 * `/api/*` 的固定窗口限流。
 *
 * 本项目只依赖 Workers + KV，没有 Durable Objects，所以这里是「尽力而为」的限流：
 *
 * - 计数器放在 KV 里，写入受「同一 key 每秒 1 次」的限制，突发流量会被少计；
 * - 读写 KV 失败一律放行（fail-open），限流组件自身出问题不能把管理端锁死。
 *
 * 它挡的是脚本刷接口与无脑猜 token，真正的硬上限应该叠加 Cloudflare 侧的速率限制规则。
 */

export type RateLimitPolicy = {
  /** 一个窗口内允许的请求数 */
  limit: number;
  /** 窗口长度（秒） */
  windowSeconds: number;
};

/**
 * 默认策略：60 秒 60 次。
 * 管理端一次交互通常 1–3 个请求，正常使用碰不到；手工爆破则立刻被压到 1 req/s。
 */
export const API_RATE_LIMIT_POLICY: RateLimitPolicy = { limit: 60, windowSeconds: 60 };

export type RateLimitOutcome = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * 取客户端 IP。
 *
 * Cloudflare 边缘一定会带 `cf-connecting-ip`，它不能被客户端伪造；
 * 本地 `wrangler dev` 与浏览器内演示后端都不带这个头，此时返回 null 由调用方放行。
 */
export function resolveClientIp(request: Request): string | null {
  const forwardedByCf = request.headers.get("cf-connecting-ip")?.trim();
  if (forwardedByCf) return forwardedByCf;

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || null;
}

/** 计数键：窗口序号进 key，窗口切换后旧计数自然过期，不需要清理任务 */
export function rateLimitKey(bucket: string, ip: string, windowIndex: number): string {
  return `ratelimit:v1:${bucket}:${ip}:${windowIndex}`;
}

export function rateLimitWindow(policy: RateLimitPolicy, now: Date): { index: number; retryAfterSeconds: number } {
  const windowMs = Math.max(1, Math.floor(policy.windowSeconds)) * 1000;
  const nowMs = now.getTime();
  const index = Math.floor(nowMs / windowMs);
  const remainingMs = (index + 1) * windowMs - nowMs;
  return { index, retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)) };
}

export async function consumeRateLimit(
  kv: KVNamespace,
  options: { bucket: string; ip: string; policy: RateLimitPolicy; now: Date }
): Promise<RateLimitOutcome> {
  const { bucket, ip, policy, now } = options;
  const limit = Math.max(1, Math.floor(policy.limit));
  const { index, retryAfterSeconds } = rateLimitWindow(policy, now);
  const key = rateLimitKey(bucket, ip, index);

  let current = 0;
  try {
    const raw = await kv.get(key, "text");
    if (raw) {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed > 0) current = parsed;
    }
  } catch {
    return { allowed: true };
  }

  if (current >= limit) return { allowed: false, retryAfterSeconds };

  try {
    // KV 的 expirationTtl 下限是 60 秒，取窗口两倍即可避免跨窗口读到上一窗的余数
    await kv.put(key, String(current + 1), {
      expirationTtl: Math.max(60, Math.floor(policy.windowSeconds) * 2),
    });
  } catch {
    // 写失败不惩罚请求：宁可少限流，也不让管理端不可用
  }

  return { allowed: true };
}
