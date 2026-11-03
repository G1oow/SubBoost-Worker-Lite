import yaml from "js-yaml";
import { describe, expect, it, vi } from "vitest";
import { route } from "./router";
import { createStore } from "./store";
import { MemoryKV } from "./test-utils/memory-kv";
import type { PipelineDeps } from "./pipeline";
import { resolveDefaultUserAgent } from "./sources";

const ADMIN_TOKEN = "test-admin-token";
const ENCRYPTION_KEY = "router-test-key-0123456789";

const SS = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@example.com:8388#NodeA";

type Harness = {
  env: Env;
  kv: MemoryKV;
  store: ReturnType<typeof createStore>;
  deps: { pipeline: PipelineDeps };
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
    fetchText: (async () => ({ status: 200, headers: {}, text: "", finalUrl: "" })) as unknown as PipelineDeps["fetchText"],
    now: () => new Date("2026-10-12T00:00:00.000Z"),
    defaultUserAgent: resolveDefaultUserAgent(env),
  };
  return { env, kv, store, deps: { pipeline } };
}

function apiRequest(path: string, init: RequestInit = {}, token: string | null = ADMIN_TOKEN): Request {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request(`https://worker.example.com${path}`, { ...init, headers });
}

describe("router auth", () => {
  it("exposes health without auth", async () => {
    const h = createHarness();
    const response = await route(apiRequest("/api/health", {}, null), h.env, h.deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("rejects /api/state without a token", async () => {
    const h = createHarness();
    const response = await route(apiRequest("/api/state", {}, null), h.env, h.deps);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized", code: "UNAUTHORIZED" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects a wrong token", async () => {
    const h = createHarness();
    const response = await route(apiRequest("/api/state", {}, "wrong"), h.env, h.deps);
    expect(response.status).toBe(401);
  });

  it("returns 503 CONFIGURATION_ERROR when ADMIN_TOKEN is missing", async () => {
    const h = createHarness();
    const env = { ...h.env, ADMIN_TOKEN: undefined } as unknown as Env;
    const response = await route(apiRequest("/api/state"), env, h.deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "CONFIGURATION_ERROR" });
  });

  it("accepts the correct token and returns state", async () => {
    const h = createHarness();
    const response = await route(apiRequest("/api/state"), h.env, h.deps);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.app).toMatchObject({ name: "SubBoost Lite", version: "0.3.9" });
    expect(body.configIsDefault).toBe(true);
    expect(body.status).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("router sources", () => {
  it("rejects 51 sources", async () => {
    const h = createHarness();
    const sources = Array.from({ length: 51 }, (_, i) => ({
      name: `s${i}`,
      kind: "manual",
      manualText: SS,
    }));
    const response = await route(
      apiRequest("/api/sources", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sources }),
      }),
      h.env,
      h.deps
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a private remote URL and mentions the index", async () => {
    const h = createHarness();
    const response = await route(
      apiRequest("/api/sources", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sources: [{ name: "bad", kind: "remote", url: "http://127.0.0.1/x" }] }),
      }),
      h.env,
      h.deps
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; code: string };
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.error).toContain("第 1 个源");
  });

  it("saves a valid source and returns it decrypted", async () => {
    const h = createHarness();
    const response = await route(
      apiRequest("/api/sources", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sources: [{ name: "good", kind: "remote", url: "https://example.com/sub?token=x" }],
        }),
      }),
      h.env,
      h.deps
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sources: Array<{ url?: string }> };
    expect(body.sources[0].url).toBe("https://example.com/sub?token=x");
  });

  it("rejects manual text that parses to zero nodes", async () => {
    const h = createHarness();
    const response = await route(
      apiRequest("/api/sources", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sources: [{ name: "bad", kind: "manual", manualText: "hello" }] }),
      }),
      h.env,
      h.deps
    );
    expect(response.status).toBe(400);
  });
});

describe("router config", () => {
  it("rejects a non-object config body", async () => {
    const h = createHarness();
    const response = await route(
      apiRequest("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "[]",
      }),
      h.env,
      h.deps
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("saves and resets a config", async () => {
    const h = createHarness();
    const put = await route(
      apiRequest("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mixedPort: 1234 }),
      }),
      h.env,
      h.deps
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ configIsDefault: false });

    const del = await route(apiRequest("/api/config", { method: "DELETE" }), h.env, h.deps);
    expect(del.status).toBe(200);
    expect(await del.json()).toMatchObject({ configIsDefault: true });
  });
});

