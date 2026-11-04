import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const requireCjs = createRequire(import.meta.url);
const vercelDemo = requireCjs("../../../scripts/lib/vercel-demo-build.cjs") as {
  DEMO_MARKERS: string[];
  ensureDemoEnv: (env?: Record<string, string | undefined>) => {
    env: Record<string, string | undefined>;
    forced: boolean;
  };
  collectArtifactText: (
    distDir: string,
    deps?: Record<string, unknown>
  ) => { ok: boolean; reason?: string; text: string };
  assertDemoArtifacts: (
    distDir: string,
    deps?: Record<string, unknown>
  ) => { ok: boolean; reason?: string; missingMarkers: string[]; matchedMarkers?: string[] };
};

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const DIST = join(repoRoot, "worker", "dist");

/** 内存文件系统替身：只实现断言用到的三个方法 */
function fakeFs(files: Record<string, string>, options: { hasAssets?: boolean } = {}) {
  const names = Object.keys(files);
  return {
    existsSync: (target: string) => (options.hasAssets === false ? false : target.endsWith("assets")),
    readdirSync: () => names,
    readFileSync: (target: string) => {
      const name = names.find((item) => target.endsWith(item));
      if (!name) throw new Error(`未预期的读取：${target}`);
      return files[name];
    },
  };
}

describe("ensureDemoEnv", () => {
  it("没有显式开关时强制 VITE_SUBBOOST_DEMO=1", () => {
    const { env, forced } = vercelDemo.ensureDemoEnv({ VERCEL: "1", PATH: "/usr/bin" });
    expect(forced).toBe(true);
    expect(env.VITE_SUBBOOST_DEMO).toBe("1");
    expect(env.VERCEL).toBe("1");
    expect(env.PATH).toBe("/usr/bin");
  });

  it("显式设为 0/false 时保留原值并跳过强制", () => {
    for (const value of ["0", "false", " FALSE "]) {
      const { env, forced } = vercelDemo.ensureDemoEnv({ VITE_SUBBOOST_DEMO: value });
      expect(forced).toBe(false);
      expect(env.VITE_SUBBOOST_DEMO).toBe(value);
    }
  });

  it("已有其它取值时仍然强制为 1，不依赖外部配置", () => {
    const { env, forced } = vercelDemo.ensureDemoEnv({ VITE_SUBBOOST_DEMO: "" });
    expect(forced).toBe(true);
    expect(env.VITE_SUBBOOST_DEMO).toBe("1");
  });

  it("不修改传入的环境对象", () => {
    const source: Record<string, string | undefined> = {};
    vercelDemo.ensureDemoEnv(source);
    expect(source).toEqual({});
  });
});

describe("assertDemoArtifacts", () => {
  it("产物命中全部演示标记时通过", () => {
    const result = vercelDemo.assertDemoArtifacts(
      DIST,
      fakeFs({
        "index-abc.js": 'headers.set("authorization","demo-preview-token")',
        "demo-def.js": "演示模式 · 数据只存在浏览器内存",
      })
    );
    expect(result.ok).toBe(true);
    expect(result.missingMarkers).toEqual([]);
    expect(result.matchedMarkers).toEqual(vercelDemo.DEMO_MARKERS);
  });

  it("产物是正式构建时失败并指出缺失标记", () => {
    const result = vercelDemo.assertDemoArtifacts(
      DIST,
      fakeFs({ "index-abc.js": "请输入管理访问 token 以继续" })
    );
    expect(result.ok).toBe(false);
    expect(result.missingMarkers).toEqual(vercelDemo.DEMO_MARKERS);
    expect(result.reason).toContain("没有开启演示模式");
  });

  it("只缺一个标记也算失败", () => {
    const result = vercelDemo.assertDemoArtifacts(
      DIST,
      fakeFs({ "index-abc.js": 'authorization: "demo-preview-token"' })
    );
    expect(result.ok).toBe(false);
    expect(result.missingMarkers).toEqual(["演示模式"]);
  });

  it("产物目录缺失时给出可诊断的原因", () => {
    const result = vercelDemo.assertDemoArtifacts(DIST, fakeFs({}, { hasAssets: false }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("产物目录不存在");
  });
});

describe("vercel.json 部署配置", () => {
  const config = JSON.parse(readFileSync(join(repoRoot, "vercel.json"), "utf8")) as Record<
    string,
    unknown
  >;

  it("构建命令走自包含的演示构建脚本", () => {
    // 演示开关必须由仓库强制，不能退回「靠 vercel.json 的 build.env / 控制台环境变量」
    expect(config.buildCommand).toBe("node scripts/build-vercel-demo.cjs");
  });

  it("不再依赖已弃用的 build.env", () => {
    expect(config).not.toHaveProperty("build");
  });

  it("静态产物目录与 SPA 回退保持不变", () => {
    expect(config.outputDirectory).toBe("worker/dist");
    expect(Array.isArray(config.rewrites)).toBe(true);
  });
});
