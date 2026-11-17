import { describe, expect, it } from "vitest";
import {
  SUBBOOST_TEMPLATE_CONFIG_SCHEMA,
  validateSubBoostTemplateConfig,
} from "./config-template";

function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: SUBBOOST_TEMPLATE_CONFIG_SCHEMA,
    template: "standard",
    enabledProxyGroups: ["auto", "select", "cn", "ad", "steam"],
    hiddenProxyGroups: [],
    customProxyGroups: [],
    proxyGroupAdvanced: {},
    proxyGroupAdvancedModeEnabled: false,
    customRuleSets: [],
    builtinRuleEdits: {},
    customRules: [],
    ruleOrder: [],
    dialerProxyGroups: [],
    proxyGroupNameOverrides: {},
    dnsYaml: "",
    mixedPort: 7897,
    allowLan: true,
    testUrl: "https://cp.cloudflare.com/generate_204",
    testInterval: 300,
    ruleProviderBaseUrl: "https://rules.example.com",
    ...overrides,
  };
}

function invalid(overrides: Record<string, unknown>, error: string) {
  expect(validateSubBoostTemplateConfig(baseConfig(overrides))).toMatchObject({ ok: false, error });
}

describe("手动域名 / 进程 / Steam 开关的配置校验", () => {
  it("缺省时给空清单与默认开关", () => {
    const result = validateSubBoostTemplateConfig(baseConfig());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.manualDomains).toEqual({ direct: [], proxy: [], reject: [] });
    expect(result.config.manualProcessRules).toEqual([]);
    expect(result.config.steamViaProxy).toBe(true);
    expect(result.config.steamDownloadViaProxy).toBe(false);
  });

  it("保留原文并去掉空白条目", () => {
    const result = validateSubBoostTemplateConfig(
      baseConfig({
        manualDomains: { direct: [" *.example.com ", ""], proxy: ["example.org"], reject: [] },
        manualProcessRules: [" steam.exe ", "  "],
        steamViaProxy: false,
        steamDownloadViaProxy: true,
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.manualDomains).toEqual({
      direct: ["*.example.com"],
      proxy: ["example.org"],
      reject: [],
    });
    expect(result.config.manualProcessRules).toEqual(["steam.exe"]);
    expect(result.config.steamViaProxy).toBe(false);
    expect(result.config.steamDownloadViaProxy).toBe(true);
  });

  it("拒绝结构非法的清单与开关", () => {
    invalid({ manualDomains: [] }, "manualDomains 必须是对象");
    invalid({ manualDomains: { direct: "example.com" } }, "manualDomains.direct 必须是数组");
    invalid({ manualDomains: { proxy: [123] } }, "manualDomains.proxy 只能包含字符串");
    invalid({ manualProcessRules: "steam.exe" }, "manualProcessRules 必须是数组");
    invalid({ manualProcessRules: [123] }, "manualProcessRules 只能包含字符串");
    invalid({ steamViaProxy: "yes" }, "steamViaProxy 必须是布尔值");
    invalid({ steamDownloadViaProxy: 1 }, "steamDownloadViaProxy 必须是布尔值");
  });
});

describe("自定义分组字段校验", () => {
  it("memberSource 只接受 filtered-nodes", () => {
    expect(
      validateSubBoostTemplateConfig(
        baseConfig({
          customProxyGroups: [
            { id: "g", name: "Group", emoji: "", groupType: "select", memberSource: "all-nodes" },
          ],
        })
      )
    ).toMatchObject({ ok: false, error: "customProxyGroups.memberSource 无效" });

    expect(
      validateSubBoostTemplateConfig(
        baseConfig({
          customProxyGroups: [
            { id: "g", name: "Group", emoji: "", groupType: "select", memberSource: "filtered-nodes" },
          ],
        })
      ).ok
    ).toBe(true);
  });
});

describe("自定义分组布尔字段", () => {
  it("enabled 必须是布尔值", () => {
    invalid(
      { customProxyGroups: [{ id: "g", name: "Group", emoji: "", groupType: "select", enabled: "yes" }] },
      "customProxyGroups.enabled 必须是布尔值"
    );
  });
});
