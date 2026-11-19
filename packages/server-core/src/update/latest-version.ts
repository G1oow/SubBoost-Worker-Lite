/**
 * 版本号比较与上游版本读取（纯函数，无运行时依赖）。
 *
 * 只服务「新版本检测」这一件事：判断上游 package.json 里的版本是否比当前高。
 * 刻意不引入 semver 依赖 —— 本仓库的版本号永远是 `x.y.z` 或 `x.y.z-beta.N`，
 * 完整 semver 的构建元数据、区间语法在这里都用不上。
 */

export type ParsedVersion = {
  /** major / minor / patch 三个数字段 */
  numbers: [number, number, number];
  /** 预发布标识（`beta.1`），空串表示正式版本 */
  prerelease: string;
};

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u;

export function parseVersion(value: unknown): ParsedVersion | null {
  if (typeof value !== "string") return null;
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) return null;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? "",
  };
}

/** 返回 -1 / 0 / 1；任一侧不是合法版本号时返回 null（无法比较 ≠ 相等） */
export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;

  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) {
      return a.numbers[index] < b.numbers[index] ? -1 : 1;
    }
  }
  if (a.prerelease === b.prerelease) return 0;
  // 同主版本号时，正式版比预发布版新：0.26.0 > 0.26.0-beta.1
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

/** `latest` 严格高于 `current` 时才为 true；版本号解析失败一律 false（宁可不提示） */
export function isNewerVersion(latest: unknown, current: unknown): boolean {
  if (typeof latest !== "string" || typeof current !== "string") return false;
  return compareVersions(latest, current) === 1;
}

/**
 * 从上游 package.json 的解析结果里取版本号。
 *
 * 结构不对、版本号不是合法 semver 时返回 null：上游改坏了不能变成一串红点。
 */
export function readUpstreamVersion(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const version = (payload as { version?: unknown }).version;
  if (typeof version !== "string") return null;
  const trimmed = version.trim();
  return parseVersion(trimmed) ? trimmed : null;
}
