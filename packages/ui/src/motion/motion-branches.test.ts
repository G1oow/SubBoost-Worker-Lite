import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GrowBar } from "./grow-bar";
import { LoadingButton } from "./loading-button";
import { SegmentedControl } from "./segmented-control";
import { SpotlightCard } from "./spotlight-card";

/**
 * 这些组件的主体是 Motion 的运行时行为（弹簧、FLIP、鼠标跟随），
 * node 环境下 renderToStaticMarkup 不执行 effect，做不到逐帧断言。
 * 但「渲染出什么标记」「分支是否走到」在服务端渲染完全可测，
 * 覆盖率的缺口也主要在这里，所以按分支逐条补。
 */

describe("grow bar markup", () => {
  it("uses the rounded track and left-origin fill so scaleX maps to the bar", () => {
    const html = renderToStaticMarkup(React.createElement(GrowBar, { percent: 40, count: 2 }));

    // 填充从左侧起算：没有 origin-left，scaleX 会从中心向两侧展开
    expect(html).toContain("origin-left");
    // 轨道裁掉溢出，圆角才不会被方块填充顶破
    expect(html).toContain("overflow-hidden");
    expect(html).toContain("rounded-full");
  });

  it("keeps the bar free of a visual number label", () => {
    const html = renderToStaticMarkup(React.createElement(GrowBar, { percent: 60, count: 3 }));

    // 条上方的数字标签已删除：它要逐帧写 left（布局属性）并改 textContent，
    // 是刷新状态页「文字抖动」的直接来源。数值信息由行右侧的百分比与指标格承担。
    expect(html).not.toContain("-translate-x-full");
    expect(html).not.toContain("absolute");
    // 读屏仍然需要稳定终值
    expect(html).toContain("sr-only");
  });


  it("accepts custom track height and fill color", () => {
    const html = renderToStaticMarkup(
      React.createElement(GrowBar, {
        percent: 50,
        count: 1,
        heightClassName: "h-2",
        fillClassName: "bg-red-400",
      })
    );

    expect(html).toContain("h-2");
    expect(html).toContain("bg-red-400");
    // 默认值不应再叠加进来
    expect(html).not.toMatch(/\bh-1\b/u);
  });

  it("merges a caller className onto the wrapper", () => {
    const html = renderToStaticMarkup(
      React.createElement(GrowBar, { percent: 10, count: 1, className: "mt-4" })
    );
    expect(html).toContain("mt-4");
  });

  it("treats a zero percent as zero fill instead of dividing by zero", () => {
    const html = renderToStaticMarkup(React.createElement(GrowBar, { percent: 0, count: 0 }));
    // 0% 时标签仍要落在轨道内（max(1rem, 0%)），不能贴到容器外
    expect(html).toContain("sr-only");
    expect(html).toContain(">0</span>");
  });
});

