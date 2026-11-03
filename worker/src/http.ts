import { buildApiErrorBody } from "@subboost/server-core/http";
import { ApiError, BODY_LIMITS } from "./errors";

export { BODY_LIMITS };

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
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

