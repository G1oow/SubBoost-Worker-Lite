import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

/**
 * 移动端适配的守卫测试。
 *
 * 这些约束一旦被顺手改回桌面写法，窄屏会静默退化（按钮被挤出视口、输入框触发
 * iOS 聚焦缩放、弹窗下沿被地址栏遮住），只有真机上看才发现。所以直接断言源码与
 * 渲染结果，让回归在 CI 里就暴露。
 */

// __dirname = worker/ui/src/components，共享包位于仓库根的 packages/ui/src
const packagesUi = join(__dirname, "..", "..", "..", "..", "packages", "ui", "src");

function readWorkerUi(relPath: string): string {
  return readFileSync(join(__dirname, "..", relPath), "utf8");
}

function readSharedUi(relPath: string): string {
  return readFileSync(join(packagesUi, relPath), "utf8");
}

// 版本号取自根 package.json：测试不该在每次发版时手改字面量
const APP_VERSION = (
  JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "..", "package.json"), "utf8")) as {
    version: string;
  }
).version;

beforeEach(() => {
  const documentStub = {
    documentElement: { getAttribute: () => "dark", setAttribute: () => {} },
    querySelector: () => null,
  };
  vi.stubGlobal("document", documentStub);
});

describe("mobile viewport", () => {
  it("declares a viewport meta that fills the notch area", () => {
    const html = readFileSync(join(__dirname, "..", "..", "index.html"), "utf8");
    // viewport-fit=cover 才能让 env(safe-area-inset-*) 在刘海屏上取到真实值
    expect(html).toContain("width=device-width");
    expect(html).toContain("viewport-fit=cover");
  });

  it("keeps form controls at 16px on mobile so iOS does not zoom on focus", () => {
    for (const file of ["components/ui/input.tsx", "components/ui/textarea.tsx", "components/ui/select.tsx"]) {
      const source = readSharedUi(file);
      // text-base 必须在移动端生效（无前缀），桌面才降回 text-sm
      expect(source, `${file} 移动端字号不得低于 16px`).toMatch(/\btext-base\b/u);
      expect(source, `${file} 应只在 sm 断点降为 14px`).toMatch(/sm:text-sm/u);
    }
  });

  it("shrinks the dialog into a bottom sheet on narrow screens", () => {
    const source = readSharedUi("components/ui/dialog.tsx");
    // 贴底 + 只在桌面居中；dvh 而不是 vh，避免移动地址栏遮挡下沿
    expect(source).toContain("place-items-end");
    expect(source).toContain("sm:place-items-center");
    expect(source).toContain("92dvh");
    expect(source).toContain("safe-area-inset-bottom");
    // 关闭按钮在窄屏放大到可点面积
    expect(source).toContain("sm:right-4");
  });

  it("stacks the toast viewport under the notch instead of a fixed top-16", () => {
    const source = readSharedUi("components/ui/toaster.tsx");
    expect(source).toContain("safe-area-inset-top");
  });

  it("prevents a single long token from scrolling the whole page sideways", () => {
    const css = readSharedUi("styles/globals.css");
    expect(css).toMatch(/overflow-x:\s*hidden/u);
    expect(css).toContain("100dvh");
    // 横竖屏切换时不允许 iOS 自行放大正文
    expect(css).toContain("-webkit-text-size-adjust");
  });
});

describe("app shell on narrow screens", () => {
  const navItems = [
    { id: "dashboard", label: "仪表板" },
    { id: "sources", label: "源管理", badge: 2 },
    { id: "subscriptions", label: "订阅链接" },
    { id: "status", label: "刷新状态" },
    { id: "config", label: "生成配置" },
  ];

  it("renders a thumb-reachable bottom tab bar with the active page marked", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        AppShell,
        {
          title: "SubBoost Lite",
          version: APP_VERSION,
          onLogout: () => {},
          navItems,
          activeNav: "sources",
          onNavigate: () => {},
        },
        React.createElement("p", null, "content")
      )
    );

    // 底部栏用 nav，桌面胶囊用 tablist：两者靠 sm 断点互斥，任一宽度只有一套生效
    expect(html).toContain("<nav");
    expect(html).toContain("aria-label=\"主导航\"");
    expect(html).toContain("sm:hidden");
    // 当前页在桌面 tab 与移动 tab 各出现一次
    expect(html.match(/aria-current="page"/gu)).toHaveLength(2);
    // 五个页面各自成项，不会像横向胶囊那样被压扁
    for (const item of navItems) expect(html).toContain(item.label);
  });

  it("keeps the header actions from overflowing at 375px", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        AppShell,
        {
          title: "SubBoost Lite",
          version: APP_VERSION,
          onLogout: () => {},
          navItems,
          activeNav: "dashboard",
          onNavigate: () => {},
          onRefresh: () => {},
        },
        React.createElement("p", null, "content")
      )
    );

    // 刷新与退出在移动端换成图标按钮，桌面才显示带文字的版本
    expect(html).toContain('aria-label="立即刷新"');
    expect(html).toContain('aria-label="退出登录"');
    expect(html).toContain("hidden sm:inline-flex");
    // 版本徽章在窄屏隐藏，把横向空间留给标题
    expect(html).toContain("hidden shrink-0 rounded-full");
  });

  it("reserves space so the fixed tab bar does not cover the last card", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        AppShell,
        { title: "SubBoost Lite", version: APP_VERSION, onLogout: () => {}, navItems },
        React.createElement("p", null, "content")
      )
    );
    expect(html).toContain("pb-28");
  });
});

describe("panel layout on mobile", () => {
  it("stacks card headers instead of squeezing the primary action", () => {
    for (const file of [
      "components/sources-panel.tsx",
      "components/subscriptions-panel.tsx",
      "components/status-panel.tsx",
      "components/config-panel.tsx",
    ]) {
      const source = readWorkerUi(file);
      // 桌面是 flex-row，移动端必须先 flex-col，否则长标题会把按钮压成竖排
      expect(source, `${file} 标题与操作在窄屏应竖向排列`).toContain(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      );
    }
  });

  it("stacks list-row actions below the text on mobile", () => {
    for (const file of ["components/sources-panel.tsx", "components/subscriptions-panel.tsx"]) {
      const source = readWorkerUi(file);
      expect(source, `${file} 行内操作应换行到第二行`).toContain("flex flex-col gap-2 rounded-xl border");
      expect(source, `${file} 操作区在窄屏贴右`).toContain("self-end sm:self-auto");
    }
  });

  it("keeps the dashboard KPIs in a two-column grid on phones", () => {
    const source = readWorkerUi("components/dashboard-panel.tsx");
    expect(source).toContain("grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4");
  });

  it("keeps the refresh KPI row at two columns on phones", () => {
    const source = readWorkerUi("components/status-panel.tsx");
    expect(source).toContain("grid grid-cols-2 gap-2 sm:grid-cols-4");
  });
});
