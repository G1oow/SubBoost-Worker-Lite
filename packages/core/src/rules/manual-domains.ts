/**
 * 手动域名规则（对应覆写脚本里的 directDomains / proxyDomains / rejectDomains）
 *
 * 三份清单各自绑定一个内置分组：
 * - direct → 国内直连
 * - proxy  → 自动选择
 * - reject → 广告拦截
 *
 * 与脚本一致：先归一化成裸域名，再按「更具体的域名在前」排序，同一 (类型, 域名) 只保留
 * 最后出现的一条（拦截 > 代理 > 直连）。归一化不了的条目直接丢弃，不留「永不命中」的死规则。
 */

export type ManualDomainGroup = "direct" | "proxy" | "reject";

export interface ManualDomains {
  direct: string[];
  proxy: string[];
  reject: string[];
}

export const EMPTY_MANUAL_DOMAINS: ManualDomains = { direct: [], proxy: [], reject: [] };

const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const HOSTNAME_PATTERN = /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/;

/**
 * 去掉通配前缀与结尾点：`*.example.com.` → `example.com`。
 *
 * 用下标扫描而不是 `^\.+` / `\.+$`：输入是用户粘贴的任意文本，长串 `.` 会让这类
 * 正则走多项式回溯（CodeQL js/polynomial-redos）。
 */
function stripWildcardEdges(input: string): string {
  let start = 0;
  while (start < input.length && (input[start] === "*" || input[start] === ".")) start += 1;
  let end = input.length;
  while (end > start && input[end - 1] === ".") end -= 1;
  return input.slice(start, end);
}

/**
 * 归一化手写域名：去掉通配前缀、协议头、userinfo、路径、端口、结尾点。
 *
 * 归一化失败返回 null —— 例如 `a.*.com` 用域名规则表达不出来，与其生成一条永远匹配不到的
 * 规则，不如直接丢弃（脚本里的 normalizeDomain 同样处理）。
 */
export function normalizeManualDomain(value: unknown): string | null {
  let host = String(value ?? "").trim().toLowerCase();
  if (!host) return null;
  // 协议头（https:// 等）
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//u, "");
  // userinfo（user:pass@）：取最后一个 @ 之后的部分，避免回溯型 `^.*@`
  const at = host.lastIndexOf("@");
  if (at >= 0) host = host.slice(at + 1);
  // 路径 / 查询 / 片段
  host = host.split(/[/?#]/u)[0];
  // 端口
  host = host.replace(/:\d+$/u, "");
  // 通配前缀 "*.example.com" 与 ".example.com" 都按 DOMAIN-SUFFIX,example.com 处理；根域尾点一并去掉
  host = stripWildcardEdges(host);
  if (!host) return null;
  return HOSTNAME_PATTERN.test(host) ? host : null;
}

/** 一条清单里能归一化出来的全部域名（保持出现顺序、去重） */
export function normalizeManualDomainList(list: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(list) ? list : []) {
    const host = normalizeManualDomain(item);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}

export interface ManualDomainRuleTexts {
  /** 按脚本顺序排好的完整 Clash 规则文本 */
  texts: string[];
  /** 被丢弃的原始值（无法归一化），供界面提示 */
  dropped: string[];
}

/**
 * 三份清单 → Clash 规则文本。
 *
 * `targets` 传三个内置分组的最终名称（会被改名/emoji 影响），清单自己的归属决定用哪个。
 */
export function buildManualDomainRuleTexts(
  domains: ManualDomains,
  targets: Record<ManualDomainGroup, string>
): ManualDomainRuleTexts {
  const groups: Array<{ group: ManualDomainGroup; entries: string[] }> = [
    { group: "direct", entries: domains.direct },
    { group: "proxy", entries: domains.proxy },
    { group: "reject", entries: domains.reject },
  ];
  const dropped: string[] = [];
  const collected: Array<{ rule: string; type: string; host: string }> = [];

  for (const { group, entries } of groups) {
    const target = String(targets[group] ?? "").trim();
    if (!target) continue;
    for (const raw of entries) {
      const host = normalizeManualDomain(raw);
      if (!host) {
        if (String(raw ?? "").trim()) dropped.push(String(raw).trim());
        continue;
      }
      // IP 简写按单地址 CIDR 处理，避免生成 DOMAIN-SUFFIX,x.x.x.x
      const rule = IPV4_PATTERN.test(host)
        ? `IP-CIDR,${host}/32,${target},no-resolve`
        : `DOMAIN-SUFFIX,${host},${target}`;
      collected.push({ rule, type: IPV4_PATTERN.test(host) ? "IP-CIDR" : "DOMAIN-SUFFIX", host });
    }
  }

  // 去重：同一 (类型, 域名) 只保留最后一条，即 拦截 > 代理 > 直连
  const unique = new Map<string, { rule: string; index: number }>();
  collected.forEach((item, index) => {
    unique.set(`${item.type},${item.host}`, { rule: item.rule, index });
  });

  const specificity = (rule: string) => {
    const [type, value = ""] = rule.split(",");
    if (type === "IP-CIDR") return 3000;
    // 标签越多越具体：a.b.example.com 排在 example.com 之前
    return 1000 - value.split(".").length;
  };

  const texts = [...unique.values()]
    .sort((a, b) => specificity(a.rule) - specificity(b.rule) || a.index - b.index)
    .map((item) => item.rule);

  return { texts, dropped };
}

/** 手动进程规则：写进程名即可；含逗号的完整规则原样透传（与脚本 toProcessRule 一致） */
export function normalizeManualProcessList(list: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(list) ? list : []) {
    const name = String(item ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function buildManualProcessRuleTexts(list: unknown, target = "DIRECT"): string[] {
  return normalizeManualProcessList(list).map((name) =>
    name.includes(",") ? name : `PROCESS-NAME,${name},${target}`
  );
}