describe("segmented control branches", () => {
  const base = {
    label: "导航",
    layoutGroupId: "nav",
    onSelect: () => {},
  };

  it("renders option icons and hides them from assistive tech", () => {
    const html = renderToStaticMarkup(
      React.createElement(SegmentedControl, {
        ...base,
        activeId: "a",
        options: [
          { id: "a", label: "甲", icon: React.createElement("svg", { "data-icon": "x" }) },
          { id: "b", label: "乙" },
        ],
      })
    );

    expect(html).toContain('data-icon="x"');
    // 图标是纯装饰，名称由 label 文本承担
    expect(html).toContain('aria-hidden="true"');
  });

  it("omits the badge when it is undefined or an empty string", () => {
    const html = renderToStaticMarkup(
      React.createElement(SegmentedControl, {
        ...base,
        activeId: "a",
        options: [
          { id: "a", label: "甲" },
          { id: "b", label: "乙", badge: "" },
        ],
      })
    );

    // 空徽标会渲染成一个 0 宽的空胶囊，视觉上像脏点
    expect(html).not.toContain("rounded-full bg-ink/10");
  });

  it("still renders a zero badge, which is a real count", () => {
    const html = renderToStaticMarkup(
      React.createElement(SegmentedControl, {
        ...base,
        activeId: "a",
        options: [{ id: "a", label: "甲", badge: 0 }],
      })
    );

    // 0 与空字符串语义不同：源数量为 0 是有意义的信息
    expect(html).toContain("rounded-full bg-ink/10");
    expect(html).toContain(">0<");
  });

  it("merges container and option class names", () => {
    const html = renderToStaticMarkup(
      React.createElement(SegmentedControl, {
        ...base,
        activeId: "a",
        className: "wide-nav",
        optionClassName: "tall-tab",
        options: [{ id: "a", label: "甲" }],
      })
    );

    expect(html).toContain("wide-nav");
    expect(html).toContain("tall-tab");
  });

  it("only the active tab carries the shared-layout pill", () => {
    const html = renderToStaticMarkup(
      React.createElement(SegmentedControl, {
        ...base,
        activeId: "b",
        options: [
          { id: "a", label: "甲" },
          { id: "b", label: "乙" },
        ],
      })
    );

    // 两个滑块同时存在会让 Motion 在两者间插值，看起来像"两个高亮"
    expect(html.match(/absolute inset-0 rounded-xl/gu)).toHaveLength(1);
  });
});

describe("spotlight card branches", () => {
  it("falls back to the brand glow and default radius", () => {
    const html = renderToStaticMarkup(
      React.createElement(SpotlightCard, null, React.createElement("p", null, "内容"))
    );

    expect(html).toContain("var(--color-primary-500) 22%");
    expect(html).toContain("radial-gradient(420px circle at");
  });

  it("honors a custom radius and glow color", () => {
    const html = renderToStaticMarkup(
      React.createElement(SpotlightCard, { radius: 120, glowColor: "rgba(1,2,3,0.5)" }, "x")
    );

    expect(html).toContain("radial-gradient(120px circle at");
    expect(html).toContain("rgba(1,2,3,0.5)");
  });

  it("starts hidden so the glow only appears on hover", () => {
    const html = renderToStaticMarkup(
      React.createElement(SpotlightCard, null, React.createElement("p", null, "内容"))
    );

    expect(html).toContain("--spotlight-opacity");
    // 常驻可见的光斑会让卡片在静止时也发亮，失去"跟随指针"的意义
    expect(html).toContain("opacity:var(--spotlight-opacity)");
    expect(html).toContain("transition-opacity");
  });

  it("drops the glow entirely when the user asks for reduced motion", () => {
    const html = renderToStaticMarkup(
      React.createElement(SpotlightCard, null, React.createElement("p", null, "内容"))
    );
    // motion-reduce:hidden 是纯 CSS 降级，不需要 JS 分支
    expect(html).toContain("motion-reduce:hidden");
  });

  it("forwards extra attributes and merges the caller className", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        SpotlightCard,
        { className: "p-5", id: "card-1", "data-x": "y" },
        React.createElement("p", null, "内容")
      )
    );

    expect(html).toContain('id="card-1"');
    expect(html).toContain('data-x="y"');
    expect(html).toContain("p-5");
  });
});

describe("loading button fallbacks", () => {
  it("keeps the original children when no loading label is given", () => {
    const html = renderToStaticMarkup(
      React.createElement(LoadingButton, { loading: true }, React.createElement("span", null, "保存"))
    );

    // 没给 loadingLabel 时不能用空文案：等待中按钮变空白，用户不知道发生了什么
    expect(html).toContain("保存");
    expect(html).toContain("animate-spin");
  });

  it("prefers the loading label over the children", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        LoadingButton,
        { loading: true, loadingLabel: "保存中…" },
        React.createElement("span", null, "保存")
      )
    );

    expect(html).toContain("保存中…");
    expect(html).not.toContain(">保存<");
  });
});