describe("router subscriptions", () => {
  it("creates a subscription with a 43-char token link", async () => {
    const h = createHarness();
    const response = await route(
      apiRequest("/api/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "default" }),
      }),
      h.env,
      h.deps
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { subscription: { link: string } };
    expect(body.subscription.link).toMatch(
      /^https:\/\/worker\.example\.com\/sub\/[A-Za-z0-9_-]{43}$/
    );
  });

  it("returns the newly created subscription when several exist", async () => {
    const h = createHarness();
    const first = await route(
      apiRequest("/api/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "first" }),
      }),
      h.env,
      h.deps
    );
    const firstBody = (await first.json()) as { subscription: { id: string; link: string } };
    const second = await route(
      apiRequest("/api/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "second" }),
      }),
      h.env,
      h.deps
    );
    const secondBody = (await second.json()) as { subscription: { id: string; link: string } };
    expect(secondBody.subscription.id).not.toBe(firstBody.subscription.id);
    expect(secondBody.subscription.link).not.toBe(firstBody.subscription.link);
    // 返回的 link 必须能在 /sub 上解析到该订阅
    const served = await route(
      new Request(secondBody.subscription.link),
      h.env,
      h.deps
    );
    expect(served.status).not.toBe(404);
  });

  it("deletes a subscription with no-store on the 204 response", async () => {
    const h = createHarness();
    const created = await route(
      apiRequest("/api/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "default" }),
      }),
      h.env,
      h.deps
    );
    const { subscription } = (await created.json()) as { subscription: { id: string } };
    const deleted = await route(
      apiRequest(`/api/subscriptions/${subscription.id}`, { method: "DELETE" }),
      h.env,
      h.deps
    );
    expect(deleted.status).toBe(204);
    expect(deleted.headers.get("cache-control")).toBe("no-store");
  });

  it("rotates a subscription token", async () => {
    const h = createHarness();
    const created = await route(
      apiRequest("/api/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "default" }),
      }),
      h.env,
      h.deps
    );
    const { subscription } = (await created.json()) as { subscription: { id: string; link: string } };
    const rotated = await route(
      apiRequest(`/api/subscriptions/${subscription.id}/rotate`, { method: "POST" }),
      h.env,
      h.deps
    );
    expect(rotated.status).toBe(200);
    const body = (await rotated.json()) as { subscription: { link: string } };
    expect(body.subscription.link).not.toBe(subscription.link);
  });
});

