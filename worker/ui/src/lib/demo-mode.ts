/**
 * 演示（预览站）构建开关的唯一判定处。
 *
 * 背景：`vercel.json` 里的 `build.env` 已被 Vercel 标为 deprecated，Git 集成
 * 触发的预览构建不保证会把它注入构建进程。一旦开关丢失，产物就退化成
 * 需要 `ADMIN_TOKEN` 的正式管理端——首屏直接是登录页，预览站也就废了。
 *
 * 所以判定改成「不依赖 Vercel 控制台配置」：
 * 1. `VITE_SUBBOOST_DEMO=1/true` → 演示构建；
 * 2. `VITE_SUBBOOST_DEMO=0/false` → 正式构建（唯一关闭方式，留给以后
 *    真要在 Vercel 上托管正式管理端的场景）；
 * 3. 都没设但 `VERCEL=1`（Vercel 构建容器自带变量，任何预览/生产构建都有，
 *    且不受控制台 Build Command override 与 `build.env` 弃用影响）→ 演示构建；
 * 4. 其余情况（本地、CI、Cloudflare 部署）→ 正式构建。
 */
const TRUTHY = new Set(["1", "true"]);
const FALSY = new Set(["0", "false"]);

function readFlag(value: string | undefined): boolean | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (TRUTHY.has(normalized)) return true;
  if (FALSY.has(normalized)) return false;
  return null;
}

export function resolveDemoMode(env: Readonly<Record<string, string | undefined>>): boolean {
  const explicit = readFlag(env.VITE_SUBBOOST_DEMO);
  if (explicit !== null) return explicit;
  return readFlag(env.VERCEL) === true;
}
