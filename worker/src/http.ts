import { buildApiErrorBody } from "@subboost/server-core/http";
import { ApiError, BODY_LIMITS } from "./errors";

export { BODY_LIMITS };

/**
 * HSTS：一年，含子域。不加 `preload`——一旦进了浏览器内置名单就极难回滚。
 * 只对 https 响应生效；明文 HTTP 的强制跳转由边缘（Cloudflare Always Use HTTPS）负责，
 * Worker 只能对 `/api/*`、`/sub/*`、`/s/*` 这些自己处理的路径补 308。
 */
export const HSTS_VALUE = "max-age=31536000; includeSubDomains";

/**
 * Worker 直接渲染的 HTML 文档（目前只有 `?target=` 落地页）用的 CSP。
 * 这些页面没有任何脚本，所以 `default-src 'none'`；内联 `<style>` 仍需 `style-src 'unsafe-inline'`。
 */
export const WORKER_DOCUMENT_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'";

export function json(
  data: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  const headers = new Headers({
    "content-type": "application/json;charset=utf-8",
    ...extraHeaders,
  });
  return withSecurityHeaders(new Response(JSON.stringify(data), { status, headers }));
}

export function error(err: ApiError): Response {
  return json(buildApiErrorBody(err.message, err.code), err.status);
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const limit = Math.max(1, Math.floor(maxBytes));
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  }

  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > limit) {
        await reader.cancel("payload too large").catch(() => undefined);
        throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(400, "BAD_REQUEST", "Invalid JSON body.");
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "Invalid JSON body.");
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "Invalid JSON body.");
  }
}

export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  // 调用方已经显式声明缓存策略时不要覆盖，否则无法支持条件请求（304）
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  // HSTS 只对 https 响应有意义；http 响应带它会被浏览器忽略，加了也无害
  if (!headers.has("strict-transport-security")) headers.set("strict-transport-security", HSTS_VALUE);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

