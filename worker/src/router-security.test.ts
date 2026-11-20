import { describe, expect, it } from "vitest";
import { HSTS_VALUE, WORKER_DOCUMENT_CSP } from "./http";
import { API_RATE_LIMIT_POLICY, rateLimitKey, rateLimitWindow } from "./rate-limit";
import { route } from "./router";
import { createStore } from "./store";
import { MemoryKV } from "./test-utils/memory-kv";
import { resolveDefaultUserAgent } from "./sources";
import type { PipelineDeps } from "./pipeline";

const ADMIN_TOKEN = "test-admin-token";
const ENCRYPTION_KEY = "localtest-fixture-encryption";
const NOW = new Date("2026-10-12T00:00:00.000Z");
const SS = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@example.com:8388#NodeA";

type Harness = {
  env: Env;
  kv: MemoryKV;
  store: ReturnType<typeof createStore>;
  deps: { pipeline: PipelineDeps; now: () => Date };
};

function createHarness(): Harness {
  const kv = new MemoryKV();
  const env = {
    SUBBOOST_KV: kv as unknown as KVNamespace,
    ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher,
    ADMIN_TOKEN,
    ENCRYPTION_KEY,
    APP_NAME: "SubBoost Lite",
  } as unknown as Env;
  const store = createStore(env);
  const pipeline: PipelineDeps = {
    store,
    fetchText: (async () => ({
      status: 200,
      headers: {},
      text: "",
      finalUrl: "",
    })) as unknown as PipelineDeps["fetchText"],
    now: () => NOW,
    defaultUserAgent: resolveDefaultUserAgent(env),
  };
  return { env, kv, store, deps: { pipeline, now: () => NOW } };
}

function apiRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${ADMIN_TOKEN}`);
  return new Request(`https://worker.example.com${path}`, { ...init, headers });
}

describe("router 明文 HTTP 跳转", () => {
  it("边缘标记为 http 时 308 到 https，并保留方法", async () => {
    const h = createHarness();
    const response = await route(
      new Request("http://worker.example.com/api/state?x=1", {
        method: "PUT",
        headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "x-forwarded-proto": "http" },
      }),
      h.env,
      h.deps
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://worker.example.com/api/state?x=1");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("URL 已是 https 时不再跳转（避免与边缘配置来回重定向）", async () => {
    const h = createHarness();
    const response = await route(
      new Request("https://worker.example.com/sub/unknown", { headers: { "x-forwarded-proto": "http" } }),
      h.env,
      h.deps
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  });

  it("边缘标记为 https 时正常处理", async () => {
    const h = createHarness();
    const response = await route(
      new Request("https://worker.example.com/api/health", { headers: { "x-forwarded-proto": "https" } }),
      h.env,
      h.deps
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe("router 安全响应头", () => {
  it("Worker 处理的响应都带 HSTS", async () => {
    const h = createHarness();
    const response = await route(new Request("https://worker.example.com/sub/unknown"), h.env, h.deps);

    expect(response.status).toBe(404);
    expect(response.headers.get("strict-transport-security")).toBe(HSTS_VALUE);
  });

  it("落地页用最严格的文档 CSP（不允许任何脚本）", async () => {
    const h = createHarness();
    await h.store.saveSources([{ name: "m", kind: "manual", manualText: SS }]);
    const { token } = await h.store.createSubscription({ name: "landing", sourceIds: [] });

    const response = await route(
      new Request(`https://worker.example.com/sub/${token}?target=clash`, {
        headers: { accept: "text/html" },
      }),
      h.env,
      h.deps
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe(WORKER_DOCUMENT_CSP);
    expect(WORKER_DOCUMENT_CSP.startsWith("default-src 'none'")).toBe(true);
    expect(WORKER_DOCUMENT_CSP).not.toContain("script-src");
    expect(response.headers.get("strict-transport-security")).toBe(HSTS_VALUE);
  });
});

describe("router /api/* 限流", () => {
  const ip = "203.0.113.9";

  function seedCounter(h: Harness, count: number, address = ip): string {
    const { index } = rateLimitWindow(API_RATE_LIMIT_POLICY, NOW);
    const key = rateLimitKey("api", address, index);
    void h.kv.put(key, String(count), { expirationTtl: 120 });
    return key;
  }

  it("配额用尽后返回 429，即使 token 正确也不泄漏数据", async () => {
    const h = createHarness();
    seedCounter(h, API_RATE_LIMIT_POLICY.limit);

    const response = await route(
      apiRequest("/api/state", { headers: { "cf-connecting-ip": ip } }),
      h.env,
      h.deps
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe(
      String(rateLimitWindow(API_RATE_LIMIT_POLICY, NOW).retryAfterSeconds)
    );
    expect(await response.json()).toEqual({ error: "请求过于频繁，请稍后重试", code: "RATE_LIMITED" });
  });

  it("错误的 token 同样消耗配额，猜 token 会把自己挡住", async () => {
    const h = createHarness();
    seedCounter(h, API_RATE_LIMIT_POLICY.limit - 1);

    const wrong = await route(
      new Request("https://worker.example.com/api/state", {
        headers: { authorization: "Bearer wrong", "cf-connecting-ip": ip },
      }),
      h.env,
      h.deps
    );
    expect(wrong.status).toBe(401);

    const blocked = await route(
      new Request("https://worker.example.com/api/state", {
        headers: { authorization: "Bearer wrong", "cf-connecting-ip": ip },
      }),
      h.env,
      h.deps
    );
    expect(blocked.status).toBe(429);
  });

  it("不同 IP 各自计数", async () => {
    const h = createHarness();
    seedCounter(h, API_RATE_LIMIT_POLICY.limit);

    const other = await route(
      apiRequest("/api/state", { headers: { "cf-connecting-ip": "198.51.100.7" } }),
      h.env,
      h.deps
    );

    expect(other.status).toBe(200);
  });

  it("没有可信客户端 IP 时放行（本地 wrangler dev / 演示后端）", async () => {
    const h = createHarness();
    seedCounter(h, API_RATE_LIMIT_POLICY.limit);

    const response = await route(apiRequest("/api/state"), h.env, h.deps);

    expect(response.status).toBe(200);
  });
});
