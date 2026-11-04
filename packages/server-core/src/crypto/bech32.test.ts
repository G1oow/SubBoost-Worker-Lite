import { describe, expect, it } from "vitest";
import {
  bech32Decode,
  bech32Encode,
  decodeAgeRecipient,
  decodeAgeSecretKey,
  encodeAgeRecipient,
} from "./bech32";

const PAYLOAD_32 = new Uint8Array(32).fill(5);

describe("bech32", () => {
  it("8 位与 5 位之间的往返保持一致", () => {
    const encoded = bech32Encode("age", PAYLOAD_32);
    expect(encoded.startsWith("age1")).toBe(true);
    const decoded = bech32Decode(encoded);
    expect(decoded.hrp).toBe("age");
    expect(Array.from(decoded.payload)).toEqual(Array.from(PAYLOAD_32));
  });

  it("允许全大写输入，拒绝大小写混用", () => {
    const encoded = bech32Encode("age", PAYLOAD_32);
    expect(bech32Decode(encoded.toUpperCase()).hrp).toBe("age");
    const mixed = `${encoded.slice(0, 4).toUpperCase()}${encoded.slice(4)}`;
    expect(() => bech32Decode(mixed)).toThrow(/大小写/);
  });

  it("校验和被篡改时拒绝", () => {
    const encoded = bech32Encode("age", PAYLOAD_32);
    const tampered = `${encoded.slice(0, -1)}${encoded.endsWith("q") ? "p" : "q"}`;
    expect(() => bech32Decode(tampered)).toThrow(/校验和/);
  });

  it("非 bech32 字符、缺分隔符、空串都拒绝", () => {
    expect(() => bech32Decode("age1qqqqqqqqu")).toThrow();
    expect(() => bech32Decode("age")).toThrow();
    expect(() => bech32Decode("")).toThrow(/空/);
    expect(() => bech32Decode("age1qqq qqq")).toThrow(/字符/);
  });

  it("编码要求小写 hrp", () => {
    expect(() => bech32Encode("AGE", PAYLOAD_32)).toThrow(/小写/);
  });

  it("age 公钥与私钥的 hrp 与长度都被严格校验", () => {
    const recipient = encodeAgeRecipient(PAYLOAD_32);
    expect(decodeAgeRecipient(recipient)).toEqual(PAYLOAD_32);

    const secret = bech32Encode("age-secret-key-", PAYLOAD_32).toUpperCase();
    expect(decodeAgeSecretKey(secret)).toEqual(PAYLOAD_32);

    // hrp 不匹配：把公钥当私钥解、把私钥当公钥解都要失败
    expect(() => decodeAgeSecretKey(recipient)).toThrow(/私钥/);
    expect(() => decodeAgeRecipient(secret)).toThrow(/公钥/);
    // 长度不对：16 字节的 age1 串不是合法公钥
    expect(() => decodeAgeRecipient(bech32Encode("age", new Uint8Array(16).fill(1)))).toThrow(
      /32 字节/
    );
  });
});
