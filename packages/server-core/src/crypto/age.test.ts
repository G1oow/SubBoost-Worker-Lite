import { describe, expect, it } from "vitest";
import { armorAge, dearmorAge } from "./age-armor";
import { AGE_TEST_VECTORS, type AgeTestVector } from "./age-test-vectors";
import {
  AGE_VERSION_LINE,
  decryptAgeFile,
  decryptAgePayload,
  encryptAge,
  encryptAgePayload,
  isAgeRecipient,
  parseAgeHeader,
  unwrapAgeFileKey,
} from "./age";
import { bech32Encode, decodeAgeRecipient, encodeAgeRecipient } from "./bech32";
import { fromBase64Padded, fromHex, toHex, utf8Decode, utf8Encode } from "./bytes";
import { x25519PublicKeyFromSecret } from "./x25519";

/** 固定私钥：测试里不取 CSPRNG，保证用例可重复 */
const SECRET_A = new Uint8Array(32).fill(7);
const SECRET_B = new Uint8Array(32).fill(9);

function recipientOf(secret: Uint8Array): string {
  return encodeAgeRecipient(x25519PublicKeyFromSecret(secret));
}

function identityOf(secret: Uint8Array): string {
  // age 的私钥编码是 bech32 + 大写
  return bech32Encode("age-secret-key-", secret).toUpperCase();
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return toHex(new Uint8Array(digest));
}

function vectorFile(vector: AgeTestVector): Uint8Array {
  return fromBase64Padded(vector.base64);
}

function vectorContent(vector: AgeTestVector): Uint8Array {
  const raw = vectorFile(vector);
  // armored 向量存的是 armor 文本，先解成二进制 age 报文
  return vector.armored ? dearmorAge(utf8Decode(raw)) : raw;
}

describe("age 官方向量（C2SP/CCTV testkit）", () => {
  const successVectors = AGE_TEST_VECTORS.filter((vector) => vector.expect === "success");

  it("覆盖了单 recipient、多 recipient 与 armored 三种成功用例", () => {
    expect(successVectors.map((vector) => vector.name).sort()).toEqual([
      "armor_x25519",
      "x25519",
      "x25519_multiple_recipients",
    ]);
  });

  for (const vector of successVectors) {
    it(`${vector.name}：解密后明文的 SHA-256 与向量一致`, async () => {
      const plaintext = await decryptAgeFile(vectorContent(vector), vector.identities);
      expect(await sha256Hex(plaintext)).toBe(vector.payloadSha256Hex);
    });
  }

  it("hmac_bad：header 被改动时 MAC 校验失败", async () => {
    const vector = AGE_TEST_VECTORS.find((item) => item.name === "hmac_bad");
    if (!vector) throw new Error("缺少 hmac_bad 向量");
    await expect(decryptAgeFile(vectorContent(vector), vector.identities)).rejects.toThrow(
      /MAC/
    );
  });

  it("x25519_no_match：identity 不匹配时报错", async () => {
    const vector = AGE_TEST_VECTORS.find((item) => item.name === "x25519_no_match");
    if (!vector) throw new Error("缺少 x25519_no_match 向量");
    await expect(decryptAgeFile(vectorContent(vector), vector.identities)).rejects.toThrow(
      /私钥/
    );
  });

  it("x25519_low_order：低阶点必须拒绝解封（共享密钥全零）", async () => {
    const vector = AGE_TEST_VECTORS.find((item) => item.name === "x25519_low_order");
    if (!vector) throw new Error("缺少 x25519_low_order 向量");
    await expect(decryptAgeFile(vectorContent(vector), vector.identities)).rejects.toThrow(
      /全零|私钥/
    );
  });

  it("payload 加密方向：同一 file key 与非零 nonce 下逐字节复现向量密文", async () => {
    const vector = AGE_TEST_VECTORS.find((item) => item.name === "x25519");
    if (!vector?.fileKeyHex) throw new Error("缺少 x25519 向量");

    const file = vectorContent(vector);
    const header = parseAgeHeader(file);
    const fileKey = await unwrapAgeFileKey(header, vector.identities);
    expect(toHex(fileKey)).toBe(vector.fileKeyHex);

    const payload = file.subarray(header.payloadOffset);
    const plaintext = await decryptAgePayload(fileKey, payload);
    expect(await sha256Hex(plaintext)).toBe(vector.payloadSha256Hex);

    const nonce = payload.subarray(0, 16);
    expect(toHex(await encryptAgePayload(fileKey, plaintext, nonce))).toBe(toHex(payload));
  });
});

