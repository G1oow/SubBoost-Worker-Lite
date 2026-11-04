import { describe, expect, it } from "vitest";
import { route } from "./router";
import { createStore } from "./store";
import { MemoryKV } from "./test-utils/memory-kv";
import type { PipelineDeps } from "./pipeline";
import { resolveDefaultUserAgent } from "./sources";

const ADMIN_TOKEN = "test-admin-token";
const ENCRYPTION_KEY = "router-nodes-test-key-0123456789";

const SS = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@example.com:8388#NodeA";
const SS_SECOND = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@example.com:8389#NodeB";

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

function apiRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${ADMIN_TOKEN}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`https://worker.example.com${path}`, { ...init, headers });
}

async function saveSources(h: Harness, sources: unknown[]): Promise<Response> {
  return route(
    apiRequest("/api/sources", { method: "PUT", body: JSON.stringify({ sources }) }),
    h.env,
    h.deps
  );
}

describe("POST /api/nodes/parse", () => {
  it("parses node names and protocols from manual text", async () => {
    const h = createHarness();
    const response = await route(
      apiRequest("/api/nodes/parse", {
        method: "POST",
        body: JSON.stringify({ text: `${SS}\n${SS_SECOND}` }),
      }),
      h.env,
      h.deps
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      nodes: Array<{ key: string; name: string; type: string; originName: string }>;
      totalParsed: number;
    };
    expect(body.nodes).toHaveLength(2);
    expect(body.nodes[0]).toMatchObject({ name: "NodeA", originName: "NodeA", type: "ss" });
    expect(body.nodes[0].key).toMatch(/^[0-9a-f]{16}$/);
    expect(body.nodes[1]).toMatchObject({ name: "NodeB", type: "ss" });
    expect(body.totalParsed).toBe(2);
  });

  it("returns an empty list for blank input instead of failing", async () => {
    const h = createHarness();
    const response = await route(
      apiRequest("/api/nodes/parse", { method: "POST", body: JSON.stringify({ text: "   " }) }),
      h.env,
      h.deps
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ nodes: [], totalParsed: 0, totalFailed: 0, errors: [] });
  });

  it("applies renames supplied with the preview request", async () => {
    const h = createHarness();
    const first = await route(
      apiRequest("/api/nodes/parse", { method: "POST", body: JSON.stringify({ text: SS }) }),
      h.env,
      h.deps
    );
    const preview = (await first.json()) as { nodes: Array<{ key: string }> };
    const key = preview.nodes[0].key;

    const renamed = await route(
      apiRequest("/api/nodes/parse", {
        method: "POST",
        body: JSON.stringify({ text: SS, renames: { [key]: "香港 01" } }),
      }),
      h.env,
      h.deps
    );
    const body = (await renamed.json()) as { nodes: Array<{ name: string; originName: string; renamed: boolean }> };
    expect(body.nodes[0]).toMatchObject({ name: "香港 01", originName: "NodeA", renamed: true });
  });

  it("rejects a non-object body", async () => {
    const h = createHarness();
    const response = await route(
      apiRequest("/api/nodes/parse", { method: "POST", body: JSON.stringify(["nope"]) }),
      h.env,
      h.deps
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("source node renames", () => {
  it("persists nodeRenames on save and returns them in the DTO", async () => {
    const h = createHarness();
    const key = "0123456789abcdef";
    const response = await saveSources(h, [
      { name: "手动节点", kind: "manual", manualText: SS, nodeRenames: { [key]: "香港 01" } },
    ]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sources: Array<{ nodeRenames?: Record<string, string> }> };
    expect(body.sources[0].nodeRenames).toEqual({ [key]: "香港 01" });

    const state = await route(apiRequest("/api/state"), h.env, h.deps);
    const stateBody = (await state.json()) as { sources: Array<{ nodeRenames?: Record<string, string> }> };
    expect(stateBody.sources[0].nodeRenames).toEqual({ [key]: "香港 01" });
  });

  it("drops invalid rename keys instead of failing the save", async () => {
    const h = createHarness();
    const response = await saveSources(h, [
      { name: "手动节点", kind: "manual", manualText: SS, nodeRenames: { "bad-key": "x", "": "y" } },
    ]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sources: Array<{ nodeRenames?: Record<string, string> }> };
    expect(body.sources[0].nodeRenames).toBeUndefined();
  });

  it("lists nodes for a manual source that has no snapshot yet", async () => {
    const h = createHarness();
    const saved = await saveSources(h, [
      { name: "手动节点", kind: "manual", manualText: `${SS}\n${SS_SECOND}` },
    ]);
    const savedBody = (await saved.json()) as { sources: Array<{ id: string }> };
    const sourceId = savedBody.sources[0].id;

    const response = await route(apiRequest(`/api/sources/${sourceId}/nodes`), h.env, h.deps);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      fetchedAt: string | null;
      nodeCount: number;
      nodes: Array<{ name: string; type: string }>;
    };
    expect(body.fetchedAt).toBeNull();
    expect(body.nodeCount).toBe(2);
    expect(body.nodes.map((item) => item.name)).toEqual(["NodeA", "NodeB"]);
    expect(body.nodes.every((item) => item.type === "ss")).toBe(true);
  });

  it("applies stored renames to the node list", async () => {
    const h = createHarness();
    const saved = await saveSources(h, [{ name: "手动节点", kind: "manual", manualText: SS }]);
    const savedBody = (await saved.json()) as { sources: Array<{ id: string }> };
    const sourceId = savedBody.sources[0].id;

    const preview = await route(apiRequest(`/api/sources/${sourceId}/nodes`), h.env, h.deps);
    const previewBody = (await preview.json()) as { nodes: Array<{ key: string }> };
    const key = previewBody.nodes[0].key;

    await saveSources(h, [
      { id: sourceId, name: "手动节点", kind: "manual", manualText: SS, nodeRenames: { [key]: "香港 01" } },
    ]);

    const response = await route(apiRequest(`/api/sources/${sourceId}/nodes`), h.env, h.deps);
    const body = (await response.json()) as {
      renamedCount: number;
      nodes: Array<{ name: string; originName: string; renamed: boolean }>;
    };
    expect(body.renamedCount).toBe(1);
    expect(body.nodes[0]).toMatchObject({ name: "香港 01", originName: "NodeA", renamed: true });
  });

  it("returns 404 for an unknown source", async () => {
    const h = createHarness();
    const response = await route(apiRequest("/api/sources/missing/nodes"), h.env, h.deps);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("PATCH /api/subscriptions/:id", () => {
  async function createSubscription(h: Harness, sourceIds: string[] = []): Promise<{ id: string; link: string }> {
    const response = await route(
      apiRequest("/api/subscriptions", {
        method: "POST",
        body: JSON.stringify({ name: "默认订阅", sourceIds }),
      }),
      h.env,
      h.deps
    );
    const body = (await response.json()) as { subscription: { id: string; link: string } };
    return body.subscription;
  }

  it("changes the bound sources without touching the link", async () => {
    const h = createHarness();
    const saved = await saveSources(h, [
      { name: "A", kind: "manual", manualText: SS },
      { name: "B", kind: "manual", manualText: SS_SECOND },
    ]);
    const sources = (await saved.json()) as { sources: Array<{ id: string }> };
    const [first, second] = sources.sources.map((item) => item.id);

    const created = await createSubscription(h, [first]);
    const response = await route(
      apiRequest(`/api/subscriptions/${created.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: "改名后", sourceIds: [second] }),
      }),
      h.env,
      h.deps
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      subscription: { name: string; sourceIds: string[]; link: string };
    };
    expect(body.subscription.name).toBe("改名后");
    expect(body.subscription.sourceIds).toEqual([second]);
    expect(body.subscription.link).toBe(created.link);
  });

  it("drops the cached YAML so the next request regenerates", async () => {
    const h = createHarness();
    const created = await createSubscription(h);
    await h.store.putCache({
      subscriptionId: created.id,
      yaml: "proxies: []",
      nodeCount: 0,
      generatedAt: "2026-10-12T00:00:00.000Z",
      configHash: "hash",
    });

    const response = await route(
      apiRequest(`/api/subscriptions/${created.id}`, {
        method: "PATCH",
        body: JSON.stringify({ sourceIds: [] }),
      }),
      h.env,
      h.deps
    );
    expect(response.status).toBe(200);
    await expect(h.store.getCache(created.id)).resolves.toBeNull();
  });

  it("rejects unknown source ids", async () => {
    const h = createHarness();
    const created = await createSubscription(h);
    const response = await route(
      apiRequest(`/api/subscriptions/${created.id}`, {
        method: "PATCH",
        body: JSON.stringify({ sourceIds: ["ghost"] }),
      }),
      h.env,
      h.deps
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("ghost");
    // 只给一串 id 用户无从下手：错误里要说清「源可能已被删除」并提示刷新后重选
    expect(body.error).toContain("源可能已被删除");
  });

  it("validates the new name and 404s for missing subscriptions", async () => {
    const h = createHarness();
    const created = await createSubscription(h);

    const badName = await route(
      apiRequest(`/api/subscriptions/${created.id}`, { method: "PATCH", body: JSON.stringify({ name: " " }) }),
      h.env,
      h.deps
    );
    expect(badName.status).toBe(400);

    const missing = await route(
      apiRequest("/api/subscriptions/ghost", { method: "PATCH", body: JSON.stringify({ name: "x" }) }),
      h.env,
      h.deps
    );
    expect(missing.status).toBe(404);
  });
});

describe("GET /api/dashboard", () => {
  it("summarizes sources, subscriptions and node protocols", async () => {
    const h = createHarness();
    const saved = await saveSources(h, [
      { name: "手动节点", kind: "manual", manualText: `${SS}\n${SS_SECOND}` },
    ]);
    const sources = (await saved.json()) as { sources: Array<{ id: string }> };
    await h.store.putSnapshot({
      sourceId: sources.sources[0].id,
      nodes: [
        { name: "NodeA", type: "ss", server: "example.com", port: 8388, cipher: "aes-256-gcm", password: "p" },
        { name: "NodeB", type: "vless", server: "example.com", port: 443, uuid: "u" },
      ] as never,
      nodeCount: 2,
      fetchedAt: "2026-10-12T00:00:00.000Z",
      parseErrors: [],
    });
    await route(
      apiRequest("/api/subscriptions", {
        method: "POST",
        body: JSON.stringify({ name: "默认订阅", sourceIds: [] }),
      }),
      h.env,
      h.deps
    );

    const response = await route(apiRequest("/api/dashboard"), h.env, h.deps);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      generatedAt: string;
      sources: { total: number; enabled: number; manual: number };
      subscriptions: { total: number; allSources: number };
      nodes: { total: number; protocols: Array<{ type: string; count: number }> };
      sourceStats: Array<{ name: string; nodeCount: number }>;
      warnings: Array<{ message: string }>;
    };
    expect(body.generatedAt).toBe("2026-10-12T00:00:00.000Z");
    expect(body.sources).toMatchObject({ total: 1, enabled: 1, manual: 1 });
    expect(body.subscriptions).toMatchObject({ total: 1, allSources: 1 });
    expect(body.nodes.total).toBe(2);
    expect(body.nodes.protocols).toEqual([
      { type: "ss", count: 1 },
      { type: "vless", count: 1 },
    ]);
    expect(body.sourceStats[0]).toMatchObject({ name: "手动节点", nodeCount: 2 });
    expect(body.warnings).toEqual([]);
  });
});
