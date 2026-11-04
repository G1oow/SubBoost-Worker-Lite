import { bytesEqual, concatBytes } from "./bytes";
import { chacha20Block, chacha20Xor } from "./chacha20";
import { poly1305 } from "./poly1305";

/**
 * ChaCha20-Poly1305 AEAD（RFC 8439 §2.8）。
 *
 * 顺序固定：块计数器 0 的密钥流前 32 字节是 Poly1305 的一次性密钥，
 * 正文从计数器 1 开始加密。
 */

export const AEAD_TAG_BYTES = 16;
const EMPTY = new Uint8Array(0);

function padLength(length: number): number {
  return length + ((16 - (length % 16)) % 16);
}

function writeUint64LE(out: Uint8Array, offset: number, value: number): void {
  let rest = value;
  for (let index = 0; index < 8; index += 1) {
    out[offset + index] = rest & 0xff;
    rest = Math.floor(rest / 256);
  }
}

function buildMacData(aad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  // aad || pad16(aad) || ciphertext || pad16(ciphertext) || LE64(len aad) || LE64(len ciphertext)
  const out = new Uint8Array(
    padLength(aad.byteLength) + padLength(ciphertext.byteLength) + 16
  );
  out.set(aad, 0);
  out.set(ciphertext, padLength(aad.byteLength));
  writeUint64LE(out, out.byteLength - 16, aad.byteLength);
  writeUint64LE(out, out.byteLength - 8, ciphertext.byteLength);
  return out;
}

/** 加密并附加 16 字节 tag；返回 `ciphertext || tag` */
export function seal(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array = EMPTY
): Uint8Array {
  if (key.byteLength !== 32) throw new Error("ChaCha20-Poly1305 密钥必须是 32 字节");
  if (nonce.byteLength !== 12) throw new Error("ChaCha20-Poly1305 nonce 必须是 12 字节");

  const polyKey = chacha20Block(key, 0, nonce).subarray(0, 32);
  const ciphertext = chacha20Xor(key, nonce, plaintext, 1);
  const tag = poly1305(polyKey, buildMacData(aad, ciphertext));
  return concatBytes(ciphertext, tag);
}

/**
 * 校验 tag 并解密。认证失败返回 `null`（不抛异常，方便上层把「打不开」当成正常分支处理）。
 * 注意：先比对 tag 再解密，避免把未认证的明文交出去。
 */
export function open(
  key: Uint8Array,
  nonce: Uint8Array,
  sealed: Uint8Array,
  aad: Uint8Array = EMPTY
): Uint8Array | null {
  if (key.byteLength !== 32) throw new Error("ChaCha20-Poly1305 密钥必须是 32 字节");
  if (nonce.byteLength !== 12) throw new Error("ChaCha20-Poly1305 nonce 必须是 12 字节");
  if (sealed.byteLength < AEAD_TAG_BYTES) return null;

  const ciphertext = sealed.subarray(0, sealed.byteLength - AEAD_TAG_BYTES);
  const tag = sealed.subarray(sealed.byteLength - AEAD_TAG_BYTES);
  const polyKey = chacha20Block(key, 0, nonce).subarray(0, 32);
  if (!bytesEqual(poly1305(polyKey, buildMacData(aad, ciphertext)), tag)) return null;
  return chacha20Xor(key, nonce, ciphertext, 1);
}
