import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./empty-state";
import { InlineNote } from "./inline-note";

function render(element: React.ReactElement) {
  return renderToStaticMarkup(element);
}

describe("InlineNote tones", () => {
  /**
   * 三种 tone 必须落到 theme.css 的 *-note-* 令牌上：
   * 一旦有人再写回 border-amber-500/30 这类散装组合，浅色主题就会分叉。
   */
  it("uses the semantic note tokens for every tone", () => {
    const warning = render(React.createElement(InlineNote, null, "格式无效"));
    const danger = render(React.createElement(InlineNote, { tone: "danger" }, "保存失败"));
    const success = render(React.createElement(InlineNote, { tone: "success" }, "已同步"));

    expect(warning).toContain("bg-warning-note-bg");
    expect(warning).toContain("border-warning-note-border");
    expect(warning).toContain("text-warning-note-fg");
    expect(danger).toContain("bg-danger-note-bg");
    expect(danger).toContain("text-danger-note-fg");
    expect(success).toContain("bg-success-note-bg");
    expect(success).toContain("text-success-note-fg");
    for (const html of [warning, danger, success]) {
      expect(html).not.toMatch(/(?:amber|red|green|emerald)-\d{3}/u);
    }
  });

  it("只给需要朗读的内容加 role=alert", () => {
    expect(render(React.createElement(InlineNote, null, "提示"))).not.toContain('role="alert"');
    expect(render(React.createElement(InlineNote, { alert: true }, "错误"))).toContain('role="alert"');
  });

  it("plain 变体不画底色与描边，icon 传 null 时不渲染图标", () => {
    const plain = render(
      React.createElement(InlineNote, { variant: "plain", icon: null }, "行内附注")
    );
    expect(plain).not.toContain("rounded-xl");
    expect(plain).not.toContain("bg-warning-note-bg");
    expect(plain).not.toContain("<svg");
    expect(plain).toContain("行内附注");
  });
});

describe("EmptyState", () => {
  it("keeps one dashed frame and reads the copy as text", () => {
    const html = render(
      React.createElement(EmptyState, null, "还没有链式代理，点击「新建链」创建第一条。")
    );
    expect(html).toContain("border-dashed");
    expect(html).toContain("还没有链式代理");
    // 装饰图标不参与无障碍树，未传图标时也不该凭空多一个
    expect(html).not.toContain("<svg");
  });

  it("renders the optional action next to the copy", () => {
    const html = render(
      React.createElement(
        EmptyState,
        { action: React.createElement("button", { type: "button" }, "新建链") },
        "还没有链式代理"
      )
    );
    expect(html).toContain("新建链");
    // 文案与操作的顺序：先说空，再给出口
    expect(html.indexOf("还没有链式代理")).toBeLessThan(html.indexOf("新建链"));
  });
});
