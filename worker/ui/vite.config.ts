import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_INIT_SCRIPT } from "../../packages/ui/src/theme/theme-init-script";

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
export default defineConfig({
  root: configDir,
  // 演示 / 预览站开关：构建时设 VITE_SUBBOOST_DEMO=1 打开。
  // 折叠成字面量常量，正式构建才能把演示代码整块摇掉。
  define: {
    __SUBBOOST_DEMO__: JSON.stringify(process.env.VITE_SUBBOOST_DEMO === "1"),
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

