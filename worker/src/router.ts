import { parseSubscription } from "@subboost/core/parser";
import { encryptAge } from "@subboost/server-core/crypto/age";
import { armorAge } from "@subboost/server-core/crypto/age-armor";
import { buildSubscriptionResponseHeaders } from "@subboost/server-core/subscription/response-headers";
import {
  buildImportDeepLink,
  parseImportTarget,
  type ImportTargetId,
} from "@subboost/server-core/subscription/import-targets";
import pkg from "../package.json";
import { ageCapabilities, resolveAgeConfig, type AgeResolution } from "./age";
import { requireAdmin } from "./auth";
import { ApiError, BODY_LIMITS } from "./errors";
import { error, json, readJsonBody, withSecurityHeaders } from "./http";
import {
  buildCacheETag,
  getOrGenerateSubscription,
  getOrGenerateSubscriptionByShortCode,
  loadSubscriptionNodes,
  previewConfig,
  refreshAll,
  type GetOrGenerateResult,
  type PipelineDeps,
} from "./pipeline";
import { buildDashboardStats } from "./dashboard";
import { collectNodeSummaries, countRenamedNodes, sanitizeNodeRenames } from "./node-renames";
import { fetchText } from "./safe-fetch";
import { resolveDefaultUserAgent } from "./sources";
import { validatePublicHttpUrl } from "./ssrf";
import { createStore, type Store } from "./store";
import { normalizeProxyChains } from "@subboost/core/subscription/config-utils";
import {
  MAX_MANUAL_TEXT_BYTES,
  MAX_PARSE_ERRORS,
  MAX_SOURCE_NAME_LENGTH,
  MAX_SOURCES,
  MAX_SUBSCRIPTIONS,
  MAX_USER_AGENT_LENGTH,
  SHORT_CODE_PATTERN,
  type SnapshotRecord,
  type SourceInput,
  type StoredSubscription,
} from "./types";

export type RouterDeps = {
  pipeline?: PipelineDeps;
  now?: () => Date;
};

const APP_NAME_FALLBACK = "SubBoost Lite";
const SUBSCRIPTION_NAME_MAX_LENGTH = 80;

function appName(env: Env): string {
  return env.APP_NAME?.trim() || APP_NAME_FALLBACK;
}

function buildPipelineDeps(env: Env, overrides: RouterDeps): PipelineDeps {
  const now = overrides.now ?? (() => new Date());
  return (
    overrides.pipeline ?? {
      store: createStore(env),
      fetchText,
      now,
      defaultUserAgent: resolveDefaultUserAgent(env),
    }
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function readOrderIds(body: unknown): string[] {
  if (!isPlainObject(body) || !Array.isArray(body.ids) || !body.ids.every((id) => typeof id === "string")) {
    throw new ApiError(400, "VALIDATION_ERROR", "请求体必须包含字符串 ids 数组");
  }
  return body.ids as string[];
}

/**
 * 校验并去重订阅勾选的链。
 *
 * 链存在配置里，`chain:<id>` 又是规则目标的引用键，所以未知 id 必须显式拒绝：
 * 静默忽略会让用户以为勾上了，实际什么都没生成。
 */
async function validateChainIds(store: Store, input: unknown): Promise<string[]> {
  if (input === undefined) return [];
  if (!Array.isArray(input)) {
    throw new ApiError(400, "VALIDATION_ERROR", "chainIds 必须是数组");
  }
  const chainIds = [...new Set(input.filter((value): value is string => typeof value === "string"))];
  if (chainIds.length === 0) return chainIds;
  const { config } = await store.getConfig();
  const known = new Set(normalizeProxyChains(config.proxyChains).map((chain) => chain.id));
  const unknown = chainIds.filter((chainId) => !known.has(chainId));
  if (unknown.length > 0) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      `链不存在：${unknown.slice(0, 3).join("、")}（链可能已被删除，请刷新页面后重新选择）`
    );
  }
  return chainIds;
}

