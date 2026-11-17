/**
 * 内置分流分组与内置规则（静态定义）
 *
 * 这一版内置规则由一份手写覆写脚本等价转换而来，规则是**字面量**的
 * （DOMAIN-SUFFIX / GEOSITE / GEOIP / PROCESS-* / RULE-SET），不再从
 * mrs 规则集动态生成。分组也固定为 5 个。
 *
 * 注意：该文件只包含静态数据与类型定义。
 */

import type { ProxyGroupGroupType } from "@subboost/core/types/config";

/** 内置分组里可用的成员引用：节点全集、其它内置分组、内置策略 */
export type ProxyGroupModuleMember =
  | { nodes: true }
  | { module: string }
  | "DIRECT"
  | "REJECT";

/**
 * 分组规则
 *
 * - `text`：字面量规则的前半段（到目标之前），如 `DOMAIN-SUFFIX,steamcommunity.com`
 * - 目标默认是所属分组；需要固定策略时用 `policyTarget` 指定 DIRECT / REJECT
 * - `behavior` / `path` 保留给历史配置与自定义规则集，内置规则不再使用
 */
export interface ProxyGroupRule {
  id: string;
  name: string;
  behavior?: "domain" | "ipcidr";
  path?: string;
  noResolve?: boolean;
  text?: string;
  policyTarget?: "DIRECT" | "REJECT";
  /** Steam 下载 CDN：目标随「下载 CDN 也走代理」开关变化 */
  downloadCdn?: boolean;
  /** 该规则不受分组开关影响，始终生成（本地回环、进程直连） */
  always?: boolean;
}

/**
 * 分流代理组配置
 */
export interface ProxyGroupModule {
  id: string;
  name: string;
  emoji: string;
  category: "core" | "service" | "media" | "social" | "game" | "tech" | "finance" | "other";
  description: string;
  groupType: ProxyGroupGroupType;
  rules: ProxyGroupRule[];
  /** 固定成员表：给了它就不再按默认策略铺开成员 */
  members?: ProxyGroupModuleMember[];
}

export const BUILTIN_RULE_PROVIDER_ID = "广告集合_rules";
export const BUILTIN_RULE_PROVIDER_URL =
  "https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash/AdvertisingLite/AdvertisingLite_Domain_For_Clash.txt";

