// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialogHost } from "@subboost/ui/components/ui/confirm-dialog";
import type { ConfigPreviewChain, SourceDto, SourceNodesResponse } from "../lib/types";
import { ConfigChainsSection, type ConfigChainsSectionProps } from "./config-chains-section";

/**
 * 链式代理子页的交互测试：选源 → 挑节点、新建、删除确认、启停与状态文案都活在事件和预览数据里，
 * 静态渲染跑不到，这里用 jsdom 真跑一遍。
 */

const SOURCES: SourceDto[] = [
  {
    id: "s1",
    name: "示例源 A",
    kind: "remote",
    url: "https://example.com/sub?token=<token>",
    enabled: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  },
  {
    id: "s2",
    name: "示例源 B（已停用）",
    kind: "manual",
    enabled: false,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  },
];

const CONFIG: Record<string, unknown> = {
  proxyChains: [
    {
      id: "c1",
      name: "落地美国",
      relayNodes: [{ sourceId: "s1", nodeKey: "key-relay" }],
      landingNodes: [],
    },
    {
      id: "c2",
      name: "落地日本",
      enabled: false,
      relayNodes: [],
      landingNodes: [],
    },
  ],
};

function nodesResponse(sourceId: string, name: string, keys: string[]): SourceNodesResponse {
  return {
    source: { id: sourceId, name, kind: "manual", enabled: true, nodeRenames: {} },
    fetchedAt: "2026-10-01T00:00:00.000Z",
    nodeCount: keys.length,
    renamedCount: 0,
    nodes: keys.map((key) => ({
      key,
      name: `节点 ${key}`,
      originName: `原 ${key}`,
      type: "ss",
      server: "192.0.2.10",
      port: 8388,
      renamed: false,
    })),
    parseErrors: [],
  };
}

/** 默认的节点来源：s1 里有两个节点，key-relay 是已选前置 */
const defaultLoadNodes = async (sourceId: string): Promise<SourceNodesResponse> =>
  sourceId === "s1"
    ? nodesResponse("s1", "示例源 A", ["key-relay", "key-landing"])
    : nodesResponse(sourceId, "示例源 B（已停用）", ["key-b"]);

function previewChain(overrides: Partial<ConfigPreviewChain> & { id: string }): ConfigPreviewChain {
  return {
    name: overrides.id,
    exitGroupName: overrides.id,
    relayGroupName: `${overrides.id} · 前置`,
    relayCount: 0,
    landingCount: 0,
    status: "ok",
    active: true,
    missingRefs: 0,
    ...overrides,
  };
}

const PREVIEW_CHAINS: ConfigPreviewChain[] = [
  previewChain({ id: "c1", name: "落地美国", relayCount: 3, landingCount: 2 }),
  previewChain({ id: "c2", name: "落地日本", status: "disabled", active: false }),
];

function renderSection(overrides: Partial<ConfigChainsSectionProps> = {}) {
  const props: ConfigChainsSectionProps = {
    config: CONFIG,
    sources: SOURCES,
    previewChains: PREVIEW_CHAINS,
    onLoadNodes: defaultLoadNodes,
    onChange: () => {},
    ...overrides,
  };
  return render(
    <>
      <ConfigChainsSection {...props} />
      <ConfirmDialogHost />
    </>
  );
}

function cards(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-chain-card]"));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** 默认全部收起，需要正文的用例先点开对应卡片的摘要行 */
function expandCard(card: HTMLElement) {
  fireEvent.click(within(card).getByRole("button", { name: /^展开 /u }));
}

/** 找到某条链的某一侧面板 */
function sidePanel(card: HTMLElement, side: "① 前置（中转节点）" | "② 落地（最终出口的节点）") {
  return within(within(card).getByRole("region", { name: side }));
}