async function validateSources(input: unknown): Promise<SourceInput[]> {
  if (!isPlainObject(input) || !Array.isArray(input.sources)) {
    throw new ApiError(400, "VALIDATION_ERROR", "请求体必须包含 sources 数组");
  }
  const raw = input.sources;
  if (raw.length > MAX_SOURCES) {
    throw new ApiError(400, "VALIDATION_ERROR", `最多允许 ${MAX_SOURCES} 个源`);
  }

  const sources: SourceInput[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index];
    const prefix = `第 ${index + 1} 个源：`;
    if (!isPlainObject(item)) {
      throw new ApiError(400, "VALIDATION_ERROR", `${prefix}格式不正确`);
    }

    const name = stringField(item.name).trim();
    if (name.length < 1 || name.length > MAX_SOURCE_NAME_LENGTH) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        `${prefix}名称长度必须在 1 到 ${MAX_SOURCE_NAME_LENGTH} 字符之间`
      );
    }

    const kind = item.kind;
    if (kind !== "remote" && kind !== "manual") {
      throw new ApiError(400, "VALIDATION_ERROR", `${prefix}类型必须是 remote 或 manual`);
    }

    const userAgent = typeof item.userAgent === "string" ? item.userAgent.trim() : "";
    if (userAgent && (userAgent.length < 1 || userAgent.length > MAX_USER_AGENT_LENGTH)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        `${prefix}User-Agent 长度必须在 1 到 ${MAX_USER_AGENT_LENGTH} 字符之间`
      );
    }

    const nodeRenames = sanitizeNodeRenames(item.nodeRenames);
    if (kind === "remote") {
      const url = stringField(item.url).trim();
      const validation = validatePublicHttpUrl(url);
      if (!validation.ok) {
        throw new ApiError(400, "VALIDATION_ERROR", `${prefix}${validation.reason}`);
      }
      sources.push({
        ...(typeof item.id === "string" && item.id ? { id: item.id } : {}),
        name,
        kind,
        url,
        enabled: item.enabled !== false,
        ...(userAgent ? { userAgent } : {}),
        ...(nodeRenames ? { nodeRenames } : {}),
      });
      continue;
    }

    const manualText = stringField(item.manualText);
    if (new TextEncoder().encode(manualText).byteLength > MAX_MANUAL_TEXT_BYTES) {
      throw new ApiError(400, "VALIDATION_ERROR", `${prefix}手动节点文本超过 512 KiB`);
    }
    let parsed;
    try {
      parsed = parseSubscription(manualText);
    } catch (err) {
      const errorName = err instanceof Error ? err.name : "Error";
      throw new ApiError(400, "VALIDATION_ERROR", `${prefix}解析失败: ${errorName}`);
    }
    if (parsed.nodes.length === 0) {
      const summary = parsed.errors.slice(0, 3).join("；") || "未解析到任何节点";
      throw new ApiError(400, "VALIDATION_ERROR", `${prefix}${summary}`);
    }
    sources.push({
      ...(typeof item.id === "string" && item.id ? { id: item.id } : {}),
      name,
      kind,
      manualText,
      enabled: item.enabled !== false,
      ...(userAgent ? { userAgent } : {}),
      ...(nodeRenames ? { nodeRenames } : {}),
    });
  }

  return sources;
}

function requireObjectBody(body: unknown): Record<string, unknown> {
  if (!isPlainObject(body)) {
    throw new ApiError(400, "VALIDATION_ERROR", "请求体必须是 JSON 对象");
  }
  return body;
}

