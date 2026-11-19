import { isNewerVersion } from "@subboost/server-core/update/latest-version";

/**
 * 「发现新版本」的展示判定与「忽略」记忆。
 *
 * 判定集中在纯函数里，方便单测覆盖三种边界：上游抓不到、版本没变、用户已经忽略过这个版本。
 */

/** 已忽略的版本号（用户点过「忽略此版本」） */
export const UPDATE_DISMISSED_STORAGE_KEY = "subboost-worker-dismissed-version";

/** `GET /api/update-check` 的响应形状（对应 worker/src/router.ts） */
export type UpdateCheckResponse = {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  checkedAt: string | null;
  releaseUrl: string;
};

export type UpdateNotice = {
  latestVersion: string;
  releaseUrl: string;
};

function resolveStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readDismissedVersion(storage?: Storage): string | null {
  const target = resolveStorage(storage);
  if (!target) return null;
  try {
    const value = target.getItem(UPDATE_DISMISSED_STORAGE_KEY);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export function writeDismissedVersion(version: string, storage?: Storage): void {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.setItem(UPDATE_DISMISSED_STORAGE_KEY, version);
  } catch {
    // 存储不可用时只是这次会话内继续提示，不影响主流程
  }
}

/**
 * 该不该在版本徽章上点红点。
 *
 * 只有「服务端说可更新 + 版本号确实更高 + 不是用户已经忽略的那个版本」三者同时成立才提示。
 * 服务端的 `updateAvailable` 与本地版本比较做的是同一件事，这里再算一遍是为了让
 * 组件不依赖服务端字段的正确性——两边任意一处坏掉都只会少提示，不会误提示。
 */
export function resolveUpdateNotice(
  response: UpdateCheckResponse | null | undefined,
  dismissedVersion: string | null
): UpdateNotice | null {
  const latestVersion = response?.latestVersion;
  if (!response || typeof latestVersion !== "string" || !latestVersion) return null;
  if (!response.updateAvailable) return null;
  if (!isNewerVersion(latestVersion, response.currentVersion)) return null;
  if (dismissedVersion && dismissedVersion === latestVersion) return null;
  return { latestVersion, releaseUrl: response.releaseUrl };
}
