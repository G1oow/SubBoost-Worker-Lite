import { describe, expect, it } from "vitest";
import { buildImportLandingPage } from "./import-landing";
import { IMPORT_TARGETS, buildImportDeepLink } from "./import-targets";

const LINK = "https://worker.example.com/sub/abcDEF123";
const NAME = "演示订阅";

function page(overrides: Partial<Parameters<typeof buildImportLandingPage>[0]> = {}): string {
  return buildImportLandingPage({
    appName: "SubBoost Lite",
    link: LINK,
    name: NAME,
    target: "clash",
    ...overrides,
  });
}

describe("buildImportLandingPage", () => {
  it("是一份自包含的完整 HTML 文档", () => {
    const html = page();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain('charset="utf-8"');
    expect(html).toContain('name="viewport"');
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    // 不能依赖任何外部资源：Worker 没有静态资源可伺服
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/src="http/i);
    expect(html).not.toMatch(/<link /i);
  });

  it("把请求的客户端放在主按钮上，并给出可直接复制的明文链接", () => {
    const html = page();
    const deepLink = buildImportDeepLink("clash", { url: LINK, name: NAME });
    expect(html).toContain(`<a class="open" href="${deepLink}"`);
    expect(html).toContain("打开 Clash / Mihomo");
    expect(html).toContain(`<code>${LINK}</code>`);
  });

  it("列出其余客户端，且不重复请求的那一个", () => {
    const html = page();
    const otherList = html.slice(html.indexOf("<details>"), html.indexOf("</details>"));
    for (const target of IMPORT_TARGETS) {
      // 页面里的 href 需要属性转义，`&` 会变成 `&amp;`，比较前同样处理
      const deepLink = buildImportDeepLink(target.id, { url: LINK, name: NAME }).replace(
        /&/g,
        "&amp;"
      );
      if (target.id === "clash") {
        expect(otherList).not.toContain(deepLink);
      } else {
        expect(otherList).toContain(deepLink);
      }
    }
  });

  it("订阅名与链接都做 HTML 转义，防止反射型 XSS", () => {
    const html = page({
      name: '<script>alert("x")</script>',
      link: "https://worker.example.com/sub/a?x=1&y=<b>",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;y=&lt;b&gt;");
    // 深链里的 & 也必须转义成属性安全的形态
    expect(html).toContain("&amp;name=");
  });

  it("订阅名清洗与深链共用同一套规则：CR/LF 剥离并截断到 80 字符", () => {
    const html = page({ name: `A\r\nB${"长".repeat(200)}` });
    expect(html).not.toMatch(/>\s*A\r?\nB/);
    const nameTagStart = html.indexOf('<p class="name">');
    const shown = html.slice(nameTagStart + 16, html.indexOf("</p>", nameTagStart));
    expect(shown.startsWith("A B")).toBe(true);
    expect(shown).toHaveLength(80);
  });

  it("空的应用名与订阅名都有兜底，不会渲染出空标签", () => {
    const html = page({ appName: "   ", name: "   " });
    expect(html).toContain('<p class="brand">SubBoost</p>');
    expect(html).toContain('<p class="name">未命名订阅</p>');
  });
});
