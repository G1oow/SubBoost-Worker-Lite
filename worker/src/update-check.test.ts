import { describe, expect, it, vi } from "vitest";
import { UPSTREAM_PACKAGE_JSON_URL } from "@subboost/server-core/repository";
import type { fetchText } from "./safe-fetch";
import { checkForUpdate, fetchLatestVersion } from "./update-check";
import type { UpdateCheckRecord } from "./types";

const NOW = new Date("2026-11-20T00:00:00.000Z");

function stubFetchText(payload: string, status = 200): typeof fetchText {
  return (async () => ({ status, headers: {}, text: payload, finalUrl: UPSTREAM_PACKAGE_JSON_URL })) as unknown as typeof fetchText;
}

function deps(overrides: {
  fetchText?: typeof fetchText;
  cached?: UpdateCheckRecord | null;
  writeFails?: boolean;
} = {}) {
  const writeCache = vi.fn(async () => {
    if (overrides.writeFails) throw new Error("kv down");
  });
  return {
    fetchText: overrides.fetchText ?? stubFetchText(JSON.stringify({ version: "0.26.0" })),
    readCache: async () => overrides.cached ?? null,
    writeCache,
    userAgent: "test-agent",
    now: () => NOW,
  };
}

describe("fetchLatestVersion", () => {
  it("reads the version from the upstream package.json", async () => {
    const result = await fetchLatestVersion({
      fetchText: stubFetchText(JSON.stringify({ name: "x", version: "0.26.0" })),
      userAgent: "test-agent",
    });
    expect(result).toBe("0.26.0");
  });

  it("returns null on a non-2xx upstream response", async () => {
    const result = await fetchLatestVersion({
      fetchText: stubFetchText("", 404),
      userAgent: "test-agent",
    });
    expect(result).toBeNull();
  });

  it("returns null when the upstream body is not JSON", async () => {
    const result = await fetchLatestVersion({
      fetchText: stubFetchText("<html>rate limited</html>"),
      userAgent: "test-agent",
    });
    expect(result).toBeNull();
  });

  it("returns null when the fetch throws", async () => {
    const throwing = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetchText;
    expect(await fetchLatestVersion({ fetchText: throwing, userAgent: "test-agent" })).toBeNull();
  });
});

describe("checkForUpdate", () => {
  it("uses the cached version without hitting upstream", async () => {
    const fetchSpy = vi.fn(stubFetchText(JSON.stringify({ version: "0.99.0" })));
    const result = await checkForUpdate(
      deps({
        fetchText: fetchSpy as unknown as typeof fetchText,
        cached: { latestVersion: "0.26.0", checkedAt: "2026-11-19T00:00:00.000Z" },
      })
    );
    expect(result).toEqual({ latestVersion: "0.26.0", checkedAt: "2026-11-19T00:00:00.000Z" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refetches and caches when the cache holds a broken version", async () => {
    const fetchSpy = vi.fn(stubFetchText(JSON.stringify({ version: "0.26.0" })));
    const writeCache = vi.fn(async () => {});
    const result = await checkForUpdate({
      ...deps({ fetchText: fetchSpy as unknown as typeof fetchText }),
      writeCache,
    });
    // cached 为空 → 抓上游
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ latestVersion: "0.26.0", checkedAt: NOW.toISOString() });
    expect(writeCache).toHaveBeenCalledWith({
      latestVersion: "0.26.0",
      checkedAt: NOW.toISOString(),
    });

    // 缓存里是脏数据（不是版本号）时同样重新抓
    const secondFetch = vi.fn(stubFetchText(JSON.stringify({ version: "0.27.0" })));
    const second = await checkForUpdate(
      deps({
        fetchText: secondFetch as unknown as typeof fetchText,
        cached: { latestVersion: "not-a-version", checkedAt: "2026-11-01T00:00:00.000Z" },
      })
    );
    expect(secondFetch).toHaveBeenCalledTimes(1);
    expect(second.latestVersion).toBe("0.27.0");
  });

  it("still answers when the cache write fails", async () => {
    const result = await checkForUpdate(deps({ writeFails: true }));
    expect(result).toEqual({ latestVersion: "0.26.0", checkedAt: NOW.toISOString() });
  });

  it("reports nothing when upstream cannot be read", async () => {
    const result = await checkForUpdate(deps({ fetchText: stubFetchText("", 503) }));
    expect(result).toEqual({ latestVersion: null, checkedAt: null });
  });
});
