import { isAgeRecipient, MAX_AGE_RECIPIENTS } from "@subboost/server-core/crypto/age";

/**
 * 订阅的 age 加密通道配置。
 *
 * 公钥只从环境变量读，不进 KV：因此不需要任何数据迁移，也不会把用户的公钥
 * 写进仓库或导出到 /api/state 以外的地方。配置非法时 fail closed——
 * 宁可让加密通道报 503，也不发出一份没人能解开的密文。
 */

const RECIPIENT_SEPARATORS = /[\s,]+/;
const TRUTHY = new Set(["1", "true", "yes", "on"]);

export type AgeResolution =
  | { status: "disabled"; only: boolean }
  | { status: "invalid"; invalid: string[]; only: boolean }
  | { status: "ok"; recipients: string[]; only: boolean };

export type AgeCapabilities = {
  /** 加密通道可用（至少一把合法公钥） */
  enabled: boolean;
  /** 只输出密文：明文入口与一键导入都会被拒绝 */
  only: boolean;
  recipients: string[];
  /** 配了公钥但全部非法 */
  misconfigured: boolean;
};

/** `AGE_ONLY` 的真值：1/true/yes/on，忽略大小写与空白 */
export function parseAgeOnly(raw: string | undefined): boolean {
  return TRUTHY.has((raw ?? "").trim().toLowerCase());
}

/** 拆分并校验 `AGE_RECIPIENT`：逗号、空格、换行都可以作分隔符 */
export function parseAgeRecipients(raw: string | undefined): { valid: string[]; invalid: string[] } {
  const candidates = (raw ?? "")
    .split(RECIPIENT_SEPARATORS)
    .map((item) => item.trim())
    .filter(Boolean);

  const valid: string[] = [];
  const invalid: string[] = [];
  for (const candidate of candidates) {
    if (!isAgeRecipient(candidate)) {
      invalid.push(candidate);
      continue;
    }
    if (!valid.includes(candidate)) valid.push(candidate);
  }

  // 超过上限的部分按非法处理：加密要逐把做 X25519，不能无限累加 CPU 成本
  if (valid.length > MAX_AGE_RECIPIENTS) {
    invalid.push(...valid.slice(MAX_AGE_RECIPIENTS));
    valid.length = MAX_AGE_RECIPIENTS;
  }

  return { valid, invalid };
}

export function resolveAgeConfig(env: Env): AgeResolution {
  const only = parseAgeOnly(env.AGE_ONLY);
  const { valid, invalid } = parseAgeRecipients(env.AGE_RECIPIENT);
  if (valid.length === 0) {
    return invalid.length > 0 ? { status: "invalid", invalid, only } : { status: "disabled", only };
  }
  // 只要有一把是错的就整体判非法：避免用户以为加密生效、实际用的是另一把
  if (invalid.length > 0) return { status: "invalid", invalid, only };
  return { status: "ok", recipients: valid, only };
}

/** 下发给管理端的只读描述（公钥本身不是秘密） */
export function ageCapabilities(resolution: AgeResolution): AgeCapabilities {
  switch (resolution.status) {
    case "ok":
      return {
        enabled: true,
        only: resolution.only,
        recipients: resolution.recipients,
        misconfigured: false,
      };
    case "invalid":
      return { enabled: false, only: resolution.only, recipients: [], misconfigured: true };
    case "disabled":
      return { enabled: false, only: false, recipients: [], misconfigured: false };
  }
}
