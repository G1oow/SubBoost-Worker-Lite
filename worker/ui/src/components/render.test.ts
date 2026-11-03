import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import { ConfigPanel } from "./config-panel";
import { DashboardPanel } from "./dashboard-panel";
import { NodeRenameEditor } from "./node-rename-editor";
import { SourcesPanel } from "./sources-panel";
import { SourceNodesInline } from "./source-nodes-inline";
import { StatusPanel } from "./status-panel";
import { SubscriptionShareContent, SubscriptionShareDialog } from "./subscription-share-dialog";
import { SubscriptionsPanel } from "./subscriptions-panel";
import { TokenGate } from "./token-gate";
import type { AppState, DashboardStats, SourceNodesResponse } from "../lib/types";

const STATE: AppState = {
  app: { name: "SubBoost Lite", version: "0.3.9" },
  sources: [
    {
      id: "s1",
      name: "机场 A",
      kind: "remote",
      url: "https://example.com/sub?token=secret",
      enabled: true,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
    {
      id: "s2",
      name: "手动节点",
      kind: "manual",
      manualText: "ss://abc",
      enabled: false,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
  ],
  subscriptions: [
    {
      id: "sub1",
      name: "默认订阅",
      sourceIds: [],
      link: "https://worker.example.com/sub/tokenvalue",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
  ],
  config: { mixedPort: 7897 },
  configIsDefault: true,
  status: {
    lastRunAt: "2026-10-12T00:00:00.000Z",
    lastTrigger: "cron",
    durationMs: 1234,
    sources: [{ sourceId: "s1", ok: true, nodeCount: 12 }],
    subscriptions: [{ subscriptionId: "sub1", ok: true, nodeCount: 12 }],
  },
};

const noopAsync = async () => {};

beforeEach(() => {
  // AppShell 的初始主题读取需要 document，这里提供最小替身
  const documentStub = {
    documentElement: { getAttribute: () => "dark", setAttribute: () => {} },
    querySelector: () => null,
  };
  vi.stubGlobal("document", documentStub);
});

describe("admin UI rendering", () => {
  it("renders the token gate without embedding any secret", () => {
    const html = renderToStaticMarkup(React.createElement(TokenGate, { onAuthenticated: () => {} }));
    expect(html).toContain("访问 token");
    expect(html).not.toContain("ADMIN_TOKEN=");
    expect(html).not.toContain("ENCRYPTION_KEY=");
  });

  it("renders the app shell with the app name and version", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        AppShell,
        { title: STATE.app.name, version: STATE.app.version, onLogout: () => {} },
        React.createElement("p", null, "content")
      )
    );
    expect(html).toContain("SubBoost Lite");
    expect(html).toContain("v0.3.9");
    expect(html).toContain("content");
  });

  it("renders the nav as a segmented tablist with the active page selected", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        AppShell,
        {
          title: STATE.app.name,
          version: STATE.app.version,
          onLogout: () => {},
          navItems: [
            { id: "dashboard", label: "仪表板" },
            { id: "sources", label: "源管理", badge: 2 },
          ],
          activeNav: "sources",
          onNavigate: () => {},
        },
        React.createElement("p", null, "content")
      )
    );
    // 导航是 tablist + tab，滑块靠 layoutId 跟随，不再手写定位
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="主导航"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("源管理");
  });

  it("renders the status panel as a health board with a one-line verdict", () => {
    const html = renderToStaticMarkup(
      React.createElement(StatusPanel, { state: STATE, onRefresh: noopAsync, refreshing: false })
    );
    expect(html).toContain("刷新状态");
    expect(html).toContain("机场 A");
    expect(html).toContain("默认订阅");
    expect(html).toContain("12");
    // 结论条是看板的核心：全部成功要一眼看得出来
    expect(html).toContain("全部成功");
    expect(html).toContain("节点总数");
    // 占比按源节点算，单个源即 100%
    expect(html).toContain("100%");
  });

  it("surfaces a failing source inline instead of hiding it in a column", () => {
    const failing = {
      ...STATE,
      status: {
        ...STATE.status!,
        sources: [
          { sourceId: "s1", ok: false, error: "上游返回 502" },
          { sourceId: "s2", ok: true, nodeCount: 4 },
        ],
      },
    };
    const html = renderToStaticMarkup(
      React.createElement(StatusPanel, { state: failing, onRefresh: noopAsync, refreshing: false })
    );
    expect(html).toContain("部分失败");
    expect(html).toContain("上游返回 502");
    expect(html).toContain("手动节点");
    // 条形宽度必须与显示的百分比同源，不能用组内归一（否则 40% 会画满）
    expect(html).not.toContain("width:80%");
  });

  it("renders the sources panel with both source kinds", () => {
    const html = renderToStaticMarkup(
      React.createElement(SourcesPanel, { state: STATE, onSave: noopAsync })
    );
    expect(html).toContain("源管理");
    expect(html).toContain("机场 A");
    expect(html).toContain("手动节点");
    expect(html).toContain("远程");
    expect(html).toContain("手动");
  });

  it("renders the subscriptions panel with the truncated link", () => {
    const html = renderToStaticMarkup(
      React.createElement(SubscriptionsPanel, {
        state: STATE,
        onCreate: noopAsync,
        onRotate: noopAsync,
        onDelete: noopAsync,
      })
    );
    expect(html).toContain("订阅链接");
    expect(html).toContain("默认订阅");
    expect(html).toContain("https://worker.example.com/sub/tokenvalue");
    expect(html).toContain("分享 默认订阅 二维码");
    // 与「源管理」一致：订阅也走卡片列表，不再用表格
    expect(html).not.toContain("<table");
    expect(html).not.toContain("<thead");
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
    // 卡片轮廓：表格行做不出圆角边框与行间距
    expect(html).toContain("border-card-border");
  });

  it("renders the share content with the link and security hint", () => {
    const html = renderToStaticMarkup(
      React.createElement(SubscriptionShareContent, { subscription: STATE.subscriptions[0] })
    );
    expect(html).toContain("默认订阅");
    expect(html).toContain("https://worker.example.com/sub/tokenvalue");
    expect(html).toContain("复制链接");
    expect(html).toContain("保存二维码");
    expect(html).toContain("打开链接");
    expect(html).toContain("链接等同于访问凭据");
    expect(html).toContain("<canvas");
  });

  it("keeps the share dialog closed until a subscription is selected", () => {
    // Dialog 走 Portal，静态渲染下只验证关闭态不透传链接
    const html = renderToStaticMarkup(
      React.createElement(SubscriptionShareDialog, { subscription: null, onClose: () => {} })
    );
    expect(html).not.toContain("分享订阅");
    expect(html).not.toContain("https://worker.example.com/sub/tokenvalue");
  });

  it("renders the config panel with the JSON text and default hint", () => {
    const html = renderToStaticMarkup(
      React.createElement(ConfigPanel, { state: STATE, onSave: noopAsync, onReset: noopAsync })
    );
    expect(html).toContain("生成配置");
    expect(html).toContain("当前为默认配置");
    expect(html).toContain("mixedPort");
  });
});

