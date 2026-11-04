import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config";

const coverageThresholds = {
  lines: 97,
  statements: 97,
  functions: 97,
  // 分支阈值 96：清理掉旧前端后，剩余代码以 core 解析/生成引擎为主，
  // 其真实分支覆盖约 96.2%，原 97% 是被大量 UI 代码摊平出来的。
  branches: 96,
} as const;

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ["test/**/*.test.ts"],
      coverage: {
        provider: "v8",
        include: [
          "packages/**/*.{ts,tsx,js,cjs,mjs}",
          "scripts/**/*.{ts,tsx,js,cjs,mjs}",
        ],
        exclude: [
          "**/*.{test,spec}.{ts,tsx,js,cjs,mjs}",
          "**/*.test-{helpers,utils}.{ts,tsx,js,cjs,mjs}",
          "**/*.d.ts",
          "**/node_modules/**",
          "**/.next/**",
          "**/dist/**",
          "**/build/**",
          "**/coverage/**",
          "**/.cache/**",
          "**/.turbo/**",
          "**/fixtures/**",
          "**/__fixtures__/**",
          "**/*.config.{ts,tsx,js,cjs,mjs}",
          "**/eslint.config.{ts,js,mjs}",
          "**/next.config.{ts,js,mjs}",
          "**/postcss.config.{ts,js,mjs}",
          "**/tailwind.config.{ts,js,mjs}",
          "**/generated/prisma/**",
          "**/prisma/generated/**",
          // 部署 CLI 是纯进程装配入口（spawn wrangler、读写文件），逻辑已抽到
          // scripts/lib/deploy-runner.cjs 并被完整覆盖；入口本身由 dry-run 手测覆盖。
          "scripts/deploy-worker.cjs",
          // Vercel 预览站构建入口同理：流程在 scripts/lib/vercel-demo-runner.cjs 并被完整覆盖，
          // 入口只负责传仓库路径、退出，产物由部署日志里的断言信息兜住。
          "scripts/build-vercel-demo.cjs",
        ],
        reporter: ["text", "json-summary", "html", "lcov"],
        reportsDirectory: "coverage",
        thresholds: coverageThresholds,
      },
    },
  }),
);
