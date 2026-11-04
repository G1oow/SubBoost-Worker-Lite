/// <reference types="vite/client" />

declare module "*.css";

// 构建期常量：由 vite.config.ts 的 define 注入，true 表示这是演示/预览构建。
// 用常量而不是 import.meta.env 查询，是为了让非演示构建能把演示代码真正摇掉。
declare const __SUBBOOST_DEMO__: boolean;
