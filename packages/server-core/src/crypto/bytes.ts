/**
 * 字节与编码工具。
 *
 * age 报文的 base64 是「标准字母表 + 无填充」，不能用 base64url，也不能接受 `=`；
 * 只有 ASCII armor 那层才用带填充的 base64。两者都在这里，避免调用方各写一份。
 */

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let index = 0; index < a.byteLength; index += 1) {
    diff |= a[index] ^ b[index];
  }
  return diff === 0;
}

export function isAllZero(bytes: Uint8Array): boolean {
  let acc = 0;
  for (const byte of bytes) acc |= byte;
  return acc === 0;
}

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  // 只有一段 CSPRNG 调用，无需分批：调用方每次最多取 32 字节
  crypto.getRandomValues(out);
  return out;
}

export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let binary = "";
  // 分块拼字符串：一次 apply 传 10 万个参数会爆栈
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return binary;
}

/** 标准 base64（RFC 4648 §4），去掉 `=` 填充：age 报文的编码方式 */
export function toBase64NoPad(bytes: Uint8Array): string {
  return btoa(bytesToBinaryString(bytes)).replace(/=+$/, "");
}

/** 严格解码无填充 base64：拒绝 `=`、拒绝非字母表字符、拒绝非规范尾部比特 */
export function fromBase64NoPad(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*$/.test(value)) {
    throw new Error("base64 编码不合法");
  }
  if (value.length % 4 === 1) {
    throw new Error("base64 编码长度不合法");
  }
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    out[index] = binary.charCodeAt(index);
  }
  // 重新编码必须一致，否则尾部填充比特非规范（age 要求拒绝）
  if (toBase64NoPad(out) !== value) {
    throw new Error("base64 编码不是规范形式");
  }
  return out;
}

/** 带 `=` 填充的标准 base64：ASCII armor 用的那层 */
export function toBase64Padded(bytes: Uint8Array): string {
  return btoa(bytesToBinaryString(bytes));
}

export function fromBase64Padded(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    out[index] = binary.charCodeAt(index);
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function fromHex(value: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(value)) throw new Error("十六进制字符串不合法");
  const out = new Uint8Array(value.length / 2);
  for (let index = 0; index < out.byteLength; index += 1) {
    out[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}
