import { describe, expect, it } from "vitest";
import {
  IMPORT_TARGETS,
  buildImportDeepLink,
  parseImportTarget,
  type ImportTargetId,
} from "./import-targets";

const SUB_URL = "https://worker.example.com/sub/abcDEF123";

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
});

describe("buildImportDeepLink", () => {
  const cases: Array<[ImportTargetId, string]> = [
    ["clash", "clash://install-config?url=https%3A%2F%2Fworker.example.com%2Fsub%2FabcDEF123"],
    ["stash", "stash://install-config?url=https%3A%2F%2Fworker.example.com%2Fsub%2FabcDEF123"],
    [
      "shadowrocket",
      "shadowrocket://add/sub://aHR0cHM6Ly93b3JrZXIuZXhhbXBsZS5jb20vc3ViL2FiY0RFRjEyMw?remark=%E6%BC%94%E7%A4%BA%E8%AE%A2%E9%98%85",
    ],
    [
      "singbox",
      "sing-box://import-remote-profile?url=https%3A%2F%2Fworker.example.com%2Fsub%2FabcDEF123#%E6%BC%94%E7%A4%BA%E8%AE%A2%E9%98%85",
    ],
    [
      "v2rayng",
      "v2rayng://install-sub?url=https%3A%2F%2Fworker.example.com%2Fsub%2FabcDEF123&name=%E6%BC%94%E7%A4%BA%E8%AE%A2%E9%98%85",
    ],
    [
      "hiddify",
      "hiddify://import/https%3A%2F%2Fworker.example.com%2Fsub%2FabcDEF123",
    ],
  ];

  it("每个客户端都生成约定的深链", () => {
    for (const [target, expected] of cases) {
      expect(buildImportDeepLink(target, { url: SUB_URL, name: "演示订阅" })).toBe(expected);
    }
  });

  it("短链也能作为导入地址", () => {
    const short = "https://worker.example.com/s/abc123XY";
    expect(buildImportDeepLink("clash", { url: short, name: "演示订阅" })).toContain(
      "url=https%3A%2F%2Fworker.example.com%2Fs%2Fabc123XY"
    );
  });

  it("订阅名里的特殊字符被转义，CR/LF 被剥离", () => {
    const link = buildImportDeepLink("v2rayng", { url: SUB_URL, name: "A&B\r\nC" });
    expect(link).toContain("name=A%26B%20C");
    expect(link).not.toMatch(/[\r\n]/);
  });

  it("订阅名超长时截断到 80 字符", () => {
    const link = buildImportDeepLink("singbox", { url: SUB_URL, name: "名".repeat(200) });
    const name = decodeURIComponent(link.split("#")[1] ?? "");
    expect(name).toHaveLength(80);
  });
});
