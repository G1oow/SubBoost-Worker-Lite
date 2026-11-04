#!/usr/bin/env node
/**
 * Vercel 预览站的构建入口（`vercel.json` 的 `buildCommand` 指向这里）。
 *
 * 为什么不是直接把 `npm run worker:build` 当构建命令：
 * 演示开关原先只写在 `vercel.json` 的 `build.env` 里，而该字段已被 Vercel 标记
 * deprecated，Git 集成触发的预览构建不保证注入。开关一丢，产物就变成需要
 * `ADMIN_TOKEN` 的正式管理端，预览站首屏直接是登录页。
 *
 * 所以这里做两件事，让「Vercel 构建 = 演示构建」不再依赖控制台配置：
 * 1. 在子进程环境里强制 `VITE_SUBBOOST_DEMO=1`；
 * 2. 构建完成后校验产物里的演示标记，缺失就以非零码退出——让部署失败，
 *    而不是静默发出一份需要 token 的站点。
 *
 * 逃生阀：显式 `VITE_SUBBOOST_DEMO=0` / `false` 时按正式构建走，同时跳过断言
 * （仅用于以后真要在 Vercel 上托管正式管理端的场景）。
 */
const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const { ensureDemoEnv, assertDemoArtifacts } = require("./lib/vercel-demo-build.cjs");

const rootDir = resolve(__dirname, "..");
const distDir = resolve(rootDir, "worker", "dist");

function fail(message) {
  console.error(`[vercel-demo] ${message}`);
  process.exit(1);
}

const { env, forced } = ensureDemoEnv(process.env);
if (forced) {
  console.log("[vercel-demo] 已在构建环境里强制 VITE_SUBBOOST_DEMO=1");
} else {
  console.warn(
    "[vercel-demo] 检测到显式关闭（VITE_SUBBOOST_DEMO=0/false）：按正式构建执行，跳过演示产物断言"
  );
}

const build = spawnSync("npm", ["run", "worker:build"], {
  cwd: rootDir,
  env,
  stdio: "inherit",
  // Windows 下 npm 是 .cmd，必须走 shell 才能被执行；参数是固定字面量，无注入面
  shell: process.platform === "win32",
});

if (build.error) {
  fail(`调用 npm run worker:build 失败：${build.error.message}`);
}
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}
if (!forced) process.exit(0);

const result = assertDemoArtifacts(distDir);
if (!result.ok) {
  fail(result.reason ?? "产物校验失败");
}

console.log(`[vercel-demo] 产物已确认是演示构建（命中标记：${result.matchedMarkers.join(" / ")}）`);
