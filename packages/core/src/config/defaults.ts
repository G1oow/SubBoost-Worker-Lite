import { DEFAULT_DNS_CONFIG } from "@subboost/core/generator/dns";
import { DEFAULT_RULE_PROVIDER_BASE_URL } from "@subboost/core/rules/metadata";
import { TEMPLATES } from "@subboost/core/templates";
import { SUBBOOST_TEMPLATE_CONFIG_SCHEMA } from "@subboost/core/templates/config-template";
import type { ClashConfig, TemplateType, UserConfig } from "@subboost/core/types/config";
import type { SubBoostTemplateConfig } from "@subboost/core/types/template-config";

export const DEFAULT_SUBBOOST_CONFIG = {
  autoSelectStrategy: "url-test",
  testUrl: "https://www.gstatic.com/generate_204",
  testInterval: 300,
  ruleProviderBaseUrl: DEFAULT_RULE_PROVIDER_BASE_URL,
  customRules: [],
  manualDomains: { direct: [], proxy: [], reject: [] } as const,
  manualProcessRules: [],
  steamViaProxy: true,
  steamDownloadViaProxy: false,
  ruleOrder: [],
  cnIpNoResolve: true,
  experimentalCnUseCnRuleSet: true,
  dnsYaml: "",
  mixedPort: 7897,
  allowLan: true,
} as const satisfies Omit<UserConfig, "enabledGroups" | "enabledRules">;

export function buildDefaultUserConfig(template: TemplateType): UserConfig {
  const templateConfig = TEMPLATES[template];
  return {
    enabledGroups: templateConfig.groups,
    enabledRules: templateConfig.rules,
    autoSelectStrategy: DEFAULT_SUBBOOST_CONFIG.autoSelectStrategy,
    testUrl: DEFAULT_SUBBOOST_CONFIG.testUrl,
    testInterval: DEFAULT_SUBBOOST_CONFIG.testInterval,
    ruleProviderBaseUrl: DEFAULT_SUBBOOST_CONFIG.ruleProviderBaseUrl,
    customRules: [...DEFAULT_SUBBOOST_CONFIG.customRules],
    manualDomains: {
      direct: [...DEFAULT_SUBBOOST_CONFIG.manualDomains.direct],
      proxy: [...DEFAULT_SUBBOOST_CONFIG.manualDomains.proxy],
      reject: [...DEFAULT_SUBBOOST_CONFIG.manualDomains.reject],
    },
    manualProcessRules: [...DEFAULT_SUBBOOST_CONFIG.manualProcessRules],
    steamViaProxy: DEFAULT_SUBBOOST_CONFIG.steamViaProxy,
    steamDownloadViaProxy: DEFAULT_SUBBOOST_CONFIG.steamDownloadViaProxy,
    ruleOrder: [...DEFAULT_SUBBOOST_CONFIG.ruleOrder],
    cnIpNoResolve: DEFAULT_SUBBOOST_CONFIG.cnIpNoResolve,
    experimentalCnUseCnRuleSet: DEFAULT_SUBBOOST_CONFIG.experimentalCnUseCnRuleSet,
    dnsYaml: DEFAULT_SUBBOOST_CONFIG.dnsYaml,
    mixedPort: DEFAULT_SUBBOOST_CONFIG.mixedPort,
    allowLan: DEFAULT_SUBBOOST_CONFIG.allowLan,
  };
}

export function buildDefaultBaseConfigPatch(options: {
  mixedPort?: number;
  allowLan?: boolean;
} = {}): ClashConfig {
  return {
    "mixed-port": options.mixedPort ?? DEFAULT_SUBBOOST_CONFIG.mixedPort,
    "allow-lan": options.allowLan ?? DEFAULT_SUBBOOST_CONFIG.allowLan,
    mode: "rule",
    "log-level": "info",
    "unified-delay": true,
    "tcp-concurrent": true,
    "find-process-mode": "strict",
    dns: DEFAULT_DNS_CONFIG,
    profile: {
      "store-selected": true,
      "store-fake-ip": false,
    },
    sniffer: {
      enable: true,
      "parse-pure-ip": true,
      sniff: {
        TLS: { ports: [443, 8443] },
        HTTP: { ports: [80, "8080-8880"], "override-destination": true },
        QUIC: { ports: [443, 8443] },
      },
    },
    "geodata-mode": true,
    "geo-auto-update": true,
    "geodata-loader": "standard",
    "geo-update-interval": 24,
    // 与内置规则同源：GEOSITE/GEOIP 走 meta-rules-dat 的 latest 数据
    "geox-url": {
      geoip: "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip-lite.dat",
      geosite: "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat",
      mmdb: "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country-lite.mmdb",
    },
  };
}

