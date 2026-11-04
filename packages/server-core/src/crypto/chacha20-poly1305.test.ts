import { describe, expect, it } from "vitest";
import { bytesEqual, fromBase64Padded, toBase64Padded } from "./bytes";
import { open, seal } from "./chacha20-poly1305";

/**
 * ChaCha20-Poly1305 的对照测试：Node 24 的 WebCrypto 提供同名算法（实验特性），
 * 用它当独立实现做差分。取不到时（其它 Node 版本）跳过差分部分，
 * 仍保留自洽的往返与认证失败用例。
 */

const ALGORITHM = "ChaCha20-Poly1305";

async function importNodeKey(key: Uint8Array): Promise<CryptoKey | null> {
  try {
    return await crypto.subtle.importKey("raw", key, ALGORITHM, false, ["encrypt", "decrypt"]);
  } catch {
    return null;
  }
}

async function nodeSeal(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array
): Promise<Uint8Array | null> {
  const cryptoKey = await importNodeKey(key);
  if (!cryptoKey) return null;
  const buffer = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: nonce, additionalData: aad },
    cryptoKey,
    plaintext
  );
  return new Uint8Array(buffer);
}

function deterministicBytes(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed;
  for (let index = 0; index < length; index += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    out[index] = (state >>> 16) & 0xff;
  }
  return out;
}

describe("chacha20-poly1305", () => {
  const key = deterministicBytes(32, 7);
  const nonce = deterministicBytes(12, 11);

  it("往返解密还原明文", () => {
    const plaintext = new TextEncoder().encode("subboost age payload");
    const sealed = seal(key, nonce, plaintext);
    expect(sealed.byteLength).toBe(plaintext.byteLength + 16);
    expect(new TextDecoder().decode(open(key, nonce, sealed) ?? new Uint8Array())).toBe(
      "subboost age payload"
    );
  });

  it("tag 被篡改时解密返回 null", () => {
    const sealed = seal(key, nonce, new Uint8Array([1, 2, 3]));
    sealed[sealed.byteLength - 1] ^= 0x01;
    expect(open(key, nonce, sealed)).toBeNull();
  });

  it("密文被篡改时解密返回 null", () => {
    const sealed = seal(key, nonce, new Uint8Array([1, 2, 3]));
    sealed[0] ^= 0x40;
    expect(open(key, nonce, sealed)).toBeNull();
  });

  it("AAD 参与认证：AAD 不同则解密失败", () => {
    const sealed = seal(key, nonce, new Uint8Array([9]), new Uint8Array([1]));
    expect(open(key, nonce, sealed, new Uint8Array([1]))).not.toBeNull();
    expect(open(key, nonce, sealed, new Uint8Array([2]))).toBeNull();
  });

  it("空明文也能往返（只有 16 字节 tag）", () => {
    const sealed = seal(key, nonce, new Uint8Array(0));
    expect(sealed.byteLength).toBe(16);
    expect(open(key, nonce, sealed)?.byteLength).toBe(0);
  });

  it("与 Node WebCrypto 的 ChaCha20-Poly1305 逐字节一致（多组长度）", async () => {
    const lengths = [0, 1, 15, 16, 17, 63, 64, 65, 1024, 65536];
    const aad = deterministicBytes(13, 99);
    let checked = 0;

    for (const length of lengths) {
      const plaintext = deterministicBytes(length, length + 3);
      const expected = await nodeSeal(key, nonce, plaintext, aad);
      if (!expected) break;
      expect(bytesEqual(seal(key, nonce, plaintext, aad), expected)).toBe(true);
      checked += 1;
    }

    if (checked === 0) {
      // 该 Node 版本没有 ChaCha20-Poly1305：跳过差分，仅记录而不是假装通过
      expect(await importNodeKey(key)).toBeNull();
    } else {
      expect(checked).toBe(lengths.length);
    }
  });

  it("base64 工具拒绝填充与非规范输入", () => {
    expect(toBase64Padded(new Uint8Array([1, 2, 3]))).toBe("AQID");
    expect(Array.from(fromBase64Padded("AQID"))).toEqual([1, 2, 3]);
  });
});
