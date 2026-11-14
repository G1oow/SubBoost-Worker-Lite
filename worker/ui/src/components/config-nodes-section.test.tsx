// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialogHost } from "@subboost/ui/components/ui/confirm-dialog";
import type { CanvasNodeSummary, SubscriptionDto, SubscriptionNodesResponse } from "../lib/types";
import { ConfigNodesSection } from "./config-nodes-section";

/**
 * 「节点排序」画布的交互测试：选订阅（单选）、加载节点、写回 nodeOrder 都活在事件里，
 * 静态渲染跑不到，这里用 jsdom 真跑一遍。
 */

const SUBSCRIPTIONS: SubscriptionDto[] = [
  { id: "sub-1", name: "订阅一", sourceIds: ["s1"], chainIds: [], link: "", createdAt: "", updatedAt: "" },
  { id: "sub-2", name: "订阅二", sourceIds: ["s2"], chainIds: [], link: "", createdAt: "", updatedAt: "" },
];

const KEY_A = "a".repeat(16);
const KEY_B = "b".repeat(16);
const KEY_C = "c".repeat(16);

const SELECTION_STORAGE_KEY = "subboost-node-grid-subscriptions";

function canvasNode(key: string, name: string, sourceId: string, sourceName: string): CanvasNodeSummary {
  return { key, name, originName: name, type: "ss", renamed: false, sourceId, sourceName };
}

function response(subscriptionId: string, nodes: CanvasNodeSummary[]): SubscriptionNodesResponse {
  return {
    subscription: { id: subscriptionId, name: subscriptionId },
    nodeCount: nodes.length,
    truncated: false,
    sources: [
      { id: `s-${subscriptionId}`, name: `源 ${subscriptionId}`, nodeCount: nodes.length, missingSnapshot: false },
    ],
    nodes,
  };
}

const SUB_ONE_NODES = [
  canvasNode(KEY_A, "香港 01", "s1", "示例源 A"),
  canvasNode(KEY_B, "日本 01", "s1", "示例源 A"),
];
const SUB_TWO_NODES = [canvasNode(KEY_C, "美国 01", "s2", "示例源 B")];

type Loader = (id: string, opts?: { order?: "saved" | "source" }) => Promise<SubscriptionNodesResponse>;

