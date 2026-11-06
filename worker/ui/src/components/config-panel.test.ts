// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDefaultUserConfig } from "@subboost/core/config/defaults";
import { ConfirmDialogHost } from "@subboost/ui/components/ui/confirm-dialog";
import { AppShell } from "./app-shell";
import { ConfigPanel, type ConfigPanelProps } from "./config-panel";
import type { AppState, ConfigPreview } from "../lib/types";

/**
 * 生成配置页的交互测试：草稿、保存条、子页切换与离开确认都活在 effect 和事件里，
 * 静态渲染跑不到，这里用 jsdom 真跑一遍。只用 createElement：vitest 只收 *.test.ts。
 */

const STATE: AppState = {
  app: { name: "SubBoost Lite", version: "test" },
  sources: [],
  subscriptions: [],
  config: buildDefaultUserConfig("standard") as unknown as Record<string, unknown>,
  configIsDefault: true,
  status: null,
};

const PREVIEW: ConfigPreview = {
  sourceCount: 2,
  snapshotCount: 1,
  nodeCount: 5,
  proxyGroupCount: 16,
  ruleProviderCount: 30,
  rules: ["MATCH,🐟 漏网之鱼"],
};

/** 与吸顶工具条同一套约束：常驻覆盖层不许位移、缩放与过渡 */
const FORBIDDEN_MOTION_CLASSES = [/\b-?translate-[xy]-/u, /\btransform\b/u, /\bscale-\d/u, /\btransition-/u];

function renderPanel(overrides: Partial<ConfigPanelProps> = {}) {
  const props: ConfigPanelProps = {
    state: STATE,
    section: "rules",
    onSectionChange: () => {},
    onSave: async () => {},
    onReset: async () => {},
    ...overrides,
  };
  return render(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(ConfigPanel, props),
      React.createElement(ConfirmDialogHost)
    )
  );
}

function saveBar(container: HTMLElement): HTMLElement | null {
  return container.querySelector("[data-config-save-bar]");
}

function toggleAdRule() {
  fireEvent.click(screen.getByRole("switch", { name: "启用 广告域名" }));
}

async function confirmInDialog(name: string) {
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name }));
}

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  // jsdom 没有实现 scrollIntoView，高亮新增行时会调用它
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("生成配置草稿", () => {
  it("可视化修改后才出现保存条，放弃并确认后回到已保存的配置", async () => {
    const onDirtyChange = vi.fn();
    const { container } = renderPanel({ onDirtyChange });
    expect(saveBar(container)).toBeNull();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    toggleAdRule();
    const bar = saveBar(container);
    expect(bar).not.toBeNull();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText(/有未保存的修改/u, { selector: "p.text-xs" })).toBeTruthy();

    // 常驻层只跑只驱动 opacity 的入场；表面是不透明的 bg-header
    expect(bar!.className).toContain("fixed");
    expect(bar!.className).toContain("animate-fade-in");
    for (const pattern of FORBIDDEN_MOTION_CLASSES) {
      expect(bar!.className, `保存条出现了 ${pattern}`).not.toMatch(pattern);
    }
    const surface = bar!.firstElementChild as HTMLElement;
    expect(surface.className).toContain("bg-header");
    expect(surface.className).not.toContain("backdrop-blur");

    fireEvent.click(within(bar!).getByRole("button", { name: "放弃" }));
    await confirmInDialog("放弃修改");
    await waitFor(() => expect(saveBar(container)).toBeNull());
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect((screen.getByRole("switch", { name: "启用 广告域名" }) as HTMLElement).getAttribute("aria-checked")).toBe(
      "true"
    );
  });

  it("开关改回原样就不算未保存", () => {
    const { container } = renderPanel();
    toggleAdRule();
    expect(saveBar(container)).not.toBeNull();
    toggleAdRule();
    expect(saveBar(container)).toBeNull();
  });

  it("保存提交整份草稿，可视化不认识的字段原样带上", async () => {
    const onSave = vi.fn(async (_config: Record<string, unknown>) => {});
    renderPanel({ onSave, state: { ...STATE, config: { ...STATE.config, futureField: { keep: true } } } });
    const [headerSave] = screen.getAllByRole("button", { name: "保存" });
    expect((headerSave as HTMLButtonElement).disabled).toBe(true);

    toggleAdRule();
    fireEvent.click(screen.getAllByRole("button", { name: "保存" })[0]);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.builtinRuleEdits).toEqual({ "module:ad:category-ads-all": { enabled: false } });
    expect(saved.futureField).toEqual({ keep: true });
    // 只开关、没动顺序：ruleOrder 保持原来的写法，不制造等价的大段 diff
    expect(saved.ruleOrder).toEqual([]);
  });

  it("调整顺序后写回覆盖全部模块的完整顺序", async () => {
    const onSave = vi.fn(async (_config: Record<string, unknown>) => {});
    const config = {
      ...STATE.config,
      customRules: [{ id: "mine", type: "DOMAIN-SUFFIX", value: "example.com", target: "DIRECT" }],
    };
    renderPanel({ onSave, state: { ...STATE, config } });

    fireEvent.click(screen.getByRole("button", { name: "下移 example.com" }));
    fireEvent.click(screen.getAllByRole("button", { name: "保存" })[0]);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const order = (onSave.mock.calls[0][0] as Record<string, unknown>).ruleOrder as string[];
    expect(order).toContain("module:netflix:netflix");
    expect(order.indexOf("custom-rule:mine")).toBe(order.indexOf("module:ai:openai") + 1);
  });

  it("恢复默认前要确认", async () => {
    const onReset = vi.fn(async () => {});
    renderPanel({ onReset, state: { ...STATE, configIsDefault: false } });
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("恢复默认配置？")).toBeTruthy();
    expect(onReset).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "恢复默认" }));
    await waitFor(() => expect(onReset).toHaveBeenCalledTimes(1));
  });
});

