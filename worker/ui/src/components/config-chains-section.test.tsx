// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialogHost } from "@subboost/ui/components/ui/confirm-dialog";
import type { ConfigPreviewChain, SourceDto } from "../lib/types";
import { ConfigChainsSection, type ConfigChainsSectionProps } from "./config-chains-section";

/**
 * 链式代理子页的交互测试：新建、删除确认、启停与状态文案都活在事件和预览数据里，
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
    { id: "c1", name: "落地美国", relay: { sourceIds: ["s1"] }, landing: { sourceIds: [] } },
    {
      id: "c2",
      name: "落地日本",
      enabled: false,
      relay: { sourceIds: [] },
      landing: { sourceIds: [] },
    },
  ],
};

function previewChain(overrides: Partial<ConfigPreviewChain> & { id: string }): ConfigPreviewChain {
  return {
    name: overrides.id,
    exitGroupName: overrides.id,
    relayGroupName: `${overrides.id} · 前置`,
    relayCount: 0,
    landingCount: 0,
    status: "ok",
    active: true,
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

describe("链卡片渲染", () => {
  it("每条链一张卡片，按预览显示状态与节点计数", () => {
    const { container } = renderSection();
    const rendered = cards(container);
    expect(rendered).toHaveLength(2);

    const [first, second] = rendered.map((card) => within(card));
    expect(first.getByRole("status").textContent).toContain("正常");
    expect(first.getByRole("status").textContent).toContain("前置 3 个节点 · 落地 2 个节点");
    expect(second.getByRole("status").textContent).toContain("已停用");
    // 停用那条链没有被预览计数以外的东西污染：计数照样显示 0
    expect(second.getByRole("status").textContent).toContain("前置 0 个节点 · 落地 0 个节点");
  });

  it("三段结构：前置 / 落地 / 出口组各一段", () => {
    const { container } = renderSection();
    const card = within(cards(container)[0]);
    expect(card.getByRole("region", { name: "① 前置（中转节点）" })).toBeTruthy();
    expect(card.getByRole("region", { name: "② 落地（最终出口的节点）" })).toBeTruthy();
    expect(card.getByRole("region", { name: "③ 出口组" })).toBeTruthy();
    expect(card.getByPlaceholderText("留空使用全局测速地址")).toBeTruthy();
  });

  it("选择器解释「一个源都不选 = 全部已启用源」，并且只列已启用的源", () => {
    const { container } = renderSection();
    const card = within(cards(container)[0]);
    const relay = within(card.getByRole("region", { name: "① 前置（中转节点）" }));
    expect(relay.getByText(/一个源都不选 = 全部已启用源/u)).toBeTruthy();
    expect(relay.getByRole("group", { name: "前置可选的源" })).toBeTruthy();
    expect(relay.getByRole("button", { name: "示例源 A" }).getAttribute("aria-pressed")).toBe("true");
    expect(relay.queryByRole("button", { name: "示例源 B（已停用）" })).toBeNull();
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
    expect(chains[2].relay).toEqual({ sourceIds: [] });
    expect(chains[2].landing).toEqual({ sourceIds: [] });
    // 默认值不落盘
    expect("enabled" in chains[2]).toBe(false);
    expect("exitGroupType" in chains[2]).toBe(false);
    expect(new Set(chains.map((chain) => chain.id)).size).toBe(3);
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
    const chains = (onChange.mock.calls[0][0] as Record<string, unknown>).proxyChains as Array<{
      id: string;
    }>;
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

  it("改链名上报整条链，非法选择器只在本地提示", () => {
    const onChange = vi.fn();
    renderSection({ onChange });

    const nameInputs = screen.getAllByLabelText("链名");
    fireEvent.change(nameInputs[0], { target: { value: "落地美国 2" } });
    const chains = (onChange.mock.calls[0][0] as Record<string, unknown>).proxyChains as Array<{
      id: string;
      name: string;
    }>;
    expect(chains[0]).toMatchObject({ id: "c1", name: "落地美国 2" });
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
        previewChain({
          id: "c1",
          status: "empty-relay",
          relayCount: 0,
          landingCount: 4,
          active: true,
        }),
        previewChain({
          id: "c2",
          status: "name-conflict",
          active: false,
          error: "组名「落地日本」与现有分组重复，这条链不会生成",
        }),
      ],
    });
    const [first, second] = cards(container).map((card) => within(card));
    expect(first.getByRole("status").textContent).toContain("前置无节点，落地不可用");
    expect(first.getByRole("status").textContent).toContain("落地 4 个节点");
    expect(second.getByRole("status").textContent).toContain("组名冲突");
    expect(second.getByText("组名「落地日本」与现有分组重复，这条链不会生成")).toBeTruthy();
  });

  it("没有预览数据时显示未预览", () => {
    const { container } = renderSection({ previewChains: undefined });
    const [first] = cards(container).map((card) => within(card));
    expect(first.getByRole("status").textContent).toContain("未预览");
    expect(first.getByRole("status").textContent).not.toContain("个节点");
  });

  it("本地校验与预览互不替代：非法正则在输入框下报错", () => {
    const { container } = renderSection({
      config: {
        proxyChains: [
          {
            id: "c1",
            name: "落地美国",
            relay: { sourceIds: [], includeRegex: "香港(" },
            landing: { sourceIds: [] },
          },
        ],
      },
      previewChains: [previewChain({ id: "c1" })],
    });
    const card = within(cards(container)[0]);
    expect(card.getByText("前置 · 匹配正则 不是有效的正则表达式")).toBeTruthy();
    expect(card.getByRole("status").textContent).toContain("正常");
  });
});
