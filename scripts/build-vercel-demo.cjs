#!/usr/bin/env node
/**
 * Vercel 预览站的构建入口（`vercel.json` 的 `buildCommand` 指向这里）。
 *
 * 为什么不是直接把 `npm run worker:build` 当构建命令：
 * 演示开关原先只写在 `vercel.json` 的 `build.env` 里，而该字段已被 Vercel 标记
 * deprecated，Git 集成触发的预览构建不保证注入。开关一丢，产物就变成需要
 * `ADMIN_TOKEN` 的正式管理端，预览站首屏直接是登录页。
 *
 * 流程本身在 scripts/lib/vercel-demo-runner.cjs（有单测覆盖）：
 * 1. 子进程环境里强制 `VITE_SUBBOOST_DEMO=1`；
 * 2. 构建后校验产物里的演示标记，缺失就以非零码退出——让部署失败，
 *    而不是静默发出一份需要 token 的站点。
 *
 * 逃生阀：显式 `VITE_SUBBOOST_DEMO=0` / `false` 时按正式构建走，同时跳过断言
 * （仅用于以后真要在 Vercel 上托管正式管理端的场景）。
 */
const { resolve } = require("node:path");

const { runVercelDemoBuild } = require("./lib/vercel-demo-runner.cjs");

const rootDir = resolve(__dirname, "..");
const { code } = runVercelDemoBuild({
  rootDir,
  distDir: resolve(rootDir, "worker", "dist"),
});

process.exit(code);
