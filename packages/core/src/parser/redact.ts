/**
 * 解析失败信息里的凭据遮蔽。
 *
 * 解析错误会带上原始片段的前若干字符，用来帮用户定位是哪一行出了问题；
 * 但片段里常常包含密码、UUID、Token 等凭据，而这些错误会存进快照、
 * 经 /api/state 返回并展示在管理端。所以拼进错误文本前必须先遮蔽。
 */

/** 配置行里带这些关键字的键视为凭据载体（大小写不敏感，允许前后缀，如 obfs-password） */
const CREDENTIAL_KEYWORDS = [
  "password",
  "passwd",
  "pwd",
  "psk",
  "auth",
  "uuid",
  "token",
  "secret",
  "private-key",
  "private_key",
  "username",
] as const;

const CREDENTIAL_KEY_PATTERN = CREDENTIAL_KEYWORDS.join("|");

/** scheme://<userinfo>@ → scheme://***@ */
const URL_USERINFO_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^@/?#]*@/;

/** password=xxx / obfs-password=xxx / uuid=xxx → key=***，值截到 , 或 ; 或空白为止 */
const KEY_VALUE_PATTERN = new RegExp(
  `([A-Za-z0-9_-]*(?:${CREDENTIAL_KEY_PATTERN})[A-Za-z0-9_-]*)\\s*=\\s*[^,;\\s]+`,
  "gi"
);

export function redactSegmentCredentials(segment: string): string {
  if (!segment) return segment;
  const withoutUserinfo = segment.replace(URL_USERINFO_PATTERN, "$1***@");
  return withoutUserinfo.replace(KEY_VALUE_PATTERN, "$1=***");
}
