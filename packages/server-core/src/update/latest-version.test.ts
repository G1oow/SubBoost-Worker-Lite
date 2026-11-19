import { describe, expect, it } from "vitest";
import {
  compareVersions,
  isNewerVersion,
  parseVersion,
  readUpstreamVersion,
} from "./latest-version";

describe("parseVersion", () => {
  it("parses plain and v-prefixed versions", () => {
    expect(parseVersion("0.25.0")).toEqual({ numbers: [0, 25, 0], prerelease: "" });
    expect(parseVersion("v0.25.0")).toEqual({ numbers: [0, 25, 0], prerelease: "" });
    expect(parseVersion(" 1.2.3 ")).toEqual({ numbers: [1, 2, 3], prerelease: "" });
  });

  it("keeps the prerelease tag", () => {
    expect(parseVersion("0.26.0-beta.1")).toEqual({ numbers: [0, 26, 0], prerelease: "beta.1" });
  });

  it("rejects anything that is not a full version", () => {
    for (const value of ["", "0.25", "0.25.0.1", "abc", "0.25.0+build.1", null, 25]) {
      expect(parseVersion(value)).toBeNull();
    }
  });
});

describe("compareVersions", () => {
  it("compares numeric segments", () => {
    expect(compareVersions("0.26.0", "0.25.0")).toBe(1);
    expect(compareVersions("0.25.0", "0.25.0")).toBe(0);
    expect(compareVersions("0.25.0", "0.26.0")).toBe(-1);
    // 0.9.0 < 0.25.0：不能按字符串比
    expect(compareVersions("0.9.0", "0.25.0")).toBe(-1);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
  });

  it("ranks a release above its prerelease", () => {
    expect(compareVersions("0.26.0", "0.26.0-beta.1")).toBe(1);
    expect(compareVersions("0.26.0-beta.1", "0.26.0")).toBe(-1);
    expect(compareVersions("0.26.0-beta.1", "0.26.0-beta.1")).toBe(0);
  });

  it("returns null when either side is unparsable", () => {
    expect(compareVersions("0.26.0", "latest")).toBeNull();
    expect(compareVersions("", "")).toBeNull();
  });
});

describe("isNewerVersion", () => {
  it("only reports strictly newer versions", () => {
    expect(isNewerVersion("0.26.0", "0.25.0")).toBe(true);
    expect(isNewerVersion("0.25.0", "0.25.0")).toBe(false);
    expect(isNewerVersion("0.24.0", "0.25.0")).toBe(false);
  });

  it("stays quiet when the upstream version cannot be trusted", () => {
    expect(isNewerVersion(null, "0.25.0")).toBe(false);
    expect(isNewerVersion("0.26.0", "")).toBe(false);
    expect(isNewerVersion("main", "0.25.0")).toBe(false);
  });
});

describe("readUpstreamVersion", () => {
  it("reads version from an upstream package.json payload", () => {
    expect(readUpstreamVersion({ name: "x", version: "0.26.0" })).toBe("0.26.0");
    expect(readUpstreamVersion({ version: " v0.26.0 " })).toBe("v0.26.0");
  });

  it("ignores malformed payloads", () => {
    expect(readUpstreamVersion(null)).toBeNull();
    expect(readUpstreamVersion([{ version: "0.26.0" }])).toBeNull();
    expect(readUpstreamVersion({})).toBeNull();
    expect(readUpstreamVersion({ version: 26 })).toBeNull();
    expect(readUpstreamVersion({ version: "next" })).toBeNull();
  });
});
