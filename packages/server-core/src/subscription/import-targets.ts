/**
 * 「一键拉起客户端导入」的深链表。
 *
 * 各客户端公开使用的自定义 scheme 并不统一，这里只放经过实际使用的形态：
 * 管理端页面直接把这里的深链放进 `<a href>`（点击本身就是用户手势）；服务端的
 * `/sub/<token>?target=…` 也会 302 到同一份深链，供分享出去的链接使用。
 *
 * 编码约定（踩过的坑，改之前先读）：
 * - 需要带 URL 的客户端一律 `encodeURIComponent`；订阅名走 fragment（`#name`）时同样编码，
 *   因为 Android / iOS 读取 fragment 时都会先解码。
 * - Shadowrocket 的 `sub://` 后面必须是**标准 base64**（保留 `+` `/` `=`）：它按标准 base64
 *   解析该路径段，遇到 URL-safe 的 `-` `_` 会直接拒绝，表现为「App 被拉起但什么都没导入」。
 * - v2rayNG 的 `install-sub` 只读 `url` 参数，名称取 fragment，额外传 `name=` 会被忽略。
 */

export type ImportTargetId =
  | "clash"
  | "mihomo"
  | "stash"
  | "shadowrocket"
  | "singbox"
  | "v2rayng"
  | "hiddify";

export type ImportTarget = {
  id: ImportTargetId;
  /** 管理端展示用的客户端名称 */
  label: string;
};

export const IMPORT_TARGETS: readonly ImportTarget[] = [
  { id: "clash", label: "Clash / Mihomo" },
  { id: "mihomo", label: "Mihomo Party" },
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

/** 标准 base64（保留 `+` `/` 与 `=` 填充），不要换成 URL-safe 变体 */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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
    case "mihomo":
      // Clash Party（原 Mihomo Party）文档里的 name 参数是可选的
      return `mihomo://install-config?url=${url}&name=${name}`;
    case "stash":
      return `stash://install-config?url=${url}`;
    case "shadowrocket":
      // Shadowrocket 的 sub:// 后面接标准 base64 编码的订阅地址，备注走 remark
      return `shadowrocket://add/sub://${toBase64(options.url)}?remark=${name}`;
    case "singbox":
      return `sing-box://import-remote-profile?url=${url}#${name}`;
    case "v2rayng":
      // install-sub 只认 url，订阅名只能靠 fragment 传
      return `v2rayng://install-sub?url=${url}#${name}`;
    case "hiddify":
      return `hiddify://import/${url}#${name}`;
  }
}
