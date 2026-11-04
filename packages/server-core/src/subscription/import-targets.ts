/**
 * 「一键拉起客户端导入」的深链表。
 *
 * 各客户端公开使用的自定义 scheme 并不统一，这里只放经过实际使用的形态：
 * 服务端拿到 `/sub/<token>?target=clash` 之后 302 到对应深链，剩下的交给 App。
 */

export type ImportTargetId = "clash" | "stash" | "shadowrocket" | "singbox" | "v2rayng" | "hiddify";

export type ImportTarget = {
  id: ImportTargetId;
  /** 管理端展示用的客户端名称 */
  label: string;
};

export const IMPORT_TARGETS: readonly ImportTarget[] = [
  { id: "clash", label: "Clash / Mihomo" },
  { id: "stash", label: "Stash" },
  { id: "shadowrocket", label: "Shadowrocket" },
  { id: "singbox", label: "sing-box" },
  { id: "v2rayng", label: "v2rayNG" },
  { id: "hiddify", label: "Hiddify" },
];

const IMPORT_TARGET_IDS = new Set<string>(IMPORT_TARGETS.map((target) => target.id));
const MAX_NAME_LENGTH = 80;

/** 未知或缺失的 target 返回 null，调用方按普通订阅请求处理 */
export function parseImportTarget(value: string | null | undefined): ImportTargetId | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return IMPORT_TARGET_IDS.has(normalized) ? (normalized as ImportTargetId) : null;
}

/** 订阅名来自用户输入：先剥掉 CR/LF（防 Location 头注入），再交给 encodeURIComponent */
function sanitizeName(name: string): string {
  return name.replace(/[\r\n]+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export type ImportDeepLinkOptions = {
  /** 订阅的明文地址（短链或原链接皆可） */
  url: string;
  /** 订阅名，用于客户端里的备注 */
  name: string;
};

/** 生成对应客户端的导入深链 */
export function buildImportDeepLink(target: ImportTargetId, options: ImportDeepLinkOptions): string {
  const url = encodeURIComponent(options.url);
  const name = encodeURIComponent(sanitizeName(options.name));

  switch (target) {
    case "clash":
      return `clash://install-config?url=${url}`;
    case "stash":
      return `stash://install-config?url=${url}`;
    case "shadowrocket":
      // Shadowrocket 的 sub:// 后面接 base64url 编码的订阅地址
      return `shadowrocket://add/sub://${toBase64Url(options.url)}?remark=${name}`;
    case "singbox":
      return `sing-box://import-remote-profile?url=${url}#${name}`;
    case "v2rayng":
      return `v2rayng://install-sub?url=${url}&name=${name}`;
    case "hiddify":
      return `hiddify://import/${url}`;
  }
}
