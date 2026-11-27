import { describe, expect, it } from "vitest";
import {
  generateProxyGroups,
  generateRuleProviders,
  generateRules,
  getAllGroupNames,
  getGroupTarget,
  getModulesForTemplate,
} from "./proxy-groups";
import type { CustomProxyGroup } from "@subboost/core/types/config";
import type { ParsedNode } from "@subboost/core/types/node";

function node(name: string): ParsedNode {
  return {
    name,
    type: "ss",
    server: `${name.toLowerCase().replace(/\s+/g, "-")}.example.com`,
    port: 8388,
    cipher: "aes-128-gcm",
    password: "secret",
  } as ParsedNode;
}

function customGroup(id: string, groupType: CustomProxyGroup["groupType"]): CustomProxyGroup {
  return {
    id,
    name: `Custom ${id}`,
    emoji: "C",
    groupType,
    strategy: groupType === "load-balance" ? "round-robin" : undefined,
  };
}

describe("proxy group generator", () => {
  it("uses per-group test URLs only for automatic testing", () => {
    const groups = generateProxyGroups({
      nodes: [node("A")], enabledModules: ["select", "auto", "ad"],
      ruleProviderBaseUrl: "https://rules.example.com", testUrl: "https://probe.example.com/default", testInterval: 60,
      proxyGroupAdvanced: { auto: { testUrl: "https://probe.example.com/auto" } },
      customProxyGroups: [
        { ...customGroup("url", "url-test"), advanced: { testUrl: "https://probe.example.com/custom" } },
        { ...customGroup("filtered", "url-test"), memberSource: "filtered-nodes", advanced: { testUrl: "https://probe.example.com/filtered" } },
        { ...customGroup("fallback", "fallback"), advanced: { testUrl: "https://probe.example.com/ignored" } },
      ],
    });
    expect(groups.find((group) => group.name === "Custom url")?.url).toBe("https://probe.example.com/custom");
    expect(groups.find((group) => group.name === "Custom filtered")?.url).toBe("https://probe.example.com/filtered");
    expect(groups.find((group) => group.name === "Custom fallback")?.url).toBe("https://probe.example.com/default");
    // 内置分组成员表写死、类型固定为 select，分组级 testUrl 不再生效
    expect(groups.find((group) => group.name === "节点选择")).toMatchObject({
      type: "select",
      proxies: ["A"],
    });
    expect(groups.find((group) => group.name === "节点选择")).not.toHaveProperty("url");
    expect(groups.filter((group) => group.type === "select").every((group) => group.url === undefined)).toBe(true);
  });
  it("generates module, custom, advanced-filtered, and provider-backed groups", () => {
    const groups = generateProxyGroups({
      nodes: [node("Node A"), node("Node B")],
      proxyProviderNames: ["remote"],
      enabledModules: ["select", "auto", "cn", "ad", "steam"],
      ruleProviderBaseUrl: "https://rules.example.com",
      testUrl: "https://probe.example.com/204",
      testInterval: 120,
      customProxyGroups: [
        customGroup("select", "select"),
        customGroup("url", "url-test"),
        customGroup("fallback", "fallback"),
        {
          ...customGroup("balance", "load-balance"),
          advanced: { includeRegex: "Node A" },
        },
        customGroup("direct", "direct-first"),
        {
          ...customGroup("reject", "reject-first"),
          advanced: { excludedMembers: [{ kind: "node", name: "Node B" }] },
        },
      ],
    });

    expect(groups.find((group) => group.name === "Custom url")).toMatchObject({
      type: "url-test",
      use: ["remote"],
      lazy: false,
    });
    expect(groups.find((group) => group.name === "Custom fallback")).toMatchObject({ type: "fallback" });
    expect(groups.find((group) => group.name === "Custom balance")).toMatchObject({
      type: "load-balance",
      proxies: ["Node A"],
      strategy: "round-robin",
      url: "https://probe.example.com/204",
      interval: 120,
    });
    expect(groups.find((group) => group.name === "Custom direct")?.proxies?.[0]).toBe("DIRECT");
    const rejectProxies = groups.find((group) => group.name === "Custom reject")?.proxies ?? [];
    expect(rejectProxies.slice(0, 2)).toEqual(["REJECT", "DIRECT"]);
    expect(rejectProxies).not.toContain("Node B");
    // 内置分组固定 5 个、顺序固定，排在自定义分组之前
    expect(groups.map((group) => group.name).slice(0, 5)).toEqual([
      "节点选择",
      "默认分流",
      "国内直连",
      "广告拦截",
      "Steam 代理",
    ]);
    expect(groups.find((group) => group.name === "默认分流")).toMatchObject({
      type: "select",
      use: ["remote"],
    });
  });

  it("generates providers and template metadata helpers", () => {
    const baseOptions = {
      nodes: [node("Node A")],
      ruleProviderBaseUrl: "https://rules.example.com",
      testUrl: "https://probe.example.com/204",
      testInterval: 120,
      builtinRuleEdits: { "module:cn:geoip-cn": { enabled: false as const } },
      customProxyGroups: [customGroup("custom", "select")],
      customRuleSets: [
        {
          id: "custom-rule",
          name: "Custom rule",
          behavior: "domain" as const,
          path: "https://rules.example.com/custom.mrs",
          target: "Custom custom",
        },
      ],
    };
    const providers = generateRuleProviders({
      ...baseOptions,
      enabledModules: ["select", "auto", "cn", "ad", "steam"],
    });
    const withoutAd = generateRuleProviders({
      ...baseOptions,
      enabledModules: ["select", "auto", "cn", "steam"],
    });

    // 内置规则集只剩广告域名集合一个：domain 行为的纯 txt，不再有 format 字段
    expect(Object.keys(providers)).toEqual(["广告集合_rules", "custom-rule"]);
    expect(providers["广告集合_rules"]).toEqual({
      type: "http",
      behavior: "domain",
      url: "https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash/AdvertisingLite/AdvertisingLite_Domain_For_Clash.txt",
      path: "./ruleset/广告集合_rules.list",
      interval: 86400,
    });
    expect(withoutAd["广告集合_rules"]).toBeUndefined();
    expect(providers["custom-rule"]).toMatchObject({
      url: "https://rules.example.com/custom.mrs",
      behavior: "domain",
      format: "mrs",
    });
    // 内置分组固定 5 个，模板之间不再有启用集合差异
    expect(getModulesForTemplate("minimal")).toEqual(["auto", "select", "cn", "ad", "steam"]);
    expect(getModulesForTemplate("standard")).toEqual(["auto", "select", "cn", "ad", "steam"]);
    expect(getModulesForTemplate("full")).toEqual(["auto", "select", "cn", "ad", "steam"]);
    expect(getGroupTarget("cn")).toBe("国内直连");
    expect(getGroupTarget("missing")).toBe("默认分流");
    expect(getAllGroupNames(["select"], [customGroup("custom", "select")])).toContain("Custom custom");
  });

  it("honors advanced group type overrides and explicit members", () => {
    const groups = generateProxyGroups({
      nodes: [node("Node A"), node("Node B")],
      enabledModules: ["select", "auto", "ad", "steam"],
      ruleProviderBaseUrl: "https://rules.example.com",
      testUrl: "https://probe.example.com/204",
      testInterval: 120,
      proxyGroupAdvanced: {
        auto: {
          groupType: "fallback",
          extraMembers: [{ kind: "direct" }],
          memberOrder: [{ kind: "direct" }, { kind: "node", name: "Node B" }],
        },
        cn: { groupType: "load-balance", strategy: "round-robin" },
        steam: { groupType: "url-test" },
      },
    });

    // 高级设置显式改了类型时按类型生成（测速/故障转移/负载均衡都还能用）
    const auto = groups.find((group) => group.name === "节点选择");
    expect(auto).toMatchObject({ type: "fallback", proxies: ["DIRECT", "Node B", "Node A"] });
    const steam = groups.find((group) => group.name === "Steam 代理");
    expect(steam).toMatchObject({ type: "url-test" });
    expect(steam).toHaveProperty("url");

    // 没改类型的仍用固定成员表，不带测速字段
    const select = groups.find((group) => group.name === "默认分流");
    expect(select).toMatchObject({ type: "select", proxies: ["节点选择", "DIRECT"] });
    expect(select).not.toHaveProperty("url");
    expect(select).not.toHaveProperty("interval");
  });

  it("applies load-balance strategy overrides on builtin groups", () => {
    const groups = generateProxyGroups({
      nodes: [node("Node A"), node("Node B")],
      enabledModules: ["cn"],
      ruleProviderBaseUrl: "https://rules.example.com",
      testUrl: "https://probe.example.com/204",
      testInterval: 120,
      proxyGroupAdvanced: { cn: { groupType: "load-balance", strategy: "round-robin" } },
    });

    expect(groups.find((group) => group.name === "国内直连")).toMatchObject({
      type: "load-balance",
      strategy: "round-robin",
      proxies: ["Node A", "Node B"],
    });
  });

  it("同一落地节点出现在两条链时只认第一个出口组", () => {
    const groups = generateProxyGroups({
      nodes: [node("Node A"), node("Node B")],
      enabledModules: ["auto"],
      ruleProviderBaseUrl: "https://rules.example.com",
      testUrl: "https://probe.example.com/204",
      testInterval: 120,
      chainMemberPlan: {
        exitGroups: [
          { id: "c1", name: "出口一", landingNodes: ["Node A"] },
          { id: "c2", name: "出口二", landingNodes: ["Node A"] },
        ],
      },
    });

    // 落地节点被替换成出口组名；出口组不在可用成员里时被过滤，只剩普通节点
    expect(groups.find((group) => group.name === "节点选择")?.proxies).toEqual(["Node B"]);
  });
  it("自定义组名不是字符串时不影响内置分组生成", () => {
    const groups = generateProxyGroups({
      nodes: [node("Node A")],
      enabledModules: ["cn"],
      ruleProviderBaseUrl: "https://rules.example.com",
      testUrl: "https://probe.example.com/204",
      testInterval: 120,
      customProxyGroups: [
        {
          id: "bad-name",
          name: 123 as never,
          emoji: "",
          groupType: "select",
          includeInGroupMembers: true,
        },
      ],
    });

    // 名字不是字符串的自定义组不会被登记成可选成员，内置分组仍按固定成员表生成
    // 名字不是字符串的自定义组不会被登记成可选成员，内置分组仍按固定成员表生成
    expect(groups.some((group) => group.name === "国内直连")).toBe(true);
  });
  it("defaults ordinary custom groups to node-only members without adding them to node select", () => {
    const groups = generateProxyGroups({
      nodes: [node("Node A"), node("Node B")],
      enabledModules: ["select", "auto"],
      ruleProviderBaseUrl: "https://rules.example.com",
      testUrl: "https://probe.example.com/204",
      testInterval: 120,
      customProxyGroups: [
        customGroup("one", "select"),
        customGroup("two", "select"),
        customGroup("direct", "direct-first"),
        customGroup("reject", "reject-first"),
      ],
    });

    // 默认分流的成员表固定为 [节点选择, DIRECT]，普通自定义组不会挤进去
    expect(groups.find((group) => group.name === "默认分流")?.proxies).toEqual([
      "节点选择",
      "DIRECT",
    ]);
    expect(groups.find((group) => group.name === "默认分流")?.proxies).not.toContain("Custom one");
    expect(groups.find((group) => group.name === "默认分流")?.proxies).not.toContain("Custom two");
    expect(groups.find((group) => group.name === "Custom one")?.proxies).toEqual([
      "DIRECT",
      "REJECT",
      "Node A",
      "Node B",
    ]);
    expect(groups.find((group) => group.name === "Custom two")?.proxies).toEqual([
      "DIRECT",
      "REJECT",
      "Node A",
      "Node B",
    ]);
    expect(groups.find((group) => group.name === "Custom direct")?.proxies).toEqual([
      "DIRECT",
      "REJECT",
      "Node A",
      "Node B",
    ]);
    expect(groups.find((group) => group.name === "Custom reject")?.proxies).toEqual([
      "REJECT",
      "DIRECT",
      "Node A",
      "Node B",
    ]);
  });

  it("keeps filtered-node custom groups node-scoped while exposing them as non-select policy members", () => {
    const groups = generateProxyGroups({
      nodes: [node("Node A"), node("Node B"), node("Filtered")],
      proxyProviderNames: ["remote"],
      enabledModules: ["select", "auto", "cn"],
      ruleProviderBaseUrl: "https://rules.example.com",
      testUrl: "https://probe.example.com/204",
      testInterval: 120,
      proxyGroupAdvanced: { cn: { extraMembers: [{ kind: "custom", id: "normal" }] } },
      customProxyGroups: [
        {
          id: "filtered",
          name: "Filtered Group",
          emoji: "",
          memberSource: "filtered-nodes",
          includeInGroupMembers: true,
          groupType: "select",
          advanced: { includeRegex: "Node A|Filtered" },
        },
        { ...customGroup("normal", "select"), includeInGroupMembers: true },
      ],
    });

    expect(groups[0]?.name).toBe("Filtered Group");
    expect(groups.find((group) => group.name === "Filtered Group")?.proxies).toEqual([
      "DIRECT",
      "REJECT",
      "Node A",
      "Filtered",
    ]);
    expect(groups.find((group) => group.name === "Filtered Group")).not.toHaveProperty("use");
    expect(groups.find((group) => group.name === "Filtered Group")?.proxies).not.toContain("Custom normal");
    expect(groups.find((group) => group.name === "Filtered Group")?.proxies).not.toContain("默认分流");
    expect(groups.find((group) => group.name === "Custom normal")?.proxies).not.toContain("Filtered Group");
    expect(groups.find((group) => group.name === "Custom normal")?.proxies).not.toContain("默认分流");
    expect(groups.find((group) => group.name === "Custom normal")?.proxies).not.toContain("Custom normal");
    expect(groups.find((group) => group.name === "Custom normal")).toMatchObject({ use: ["remote"] });
    expect(groups.find((group) => group.name === "默认分流")?.proxies).toEqual(["节点选择", "DIRECT"]);
    // includeInGroupMembers 的自定义组仍可被内置分组显式引用（advanced.extraMembers）
    expect(groups.find((group) => group.name === "国内直连")?.proxies).toEqual(["DIRECT", "Custom normal"]);
  });

  it("keeps filtered-node generated group variants node-scoped and appends inline custom groups without an insert point", () => {
    const groups = generateProxyGroups({
      nodes: [node("Node A"), node("Node B")],
      proxyProviderNames: ["remote"],
      enabledModules: ["select"],
      ruleProviderBaseUrl: "https://rules.example.com",
      testUrl: "https://probe.example.com/204",
      testInterval: 120,
      customProxyGroups: [
        {
          id: "filtered-url",
          name: "Filtered URL",
          emoji: "",
          memberSource: "filtered-nodes",
          includeInGroupMembers: true,
          groupType: "url-test",
          advanced: { includeRegex: "Node A" },
        },
        {
          id: "filtered-fallback",
          name: "Filtered Fallback",
          emoji: "",
          memberSource: "filtered-nodes",
          includeInGroupMembers: true,
          groupType: "fallback",
        },
        {
          id: "filtered-balance",
          name: "Filtered Balance",
          emoji: "",
          memberSource: "filtered-nodes",
          includeInGroupMembers: true,
          groupType: "load-balance",
        },
        customGroup("inline", "select"),
      ],
    });

    expect(groups.slice(0, 3).map((group) => group.name)).toEqual([
      "Filtered URL",
      "Filtered Fallback",
      "Filtered Balance",
    ]);
    expect(groups.find((group) => group.name === "Filtered URL")).toMatchObject({
      type: "url-test",
      proxies: ["Node A"],
    });
    expect(groups.find((group) => group.name === "Filtered URL")).not.toHaveProperty("use");
    expect(groups.find((group) => group.name === "Filtered Fallback")).toMatchObject({
      type: "fallback",
      proxies: ["Node A", "Node B"],
    });
    expect(groups.find((group) => group.name === "Filtered Fallback")).not.toHaveProperty("use");
    expect(groups.find((group) => group.name === "Filtered Balance")).toMatchObject({
      type: "load-balance",
      strategy: "consistent-hashing",
      proxies: ["Node A", "Node B"],
    });
    expect(groups.find((group) => group.name === "Filtered Balance")).not.toHaveProperty("use");
    expect(groups.at(-1)).toMatchObject({ name: "Custom inline", use: ["remote"] });
  });

  it("omits disabled custom groups from groups, providers, names, and custom rules", () => {
    const disabledGroup = { ...customGroup("disabled", "select"), enabled: false };
    const groups = generateProxyGroups({
      nodes: [node("Node A")],
      enabledModules: ["select"],
      ruleProviderBaseUrl: "https://rules.example.com",
      testUrl: "https://probe.example.com/204",
      testInterval: 120,
      customProxyGroups: [disabledGroup],
    });
    const providers = generateRuleProviders({
      nodes: [node("Node A")],
      enabledModules: [],
      ruleProviderBaseUrl: "https://rules.example.com",
      testUrl: "https://probe.example.com/204",
      testInterval: 120,
      customProxyGroups: [disabledGroup],
      customRuleSets: [
        {
          id: "disabled-rule",
          name: "Disabled rule",
          behavior: "domain",
          path: "geosite/disabled.mrs",
          target: { kind: "custom", id: "disabled" },
        },
      ],
    });
    const rules = generateRules({
      enabledModules: [],
      customRules: [
        {
          id: "disabled-manual",
          type: "DOMAIN",
          value: "disabled.example",
          target: { kind: "custom", id: "disabled" },
        },
      ],
      customRuleSets: [
        {
          id: "disabled-rule",
          name: "Disabled rule",
          behavior: "domain",
          path: "geosite/disabled.mrs",
          target: { kind: "custom", id: "disabled" },
        },
      ],
      customProxyGroups: [disabledGroup],
      availablePolicyTargets: ["DIRECT"],
      fallbackPolicyTarget: "DIRECT",
    });

    expect(groups.some((group) => group.name === "Custom disabled")).toBe(false);
    expect(getAllGroupNames(["select"], [disabledGroup])).not.toContain("Custom disabled");
    expect(providers["disabled-rule"]).toBeUndefined();
    // 分组全关时只剩 always 的 6 条（本地回环 2 条 + 进程直连 4 条），自定义条目一条都不生成
    expect(rules).toEqual([
      "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
      "IP-CIDR,::1/128,DIRECT,no-resolve",
      "PROCESS-PATH-REGEX,(?i)leigod,DIRECT",
      "PROCESS-NAME,r5apex_dx12.exe,DIRECT",
      "PROCESS-NAME,start_protected_game.exe,DIRECT",
      "PROCESS-NAME,EasyAntiCheat_EOS.exe,DIRECT",
      "MATCH,DIRECT",
    ]);
  });

  it("covers provider target guards and built-in group type overrides", () => {
    const disabledByName = { ...customGroup("disabled-name", "select"), enabled: false };
    const groups = generateProxyGroups({
      nodes: [node("Node A"), node("Node B")],
      proxyProviderNames: ["remote"],
      enabledModules: ["select", "auto", "cn", "ad", "steam"],
      ruleProviderBaseUrl: "https://rules.example.com",
      testUrl: "https://probe.example.com/204",
      testInterval: 120,
      customProxyGroups: [
        disabledByName,
        {
          id: "blank-name",
          name: "" as never,
          emoji: "",
          includeInGroupMembers: true,
          groupType: "select",
        },
      ],
      proxyGroupAdvanced: {
        auto: { groupType: "load-balance", strategy: "round-robin" },
        cn: { groupType: "reject-first" },
        steam: { groupType: "url-test", regions: ["other"] },
      },
    });
    const providers = generateRuleProviders({
      nodes: [node("Node A")],
      enabledModules: ["cn"],
      ruleProviderBaseUrl: "https://rules.example.com",
      testUrl: "https://probe.example.com/204",
      testInterval: 120,
      customProxyGroups: [disabledByName],
      customRuleSets: [
        {
          id: "skip-by-name",
          name: "Skip",
          behavior: "domain",
          path: "geosite/skip.mrs",
          target: "Custom disabled-name",
        },
        {
          id: "relative-path",
          name: "Relative",
          behavior: "domain",
          path: "geosite/relative.mrs",
          target: "DIRECT",
        },
        {
          id: "relative-path",
          name: "Duplicate",
          behavior: "domain",
          path: "geosite/duplicate.mrs",
          target: "DIRECT",
        },
        {
          id: "",
          name: "Missing id",
          behavior: "domain",
          path: "geosite/missing.mrs",
          target: "DIRECT",
        },
      ],
    });

    // 高级设置显式改了类型时按类型生成
    expect(groups.find((group) => group.name === "节点选择")).toMatchObject({
      type: "load-balance",
      strategy: "round-robin",
      use: ["remote"],
    });
    const cnGroup = groups.find((group) => group.name === "国内直连");
    expect(cnGroup?.type).toBe("select");
    expect(cnGroup?.proxies).toContain("REJECT");
    expect(groups.find((group) => group.name === "Steam 代理")?.type).toBe("url-test");
    expect(providers["skip-by-name"]).toBeUndefined();
    expect(providers["relative-path"]).toMatchObject({
      url: "https://rules.example.com/geosite/relative.mrs",
    });
  });

  it("builds groups without providers while keeping info nodes out of group members", () => {
    const groups = generateProxyGroups({
      nodes: [node("余额 | 10GB"), node("Korea Node"), node("US Node")],
      enabledModules: ["auto", "select", "cn"],
      ruleProviderBaseUrl: "https://rules.example.com",
      testUrl: "https://probe.example.com/204",
      testInterval: 60,
      customProxyGroups: [
        {
          id: "direct-local",
          name: "Direct Local",
          emoji: "",
          includeInGroupMembers: true,
          groupType: "direct-first",
          advanced: { memberOrder: [{ kind: "direct" }, { kind: "node", name: "US Node" }] },
        },
        {
          id: "reject-local",
          name: "Reject Local",
          emoji: "",
          includeInGroupMembers: true,
          groupType: "reject-first",
        },
        {
          id: "filtered-reject",
          name: "Filtered Reject",
          emoji: "",
          memberSource: "filtered-nodes",
          groupType: "reject-first",
          advanced: { includeRegex: "Korea|余额" },
        },
      ],
      proxyGroupAdvanced: {
        auto: {
          extraMembers: [{ kind: "custom", id: "direct-local" }],
          excludedMembers: [{ kind: "node", name: "US Node" }],
        },
      },
    });

    const auto = groups.find((group) => group.name === "节点选择");
    const directLocal = groups.find((group) => group.name === "Direct Local");
    const rejectLocal = groups.find((group) => group.name === "Reject Local");
    const filteredReject = groups.find((group) => group.name === "Filtered Reject");

    // 节点选择 = 全部节点（信息节点除外）+ 显式追加的自定义组 - 显式排除的节点
    expect(auto).toEqual({
      name: "节点选择",
      type: "select",
      proxies: ["Korea Node", "Direct Local"],
    });
    expect(auto?.proxies).not.toContain("余额 | 10GB");
    expect(auto?.proxies).not.toContain("US Node");
    expect(directLocal?.proxies?.slice(0, 2)).toEqual(["DIRECT", "US Node"]);
    expect(directLocal?.proxies).not.toContain("Direct Local");
    expect(rejectLocal?.proxies?.slice(0, 2)).toEqual(["REJECT", "DIRECT"]);
    expect(filteredReject?.proxies).toEqual(["REJECT", "DIRECT", "Korea Node"]);
    // 默认分流的成员表固定，includeInGroupMembers 的自定义组不会自动进入
    expect(groups.find((group) => group.name === "默认分流")?.proxies).toEqual(["节点选择", "DIRECT"]);
  });
});
