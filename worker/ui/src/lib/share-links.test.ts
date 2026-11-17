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
  const NAME = "演示订阅";

  it("为每个客户端生成直接指向客户端 scheme 的深链", () => {
    const links = buildImportLinks(LINK, NAME);
    expect(links.map((item) => item.id)).toEqual([
      "clash",
      "mihomo",
      "stash",
      "shadowrocket",
      "singbox",
      "v2rayng",
      "hiddify",
    ]);

    const encodedUrl = encodeURIComponent(LINK);
    const encodedName = encodeURIComponent(NAME);
    const hrefs = new Map(links.map((item) => [item.id, item.href]));
    expect(hrefs.get("clash")).toBe(`clash://install-config?url=${encodedUrl}`);
    expect(hrefs.get("mihomo")).toBe(
      `mihomo://install-config?url=${encodedUrl}&name=${encodedName}`
    );
    expect(hrefs.get("stash")).toBe(`stash://install-config?url=${encodedUrl}`);
    expect(hrefs.get("shadowrocket")).toBe(
      `shadowrocket://add/sub://${btoa(LINK)}?remark=${encodedName}`
    );
    expect(hrefs.get("singbox")).toBe(
      `sing-box://import-remote-profile?url=${encodedUrl}#${encodedName}`
    );
    expect(hrefs.get("v2rayng")).toBe(`v2rayng://install-sub?url=${encodedUrl}#${encodedName}`);
    expect(hrefs.get("hiddify")).toBe(`hiddify://import/${encodedUrl}#${encodedName}`);

    for (const item of links) {
      // 不再绕服务端的 `?target=` 302：点了就是用户手势，浏览器一定放行
      expect(item.href).not.toContain("?target=");
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  it("订阅名里的换行被剥离，不会撑破深链", () => {
    for (const item of buildImportLinks(LINK, "A\r\nB")) {
      expect(item.href).not.toMatch(/[\r\n]/);
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
