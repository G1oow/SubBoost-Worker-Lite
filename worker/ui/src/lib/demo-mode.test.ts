import { describe, expect, it } from "vitest";
import { resolveDemoMode } from "./demo-mode";

/**
 * 预览站开关的判定回归。
 *
 * 这里守的是「Vercel 上任何一次构建都不会退化成需要 token 的正式管理端)：
 * 这里守的是「Vercel 上任何一次构建都不会退化成需要 token 的正式管理端」：
 * Build Command，只要构建发生在 Vercel 容器里（`VERCEL=1`），就必须是演示构建。
 */
describe("resolveDemoMode", () => {
  it("显式 VITE_SUBBOOST_DEMO=1 时开启，与是否在 Vercel 上无关", () => {
    expect(resolveDemoMode({ VITE_SUBBOOST_DEMO: "1" })).toBe(true);
    expect(resolveDemoMode({ VITE_SUBBOOST_DEMO: "1", VERCEL: "1" })).toBe(true);
    expect(resolveDemoMode({ VITE_SUBBOOST_DEMO: "true" })).toBe(true);
    expect(resolveDemoMode({ VITE_SUBBOOST_DEMO: " TRUE " })).toBe(true);
  });

  it("显式关闭是唯一逃生阀，优先级高于 Vercel 环境", () => {
    expect(resolveDemoMode({ VITE_SUBBOOST_DEMO: "0" })).toBe(false);
    expect(resolveDemoMode({ VITE_SUBBOOST_DEMO: "0", VERCEL: "1" })).toBe(false);
    expect(resolveDemoMode({ VITE_SUBBOOST_DEMO: "false", VERCEL: "1" })).toBe(false);
  });

  it("Vercel 构建环境里没拿到开关时仍按演示构建", () => {
    expect(resolveDemoMode({ VERCEL: "1" })).toBe(true);
    expect(resolveDemoMode({ VERCEL: "1", CI: "1", NODE_ENV: "production" })).toBe(true);
  });

  it("本地、CI 与 Cloudflare 构建保持正式构建", () => {
    expect(resolveDemoMode({})).toBe(false);
    expect(resolveDemoMode({ CI: "1" })).toBe(false);
    expect(resolveDemoMode({ NODE_ENV: "production" })).toBe(false);
    expect(resolveDemoMode({ VERCEL: "0" })).toBe(false);
  });

  it("无法识别的取值不改变默认行为", () => {
    expect(resolveDemoMode({ VITE_SUBBOOST_DEMO: "" })).toBe(false);
    expect(resolveDemoMode({ VITE_SUBBOOST_DEMO: "yes" })).toBe(false);
    expect(resolveDemoMode({ VITE_SUBBOOST_DEMO: "", VERCEL: "1" })).toBe(true);
    expect(resolveDemoMode({ VITE_SUBBOOST_DEMO: "yes", VERCEL: "1" })).toBe(true);
  });
});
