/**
 * Bech32（BIP173）编解码，age 的 `age1…` recipient 与 `AGE-SECRET-KEY-1…` identity 都用它。
 *
 * 与 BIP173 的两点差异，按 age 规范处理：
 * 1. data 部分不限制长度（age 的 PQ recipient 有几百字节）；
 * 2. 只接受 bech32 常量 1，不接受 bech32m——否则会把 bech32m 串误判成 age 公钥。
 */

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const BECH32_CONST = 1;
const CHECKSUM_VALUES = 6;
/** 纯属防御：age 现有 recipient 最长约 2 KB，超过就没必要再算 */
const MAX_LENGTH = 4096;

export class Bech32Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Bech32Error";
  }
}

function polymod(values: number[]): number {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = (((checksum & 0x1ffffff) << 5) ^ value) >>> 0;
    for (let index = 0; index < 5; index += 1) {
      if (((top >>> index) & 1) === 1) checksum = (checksum ^ GENERATOR[index]) >>> 0;
    }
  }
  return checksum >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const codes: number[] = [];
  for (const char of hrp) codes.push(char.charCodeAt(0));
  const expanded: number[] = [];
  for (const code of codes) expanded.push(code >> 5);
  expanded.push(0);
  for (const code of codes) expanded.push(code & 31);
  return expanded;
}

function createChecksum(hrp: string, data: number[]): number[] {
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const remainder = (polymod(values) ^ BECH32_CONST) >>> 0;
  const checksum: number[] = [];
  for (let index = 0; index < CHECKSUM_VALUES; index += 1) {
    checksum.push((remainder >>> (5 * (CHECKSUM_VALUES - 1 - index))) & 31);
  }
  return checksum;
}

function convertBits(
  data: Uint8Array | number[],
  fromBits: number,
  toBits: number,
  pad: boolean
): number[] {
  let accumulator = 0;
  let bits = 0;
  const out: number[] = [];
  const maxValue = (1 << toBits) - 1;

  for (const value of data) {
    if (value < 0 || value >>> fromBits !== 0) throw new Bech32Error("数据超出位宽范围");
    accumulator = (accumulator << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      out.push((accumulator >>> bits) & maxValue);
    }
  }

  if (pad) {
    if (bits > 0) out.push((accumulator << (toBits - bits)) & maxValue);
  } else if (bits >= fromBits || ((accumulator << (toBits - bits)) & maxValue) !== 0) {
    // 尾部残余比特非零说明不是规范编码
    throw new Bech32Error("填充不合法");
  }
  return out;
}

function normalizeCase(value: string): string {
  const hasLower = /[a-z]/.test(value);
  const hasUpper = /[A-Z]/.test(value);
  if (hasLower && hasUpper) throw new Bech32Error("不能大小写混用");
  return value.toLowerCase();
}

/** 把 8 位字节编码成 bech32 串（hrp 必须是小写） */
export function bech32Encode(hrp: string, payload: Uint8Array): string {
  if (!hrp || hrp !== hrp.toLowerCase()) throw new Bech32Error("hrp 必须是小写非空字符串");
  const data = convertBits(payload, 8, 5, true);
  const combined = [...data, ...createChecksum(hrp, data)];
  let out = `${hrp}1`;
  for (const value of combined) out += CHARSET[value];
  return out;
}

/** 解码 bech32 串，返回 hrp 与还原后的字节；校验和、大小写、填充全部严格校验 */
export function bech32Decode(value: string): { hrp: string; payload: Uint8Array } {
  if (typeof value !== "string") throw new Bech32Error("bech32 值必须是字符串");
  const trimmed = value.trim();
  if (!trimmed) throw new Bech32Error("bech32 值为空");
  if (trimmed.length > MAX_LENGTH) throw new Bech32Error("bech32 值过长");

  for (const char of trimmed) {
    const code = char.charCodeAt(0);
    if (code < 33 || code > 126) throw new Bech32Error("bech32 含不可打印字符");
  }

  const normalized = normalizeCase(trimmed);
  const separator = normalized.lastIndexOf("1");
  if (separator < 1) throw new Bech32Error("缺少分隔符或 hrp 为空");
  if (normalized.length - separator - 1 < CHECKSUM_VALUES) throw new Bech32Error("数据过短");

  const hrp = normalized.slice(0, separator);
  const data: number[] = [];
  for (const char of normalized.slice(separator + 1)) {
    const index = CHARSET.indexOf(char);
    if (index < 0) throw new Bech32Error("含非 bech32 字符");
    data.push(index);
  }

  const polymodResult = polymod([...hrpExpand(hrp), ...data]);
  if (polymodResult !== BECH32_CONST) throw new Bech32Error("校验和错误");

  return {
    hrp,
    payload: new Uint8Array(convertBits(data.slice(0, data.length - CHECKSUM_VALUES), 5, 8, false)),
  };
}

const AGE_RECIPIENT_HRP = "age";
const AGE_SECRET_KEY_HRP = "age-secret-key-";
const AGE_KEY_BYTES = 32;

/** 把 32 字节 X25519 公钥编码成 `age1…` */
export function encodeAgeRecipient(publicKey: Uint8Array): string {
  if (publicKey.byteLength !== AGE_KEY_BYTES) throw new Bech32Error("age 公钥必须是 32 字节");
  return bech32Encode(AGE_RECIPIENT_HRP, publicKey);
}

/** 解析 `age1…`，返回 32 字节 X25519 公钥 */
export function decodeAgeRecipient(recipient: string): Uint8Array {
  // age 自己的前缀检查区分大小写：只认小写的 `age1`
  if (recipient.trim() !== recipient.trim().toLowerCase()) {
    throw new Bech32Error("age 公钥必须全小写");
  }
  const { hrp, payload } = bech32Decode(recipient);
  if (hrp !== AGE_RECIPIENT_HRP) throw new Bech32Error("不是 age 公钥（hrp 必须是 age）");
  if (payload.byteLength !== AGE_KEY_BYTES) throw new Bech32Error("age 公钥长度必须是 32 字节");
  return payload;
}

/** 解析 `AGE-SECRET-KEY-1…`，返回 32 字节私钥（仅测试与本地解密用） */
export function decodeAgeSecretKey(secretKey: string): Uint8Array {
  // age 只认大写的 `AGE-SECRET-KEY-1` 前缀
  if (secretKey.trim() !== secretKey.trim().toUpperCase()) {
    throw new Bech32Error("age 私钥必须全大写");
  }
  const { hrp, payload } = bech32Decode(secretKey);
  if (hrp !== AGE_SECRET_KEY_HRP) {
    throw new Bech32Error("不是 age 私钥（hrp 必须是 AGE-SECRET-KEY-）");
  }
  if (payload.byteLength !== AGE_KEY_BYTES) throw new Bech32Error("age 私钥长度必须是 32 字节");
  return payload;
}
