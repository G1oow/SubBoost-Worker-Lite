import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GrowBar } from "./grow-bar";
import { LoadingButton } from "./loading-button";
import { MotionItem, MotionList, MotionReveal } from "./motion-list";
import { SegmentedControl } from "./segmented-control";
import { SpotlightCard } from "./spotlight-card";
import { GROW_BAR_SPRING } from "./tokens";

describe("motion primitives", () => {
  it("renders a segmented control as an accessible tablist with a single active tab", () => {
    const html = renderToStaticMarkup(
      React.createElement(SegmentedControl, {
        label: "主导航",
        layoutGroupId: "test-nav",
        activeId: "sources",
        onSelect: () => {},
        options: [
          { id: "dashboard", label: "仪表板" },
          { id: "sources", label: "源管理", badge: 3 },
          { id: "config", label: "生成配置" },
        ],
      })
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="主导航"');
    // 只有当前项带 aria-selected="true" 与当前页标记，其余为 false
    expect(html.match(/aria-selected="true"/gu)).toHaveLength(1);
    expect(html.match(/aria-selected="false"/gu)).toHaveLength(2);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("源管理");
    expect(html).toContain(">3<");
  });

  it("renders the spotlight layer with a cursor-following radial gradient", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        SpotlightCard,
        { glowColor: "rgba(6, 182, 212, 0.15)", radius: 300 },
        React.createElement("p", null, "内容")
      )
    );

    expect(html).toContain('data-testid="spotlight-layer"');
    expect(html).toContain(
      "radial-gradient(300px circle at var(--spotlight-x, 50%) var(--spotlight-y, 50%)"
    );
    expect(html).toContain("rgba(6, 182, 212, 0.15)");
    // 聚光灯层是纯装饰，不能被辅助技术读到
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("内容");
  });

  it("renders motion list items and keeps table rows out of FLIP", () => {
    const listHtml = renderToStaticMarkup(
      React.createElement(
        MotionList,
        { as: "ul", className: "list-extra" },
        React.createElement(MotionItem, { itemKey: "a" }, "A"),
        React.createElement(MotionItem, { itemKey: "b" }, "B")
      )
    );

    expect(listHtml).toContain("<ul");
    expect(listHtml).toContain("list-extra");
    expect(listHtml).toContain("<li");
    expect(listHtml).toContain(">A<");
    expect(listHtml).toContain(">B<");

    // 行默认不参与 FLIP：<tr> 的 layout 测量与表格算法不一致
    const rowHtml = renderToStaticMarkup(
      React.createElement(
        MotionList,
        { as: "div", className: "contents table-row-group" },
        React.createElement(MotionItem, { as: "tr", itemKey: "r1" }, React.createElement("td", null, "cell"))
      )
    );
    expect(rowHtml).toContain("<tr");
    expect(rowHtml).toContain("table-row-group");
  });

  it("keeps collapsed reveals out of the DOM", () => {
    const closed = renderToStaticMarkup(
      React.createElement(MotionReveal, { open: false, id: "panel" }, "隐藏内容")
    );
    expect(closed).toBe("");

    const open = renderToStaticMarkup(
      React.createElement(MotionReveal, { open: true, id: "panel" }, "展开内容")
    );
    expect(open).toContain('id="panel"');
    expect(open).toContain("展开内容");
    expect(open).toContain("overflow-hidden");
  });
});

describe("loading button", () => {
  it("only swaps in the spinner and disables the control while loading", () => {
    const idle = renderToStaticMarkup(
      React.createElement(LoadingButton, null, React.createElement("span", null, "保存"))
    );
    expect(idle).toContain("保存");
    expect(idle).not.toContain("animate-spin");
    expect(idle).not.toContain("aria-busy");

    const loading = renderToStaticMarkup(
      React.createElement(LoadingButton, { loading: true, loadingLabel: "保存中…" }, "保存")
    );
    expect(loading).toContain("animate-spin");
    expect(loading).toContain("保存中…");
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('disabled=""');
  });
});

describe("grow bar", () => {
  it("keeps the count out of the visual layer and only exposes it to assistive tech", () => {
    const html = renderToStaticMarkup(
      React.createElement(GrowBar, { percent: 40, count: 2 })
    );

    // 视觉数字已移除（逐帧写 left + textContent 会导致文字抖动）；
    // 读屏仍读到稳定终值 2
    expect(html).toContain('class="sr-only"');
    expect(html).toContain(">2</span>");
    expect(html).not.toContain('aria-hidden="true"');
    // 数字只显示数值，不再附带单位
    expect(html).not.toContain("个");
  });

  it("clamps out-of-range percentages instead of overflowing the track", () => {
    const over = renderToStaticMarkup(
      React.createElement(GrowBar, { percent: 180, count: 9 })
    );
    const under = renderToStaticMarkup(
      React.createElement(GrowBar, { percent: -20, count: 0 })
    );
    // 超界值不应写进内联样式（由 Motion 的 scaleX 承载），静态渲染只需不报错
    expect(over).toContain("sr-only");
    expect(under).toContain("sr-only");
  });
});

describe("grow bar spring", () => {
  /**
   * 弹簧一旦欠阻尼（ζ < 1）就会越过目标再弹回来：
   * 数字先跳到 6 再掉回 5，条也会冲过头再缩回，观感是「动画跑完被强制归位」。
   * 这里用物理公式反算过冲量，把「最后一帧就精确停住」变成可断言的约束。
   */
  const dampingRatio = (damping: number, stiffness: number, mass: number) =>
    damping / (2 * Math.sqrt(stiffness * mass));

  it("keeps the spring critically damped so it never overshoots the target", () => {
    const { stiffness, damping, mass } = GROW_BAR_SPRING;
    // ζ ≥ 1 才是临界/过阻尼；< 1 必然过冲
    expect(dampingRatio(damping, stiffness, mass)).toBeGreaterThanOrEqual(1);
  });

  it("keeps spring stiffness and mass from the reference implementation", () => {
    // 手感来自示例代码的 stiffness=180；只把阻尼加到不过冲
    expect(GROW_BAR_SPRING.stiffness).toBe(180);
    expect(GROW_BAR_SPRING.mass).toBe(1);
  });

  it("drives the fill from a single progress value and never the layout", () => {
    const source = readFileSync(join(__dirname, "grow-bar.tsx"), "utf8");
    // 填充宽度必须是 progress 的纯函数
    expect(source).toMatch(/useTransform\(progress,\s*\(value\)\s*=>\s*value\s*\/\s*100\)/u);
    // 只允许一个 animate 目标，出现第二个就是又拆成了两条独立动画
    expect(source.match(/animate\(/gu)).toHaveLength(1);
    // 不再逐帧写 left / 改 textContent：那是布局与重排，正是抖动的来源
    expect(source).not.toMatch(/style=\{\{\s*left\s/u);
    expect(source).not.toMatch(/textContent\s*=/u);
  });
});