describe("折叠", () => {
  it("默认全部收起，只渲染摘要行与常驻状态，不挂载三分栏", () => {
    const { container } = renderSection();
    for (const card of cards(container)) {
      expect(within(card).getByRole("button", { name: /^展开 /u }).getAttribute("aria-expanded")).toBe("false");
      expect(within(card).queryByRole("region", { name: "① 前置（中转节点）" })).toBeNull();
      // 收起也要能看出为什么不生成
      expect(within(card).getByRole("status")).toBeTruthy();
    }
  });

  it("点摘要行展开同一条，再点收起；摘要行在两种状态下是同一个节点", async () => {
    const { container } = renderSection();
    const card = cards(container)[0];
    const summary = within(card).getByRole("button", { name: /^落地美国/u });

    fireEvent.click(summary);
    expect(within(card).getByRole("region", { name: "① 前置（中转节点）" })).toBeTruthy();
    // 链名输入框放在正文里，摘要行不被替换：开合时摘要行高度不跳
    expect(within(card).getByRole("button", { name: /^落地美国/u })).toBe(summary);
    expect(summary.getAttribute("aria-expanded")).toBe("true");
    expect(summary.getAttribute("aria-controls")).toBe("chain-body-c1");
    expect(within(card).getByRole("button", { name: "收起 落地美国" }).getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(within(card).getByRole("button", { name: "收起 落地美国" }));
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    expect(summary.getAttribute("aria-controls")).toBeNull();
    // 正文播完退场动画（MotionReveal）后才卸载，最终不在 DOM 里
    await waitFor(() => expect(within(card).queryByRole("region", { name: "① 前置（中转节点）" })).toBeNull());
  });

  it("展开一条会收起另一条，避免整页同时铺开", async () => {
    const { container } = renderSection();
    const [first, second] = cards(container);

    expandCard(first);
    expect(within(first).getByRole("region", { name: "① 前置（中转节点）" })).toBeTruthy();

    expandCard(second);
    expect(within(second).getByRole("region", { name: "① 前置（中转节点）" })).toBeTruthy();
    await waitFor(() => expect(within(first).queryByRole("region", { name: "① 前置（中转节点）" })).toBeNull());
  });

  it("摘要行可用键盘 Enter 与空格展开", () => {
    const { container } = renderSection();
    const summary = within(cards(container)[0]).getByRole("button", { name: /^落地美国/u });

    fireEvent.keyDown(summary, { key: "Enter" });
    expect(within(cards(container)[0]).getByRole("button", { name: "收起 落地美国" })).toBeTruthy();

    fireEvent.keyDown(summary, { key: " " });
    expect(within(cards(container)[0]).getByRole("button", { name: "展开 落地美国" })).toBeTruthy();
  });

  it("展开后链名是可编辑输入框，收起时只显示文字", () => {
    const { container } = renderSection();
    const card = cards(container)[0];

    expect(within(card).queryByLabelText(/^链名/u)).toBeNull();
    expandCard(card);
    expect(within(card).getByLabelText(/^链名/u)).toBeTruthy();
  });

  it("链名留空时，收起的卡片也在状态行里提示", () => {
    const { container } = renderSection({
      config: { proxyChains: [{ id: "c1", name: "", relayNodes: [], landingNodes: [] }] },
      previewChains: undefined,
    });
    const card = cards(container)[0];
    expect(within(card).getByRole("status").textContent).toContain("请填写链名");

    // 展开后错误跟着输入框走，状态行里不再重复
    expandCard(card);
    expect(within(card).getByRole("status").textContent).not.toContain("请填写链名");
    expect(within(card).getByLabelText(/^链名/u).getAttribute("aria-invalid")).toBe("true");
  });
});

describe("排序", () => {
  /** 带状态的外壳：挪动要真的写回 config 才会重排 */
  function StatefulSection() {
    const [config, setConfig] = React.useState<Record<string, unknown>>(CONFIG);
    return (
      <ConfigChainsSection config={config} sources={SOURCES} onLoadNodes={defaultLoadNodes} onChange={setConfig} />
    );
  }

  it("挪动后焦点留在这张卡片上；挪到底时交给反方向的按钮", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const { container } = render(<StatefulSection />);
    const down = within(cards(container)[0]).getByRole("button", { name: "下移 落地美国" });
    down.focus();
    fireEvent.click(down);

    await waitFor(() => expect(cards(container).map((card) => card.dataset.chainCard)).toEqual(["c2", "c1"]));
    // 已经在最后一条，「下移」变成 disabled，焦点落到「上移」上，键盘可以直接挪回去
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("上移 落地美国"));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});

describe("链卡片渲染", () => {
  it("每条链一张卡片，按预览显示状态与节点计数", () => {
    const { container } = renderSection();
    const rendered = cards(container);
    expect(rendered).toHaveLength(2);

    const [first, second] = rendered.map((card) => within(card));
    expect(first.getByRole("status").textContent).toContain("正常");
    expect(first.getByRole("status").textContent).toContain("前置 3 个节点 · 落地 2 个节点");
    expect(second.getByRole("status").textContent).toContain("已停用");
    expect(second.getByRole("status").textContent).toContain("前置 0 个节点 · 落地 0 个节点");
  });

  it("摘要行按「一个节点」呈现：链路标记与前置→落地计数", () => {
    const { container } = renderSection();
    const card = cards(container)[0];
    // 链名与前缀计数都在摘要行里
    expect(card.textContent).toContain("前置 1 → 落地 0");
  });

  it("三段结构：前置 / 落地 / 出口组各一段", () => {
    const { container } = renderSection();
    const card = within(cards(container)[0]);
    expandCard(cards(container)[0]);
    expect(card.getByRole("region", { name: "① 前置（中转节点）" })).toBeTruthy();
    expect(card.getByRole("region", { name: "② 落地（最终出口的节点）" })).toBeTruthy();
    expect(card.getByRole("region", { name: "③ 出口组" })).toBeTruthy();
    expect(card.getByPlaceholderText("留空使用全局测速地址")).toBeTruthy();
  });

  it("先选源再挑节点：源按钮可切换，只列出全部源并标注已停用", () => {
    const { container } = renderSection();
    expandCard(cards(container)[0]);
    const relay = sidePanel(cards(container)[0], "① 前置（中转节点）");
    const group = relay.getByRole("group", { name: "前置可选的源" });
    expect(within(group).getByRole("button", { name: /示例源 A/u })).toBeTruthy();
    // 已停用的源也能选：链可能引用停用源的节点
    expect(within(group).getByRole("button", { name: /示例源 B/u })).toBeTruthy();
    // 已选前置的源默认是被选中的
    expect(within(group).getByRole("button", { name: /示例源 A/u }).getAttribute("aria-pressed")).toBe("true");
  });

  it("已选节点以 chips 展示，引用失效时给出可读提示", async () => {
    const { container } = renderSection();
    expandCard(cards(container)[0]);
    const relay = sidePanel(cards(container)[0], "① 前置（中转节点）");
    // key-relay 能解析到真实节点名：chip 与列表项共用展示名，所以出现两次
    await waitFor(() => expect(relay.getAllByText("节点 key-relay")).toHaveLength(2));
  });

  it("引用解析不到时 chip 变成「引用已失效」并计数", async () => {
    // 读取到的节点列表里没有 key-relay，chip 就只能显示失效态
    const onlyOther = async (sourceId: string): Promise<SourceNodesResponse> =>
      nodesResponse(sourceId, "示例源 A", ["key-other"]);
    const { container } = renderSection({ onLoadNodes: onlyOther });
    expandCard(cards(container)[0]);
    const relay = sidePanel(cards(container)[0], "① 前置（中转节点）");
    await waitFor(() => expect(relay.getByText("引用已失效")).toBeTruthy());
    expect(relay.getByText(/1 个引用已失效/u)).toBeTruthy();
    expect(relay.getByRole("button", { name: "移除 已失效节点" })).toBeTruthy();
  });

  it("旧中转组有数据时只读展示，标题说明要在高级 JSON 里改", () => {
    renderSection({
      config: {
        ...CONFIG,
        dialerProxyGroups: [
          { id: "d1", name: "旧中转 A", type: "url-test", relayNodes: ["a"], targetNodes: ["b", "c"] },
        ],
      },
    });
    expect(screen.getByText("旧中转组（只读，可在高级 JSON 中编辑）")).toBeTruthy();
    const list = screen.getByRole("list", { name: "旧中转组" });
    expect(within(list).getByText("旧中转 A")).toBeTruthy();
    expect(within(list).getByText("中转 1 个节点 · 落地 2 个节点")).toBeTruthy();
  });

  it("没有链时给出空状态", () => {
    renderSection({ config: {}, previewChains: [] });
    expect(screen.getByText("还没有链式代理，点击「新建链」创建第一条。")).toBeTruthy();
  });
});

describe("编辑操作", () => {
  it("新建链会把新链上报给上层", () => {
    const onChange = vi.fn();
    renderSection({ onChange });
    fireEvent.click(screen.getByRole("button", { name: "新建链" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as Record<string, unknown>;
    const chains = next.proxyChains as Array<Record<string, unknown>>;
    expect(chains).toHaveLength(3);
    // 默认名取没被占用的最小序号：已有两条链但没占用「链式代理 N」
    expect(chains[2].name).toBe("链式代理 1");
    expect(chains[2].relayNodes).toEqual([]);
    expect(chains[2].landingNodes).toEqual([]);
    // 默认值不落盘
    expect("enabled" in chains[2]).toBe(false);
    expect("exitGroupType" in chains[2]).toBe(false);
    expect(new Set(chains.map((chain) => chain.id)).size).toBe(3);
  });

  /** 带状态的外壳：点击要真的写回 config 才会重渲染 */
  function StatefulSection({ onChange }: { onChange?: (next: Record<string, unknown>) => void }) {
    const [config, setConfig] = React.useState<Record<string, unknown>>(CONFIG);
    return (
      <ConfigChainsSection
        config={config}
        sources={SOURCES}
        previewChains={PREVIEW_CHAINS}
        onLoadNodes={defaultLoadNodes}
        onChange={(next) => {
          setConfig(next);
          onChange?.(next);
        }}
      />
    );
  }

  it("点节点即加入该侧，再点移除", async () => {
    const changes: Record<string, unknown>[] = [];
    render(<StatefulSection onChange={(next) => changes.push(next)} />);
    const card = cards(document.body)[0];
    expandCard(card);
    const landing = sidePanel(card, "② 落地（最终出口的节点）");

    // 落地还没选源，先选示例源 A
    fireEvent.click(landing.getByRole("button", { name: /示例源 A/u }));
    // 按钮的可访问名由「协议 + 节点名 + 原名 + 服务器」拼成，用 /key-landing/ 宽松匹配
    const nodeButton = await landing.findByRole("button", { name: /key-landing/u });
    fireEvent.click(nodeButton);

    const chains = (changes.at(-1)?.proxyChains ?? []) as Array<{ landingNodes: Array<{ nodeKey: string }> }>;
    expect(chains[0].landingNodes).toEqual([{ sourceId: "s1", nodeKey: "key-landing" }]);

    // 再点一次同一个列表项即移除：选完重渲染后 DOM 里还有一个 chip 的「移除 …」按钮，
    // 用 aria-pressed 只认列表项
    fireEvent.click(landing.getByRole("button", { name: /key-landing/u, pressed: true }));
    const removed = (changes.at(-1)?.proxyChains ?? []) as Array<{ landingNodes: unknown[] }>;
    expect(removed[0].landingNodes).toEqual([]);
  });

  it("同一个源的不同节点可以分别当前置和落地", async () => {
    const changes: Record<string, unknown>[] = [];
    const { container } = renderSection({ onChange: (next) => changes.push(next) });
    expandCard(cards(container)[0]);
    const card = cards(container)[0];
    const landing = sidePanel(card, "② 落地（最终出口的节点）");

    fireEvent.click(landing.getByRole("button", { name: /示例源 A/u }));
    fireEvent.click(await landing.findByRole("button", { name: /key-landing/u }));

    const chains = (changes.at(-1)?.proxyChains ?? []) as Array<{
      relayNodes: Array<{ nodeKey: string }>;
      landingNodes: Array<{ nodeKey: string }>;
    }>;
    expect(chains[0].relayNodes).toEqual([{ sourceId: "s1", nodeKey: "key-relay" }]);
    expect(chains[0].landingNodes).toEqual([{ sourceId: "s1", nodeKey: "key-landing" }]);
  });

  it("前置可与落地重叠时给出落地优先的提示", async () => {
    const { container } = renderSection({
      config: {
        proxyChains: [
          {
            id: "c1",
            name: "同节点链",
            relayNodes: [{ sourceId: "s1", nodeKey: "key-relay" }],
            landingNodes: [{ sourceId: "s1", nodeKey: "key-relay" }],
          },
        ],
      },
      previewChains: undefined,
    });
    expandCard(cards(container)[0]);
    const relay = sidePanel(cards(container)[0], "① 前置（中转节点）");
    await waitFor(() => expect(relay.getByText(/落地优先/u)).toBeTruthy());
  });

  it("启停开关按链上报", () => {
    const onChange = vi.fn();
    renderSection({ onChange });
    fireEvent.click(screen.getByRole("switch", { name: "启用 落地日本" }));

    const chains = (onChange.mock.calls[0][0] as Record<string, unknown>).proxyChains as Array<
      Record<string, unknown>
    >;
    // 停用转启用：默认值不落盘，enabled 字段直接消失
    expect("enabled" in chains[1]).toBe(false);
  });

  it("删除必须先确认，确认后才上报", async () => {
    const onChange = vi.fn();
    renderSection({ onChange });

    fireEvent.click(screen.getByRole("button", { name: "删除 落地美国" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("删除「落地美国」？")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const chains = (onChange.mock.calls[0][0] as Record<string, unknown>).proxyChains as Array<{ id: string }>;
    expect(chains.map((chain) => chain.id)).toEqual(["c2"]);
  });

  it("取消删除不上报变更", async () => {
    const onChange = vi.fn();
    renderSection({ onChange });

    fireEvent.click(screen.getByRole("button", { name: "删除 落地美国" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("上移/下移按钮在两端禁用", () => {
    renderSection();
    expect((screen.getByRole("button", { name: "上移 落地美国" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "下移 落地日本" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "下移 落地美国" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("改链名上报整条链", () => {
    const onChange = vi.fn();
    renderSection({ onChange });

    expandCard(cards(document.body)[0]);
    const nameInputs = screen.getAllByLabelText(/^链名/u);
    fireEvent.change(nameInputs[0], { target: { value: "落地美国 2" } });
    const chains = (onChange.mock.calls[0][0] as Record<string, unknown>).proxyChains as Array<{
      id: string;
      name: string;
    }>;
    expect(chains[0]).toMatchObject({ id: "c1", name: "落地美国 2" });
  });

  it("节点列表加载失败时可重试", async () => {
    // 一直失败直到点重试：挂载时 effect 可能连续跑两次，用一次性 reject 会被第二次成功盖掉
    let shouldFail = true;
    const loadNodes = vi.fn<() => Promise<SourceNodesResponse>>(async () => {
      if (shouldFail) throw new Error("读取节点失败");
      return nodesResponse("s1", "示例源 A", ["key-relay"]);
    });
    const { container } = renderSection({ onLoadNodes: loadNodes });
    expandCard(cards(container)[0]);
    const relay = sidePanel(cards(container)[0], "① 前置（中转节点）");

    // 前置已选源 s1，挂载即拉节点 → 失败落在错误态
    await waitFor(() => expect(relay.getByText("读取节点失败")).toBeTruthy());
    shouldFail = false;
    fireEvent.click(relay.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(relay.getAllByText("节点 key-relay")).toHaveLength(2));
  });
});

describe("状态文案", () => {
  it("停用与落地为空分别有可读文案", () => {
    const { container } = renderSection({
      previewChains: [
        previewChain({ id: "c1", status: "empty-landing", active: false }),
        previewChain({ id: "c2", status: "disabled", active: false }),
      ],
    });
    const [first, second] = cards(container).map((card) => within(card));
    expect(first.getByRole("status").textContent).toContain("落地无节点，不生成");
    expect(second.getByRole("status").textContent).toContain("已停用");
  });

  it("前置为空与组名冲突带服务端原因", () => {
    const { container } = renderSection({
      previewChains: [
        previewChain({ id: "c1", status: "empty-relay", relayCount: 0, landingCount: 4, active: true }),
        previewChain({
          id: "c2",
          status: "name-conflict",
          active: false,
          error: "组名「落地日本」与现有分组重复，这条链不会生成",
        }),
      ],
    });
    const [first, second] = cards(container).map((card) => within(card));
    expect(first.getByRole("status").textContent).toContain("前置无节点");
    expect(first.getByRole("status").textContent).toContain("落地 4 个节点");
    expect(second.getByRole("status").textContent).toContain("组名冲突");
    expect(second.getByText("组名「落地日本」与现有分组重复，这条链不会生成")).toBeTruthy();
  });

  it("引用失效有独立文案", () => {
    const { container } = renderSection({
      previewChains: [
        previewChain({
          id: "c1",
          status: "missing-refs",
          missingRefs: 2,
          error: "2 个节点引用已失效（源被删除/停用或节点已不存在），已跳过",
        }),
      ],
    });
    const status = within(cards(container)[0]).getByRole("status");
    expect(status.textContent).toContain("部分引用失效");
    expect(status.textContent).toContain("2 个节点引用已失效");
  });

  it("没有预览数据时显示未预览", () => {
    const { container } = renderSection({ previewChains: undefined });
    const [first] = cards(container).map((card) => within(card));
    expect(first.getByRole("status").textContent).toContain("未预览");
    expect(first.getByRole("status").textContent).not.toContain("个节点");
  });

  it("本地校验与预览互不替代：没选落地就在状态行报错", () => {
    const { container } = renderSection({
      config: { proxyChains: [{ id: "c1", name: "落地美国", relayNodes: [], landingNodes: [] }] },
      previewChains: [previewChain({ id: "c1" })],
    });
    const card = within(cards(container)[0]);
    expect(card.getByRole("status").textContent).toContain("还没有选择落地节点");
    // 预览仍然独立显示，两者互不覆盖
    expect(card.getByRole("status").textContent).toContain("正常");
  });

  it("组类型下拉带可访问名，标签能关联到触发器", () => {
    const { container } = renderSection();
    expandCard(cards(container)[0]);
    const card = within(cards(container)[0]);
    const exit = card.getByLabelText("出口组类型");
    const relay = card.getByLabelText("前置组类型");
    expect(exit.getAttribute("role")).toBe("combobox");
    expect(relay.getAttribute("role")).toBe("combobox");
  });

  it("链名撞上内置分组名时本地就报占用", () => {
    const { container } = renderSection({
      config: { proxyChains: [{ id: "c1", name: "🚀 节点选择", relayNodes: [], landingNodes: [] }] },
      previewChains: undefined,
    });
    expect(within(cards(container)[0]).getByText(/已被内置分组/)).toBeTruthy();
  });

  it("芯片上的移除按钮能去掉已选节点", async () => {
    const changes: Record<string, unknown>[] = [];
    const { container } = renderSection({ onChange: (next) => changes.push(next) });
    expandCard(cards(container)[0]);
    const relay = sidePanel(cards(container)[0], "① 前置（中转节点）");

    const remove = await relay.findByRole("button", { name: "移除 节点 key-relay" });
    fireEvent.click(remove);
    const chains = (changes.at(-1)?.proxyChains ?? []) as Array<{ relayNodes: unknown[] }>;
    expect(chains[0].relayNodes).toEqual([]);
  });
});
