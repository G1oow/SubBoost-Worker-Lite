import { describe, expect, it } from "vitest";
import {
  UPDATE_DISMISSED_STORAGE_KEY,
  readDismissedVersion,
  resolveUpdateNotice,
  writeDismissedVersion,
  type UpdateCheckResponse,
} from "./update-notice";

/** 最小 Storage 替身：只实现本模块用到的两个方法 */
function createStorageStub(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  } as Storage;
}

const RESPONSE: UpdateCheckResponse = {
  currentVersion: "0.25.0",
  latestVersion: "0.26.0",
  updateAvailable: true,
  checkedAt: "2026-11-20T00:00:00.000Z",
  releaseUrl: "https://github.com/example/repo/releases",
};

describe("resolveUpdateNotice", () => {
  it("reports a strictly newer upstream version", () => {
    expect(resolveUpdateNotice(RESPONSE, null)).toEqual({
      latestVersion: "0.26.0",
      releaseUrl: RESPONSE.releaseUrl,
    });
  });

  it("stays quiet when the upstream version cannot be fetched", () => {
    expect(
      resolveUpdateNotice({ ...RESPONSE, latestVersion: null, updateAvailable: false }, null)
    ).toBeNull();
  });

  it("stays quiet when the versions are the same or older", () => {
    expect(
      resolveUpdateNotice({ ...RESPONSE, latestVersion: "0.25.0" }, null)
    ).toBeNull();
    expect(
      resolveUpdateNotice({ ...RESPONSE, latestVersion: "0.24.9" }, null)
    ).toBeNull();
  });

  it("charges nothing when the server flag disagrees with the versions", () => {
    // 服务端说不可更新（例如它自己版本更高）时不提示，即使版本号看起来更新
    expect(
      resolveUpdateNotice({ ...RESPONSE, updateAvailable: false }, null)
    ).toBeNull();
    // 服务端说可更新但版本号其实没变，也不提示
    expect(
      resolveUpdateNotice({ ...RESPONSE, latestVersion: "0.25.0", updateAvailable: true }, null)
    ).toBeNull();
  });

  it("skips the version the user already ignored, but keeps later ones", () => {
    expect(resolveUpdateNotice(RESPONSE, "0.26.0")).toBeNull();
    expect(resolveUpdateNotice(RESPONSE, "0.25.0")).not.toBeNull();
  });
});

describe("dismissed version storage", () => {
  it("round-trips the ignored version", () => {
    const storage = createStorageStub();
    expect(readDismissedVersion(storage)).toBeNull();
    writeDismissedVersion("0.26.0", storage);
    expect(storage.getItem(UPDATE_DISMISSED_STORAGE_KEY)).toBe("0.26.0");
    expect(readDismissedVersion(storage)).toBe("0.26.0");
  });

  it("treats a blank value as not dismissed", () => {
    expect(readDismissedVersion(createStorageStub({ [UPDATE_DISMISSED_STORAGE_KEY]: "  " }))).toBeNull();
  });

  it("survives an unavailable storage", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(readDismissedVersion(broken)).toBeNull();
    expect(() => writeDismissedVersion("0.26.0", broken)).not.toThrow();
  });
});