async function handleApi(request: Request, env: Env, deps: RouterDeps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const pipelineDeps = buildPipelineDeps(env, deps);
  const store = pipelineDeps.store;

  if (path === "/api/health" && method === "GET") {
    return json({ ok: true });
  }

  await requireAdmin(request, env);

  if (path === "/api/state" && method === "GET") {
    const [{ config, isDefault }, sources, subscriptions, status] = await Promise.all([
      store.getConfig(),
      store.listSources(),
      store.listSubscriptions(url.origin),
      store.getStatus(),
    ]);
    return json({
      app: { name: appName(env), version: pkg.version },
      sources,
      subscriptions,
      config,
      configIsDefault: isDefault,
      status,
      // 管理端据此决定是否显示 age 加密链接与一键导入按钮
      capabilities: { age: ageCapabilities(resolveAgeConfig(env)) },
    });
  }

  if (path === "/api/sources/order" && method === "PUT") {
    const ids = readOrderIds(await readJsonBody(request, BODY_LIMITS.small));
    return json({ sources: await store.reorderSources(ids) });
  }

  if (path === "/api/sources" && method === "PUT") {
    const body = await readJsonBody(request, BODY_LIMITS.large);
    const inputs = await validateSources(body);
    const sources = await store.saveSources(inputs);
    return json({ sources });
  }

  if (path === "/api/dashboard" && method === "GET") {
    const [sources, subscriptions, status] = await Promise.all([
      store.listSources(),
      store.listSubscriptions(url.origin),
      store.getStatus(),
    ]);
    const snapshots = new Map<string, SnapshotRecord | null>();
    await Promise.all(
      sources.map(async (source) => {
        snapshots.set(source.id, await store.getSnapshot(source.id));
      })
    );
    return json(
      buildDashboardStats({
        sources,
        subscriptions,
        status,
        snapshots,
        generatedAt: pipelineDeps.now().toISOString(),
      })
    );
  }

  // 解析一段节点文本，供「导入节点」时预览名称与协议
  if (path === "/api/nodes/parse" && method === "POST") {
    const body = requireObjectBody(await readJsonBody(request, BODY_LIMITS.large));
    const text = stringField(body.text);
    if (new TextEncoder().encode(text).byteLength > MAX_MANUAL_TEXT_BYTES) {
      throw new ApiError(400, "VALIDATION_ERROR", "节点文本超过 512 KiB");
    }
    if (!text.trim()) {
      return json({ nodes: [], totalParsed: 0, totalFailed: 0, errors: [] });
    }
    let parsed;
    try {
      parsed = parseSubscription(text);
    } catch (err) {
      const errorName = err instanceof Error ? err.name : "Error";
      throw new ApiError(400, "VALIDATION_ERROR", `解析失败: ${errorName}`);
    }
    return json({
      nodes: collectNodeSummaries(parsed.nodes, sanitizeNodeRenames(body.renames)),
      totalParsed: parsed.totalParsed,
      totalFailed: parsed.totalFailed,
      errors: parsed.errors.slice(0, MAX_PARSE_ERRORS),
    });
  }

  // 某个源当前的节点列表（含已应用的重命名），用于节点改名与仪表板
  const sourceNodesMatch = /^\/api\/sources\/([^/]+)\/nodes$/.exec(path);
  if (sourceNodesMatch && method === "GET") {
    const sourceId = decodeURIComponent(sourceNodesMatch[1]);
    const sources = await store.listSources();
    const source = sources.find((item) => item.id === sourceId);
    if (!source) throw new ApiError(404, "NOT_FOUND", "源不存在");

    const snapshot = await store.getSnapshot(source.id);
    let nodes = snapshot?.nodes ?? [];
    let parseErrors = snapshot?.parseErrors ?? [];
    // 手动源还没快照时直接解析文本，编辑改名时也能立刻看到节点
    if (!snapshot && source.kind === "manual") {
      try {
        const parsed = parseSubscription(source.manualText ?? "");
        nodes = parsed.nodes;
        parseErrors = parsed.errors.slice(0, MAX_PARSE_ERRORS);
      } catch {
        nodes = [];
        parseErrors = [];
      }
    }

    return json({
      source: {
        id: source.id,
        name: source.name,
        kind: source.kind,
        enabled: source.enabled,
        nodeRenames: source.nodeRenames ?? {},
      },
      fetchedAt: snapshot?.fetchedAt ?? null,
      nodeCount: nodes.length,
      renamedCount: countRenamedNodes(nodes, source.nodeRenames),
      nodes: collectNodeSummaries(nodes, source.nodeRenames),
      parseErrors,
    });
  }

  // 某条订阅的节点列表（按已保存的自定义顺序排好）：生成配置页「节点排序」画布用。
  // 与订阅生成走同一条合并链路，画布序号即输出顺序。
  const subscriptionNodesMatch = /^\/api\/subscriptions\/([^/]+)\/nodes$/.exec(path);
  if (subscriptionNodesMatch && method === "GET") {
    const subscriptionId = decodeURIComponent(subscriptionNodesMatch[1]);
    const subscription = (await store.listStoredSubscriptions()).find((item) => item.id === subscriptionId);
    if (!subscription) throw new ApiError(404, "NOT_FOUND", "订阅不存在");
    // order=source 供画布「重置为源顺序」使用：跳过自定义顺序，与清空 nodeOrder 后的输出一致
    const order = url.searchParams.get("order") === "source" ? "source" : "saved";
    return json(await loadSubscriptionNodes(pipelineDeps, subscription, { order }));
  }

  // 用草稿配置试生成：只读，不抓上游、不写缓存，供管理端保存前校验
  if (path === "/api/config/preview" && method === "POST") {
    const body = requireObjectBody(await readJsonBody(request, BODY_LIMITS.large));
    if (!isPlainObject(body.config)) {
      throw new ApiError(400, "VALIDATION_ERROR", "config 必须是 JSON 对象");
    }
    const result = await previewConfig(pipelineDeps, body.config);
    if (!result.ok) throw new ApiError(400, "VALIDATION_ERROR", result.error);
    return json(result.preview);
  }

  if (path === "/api/config" && method === "PUT") {
    const body = await readJsonBody(request, BODY_LIMITS.large);
    const config = requireObjectBody(body);
    await store.putConfig(config);
    return json({ config, configIsDefault: false });
  }

  if (path === "/api/config" && method === "DELETE") {
    await store.resetConfig();
    const { config } = await store.getConfig();
    return json({ config, configIsDefault: true });
  }

  if (path === "/api/subscriptions/order" && method === "PUT") {
    const ids = readOrderIds(await readJsonBody(request, BODY_LIMITS.small));
    return json({ subscriptions: await store.reorderSubscriptions(ids, url.origin) });
  }

  if (path === "/api/subscriptions" && method === "POST") {
    const body = requireObjectBody(await readJsonBody(request, BODY_LIMITS.small));
    const name = stringField(body.name).trim();
    if (name.length < 1 || name.length > SUBSCRIPTION_NAME_MAX_LENGTH) {
      throw new ApiError(400, "VALIDATION_ERROR", "订阅名称长度必须在 1 到 80 字符之间");
    }
    const rawSourceIds = body.sourceIds;
    if (rawSourceIds !== undefined && !Array.isArray(rawSourceIds)) {
      throw new ApiError(400, "VALIDATION_ERROR", "sourceIds 必须是数组");
    }
    const sourceIds = Array.isArray(rawSourceIds)
      ? rawSourceIds.filter((value): value is string => typeof value === "string")
      : [];
    const chainIds = await validateChainIds(store, body.chainIds);

    const existing = await store.listStoredSubscriptions();
    if (existing.length >= MAX_SUBSCRIPTIONS) {
      throw new ApiError(400, "VALIDATION_ERROR", `最多允许 ${MAX_SUBSCRIPTIONS} 条订阅`);
    }

    const { dto, token } = await store.createSubscription({ name, sourceIds, chainIds });
    // 用本次创建的 token 组装链接，避免多订阅时误取列表首项
    return json({ subscription: { ...dto, link: `${url.origin}/sub/${token}` } }, 201);
  }

  const rotateMatch = /^\/api\/subscriptions\/([^/]+)\/rotate$/.exec(path);
  if (rotateMatch && method === "POST") {
    const subscription = await store.rotateSubscriptionToken(
      decodeURIComponent(rotateMatch[1]),
      url.origin
    );
    if (!subscription) throw new ApiError(404, "NOT_FOUND", "订阅不存在");
    return json({ subscription });
  }

  // 短链：每条订阅最多一条，重复生成幂等（返回同一个码），DELETE 为撤销
  const shortLinkMatch = /^\/api\/subscriptions\/([^/]+)\/short-link$/.exec(path);
  if (shortLinkMatch && (method === "POST" || method === "DELETE")) {
    const id = decodeURIComponent(shortLinkMatch[1]);
    const subscription =
      method === "POST"
        ? await store.createShortLink(id, url.origin)
        : await store.revokeShortLink(id, url.origin);
    if (!subscription) throw new ApiError(404, "NOT_FOUND", "订阅不存在");
    return json({ subscription });
  }

  const subscriptionIdMatch = /^\/api\/subscriptions\/([^/]+)$/.exec(path);

  // 随时修改订阅的名称与所含源；链接不变，但会丢弃旧缓存以便按新源重新生成
  if (subscriptionIdMatch && method === "PATCH") {
    const id = decodeURIComponent(subscriptionIdMatch[1]);
    const body = requireObjectBody(await readJsonBody(request, BODY_LIMITS.small));
    const patch: { name?: string; sourceIds?: string[]; chainIds?: string[] } = {};

    if (body.name !== undefined) {
      const name = stringField(body.name).trim();
      if (name.length < 1 || name.length > SUBSCRIPTION_NAME_MAX_LENGTH) {
        throw new ApiError(400, "VALIDATION_ERROR", "订阅名称长度必须在 1 到 80 字符之间");
      }
      patch.name = name;
    }

    if (body.sourceIds !== undefined) {
      if (!Array.isArray(body.sourceIds)) {
        throw new ApiError(400, "VALIDATION_ERROR", "sourceIds 必须是数组");
      }
      const sourceIds = [
        ...new Set(body.sourceIds.filter((value): value is string => typeof value === "string")),
      ];
      const sources = await store.listSources();
      const known = new Set(sources.map((source) => source.id));
      const unknown = sourceIds.filter((sourceId) => !known.has(sourceId));
      if (unknown.length > 0) {
        // 客户端拿到的源列表可能是旧的：指出这些 id 已不存在，提示刷新后重选，避免只看到一串乱码 id
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          `源不存在：${unknown.slice(0, 3).join("、")}（源可能已被删除，请刷新页面后重新选择）`
        );
      }
      patch.sourceIds = sourceIds;
    }

    if (body.chainIds !== undefined) {
      patch.chainIds = await validateChainIds(store, body.chainIds);
    }

    const subscription = await store.updateSubscription(id, patch, url.origin);
    if (!subscription) throw new ApiError(404, "NOT_FOUND", "订阅不存在");
    return json({ subscription });
  }

  if (subscriptionIdMatch && method === "DELETE") {
    const deleted = await store.deleteSubscription(decodeURIComponent(subscriptionIdMatch[1]));
    if (!deleted) throw new ApiError(404, "NOT_FOUND", "订阅不存在");
    return withSecurityHeaders(new Response(null, { status: 204 }));
  }

  if (path === "/api/refresh" && method === "POST") {
    const result = await refreshAll(pipelineDeps, { trigger: "manual" });
    if ("skipped" in result) {
      throw new ApiError(409, "REFRESH_IN_PROGRESS", "刷新进行中");
    }
    return json({ status: result.status });
  }

  if (path.startsWith("/api/")) {
    throw new ApiError(404, "NOT_FOUND", "接口不存在");
  }

  throw new ApiError(404, "NOT_FOUND", "接口不存在");
}

