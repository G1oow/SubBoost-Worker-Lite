import { describe, expect, it } from "vitest";
import {
  API_RATE_LIMIT_POLICY,
  consumeRateLimit,
  rateLimitKey,
  rateLimitWindow,
  resolveClientIp,
} from "./rate-limit";
import { MemoryKV } from "./test-utils/memory-kv";

const now = new Date("2026-10-12T00:00:00.000Z");
const policy = { limit: 3, windowSeconds: 60 };

function kv(): KVNamespace {
  return new MemoryKV() as unknown as KVNamespace;
}

describe("resolveClientIp", () => {
  it("优先用 Cloudflare 的 CF-Connecting-IP", () => {
    const request = new Request("https://worker.example.com/api/state", {
      headers: { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.7" },
    });
    expect(resolveClientIp(request)).toBe("203.0.113.9");
  });

  it("退回 X-Forwarded-For 的第一跳", () => {
    const request = new Request("https://worker.example.com/api/state", {
      headers: { "x-forwarded-for": "198.51.100.7, 10.0.0.1" },
    });
    expect(resolveClientIp(request)).toBe("198.51.100.7");
  });

  it("都没有时返回 null（本地与演示后端不该被限流）", () => {
    const request = new Request("https://worker.example.com/api/state");
    expect(resolveClientIp(request)).toBeNull();
  });
});

describe("rateLimitWindow", () => {
  it("窗口序号随窗口长度切分，Retry-After 不超过窗口长度", () => {
    const sixty = rateLimitWindow({ limit: 1, windowSeconds: 60 }, now);
    const afterAMinute = rateLimitWindow({ limit: 1, windowSeconds: 60 }, new Date(now.getTime() + 60_000));

    expect(afterAMinute.index).toBe(sixty.index + 1);
    expect(sixty.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(sixty.retryAfterSeconds).toBeLessThanOrEqual(60);
  });
});

describe("consumeRateLimit", () => {
  it("窗口内允许 limit 次，超出后拒绝并给出重试秒数", async () => {
    const namespace = kv();
    const options = { bucket: "api", ip: "203.0.113.9", policy, now };

    for (let index = 0; index < policy.limit; index += 1) {
      expect((await consumeRateLimit(namespace, options)).allowed).toBe(true);
    }

    const blocked = await consumeRateLimit(namespace, options);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("计数键按 IP 隔离", async () => {
    const namespace = kv();
    for (let index = 0; index < policy.limit; index += 1) {
      await consumeRateLimit(namespace, { bucket: "api", ip: "203.0.113.9", policy, now });
    }

    expect((await consumeRateLimit(namespace, { bucket: "api", ip: "198.51.100.7", policy, now })).allowed).toBe(true);
  });

  it("换窗口后重新从零计数", async () => {
    const namespace = kv();
    for (let index = 0; index < policy.limit; index += 1) {
      await consumeRateLimit(namespace, { bucket: "api", ip: "203.0.113.9", policy, now });
    }

    const nextWindow = new Date(now.getTime() + 60_000);
    expect(
      (await consumeRateLimit(namespace, { bucket: "api", ip: "203.0.113.9", policy, now: nextWindow })).allowed
    ).toBe(true);
  });

  it("计数键带版本前缀与窗口序号，TTL 不短于 KV 的 60 秒下限", async () => {
    const namespace = new MemoryKV();
    await consumeRateLimit(namespace as unknown as KVNamespace, {
      bucket: "api",
      ip: "203.0.113.9",
      policy,
      now,
    });

    const key = rateLimitKey("api", "203.0.113.9", rateLimitWindow(policy, now).index);
    expect(key.startsWith("ratelimit:v1:api:")).toBe(true);
    expect(namespace.expirationTtls.get(key)).toBeGreaterThanOrEqual(60);
  });

  it("KV 读失败时放行（fail-open，不能把管理端锁死）", async () => {
    const broken = {
      get: async () => {
        throw new Error("kv down");
      },
      put: async () => undefined,
    } as unknown as KVNamespace;

    expect(
      (await consumeRateLimit(broken, { bucket: "api", ip: "203.0.113.9", policy: API_RATE_LIMIT_POLICY, now })).allowed
    ).toBe(true);
  });

  it("KV 写失败时不计较，请求照常放行", async () => {
    const halfBroken = {
      get: async () => null,
      put: async () => {
        throw new Error("write limit");
      },
    } as unknown as KVNamespace;

    expect(
      (await consumeRateLimit(halfBroken, { bucket: "api", ip: "203.0.113.9", policy: API_RATE_LIMIT_POLICY, now }))
        .allowed
    ).toBe(true);
  });
});
