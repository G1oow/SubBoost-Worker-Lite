import { describe, expect, it } from "vitest";
import {
  buildGeneratedRuleEntries,
  buildRuleOrderView,
  generateRules,
  getCustomRuleSetOrderKey,
  hasFullRuleOrderKeys,
  normalizePersistedRuleOrder,
  resolveFullRuleOrder,
  resolveModuleName,
} from "./rules";
import { PROXY_GROUP_MODULES } from "./proxy-group-modules";

const ALL_MODULES = PROXY_GROUP_MODULES.map((module) => module.id);

function generate(overrides: Record<string, unknown> = {}): string[] {
  return generateRules({
    enabledModules: ALL_MODULES,
    customRules: [],
    customRuleSets: [],
    ...overrides,
  } as Parameters<typeof generateRules>[0]);
}

const FULL_RULES = [
  // 本地回环
  "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
  "IP-CIDR,::1/128,DIRECT,no-resolve",
  // Steam 进程
  "PROCESS-NAME,steam.exe,Steam 代理",
  "PROCESS-NAME,steamwebhelper.exe,Steam 代理",
  "PROCESS-NAME,steamservice.exe,Steam 代理",
  // Steam 下载 CDN（直连）
  "DOMAIN,steamcdn-a.akamaihd.net,DIRECT",
  "DOMAIN,steampipe.akamaized.net,DIRECT",
  "DOMAIN,steampipe-kr.akamaized.net,DIRECT",
  "DOMAIN,steampipe-partner.akamaized.net,DIRECT",
  "DOMAIN-SUFFIX,steam.cdn.on.net,DIRECT",
  "DOMAIN-SUFFIX,steam.apac.qtlglb.com,DIRECT",
  "DOMAIN-SUFFIX,steam.eca.qtlglb.com,DIRECT",
  "DOMAIN-SUFFIX,steam.naeu.qtlglb.com,DIRECT",
  "DOMAIN-SUFFIX,steam.ru.qtlglb.com,DIRECT",
  "DOMAIN-SUFFIX,steam.cdn.webra.ru,DIRECT",
  "DOMAIN-SUFFIX,steam.cdn.orcon.net.nz,DIRECT",
  "DOMAIN-SUFFIX,steam.cdn.slingshot.co.nz,DIRECT",
  "DOMAIN-SUFFIX,client-update.queniuqe.com,DIRECT",
  "DOMAIN-SUFFIX,dl.steam.clngaa.com,DIRECT",
  "DOMAIN-SUFFIX,st.dl.bscstorage.net,DIRECT",
  "DOMAIN-SUFFIX,st.dl.eccdnx.com,DIRECT",
  "DOMAIN-SUFFIX,st.dl.pinyuncloud.com,DIRECT",
  "DOMAIN-SUFFIX,steampowered.com.8686c.com,DIRECT",
  "DOMAIN-SUFFIX,steamstatic.com.8686c.com,DIRECT",
  "DOMAIN,lv.queniujq.cn,DIRECT",
  "DOMAIN,xz.pphimalayanrt.com,DIRECT",
  // Steam 服务域名（代理）
  "DOMAIN-SUFFIX,steam-chat.com,Steam 代理",
  "DOMAIN-SUFFIX,steamcommunity.com,Steam 代理",
  "DOMAIN-SUFFIX,steamcontent.com,Steam 代理",
  "DOMAIN-SUFFIX,steamgames.com,Steam 代理",
  "DOMAIN-SUFFIX,steampowered.com,Steam 代理",
  "DOMAIN-SUFFIX,steamserver.net,Steam 代理",
  "DOMAIN-SUFFIX,steamstatic.com,Steam 代理",
  "DOMAIN-SUFFIX,steamusercontent.com,Steam 代理",
  "DOMAIN-SUFFIX,valve.net,Steam 代理",
  "DOMAIN-SUFFIX,valvesoftware.com,Steam 代理",
  "DOMAIN-SUFFIX,s.team,Steam 代理",
  "GEOSITE,steam,Steam 代理",
  // 进程直连
  "PROCESS-PATH-REGEX,(?i)leigod,DIRECT",
  "PROCESS-NAME,r5apex_dx12.exe,DIRECT",
  "PROCESS-NAME,start_protected_game.exe,DIRECT",
  "PROCESS-NAME,EasyAntiCheat_EOS.exe,DIRECT",
  // 广告规则集（自定义规则插在它前面）
  "RULE-SET,广告集合_rules,广告拦截",
  // GEO 兜底
  "GEOSITE,private,国内直连",
  "GEOSITE,onedrive,国内直连",
  "GEOSITE,microsoft@cn,国内直连",
  "GEOSITE,category-games@cn,国内直连",
  "GEOSITE,geolocation-!cn,节点选择",
  "GEOSITE,cn,国内直连",
  "GEOIP,telegram,节点选择",
  "GEOIP,private,国内直连,no-resolve",
  "GEOIP,cn,国内直连",
  "MATCH,默认分流",
];

