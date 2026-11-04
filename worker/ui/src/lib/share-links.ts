import { IMPORT_TARGETS, type ImportTargetId } from "@subboost/server-core/subscription/import-targets";

/**
 * 分享弹窗里的链接拼接：一键导入按钮与 age 加密链接都只是在订阅链接后面加参数，
 * 所以统一放在这里，避免各处手拼 `?` / `&` 出错。
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

/** 每个客户端一条深链：服务端收到 `?target=<id>` 后 302 到对应 scheme */
export function buildImportLinks(link: string): ImportLink[] {
  return IMPORT_TARGETS.map((target) => ({
    id: target.id,
    label: target.label,
    href: appendQueryParam(link, "target", target.id),
  }));
}

/** age 密文链接：二进制与 armor 两种形态 */
export function buildAgeLinks(link: string): { binary: string; armor: string } {
  return {
    binary: appendQueryParam(link, "format", "age"),
    armor: appendQueryParam(link, "format", "age-armor"),
  };
}