describe("router /sub", () => {
  async function createManualSubscription(h: Harness) {
    await h.store.saveSources([{ name: "m", kind: "manual", manualText: SS }]);
    const { dto, token } = await h.store.createSubscription({ name: "myprofile", sourceIds: [] });
    return { dto, token };
  }

  it("returns 404 Not found for an unknown token", async () => {
    const h = createHarness();
    const response = await route(new Request("https://worker.example.com/sub/unknown"), h.env, h.deps);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });

  it("returns 404 with an empty body for HEAD", async () => {
    const h = createHarness();
    const response = await route(
      new Request("https://worker.example.com/sub/unknown", { method: "HEAD" }),
      h.env,
      h.deps
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("serves YAML with the documented headers", async () => {
    const h = createHarness();
    const { token } = await createManualSubscription(h);
    const response = await route(
      new Request(`https://worker.example.com/sub/${token}`),
      h.env,
      h.deps
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/yaml");
    expect(response.headers.get("profile-update-interval")).toBe("12");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("content-disposition")).toContain("myprofile");
    expect(response.headers.get("profile-web-page-url")).toBeNull();
    expect(response.headers.get("plan-name")).toBeNull();
    const parsed = yaml.load(await response.text()) as { proxies: unknown[] };
    expect(parsed.proxies).toHaveLength(1);
  });

  it("emits subscription-userinfo only when every remote source provides the fields", async () => {
    const h = createHarness();
    const SS_LINK = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@example.com:8388#NodeA";
    h.deps.pipeline.fetchText = (async (url: string) => {
      if (url === "https://a.example.com/sub") {
        return {
          status: 200,
          headers: { "subscription-userinfo": "upload=1; download=2; total=3; expire=1900000000" },
          text: Buffer.from(SS_LINK).toString("base64"),
          finalUrl: url,
        };
      }
      return {
        status: 200,
        headers: { "subscription-userinfo": "upload=10; download=20; total=30; expire=1800000000" },
        text: Buffer.from(SS_LINK).toString("base64"),
        finalUrl: url,
      };
    }) as unknown as PipelineDeps["fetchText"];

    const sources = await h.store.saveSources([
      { name: "a", kind: "remote", url: "https://a.example.com/sub" },
      { name: "b", kind: "remote", url: "https://b.example.com/sub" },
    ]);
    const { token } = await h.store.createSubscription({ name: "agg", sourceIds: [] });
    const response = await route(new Request(`https://worker.example.com/sub/${token}`), h.env, h.deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("subscription-userinfo")).toBe(
      "upload=11; download=22; total=33; expire=1800000000"
    );

    // 只有一个源提供 userinfo 时不输出该头（用干净环境，避免旧快照干扰）
    const partial = createHarness();
    partial.deps.pipeline.fetchText = (async (url: string) => ({
      status: 200,
      headers: url.includes("/with-info")
        ? { "subscription-userinfo": "upload=1; download=2; total=3; expire=1900000000" }
        : {},
      text: Buffer.from(SS_LINK).toString("base64"),
      finalUrl: url,
    })) as unknown as PipelineDeps["fetchText"];
    await partial.store.saveSources([
      { name: "with-info", kind: "remote", url: "https://a.example.com/with-info" },
      { name: "no-info", kind: "remote", url: "https://b.example.com/no-info" },
    ]);
    const partialSub = await partial.store.createSubscription({ name: "partial", sourceIds: [] });
    const second = await route(
      new Request(`https://worker.example.com/sub/${partialSub.token}`),
      partial.env,
      partial.deps
    );
    expect(second.status).toBe(200);
    expect(second.headers.get("subscription-userinfo")).toBeNull();
  });

  it("returns 409 REFRESH_IN_PROGRESS when a refresh is already running", async () => {
    const h = createHarness();
    await h.store.acquireLock("someone-else");
    const response = await route(apiRequest("/api/refresh", { method: "POST" }), h.env, h.deps);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "REFRESH_IN_PROGRESS" });
  });

  it("returns plain-text Internal error when generation throws without cache", async () => {
    const h = createHarness();
    await h.store.saveSources([{ name: "m", kind: "manual", manualText: SS }]);
    const { token } = await h.store.createSubscription({ name: "broken", sourceIds: [] });
    await h.store.putConfig({ mixedPort: 1234, dnsYaml: "proxies: []" });
    const response = await route(
      new Request(`https://worker.example.com/sub/${token}`),
      h.env,
      h.deps
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("Internal error");
  });

  it("returns 503 with Retry-After when no nodes are available", async () => {
    const h = createHarness();
    await h.store.saveSources([{ name: "bad", kind: "manual", manualText: SS }]);
    const { token } = await h.store.createSubscription({ name: "empty", sourceIds: [] });
    // 手动源可解析，改为清空节点来源：直接删除源但保留订阅
    await h.store.saveSources([]);
    const response = await route(
      new Request(`https://worker.example.com/sub/${token}`),
      h.env,
      h.deps
    );
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("No nodes available");
    expect(response.headers.get("Retry-After")).toBe("600");
  });

  it("supports HEAD on an existing subscription", async () => {
    const h = createHarness();
    const { token } = await createManualSubscription(h);
    const response = await route(
      new Request(`https://worker.example.com/sub/${token}`, { method: "HEAD" }),
      h.env,
      h.deps
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });
});

describe("router fallthrough", () => {
  it("returns 404 JSON for an unknown /api route", async () => {
    const h = createHarness();
    const response = await route(apiRequest("/api/x"), h.env, h.deps);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("delegates non-api paths to static assets", async () => {
    const h = createHarness();
    const assetsFetch = vi.fn(async () => new Response("asset-body"));
    const env = { ...h.env, ASSETS: { fetch: assetsFetch } as unknown as Fetcher } as unknown as Env;
    const response = await route(new Request("https://worker.example.com/"), env, h.deps);
    expect(await response.text()).toBe("asset-body");
    expect(assetsFetch).toHaveBeenCalledTimes(1);
  });
});