function renderSection(options: {
  config?: Record<string, unknown>;
  load?: Loader;
  onChange?: (next: Record<string, unknown>) => void;
}) {
  const load = options.load ?? (async (id: string) => response(id, SUB_ONE_NODES));
  const onChange = options.onChange ?? vi.fn();
  return render(
    <>
      <ConfigNodesSection
        config={options.config ?? {}}
        subscriptions={SUBSCRIPTIONS}
        onLoadSubscriptionNodes={load}
        onChange={onChange}
      />
      <ConfirmDialogHost />
    </>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  // jsdom 没有 matchMedia：给个宽屏结果，让列数逻辑走「用预设」那条分支
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("节点排序画布", () => {
  it("默认选中第一条订阅并铺出它的节点卡片", async () => {
    const load = vi.fn(async (id: string) => response(id, SUB_ONE_NODES));
    renderSection({ load });

    await screen.findByText("香港 01");
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0]).toBe("sub-1");
    expect(screen.getByRole("radio", { name: "订阅一" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("日本 01")).toBeTruthy();
    expect(screen.getByText("已加载 2 个节点")).toBeTruthy();

    // 卡片序号就是输出顺序
    const items = screen.getAllByRole("listitem").map((item) => item.textContent ?? "");

    // 整卡拖拽：卡片自己就是拖拽把手，不再渲染独立手柄
    expect(screen.queryByRole("button", { name: /拖动排序/ })).toBeNull();
    expect(
      within(screen.getAllByRole("listitem")[0]).getByRole("button", { name: /香港 01/ })
    ).toBeTruthy();
    expect(items[0].startsWith("香港 011")).toBe(true);
    expect(items[1].startsWith("日本 012")).toBe(true);
  });

  it("订阅是单选：换一条后只显示它的节点，并记住选择", async () => {
    const load = vi.fn(async (id: string) =>
      id === "sub-1" ? response(id, SUB_ONE_NODES) : response(id, SUB_TWO_NODES)
    );
    renderSection({ load });

    await screen.findByText("香港 01");
    fireEvent.click(screen.getByRole("radio", { name: "订阅二" }));

    await screen.findByText("美国 01");
    expect(screen.queryByText("香港 01")).toBeNull();
    expect(screen.getByRole("radio", { name: "订阅二" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "订阅一" }).getAttribute("aria-checked")).toBe("false");
    expect(window.localStorage.getItem(SELECTION_STORAGE_KEY)).toBe("sub-2");
    expect(load).toHaveBeenCalledWith("sub-2", undefined);
  });

  it("方向键也能在订阅之间切换选择", async () => {
    const load = vi.fn(async (id: string) =>
      id === "sub-1" ? response(id, SUB_ONE_NODES) : response(id, SUB_TWO_NODES)
    );
    renderSection({ load });

    await screen.findByText("香港 01");
    fireEvent.keyDown(screen.getByRole("radiogroup", { name: "选择订阅" }), { key: "ArrowRight" });
    await screen.findByText("美国 01");
    expect(screen.queryByText("香港 01")).toBeNull();
  });

  it("按地区排序把顺序写进 config.nodeOrder，未加载条目按原相对位置保留", async () => {
    const onChange = vi.fn();
    // 已保存顺序里 KEY_C 这次没加载（属于别的订阅）：B 在它之后，所以新顺序里 C 仍贴着 B 前面
    renderSection({ config: { nodeOrder: [KEY_C, KEY_B] }, onChange });

    await screen.findByText("香港 01");
    fireEvent.click(screen.getByRole("button", { name: "按地区排序" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({ nodeOrder: [KEY_A, KEY_C, KEY_B] });
  });

  it("搜索只过滤画布，不改变已加载计数", async () => {
    renderSection({});
    await screen.findByText("香港 01");

    fireEvent.change(screen.getByRole("textbox", { name: "搜索节点" }), { target: { value: "日本" } });
    expect(screen.queryByText("香港 01")).toBeNull();
    expect(screen.getByText("日本 01")).toBeTruthy();
    expect(screen.getByText("已加载 2 个节点")).toBeTruthy();
  });

  it("重置要先确认，确认后清空 nodeOrder 并按源顺序重新加载", async () => {
    const onChange = vi.fn();
    const load = vi.fn(async (id: string, opts?: { order?: "saved" | "source" }) =>
      opts?.order === "source" ? response(id, [...SUB_ONE_NODES].reverse()) : response(id, SUB_ONE_NODES)
    );
    renderSection({ config: { nodeOrder: [KEY_B, KEY_A] }, load, onChange });

    await screen.findByText("香港 01");
    fireEvent.click(screen.getByRole("button", { name: "重置为源顺序" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "重置" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0][0]).not.toHaveProperty("nodeOrder");
    await waitFor(() => expect(load).toHaveBeenLastCalledWith("sub-1", { order: "source" }));
  });

  it("加载失败时给出错误与重试", async () => {
    let attempt = 0;
    const load = vi.fn(async (id: string) => {
      attempt += 1;
      if (attempt === 1) throw new Error("读取节点失败：boom");
      return response(id, SUB_ONE_NODES);
    });
    renderSection({ load });

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/读取节点失败/)).toBeTruthy();

    fireEvent.click(within(alert).getByRole("button", { name: "重试" }));
    await screen.findByText("香港 01");
  });

  it("没有订阅时给出空状态而不是空白画布", () => {
    render(<ConfigNodesSection config={{}} subscriptions={[]} onChange={vi.fn()} />);
    expect(screen.getByText("还没有订阅，先去「订阅链接」建一条。")).toBeTruthy();
    expect(screen.getByText("选一条订阅后，这里会铺出它的节点卡片。")).toBeTruthy();
  });
});
