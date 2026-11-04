import { describe, expect, it } from "vitest";
import {
  CryptoError,
  decryptString,
  encryptString,
  generateShortCode,
  generateToken,
  sha256Hex,
  timingSafeEqual,
} from "./crypto";
import { SHORT_CODE_LENGTH, SHORT_CODE_PATTERN } from "./types";

const SECRET = "test-secret-key-0123456789";

describe("encryptString / decryptString", () => {
  it("round-trips a plaintext string", async () => {
    const cipher = await encryptString("hello 世界", SECRET);
    expect(cipher.startsWith("v1:")).toBe(true);
    expect(cipher.split(":")).toHaveLength(3);
    await expect(decryptString(cipher, SECRET)).resolves.toBe("hello 世界");
  });

  it("produces different ciphertext for the same plaintext", async () => {
    const first = await encryptString("same", SECRET);
    const second = await encryptString("same", SECRET);
    expect(first).not.toBe(second);
  });

  it("throws CryptoError when ciphertext is tampered", async () => {
    const cipher = await encryptString("hello", SECRET);
    const parts = cipher.split(":");
    const lastChar = parts[2].slice(-1);
    const flipped = lastChar === "A" ? "B" : "A";
    const tampered = `${parts[0]}:${parts[1]}:${parts[2].slice(0, -1)}${flipped}`;
    await expect(decryptString(tampered, SECRET)).rejects.toBeInstanceOf(CryptoError);
  });

  it("throws CryptoError with a different key", async () => {
    const cipher = await encryptString("hello", SECRET);
    await expect(decryptString(cipher, "another-secret-key-0123456789")).rejects.toBeInstanceOf(
      CryptoError
    );
  });

  it("throws CryptoError on malformed ciphertext", async () => {
    await expect(decryptString("v1:abc", SECRET)).rejects.toBeInstanceOf(CryptoError);
    await expect(decryptString("v2:a:b", SECRET)).rejects.toBeInstanceOf(CryptoError);
    await expect(decryptString("garbage", SECRET)).rejects.toBeInstanceOf(CryptoError);
  });
});

describe("generateToken", () => {
  it("is 43 base64url characters", () => {
    const token = generateToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is unique across 100 generations", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()));
    expect(tokens.size).toBe(100);
  });
});

describe("generateShortCode", () => {
  it("is 8 base64url characters and matches the short code pattern", () => {
    const code = generateShortCode();
    expect(code).toHaveLength(SHORT_CODE_LENGTH);
    expect(code).toMatch(SHORT_CODE_PATTERN);
  });

  it("is unique across 100 generations", () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateShortCode()));
    expect(codes.size).toBe(100);
  });
});

describe("sha256Hex", () => {
  it("matches the known digest for abc", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });
});

describe("timingSafeEqual", () => {
  it("compares equal and unequal strings", async () => {
    await expect(timingSafeEqual("a", "a")).resolves.toBe(true);
    await expect(timingSafeEqual("a", "b")).resolves.toBe(false);
    await expect(timingSafeEqual("a", "aa")).resolves.toBe(false);
    await expect(timingSafeEqual("", "")).resolves.toBe(true);
  });
});
