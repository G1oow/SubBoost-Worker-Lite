import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

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

/** 真实文件系统测试用到的临时目录，结束时统一清理 */
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

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

describe("collectArtifactText", () => {
  it("assets 里没有 JS 时给出明确原因", () => {
    const result = vercelDemo.collectArtifactText(DIST, fakeFs({}));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("没有 JS 文件");
  });
});

describe("runVercelDemoBuild", () => {
  const runner = requireCjs("../../../scripts/lib/vercel-demo-runner.cjs") as {
    runVercelDemoBuild: (options: {
      rootDir: string;
      distDir: string;
      env?: Record<string, string | undefined>;
      log?: (message: string) => void;
      warn?: (message: string) => void;
      error?: (message: string) => void;
      deps?: { spawnSync?: (cmd: string, args: string[], opts: unknown) => unknown; assertDemoArtifacts?: (dir: string) => unknown };
    }) => { code: number };
  };

  const baseOptions = {
    rootDir: repoRoot,
    distDir: DIST,
  };

  function makeDeps(build: unknown, assertion: unknown = { ok: true, matchedMarkers: ["demo-preview-token", "演示模式"] }) {
    const calls: { spawn: Array<{ cmd: string; args: string[]; opts: any }>; assert: string[] } = {
      spawn: [],
      assert: [],
    };
    return {
      calls,
      deps: {
        spawnSync: (cmd: string, args: string[], opts: any) => {
          calls.spawn.push({ cmd, args, opts });
          return build;
        },
        assertDemoArtifacts: (dir: string) => {
          calls.assert.push(dir);
          return assertion;
        },
      },
    };
  }

  it("强制演示开关、跑构建并在产物校验通过后返回 0", () => {
    const { deps, calls } = makeDeps({ status: 0 });
    const logs: string[] = [];
    const result = runner.runVercelDemoBuild({
      ...baseOptions,
      env: { VERCEL: "1" },
      log: (message) => logs.push(message),
      deps,
    });

    expect(result.code).toBe(0);
    expect(calls.spawn[0].cmd).toBe("npm");
    expect(calls.spawn[0].args).toEqual(["run", "worker:build"]);
    expect(calls.spawn[0].opts.env.VITE_SUBBOOST_DEMO).toBe("1");
    expect(calls.spawn[0].opts.cwd).toBe(repoRoot);
    expect(calls.assert).toEqual([DIST]);
    expect(logs.some((line) => line.includes("产物已确认是演示构建"))).toBe(true);
  });

  it("显式关闭时按正式构建跑，且不校验演示产物", () => {
    const { deps, calls } = makeDeps({ status: 0 });
    const warns: string[] = [];
    const result = runner.runVercelDemoBuild({
      ...baseOptions,
      env: { VITE_SUBBOOST_DEMO: "0" },
      warn: (message) => warns.push(message),
      deps,
    });

    expect(result.code).toBe(0);
    expect(calls.spawn[0].opts.env.VITE_SUBBOOST_DEMO).toBe("0");
    expect(calls.assert).toEqual([]);
    expect(warns[0]).toContain("显式关闭");
  });

  it("构建进程启动失败时返回 1", () => {
    const { deps } = makeDeps({ error: new Error("spawn npm ENOENT") });
    const errors: string[] = [];
    const result = runner.runVercelDemoBuild({
      ...baseOptions,
      env: {},
      error: (message) => errors.push(message),
      deps,
    });

    expect(result.code).toBe(1);
    expect(errors[0]).toContain("spawn npm ENOENT");
  });

  it("构建以非零码结束时原样返回该退出码", () => {
    const { deps, calls } = makeDeps({ status: 2 });
    const result = runner.runVercelDemoBuild({ ...baseOptions, env: {}, deps });

    expect(result.code).toBe(2);
    expect(calls.assert).toEqual([]);
  });

  it("产物不是演示构建时返回 1 并打印原因", () => {
    const { deps } = makeDeps({ status: 0 }, { ok: false, reason: "产物里缺少演示标记", missingMarkers: ["演示模式"] });
    const errors: string[] = [];
    const result = runner.runVercelDemoBuild({
      ...baseOptions,
      env: {},
      error: (message) => errors.push(message),
      deps,
    });

    expect(result.code).toBe(1);
    expect(errors[0]).toContain("产物里缺少演示标记");
  });

  it("断言失败但没给原因时用兜底文案", () => {
    const { deps } = makeDeps({ status: 0 }, { ok: false, missingMarkers: [] });
    const errors: string[] = [];
    const result = runner.runVercelDemoBuild({
      ...baseOptions,
      env: {},
      error: (message) => errors.push(message),
      deps,
    });

    expect(result.code).toBe(1);
    expect(errors[0]).toContain("产物校验失败");
  });
});

describe("assertDemoArtifacts 走真实文件系统", () => {
  it("读取实际产物目录并在标记齐全时通过", () => {
    const dir = mkdtempSync(join(tmpdir(), "subboost-vercel-demo-"));
    roots.push(dir);
    mkdirSync(join(dir, "assets"), { recursive: true });
    writeFileSync(join(dir, "assets", "index-abc.js"), 'authorization: "demo-preview-token"');
    writeFileSync(join(dir, "assets", "demo-def.js"), "演示模式 · 数据只存在浏览器内存");
    writeFileSync(join(dir, "assets", "index-abc.css"), "body{}");

    const result = vercelDemo.assertDemoArtifacts(dir);
    expect(result.ok).toBe(true);
    expect(result.missingMarkers).toEqual([]);
  });

  it("目录不存在时不会抛异常，而是返回可读原因", () => {
    const dir = mkdtempSync(join(tmpdir(), "subboost-vercel-demo-"));
    roots.push(dir);

    const result = vercelDemo.assertDemoArtifacts(join(dir, "missing"));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("产物目录不存在");
  });
});