describe("内置规则生成", () => {
  it("默认输出与脚本一致的完整规则表", () => {
    expect(generate()).toEqual(FULL_RULES);
  });

  it("自定义规则与规则集插在广告规则集之前", () => {
    const rules = generate({
      customRules: [{ id: "r1", type: "DOMAIN-SUFFIX", value: "example.com", target: "国内直连" }],
      customRuleSets: [
        { id: "my-set", name: "我的规则集", behavior: "domain", path: "geosite/cn.mrs", target: "国内直连" },
      ],
    });
    const index = rules.indexOf("RULE-SET,广告集合_rules,广告拦截");
    expect(rules.slice(index - 2, index)).toEqual([
      "DOMAIN-SUFFIX,example.com,国内直连",
      "RULE-SET,my-set,国内直连",
    ]);
    expect(rules.at(-1)).toBe("MATCH,默认分流");
  });

  it("自定义规则可以按 ruleOrder 调整相对顺序，内置规则位置不动", () => {
    const customRules = [
      { id: "a", type: "DOMAIN", value: "a.example.com", target: "国内直连" },
      { id: "b", type: "DOMAIN", value: "b.example.com", target: "国内直连" },
    ];
    const base = generate({ customRules });
    const reordered = generate({ customRules, ruleOrder: ["custom-rule:b", "custom-rule:a"] });
    const ruleA = "DOMAIN,a.example.com,国内直连";
    const ruleB = "DOMAIN,b.example.com,国内直连";
    expect(base.indexOf(ruleA)).toBeLessThan(base.indexOf(ruleB));
    expect(reordered.indexOf(ruleB)).toBeLessThan(reordered.indexOf(ruleA));
    // 手动条目之外必须与默认顺序逐条一致（用精确集合判断，不做子串匹配）
    const customTexts = new Set([ruleA, ruleB]);
    expect(reordered.filter((rule) => !customTexts.has(rule))).toEqual(FULL_RULES);
  });

  it("内置规则支持停用与改目标", () => {
    const rules = generate({
      builtinRuleEdits: {
        "module:steam:geosite-steam": { enabled: false },
        "module:auto:geo-non-cn": { target: { kind: "module", id: "steam" } },
      },
    });
    expect(rules).not.toContain("GEOSITE,steam,Steam 代理");
    expect(rules).toContain("GEOSITE,geolocation-!cn,Steam 代理");
  });

  it("关闭分组后它的规则不再生成，但本地回环与进程直连保留", () => {
    const rules = generate({ enabledModules: ["select", "auto", "cn"] });
    expect(rules).not.toContain("PROCESS-NAME,steam.exe,Steam 代理");
    expect(rules).not.toContain("RULE-SET,广告集合_rules,广告拦截");
    expect(rules).toContain("IP-CIDR,127.0.0.0/8,DIRECT,no-resolve");
    expect(rules).toContain("PROCESS-NAME,r5apex_dx12.exe,DIRECT");
    expect(rules.at(-1)).toBe("MATCH,默认分流");
  });

  it("分组名改过之后规则目标跟着改", () => {
    const rules = generate({ proxyGroupNameOverrides: { steam: "游戏代理" } });
    expect(rules).toContain("DOMAIN-SUFFIX,steamcommunity.com,🎮 游戏代理");
    expect(rules).toContain("MATCH,默认分流");
  });

  it("目标分组不可用时回退到兜底策略", () => {
    const entries = buildGeneratedRuleEntries({
      enabledModules: ALL_MODULES,
      customRules: [],
      availablePolicyTargets: ["默认分流", "DIRECT", "REJECT"],
      fallbackPolicyTarget: "默认分流",
    } as Parameters<typeof buildGeneratedRuleEntries>[0]);
    const steamRule = entries.find((entry) => entry.key === "module:steam:domain-steamcommunity");
    expect(steamRule?.target).toBe("默认分流");
  });

  it("MATCH 永远指向默认分流", () => {
    const entries = buildGeneratedRuleEntries({
      enabledModules: ALL_MODULES,
      customRules: [],
    });
    expect(entries.at(-1)?.text).toBe("MATCH,默认分流");
  });
});

