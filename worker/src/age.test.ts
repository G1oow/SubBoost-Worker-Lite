import { describe, expect, it } from "vitest";
import {
  ageCapabilities,
  parseAgeOnly,
  parseAgeRecipients,
  resolveAgeConfig,
} from "./age";
import { bech32Encode, encodeAgeRecipient } from "@subboost/server-core/crypto/bech32";
import { x25519PublicKeyFromSecret } from "@subboost/server-core/crypto/x25519";

/** 固定私钥推出的两把公钥，保证用例可重复 */
const SECRETS = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)];
const RECIPIENTS = SECRETS.map((secret) =>
  encodeAgeRecipient(x25519PublicKeyFromSecret(secret))
);

function env(overrides: Partial<Env> = {}): Env {
  return { ...overrides } as unknown as Env;
}

describe("parseAgeOnly", () => {
  it("只把 1/true/yes/on 当真", () => {
    for (const value of ["1", "true", "TRUE", " yes ", "on"]) {
      expect(parseAgeOnly(value)).toBe(true);
    }
    for (const value of ["", "0", "false", "off", "anything", undefined]) {
      expect(parseAgeOnly(value)).toBe(false);
    }
  });
});

describe("parseAgeRecipients", () => {
  it("支持逗号、空格与换行分隔并去重", () => {
    const raw = `${RECIPIENTS[0]},${RECIPIENTS[1]}\n${RECIPIENTS[0]}  `;
    const { valid, invalid } = parseAgeRecipients(raw);
    expect(valid).toEqual(RECIPIENTS);
    expect(invalid).toEqual([]);
  });

  it("非法项会被单独列出来", () => {
    const { valid, invalid } = parseAgeRecipients(`${RECIPIENTS[0]} age1broken`);
    expect(valid).toEqual([RECIPIENTS[0]]);
    expect(invalid).toEqual(["age1broken"]);
  });

  it("空值与缺失都得到空结果", () => {
    expect(parseAgeRecipients("")).toEqual({ valid: [], invalid: [] });
    expect(parseAgeRecipients(undefined)).toEqual({ valid: [], invalid: [] });
  });

  it("超过 8 把的部分按非法处理", () => {
    const many = Array.from({ length: 10 }, () => RECIPIENTS[0]).join(",");
    const { valid, invalid } = parseAgeRecipients(`${many},${RECIPIENTS[1]}`);
    // 先去重，再去掉超出上限的部分
    expect(valid).toEqual(RECIPIENTS);
    expect(invalid).toEqual([]);
  });
});

describe("resolveAgeConfig", () => {
  it("未配置时 disabled，且 AGE_ONLY 不影响状态", () => {
    expect(resolveAgeConfig(env())).toEqual({ status: "disabled", only: false });
    expect(resolveAgeConfig(env({ AGE_ONLY: "1" }))).toEqual({ status: "disabled", only: true });
  });

  it("配置合法时 ok，并带上 only 标记", () => {
    expect(
      resolveAgeConfig(env({ AGE_RECIPIENT: RECIPIENTS[0], AGE_ONLY: "true" }))
    ).toEqual({ status: "ok", recipients: [RECIPIENTS[0]], only: true });
  });

  it("全部非法时 invalid；只要有一把非法也整体判 invalid", () => {
    expect(resolveAgeConfig(env({ AGE_RECIPIENT: "age1broken" }))).toEqual({
      status: "invalid",
      invalid: ["age1broken"],
      only: false,
    });
    expect(
      resolveAgeConfig(env({ AGE_RECIPIENT: `${RECIPIENTS[0]} age1broken` }))
    ).toEqual({ status: "invalid", invalid: ["age1broken"], only: false });
  });
});

describe("ageCapabilities", () => {
  it("把三种解析结果折叠成管理端需要的形状", () => {
    expect(ageCapabilities({ status: "disabled", only: true })).toEqual({
      enabled: false,
      only: false,
      recipients: [],
      misconfigured: false,
    });
    expect(ageCapabilities({ status: "invalid", invalid: ["x"], only: true })).toEqual({
      enabled: false,
      only: true,
      recipients: [],
      misconfigured: true,
    });
    expect(ageCapabilities({ status: "ok", recipients: [RECIPIENTS[0]], only: false })).toEqual({
      enabled: true,
      only: false,
      recipients: [RECIPIENTS[0]],
      misconfigured: false,
    });
  });

  it("私钥串不会被当成公钥收下", () => {
    const secretKey = bech32Encode("age-secret-key-", SECRETS[0]).toUpperCase();
    expect(resolveAgeConfig(env({ AGE_RECIPIENT: secretKey })).status).toBe("invalid");
  });
});
