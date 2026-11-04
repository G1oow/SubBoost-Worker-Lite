import { describe, expect, it } from "vitest";
import {
  decryptAgeFile,
  decryptAgePayload,
  encryptAge,
  encryptAgePayload,
  parseAgeHeader,
  unwrapAgeFileKey,
} from "./age";
import {
  bech32Decode,
  bech32Encode,
  decodeAgeRecipient,
  decodeAgeSecretKey,
  encodeAgeRecipient,
} from "./bech32";
import {
  bytesEqual,
  concatBytes,
  fromBase64NoPad,
  fromHex,
  utf8Decode,
  utf8Encode,
} from "./bytes";
import { chacha20Block, chacha20Xor } from "./chacha20";
import { open, seal } from "./chacha20-poly1305";
import { hkdfSha256 } from "./hkdf";
import { poly1305 } from "./poly1305";
import { x25519PublicKeyFromSecret } from "./x25519";

/**
 * 口令层原语的防御分支：错误长度、非规范编码、被截断的报文都必须在最靠近
 * 出错点的地方失败（而不是悄悄产出错误结果）。这些分支平时不走到，但一旦
 * 走到就是「用户数据被静默改坏」，值得逐条钉住。
 */

const SECRET = new Uint8Array(32).fill(21);
const RECIPIENT = encodeAgeRecipient(x25519PublicKeyFromSecret(SECRET));

describe("base64 与十六进制解码的严格性", () => {
  it("拒绝填充字符", () => {
    expect(() => fromBase64NoPad("AQ==")).toThrow(/不合法/);
  });

  it("拒绝长度模 4 余 1 的编码", () => {
    expect(() => fromBase64NoPad("AQIDA")).toThrow(/长度/);
  });

  it("拒绝尾比特非规范的编码（解码后无法原样重编码）", () => {
    expect(() => fromBase64NoPad("AB")).toThrow(/规范/);
  });

  it("十六进制串非法时报错", () => {
    expect(() => fromHex("zz")).toThrow(/十六进制/);
  });
});

describe("原语的长度校验", () => {
  it("ChaCha20 拒绝错误长度的密钥与 nonce", () => {
    expect(() => chacha20Block(new Uint8Array(31), 0, new Uint8Array(12))).toThrow(/32 字节/);
    expect(() => chacha20Block(new Uint8Array(32), 0, new Uint8Array(11))).toThrow(/nonce/);
    expect(() =>
      chacha20Xor(new Uint8Array(31), new Uint8Array(12), new Uint8Array(1))
    ).toThrow(/32 字节/);
  });

  it("Poly1305 拒绝错误长度的密钥", () => {
    expect(() => poly1305(new Uint8Array(31), new Uint8Array(0))).toThrow(/32 字节/);
  });

  it("AEAD 拒绝错误长度，并对过短密文返回 null 而不是抛错", () => {
    const key = new Uint8Array(32);
    const nonce = new Uint8Array(12);
    expect(() => seal(new Uint8Array(31), nonce, new Uint8Array(0))).toThrow(/32 字节/);
    expect(() => seal(key, new Uint8Array(11), new Uint8Array(0))).toThrow(/nonce/);
    expect(() => open(new Uint8Array(31), nonce, new Uint8Array(16))).toThrow(/32 字节/);
    expect(() => open(key, new Uint8Array(11), new Uint8Array(16))).toThrow(/nonce/);
    expect(open(key, nonce, new Uint8Array(15))).toBeNull();
  });

  it("age 私钥的 hrp 必须匹配", () => {
    const wrongHrp = bech32Encode("age", new Uint8Array(32).fill(1)).toUpperCase();
    expect(() => decodeAgeSecretKey(wrongHrp)).toThrow(/不是 age 私钥/);
  });
});

describe("age 报文的防御分支", () => {
  it("stanza 参数含空串时报错", () => {
    const file = utf8Encode("age-encryption.org/v1\n-> X25519  \nAAAA\n--- AAAA\n");
    expect(() => parseAgeHeader(file)).toThrow(/参数不合法/);
  });

  it("identity 不合法时给出「私钥」相关错误", async () => {
    const file = await encryptAge({ plaintext: "x", recipients: [RECIPIENT] });
    await expect(decryptAgeFile(file, ["not-an-age-key"])).rejects.toThrow(/私钥/);
  });

  it("payload 短于 nonce + tag 时报错", async () => {
    await expect(decryptAgePayload(new Uint8Array(16), new Uint8Array(31))).rejects.toThrow(
      /过短/
    );
  });

  it("多块 payload 出现空末块时报错", async () => {
    const fileKey = new Uint8Array(16).fill(4);
    const nonce = new Uint8Array(16).fill(5);
    const payloadKey = await hkdfSha256(fileKey, nonce, utf8Encode("payload"));
    const firstNonce = new Uint8Array(12);
    const emptyFinalNonce = new Uint8Array(12);
    emptyFinalNonce[10] = 1;
    emptyFinalNonce[11] = 1;

    const payload = concatBytes(
      nonce,
      seal(payloadKey, firstNonce, new Uint8Array(64 * 1024)),
      seal(payloadKey, emptyFinalNonce, new Uint8Array(0))
    );

    await expect(decryptAgePayload(fileKey, payload)).rejects.toThrow(/末块不能为空/);
  });
});

const IDENTITY = bech32Encode("age-secret-key-", SECRET).toUpperCase();

