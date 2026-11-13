import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SortableHandle, SortableItem, SortableList } from "./sortable-list";

/** 卡片自己排版、手柄挂在卡片内，所以这里用一个近似的卡片 div 包住它 */
function render(disabled = false) {
  return renderToStaticMarkup(
    React.createElement(
      SortableList,
      { ids: ["a", "b"], onReorder: () => {}, disabled },
      React.createElement(
        SortableItem,
        { id: "a", label: "条目甲", disabled },
        React.createElement(
          "div",
          { className: "relative border pl-10 pr-3" },
          React.createElement(SortableHandle),
          React.createElement("span", null, "卡片正文")
        )
      )
    )
  );
}

describe("sortable card list", () => {
  it("keeps list semantics and puts the drag affordance on a labelled handle inside the card", () => {
    const html = render();
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
    // 手柄在卡片内部：卡片本身不是拖拽节点，手柄才是
    expect(html).toContain('class="relative border pl-10 pr-3"');
    expect(html).toContain('aria-label="拖动排序 条目甲"');
    expect(html).toContain('aria-roledescription="sortable"');
    expect(html).toContain("卡片正文");
    // 手柄不再是卡片外单独撑出的一列
    expect(html).not.toContain("items-center gap-1.5");
  });

  it("keeps the handle visually small on top of a full-height hit area", () => {
    const html = render();
    // 可见本体是 28px 小方块，常态低对比、无底色
    expect(html).toContain("h-7 w-7");
    expect(html).toContain("text-fg-35");
    // 悬停 / 键盘聚焦才浮出底色与更亮前景
    expect(html).toContain("group-hover/handle:bg-ink/5");
    expect(html).toContain("group-hover/handle:text-fg-70");
    expect(html).toContain("group-focus-visible/handle:outline-focus-ring");
    // 命中区占满卡片高度
    expect(html).toContain("inset-y-0");
  });
  it("disables the handle instead of leaving a dead drag target", () => {
    const html = render(true);
    expect(html).toContain("disabled");
    expect(html).toContain('aria-disabled="true"');
  });
});
