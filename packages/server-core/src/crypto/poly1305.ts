/**
 * Poly1305 一次性认证器（RFC 8439 §2.5）。
 *
 * 用 BigInt 描述模 2^130-5 的运算：单块只有几次 130 位乘法，
 * 即使 64 KiB 数据（4096 块）也在毫秒级，比手写 26 位分段实现更不容易写错。
 */

const P = (1n << 130n) - 5n;
const R_MASK = 0x0ffffffc0ffffffc0ffffffc0fffffffn;
const TAG_BYTES = 16;

function readLittleEndian(bytes: Uint8Array, start: number, end: number): bigint {
  let value = 0n;
  for (let index = end - 1; index >= start; index -= 1) {
    value = (value << 8n) | BigInt(bytes[index]);
  }
  return value;
}

function writeLittleEndian(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let rest = value;
  for (let index = 0; index < length; index += 1) {
    out[index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

/** 计算 16 字节 tag。`key` 是 32 字节一次性密钥（r || s） */
export function poly1305(key: Uint8Array, message: Uint8Array): Uint8Array {
  if (key.byteLength !== 32) throw new Error("Poly1305 密钥必须是 32 字节");

  const r = readLittleEndian(key, 0, 16) & R_MASK;
  const s = readLittleEndian(key, 16, 32);

  let accumulator = 0n;
  for (let offset = 0; offset < message.byteLength; offset += 16) {
    const end = Math.min(offset + 16, message.byteLength);
    // 每个 16 字节块末尾补一个 1 比特（即加上 2^(8*块长)）
    const block = readLittleEndian(message, offset, end) | (1n << BigInt((end - offset) * 8));
    accumulator = ((accumulator + block) * r) % P;
  }

  return writeLittleEndian((accumulator + s) & ((1n << 128n) - 1n), TAG_BYTES);
}
