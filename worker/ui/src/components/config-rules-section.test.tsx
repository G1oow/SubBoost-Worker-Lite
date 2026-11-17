// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDefaultUserConfig } from "@subboost/core/config/defaults";
import { ConfigRulesSection } from "./config-rules-section";

/**
 * 「规则」子页的覆写脚本分区：域名/进程 chips、Steam 开关、整段自定义规则、
 * 规则集删除与只读预览都活在事件里，静态渲染跑不到，这里用 jsdom 真跑一遍。
 */

const BASE = buildDefaultUserConfig("standard") as unknown as Record<string, unknown>;

type Config = Record<string, unknown>;

/** 受控包装：把 onChange 的结果写回 props，才能连点两次「添加」 */
function Harness({ initial, onChange }: { initial: Config; onChange: (next: Config) => void }) {
  const [config, setConfig] = React.useState(initial);
  return (
    <ConfigRulesSection
      config={config}
      onChange={(next) => {
        setConfig(next);
        onChange(next);
      }}
    />
  );
}

function renderSection(overrides: Config = {}) {
  const onChange = vi.fn<(next: Config) => void>();
  const view = render(<Harness initial={{ ...BASE, ...overrides }} onChange={onChange} />);
  return { ...view, onChange };
}

/** 最近一次写回的配置 */
function lastConfig(onChange: ReturnType<typeof vi.fn>): Config {
  const calls = onChange.mock.calls as Array<[Config]>;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0];
}

function manualDomains(config: Config): { direct: string[]; proxy: string[]; reject: string[] } {
  return config.manualDomains as { direct: string[]; proxy: string[]; reject: string[] };
}

