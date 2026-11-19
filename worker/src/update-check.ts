import { UPSTREAM_PACKAGE_JSON_URL } from "@subboost/server-core/repository";
import {
  parseVersion,
  readUpstreamVersion,
} from "@subboost/server-core/update/latest-version";
import type { fetchText } from "./safe-fetch";
import type { UpdateCheckRecord } from "./types";

/**
 * 新版本检测。
 *
 * 只回答一个问题：仓库主干上的 package.json 版本是多少。
 * 结果写进 KV 缓存 6 小时（`meta:update-check`），所以管理端每次打开页头
 * 都问一次也不会真的每次都打 GitHub。
 *
 * 三道「宁可不提示」的保守设计：
 * 1. 抓取失败、上游结构不对、版本号解析不了，一律返回 null —— 没有红点，
 *    绝不因为网络抖动给用户一个假的「有新版本」。
 * 2. 缓存的版本号本身也要校验，脏数据当作未命中重新抓。
 * 3. 缓存写失败不影响本次结果：文件读出来了就先按它回答。
 */
export type UpdateCheckResult = {
  /** 仓库主干上的最新版本号；抓不到时为 null */
  latestVersion: string | null;
  /** 上次成功抓到上游版本的时间（ISO），命中缓存时保留原时间 */
  checkedAt: string | null;
};

export type UpdateCheckDeps = {
  fetchText: typeof fetchText;
  /** 读缓存（KV `meta:update-check`） */
  readCache: () => Promise<UpdateCheckRecord | null>;
  /** 写缓存；失败只是下次重新抓，不影响本次结果 */
  writeCache: (record: UpdateCheckRecord) => Promise<void>;
  userAgent: string;
  now: () => Date;
};

/** 抓上游 package.json 并解析出版本号；任何异常都收敛成 null */
export async function fetchLatestVersion(
  deps: Pick<UpdateCheckDeps, "fetchText" | "userAgent">
): Promise<string | null> {
  let text: string;
  try {
    const response = await deps.fetchText(UPSTREAM_PACKAGE_JSON_URL, {
      userAgent: deps.userAgent,
      timeoutMs: 8000,
      maxRetries: 0,
      // package.json 只有几百字节；给到 64 KiB 已经足够宽容
      maxBytes: 64 * 1024,
    });
    if (response.status < 200 || response.status >= 300) return null;
    text = response.text;
  } catch {
    return null;
  }

  try {
    return readUpstreamVersion(JSON.parse(text));
  } catch {
    return null;
  }
}

/** 缓存的版本号合法才复用；脏数据按未命中处理 */
function readCacheRecord(record: UpdateCheckRecord | null): UpdateCheckResult | null {
  if (!record || !parseVersion(record.latestVersion)) return null;
  return { latestVersion: record.latestVersion, checkedAt: record.checkedAt };
}

export async function checkForUpdate(deps: UpdateCheckDeps): Promise<UpdateCheckResult> {
  const cached = readCacheRecord(await deps.readCache().catch(() => null));
  if (cached) return cached;

  const latestVersion = await fetchLatestVersion(deps);
  if (!latestVersion) return { latestVersion: null, checkedAt: null };

  const checkedAt = deps.now().toISOString();
  await deps.writeCache({ latestVersion, checkedAt }).catch(() => undefined);

  return { latestVersion, checkedAt };
}