export const PROXY_GROUP_MODULES: ProxyGroupModule[] = [
  {
    id: "auto",
    name: "自动选择",
    emoji: "⚡",
    category: "core",
    description: "全部节点，手动挑一个即可",
    groupType: "select",
    // 脚本版：proxies = 全部节点名
    members: [{ nodes: true }],
    rules: [],
  },
  {
    id: "select",
    name: "手动选择",
    emoji: "🚀",
    category: "core",
    description: "兜底出口：未命中任何规则时走这里",
    groupType: "select",
    members: [{ module: "auto" }, "DIRECT"],
    rules: [],
  },
  {
    id: "cn",
    name: "国内直连",
    emoji: "🔒",
    category: "core",
    description: "国内域名 / 私有网络 / 本地回环直连",
    groupType: "select",
    members: ["DIRECT"],
    rules: [
      { id: "loopback-v4", name: "本地回环 IPv4", text: "IP-CIDR,127.0.0.0/8", policyTarget: "DIRECT", noResolve: true, always: true },
      { id: "loopback-v6", name: "本地回环 IPv6", text: "IP-CIDR,::1/128", policyTarget: "DIRECT", noResolve: true, always: true },
      { id: "proc-leigod", name: "雷神加速器（按路径）", text: "PROCESS-PATH-REGEX,(?i)leigod", policyTarget: "DIRECT", always: true },
      { id: "proc-apex", name: "APEX 本体", text: "PROCESS-NAME,r5apex_dx12.exe", policyTarget: "DIRECT", always: true },
      { id: "proc-apex-eac", name: "EAC 启动器", text: "PROCESS-NAME,start_protected_game.exe", policyTarget: "DIRECT", always: true },
      { id: "proc-apex-eac-svc", name: "EAC 服务", text: "PROCESS-NAME,EasyAntiCheat_EOS.exe", policyTarget: "DIRECT", always: true },
      { id: "geo-private", name: "私有网络域名", text: "GEOSITE,private" },
      { id: "geo-onedrive", name: "OneDrive", text: "GEOSITE,onedrive" },
      { id: "geo-microsoft-cn", name: "微软中国", text: "GEOSITE,microsoft@cn" },
      { id: "geo-games-cn", name: "国内游戏平台", text: "GEOSITE,category-games@cn" },
      { id: "geo-cn", name: "国内域名", text: "GEOSITE,cn" },
      { id: "geoip-private", name: "私有网段", text: "GEOIP,private", noResolve: true },
      { id: "geoip-cn", name: "国内 IP", text: "GEOIP,cn" },
    ],
  },
  {
    id: "ad",
    name: "广告拦截",
    emoji: "🛑",
    category: "core",
    description: "广告域名规则集拦截",
    groupType: "select",
    members: ["REJECT"],
    rules: [
      {
        id: "ad-set",
        name: "广告域名集合（blackmatrix7 AdvertisingLite）",
        text: `RULE-SET,${BUILTIN_RULE_PROVIDER_ID}`,
      },
    ],
  },
  {
    id: "steam",
    name: "Steam 代理",
    emoji: "🎮",
    category: "game",
    description: "Steam 客户端与服务走代理；下载 CDN 单独直连",
    groupType: "select",
    members: [{ module: "auto" }, { module: "select" }, "DIRECT"],
    rules: [
      { id: "proc-steam", name: "Steam 主程序", text: "PROCESS-NAME,steam.exe" },
      { id: "proc-steam-web", name: "Steam 内嵌浏览器", text: "PROCESS-NAME,steamwebhelper.exe" },
      { id: "proc-steam-svc", name: "Steam 后台服务", text: "PROCESS-NAME,steamservice.exe" },
      { id: "cdn-akamaihd", name: "Steam CDN (Akamai)", text: "DOMAIN,steamcdn-a.akamaihd.net", downloadCdn: true },
      { id: "cdn-steampipe", name: "Steam CDN (SteamPipe)", text: "DOMAIN,steampipe.akamaized.net", downloadCdn: true },
      { id: "cdn-steampipe-kr", name: "Steam CDN (韩国)", text: "DOMAIN,steampipe-kr.akamaized.net", downloadCdn: true },
      { id: "cdn-steampipe-partner", name: "Steam CDN (合作方)", text: "DOMAIN,steampipe-partner.akamaized.net", downloadCdn: true },
      { id: "cdn-on-net", name: "Steam CDN (on.net)", text: "DOMAIN-SUFFIX,steam.cdn.on.net", downloadCdn: true },
      { id: "cdn-qtlglb-apac", name: "Steam CDN (QTL APAC)", text: "DOMAIN-SUFFIX,steam.apac.qtlglb.com", downloadCdn: true },
      { id: "cdn-qtlglb-eca", name: "Steam CDN (QTL ECA)", text: "DOMAIN-SUFFIX,steam.eca.qtlglb.com", downloadCdn: true },
      { id: "cdn-qtlglb-naeu", name: "Steam CDN (QTL NAEU)", text: "DOMAIN-SUFFIX,steam.naeu.qtlglb.com", downloadCdn: true },
      { id: "cdn-qtlglb-ru", name: "Steam CDN (QTL RU)", text: "DOMAIN-SUFFIX,steam.ru.qtlglb.com", downloadCdn: true },
      { id: "cdn-webra", name: "Steam CDN (Webra)", text: "DOMAIN-SUFFIX,steam.cdn.webra.ru", downloadCdn: true },
      { id: "cdn-orcon", name: "Steam CDN (Orcon)", text: "DOMAIN-SUFFIX,steam.cdn.orcon.net.nz", downloadCdn: true },
      { id: "cdn-slingshot", name: "Steam CDN (Slingshot)", text: "DOMAIN-SUFFIX,steam.cdn.slingshot.co.nz", downloadCdn: true },
      { id: "cdn-queniuqe", name: "Steam CDN (client-update)", text: "DOMAIN-SUFFIX,client-update.queniuqe.com", downloadCdn: true },
      { id: "cdn-clngaa", name: "Steam CDN (clngaa)", text: "DOMAIN-SUFFIX,dl.steam.clngaa.com", downloadCdn: true },
      { id: "cdn-bscstorage", name: "Steam CDN (bscstorage)", text: "DOMAIN-SUFFIX,st.dl.bscstorage.net", downloadCdn: true },
      { id: "cdn-eccdnx", name: "Steam CDN (eccdnx)", text: "DOMAIN-SUFFIX,st.dl.eccdnx.com", downloadCdn: true },
      { id: "cdn-pinyuncloud", name: "Steam CDN (pinyuncloud)", text: "DOMAIN-SUFFIX,st.dl.pinyuncloud.com", downloadCdn: true },
      { id: "cdn-8686c-powered", name: "Steam CDN (8686c / steampowered)", text: "DOMAIN-SUFFIX,steampowered.com.8686c.com", downloadCdn: true },
      { id: "cdn-8686c-static", name: "Steam CDN (8686c / steamstatic)", text: "DOMAIN-SUFFIX,steamstatic.com.8686c.com", downloadCdn: true },
      { id: "cdn-queniujq", name: "Steam CDN (queniujq)", text: "DOMAIN,lv.queniujq.cn", downloadCdn: true },
      { id: "cdn-pphimalayanrt", name: "Steam CDN (pphimalayanrt)", text: "DOMAIN,xz.pphimalayanrt.com", downloadCdn: true },
      { id: "domain-steam-chat", name: "Steam 聊天", text: "DOMAIN-SUFFIX,steam-chat.com" },
      { id: "domain-steamcommunity", name: "Steam 社区", text: "DOMAIN-SUFFIX,steamcommunity.com" },
      { id: "domain-steamcontent", name: "Steam 内容", text: "DOMAIN-SUFFIX,steamcontent.com" },
      { id: "domain-steamgames", name: "Steam 游戏", text: "DOMAIN-SUFFIX,steamgames.com" },
      { id: "domain-steampowered", name: "Steam 官网", text: "DOMAIN-SUFFIX,steampowered.com" },
      { id: "domain-steamserver", name: "Steam 服务器", text: "DOMAIN-SUFFIX,steamserver.net" },
      { id: "domain-steamstatic", name: "Steam 静态资源", text: "DOMAIN-SUFFIX,steamstatic.com" },
      { id: "domain-steamusercontent", name: "Steam 用户内容", text: "DOMAIN-SUFFIX,steamusercontent.com" },
      { id: "domain-valve-net", name: "Valve 网络", text: "DOMAIN-SUFFIX,valve.net" },
      { id: "domain-valvesoftware", name: "Valve 官网", text: "DOMAIN-SUFFIX,valvesoftware.com" },
      { id: "domain-s-team", name: "s.team", text: "DOMAIN-SUFFIX,s.team" },
      { id: "geosite-steam", name: "Steam 域名合集", text: "GEOSITE,steam" },
    ],
  },
];