/** jsdom 的 input 会把 value 里的换行吃掉，多行粘贴走真的 paste 事件 + 剪贴板原文 */
function paste(input: HTMLElement, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  fireEvent(input, event);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("手动域名规则", () => {
  it("添加直连域名写入 manualDomains.direct，其余字段原样保留", () => {
    const { onChange } = renderSection();
    const input = screen.getByLabelText("输入直连域名");

    fireEvent.change(input, { target: { value: "*.Example.com" } });
    // 即时回显：core 的归一化结果直接写在输入框下面
    expect(screen.getByText("将生成 DOMAIN-SUFFIX,example.com")).toBeTruthy();
    fireEvent.submit(input.closest("form")!);

    const saved = lastConfig(onChange);
    expect(manualDomains(saved).direct).toEqual(["*.Example.com"]);
    expect(manualDomains(saved).proxy).toEqual([]);
    expect(saved.mixedPort).toBe(BASE.mixedPort);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("删除 chip 后写回剩余条目，并把焦点还给输入框", () => {
    const { onChange } = renderSection({
      manualDomains: { direct: ["example.com", "example.org"], proxy: [], reject: [] },
    });

    fireEvent.click(screen.getByRole("button", { name: "删除 直连域名 example.com" }));

    expect(manualDomains(lastConfig(onChange)).direct).toEqual(["example.org"]);
    expect(document.activeElement).toBe(screen.getByLabelText("输入直连域名"));
  });

  it("单行输入按空格/逗号拆开，粘贴多行直接落成多条", () => {
    const { onChange } = renderSection();
    const input = screen.getByLabelText("输入直连域名");

    fireEvent.change(input, { target: { value: "a.example.com, b.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "添加直连域名" }));
    expect(manualDomains(lastConfig(onChange)).direct).toEqual(["a.example.com", "b.example.com"]);

    // 单行 input 会吞掉换行，所以多行粘贴走剪贴板原文
    paste(input, "c.example.com\n192.0.2.7");
    expect(manualDomains(lastConfig(onChange)).direct).toEqual([
      "a.example.com",
      "b.example.com",
      "c.example.com",
      "192.0.2.7",
    ]);

    // IP 的即时回显带上 no-resolve
    fireEvent.change(input, { target: { value: "198.51.100.9" } });
    expect(screen.getByText("将生成 IP-CIDR,198.51.100.9/32,no-resolve")).toBeTruthy();
  });

  it("归一化失败的条目不写入，并说明被忽略的值", () => {
    const { onChange } = renderSection();
    const input = screen.getByLabelText("输入拦截域名");

    fireEvent.change(input, { target: { value: "a.*.com" } });
    expect(screen.getByText("无法归一化，添加时会被忽略")).toBeTruthy();
    fireEvent.submit(input.closest("form")!);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("无法归一化，已忽略：a.*.com")).toBeTruthy();
  });

  it("三列各自绑定一个分流组，重复条目会提示已在列表中", () => {
    renderSection({ manualDomains: { direct: ["example.com"], proxy: [], reject: [] } });
    expect(screen.getByText("→ 国内直连")).toBeTruthy();
    expect(screen.getByText("→ 自动选择")).toBeTruthy();
    expect(screen.getByText("→ 广告拦截")).toBeTruthy();

    const input = screen.getByLabelText("输入直连域名");
    fireEvent.change(input, { target: { value: "*.example.com" } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByText("已在列表中：*.example.com")).toBeTruthy();
  });
});

describe("手动进程规则", () => {
  it("添加进程名写入 manualProcessRules，含逗号的规则原样透传", () => {
    const { onChange } = renderSection();
    const input = screen.getByLabelText("输入进程名");

    fireEvent.change(input, { target: { value: "steam.exe" } });
    expect(screen.getByText("将生成 PROCESS-NAME,steam.exe,DIRECT")).toBeTruthy();
    fireEvent.submit(input.closest("form")!);
    expect(lastConfig(onChange).manualProcessRules).toEqual(["steam.exe"]);

    // 一行一个：多行粘贴走剪贴板原文，含逗号的完整规则原样透传
    paste(input, "foo.exe\nPROCESS-NAME,bar.exe,自动选择");
    expect(lastConfig(onChange).manualProcessRules).toEqual(["steam.exe", "foo.exe", "PROCESS-NAME,bar.exe,自动选择"]);
  });

  it("删除进程规则后写回剩余条目", () => {
    const { onChange } = renderSection({ manualProcessRules: ["steam.exe", "foo.exe"] });
    fireEvent.click(screen.getByRole("button", { name: "删除进程规则 steam.exe" }));
    expect(lastConfig(onChange).manualProcessRules).toEqual(["foo.exe"]);
  });
});

describe("Steam 路由", () => {
  it("两个开关各写各的布尔字段，关掉总开关后下载开关禁用", () => {
    const { onChange } = renderSection();

    fireEvent.click(screen.getByRole("switch", { name: "下载 CDN 也走代理（默认直连）" }));
    expect(lastConfig(onChange).steamDownloadViaProxy).toBe(true);
    expect(lastConfig(onChange).steamViaProxy).toBe(true);

    fireEvent.click(screen.getByRole("switch", { name: "Steam 流量走 Steam 代理" }));
    expect(lastConfig(onChange).steamViaProxy).toBe(false);
    expect(screen.getByRole("switch", { name: "下载 CDN 也走代理（默认直连）" })).toHaveProperty("disabled", true);
  });

  it("说明写明内置清单的规模", () => {
    renderSection();
    expect(screen.getByText(/内置 11 个 Steam\/Valve 域名、21 个下载 CDN、3 个进程规则/u)).toBeTruthy();
  });
});

describe("自定义完整规则", () => {
  it("整段文本解析后写入 customRules，非法的行会拦住应用", () => {
    const { onChange } = renderSection();
    const box = screen.getByLabelText("自定义完整规则");
    const apply = screen.getByRole("button", { name: "应用规则" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);

    fireEvent.change(box, { target: { value: "DOMAIN-SUFFIX,example.net,自动选择\nIP-CIDR,192.0.2.0/24,DIRECT,no-resolve" } });
    expect(screen.getByText("可写入 2 条")).toBeTruthy();
    fireEvent.click(apply);

    const saved = lastConfig(onChange);
    expect(saved.customRules).toEqual([
      { id: expect.any(String), type: "DOMAIN-SUFFIX", value: "example.net", target: { kind: "module", id: "auto" } },
      { id: expect.any(String), type: "IP-CIDR", value: "192.0.2.0/24", target: "DIRECT", noResolve: true },
    ]);
    // 文本重新按实际写入的规则排出来
    expect((screen.getByLabelText("自定义完整规则") as HTMLTextAreaElement).value).toBe(
      "DOMAIN-SUFFIX,example.net,自动选择\nIP-CIDR,192.0.2.0/24,DIRECT,no-resolve"
    );

    fireEvent.change(box, { target: { value: "DOMAIN-SUFFIX,example.net,不存在的分组" } });
    expect(screen.getByText(/第 1 行：未知目标：不存在的分组/u)).toBeTruthy();
    expect((screen.getByRole("button", { name: "应用规则" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("整段文本替换掉旧的自定义规则", () => {
    const { onChange } = renderSection({
      customRules: [{ id: "old", type: "DOMAIN-SUFFIX", value: "old.example.com", target: "DIRECT" }],
    });
    const box = screen.getByLabelText("自定义完整规则");
    expect((box as HTMLTextAreaElement).value).toBe("DOMAIN-SUFFIX,old.example.com,DIRECT");

    fireEvent.change(box, { target: { value: "DOMAIN-SUFFIX,new.example.com,DIRECT" } });
    fireEvent.click(screen.getByRole("button", { name: "应用规则" }));

    const rules = lastConfig(onChange).customRules as Array<{ value: string }>;
    expect(rules.map((rule) => rule.value)).toEqual(["new.example.com"]);
  });

  it("已有规则可以逐条删除", () => {
    const { onChange } = renderSection({
      customRules: [{ id: "mine", type: "DOMAIN-SUFFIX", value: "example.com", target: "DIRECT" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "删除规则 DOMAIN-SUFFIX,example.com,DIRECT" }));
    expect(lastConfig(onChange).customRules).toEqual([]);
  });
});

describe("规则集", () => {
  it("内置广告集合只读，自定义规则集可以删除", () => {
    const { onChange } = renderSection({
      customRuleSets: [
        {
          id: "example-set",
          name: "示例规则集",
          behavior: "domain",
          path: "https://example.com/geosite/example.mrs",
          target: "DIRECT",
        },
      ],
    });

    expect(screen.getByText("RULE-SET,广告集合_rules")).toBeTruthy();
    expect(screen.getByText("内置 · 只读")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /删除规则集 广告集合_rules/u })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "删除规则集 示例规则集" }));
    expect(lastConfig(onChange).customRuleSets).toEqual([]);
  });
});

describe("最终规则预览", () => {
  it("默认收起，展开后按行号列出规则，MATCH 固定在最后", () => {
    renderSection();
    const toggle = screen.getByRole("button", { name: "展开预览" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBeNull();
    expect(screen.queryByLabelText("最终规则预览")).toBeNull();

    fireEvent.click(toggle);
    const list = screen.getByRole("list", { name: "最终规则预览" });
    const rows = within(list)
      .getAllByRole("listitem")
      .map((row) => row.textContent ?? "");
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.some((row) => row.includes("RULE-SET,广告集合_rules,广告拦截"))).toBe(true);
    expect(rows[rows.length - 1]).toContain("MATCH,");

    fireEvent.click(screen.getByRole("button", { name: "收起预览" }));
  });
});