describe("age 报文结构", () => {
  it("生成的文件头逐行符合规范", async () => {
    const file = await encryptAge({ plaintext: "a: 1\n", recipients: [recipientOf(SECRET_A)] });
    const text = utf8Decode(file.subarray(0, parseAgeHeader(file).payloadOffset));
    const lines = text.split("\n");

    expect(lines[0]).toBe(AGE_VERSION_LINE);
    expect(lines[1]).toMatch(/^-> X25519 [A-Za-z0-9+/]{43}$/);
    expect(lines[2]).toMatch(/^[A-Za-z0-9+/]{43}$/);
    // 末尾还有 MAC 行结尾的换行，所以是 5 段（最后一段是空串）
    expect(lines).toHaveLength(5);
    expect(lines[4]).toBe("");
    expect(lines[3]).toMatch(/^--- [A-Za-z0-9+/]{43}$/);
  });

  it("多 recipient 时每个 stanza 各占一行 share 与一行 body", async () => {
    const file = await encryptAge({
      plaintext: "nodes: []\n",
      recipients: [recipientOf(SECRET_A), recipientOf(SECRET_B)],
    });
    const header = parseAgeHeader(file);
    expect(header.stanzas).toHaveLength(2);
    for (const stanza of header.stanzas) {
      expect(stanza.type).toBe("X25519");
      expect(stanza.args).toHaveLength(2);
      expect(stanza.body.byteLength).toBe(32);
    }
  });

  it("非 age 报文直接报错", () => {
    expect(() => parseAgeHeader(utf8Encode("hello\n--- x\n"))).toThrow(/age v1/);
    expect(() => parseAgeHeader(new Uint8Array(0))).toThrow(/版本行/);
  });
});

describe("age 往返", () => {
  for (const [label, plaintext] of [
    ["普通文本", "proxies:\n  - name: 演示节点\n    type: ss\n"],
    ["空明文", ""],
    ["64 KiB 边界", "x".repeat(64 * 1024)],
    ["128 KiB（两个满块）", "y".repeat(128 * 1024)],
    ["跨块 + 尾部", "z".repeat(64 * 1024 + 7)],
  ] as const) {
    it(`${label} 能解回原文`, async () => {
      const file = await encryptAge({ plaintext, recipients: [recipientOf(SECRET_A)] });
      const decrypted = await decryptAgeFile(file, [identityOf(SECRET_A)]);
      expect(utf8Decode(decrypted)).toBe(plaintext);
    });
  }

  it("多个 recipient 中任意一把私钥都能解开", async () => {
    const file = await encryptAge({
      plaintext: "shared",
      recipients: [recipientOf(SECRET_A), recipientOf(SECRET_B)],
    });
    expect(utf8Decode(await decryptAgeFile(file, [identityOf(SECRET_B)]))).toBe("shared");
    expect(utf8Decode(await decryptAgeFile(file, [SECRET_A]))).toBe("shared");
  });

  it("没有对应私钥时解不开", async () => {
    const file = await encryptAge({ plaintext: "secret", recipients: [recipientOf(SECRET_A)] });
    const other = new Uint8Array(32).fill(3);
    await expect(decryptAgeFile(file, [identityOf(other)])).rejects.toThrow(/私钥/);
  });

  it("密文被篡改时报错", async () => {
    const file = await encryptAge({ plaintext: "secret", recipients: [recipientOf(SECRET_A)] });
    const header = parseAgeHeader(file);
    file[header.payloadOffset + 20] ^= 0xff;
    await expect(decryptAgeFile(file, [identityOf(SECRET_A)])).rejects.toThrow(/认证失败/);
  });

  it("公钥不合法时拒绝加密", async () => {
    await expect(encryptAge({ plaintext: "x", recipients: ["age1bad"] })).rejects.toThrow();
    await expect(encryptAge({ plaintext: "x", recipients: [] })).rejects.toThrow(/至少/);
    await expect(
      encryptAge({ plaintext: "x", recipients: new Array(9).fill(recipientOf(SECRET_A)) })
    ).rejects.toThrow(/最多/);
  });
});

describe("age armor", () => {
  it("armor 往返并保持可解密", async () => {
    const file = await encryptAge({ plaintext: "armored", recipients: [recipientOf(SECRET_A)] });
    const armored = armorAge(file);
    expect(armored.startsWith("-----BEGIN AGE ENCRYPTED FILE-----\n")).toBe(true);
    expect(armored.trimEnd().endsWith("-----END AGE ENCRYPTED FILE-----")).toBe(true);
    expect(utf8Decode(await decryptAgeFile(dearmorAge(armored), [SECRET_A]))).toBe("armored");
  });

  it("拒绝块外杂质、缺尾行与非规范 base64", async () => {
    const file = await encryptAge({ plaintext: "armored", recipients: [recipientOf(SECRET_A)] });
    const armored = armorAge(file);
    expect(() => dearmorAge(`junk\n${armored}`)).toThrow(/起始行/);
    expect(() => dearmorAge(armored.replace("-----END AGE ENCRYPTED FILE-----\n", ""))).toThrow(
      /结束行/
    );
    expect(() => dearmorAge(`${armored}extra\n`)).toThrow();
    expect(() =>
      dearmorAge(armored.replace(/\n([A-Za-z0-9+/])/, "\n$1-"))
    ).toThrow();
  });
});

describe("isAgeRecipient", () => {
  it("识别合法公钥并拒绝非法输入", () => {
    const recipient = recipientOf(SECRET_A);
    expect(isAgeRecipient(recipient)).toBe(true);
    expect(decodeAgeRecipient(recipient)).toEqual(x25519PublicKeyFromSecret(SECRET_A));
    expect(isAgeRecipient("age1qqqqqqqq")).toBe(false);
    expect(isAgeRecipient("")).toBe(false);
    expect(isAgeRecipient(recipient.toUpperCase())).toBe(false);
    expect(isAgeRecipient(fromHex("00"))).toBe(false);
  });
});