/** 拼一个最小 age 文件头（MAC 用占位字符，长度必须合规） */
function headerOf(lines: string[]): Uint8Array {
  return utf8Encode(`${lines.join("\n")}\n`);
}

const FAKE_MAC_LINE = `--- ${"A".repeat(43)}`;

describe("畸形 age 报文", () => {
  it("缺少结尾换行时报文头不完整", () => {
    expect(() =>
      parseAgeHeader(utf8Encode("age-encryption.org/v1\n-> X25519 AAAA\nAAAA"))
    ).toThrow(/不完整/);
  });

  it("MAC 行长度不合法", () => {
    expect(() =>
      parseAgeHeader(
        headerOf(["age-encryption.org/v1", "-> X25519 AAAA", "AAAA", "--- AAAA"])
      )
    ).toThrow(/MAC/);
  });

  it("既不是 stanza 也不是 MAC 的行会被拒绝", () => {
    expect(() => parseAgeHeader(headerOf(["age-encryption.org/v1", "hello world"]))).toThrow(
      /结构不合法/
    );
  });

  it("stanza 正文行超过 64 列会被拒绝", () => {
    expect(() =>
      parseAgeHeader(headerOf(["age-encryption.org/v1", "-> X25519 AAAA", "A".repeat(65)]))
    ).toThrow(/过长/);
  });

  it("空正文行表示 stanza 正文为空", () => {
    const parsed = parseAgeHeader(
      headerOf(["age-encryption.org/v1", "-> X25519 AAAA", "", FAKE_MAC_LINE])
    );
    expect(parsed.stanzas).toHaveLength(1);
    expect(parsed.stanzas[0].body.byteLength).toBe(0);
  });

  it("非 X25519 stanza 会被跳过", async () => {
    const file = headerOf(["age-encryption.org/v1", "-> scrypt c2FsdA 10", "", FAKE_MAC_LINE]);
    await expect(unwrapAgeFileKey(parseAgeHeader(file), [IDENTITY])).rejects.toThrow(/私钥/);
  });

  it("X25519 stanza 的参数个数、share 长度、正文长度都受校验", async () => {
    const badArgs = headerOf(["age-encryption.org/v1", "-> X25519", "", FAKE_MAC_LINE]);
    await expect(unwrapAgeFileKey(parseAgeHeader(badArgs), [IDENTITY])).rejects.toThrow(
      /参数个数/
    );

    const shortShare = headerOf([
      "age-encryption.org/v1",
      "-> X25519 AAAA",
      "AAAA",
      FAKE_MAC_LINE,
    ]);
    await expect(unwrapAgeFileKey(parseAgeHeader(shortShare), [IDENTITY])).rejects.toThrow(
      /share/
    );

    const badBody = headerOf([
      "age-encryption.org/v1",
      `-> X25519 ${"A".repeat(43)}`,
      "AAAA",
      FAKE_MAC_LINE,
    ]);
    await expect(unwrapAgeFileKey(parseAgeHeader(badBody), [IDENTITY])).rejects.toThrow(/正文/);
  });
});

describe("age 长度校验与低阶点", () => {
  it("identity 不是 32 字节时报错", async () => {
    const file = await encryptAge({ plaintext: "x", recipients: [RECIPIENT] });
    await expect(decryptAgeFile(file, [new Uint8Array(31)])).rejects.toThrow(/32 字节/);
  });

  it("payload 加密/解密的长度校验", async () => {
    await expect(encryptAgePayload(new Uint8Array(15), new Uint8Array(0))).rejects.toThrow(
      /16 字节/
    );
    await expect(
      encryptAgePayload(new Uint8Array(16), new Uint8Array(0), new Uint8Array(15))
    ).rejects.toThrow(/nonce/);
    await expect(decryptAgePayload(new Uint8Array(15), new Uint8Array(64))).rejects.toThrow(
      /16 字节/
    );
  });

  it("低阶点公钥（共享密钥全零）会被拒绝", async () => {
    const lowOrder = encodeAgeRecipient(new Uint8Array(32));
    await expect(encryptAge({ plaintext: "x", recipients: [lowOrder] })).rejects.toThrow(/全零/);
  });

  it("直接传 Uint8Array 明文同样可加解密", async () => {
    const file = await encryptAge({ plaintext: utf8Encode("bytes"), recipients: [RECIPIENT] });
    expect(utf8Decode(await decryptAgeFile(file, [IDENTITY]))).toBe("bytes");
  });
});

describe("bech32 的边界分支", () => {
  it("bytesEqual 对长度不同的输入返回 false", () => {
    expect(bytesEqual(new Uint8Array(1), new Uint8Array(2))).toBe(false);
  });

  it("hrp 不是 age 时拒绝", () => {
    const wrongHrp = bech32Encode("agee", new Uint8Array(32).fill(2));
    expect(() => decodeAgeRecipient(wrongHrp)).toThrow(/公钥/);
  });

  it("公钥长度不是 32 字节时拒绝编码", () => {
    expect(() => encodeAgeRecipient(new Uint8Array(31))).toThrow(/32 字节/);
  });

  it("非字符串与超长输入被拒绝", () => {
    expect(() => bech32Decode(null as unknown as string)).toThrow(/字符串/);
    expect(() => bech32Decode("a".repeat(5000))).toThrow(/过长/);
  });

  it("5 位分组正好整除时也能往返（覆盖填充分支另一侧）", () => {
    const payload = new Uint8Array(40).fill(3);
    expect(Array.from(bech32Decode(bech32Encode("age", payload)).payload)).toEqual(
      Array.from(payload)
    );
  });
});
