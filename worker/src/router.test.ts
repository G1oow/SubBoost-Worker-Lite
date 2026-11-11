import yaml from "js-yaml";
import { describe, expect, it, vi } from "vitest";
import { decryptAgeFile } from "@subboost/server-core/crypto/age";
import { dearmorAge } from "@subboost/server-core/crypto/age-armor";
import { bech32Encode, encodeAgeRecipient } from "@subboost/server-core/crypto/bech32";
import { x25519PublicKeyFromSecret } from "@subboost/server-core/crypto/x25519";
import { route } from "./router";
import { createStore } from "./store";
import { MemoryKV } from "./test-utils/memory-kv";
import { refreshAll, type PipelineDeps } from "./pipeline";
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
    expect(body.app).toMatchObject({ name: "SubBoost Lite", version: "0.15.2" });
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

  it("previews a draft config without saving it", async () => {
    const h = createHarness();
    const response = await route(
      apiRequest("/api/config/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          config: {
            enabledGroups: ["select", "auto", "final"],
            customRules: [{ id: "r1", type: "DOMAIN-SUFFIX", value: "example.org", target: "DIRECT" }],
          },
        }),
      }),
      h.env,
      h.deps
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      nodeCount: 0,
      rules: ["DOMAIN-SUFFIX,example.org,DIRECT", "MATCH,🐟 漏网之鱼"],
    });

    const state = (await (await route(apiRequest("/api/state"), h.env, h.deps)).json()) as {
      configIsDefault: boolean;
    };
    expect(state.configIsDefault).toBe(true);
  });

  it("rejects a preview without a config object and reports generation errors", async () => {
    const h = createHarness();
    const post = (body: unknown) =>
      route(
        apiRequest("/api/config/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        h.env,
        h.deps
      );

    for (const body of [{}, { config: [] }, { config: "x" }]) {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    }

    const broken = await post({ config: { dnsYaml: "dns: [" } });
    expect(broken.status).toBe(400);
    const error = (await broken.json()) as { error: string; code: string };
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.error).toContain("YAML");
  });

  it("requires the admin token for previews", async () => {
    const h = createHarness();
    const response = await route(
      apiRequest("/api/config/preview", { method: "POST", body: JSON.stringify({ config: {} }) }, null),
      h.env,
      h.deps
    );
    expect(response.status).toBe(401);
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
    // 改前是 no-store：那样客户端无法用 If-None-Match 省流量。
    // 现在是 private + no-cache：可存副本，但每次使用前回源校验（配合 ETag 走 304）。
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]{16}-\d+-\d+"$/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("content-disposition")).toContain("myprofile");
    expect(response.headers.get("profile-web-page-url")).toBeNull();
    expect(response.headers.get("plan-name")).toBeNull();
    const parsed = yaml.load(await response.text()) as { proxies: unknown[] };
    expect(parsed.proxies).toHaveLength(1);
  });


  it("returns 304 with no body when If-None-Match matches the ETag", async () => {
    const h = createHarness();
    const { token } = await createManualSubscription(h);
    const first = await route(new Request(`https://worker.example.com/sub/${token}`), h.env, h.deps);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const second = await route(
      new Request(`https://worker.example.com/sub/${token}`, {
        headers: { "if-none-match": etag as string },
      }),
      h.env,
      h.deps
    );
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    // 304 仍要带上同样的 ETag，方便客户端继续复用
    expect(second.headers.get("etag")).toBe(etag);
  });

  it("returns a full body when If-None-Match does not match", async () => {
    const h = createHarness();
    const { token } = await createManualSubscription(h);
    const response = await route(
      new Request(`https://worker.example.com/sub/${token}`, {
        headers: { "if-none-match": '"stale-etag"' },
      }),
      h.env,
      h.deps
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("proxies:");
  });

  it("accepts a weak or wildcard If-None-Match", async () => {
    const h = createHarness();
    const { token } = await createManualSubscription(h);
    const first = await route(new Request(`https://worker.example.com/sub/${token}`), h.env, h.deps);
    const etag = first.headers.get("etag") as string;

    for (const header of [`W/${etag}`, `"nope", ${etag}`, "*"]) {
      const response = await route(
        new Request(`https://worker.example.com/sub/${token}`, { headers: { "if-none-match": header } }),
        h.env,
        h.deps
      );
      expect(response.status).toBe(304);
    }
  });

  it("changes the ETag when the config changes", async () => {
    const h = createHarness();
    const { token } = await createManualSubscription(h);
    const first = await route(new Request(`https://worker.example.com/sub/${token}`), h.env, h.deps);
    const firstEtag = first.headers.get("etag") as string;

    await h.store.putConfig({ mixedPort: 45678 });
    const second = await route(
      new Request(`https://worker.example.com/sub/${token}`, { headers: { "if-none-match": firstEtag } }),
      h.env,
      h.deps
    );
    expect(second.status).toBe(200);
    expect(second.headers.get("etag")).not.toBe(firstEtag);
  });
  /**
   * 回归：源节点内容更新后（节点数与 YAML 长度都没变），客户端带旧 ETag 重新拉取时
   * 必须拿到 200 + 新节点。旧实现只按「configHash + 节点数 + YAML 长度」算 ETag，
   * 这里会错误地返回 304，让客户端一直沿用旧配置（用户侧表现为「要重新绑定源才更新」）。
   */
  it("源节点内容变化后同一 ETag 不再命中 304", async () => {
    const h = createHarness();
    const upstreamText = (host: string) =>
      Buffer.from(
        [
          `ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@${host}:8388#NodeA`,
          `ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@${host}:8389#NodeB`,
        ].join("\n")
      ).toString("base64");
    const mockUpstream = (host: string) =>
      (async (url: string) => ({
        status: 200,
        headers: {},
        text: upstreamText(host),
        finalUrl: url,
      })) as unknown as PipelineDeps["fetchText"];

    h.deps.pipeline.fetchText = mockUpstream("a1.example.com");
    await h.store.saveSources([{ name: "up", kind: "remote", url: "https://up.example.com/sub" }]);
    const { token } = await h.store.createSubscription({ name: "up-sub", sourceIds: [] });

    const first = await route(new Request(`https://worker.example.com/sub/${token}`), h.env, h.deps);
    expect(first.status).toBe(200);
    const firstEtag = first.headers.get("etag") as string;
    const firstBody = await first.text();
    expect(firstBody).toContain("a1.example.com");

    // 上游换内容：节点数与 YAML 字节长度都不变，只有节点内容不同
    h.deps.pipeline.fetchText = mockUpstream("b1.example.com");
    const refreshed = await refreshAll(h.deps.pipeline, { trigger: "manual" });
    expect("status" in refreshed).toBe(true);

    const second = await route(
      new Request(`https://worker.example.com/sub/${token}`, {
        headers: { "if-none-match": firstEtag },
      }),
      h.env,
      h.deps
    );
    expect(second.status).toBe(200);
    const secondBody = await second.text();
    expect(secondBody).toContain("b1.example.com");
    // 前提守护：长度相同，旧实现正因如此给出同一个 ETag 并回 304
    expect(secondBody.length).toBe(firstBody.length);
    expect(second.headers.get("etag")).not.toBe(firstEtag);
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

describe("router short links", () => {
  async function createSubscription(h: Harness) {
    await h.store.saveSources([{ name: "m", kind: "manual", manualText: SS }]);
    const { dto, token } = await h.store.createSubscription({ name: "myprofile", sourceIds: [] });
    return { dto, token };
  }

  async function createShortLink(h: Harness, id: string): Promise<string> {
    const response = await route(
      apiRequest(`/api/subscriptions/${id}/short-link`, { method: "POST" }),
      h.env,
      h.deps
    );
    expect(response.status).toBe(200);
    const { subscription } = (await response.json()) as { subscription: { shortLink: string } };
    return subscription.shortLink;
  }

  function shortCodeOf(shortLink: string): string {
    return shortLink.split("/s/").pop() as string;
  }

  it("creates a short link, is idempotent, and exposes it in /api/state", async () => {
    const h = createHarness();
    const { dto } = await createSubscription(h);

    const shortLink = await createShortLink(h, dto.id);
    expect(shortLink).toMatch(/^https:\/\/worker\.example\.com\/s\/[A-Za-z0-9_-]{8}$/);
    // 幂等：重复生成返回同一个短码
    await expect(createShortLink(h, dto.id)).resolves.toBe(shortLink);

    const state = await route(apiRequest("/api/state"), h.env, h.deps);
    const body = (await state.json()) as { subscriptions: Array<{ shortLink?: string }> };
    expect(body.subscriptions[0]?.shortLink).toBe(shortLink);
  });

  it("serves the same YAML, ETag and headers as /sub/<token>", async () => {
    const h = createHarness();
    const { dto, token } = await createSubscription(h);
    const code = shortCodeOf(await createShortLink(h, dto.id));

    const viaToken = await route(
      new Request(`https://worker.example.com/sub/${token}`),
      h.env,
      h.deps
    );
    const viaShort = await route(
      new Request(`https://worker.example.com/s/${code}`),
      h.env,
      h.deps
    );

    expect(viaShort.status).toBe(200);
    expect(viaShort.headers.get("content-type")).toContain("text/yaml");
    expect(viaShort.headers.get("cache-control")).toBe("private, no-cache");
    expect(viaShort.headers.get("x-robots-tag")).toBe("noindex");
    expect(viaShort.headers.get("content-disposition")).toContain("myprofile");
    // 两条链接指向同一份缓存，ETag 必须一致，客户端才拿得到 304
    expect(viaShort.headers.get("etag")).toBe(viaToken.headers.get("etag"));

    const parsed = yaml.load(await viaShort.text()) as { proxies: unknown[] };
    expect(parsed.proxies).toHaveLength(1);
  });

  it("returns 304 for a matching If-None-Match and an empty body for HEAD", async () => {
    const h = createHarness();
    const { dto } = await createSubscription(h);
    const code = shortCodeOf(await createShortLink(h, dto.id));

    const first = await route(new Request(`https://worker.example.com/s/${code}`), h.env, h.deps);
    const etag = first.headers.get("etag") as string;
    const second = await route(
      new Request(`https://worker.example.com/s/${code}`, { headers: { "if-none-match": etag } }),
      h.env,
      h.deps
    );
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");

    const head = await route(
      new Request(`https://worker.example.com/s/${code}`, { method: "HEAD" }),
      h.env,
      h.deps
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("returns 404 Not found for unknown or malformed codes", async () => {
    const h = createHarness();
    // 长度不足、长度超限与含非法字符：都必须在查 KV 之前被拒
    for (const bad of ["short", "abcdefghi", "abc.def1"]) {
      const response = await route(
        new Request(`https://worker.example.com/s/${bad}`),
        h.env,
        h.deps
      );
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not found");
    }
  });

  it("stops serving the short link after revoking but keeps /sub/<token> alive", async () => {
    const h = createHarness();
    const { dto, token } = await createSubscription(h);
    const code = shortCodeOf(await createShortLink(h, dto.id));

    const revoked = await route(
      apiRequest(`/api/subscriptions/${dto.id}/short-link`, { method: "DELETE" }),
      h.env,
      h.deps
    );
    expect(revoked.status).toBe(200);
    const body = (await revoked.json()) as { subscription: { shortLink?: string } };
    expect(body.subscription.shortLink).toBeUndefined();

    const gone = await route(new Request(`https://worker.example.com/s/${code}`), h.env, h.deps);
    expect(gone.status).toBe(404);

    const stillWorks = await route(
      new Request(`https://worker.example.com/sub/${token}`),
      h.env,
      h.deps
    );
    expect(stillWorks.status).toBe(200);
  });

  it("drops the short link when the token is rotated", async () => {
    const h = createHarness();
    const { dto } = await createSubscription(h);
    const code = shortCodeOf(await createShortLink(h, dto.id));

    const rotated = await route(
      apiRequest(`/api/subscriptions/${dto.id}/rotate`, { method: "POST" }),
      h.env,
      h.deps
    );
    expect(rotated.status).toBe(200);
    const body = (await rotated.json()) as { subscription: { shortLink?: string } };
    expect(body.subscription.shortLink).toBeUndefined();

    const gone = await route(new Request(`https://worker.example.com/s/${code}`), h.env, h.deps);
    expect(gone.status).toBe(404);
  });

  it("returns 404 JSON for an unknown subscription", async () => {
    const h = createHarness();
    for (const method of ["POST", "DELETE"]) {
      const response = await route(
        apiRequest("/api/subscriptions/missing/short-link", { method }),
        h.env,
        h.deps
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
    }
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







const AGE_SECRET = new Uint8Array(32).fill(11);
const AGE_IDENTITY = bech32Encode("age-secret-key-", AGE_SECRET).toUpperCase();
const AGE_RECIPIENT = encodeAgeRecipient(x25519PublicKeyFromSecret(AGE_SECRET));

function envWithAge(h: Harness, overrides: Record<string, string> = {}): Env {
  return { ...h.env, AGE_RECIPIENT, ...overrides } as unknown as Env;
}

async function seedSubscription(h: Harness) {
  await h.store.saveSources([{ name: "m", kind: "manual", manualText: SS }]);
  return h.store.createSubscription({ name: "ageprofile", sourceIds: [] });
}

describe("router age encrypted output", () => {
  it("serves binary age ciphertext that decrypts back to the plain YAML", async () => {
    const h = createHarness();
    const { token } = await seedSubscription(h);

    const plain = await route(new Request(`https://worker.example.com/sub/${token}`), h.env, h.deps);
    const plainText = await plain.text();

    const response = await route(
      new Request(`https://worker.example.com/sub/${token}?format=age`),
      envWithAge(h),
      h.deps
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toContain(".yaml.age");
    // 密文每次都不同，因此不发 ETag、也不允许缓存
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("x-robots-tag")).toBe("noindex");

    const decrypted = await decryptAgeFile(new Uint8Array(await response.arrayBuffer()), [
      AGE_IDENTITY,
    ]);
    expect(new TextDecoder().decode(decrypted)).toBe(plainText);
  });

  it("serves armored ciphertext for ?format=age-armor", async () => {
    const h = createHarness();
    const { token } = await seedSubscription(h);

    const response = await route(
      new Request(`https://worker.example.com/sub/${token}?format=age-armor`),
      envWithAge(h),
      h.deps
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const text = await response.text();
    expect(text.startsWith("-----BEGIN AGE ENCRYPTED FILE-----")).toBe(true);
    const decrypted = await decryptAgeFile(dearmorAge(text), [AGE_IDENTITY]);
    expect(new TextDecoder().decode(decrypted)).toContain("proxies:");
  });

  it("keeps the plain YAML output untouched when no format is given", async () => {
    const h = createHarness();
    const { token } = await seedSubscription(h);
    const response = await route(
      new Request(`https://worker.example.com/sub/${token}`),
      envWithAge(h),
      h.deps
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/yaml");
    expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]{16}-\d+-\d+"$/);
  });

  it("returns 503 when AGE_RECIPIENT is missing or invalid", async () => {
    const h = createHarness();
    const { token } = await seedSubscription(h);

    const missing = await route(
      new Request(`https://worker.example.com/sub/${token}?format=age`),
      h.env,
      h.deps
    );
    expect(missing.status).toBe(503);
    expect(await missing.text()).toBe("Age recipient not configured");

    const invalid = await route(
      new Request(`https://worker.example.com/sub/${token}?format=age`),
      envWithAge(h, { AGE_RECIPIENT: "age1broken" }),
      h.deps
    );
    expect(invalid.status).toBe(503);
    expect(await invalid.text()).toBe("Age recipient invalid");
  });

  it("exposes age capabilities on /api/state", async () => {
    const h = createHarness();
    const response = await route(apiRequest("/api/state"), envWithAge(h), h.deps);
    const body = (await response.json()) as { capabilities: { age: unknown } };
    expect(body.capabilities.age).toEqual({
      enabled: true,
      only: false,
      recipients: [AGE_RECIPIENT],
      misconfigured: false,
    });
  });
});

describe("router one-click import", () => {
  it("redirects to the client deep link and drops the target parameter", async () => {
    const h = createHarness();
    const { token } = await seedSubscription(h);
    const response = await route(
      new Request(`https://worker.example.com/sub/${token}?target=clash`),
      h.env,
      h.deps
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `clash://install-config?url=${encodeURIComponent(
        `https://worker.example.com/sub/${token}`
      )}`
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(await response.text()).toBe("");
  });

  it("works through the short link form", async () => {
    const h = createHarness();
    const { dto } = await seedSubscription(h);
    const withShort = await h.store.createShortLink(dto.id, "https://worker.example.com");
    const code = withShort?.shortLink?.split("/s/")[1] as string;

    const response = await route(
      new Request(`https://worker.example.com/s/${code}?target=singbox`),
      h.env,
      h.deps
    );
    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location.startsWith("sing-box://import-remote-profile?url=")).toBe(true);
    expect(decodeURIComponent(location)).toContain(`https://worker.example.com/s/${code}`);
    expect(decodeURIComponent(location)).toContain("#ageprofile");
  });

  it("falls back to the normal subscription output for an unknown target", async () => {
    const h = createHarness();
    const { token } = await seedSubscription(h);
    const response = await route(
      new Request(`https://worker.example.com/sub/${token}?target=clashx`),
      h.env,
      h.deps
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/yaml");
  });

  it("returns 404 for an unknown subscription without calling the app", async () => {
    const h = createHarness();
    const response = await route(
      new Request("https://worker.example.com/sub/unknown?target=clash"),
      h.env,
      h.deps
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toBe("Not found");
  });
});

describe("router age-only mode", () => {
  it("rejects the plain output and the deep link but keeps the encrypted one", async () => {
    const h = createHarness();
    const { token } = await seedSubscription(h);
    const env = envWithAge(h, { AGE_ONLY: "1" });

    const plain = await route(new Request(`https://worker.example.com/sub/${token}`), env, h.deps);
    expect(plain.status).toBe(403);
    expect(await plain.text()).toBe("Encrypted output only");

    const deepLink = await route(
      new Request(`https://worker.example.com/sub/${token}?target=clash`),
      env,
      h.deps
    );
    expect(deepLink.status).toBe(403);

    const encrypted = await route(
      new Request(`https://worker.example.com/sub/${token}?format=age`),
      env,
      h.deps
    );
    expect(encrypted.status).toBe(200);
  });

  it("does not lock the plain output when the recipient is misconfigured", async () => {
    const h = createHarness();
    const { token } = await seedSubscription(h);
    const env = { ...h.env, AGE_RECIPIENT: "age1broken", AGE_ONLY: "1" } as unknown as Env;
    const response = await route(
      new Request(`https://worker.example.com/sub/${token}`),
      env,
      h.deps
    );
    // 配置错误时不能把实例锁死：明文照常输出，加密通道报 503
    expect(response.status).toBe(200);
  });
});
