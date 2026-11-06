import { describe, expect, it } from "vitest";
import { formatAppHash, parseAppHash } from "./routes";

describe("app hash routes", () => {
  it("parses top-level pages and falls back to the dashboard", () => {
    expect(parseAppHash("#/sources")).toEqual({ page: "sources", configSection: "rules" });
    expect(parseAppHash("#sources")).toEqual({ page: "sources", configSection: "rules" });
    expect(parseAppHash("")).toEqual({ page: "dashboard", configSection: "rules" });
    expect(parseAppHash("#/unknown")).toEqual({ page: "dashboard", configSection: "rules" });
  });

  it("parses config sub-pages and ignores unknown sections", () => {
    expect(parseAppHash("#/config")).toEqual({ page: "config", configSection: "rules" });
    expect(parseAppHash("#/config/json")).toEqual({ page: "config", configSection: "json" });
    expect(parseAppHash("#/config/rules")).toEqual({ page: "config", configSection: "rules" });
    expect(parseAppHash("#/config/chains")).toEqual({ page: "config", configSection: "chains" });
    // 子页只属于 config：其他页面带上同名后缀也不会被当成子页
    expect(parseAppHash("#/sources/json")).toEqual({ page: "sources", configSection: "rules" });
  });

  it("formats routes back into hashes", () => {
    expect(formatAppHash({ page: "status", configSection: "json" })).toBe("#/status");
    expect(formatAppHash({ page: "config", configSection: "json" })).toBe("#/config/json");
    expect(formatAppHash({ page: "config", configSection: "chains" })).toBe("#/config/chains");
    expect(formatAppHash(parseAppHash("#/config"))).toBe("#/config/rules");
  });
});
