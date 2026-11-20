import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { THEME_INIT_SCRIPT } from "@subboost/ui/theme/theme-init-script";
import { HSTS_VALUE, WORKER_DOCUMENT_CSP } from "../../../worker/src/http";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const headersFile = readFileSync(join(repoRoot, "worker/ui/public/_headers"), "utf8");
const indexHtml = readFileSync(join(repoRoot, "worker/ui/index.html"), "utf8");

type VercelHeaderGroup = { source: string; headers: Array<{ key: string; value: string }> };

function readHeaderValue(text: string, name: string): string | null {
  const target = `${name.toLowerCase()}:`;
  for (const row of text.split(/\r?\n/)) {
    const trimmed = row.trim();
    if (trimmed.toLowerCase().startsWith(target)) return trimmed.slice(target.length).trim();
  }
  return null;
}

function vercelHeader(name: string): string | null {
  const config = JSON.parse(readFileSync(join(repoRoot, "vercel.json"), "utf8")) as {
    headers: VercelHeaderGroup[];
  };
  for (const group of config.headers) {
    for (const header of group.headers) {
      if (header.key.toLowerCase() === name.toLowerCase()) return header.value;
    }
  }
  return null;
}

/**
 * 内联主题脚本必须与 CSP 里钉死的哈希逐字节一致：
 * 改了脚本却忘了改哈希，浏览器的表现是「主题闪一下白再切回深色」——
 * 这种回归肉眼几乎看不出原因，所以用测试把它钉住。
 */
describe("文档 CSP 与内联主题脚本哈希", () => {
  const themeHash = `'sha256-${createHash("sha256").update(THEME_INIT_SCRIPT, "utf8").digest("base64")}'`;

  it("index.html 仍然用注释位内联注入主题脚本", () => {
    expect(indexHtml).toContain("<!--THEME_INIT-->");
  });

  it("_headers 的 CSP 允许内联主题脚本的哈希", () => {
    const policy = readHeaderValue(headersFile, "Content-Security-Policy");
    expect(policy).toContain(themeHash);
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toContain("'unsafe-inline' 'unsafe-eval'");
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it("_headers 与 vercel.json 用同一份 CSP", () => {
    const policy = readHeaderValue(headersFile, "Content-Security-Policy");
    expect(policy).not.toBeNull();
    expect(vercelHeader("Content-Security-Policy")).toBe(policy);
  });
});

describe("HSTS", () => {
  it("_headers 与 vercel.json 都下发同一条 HSTS", () => {
    expect(readHeaderValue(headersFile, "Strict-Transport-Security")).toBe(HSTS_VALUE);
    expect(vercelHeader("Strict-Transport-Security")).toBe(HSTS_VALUE);
    // 不加 preload：一旦进入浏览器内置名单就极难回滚
    expect(HSTS_VALUE).not.toContain("preload");
  });

  it("Worker 文档 CSP 不含脚本能力", () => {
    expect(WORKER_DOCUMENT_CSP.startsWith("default-src 'none'")).toBe(true);
    expect(WORKER_DOCUMENT_CSP).not.toContain("script-src");
    expect(WORKER_DOCUMENT_CSP).toContain("frame-ancestors 'none'");
  });
});
