import { concatBytes } from "./bytes";

/**
 * HMAC-SHA-256 与 HKDF-SHA-256（RFC 2104 / RFC 5869）。
 *
 * HMAC 走 WebCrypto（原生实现，比 JS 快得多）；HKDF 的 Extract/Expand 自己拼，
 * 因为 `subtle.deriveBits` 对空 salt 的处理在各运行时并不完全一致，
 * 而 age 的 header MAC 恰恰要求 `salt = empty`。HMAC 用全零 key 等价于空 key，
 * 所以这里显式补一个 32 字节零 key，结果与 RFC 5869 的「salt 缺省全零」一致。
 */

const SHA256_BYTES = 32;

export async function hmacSha256(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, toArrayBuffer(message));
  return new Uint8Array(signature);
}

export async function hkdfSha256(
  inputKeyMaterial: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length = SHA256_BYTES
): Promise<Uint8Array> {
  const effectiveSalt = salt.byteLength > 0 ? salt : new Uint8Array(SHA256_BYTES);
  const pseudoRandomKey = await hmacSha256(effectiveSalt, inputKeyMaterial);

  const blocks: Uint8Array[] = [];
  let previous: Uint8Array = new Uint8Array(0);
  const blockCount = Math.ceil(length / SHA256_BYTES);
  for (let index = 1; index <= blockCount; index += 1) {
    previous = await hmacSha256(
      pseudoRandomKey,
      concatBytes(previous, info, new Uint8Array([index]))
    );
    blocks.push(previous);
  }
  return concatBytes(...blocks).subarray(0, length);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // 复制到独立 ArrayBuffer，避免 TS 6 下 Uint8Array<ArrayBufferLike> 与 BufferSource 的类型冲突
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
