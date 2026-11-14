import { describe, expect, it } from "vitest";
import { nodeRenameKey } from "@subboost/core/node-rename-key";
import type { ParsedNode } from "@subboost/core/types/node";
import type { PipelineDeps } from "./pipeline";
import { route } from "./router";
import { resolveDefaultUserAgent } from "./sources";
import { createStore } from "./store";
import { MAX_CANVAS_NODES } from "./types";
import { MemoryKV } from "./test-utils/memory-kv";

const ADMIN_TOKEN = "test-admin-token";
const ENCRYPTION_KEY = "router-nodes-test-key-0123456789";

const SS = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@example.com:8388#NodeA";

type Harness = {
  env: Env;
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
  return { env, store, deps: { pipeline } };
}

function apiRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${ADMIN_TOKEN}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`https://worker.example.com${path}`, { ...init, headers });
}

function node(name: string, port: number): ParsedNode {
  return {
    name,
    type: "ss",
    server: "192.0.2.10",
    port,
    cipher: "aes-256-gcm",
    password: "password",
  } as unknown as ParsedNode;
}

/** `PUT /api/sources` 是全量替换，一次只能提交整份列表——分批调用会把前一批冲掉 */
async function seedSources(h: Harness, names: string[]): Promise<string[]> {
  const response = await route(
    apiRequest("/api/sources", {
      method: "PUT",
      body: JSON.stringify({
        sources: names.map((name) => ({ name, kind: "manual", manualText: SS })),
      }),
    }),
    h.env,
    h.deps
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { sources: Array<{ id: string }> };
  return body.sources.map((source) => source.id);
}

async function createSubscription(h: Harness, name: string, sourceIds: string[], chainIds: string[] = []): Promise<string> {
  const response = await route(
    apiRequest("/api/subscriptions", {
      method: "POST",
      body: JSON.stringify({ name, sourceIds, chainIds }),
    }),
    h.env,
    h.deps
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as { subscription: { id: string } };
  return body.subscription.id;
}

async function putSnapshot(h: Harness, sourceId: string, nodes: ParsedNode[]): Promise<void> {
  await h.store.putSnapshot({
    sourceId,
    nodes,
    nodeCount: nodes.length,
    fetchedAt: "2026-10-12T00:00:00.000Z",
    parseErrors: [],
  });
}

async function getCanvas(h: Harness, subscriptionId: string): Promise<Response> {
  return route(apiRequest(`/api/subscriptions/${subscriptionId}/nodes`), h.env, h.deps);
}

type CanvasBody = {
  subscription: { id: string; name: string };
  nodeCount: number;
  truncated: boolean;
  sources: Array<{ id: string; name: string; nodeCount: number; missingSnapshot: boolean }>;
  nodes: Array<{
    key: string;
    name: string;
    originName: string;
    type: string;
    sourceId?: string;
    sourceName?: string;
    infoNode?: boolean;
    chainLanding?: boolean;
    renamed: boolean;
  }>;
};

describe("GET /api/subscriptions/:id/nodes", () => {
  it("orders nodes by config.nodeOrder and appends the rest in source order", async () => {
    const h = createHarness();
    const [sourceA, sourceB] = await seedSources(h, ["机场 A", "机场 B"]);
    const a1 = node("A1", 8388);
    const a2 = node("A2", 8389);
    const b1 = node("B1", 8390);
    await putSnapshot(h, sourceA, [a1, a2]);
    await putSnapshot(h, sourceB, [b1]);
    await h.store.putConfig({ nodeOrder: [nodeRenameKey(b1), nodeRenameKey(a1)] });
    const subscriptionId = await createSubscription(h, "默认订阅", [sourceA, sourceB]);

    const response = await getCanvas(h, subscriptionId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as CanvasBody;

    expect(body.nodes.map((item) => item.name)).toEqual(["B1", "A1", "A2"]);
    expect(body.nodeCount).toBe(3);
    expect(body.truncated).toBe(false);
    expect(body.nodes[0]).toMatchObject({ sourceId: sourceB, sourceName: "机场 B" });
    expect(body.sources.map((item) => [item.name, item.nodeCount, item.missingSnapshot])).toEqual([
      ["机场 A", 2, false],
      ["机场 B", 1, false],
    ]);
  });

  it("marks sources without a snapshot instead of failing", async () => {
    const h = createHarness();
    const [withSnapshot, withoutSnapshot] = await seedSources(h, ["机场 A", "机场 B"]);
    await putSnapshot(h, withSnapshot, [node("A1", 8388)]);
    const subscriptionId = await createSubscription(h, "默认订阅", [withSnapshot, withoutSnapshot]);

    const body = (await (await getCanvas(h, subscriptionId)).json()) as CanvasBody;
    expect(body.nodes.map((item) => item.name)).toEqual(["A1"]);
    expect(body.sources).toMatchObject([
      { name: "机场 A", nodeCount: 1, missingSnapshot: false },
      { name: "机场 B", nodeCount: 0, missingSnapshot: true },
    ]);
  });

  it("flags info nodes and chain landing nodes without removing them", async () => {
    const h = createHarness();
    const [sourceId] = await seedSources(h, ["机场 A"]);
    const landing = node("香港 01", 8388);
    const info = node("剩余流量：100 GB", 8389);
    await putSnapshot(h, sourceId, [landing, info]);
    await h.store.putConfig({
      proxyChains: [
        {
          id: "chain-hk",
          name: "香港出口",
          enabled: true,
          relayNodes: [],
          landingNodes: [{ sourceId, nodeKey: nodeRenameKey(landing) }],
        },
      ],
    });
    const subscriptionId = await createSubscription(h, "默认订阅", [sourceId], ["chain-hk"]);

    const body = (await (await getCanvas(h, subscriptionId)).json()) as CanvasBody;
    expect(body.nodes).toHaveLength(2);
    expect(body.nodes.find((item) => item.name === "香港 01")?.chainLanding).toBe(true);
    expect(body.nodes.find((item) => item.name === "剩余流量：100 GB")?.infoNode).toBe(true);
  });

  it("caps the canvas payload and reports truncation", async () => {
    const h = createHarness();
    const [sourceId] = await seedSources(h, ["机场 A"]);
    const nodes = Array.from({ length: MAX_CANVAS_NODES + 1 }, (_, index) => node(`N${index}`, 10000 + index));
    await putSnapshot(h, sourceId, nodes);
    const subscriptionId = await createSubscription(h, "默认订阅", [sourceId]);

    const body = (await (await getCanvas(h, subscriptionId)).json()) as CanvasBody;
    expect(body.nodes).toHaveLength(MAX_CANVAS_NODES);
    expect(body.nodeCount).toBe(MAX_CANVAS_NODES + 1);
    expect(body.truncated).toBe(true);
  });

  it("returns 404 for an unknown subscription", async () => {
    const h = createHarness();
    const response = await getCanvas(h, "missing-subscription");
    expect(response.status).toBe(404);
  });
});
