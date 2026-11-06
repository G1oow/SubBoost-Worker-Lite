import { describe, expect, it } from "vitest";
import { redactSegmentCredentials } from "./redact";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("redactSegmentCredentials", () => {
  it("masks URI userinfo for IPv4, IPv6, and password userinfo", () => {
    expect(redactSegmentCredentials(`anytls://${UUID}@[2001:db8::1]:443?security=reality`)).toBe(
      "anytls://***@[2001:db8::1]:443?security=reality"
    );
    expect(redactSegmentCredentials("ss://aes-128-gcm:pass@192.0.2.10:8388#SS")).toBe(
      "ss://***@192.0.2.10:8388#SS"
    );
    expect(redactSegmentCredentials("anytls://secret@anytls.example.com:443")).toBe(
      "anytls://***@anytls.example.com:443"
    );
  });

  it("masks credential key/value pairs in config lines", () => {
    expect(
      redactSegmentCredentials("AnyTLS = anytls, anytls.example.com, 443, password=secret, security=reality")
    ).toBe("AnyTLS = anytls, anytls.example.com, 443, password=***, security=reality");
    expect(redactSegmentCredentials("Snell = snell, snell.example.com, 443, psk=abc;tail")).toBe(
      "Snell = snell, snell.example.com, 443, psk=***;tail"
    );
    expect(
      redactSegmentCredentials(`VMess = vmess, vmess.example.com, 443, username=${UUID}, ws=true`)
    ).toBe("VMess = vmess, vmess.example.com, 443, username=***, ws=true");
    expect(
      redactSegmentCredentials("SS = ss, ss.example.com, 8388, encrypt-method=aes-128-gcm, password=secret")
    ).toBe("SS = ss, ss.example.com, 8388, encrypt-method=aes-128-gcm, password=***");
  });

  it("keeps segments and URIs without credentials untouched", () => {
    expect(redactSegmentCredentials("Bad = ss, missing-port")).toBe("Bad = ss, missing-port");
    expect(redactSegmentCredentials("ftp://not-supported")).toBe("ftp://not-supported");
    expect(redactSegmentCredentials("anytls://anytls.example.com:443?sni=anytls.example.com")).toBe(
      "anytls://anytls.example.com:443?sni=anytls.example.com"
    );
  });

  it("tolerates empty input", () => {
    expect(redactSegmentCredentials("")).toBe("");
  });
});