/**
 * 内置规则的规范生成顺序（自上而下、命中即停）。
 *
 * 顺序照搬覆写脚本：本地回环 → Steam 进程 → 下载 CDN（直连）→ Steam 服务域名
 * → 进程直连 → 自定义规则插入点 → 广告规则集 → GEO 兜底。下载 CDN 必须早于
 * `GEOSITE,steam`，否则会被上游 GEOSITE 抢走而无法单独直连。
 */
export const BUILTIN_RULE_ORDER: string[] = [
  "cn:loopback-v4",
  "cn:loopback-v6",
  "steam:proc-steam",
  "steam:proc-steam-web",
  "steam:proc-steam-svc",
  "steam:cdn-akamaihd",
  "steam:cdn-steampipe",
  "steam:cdn-steampipe-kr",
  "steam:cdn-steampipe-partner",
  "steam:cdn-on-net",
  "steam:cdn-qtlglb-apac",
  "steam:cdn-qtlglb-eca",
  "steam:cdn-qtlglb-naeu",
  "steam:cdn-qtlglb-ru",
  "steam:cdn-webra",
  "steam:cdn-orcon",
  "steam:cdn-slingshot",
  "steam:cdn-queniuqe",
  "steam:cdn-clngaa",
  "steam:cdn-bscstorage",
  "steam:cdn-eccdnx",
  "steam:cdn-pinyuncloud",
  "steam:cdn-8686c-powered",
  "steam:cdn-8686c-static",
  "steam:cdn-queniujq",
  "steam:cdn-pphimalayanrt",
  "steam:domain-steam-chat",
  "steam:domain-steamcommunity",
  "steam:domain-steamcontent",
  "steam:domain-steamgames",
  "steam:domain-steampowered",
  "steam:domain-steamserver",
  "steam:domain-steamstatic",
  "steam:domain-steamusercontent",
  "steam:domain-valve-net",
  "steam:domain-valvesoftware",
  "steam:domain-s-team",
  "steam:geosite-steam",
  "cn:proc-leigod",
  "cn:proc-apex",
  "cn:proc-apex-eac",
  "cn:proc-apex-eac-svc",
  "ad:ad-set",
  "cn:geo-private",
  "cn:geo-onedrive",
  "cn:geo-microsoft-cn",
  "cn:geo-games-cn",
  "auto:geo-non-cn",
  "cn:geo-cn",
  "auto:geoip-telegram",
  "cn:geoip-private",
  "cn:geoip-cn",
];

/**
 * GEO 兜底段的补充规则：不在分组对象里（分组只能挂自己的规则），
 * 但同样属于内置规则，键格式与 `BUILTIN_RULE_ORDER` 一致。
 */
export const BUILTIN_EXTRA_RULES: Array<{ key: string; name: string; text: string; noResolve?: boolean }> = [
  { key: "auto:geo-non-cn", name: "非中国域名", text: "GEOSITE,geolocation-!cn" },
  { key: "auto:geoip-telegram", name: "Telegram IP", text: "GEOIP,telegram" },
];

/** 全部内置规则键（`module:<分组id>:<规则id>`），配置校验与 UI 保留名都基于它 */
export const BUILTIN_RULE_KEYS: string[] = BUILTIN_RULE_ORDER.map((key) => `module:${key}`);

/** 自定义规则/规则集插入位置：紧跟在它之前，对应脚本里的「手动域名规则」段 */
export const BUILTIN_CUSTOM_RULE_ANCHOR = "ad:ad-set";
