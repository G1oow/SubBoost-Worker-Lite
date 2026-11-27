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
  proxyGroupCount: 5,
  ruleProviderCount: 1,
  chains: [],
  rules: ["MATCH,默认分流"],
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

/** 让草稿变脏的开关：Steam 路由的第一个开关（默认开启） */
function steamSwitch(): HTMLElement {
  return screen.getByRole("switch", { name: "Steam 流量走 Steam 代理" });
}

function toggleSteam() {
  fireEvent.click(steamSwitch());
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

    toggleSteam();
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
    expect(steamSwitch().getAttribute("aria-checked")).toBe("true");
  });

  it("开关改回原样就不算未保存", () => {
    const { container } = renderPanel();
    toggleSteam();
    expect(saveBar(container)).not.toBeNull();
    toggleSteam();
    expect(saveBar(container)).toBeNull();
  });

  it("保存提交整份草稿，可视化不认识的字段原样带上", async () => {
    const onSave = vi.fn(async (_config: Record<string, unknown>) => {});
    renderPanel({ onSave, state: { ...STATE, config: { ...STATE.config, futureField: { keep: true } } } });
    const [headerSave] = screen.getAllByRole("button", { name: "保存" });
    expect((headerSave as HTMLButtonElement).disabled).toBe(true);

    toggleSteam();
    fireEvent.click(screen.getAllByRole("button", { name: "保存" })[0]);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.steamViaProxy).toBe(false);
    expect(saved.futureField).toEqual({ keep: true });
    // 只开关、没动顺序：ruleOrder 保持原来的写法，不制造等价的大段 diff
    expect(saved.ruleOrder).toEqual([]);
  });

  it("自定义完整规则应用后写回覆盖全部模块的完整顺序", async () => {
    const onSave = vi.fn(async (_config: Record<string, unknown>) => {});
    renderPanel({ onSave });

    fireEvent.change(screen.getByLabelText("自定义完整规则"), {
      target: { value: "DOMAIN-SUFFIX,example.com,DIRECT" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用规则" }));
    fireEvent.click(screen.getAllByRole("button", { name: "保存" })[0]);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0] as Record<string, unknown>;
    const order = saved.ruleOrder as string[];
    // 完整顺序覆盖全部内置规则，自定义条目排在 MATCH 之前
    expect(order.filter((key) => key.startsWith("module:"))).toHaveLength(52);
    expect(order).toContain("module:ad:ad-set");
    expect(order.filter((key) => key.startsWith("custom-rule:"))).toHaveLength(1);
    expect(saved.customRules).toEqual([
      { id: expect.any(String), type: "DOMAIN-SUFFIX", value: "example.com", target: "DIRECT" },
    ]);
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

describe("规则子页的草稿", () => {
  it("添加直连域名后出现保存条，保存时带上 manualDomains", async () => {
    const onSave = vi.fn(async (_config: Record<string, unknown>) => {});
    const { container } = renderPanel({ onSave });
    expect(saveBar(container)).toBeNull();

    const input = screen.getByLabelText("输入直连域名");
    fireEvent.change(input, { target: { value: "example.com" } });
    fireEvent.submit(input.closest("form")!);
    expect(saveBar(container)).not.toBeNull();

    // 加完又删掉：草稿回到与已保存配置等价的状态，保存条随之消失
    fireEvent.click(screen.getByRole("button", { name: "删除 直连域名 example.com" }));
    expect(saveBar(container)).toBeNull();

    fireEvent.change(input, { target: { value: "example.org" } });
    fireEvent.submit(input.closest("form")!);
    fireEvent.click(screen.getAllByRole("button", { name: "保存" })[0]);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect((onSave.mock.calls[0][0] as Record<string, unknown>).manualDomains).toEqual({
      direct: ["example.org"],
      proxy: [],
      reject: [],
    });
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
    toggleSteam();
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    toggleSteam();
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
    toggleSteam();
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

describe("页面布局与折叠", () => {
  it("链式代理分段带数量徽标，子页切换走只淡入的入场", () => {
    const config = {
      ...STATE.config,
      proxyChains: [{ id: "c1", name: "演示链", relay: { sourceIds: [] }, landing: { sourceIds: [] } }],
    };
    renderPanel({ state: { ...STATE, config } });
    expect(screen.getByRole("tab", { name: /链式代理/u }).textContent).toContain("1");
    const panel = screen.getByRole("tabpanel", { name: "规则" });
    expect(panel.className).toContain("animate-page-in");
    for (const pattern of FORBIDDEN_MOTION_CLASSES.slice(0, 3)) {
      expect(panel.className).not.toMatch(pattern);
    }
  });

  it("没有链时分段不显示徽标", () => {
    renderPanel();
    expect(screen.getByRole("tab", { name: "链式代理" }).textContent).toBe("链式代理");
  });

  it("最终规则预览默认收起，展开后按行号列出规则，再收起时正文退场后卸载", async () => {
    renderPanel();
    const toggle = screen.getByRole("button", { name: "展开预览" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBeNull();
    expect(document.getElementById("config-rule-preview")).toBeNull();

    fireEvent.click(toggle);
    const body = document.getElementById("config-rule-preview");
    expect(body).not.toBeNull();
    expect(toggle.getAttribute("aria-controls")).toBe("config-rule-preview");
    // 预览是只读列表：带行号，MATCH 固定在最后
    const rows = within(body as HTMLElement).getAllByRole("listitem");
    expect(rows.length).toBeGreaterThan(10);
    expect(rows[0]!.textContent).toMatch(/^1/u);
    expect(rows[rows.length - 1]!.textContent).toContain("MATCH,默认分流");

    fireEvent.click(screen.getByRole("button", { name: "收起预览" }));
    await waitFor(() => expect(document.getElementById("config-rule-preview")).toBeNull());
  });

  it("JSON 子页的格式化按钮在卡片头，与标题同排", () => {
    renderPanel({ section: "json" });
    const button = screen.getByRole("button", { name: "格式化" });
    expect(button.closest("div.pb-4, [class*='pb-4']")?.textContent).toContain("高级 JSON");
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
