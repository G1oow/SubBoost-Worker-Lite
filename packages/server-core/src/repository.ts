/**
 * 仓库归属与派生地址。
 *
 * 放在 server-core：Worker（新版本检测）与管理端（页头 Logo、发布页链接）
 * 都要用，两边各自写一份字符串迟早会漂移。
 */

/** 仓库归属（owner/repo） */
export const REPOSITORY_SLUG = "G1oow/SubBoost-Worker-Lite";

/** 仓库主页 */
export const REPOSITORY_URL = `https://github.com/${REPOSITORY_SLUG}`;

/** 发布页：管理端「前往 GitHub」按钮指向这里 */
export const REPOSITORY_RELEASES_URL = `${REPOSITORY_URL}/releases`;

/**
 * 上游版本号的唯一来源：主干分支的 package.json。
 *
 * 不用 GitHub API 有两个原因：一是未认证的 API 每小时只有 60 次配额，
 * 而 Workers 出口 IP 是共享的，很容易撞上 403；二是本仓库的版本号在
 * 每次改动时都会随提交升上去，读 package.json 拿到的就是最新版本。
 */
export const UPSTREAM_PACKAGE_JSON_URL = `https://raw.githubusercontent.com/${REPOSITORY_SLUG}/main/package.json`;
