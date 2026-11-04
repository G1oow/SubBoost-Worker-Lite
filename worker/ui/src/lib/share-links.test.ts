import { describe, expect, it } from "vitest";
import { appendQueryParam, buildAgeLinks, buildImportLinks } from "./share-links";

const LINK = "https://worker.example.com/sub/abcDEF123";

describe("appendQueryParam", () => {
  it("在没有查询串时用 ? 起头", () => {
    expect(appendQueryParam(LINK, "format", "age")).toBe(`${LINK}?format=age`);
  });

  it("已有查询串时用 & 续接", () => {
    expect(appendQueryParam(`${LINK}?a=1`, "format", "age")).toBe(`${LINK}?a=1&format=age`);
  });

  it("保留 fragment 并要求参数落在它前面", () => {
    expect(appendQueryParam(`${LINK}#frag`, "target", "clash")).toBe(
      `${LINK}?target=clash#frag`
    );
  });

  it("对键值做转义", () => {
    expect(appendQueryParam(LINK, "target", "a b")).toBe(`${LINK}?target=a%20b`);
  });
});

describe("buildImportLinks", () => {
  it("为每个客户端生成带 target 的链接", () => {
    const links = buildImportLinks(LINK);
    expect(links.map((item) => item.id)).toEqual([
      "clash",
      "stash",
      "shadowrocket",
      "singbox",
      "v2rayng",
      "hiddify",
    ]);
    for (const item of links) {
      expect(item.href).toBe(`${LINK}?target=${item.id}`);
      expect(item.label.length).toBeGreaterThan(0);
    }
  });
});

describe("buildAgeLinks", () => {
  it("生成二进制与 armor 两种加密链接", () => {
    expect(buildAgeLinks(LINK)).toEqual({
      binary: `${LINK}?format=age`,
      armor: `${LINK}?format=age-armor`,
    });
  });
});