describe("规则列表的键盘焦点", () => {
  const config = {
    ...STATE.config,
    customRules: [
      { id: "a", type: "DOMAIN-SUFFIX", value: "a.example.com", target: "DIRECT" },
      { id: "b", type: "DOMAIN-SUFFIX", value: "b.example.com", target: "DIRECT" },
    ],
  };

  it("连按下移时焦点留在同一个按钮上，删除后交给相邻一行", async () => {
    renderPanel({ state: { ...STATE, config } });

    const down = screen.getByRole("button", { name: "下移 a.example.com" });
    down.focus();
    fireEvent.click(down);
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe("下移 a.example.com")
    );
    const lines = Array.from(document.querySelectorAll('ol[aria-label="最终规则"] > li p.font-mono')).map(
      (node) => node.textContent
    );
    expect(lines.indexOf("DOMAIN-SUFFIX,a.example.com,DIRECT")).toBe(lines.indexOf("DOMAIN-SUFFIX,b.example.com,DIRECT") + 1);

    const remove = screen.getByRole("button", { name: "删除 a.example.com" });
    remove.focus();
    fireEvent.click(remove);
    await waitFor(() => expect(screen.queryByRole("button", { name: "删除 a.example.com" })).toBeNull());
    // 焦点不会掉回 body：落到原来紧随其后的那一行
    await waitFor(() => expect(document.activeElement?.closest("li")?.textContent).toContain("openai"));
  });

  it("对话框关闭后把焦点还给打开它的按钮", async () => {
    renderPanel({ state: { ...STATE, config } });
    const opener = screen.getByRole("button", { name: "添加规则" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
});

describe("高级 JSON 子页", () => {
  it("JSON 写坏时不能切回可视化、也不能保存，修好后恢复", () => {
    const onSectionChange = vi.fn();
    renderPanel({ section: "json", onSectionChange });
    const editor = screen.getByLabelText("生成配置 JSON");

    fireEvent.change(editor, { target: { value: "{ broken" } });
    expect(screen.getByText(/^JSON 语法错误/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "规则" }));
    expect(onSectionChange).not.toHaveBeenCalledWith("rules");
    expect(screen.getByText("JSON 有语法错误，修正后才能切回可视化编辑。")).toBeTruthy();
    expect((screen.getAllByRole("button", { name: "保存" })[0] as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(editor, { target: { value: "[]" } });
    expect(screen.getByText("配置必须是一个 JSON 对象")).toBeTruthy();

    fireEvent.change(editor, { target: { value: JSON.stringify({ ...STATE.config, mixedPort: 7000 }) } });
    expect((screen.getAllByRole("button", { name: "保存" })[0] as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "规则" }));
    expect(onSectionChange).toHaveBeenCalledWith("rules");
  });
});

describe("服务端试生成", () => {
  it("去抖后按草稿试生成，并展示摘要", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const onPreview = vi.fn(async () => PREVIEW);
    renderPanel({ onPreview });
    expect(onPreview).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(screen.getByText("生成校验通过")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("1/2 个源");

    // 连续修改只在停下来之后发一次
    toggleAdRule();
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    toggleAdRule();
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(onPreview).toHaveBeenCalledTimes(2);
  });

  it("校验失败时提示，保存前再确认一次", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const onSave = vi.fn(async (_config: Record<string, unknown>) => {});
    const onPreview = vi.fn(async () => {
      throw new Error("基础和 DNS 配置 YAML 解析失败：示例");
    });
    renderPanel({ onPreview, onSave });
    toggleAdRule();
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByText(/生成校验未通过：基础和 DNS 配置 YAML 解析失败/u)).toBeTruthy();

    vi.useRealTimers();
    fireEvent.click(screen.getAllByRole("button", { name: "保存" })[0]);
    await confirmInDialog("仍然保存");
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });
});

describe("离开确认与导航", () => {
  const navItems = [
    { id: "dashboard", label: "仪表板" },
    { id: "config", label: "生成配置" },
  ];

  function renderShell(onNavigate: (id: string) => void | boolean | Promise<boolean>) {
    return render(
      React.createElement(
        AppShell,
        { title: "SubBoost Lite", version: "test", navItems, activeNav: "config", onNavigate },
        React.createElement("p", null, "content")
      )
    );
  }

  it("上层表示没有换页时保持滚动位置", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    renderShell(() => Promise.resolve(false));
    fireEvent.click(screen.getAllByRole("tab", { name: /仪表板/u })[0]);
    await act(async () => {});
    expect(scrollTo).not.toHaveBeenCalled();

    cleanup();
    renderShell(() => false);
    fireEvent.click(screen.getAllByRole("tab", { name: /仪表板/u })[0]);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("确认后才换页并回到顶部", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    renderShell(() => Promise.resolve(true));
    fireEvent.click(screen.getAllByRole("tab", { name: /仪表板/u })[0]);
    await act(async () => {});
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
  });
});