export function buildDefaultSubBoostTemplateConfig(type: TemplateType): SubBoostTemplateConfig {
  const template = TEMPLATES[type];
  return {
    schema: SUBBOOST_TEMPLATE_CONFIG_SCHEMA,
    template: type,
    enabledProxyGroups: template.groups,
    hiddenProxyGroups: [],
    customProxyGroups: [],
    proxyGroupAdvanced: {},
    proxyGroupAdvancedModeEnabled: false,
    customRuleSets: [],
    builtinRuleEdits: {},
    customRules: [],
    manualDomains: { direct: [], proxy: [], reject: [] },
    manualProcessRules: [],
    steamViaProxy: true,
    steamDownloadViaProxy: false,
    ruleOrder: [],
    cnIpNoResolve: DEFAULT_SUBBOOST_CONFIG.cnIpNoResolve,
    experimentalCnUseCnRuleSet: DEFAULT_SUBBOOST_CONFIG.experimentalCnUseCnRuleSet,
    dialerProxyGroups: [],
    proxyGroupNameOverrides: {},
    dnsYaml: DEFAULT_SUBBOOST_CONFIG.dnsYaml,
    mixedPort: DEFAULT_SUBBOOST_CONFIG.mixedPort,
    allowLan: DEFAULT_SUBBOOST_CONFIG.allowLan,
    testUrl: DEFAULT_SUBBOOST_CONFIG.testUrl,
    testInterval: DEFAULT_SUBBOOST_CONFIG.testInterval,
    ruleProviderBaseUrl: DEFAULT_SUBBOOST_CONFIG.ruleProviderBaseUrl,
  };
}

export const DEFAULT_BASE_CONFIG_YAML = `# 基础配置
mixed-port: ${DEFAULT_SUBBOOST_CONFIG.mixedPort}
allow-lan: ${DEFAULT_SUBBOOST_CONFIG.allowLan}
mode: rule
log-level: info
unified-delay: true
tcp-concurrent: true
find-process-mode: strict
# 内置规则用到 GEOSITE / GEOIP，数据源跟规则同步
geodata-mode: true
geo-auto-update: true
geodata-loader: standard
geo-update-interval: 24
geox-url:
  geoip: https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip-lite.dat
  geosite: https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat
  mmdb: https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country-lite.mmdb

# DNS 配置
dns:
  enable: true
  hosts:
    localhost: 127.0.0.1
    "*.localhost": 127.0.0.1
  cache-algorithm: arc
  ipv6: false
  respect-rules: true
  use-hosts: true
  use-system-hosts: true
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter-mode: blacklist
  fake-ip-filter: ["+.lan", "+.local", "+.localhost", "+.home.arpa", "+.in-addr.arpa", "+.ip6.arpa", localhost, stun.l.google.com, stun1.l.google.com, stun2.l.google.com, stun3.l.google.com, stun4.l.google.com, "+.stun.qq.com", "+.stun.miwifi.com", "+.msftconnecttest.com", "+.msftncsi.com", dns.msftncsi.com, "+.miwifi.com", "+.routerlogin.com", "+.routerlogin.net", "+.tplinkwifi.net", "+.tplinklogin.net", router.asus.com, time.windows.com, time.apple.com, time-ios.apple.com, time.cloud.tencent.com, ntp.aliyun.com, "+.ntp.org", "+.captive.apple.com", localhost.ptlogin2.qq.com, localhost.sec.qq.com]
  # 引导 DNS，必须是纯 IP
  default-nameserver: [223.5.5.5, 119.29.29.29]
  # 解析节点域名：只用国内可信 DoH
  proxy-server-nameserver: ["https://223.5.5.5/dns-query#disable-ipv6=true"]
  # 仅控制 DIRECT 出站时的域名解析
  direct-nameserver: [system]
  direct-nameserver-follow-policy: false
  # 默认 nameserver（境外 DoH，配合 respect-rules 经代理出站）
  nameserver: ["https://1.1.1.1/dns-query#disable-ipv6=true", "https://8.8.8.8/dns-query#disable-ipv6=true"]
  # 国内 / 私有域名走国内 DoH
  nameserver-policy:
    "geosite:private,cn,geolocation-cn": ["https://223.5.5.5/dns-query#disable-ipv6=true", "https://119.29.29.29/dns-query#disable-ipv6=true"]

# 配置文件管理
profile:
  store-selected: true
  store-fake-ip: false

# 域名/流量嗅探
sniffer:
  enable: true
  parse-pure-ip: true
  sniff:
    TLS: {ports: [443, 8443]}
    HTTP: {ports: [80, 8080-8880], override-destination: true}
    QUIC: {ports: [443, 8443]}`;
