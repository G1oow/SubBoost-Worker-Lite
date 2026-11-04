import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_INIT_SCRIPT } from "../../packages/ui/src/theme/theme-init-script";
import { resolveDemoMode } from "./src/lib/demo-mode";

// 把共享主题初始化脚本注入 index.html，保证与 packages/ui 单一来源
function themeInitPlugin() {
  return {
    name: "subboost-worker-theme-init",
    transformIndexHtml(html: string) {
      return html.replace("<!--THEME_INIT-->", `<script>${THEME_INIT_SCRIPT}</script>`);
    },
  };
}

const configDir = path.dirname(fileURLToPath(import.meta.url));

// 演示 / 预览站开关：判定逻辑集中在 src/lib/demo-mode.ts（Vercel 构建环境即使
// 没拿到 VITE_SUBBOOST_DEMO 也按演示构建，避免预览站退化成需 token 的正式版）。
// 折叠成字面量常量，正式构建才能把演示代码整块摇掉。
const demoMode = resolveDemoMode(process.env);
console.log(`[subboost] 演示构建：${demoMode ? "已开启" : "已关闭"}`);

export default defineConfig({
  root: configDir,
  define: {
    __SUBBOOST_DEMO__: JSON.stringify(demoMode),
  },
  plugins: [react(), tailwindcss(), themeInitPlugin()],
  resolve: {
    alias: {
      "@subboost/ui": path.resolve(configDir, "../../packages/ui/src"),
      "@subboost/core": path.resolve(configDir, "../../packages/core/src"),
      "@subboost/server-core": path.resolve(configDir, "../../packages/server-core/src"),
    },
  },
  build: {
    outDir: path.resolve(configDir, "../dist"),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/sub": "http://127.0.0.1:8787",
    },
  },
});

