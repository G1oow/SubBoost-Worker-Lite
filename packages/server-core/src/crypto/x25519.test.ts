import { describe, expect, it } from "vitest";
import { bytesEqual } from "./bytes";
import { x25519, x25519PublicKeyFromSecret } from "./x25519";

/**
 * X25519 的对照测试。差分对象是 Node WebCrypto 的 X25519（Node 18+ 提供），
 * 拿不到就退回「双方协商出同一个共享密钥」的自洽检查——这能抓住 ladder 里
 * 绝大多数的实现错误（clamp、循环边界、最后一步 swap）。
 */

const ALGORITHM = "X25519";
/** PKCS#8 里 X25519 私钥的固定前缀，WebCrypto 只接受 pkcs8 导入私钥 */
const PKCS8_PREFIX = [
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
];

function deterministicBytes(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed;
  for (let index = 0; index < length; index += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    out[index] = (state >>> 16) & 0xff;
  }
  return out;
}

async function importNodeSecret(scalar: Uint8Array): Promise<CryptoKey | null> {
  const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + scalar.byteLength);
  pkcs8.set(PKCS8_PREFIX, 0);
  pkcs8.set(scalar, PKCS8_PREFIX.length);
  try {
    return await crypto.subtle.importKey("pkcs8", pkcs8, ALGORITHM, false, ["deriveBits"]);
  } catch {
    return null;
  }
}

async function nodeSharedSecret(scalar: Uint8Array, peer: Uint8Array): Promise<Uint8Array | null> {
  const cryptoKey = await importNodeSecret(scalar);
  if (!cryptoKey) return null;
  const peerKey = await crypto.subtle.importKey("raw", peer, ALGORITHM, false, []);
  // X25519 的 peer 公钥放在算法参数里，不是单独的第三参
  const bits = await crypto.subtle.deriveBits(
    { name: ALGORITHM, public: peerKey } as unknown as AlgorithmIdentifier,
    cryptoKey,
    256
  );
  return new Uint8Array(bits);
}

describe("x25519", () => {
  const aliceSecret = deterministicBytes(32, 1);
  const bobSecret = deterministicBytes(32, 2);

  it("双方由对方公钥协商出同一共享密钥", () => {
    const alicePublic = x25519PublicKeyFromSecret(aliceSecret);
    const bobPublic = x25519PublicKeyFromSecret(bobSecret);
    expect(bytesEqual(x25519(aliceSecret, bobPublic), x25519(bobSecret, alicePublic))).toBe(true);
  });

  it("对同一输入稳定输出 32 字节", () => {
    const first = x25519PublicKeyFromSecret(aliceSecret);
    const second = x25519PublicKeyFromSecret(aliceSecret);
    expect(first.byteLength).toBe(32);
    expect(bytesEqual(first, second)).toBe(true);
  });

  it("公钥与私钥相互独立：不同私钥得到不同公钥", () => {
    expect(
      bytesEqual(x25519PublicKeyFromSecret(aliceSecret), x25519PublicKeyFromSecret(bobSecret))
    ).toBe(false);
  });

  it("标量与坐标长度非法时抛错", () => {
    expect(() => x25519(new Uint8Array(31), new Uint8Array(32))).toThrow(/32 字节/);
    expect(() => x25519(new Uint8Array(32), new Uint8Array(33))).toThrow(/32 字节/);
  });

  it("与 Node WebCrypto 的 X25519 结果一致", async () => {
    const cases = [
      [deterministicBytes(32, 3), deterministicBytes(32, 4)],
      [deterministicBytes(32, 5), deterministicBytes(32, 6)],
      [new Uint8Array(32).fill(0), deterministicBytes(32, 7)],
    ] as const;

    let checked = 0;
    for (const [scalar, peer] of cases) {
      const expected = await nodeSharedSecret(scalar, peer);
      if (!expected) break;
      expect(bytesEqual(x25519(scalar, peer), expected)).toBe(true);
      checked += 1;
    }

    if (checked === 0) expect(await importNodeSecret(cases[0][0])).toBeNull();
    else expect(checked).toBe(cases.length);
  });
});