const STATS: DashboardStats = {
  generatedAt: "2026-10-12T00:00:00.000Z",
  sources: { total: 2, enabled: 1, remote: 1, manual: 1 },
  subscriptions: { total: 1, allSources: 1, scoped: 0 },
  nodes: {
    total: 12,
    renamed: 2,
    protocols: [
      { type: "ss", count: 8 },
      { type: "vless", count: 4 },
    ],
  },
  sourceStats: [
    {
      sourceId: "s1",
      name: "机场 A",
      kind: "remote",
      enabled: true,
      nodeCount: 12,
      renamedCount: 2,
      fetchedAt: "2026-10-12T00:00:00.000Z",
      ok: true,
      protocols: [{ type: "ss", count: 8 }],
    },
    {
      sourceId: "s2",
      name: "手动节点",
      kind: "manual",
      enabled: false,
      nodeCount: 0,
      renamedCount: 0,
      fetchedAt: null,
      ok: null,
      protocols: [],
    },
  ],
  lastRun: {
    at: "2026-10-12T00:00:00.000Z",
    trigger: "cron",
    durationMs: 1234,
    sourceOk: 1,
    sourceFailed: 0,
    subscriptionOk: 1,
    subscriptionFailed: 0,
  },
  warnings: [],
};

describe("dashboard and node rename rendering", () => {
  it("renders the dashboard with stats, protocols and source health", () => {
    const html = renderToStaticMarkup(
      React.createElement(DashboardPanel, {
        state: STATE,
        stats: STATS,
        onRefresh: noopAsync,
        onNavigate: () => {},
      })
    );
    expect(html).toContain("最近刷新");
    expect(html).toContain("协议分布");
    expect(html).toContain("源健康");
    expect(html).toContain("12");
    expect(html).toContain("机场 A");
    expect(html).toContain("运行正常");
  });

  it("falls back to the state data when dashboard stats are unavailable", () => {
    const html = renderToStaticMarkup(
      React.createElement(DashboardPanel, {
        state: STATE,
        stats: null,
        onRefresh: noopAsync,
        onNavigate: () => {},
      })
    );
    expect(html).toContain("源健康");
    expect(html).toContain("机场 A");
  });

  it("renders parsed node names and protocols with rename inputs", () => {
    const html = renderToStaticMarkup(
      React.createElement(NodeRenameEditor, {
        nodes: [
          { key: "0123456789abcdef", name: "香港 01", originName: "香港 01", type: "ss", renamed: false },
          { key: "fedcba9876543210", name: "日本 02", originName: "日本 02", type: "vless", renamed: false },
        ],
        renames: {},
        onChange: () => {},
      })
    );
    expect(html).toContain("共 2 个节点");
    expect(html).toContain("香港 01");
    expect(html).toContain("vless");
    expect(html).toContain("重命名节点 香港 01");
  });

  it("marks renamed nodes in the editor", () => {
    const html = renderToStaticMarkup(
      React.createElement(NodeRenameEditor, {
        nodes: [
          { key: "0123456789abcdef", name: "香港 01", originName: "香港 01", type: "ss", renamed: true },
        ],
        renames: { "0123456789abcdef": "HK-01" },
        onChange: () => {},
      })
    );
    expect(html).toContain("已改名 1 个");
    expect(html).toContain("原名 香港 01");
  });
});

