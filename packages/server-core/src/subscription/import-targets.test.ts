import { describe, expect, it } from "vitest";
import {
  IMPORT_TARGETS,
  buildImportDeepLink,
  importTargetLabel,
  parseImportTarget,
  type ImportTargetId,
} from "./import-targets";

const SUB_URL = "https://worker.example.com/sub/abcDEF123";
const NAME = "演示订阅";

describe("parseImportTarget", () => {
  it("识别全部受支持的客户端并忽略大小写与空白", () => {
    for (const target of IMPORT_TARGETS) {
      expect(parseImportTarget(target.id)).toBe(target.id);
      expect(parseImportTarget(` ${target.id.toUpperCase()} `)).toBe(target.id);
    }
  });

  it("未知、空值与缺失都返回 null", () => {
    expect(parseImportTarget("clashx")).toBeNull();
    expect(parseImportTarget("")).toBeNull();
    expect(parseImportTarget("   ")).toBeNull();
    expect(parseImportTarget(null)).toBeNull();
    expect(parseImportTarget(undefined)).toBeNull();
  });

  it("每个客户端都有展示名", () => {
    for (const target of IMPORT_TARGETS) {
      expect(target.label.length).toBeGreaterThan(0);
    }
  });
});

describe("importTargetLabel", () => {
  it("每个客户端都返回中文之外的展示名，未知 id 回退成 id", () => {
    expect(importTargetLabel("clash")).toBe("Clash / Mihomo");
    expect(importTargetLabel("v2rayng")).toBe("v2rayNG");
    expect(importTargetLabel("unknown" as ImportTargetId)).toBe("unknown");
  });
});

describe("buildImportDeepLink", () => {
  const encodedUrl = encodeURIComponent(SUB_URL);
  const encodedName = encodeURIComponent(NAME);

  const cases: Array<[ImportTargetId, string]> = [
    ["clash", `clash://install-config?url=${encodedUrl}`],
    ["mihomo", `mihomo://install-config?url=${encodedUrl}&name=${encodedName}`],
    ["stash", `stash://install-config?url=${encodedUrl}`],
    ["shadowrocket", `shadowrocket://add/sub://${btoa(SUB_URL)}?remark=${encodedName}`],
    ["singbox", `sing-box://import-remote-profile?url=${encodedUrl}#${encodedName}`],
    ["v2rayng", `v2rayng://install-sub?url=${encodedUrl}#${encodedName}`],
    ["hiddify", `hiddify://import/${encodedUrl}#${encodedName}`],
  ];

  it("每个客户端都生成约定的深链", () => {
    for (const [target, expected] of cases) {
      expect(buildImportDeepLink(target, { url: SUB_URL, name: NAME })).toBe(expected);
    }
  });

  it("用例表覆盖全部受支持的客户端", () => {
    expect(cases.map(([target]) => target).sort()).toEqual(
      IMPORT_TARGETS.map((target) => target.id).sort()
    );
  });

  it("Shadowrocket 用标准 base64，不用 URL-safe 变体", () => {
    // 这条链接的 base64 里带 `+`：换成 URL-safe 会把 `+` 变 `-`、`/` 变 `_`、去掉 `=`，
    // Shadowrocket 按标准 base64 解析该路径段会直接拒绝 → 「App 拉起但什么都没导入」
    const url = "https://worker.example.com/sub/aB3?z=~~";
    expect(btoa(url)).toContain("+");

    const link = buildImportDeepLink("shadowrocket", { url, name: NAME });
    const payload = link.slice("shadowrocket://add/sub://".length, link.indexOf("?remark="));
    expect(payload).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(payload).not.toContain("-");
    expect(payload).not.toContain("_");
    expect(atob(payload)).toBe(url);
  });

  it("短链也能作为导入地址", () => {
    const short = "https://worker.example.com/s/abc123XY";
    expect(buildImportDeepLink("clash", { url: short, name: NAME })).toContain(
      `url=${encodeURIComponent(short)}`
    );
  });

  it("订阅名里的特殊字符被转义，CR/LF 被剥离", () => {
    const link = buildImportDeepLink("v2rayng", { url: SUB_URL, name: "A&B\r\nC" });
    expect(link).toContain("#A%26B%20C");
    expect(link).not.toMatch(/[\r\n]/);
  });

  it("订阅名超长时截断到 80 字符", () => {
    const link = buildImportDeepLink("singbox", { url: SUB_URL, name: "名".repeat(200) });
    const name = decodeURIComponent(link.split("#")[1] ?? "");
    expect(name).toHaveLength(80);
  });
});
