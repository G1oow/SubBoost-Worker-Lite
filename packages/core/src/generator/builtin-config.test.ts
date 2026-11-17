import { describe, expect, it } from "vitest";
import type { ParsedNode } from "@subboost/core/types/node";
import { generateClashConfig, generateClashYaml } from "./index";
import { DEFAULT_DNS_CONFIG } from "./dns";

function ssNode(name: string): ParsedNode {
  return {
    name,
    type: "ss",
    server: "ss.example.com",
    port: 8388,
    cipher: "aes-128-gcm",
    password: "secret",
  } as ParsedNode;
}

function buildConfig() {
  return generateClashConfig({
    nodes: [ssNode("Node A"), ssNode("Node B")],
    userConfig: {
      enabledGroups: ["auto", "select", "cn", "ad", "steam"],
      customRules: [],
    },
  });
}

describe("内置配置：分组与规则", () => {
  it("只生成脚本里的 5 个分组，成员表写死", () => {
    const config = buildConfig();
    const groups = (config["proxy-groups"] ?? []) as Array<{ name: string; type: string; proxies: string[] }>;

    expect(groups.map((group) => group.name)).toEqual([
      "自动选择",
      "手动选择",
      "国内直连",
      "广告拦截",
      "Steam 代理",
    ]);
    expect(groups.every((group) => group.type === "select")).toBe(true);
    expect(groups[0].proxies).toEqual(["Node A", "Node B"]);
    expect(groups[1].proxies).toEqual(["自动选择", "DIRECT"]);
    expect(groups[2].proxies).toEqual(["DIRECT"]);
    expect(groups[3].proxies).toEqual(["REJECT"]);
    expect(groups[4].proxies).toEqual(["自动选择", "手动选择", "DIRECT"]);
  });

  it("规则集只剩广告域名集合一个 provider", () => {
    const config = buildConfig();
    const providers = (config["rule-providers"] ?? {}) as Record<string, Record<string, unknown>>;

    expect(Object.keys(providers)).toEqual(["广告集合_rules"]);
    expect(providers["广告集合_rules"]).toMatchObject({
      type: "http",
      behavior: "domain",
      url: expect.stringContaining("AdvertisingLite_Domain_For_Clash.txt"),
    });
    expect(providers["广告集合_rules"]).not.toHaveProperty("format");
  });

  it("生成的 YAML 带上完整规则与这版 DNS/全局设置", () => {
    const yaml = generateClashYaml({
      nodes: [ssNode("Node A")],
      userConfig: { customRules: [] },
    });

    expect(yaml).toContain("- IP-CIDR,127.0.0.0/8,DIRECT,no-resolve");
    expect(yaml).toContain("- PROCESS-NAME,steam.exe,Steam 代理");
    expect(yaml).toContain("- RULE-SET,广告集合_rules,广告拦截");
    expect(yaml).toContain("- GEOSITE,geolocation-!cn,自动选择");
    expect(yaml).toContain("- MATCH,手动选择");
    expect(yaml).toContain("find-process-mode: strict");
    expect(yaml).toContain("tcp-concurrent: true");
    expect(yaml).toContain("geox-url:");
    expect(yaml).toContain("respect-rules: true");
    expect(yaml).toContain("198.18.0.1/16");
  });

  it("默认 DNS 与内置规则同源：国外 DoH + 国内 DoH 分流", () => {
    expect(DEFAULT_DNS_CONFIG["default-nameserver"]).toEqual(["223.5.5.5", "119.29.29.29"]);
    expect(DEFAULT_DNS_CONFIG.nameserver).toEqual([
      "https://1.1.1.1/dns-query#disable-ipv6=true",
      "https://8.8.8.8/dns-query#disable-ipv6=true",
    ]);
    expect(DEFAULT_DNS_CONFIG["nameserver-policy"]).toHaveProperty("geosite:private,cn,geolocation-cn");
    expect(DEFAULT_DNS_CONFIG["respect-rules"]).toBe(true);
    expect(DEFAULT_DNS_CONFIG["fake-ip-filter"]).toContain("+.msftconnecttest.com");
    expect(DEFAULT_DNS_CONFIG).not.toHaveProperty("fallback");
  });
});

function rulesOf(userConfig: Record<string, unknown>): string[] {
  const config = generateClashConfig({
    nodes: [ssNode("Node A")],
    userConfig: { customRules: [], ...userConfig },
  });
  return (config.rules ?? []) as string[];
}

describe("手动域名 / 进程规则 / Steam 开关", () => {
  it("三份手动域名清单生成在广告规则集之前，目标各自对应", () => {
    const rules = rulesOf({
      manualDomains: {
        direct: ["*.cdn.example.com", "https://example.net/path", "192.0.2.10"],
        proxy: ["api.example.org"],
        reject: ["ads.example.net"],
      },
    });
    const adIndex = rules.indexOf("RULE-SET,广告集合_rules,广告拦截");
    expect(rules.slice(adIndex - 5, adIndex)).toEqual([
      "DOMAIN-SUFFIX,cdn.example.com,国内直连",
      "DOMAIN-SUFFIX,api.example.org,自动选择",
      "DOMAIN-SUFFIX,ads.example.net,广告拦截",
      "DOMAIN-SUFFIX,example.net,国内直连",
      "IP-CIDR,192.0.2.10/32,国内直连,no-resolve",
    ]);
  });

  it("手动进程规则排在域名规则之前，目标固定 DIRECT", () => {
    const rules = rulesOf({
      manualProcessRules: ["curl", "PROCESS-PATH-REGEX,(?i)leigod,DIRECT"],
      manualDomains: { direct: ["example.net"], proxy: [], reject: [] },
    });
    const processIndex = rules.indexOf("PROCESS-NAME,curl,DIRECT");
    const domainIndex = rules.indexOf("DOMAIN-SUFFIX,example.net,国内直连");
    expect(processIndex).toBeGreaterThanOrEqual(0);
    expect(processIndex).toBeLessThan(domainIndex);
    expect(rules).toContain("PROCESS-PATH-REGEX,(?i)leigod,DIRECT");
  });

  it("关掉 Steam 走代理后，Steam 规则全部回到 DIRECT", () => {
    const rules = rulesOf({ steamViaProxy: false });
    expect(rules).toContain("PROCESS-NAME,steam.exe,DIRECT");
    expect(rules).toContain("DOMAIN-SUFFIX,steamcommunity.com,DIRECT");
    expect(rules).toContain("GEOSITE,steam,DIRECT");
    expect(rules).not.toContain("DOMAIN-SUFFIX,steamcommunity.com,Steam 代理");
  });

  it("打开下载 CDN 走代理后，只有 CDN 规则改到 Steam 代理", () => {
    const rules = rulesOf({ steamDownloadViaProxy: true });
    expect(rules).toContain("DOMAIN,steamcdn-a.akamaihd.net,Steam 代理");
    expect(rules).toContain("DOMAIN-SUFFIX,st.dl.bscstorage.net,Steam 代理");
    expect(rules).toContain("DOMAIN-SUFFIX,steamcommunity.com,Steam 代理");
  });

  it("默认仍是 Steam 走代理、CDN 直连", () => {
    const rules = rulesOf({});
    expect(rules).toContain("PROCESS-NAME,steam.exe,Steam 代理");
    expect(rules).toContain("DOMAIN,steamcdn-a.akamaihd.net,DIRECT");
  });
});