const SOURCE_NODES: SourceNodesResponse = {
  source: { id: "s1", name: "机场 A", kind: "remote", enabled: true, nodeRenames: {} },
  fetchedAt: "2026-10-12T00:00:00.000Z",
  nodeCount: 2,
  renamedCount: 1,
  nodes: [
    {
      key: "0123456789abcdef",
      name: "HK-01",
      originName: "香港 01",
      type: "ss",
      server: "hk.example.com",
      port: 443,
      renamed: true,
    },
    { key: "fedcba9876543210", name: "日本 02", originName: "日本 02", type: "vless", renamed: false },
  ],
  parseErrors: ["第 3 行无法解析"],
};

describe("dashboard source nodes expansion", () => {
  it("renders source health rows as expandable buttons", () => {
    const html = renderToStaticMarkup(
      React.createElement(DashboardPanel, {
        state: STATE,
        stats: STATS,
        onRefresh: noopAsync,
        onNavigate: () => {},
        onLoadNodes: async () => SOURCE_NODES,
      })
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="source-nodes-s1"');
  });

  it("renders the loading placeholder while nodes are being fetched", () => {
    const html = renderToStaticMarkup(
      React.createElement(SourceNodesInline, { state: { status: "loading" } })
    );
    expect(html).toContain("正在读取节点");
  });

  it("renders a retry action when loading the nodes fails", () => {
    const html = renderToStaticMarkup(
      React.createElement(SourceNodesInline, {
        state: { status: "error", message: "读取节点失败" },
        onRetry: () => {},
      })
    );
    expect(html).toContain("读取节点失败");
    expect(html).toContain("重试");
  });

  it("renders the node list with rename hints and parse errors", () => {
    const html = renderToStaticMarkup(
      React.createElement(SourceNodesInline, {
        state: { status: "ready", data: SOURCE_NODES },
        onRetry: () => {},
        onOpenSourceManager: () => {},
      })
    );
    expect(html).toContain("共 2 个节点");
    expect(html).toContain("已改名 1 个");
    expect(html).toContain("抓取于");
    expect(html).toContain("HK-01");
    expect(html).toContain("原名 香港 01");
    expect(html).toContain("hk.example.com:443");
    expect(html).toContain("1 条节点解析失败");
    expect(html).toContain("去改名");
    expect(html).toContain("重新读取节点");
  });

  it("falls back to the empty hint when the source has no nodes", () => {
    const html = renderToStaticMarkup(
      React.createElement(SourceNodesInline, {
        state: {
          status: "ready",
          data: { ...SOURCE_NODES, nodeCount: 0, renamedCount: 0, nodes: [], parseErrors: [] },
        },
        emptyHint: "该源还没有可解析的节点文本。",
      })
    );
    expect(html).toContain("该源还没有可解析的节点文本。");
  });

  it("pages long node lists and notes the preview limit", () => {
    const nodes = Array.from({ length: 35 }, (_unused, index) => ({
      key: `key-${index}`,
      name: `节点 ${index}`,
      originName: `节点 ${index}`,
      type: "ss",
      renamed: false,
    }));
    const html = renderToStaticMarkup(
      React.createElement(SourceNodesInline, {
        state: { status: "ready", data: { ...SOURCE_NODES, nodeCount: 500, nodes } },
      })
    );
    expect(html).toContain("仅列出前 35 个");
    expect(html).toContain("再显示 5 个");
    expect(html).toContain("节点 29");
    expect(html).not.toContain("节点 30");
  });
});