function textResponse(
  body: string,
  status: number,
  extraHeaders?: Record<string, string>,
  omitBody = false
): Response {
  const headers = new Headers({
    "content-type": "text/plain;charset=utf-8",
    ...extraHeaders,
  });
  return withSecurityHeaders(new Response(omitBody ? null : body, { status, headers }));
}

/**
 * If-None-Match 匹配：支持弱校验前缀（W/）、逗号分隔的多值与 "*"。
 */
function matchesETag(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const normalized = etag.replace(/^W\//, "");
  return ifNoneMatch.split(",").some((raw) => {
    const candidate = raw.trim().replace(/^W\//, "");
    return candidate === "*" || candidate === normalized;
  });
}

type SubscriptionFormat = "yaml" | "age" | "age-armor";

/** `?format=` 只认这两个加密格式；其余值（含乱填）一律按默认 YAML 处理 */
function parseSubscriptionFormat(value: string | null): SubscriptionFormat {
  return value === "age" || value === "age-armor" ? value : "yaml";
}

type SubscriptionEntry = {
  age: AgeResolution;
  format: SubscriptionFormat;
  target: ImportTargetId | null;
  /** 按 token / 短码生成或读取订阅缓存 */
  resolve: () => Promise<GetOrGenerateResult>;
  /** 只查订阅是否存在：深链跳转不该触发上游抓取 */
  findStored: () => Promise<StoredSubscription | null>;
};

/**
 * 订阅输出（`/sub/<token>` 与 `/s/<code>` 共用）。
 * 两种入口只在「怎么找到订阅」上不同，输出与错误处理必须完全一致，
 * 因此把解析动作交给调用方，其他逻辑留在这里。
 */
async function handleSubscription(request: Request, entry: SubscriptionEntry): Promise<Response> {
  const isHead = request.method.toUpperCase() === "HEAD";
  // 只出密文模式：配了合法公钥且显式打开 AGE_ONLY 才生效
  const encryptedOnly = entry.age.status === "ok" && entry.age.only;

  if (encryptedOnly && entry.format === "yaml") {
    // 在查订阅之前就拒绝，不泄漏某条订阅是否存在
    return textResponse("Encrypted output only", 403, undefined, isHead);
  }

  if (entry.target) {
    // 一键导入只做「订阅存在 + 拼深链」，不生成 YAML、不做加密
    let stored: StoredSubscription | null;
    try {
      stored = await entry.findStored();
    } catch {
      return textResponse("Internal error", 500, undefined, isHead);
    }
    if (!stored) return textResponse("Not found", 404, undefined, isHead);

    const plainUrl = new URL(request.url);
    plainUrl.searchParams.delete("target");
    const location = buildImportDeepLink(entry.target, {
      url: plainUrl.toString(),
      name: stored.name,
    });
    return withSecurityHeaders(
      new Response(null, {
        status: 302,
        headers: {
          location,
          "cache-control": "no-store",
          "x-robots-tag": "noindex",
        },
      })
    );
  }

  if (entry.format !== "yaml") {
    if (entry.age.status === "disabled") {
      return textResponse("Age recipient not configured", 503, undefined, isHead);
    }
    if (entry.age.status === "invalid") {
      return textResponse("Age recipient invalid", 503, undefined, isHead);
    }
  }

  let result: GetOrGenerateResult;
  try {
    result = await entry.resolve();
  } catch {
    // /sub/* 与 /s/* 的非 200 响应体一律为纯文本，不使用 JSON 错误体
    return textResponse("Internal error", 500, undefined, isHead);
  }

  if (result.kind === "not-found") {
    return textResponse("Not found", 404, undefined, isHead);
  }
  if (result.kind === "no-nodes") {
    return textResponse("No nodes available", 503, { "Retry-After": "600" }, isHead);
  }

  if (entry.age.status === "ok" && entry.format !== "yaml") {
    return await buildAgeSubscriptionResponse(
      result,
      entry.age.recipients,
      entry.format,
      isHead
    );
  }

  const etag = await buildCacheETag(result.cache);
  const headers = buildSubscriptionResponseHeaders(result.sub.name, result.info ?? {}, {
    // 允许客户端/中间层存副本，但每次使用前必须回源校验（配合 ETag 走 304）
    cacheControl: "private, no-cache",
    cacheExpirySeconds: 43200,
    autoUpdateIntervalSeconds: 43200,
    isAdmin: false,
  });
  headers["etag"] = etag;
  headers["x-robots-tag"] = "noindex";

  // 客户端带上 If-None-Match 且内容没变时只回 304，省掉整个 YAML 的传输量
  if (matchesETag(request.headers.get("if-none-match"), etag)) {
    return withSecurityHeaders(new Response(null, { status: 304, headers }));
  }

  const response = new Response(isHead ? null : result.cache.yaml, { status: 200, headers });
  return withSecurityHeaders(response);
}

/** age 加密输出：`?format=age` 给二进制，`?format=age-armor` 给 PEM 文本 */
async function buildAgeSubscriptionResponse(
  result: Extract<GetOrGenerateResult, { kind: "ok" }>,
  recipients: string[],
  format: Exclude<SubscriptionFormat, "yaml">,
  isHead: boolean
): Promise<Response> {
  let body: Uint8Array | string;
  try {
    const encrypted = await encryptAge({ plaintext: result.cache.yaml, recipients });
    body = format === "age-armor" ? armorAge(encrypted) : encrypted;
  } catch {
    return textResponse("Internal error", 500, undefined, isHead);
  }

  const headers = buildSubscriptionResponseHeaders(result.sub.name, result.info ?? {}, {
    // 密文每次都不一样（随机 file key 与 payload nonce），不发 ETag、不进任何缓存
    cacheControl: "no-store",
    cacheExpirySeconds: 43200,
    autoUpdateIntervalSeconds: 43200,
    isAdmin: false,
    fileNameSuffix: ".yaml.age",
  });
  headers["content-type"] =
    format === "age-armor" ? "text/plain;charset=utf-8" : "application/octet-stream";
  headers["x-robots-tag"] = "noindex";

  // Uint8Array 在运行时就是合法的 BodyInit，只是 TS 6 的泛型把 buffer 类型收得过窄
  const payload = isHead ? null : (body as BodyInit);
  return withSecurityHeaders(new Response(payload, { status: 200, headers }));
}

export async function route(
  request: Request,
  env: Env,
  deps: RouterDeps = {}
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  try {
    const isHead = request.method.toUpperCase() === "HEAD";

    if (path.startsWith("/sub/")) {
      let token: string;
      try {
        token = decodeURIComponent(path.slice("/sub/".length));
      } catch {
        return textResponse("Not found", 404, undefined, isHead);
      }
      if (!token || token.includes("/")) {
        return textResponse("Not found", 404, undefined, isHead);
      }
      const pipelineDeps = buildPipelineDeps(env, deps);
      return await handleSubscription(request, {
        age: resolveAgeConfig(env),
        format: parseSubscriptionFormat(url.searchParams.get("format")),
        target: parseImportTarget(url.searchParams.get("target")),
        resolve: () => getOrGenerateSubscription(pipelineDeps, token),
        findStored: () => pipelineDeps.store.findSubscriptionByToken(token),
      });
    }

    // 短链：非法格式直接 404，不拿任意路径去消耗 KV 读
    if (path.startsWith("/s/")) {
      let code: string;
      try {
        code = decodeURIComponent(path.slice("/s/".length));
      } catch {
        return textResponse("Not found", 404, undefined, isHead);
      }
      if (!SHORT_CODE_PATTERN.test(code)) {
        return textResponse("Not found", 404, undefined, isHead);
      }
      const pipelineDeps = buildPipelineDeps(env, deps);
      return await handleSubscription(request, {
        age: resolveAgeConfig(env),
        format: parseSubscriptionFormat(url.searchParams.get("format")),
        target: parseImportTarget(url.searchParams.get("target")),
        resolve: () => getOrGenerateSubscriptionByShortCode(pipelineDeps, code),
        findStored: () => pipelineDeps.store.findSubscriptionByShortCode(code),
      });
    }

    if (path.startsWith("/api/")) {
      return await handleApi(request, env, deps);
    }

    return await env.ASSETS.fetch(request);
  } catch (err) {
    if (err instanceof ApiError) return error(err);
    console.error("unhandled route error", err instanceof Error ? err.name : "Error");
    return error(new ApiError(500, "INTERNAL_ERROR", "Internal error"));
  }
}



