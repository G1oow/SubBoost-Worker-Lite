/**
 * ChaCha20 流密码（RFC 8439 §2.3 / §2.4）。
 *
 * Workers 的 WebCrypto 不提供 ChaCha20-Poly1305，而 age 报文必须用它，
 * 所以这里按 RFC 自己实现：全部走 32 位整数运算，避免 BigInt 在长数据上拖慢速度。
 */

const SIGMA = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);
export const CHACHA20_BLOCK_BYTES = 64;

function rotl(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function quarterRound(state: Uint32Array, a: number, b: number, c: number, d: number): void {
  state[a] = (state[a] + state[b]) >>> 0;
  state[d] = rotl(state[d] ^ state[a], 16);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] = rotl(state[b] ^ state[c], 12);
  state[a] = (state[a] + state[b]) >>> 0;
  state[d] = rotl(state[d] ^ state[a], 8);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] = rotl(state[b] ^ state[c], 7);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

/** 生成一块 64 字节密钥流（RFC 8439 §2.3 的 block function） */
export function chacha20Block(key: Uint8Array, counter: number, nonce: Uint8Array): Uint8Array {
  if (key.byteLength !== 32) throw new Error("ChaCha20 密钥必须是 32 字节");
  if (nonce.byteLength !== 12) throw new Error("ChaCha20 nonce 必须是 12 字节");

  const state = new Uint32Array(16);
  state.set(SIGMA, 0);
  for (let index = 0; index < 8; index += 1) {
    state[4 + index] = readUint32LE(key, index * 4);
  }
  state[12] = counter >>> 0;
  state[13] = readUint32LE(nonce, 0);
  state[14] = readUint32LE(nonce, 4);
  state[15] = readUint32LE(nonce, 8);

  // 20 轮 = 10 次「列 + 对角」
  const working = state.slice();
  for (let round = 0; round < 10; round += 1) {
    quarterRound(working, 0, 4, 8, 12);
    quarterRound(working, 1, 5, 9, 13);
    quarterRound(working, 2, 6, 10, 14);
    quarterRound(working, 3, 7, 11, 15);
    quarterRound(working, 0, 5, 10, 15);
    quarterRound(working, 1, 6, 11, 12);
    quarterRound(working, 2, 7, 8, 13);
    quarterRound(working, 3, 4, 9, 14);
  }

  const out = new Uint8Array(CHACHA20_BLOCK_BYTES);
  for (let index = 0; index < 16; index += 1) {
    writeUint32LE(out, index * 4, (working[index] + state[index]) >>> 0);
  }
  return out;
}

/**
 * ChaCha20 加解密（同一操作）。`data` 长度任意，密钥流按块连续生成，
 * 起始块计数由 `initialCounter` 给定（AEAD 里正文从 1 开始，块 0 用来派生 Poly1305 密钥）。
 */
export function chacha20Xor(
  key: Uint8Array,
  nonce: Uint8Array,
  data: Uint8Array,
  initialCounter = 1
): Uint8Array {
  const out = new Uint8Array(data.byteLength);
  let counter = initialCounter;
  for (let offset = 0; offset < data.byteLength; offset += CHACHA20_BLOCK_BYTES) {
    const block = chacha20Block(key, counter, nonce);
    counter += 1;
    const limit = Math.min(CHACHA20_BLOCK_BYTES, data.byteLength - offset);
    for (let index = 0; index < limit; index += 1) {
      out[offset + index] = data[offset + index] ^ block[index];
    }
  }
  return out;
}
