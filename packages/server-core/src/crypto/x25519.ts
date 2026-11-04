/**
 * X25519（RFC 7748 §5）。
 *
 * 用 BigInt 直接实现 Montgomery ladder，不依赖 WebCrypto 的 X25519：
 * Workers / Node / 浏览器的支持矩阵并不一致，而这里每次只做几百次 255 位模乘，
 * 速度足够（单次标量乘约 1–2 ms），换来的是到处都能跑、且能用 RFC 7748 与
 * Node WebCrypto 双向对照验证。
 */

const FIELD_PRIME = (1n << 255n) - 19n;
const A24 = 121665n;
const KEY_BYTES = 32;

/** RFC 7748 §4.1 的基点 u = 9 */
const BASE_POINT = (() => {
  const point = new Uint8Array(KEY_BYTES);
  point[0] = 9;
  return point;
})();

function decodeLittleEndian(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let index = bytes.byteLength - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[index]);
  }
  return value;
}

function encodeLittleEndian(value: bigint, length = KEY_BYTES): Uint8Array {
  const out = new Uint8Array(length);
  let rest = value;
  for (let index = 0; index < length; index += 1) {
    out[index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

function mod(value: bigint): bigint {
  const reduced = value % FIELD_PRIME;
  return reduced < 0n ? reduced + FIELD_PRIME : reduced;
}

function modPow(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let factor = mod(base);
  let power = exponent;
  while (power > 0n) {
    if (power & 1n) result = (result * factor) % FIELD_PRIME;
    factor = (factor * factor) % FIELD_PRIME;
    power >>= 1n;
  }
  return result;
}

/** 标量按 RFC 7748 §5 做 clamp；不是简单取模 */
function decodeScalar(bytes: Uint8Array): bigint {
  const clamped = bytes.slice();
  clamped[0] &= 248;
  clamped[31] &= 127;
  clamped[31] |= 64;
  return decodeLittleEndian(clamped);
}

/** u 坐标：小端解码并忽略最高位（RFC 7748 §5） */
function decodeUCoordinate(bytes: Uint8Array): bigint {
  const masked = bytes.slice();
  masked[31] &= 127;
  return decodeLittleEndian(masked) % FIELD_PRIME;
}

function swap(
  shouldSwap: bigint,
  a: bigint,
  b: bigint
): [bigint, bigint] {
  return shouldSwap === 1n ? [b, a] : [a, b];
}

/** X25519 标量乘：输入 32 字节标量与 32 字节 u 坐标，输出 32 字节 u 坐标 */
export function x25519(scalar: Uint8Array, uCoordinate: Uint8Array): Uint8Array {
  if (scalar.byteLength !== KEY_BYTES) throw new Error("X25519 标量必须是 32 字节");
  if (uCoordinate.byteLength !== KEY_BYTES) throw new Error("X25519 u 坐标必须是 32 字节");

  const k = decodeScalar(scalar);
  const x1 = decodeUCoordinate(uCoordinate);

  let x2 = 1n;
  let z2 = 0n;
  let x3 = x1;
  let z3 = 1n;
  let swapFlag = 0n;

  for (let bit = 254; bit >= 0; bit -= 1) {
    const current = (k >> BigInt(bit)) & 1n;
    swapFlag ^= current;
    [x2, x3] = swap(swapFlag, x2, x3);
    [z2, z3] = swap(swapFlag, z2, z3);
    swapFlag = current;

    const a = mod(x2 + z2);
    const aa = mod(a * a);
    const b = mod(x2 - z2);
    const bb = mod(b * b);
    const e = mod(aa - bb);
    const c = mod(x3 + z3);
    const d = mod(x3 - z3);
    const da = mod(d * a);
    const cb = mod(c * b);
    const daPlusCb = mod(da + cb);
    const daMinusCb = mod(da - cb);
    x3 = mod(daPlusCb * daPlusCb);
    z3 = mod(x1 * mod(daMinusCb * daMinusCb));
    x2 = mod(aa * bb);
    z2 = mod(e * mod(aa + A24 * e));
  }

  [x2, x3] = swap(swapFlag, x2, x3);
  [z2, z3] = swap(swapFlag, z2, z3);

  // z2 为 0 时 modPow 返回 0，结果自然是全零输出，与 RFC 7748 的要求一致
  return encodeLittleEndian(mod(x2 * modPow(z2, FIELD_PRIME - 2n)));
}

/** 由 32 字节私钥导出公钥（age recipient） */
export function x25519PublicKeyFromSecret(secret: Uint8Array): Uint8Array {
  return x25519(secret, BASE_POINT);
}
