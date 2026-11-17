import {
  IMPORT_TARGETS,
  buildImportDeepLink,
  type ImportTargetId,
} from "@subboost/server-core/subscription/import-targets";

/**
 * 分享弹窗里的链接拼接：age 加密链接只是在订阅链接后面加参数，一键导入按钮则直接给出
 * 客户端深链（见下）。统一放在这里，避免各处手拼 `?` / `&` 出错。
 */

/** 追加查询参数，保留原有的查询串与 fragment */
export function appendQueryParam(link: string, key: string, value: string): string {
  const hashIndex = link.indexOf("#");
  const base = hashIndex >= 0 ? link.slice(0, hashIndex) : link;
  const hash = hashIndex >= 0 ? link.slice(hashIndex) : "";
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}${hash}`;
}

export type ImportLink = {
  id: ImportTargetId;
  label: string;
  href: string;
};

/**
 * 每个客户端一条深链：页面上直接放客户端 scheme。
 *
 * 为什么不走服务端 `?target=` 的 302：跨 scheme 的服务端重定向会被浏览器静默拦掉
 * （Chromium 明确要求 user gesture，移动端 Safari 常不跟随），而页面里真实的
 * `<a href="clash://…">` 点击本身就是用户手势，各浏览器都放行，也不需要中间页。
 */
export function buildImportLinks(link: string, name: string): ImportLink[] {
  return IMPORT_TARGETS.map((target) => ({
    id: target.id,
    label: target.label,
    href: buildImportDeepLink(target.id, { url: link, name }),
  }));
}

/** age 密文链接：二进制与 armor 两种形态 */
export function buildAgeLinks(link: string): { binary: string; armor: string } {
  return {
    binary: appendQueryParam(link, "format", "age"),
    armor: appendQueryParam(link, "format", "age-armor"),
  };
}
