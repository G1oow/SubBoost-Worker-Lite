#!/usr/bin/env node
/**
 * Vercel 预览站构建的编排逻辑（可注入依赖，供 scripts/build-vercel-demo.cjs 与单测复用）。
 *
 * 入口脚本只负责传仓库路径并退出，真正的流程放在这里，测试才能覆盖到
 * 「开关被强制执行」「构建失败」「产物断言失败」这些关键分支。
 */
const { spawnSync } = require("node:child_process");

const { ensureDemoEnv, assertDemoArtifacts } = require("./vercel-demo-build.cjs");

/**
 * 强制演示开关 → 跑 `npm run worker:build` → 校验产物。
 *
 * @param {{
 *   rootDir: string,
 *   distDir: string,
 *   env?: Record<string, string | undefined>,
 *   log?: (message: string) => void,
 *   warn?: (message: string) => void,
 *   error?: (message: string) => void,
 *   deps?: { spawnSync?: Function, assertDemoArtifacts?: Function },
 * }} options
 * @returns {{ code: number }}
 */
function runVercelDemoBuild(options) {
  const deps = options.deps ?? {};
  const spawn = deps.spawnSync ?? spawnSync;
  const assertArtifacts = deps.assertDemoArtifacts ?? assertDemoArtifacts;
  const log = options.log ?? console.log;
  const warn = options.warn ?? console.warn;
  const error = options.error ?? console.error;
  const env = options.env ?? process.env;

  const { env: buildEnv, forced } = ensureDemoEnv(env);
  if (forced) {
    log("[vercel-demo] 已在构建环境里强制 VITE_SUBBOOST_DEMO=1");
  } else {
    warn(
      "[vercel-demo] 检测到显式关闭（VITE_SUBBOOST_DEMO=0/false）：按正式构建执行，跳过演示产物断言"
    );
  }

  const build = spawn("npm", ["run", "worker:build"], {
    cwd: options.rootDir,
    env: buildEnv,
    stdio: "inherit",
    // Windows 下 npm 是 .cmd，必须走 shell 才能被执行；参数是固定字面量，无注入面
    shell: process.platform === "win32",
  });

  if (build.error) {
    error(`[vercel-demo] 调用 npm run worker:build 失败：${build.error.message}`);
    return { code: 1 };
  }
  if (build.status !== 0) {
    return { code: build.status ?? 1 };
  }
  if (!forced) {
    return { code: 0 };
  }

  const result = assertArtifacts(options.distDir);
  if (!result.ok) {
    error(`[vercel-demo] ${result.reason ?? "产物校验失败"}`);
    return { code: 1 };
  }

  log(`[vercel-demo] 产物已确认是演示构建（命中标记：${result.matchedMarkers.join(" / ")}）`);
  return { code: 0 };
}

module.exports = { runVercelDemoBuild };
