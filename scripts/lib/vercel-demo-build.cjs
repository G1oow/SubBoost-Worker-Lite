#!/usr/bin/env node
/**
 * Vercel 预览站构建的共用逻辑（纯函数，供 scripts/build-vercel-demo.cjs 与单测复用）。
 *
 * 两件事：
 * 1. `ensureDemoEnv`：把演示开关写死进构建环境，不再依赖 Vercel 控制台或
 *    `vercel.json` 里已弃用的 `build.env`；
 * 2. `assertDemoArtifacts`：构建完成后校验产物里确实带着演示代码，
 *    对不上就让构建失败——宁可部署失败，也不静默发出一份需要 token 的站点。
 */
const { existsSync, readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

/** 演示构建必然出现在产物里的标记：内存后端的固定口令 + 演示提示条文案 */
const DEMO_MARKERS = ["demo-preview-token", "演示模式"];

const FALSY = new Set(["0", "false"]);

/**
 * 计算 Vercel 构建要用的环境变量。
 * 除显式 `VITE_SUBBOOST_DEMO=0/false`（逃生阀）外一律强制为 1。
 */
function ensureDemoEnv(env = process.env) {
  const raw = typeof env.VITE_SUBBOOST_DEMO === "string" ? env.VITE_SUBBOOST_DEMO : "";
  const forced = !FALSY.has(raw.trim().toLowerCase());
  const next = { ...env };
  if (forced) next.VITE_SUBBOOST_DEMO = "1";
  return { env: next, forced };
}

/**
 * 汇总产物目录里所有 JS 的文本，用于标记断言。
 * `deps` 可注入，方便单测用内存实现替代文件系统。
 */
function collectArtifactText(distDir, deps = {}) {
  const fs = {
    existsSync: deps.existsSync ?? existsSync,
    readdirSync: deps.readdirSync ?? readdirSync,
    readFileSync: deps.readFileSync ?? readFileSync,
  };
  const assetsDir = join(distDir, "assets");
  if (!fs.existsSync(assetsDir)) {
    return { ok: false, reason: `产物目录不存在：${assetsDir}（构建是否成功？断言是否需随产物结构调整？）`, text: "" };
  }
  const files = fs.readdirSync(assetsDir).filter((name) => name.endsWith(".js"));
  if (files.length === 0) {
    return { ok: false, reason: `产物目录里没有 JS 文件：${assetsDir}`, text: "" };
  }
  const text = files.map((name) => fs.readFileSync(join(assetsDir, name), "utf8")).join("\n");
  return { ok: true, text };
}

/**
 * 校验产物是不是演示构建。
 * 返回 `{ ok, missingMarkers, reason?, matchedMarkers }`；缺任一标记即失败。
 */
function assertDemoArtifacts(distDir, deps = {}) {
  const collected = collectArtifactText(distDir, deps);
  if (!collected.ok) return { ok: false, missingMarkers: [...DEMO_MARKERS], reason: collected.reason };

  const missingMarkers = DEMO_MARKERS.filter((marker) => !collected.text.includes(marker));
  if (missingMarkers.length > 0) {
    return {
      ok: false,
      missingMarkers,
      matchedMarkers: DEMO_MARKERS.filter((marker) => collected.text.includes(marker)),
      reason:
        "产物里缺少演示标记，说明这次构建没有开启演示模式：" +
        `${missingMarkers.join(" / ")}。检查 VITE_SUBBOOST_DEMO 是否被设为 0，` +
        "以及 scripts/build-vercel-demo.cjs 是否仍是 Vercel 的 Build Command。",
    };
  }

  return { ok: true, missingMarkers: [], matchedMarkers: [...DEMO_MARKERS] };
}

module.exports = {
  DEMO_MARKERS,
  ensureDemoEnv,
  collectArtifactText,
  assertDemoArtifacts,
};
