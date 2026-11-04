import { handleRequest, type WorkerDeps } from "../../../src/index";
import type { AppState } from "../lib/types";
import { createDemoKv } from "./demo-kv";
import { DEMO_SOURCES, DEMO_SUBSCRIPTIONS } from "./demo-seed";

/**
 * 纯静态预览站用的「假后端」。
 *
 * 做法不是另写一套 mock 响应，而是把仓库里真实的 Worker 路由（`src/index.ts`）
 * 跑在浏览器内存里：KV 换成内存实现，远程抓取被禁用。这样预览站展示的
 * 状态结构、校验规则与生成的 Clash 配置都和线上 Worker 是同一份代码，
 * 同时不依赖 Workers 运行时，也没有任何持久化。
 */
export type DemoBackend = {
  dispatch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

const DEFAULT_ORIGIN = "http://demo.local";

// 演示环境专用的固定值与口令：只在当前页面内存里生效，不是真实凭据
const DEMO_TOKEN = "demo-preview-token";

const ASSETS_STUB: Fetcher = {
  fetch: async () => new Response("Not found", { status: 404 }),
};

/** 演示模式不联网：远程源统一返回 403，避免浏览器直接去抓真实订阅地址 */
const demoFetchText: NonNullable<WorkerDeps["fetchText"]> = async (url) => ({
  status: 403,
  headers: {},
  text: "",
  finalUrl: url,
});

export function createDemoBackend(options: { origin?: string } = {}): DemoBackend {
  const env = {
    SUBBOOST_KV: createDemoKv(),
    ASSETS: ASSETS_STUB,
    ADMIN_TOKEN: DEMO_TOKEN,
    ENCRYPTION_KEY: "demo-fixture-encryption-passphrase",
    APP_NAME: "SubBoost Lite",
  } as unknown as Env;

  let ready: Promise<void> | null = null;

  function resolveOrigin(): string {
    if (options.origin) return options.origin;
    const current = (globalThis as { location?: { origin?: string } }).location;
    return current?.origin ?? DEFAULT_ORIGIN;
  }

  async function send(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    // 演示环境里没有真实凭据：统一注入演示 token，让路由的鉴权环节通过
    headers.set("authorization", `Bearer ${DEMO_TOKEN}`);
    const hasBody = init.body !== undefined && init.body !== null;
    const request = new Request(new URL(path, resolveOrigin()), {
      method: init.method ?? "GET",
      headers,
      ...(hasBody ? { body: init.body as BodyInit } : {}),
    });
    return handleRequest(request, env, { fetchText: demoFetchText });
  }

  /** 用真实 API 灌入演示数据：写源 → 建订阅 → 跑一次刷新，得到快照与状态 */
  async function bootstrap(): Promise<void> {
    const savedResponse = await send("/api/sources", {
      method: "PUT",
      body: JSON.stringify({ sources: DEMO_SOURCES }),
    });
    if (!savedResponse.ok) {
      throw new Error(`演示数据初始化失败：写入源返回 ${savedResponse.status}`);
    }
    const saved = (await savedResponse.json()) as { sources: AppState["sources"] };

    for (const subscription of DEMO_SUBSCRIPTIONS) {
      const sourceIds = subscription.sourceIndexes
        .map((index) => saved.sources[index]?.id)
        .filter((id): id is string => Boolean(id));
      await send("/api/subscriptions", {
        method: "POST",
        body: JSON.stringify({ name: subscription.name, sourceIds }),
      });
    }

    await send("/api/refresh", { method: "POST" });
  }

  function ensureReady(): Promise<void> {
    if (!ready) {
      ready = bootstrap().catch((err) => {
        // 初始化失败时清空，让下一次请求重试而不是永久卡在失败状态
        ready = null;
        throw err;
      });
    }
    return ready;
  }

  return {
    async dispatch(input, init) {
      await ensureReady();
      const target =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return send(target, init);
    },
  };
}

let singleton: DemoBackend | null = null;

/** 浏览器里只需要一个内存后端实例，否则每次请求都会重置演示数据 */
export function getDemoBackend(): DemoBackend {
  if (!singleton) singleton = createDemoBackend();
  return singleton;
}
