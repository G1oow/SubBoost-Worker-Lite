import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 滚动条占位的唯一来源。
 *
 * 背景：Radix 弹窗/下拉锁定滚动时，react-remove-scroll 会把滚动条宽度补在 body 上
 * （gapMode 默认 margin，实测 gap = innerWidth - documentElement.clientWidth）。
 * 如果 html 上还有 scrollbar-gutter: stable，同一段空间就被保留两次：
 * 布局视口少 8px，max-w 容器重新居中，整页在弹窗打开的瞬间横移 4px、关闭再弹回。
 *
 * 正确的配比只有一种：
 * - html 的 scrollbar-gutter 负责占位（开合前后宽度一致）；
 * - body[data-scroll-locked] 把库自带的补偿清零；
 * - 遮罩层与弹窗容器用 w-screen 盖住锁定期间不再绘制的那条滚动条。
 *
 * 这三条任意一条被改回去，页面就会重新"跳动"，所以在这里钉住。
 */

const globalsCss = readFileSync(join(__dirname, "globals.css"), "utf8");
const dialogSource = readFileSync(
  join(__dirname, "../components/ui/dialog.tsx"),
  "utf8"
);

/** 取某个选择器的声明块（选择器后紧跟 {，再从那里做一次大括号配平） */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[\\r\\n}])[ \\t]*${escaped}\\s*\\{`, "m").exec(css);
  if (!match) return "";
  const open = css.indexOf("{", match.index);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return "";
}

describe("锁滚动时的滚动条占位", () => {
  const htmlRule = ruleBody(globalsCss, "html");
  const bodyRule = ruleBody(globalsCss, "body");
  const lockedRule = ruleBody(globalsCss, "html body[data-scroll-locked]");

  it("html 用 scrollbar-gutter 一直预留滚动条位置", () => {
    expect(htmlRule).toContain("scrollbar-gutter: stable");
  });

  it("页面始终带一条纵向滚动条，内容不满屏时也不抖动", () => {
    expect(bodyRule).toContain("overflow-y: scroll");
  });

  it("锁滚动时不再重复补偿一次滚动条宽度", () => {
    // 库自己会补 margin-right / padding-right，两条同时生效就是"补两次"
    expect(lockedRule).toContain("padding-right: 0 !important");
    expect(lockedRule).toContain("margin-right: 0 !important");
    expect(lockedRule).not.toContain("var(--removed-body-scroll-bar-size)");
  });

  it("遮罩与弹窗容器盖住锁定期间不再绘制的滚动条", () => {
    // 锁定期间 html 宽度仍被 gutter 占着，inset-x-0 会短 8px，右边缘漏一条亮边
    const wideScreen = dialogSource.match(/fixed inset-y-0 left-0 z-50[^"]*w-screen/g) ?? [];
    expect(wideScreen).toHaveLength(2); // 遮罩层 + 弹窗容器
    expect(dialogSource).not.toMatch(/fixed inset-0 z-50 (bg-overlay|grid)/);
  });
});
