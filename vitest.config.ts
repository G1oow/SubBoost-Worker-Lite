import { defineConfig } from "vitest/config";
import path from "node:path";
import { transformWithOxc } from "vite";

function tsxTransformPlugin() {
  return {
    name: "subboost-public-vitest-tsx-transform",
    enforce: "pre" as const,
    async transform(code: string, id: string) {
      const filePath = id.split("?")[0].replace(/\\/g, "/");
      if (!filePath.endsWith(".tsx")) return null;

      return transformWithOxc(code, id, {
        jsx: {
          runtime: "automatic",
          importSource: "react",
        },
        sourcemap: true,
      });
    },
  };
}

export default defineConfig({
  plugins: [tsxTransformPlugin()],
  // 单测默认不是演示构建；演示相关代码用显式传入的常量走各自分支
  define: {
    __SUBBOOST_DEMO__: "false",
  },
  test: {
    environment: "node",
    setupFiles: ["./test/setup-runtime.ts"],
    include: [
      "packages/core/src/**/*.test.ts",
      "packages/server-core/src/**/*.test.ts",
      "packages/ui/src/**/*.test.ts",
      "test/regression/tooling/**/*.test.ts",
      "worker/src/**/*.test.ts",
      "worker/ui/src/**/*.test.ts",
    ],
    restoreMocks: true,
  },
  resolve: {
    alias: {
      "@subboost/core": path.resolve(__dirname, "packages/core/src"),
      "@subboost/server-core": path.resolve(__dirname, "packages/server-core/src"),
      "@subboost/ui": path.resolve(__dirname, "packages/ui/src"),
    },
  },
});