describe("手动域名 / 进程规则与顺序视图", () => {
  it("手动条目插在广告规则集之前，且不进入持久化顺序", () => {
    const options = {
      enabledModules: ALL_MODULES,
      customRules: [],
      manualDomains: { direct: ["cdn.example.com"], proxy: ["api.example.org"], reject: [] },
      manualProcessRules: ["curl"],
    };
    const view = buildRuleOrderView(options);
    const texts = view.entries.map((entry) => entry.text);
    expect(texts).toContain("PROCESS-NAME,curl,DIRECT");
    expect(texts).toContain("DOMAIN-SUFFIX,cdn.example.com,国内直连");
    expect(texts.indexOf("DOMAIN-SUFFIX,api.example.org,节点选择")).toBeLessThan(
      texts.indexOf("RULE-SET,广告集合_rules,广告拦截")
    );
    expect(view.fullOrder.some((key) => key.startsWith("manual-"))).toBe(true);
    expect(normalizePersistedRuleOrder(options).some((key) => key.startsWith("manual-"))).toBe(false);
  });

  it("广告分组关闭时手动条目仍然生成（位置落到末尾）", () => {
    const view = buildRuleOrderView({
      enabledModules: ["select", "auto"],
      customRules: [],
      manualDomains: { direct: ["example.net"], proxy: [], reject: [] },
    });
    expect(view.entries.map((entry) => entry.text)).toContain("DOMAIN-SUFFIX,example.net,国内直连");
  });

  it("未知分组名原样返回，特殊规则键也算完整顺序", () => {
    expect(resolveModuleName("nope")).toBe("nope");
    expect(hasFullRuleOrderKeys(["special:match"])).toBe(true);
    expect(hasFullRuleOrderKeys(["custom-rule:a"])).toBe(false);
  });
});

describe("规则顺序视图", () => {
  it("完整顺序覆盖全部内置规则与系统规则", () => {
    const full = resolveFullRuleOrder({ enabledModules: ALL_MODULES, customRules: [] });
    expect(full).toHaveLength(FULL_RULES.length - 1);
    expect(full[0]).toBe("module:cn:loopback-v4");
    expect(full.at(-1)).toBe("module:cn:geoip-cn");
  });

  it("视图保留停用的内置规则，便于就地重新启用", () => {
    const view = buildRuleOrderView({
      enabledModules: ALL_MODULES,
      customRules: [],
      builtinRuleEdits: { "module:ad:ad-set": { enabled: false } },
    });
    const adRule = view.entries.find((entry) => entry.key === "module:ad:ad-set");
    expect(adRule?.enabled).toBe(false);
    expect(view.matchEntry.text).toBe("MATCH,默认分流");
  });

  it("自定义规则集使用固定 key 前缀", () => {
    expect(getCustomRuleSetOrderKey("my-set")).toBe("custom-rule-set:my-set");
  });
});

