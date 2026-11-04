# SubBoost Worker Lite 构建手册（Build）

| 项目 | 内容 |
| --- | --- |
| 文档角色 | 执行手册：文件变更清单、任务拆分、接口契约、验证与验收跟踪 |
| 设计依据 | [cf-worker-lite-plan.md](./cf-worker-lite-plan.md)（简称 Plan） |
| 基线提交 | `a7177d7`（main，工作区干净） |
| 编写日期 | 2026-10-12 |

> 本手册假设执行者没有参与此前任何讨论，只有当前代码库与这两份文档。所有「为什么」见 Plan，本手册只回答「做什么、怎么做、如何验证」。

---

## 1. 执行前须知

### 1.1 目标与范围

在仓库根目录新增 workspace `worker/`，交付一个运行在 Cloudflare Workers + KV 上的精简版 SubBoost：聚合上游订阅、生成 Clash/Mihomo 订阅链接、管理端 token 鉴权、每 12 小时 Cron 刷新、订阅防泄漏。功能边界以 Plan 第 1.4 与 1.5 节为准。

### 1.2 相关模块当前位置

| 用途 | 位置 |
| --- | --- |
| 节点解析入口 | `packages/core/src/parser/index.ts`（`parseSubscription`） |
| YAML 生成入口 | `packages/core/src/generator/index.ts`（`generateClashYaml`，第 599 行） |
| 配置转生成选项 | `packages/core/src/subscription/config-utils.ts`（`buildGenerateOptionsFromConfig`，第 272 行） |
| 默认配置 | `packages/core/src/config/defaults.ts`（`buildDefaultUserConfig`） |
| 节点去重键 | `packages/core/src/node-identity.ts`（`buildNodeContentKey`、`stableJsonStringify`） |
| 订阅响应头 | `packages/server-core/src/subscription/response-headers.ts` |
| 错误体 | `packages/server-core/src/http.ts` |
| 默认 UA 列表 | `packages/server-core/src/subscription/user-agents.ts` |
| UI 基础组件 | `packages/ui/src/components/ui/*.tsx` |
| 主题与样式 | `packages/ui/src/theme/*.ts`、`packages/ui/src/styles/globals.css` |
| 现有订阅生成参考 | `local/src/lib/subscription-service.ts` 第 433 到 455 行 |
| 现有公开端点参考 | `local/app/api/subscriptions/[id]/config.yaml/route.ts` |
| 现有安全头清单 | `local/next.config.mjs` |
| 现有登录页视觉参考 | `local/src/components/local-login.tsx` |

### 1.3 前置条件

- Node 版本满足根 `package.json` 的 `engines`：`>=22.13.0 <23 || >=24.0.0`。
- Windows 上运行根测试需要 Git for Windows（`test/setup-runtime.ts` 会查找 `bash.exe`）。
- 拥有 Cloudflare 账号；本地已执行 `npx wrangler login`（部署与远程 KV 操作需要；纯单元测试不需要）。
- 依赖安装与新依赖引入需用户确认（见 Task 0.2）。

### 1.4 项目命令（已核实于根 `package.json` 与 CI）

| 命令 | 作用 |
| --- | --- |
| `npm ci` | 安装依赖（CI 使用） |
| `npm run lint` | `eslint local packages --max-warnings=0 && npm run check:ui-consistency`；本任务会把 `worker` 加入两者 |
| `npm run test:unit` | `vitest run`，使用根 `vitest.config.ts` |
| `npm run test:unit -- worker` | 只运行路径含 `worker` 的测试（vitest 路径过滤） |
| `npm run test:coverage` | CI 使用 |
| `npm run check:local-app` | `local/` 应用的 lint、typecheck、build；本任务不应改变其结果 |
| `npm run worker:typecheck` | 本任务新增，见 Task 0.4 |
| `npm run worker:build` / `worker:dev` / `worker:deploy` | 本任务新增 |

### 1.5 不允许修改的文件

- `local/**`
- `packages/core/**`、`packages/server-core/**`、`packages/ui/**`
- `prisma/**`、`local/Dockerfile`、`local/docker-compose*.yml`
- `.github/workflows/**`
- `README.md`、`README-CN.md`（如需指引，只在 `worker/README.md` 中写）

允许修改的根文件及范围：`package.json`（仅 `workspaces` 与 `scripts`）、`vitest.config.ts`（仅 `test.include`）、`.gitignore`（仅追加）、`eslint.config.mjs`（仅在 U4 触发时追加一个作用域覆盖块）。

### 1.6 识别与保护已有本地修改

开工前执行：

```bash
git status --porcelain
git stash list
```

- 若输出非空，停止并向用户确认，不得 stash、reset 或 checkout 覆盖。
- 文档编写时的基线：工作区干净，HEAD 为 `a7177d7`。
- 文档编写时 `node_modules` 未安装，因此没有基线测试结果；Task 0.1 必须先补录。

### 1.7 冲突记录

执行中若发现本手册与 Plan 或代码库事实冲突，在此登记：

| 日期 | 冲突 | 影响 | 处理 |
| --- | --- | --- | --- |
| 2026-10-12 | `@cloudflare/workers-types` 放入 tsconfig `types` 会与 `packages/core`（TextDecoder/URLSearchParams）产生类型冲突，且新版包已无 `2023-07-01` 子路径类型入口（Plan U10/K13） | worker typecheck 失败 | 按 Plan U10 允许的最小 `declare` 方案：`worker/src/env.d.ts` 内自声明 `KVNamespace`/`Fetcher`/`ExecutionContext`/`ScheduledController`/`Env`，tsconfig `types` 仅保留 `node`，不改动 `packages/core` |
| 2026-10-12 | Vite 8 默认 `bundle` 配置加载器无法在 Node ESM 下解析 `@subboost/ui` 裸包路径（Plan U2 的变体） | `npm run worker:build` 失败 | `vite.config.ts` 改用 `import.meta.url` 推导路径，并把构建/开发脚本固定为 `--configLoader runner`；构建与冒烟均通过 |
| 2026-10-12 | `wrangler dev --test-scheduled` 的 `/__scheduled` 被 Static Assets 层先行接管，中间件不生效（Plan U8） | Cron 冒烟失败 | `worker/wrangler.jsonc` 的 `run_worker_first` 追加 `/__scheduled`；冒烟第 9/10 步通过，`meta:status.lastTrigger` 为 `cron` |
| 2026-10-12 | 本机 8787 端口被占用（bind 权限错误） | 冒烟无法在默认端口运行 | 改用 `--port 8899 --ip 127.0.0.1` 完成冒烟；不涉及代码变更 |
| 2026-10-12 | 计划中 `eslint.config.mjs` 仅允许 U4 触发时做 `@next/next/*` 作用域覆盖；实际 `eslint worker` 会扫描 `worker/dist`、`worker/.wrangler` 构建产物并报 16 个 error | 根 `npm run lint` 失败 | 在 `globalIgnores` 追加 `worker/dist/**`、`worker/.wrangler/**` 两行；未改动任何规则语义，`@next/next/*` 未对 `worker/**` 源码误报 |
| 2026-10-12 | 验收复核：`worker/ui/src/components/render.test.ts` 用 `createElement(AppShell, props, child)` 传 children，但 `AppShellProps.children` 为必填，UI 类型检查失败（交付时 `npm run worker:typecheck` 实际未通过） | 验收顺序第 2 步失败 | `children` 改为可选（与 `FormField` 等既有组件惯例一致），typecheck 通过 |
| 2026-10-12 | 验收复核：`buildDefaultUserConfig("standard")` 的 `dnsYaml` 为空串，生成器把任何字符串类型的 `dnsYaml` 视为显式基础配置并跳过默认 general 段，默认配置生成的 YAML 缺少 `mixed-port`/`dns` 等基础段，`PUT /api/config` 修改 `mixedPort` 不生效（AC7 实际未达成；原单测只用了不含 `dnsYaml` 的配置，未覆盖该路径） | 订阅输出质量下降，配置编辑失效 | `worker/src/pipeline.ts` 新增 `normalizeConfigForGeneration`（空白 `dnsYaml` 视为未提供，显式 YAML 保留覆盖语义）；新增 5 条回归测试；冒烟复核默认 `mixed-port: 7897` → 改 45678 生效 → 恢复默认回 7897 |
| 2026-10-12 | 验收复核：`wrangler dev` 本地模式出站 fetch 自动跟随 3xx（`redirect: "manual"` 不生效），`safe-fetch.ts` 的逐跳 SSRF 校验与 3 跳上限在本地不会触发；原冒烟中「长度 59」的错误实为 workerd 运行时网络错误，并非应用层拦截（Cloudflare 官方文档确认生产 Workers 将 3xx 原样返回给调用方） | AC9 的重定向部分本地无法验证 | 逐跳校验由 `safe-fetch.test.ts` 覆盖；`worker/README.md` 登记注意事项与部署后复核步骤（`httpbin.org/redirect/5` 源应报「重定向次数超过上限」） |
| 2026-10-12 | 验收复核：Static Assets 将 `/index.html` 307 到 `/`，`_headers` 中 `/index.html` 的 `Cache-Control: no-store` 规则不会命中真实页面（`/` 实际返回 `public, max-age=0, must-revalidate`） | 管理页 HTML 未按预期 no-store | 规则路径改为 `/` |
| 2026-10-12 | 验收复核：Windows 上重建时 `dist` 残留旧 `assets/*`（有进程持有文件句柄时 Node/Vite 的删除被推迟，`emptyOutDir` 看似未生效；Git Bash 的 `rm` 可正常删除） | 部署可能带上无引用的旧产物 | 本地环境现象，无代码改动；`worker/README.md` 登记处理方式（先停相关进程并手动清理 `dist` 再构建） |
| 2026-10-12 | 二次复核：本机 Git for Windows 安装在自定义路径 `D:\Git`，`test/setup-runtime.ts` 的 `findGitBashBin` 只检查 Program Files / LOCALAPPDATA / scoop 默认位置，找不到时直接抛错（PR 未解决问题「本机全量单测基线失败」在本环境的实际根因之一，此前表现为该文件超时/报「Git for Windows Bash is required」） | Windows 本机 shell 脚本套件无法运行 | `findGitBashBin` 追加兜底：用 `where.exe git` 定位 `git.exe` 并向上最多 3 级推导 `<git-root>\bin\bash.exe`；兜底仅在 win32 且默认位置未命中时生效，CI（Linux）不受影响 |
| 2026-10-12 | 二次复核：Git Bash 检测修复后，全量套件满载并行时该文件 rollback 用例仍超 vitest 默认 5s 单测超时（`spawnSync` 的 30s 尚未到期，测试先被 vitest 终止；单文件运行 7.4s 全过，仅并行满载下触发） | Windows 本机全量单测 1842/1844（2 个 rollback 用例超时） | `local/scripts/selfhost-lifecycle-shell.test.ts` 中三个 spawn bash 的用例加显式 `{ timeout: 60_000 }`（覆盖 `spawnSync` 30s 上限）；修复后全量 260 文件 / 1844 用例全绿（复核时 `wrangler dev` 保持运行，维持满载条件） |

---

## 2. 文件级变更清单

路径状态：`新建` 表示计划创建；`修改` 表示已存在且允许改动。所有「修改」路径已在代码库核实存在。

### 2.1 根配置

| 路径 | 状态 | 当前职责 | 变更 | 原因 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| `package.json` | 修改 | workspaces 与脚本 | `workspaces` 增加 `"worker"`；`scripts` 增加 `worker:dev`、`worker:dev:ui`、`worker:build`、`worker:deploy`、`worker:typecheck`；`lint` 改为 `eslint local packages worker --max-warnings=0 && npm run check:ui-consistency`；`check:ui-consistency` 改为 `node scripts/check-ui-consistency.cjs packages local worker` | 让 worker 进入工作区与质量门 | 无 |
| `vitest.config.ts` | 修改 | 根测试配置 | `test.include` 追加 `"worker/src/**/*.test.ts"` 与 `"worker/ui/src/**/*.test.ts"` | 白名单机制 | 无 |
| `.gitignore` | 修改 | 忽略规则 | 追加 `worker/.wrangler/`、`worker/.dev.vars`、`worker/dist/` | 本地状态与密钥不入库 | 无 |
| `eslint.config.mjs` | 条件修改 | lint 配置 | 仅当 Task 4.1 出现 `@next/next/*` 误报时追加 `{ files: ["worker/**"], rules: { "@next/next/no-img-element": "off" } }` 一类的最小覆盖 | U4 | 无 |

### 2.2 worker 包（全部新建）

| 路径 | 职责 | 依赖 |
| --- | --- | --- |
| `worker/package.json` | 包名 `@subboost/worker`，`private: true`，`type: module`，脚本与依赖 | 无 |
| `wrangler.jsonc`（仓库根） | Worker 名称、入口、兼容日期、KV 绑定、静态资源、Cron、vars、`previews`；放根目录以便 Workers Builds 默认命令零配置部署 | 无 |
| `worker/tsconfig.json` | Worker 代码类型检查（无 DOM lib，使用 workers-types） | `tsconfig.base.json`（仓库根） |
| `.dev.vars.example`（仓库根） | 本地密钥示例 | 无 |
| `worker/README.md` | 指向两份文档的简短说明与部署命令 | 无 |
| `worker/src/env.d.ts` | `Env` 接口 | `@cloudflare/workers-types` |
| `worker/src/types.ts` | 存储类型、DTO、常量（KV key 前缀、TTL、上限） | `@subboost/core/types/node` |
| `worker/src/errors.ts` | `ApiError` | 无 |
| `worker/src/http.ts` | `json`、`error`、`readJsonBody`、`withSecurityHeaders` | `@subboost/server-core/http`、errors |
| `worker/src/crypto.ts` | 加解密、哈希、随机 token、常量时间比较 | WebCrypto |
| `worker/src/ssrf.ts` | URL 校验 | 无 |
| `worker/src/safe-fetch.ts` | 受控 fetch | ssrf |
| `worker/src/store.ts` | KV 数据层 | crypto、types |
| `worker/src/sources.ts` | 单源刷新 | safe-fetch、`@subboost/core/parser` |
| `worker/src/pipeline.ts` | 刷新管线与订阅生成 | store、sources、`@subboost/core/*`、`@subboost/server-core/subscription/response-headers` |
| `worker/src/auth.ts` | 管理鉴权 | crypto、errors |
| `worker/src/router.ts` | 路由与 handler | 以上全部 |
| `worker/src/index.ts` | Worker 入口 | router、pipeline |
| `worker/src/test-utils/memory-kv.ts` | 内存 KV 假实现与 `ExecutionContext` 假实现 | 无 |
| `worker/src/*.test.ts` | 各模块单测（与源文件同目录） | vitest |

### 2.3 管理页（全部新建）

| 路径 | 职责 | 依赖 |
| --- | --- | --- |
| `worker/ui/index.html` | SPA 入口；`<html lang="zh-CN" data-theme="dark">`；`<head>` 内放置占位注释 `<!--THEME_INIT-->`，由 `vite.config.ts` 中的小插件在构建时替换为 `<script>` + `THEME_INIT_SCRIPT` 内容，保证与 `packages/ui` 单一来源 | `@subboost/ui/theme/theme-init-script` |
| `worker/ui/vite.config.ts` | Vite 配置：react 插件、tailwind 插件、别名、`build.outDir` 为 `../dist`、开发代理 | 无 |
| `worker/ui/tsconfig.json` | UI 类型检查（DOM lib，`jsx: react-jsx`） | `tsconfig.base.json`（仓库根） |
| `worker/ui/public/_headers` | 静态资源安全头（U3） | 无 |
| `worker/ui/src/main.tsx` | 挂载 React、`<Toaster />` | `@subboost/ui/components/ui/toaster` |
| `worker/ui/src/styles.css` | `@import "@subboost/ui/styles/globals.css";`（U2） | 无 |
| `worker/ui/src/app.tsx` | 根组件：token 门或工作台；hash 路由（`#/dashboard` 等）与页面切换、`/api/dashboard` 加载 | 下列组件 |
| `worker/ui/src/lib/admin-token.ts` | localStorage 读写 | 无 |
| `worker/ui/src/lib/api-client.ts` | 带 Bearer 的 fetch 封装（支持 GET/PUT/POST/PATCH/DELETE）、401 处理、错误读取 | `@subboost/ui/lib/utils` |
| `worker/ui/src/lib/format.ts` | 时间/时长/百分比/千分位格式化（纯函数） | 无 |
| `worker/ui/src/lib/use-animated-number.ts` | 数值补间 hook（仪表板计数动画） | react |
| `worker/ui/src/components/app-shell.tsx` | 顶栏（标题、刷新、主题切换、退出）+ 页面导航（滑动下划线、图标缩放、数量徽章） | `@subboost/ui/theme/theme` |
| `worker/ui/src/components/dashboard-panel.tsx` | 仪表板：健康徽章、统计卡、协议分布、源健康、提醒、快捷操作 | Card、Badge、Button、ProtocolBadge |
| `worker/ui/src/components/node-rename-editor.tsx` | 节点列表 + 逐节点改名（协议徽章、原名、还原、搜索） | Input、IconButton、ProtocolBadge |
| `worker/ui/src/components/token-gate.tsx` | token 输入页 | Button、FormField、PasswordField |
| `worker/ui/src/components/status-panel.tsx` | 最近刷新状态与「立即刷新」 | Button、Badge、Table |
| `worker/ui/src/components/sources-panel.tsx` | 源列表与编辑对话框；手动节点文本防抖解析出名称/协议并可就地改名；行内「节点」对话框可对已有快照改名 | Table、Dialog、Input、Textarea、Switch、Select、NodeRenameEditor |
| `worker/ui/src/components/subscriptions-panel.tsx` | 订阅列表、创建、修改所含源、复制、轮换、删除 | Table、Dialog、ConfirmDialog、Button |
| `worker/ui/src/components/config-panel.tsx` | 配置 JSON 编辑与重置 | Textarea、Button |
| `worker/ui/src/lib/*.test.ts` | `admin-token`、`api-client` 单测 | vitest |

---

## 3. 任务拆分与执行顺序

执行顺序即章节顺序。每个 Task 独立可验证；完成后勾选。

### Phase 0 准备

#### Task 0.1 记录基线

- [x] 执行 `git status --porcelain` 与 `git stash list`，确认为空；否则停止并询问。
- [x] 执行 `npm ci`。
- [x] 执行 `npm run test:unit`，把通过与失败数记录到本节下方。
- [x] 执行 `npm run lint`，记录结果。

完成条件：下方有基线记录。

基线记录：

```text
日期：2026-10-12
git HEAD：a7177d7（工作区仅 ?? docs/implementation/）
test:unit：246 passed / 1 failed（local/scripts/selfhost-lifecycle-shell.test.ts 的 rollback 场景超时，环境相关既有失败）
lint：通过（eslint local packages --max-warnings=0 + check-ui-consistency，322 files）
```

#### Task 0.2 依赖确认

- [x] 向用户出示并取得确认的新依赖清单（均只声明在 `worker/package.json`）：
  - devDependencies：`wrangler`（^4.149.0）、`@cloudflare/workers-types`（^5.20261011.1）、`vite`（^8.3.0，与锁文件现有 8.3.0 同大版本）、`@vitejs/plugin-react`（^6.1.2，见 Plan U1）、`@tailwindcss/vite`（^4.3.0）。
  - dependencies：`@subboost/core`、`@subboost/server-core`、`@subboost/ui`（均为 `file:../packages/...` 工作区引用，写法与 `local/package.json` 一致）、`react`、`react-dom`（与根版本一致 `^19.2.7`）、`lucide-react`（`^1.17.0`）。tsconfig 通过相对路径继承仓库根的 `tsconfig.base.json`。
- [x] 确认后再执行 Task 0.3。

完成条件：用户明确同意。

#### Task 0.3 创建 worker 包骨架并注册工作区

- [x] 创建 `worker/package.json`：

```json
{
  "name": "@subboost/worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "dev:ui": "vite --config ui/vite.config.ts",
    "build": "vite build --config ui/vite.config.ts",
    "deploy": "npm run build && wrangler deploy",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p ui/tsconfig.json"
  }
}
```

  依赖字段按 Task 0.2 填写。
- [x] 根 `package.json`：`workspaces` 追加 `"worker"`；`scripts` 追加：

```json
"worker:dev": "npm --workspace @subboost/worker run dev",
"worker:dev:ui": "npm --workspace @subboost/worker run dev:ui",
"worker:build": "npm --workspace @subboost/worker run build",
"worker:deploy": "npm --workspace @subboost/worker run deploy",
"worker:typecheck": "npm --workspace @subboost/worker run typecheck"
```

  并按第 2.1 节修改 `lint` 与 `check:ui-consistency`。
- [x] `.gitignore` 追加三行（见第 2.1 节）。
- [x] 执行 `npm install`，确认 `node_modules/@subboost/worker` 为指向 `worker/` 的链接。

完成条件：`npm ls @subboost/worker` 能列出该包；`git diff --stat` 只涉及 `package.json`、`package-lock.json`、`.gitignore`。

#### Task 0.4 wrangler 与 TypeScript 配置

- [x] 创建 `worker/wrangler.jsonc`：

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "subboost",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/sub/*", "/s/*"]
  },
  "kv_namespaces": [{ "binding": "SUBBOOST_KV", "id": "<真实 KV namespace id，见部署文档>" }],
  "triggers": { "crons": ["0 */12 * * *"] },
  "vars": { "APP_NAME": "SubBoost Lite" },
  "observability": { "enabled": true }
}
```

- [x] 创建 `worker/tsconfig.json`：`extends: "../tsconfig.base.json"`；`compilerOptions`：`lib: ["esnext"]`、`types: ["@cloudflare/workers-types/2023-07-01", "node"]`（`node` 是因为被 import 的 `packages/core/src/parser/base64.ts` 使用了 `Buffer`，见 Plan U10）、`jsx` 不设置、`paths` 复制根 `tsconfig.json` 的 `@subboost/*` 映射并把前缀改为 `../packages/...`；`include: ["src/**/*.ts"]`。
- [x] 创建 `worker/ui/tsconfig.json`：`extends` 同上；`lib: ["dom", "dom.iterable", "esnext"]`、`jsx: "react-jsx"`、同样的 `paths`（前缀 `../../packages/...`）；`include: ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts"]`。
- [x] 创建 `worker/src/env.d.ts`（契约见 4.1）。
- [x] 创建 `worker/.dev.vars.example`：

```text
ADMIN_TOKEN=replace-with-at-least-32-random-chars
ENCRYPTION_KEY=replace-with-at-least-32-random-chars
```

- [x] 创建占位 `worker/src/index.ts`，导出返回 404 的 `fetch` 与空的 `scheduled`，确保 `npm run worker:typecheck` 通过。

完成条件：`npm run worker:typecheck` 退出码 0。

### Phase 1 纯逻辑模块（TDD）

每个 Task 顺序：先写测试并确认失败，再实现到测试通过。测试在 Node 环境运行，依赖 Node 22+ 内建的 `crypto.subtle`、`fetch`、`Request`、`Response`、`AbortSignal.timeout`。

#### Task 1.1 `errors.ts` 与 `http.ts`

- [x] 测试 `worker/src/http.test.ts`：
  - `error(new ApiError(401, "UNAUTHORIZED", "Unauthorized"))` 返回状态 401、体 `{"error":"Unauthorized","code":"UNAUTHORIZED"}`、头 `cache-control: no-store`。
  - `readJsonBody` 对超过上限的 `content-length` 抛 `ApiError(413, "PAYLOAD_TOO_LARGE")`；对无 `content-length` 但流式超限同样抛；对非法 JSON 抛 `ApiError(400, "BAD_REQUEST")`；空体返回 `{}`。
- [x] 实现契约见 4.2。

完成条件：`npm run test:unit -- worker/src/http` 通过。

#### Task 1.2 `crypto.ts`

- [x] 测试 `worker/src/crypto.test.ts`：
  - 加密再解密得到原文；密文以 `v1:` 开头且三段。
  - 篡改密文任一字符后解密抛 `CryptoError`。
  - 用不同密钥解密抛 `CryptoError`。
  - `generateToken()` 长度 43 且只含 `[A-Za-z0-9_-]`；连续生成 100 次无重复。
  - `sha256Hex("abc")` 等于 `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`。
  - `timingSafeEqual("a","a")` 为 true，`("a","b")` 为 false，长度不同为 false。
- [x] 实现契约见 4.3。

完成条件：测试通过。

#### Task 1.3 `ssrf.ts`

- [x] 测试 `worker/src/ssrf.test.ts`：对 Plan F8 列出的每一类主机名、IPv4 段、IPv6 段至少一个样本断言 `ok === false`，并包含：`http://2130706433/`（URL 解析后为 `127.0.0.1`）、`http://[::ffff:10.0.0.1]/`、`http://user:pass@example.com/`、`ftp://example.com/`；对 `https://example.com/sub?token=x` 与 `http://1.1.1.1/` 断言 `ok === true`。
- [x] 实现契约见 4.4。

完成条件：测试通过。

#### Task 1.4 `safe-fetch.ts`

- [x] 测试 `worker/src/safe-fetch.test.ts`，通过注入 `fetchImpl` 模拟：
  - 302 到公网地址：跟随并返回最终响应；调用次数 2。
  - 302 到 `http://10.0.0.1/`：抛 `FetchBlockedError`，不发起第二次请求。
  - 连续 4 次 302：抛 `TooManyRedirectsError`。
  - 响应体超过 `maxBytes`：抛 `ResponseTooLargeError`，且对 reader 调用了 `cancel`。
  - 503 两次后 200：返回 200，共调用 3 次；404 不重试。
  - `fetchImpl` 抛出 `AbortError`：直接抛出不重试。
  - 请求头包含传入的 `User-Agent`，且 `redirect` 为 `"manual"`。
- [x] 实现契约见 4.5。退避等待通过可注入的 `sleep` 函数实现，测试中注入立即返回的函数。

完成条件：测试通过。

#### Task 1.5 `test-utils/memory-kv.ts` 与 `store.ts`

- [x] 实现 `MemoryKV`：支持 `get(key, "json"|"text")`、`put(key, value, { expirationTtl? })`、`delete`、`list({ prefix })`；记录每个 key 最近一次 `expirationTtl` 供断言。实现 `createExecutionContext()` 返回带 `waitUntil` 收集器的对象。
- [x] 测试 `worker/src/store.test.ts`：
  - `saveSources` 后 `meta:sources` 中 `payloadEnc` 以 `v1:` 开头；`listSources` 返回解密后的 `url`。
  - 删除源后对应 `nodes:<id>` 被删除。
  - `createSubscription` 写入 `meta:subs` 与 `tokidx:<hash>`；`findSubscriptionByToken(token)` 命中；`rotateSubscriptionToken` 后旧 token 查不到、新 token 查到。
  - `putSnapshot` 的 `expirationTtl` 为 604800；`putCache` 为 172800；`acquireLock` 为 600。
  - `getConfig` 在无记录时返回 `buildDefaultUserConfig("standard")` 且 `isDefault` 为 true。
- [x] 实现契约见 4.6。

完成条件：测试通过。

#### Task 1.6 `sources.ts`

- [x] 测试 `worker/src/sources.test.ts`：
  - remote 源返回 base64 的 `ss://` 链接列表：快照 `nodeCount > 0`，`userInfo` 来自 `subscription-userinfo: upload=1; download=2; total=3; expire=1900000000`。
  - remote 源返回 Clash YAML（`proxies:` 列表）：解析成功。
  - remote 源返回空字符串：返回 `{ ok: false, error }`，不产生快照。
  - manual 源文本含 2 条 `vmess://` 或 `trojan://` 链接：`nodeCount` 为 2。
  - 使用的 UA：源未指定时为 `SUBSCRIPTION_IMPORT_USER_AGENTS` 中以 `mihomo/` 开头的项；指定时为指定值。
  - 脱敏：对 `https://example.com/sub?token=secret` 返回 500 的源，失败结果的 `error` 字符串不包含 `secret`、`?`、`@`，长度不超过 200。
- [x] 实现契约见 4.7。

完成条件：测试通过。

#### Task 1.7 `pipeline.ts`

- [x] 测试 `worker/src/pipeline.test.ts`（使用 `MemoryKV` 与注入的 `fetchImpl`）：
  - 两个 remote 源各 2 个节点，其中 1 个节点内容完全相同：生成的 YAML 经 js-yaml 解析后 `proxies` 长度为 3。
  - 一个源返回 500 且已有历史快照：状态中该源 `ok` 为 false，`cache:<subId>` 仍包含历史快照节点。
  - 订阅 `sourceIds` 只含一个源：YAML 只含该源节点。
  - 修改 `meta:config` 的 `mixedPort` 后调用 `getOrGenerateSubscription`：返回的 `configHash` 变化且 YAML 含新端口。
  - 全部源无节点：`getOrGenerateSubscription` 返回 `{ kind: "no-nodes" }`。
  - 持锁时 `refreshAll` 返回 `{ skipped: "locked" }`。
  - 软截止：注入 `now` 使开始后即超过 12 分钟，第二个源不被抓取且状态记录 `deadline-exceeded`。
  - userinfo 聚合：两个 remote 源都带 `upload`、`download`、`total` 时，`info` 为三者分别求和、`expire` 取较小值；只有一个源带 userinfo 时 `info` 为 `null`；manual 源不参与判定。
- [x] 实现契约见 4.8。

完成条件：测试通过。

#### Task 1.8 `auth.ts`

- [x] 测试 `worker/src/auth.test.ts`：无头、错误 token、正确 token、`ADMIN_TOKEN` 缺失四种情况的状态码与错误码。
- [x] 实现契约见 4.9。

完成条件：测试通过。

### Phase 2 Worker 入口

#### Task 2.1 `router.ts`

- [x] 测试 `worker/src/router.test.ts`，构造 `Request` 与假 `Env`：
  - 路由表（见 4.10）每条路径的方法、鉴权与状态码。
  - `GET /sub/unknown` 返回 404 体 `Not found`；`HEAD` 同状态且无体。
  - `GET /sub/<token>` 成功时响应头包含 `profile-update-interval: 12`、`cache-control: no-store`、`x-content-type-options: nosniff`、`x-robots-tag: noindex`、`content-disposition` 含订阅名；不包含 `profile-web-page-url` 与 `plan-name`。
  - `PUT /api/sources` 提交 51 个源返回 400；提交 `http://127.0.0.1/` 返回 400 且消息指出序号。
  - 未知 `/api/x` 返回 404 JSON。
  - 所有 `/api/*` 响应含 `cache-control: no-store`。
- [x] 实现路由与 handler。

完成条件：测试通过。

#### Task 2.2 `index.ts`

- [x] 实现 `fetch(request, env, ctx)`：交给 router；捕获非 `ApiError` 异常返回 500 并 `console.error` 错误名与消息。
- [x] 实现 `scheduled(event, env, ctx)`：调用 `pipeline.refreshAll(..., { trigger: "cron" })`；异常只记录日志。
- [x] 非 `/api`、非 `/sub` 路径：`return env.ASSETS.fetch(request)`。
- [x] 测试 `worker/src/index.test.ts`：用 `MemoryKV` 与注入的 `fetchImpl` 调用导出的 `scheduled`，断言 `meta:status.lastTrigger` 为 `cron`；调用 `fetch` 访问 `/api/health` 得到 200；对抛出非 `ApiError` 的路由得到 500 且体为 `{"error":...,"code":"INTERNAL_ERROR"}`。
- [x] 执行 `npm run worker:typecheck`。

完成条件：typecheck 通过；`npm run test:unit -- worker` 全绿。

#### Task 2.3 本地冒烟（需要 `.dev.vars`）

- [x] 复制 `.dev.vars.example` 为仓库根的 `.dev.vars` 并填入随机值。
- [x] 先执行 `npm run worker:build`（此时 UI 可为空壳，确保 `worker/dist/index.html` 存在；若 Phase 3 未完成，可临时放置一个最小 `index.html`，并在 Phase 3 覆盖）。
- [x] 在 `worker/` 执行 `npx wrangler dev --test-scheduled`，按第 5.3 节的 curl 序列验证。

完成条件：第 5.3 节序列全部符合预期。

### Phase 3 管理页

#### Task 3.1 Vite 骨架与样式接入

- [x] 创建 `worker/ui/vite.config.ts`：

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@subboost/ui": path.resolve(__dirname, "../../packages/ui/src"),
      "@subboost/core": path.resolve(__dirname, "../../packages/core/src"),
    },
  },
  build: { outDir: path.resolve(__dirname, "../dist"), emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:8787", "/sub": "http://127.0.0.1:8787" } },
});
```

- [x] 创建 `worker/ui/index.html`：`<html lang="zh-CN" data-theme="dark">`，`<head>` 内第一行为占位注释 `<!--THEME_INIT-->`，`<div id="root">`，`<script type="module" src="/src/main.tsx">`。
- [x] 在 `vite.config.ts` 增加一个内联插件：`import { THEME_INIT_SCRIPT } from "../../packages/ui/src/theme/theme-init-script";`（配置文件由 Vite 自行打包，使用相对路径而非别名），`transformIndexHtml(html) { return html.replace("<!--THEME_INIT-->", `<script>${THEME_INIT_SCRIPT}</script>`); }`。这样主题初始化脚本与 `local/app/layout.tsx` 使用同一来源。
- [x] 创建 `worker/ui/src/styles.css`，内容为 `@import "@subboost/ui/styles/globals.css";`；若构建报错无法解析（Plan U2），改为相对路径。
- [x] 创建 `worker/ui/public/_headers`：

```text
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
/index.html
  Cache-Control: no-store
```

- [x] `main.tsx` 挂载 `<App />` 与 `<Toaster />`，引入 `./styles.css`。
- [x] 执行 `npm run worker:build`，确认 `worker/dist/index.html` 与 `assets/*.css` 生成且 CSS 中含 `--page` 等主题变量。

完成条件：构建成功；`wrangler dev` 下访问 `/` 显示空壳页面且暗色背景生效。

#### Task 3.2 token 门与 API 客户端

- [x] 测试 `worker/ui/src/lib/admin-token.test.ts`：读写清除 localStorage 键 `subboost-worker-admin-token`（用简单的内存 `Storage` 替身）。
- [x] 测试 `worker/ui/src/lib/api-client.test.ts`：请求头含 `Authorization: Bearer <token>`；收到 401 时调用 `onUnauthorized` 并抛错；非 2xx 时错误消息来自 `readApiErrorMessage`。
- [x] 实现 `admin-token.ts`、`api-client.ts`（契约见 4.11）。
- [x] 实现 `token-gate.tsx`：布局与 `local/src/components/local-login.tsx` 一致（居中卡片 `bg-ink/5 border border-ink/10 rounded-2xl p-6`），使用 `FormField` + `PasswordField` + `Button`；提交后调用 `GET /api/state` 验证，失败显示「访问 token 无效」。
- [x] 实现 `app.tsx`：无 token 渲染 `TokenGate`；有 token 渲染 `AppShell` 与五个页面（仪表板 / 源管理 / 订阅链接 / 刷新状态 / 生成配置），按 hash 路由切换并保存当前页；`/api/state` 成功后加载 `/api/dashboard`（失败降级）；`api-client` 的 `onUnauthorized` 清除 token 并回到门页。

完成条件：单测通过；浏览器中输入错误 token 显示错误，正确 token 进入工作台。

#### Task 3.3 页面与面板

- [x] `status-panel.tsx`：显示 `status.lastRunAt`、`lastTrigger`、每个源 ok/错误、每条订阅节点数；「立即刷新」调用 `POST /api/refresh`，409 时提示「刷新进行中」。
- [x] `sources-panel.tsx`：表格列：名称（含「已改名 N 个节点」）、类型、启用、最近节点数（来自 status，失败带徽章）、操作（节点 / 编辑 / 删除）；对话框编辑 `name`、`kind`、`url` 或 `manualText`、`userAgent`、`enabled`；手动源粘贴节点文本后 450ms 防抖调用 `POST /api/nodes/parse`，用 `NodeRenameEditor` 列出协议徽章 + 原名并可就地改名；行内「节点」按钮调用 `GET /api/sources/:id/nodes` 打开改名对话框；保存均通过 `PUT /api/sources` 提交完整列表（携带 `nodeRenames`）。
- [x] `subscriptions-panel.tsx`：表格列：名称、所含源（源名 chip，空为「全部启用源」）、链接（截断显示 + 复制按钮）、操作（修改 / 轮换 / 删除，轮换与删除均经 `ConfirmDialog`）；创建与修改共用对话框（名称 + 源多选），修改调用 `PATCH /api/subscriptions/:id` 并保持链接不变。
- [x] `config-panel.tsx`：`Textarea` 展示 `JSON.stringify(config, null, 2)`；保存前本地 `JSON.parse` 校验，失败提示；「恢复默认」调用 `DELETE /api/config`。
- [x] `dashboard-panel.tsx`：健康徽章 + 最近刷新摘要；4 张统计卡（`useAnimatedNumber` 计数补间）；协议分布（`animate-bar-grow` 进度条）；源健康列表；提醒（刷新失败 / 无快照 / 生成失败）；快捷操作跳转。
- [x] `app-shell.tsx`：标题取 `state.app.name`；顶栏「刷新」调用 `POST /api/refresh`；页面导航带滑动下划线与数量徽章；主题切换按钮调用 `applyTheme` 与 `persistTheme`；「退出」清除 token。
- [x] 动效：`packages/ui/src/styles/globals.css` 提供 `pageIn`/`rise`/`popIn`/`fadeInUp`/`shimmer`/`barGrow`/`float`/`badgePulse` 与 `stagger-1..8`、`hover-lift`、`skeleton` 工具类，并在 `prefers-reduced-motion: reduce` 下关闭动画。
- [x] 所有颜色类只用 theme.css 令牌（`text-fg`、`text-fg-60`、`bg-surface`、`border-ink/10` 等）；图标用 `lucide-react`。
- [x] 执行 `npm run lint`（含 `check-ui-consistency`）确保无告警。

完成条件：浏览器中完成「添加源 → 创建订阅 → 复制链接 → 立即刷新 → 用 curl 取得 YAML」全流程。

### Phase 4 质量与收尾

#### Task 4.1 全量检查

- [x] `npm run lint`；若出现 `@next/next/*` 对 `worker/**` 的误报，按第 2.1 节追加最小覆盖并记录到 1.7 冲突记录。
- [x] `npm run worker:typecheck`。
- [x] `npm run test:unit`（全量，不只 worker）。
- [x] `npm run check:local-app`，结果应与 Task 0.1 基线一致。
- [x] `git status --porcelain` 中不含 `local/`、`packages/` 路径。

完成条件：全部通过。

#### Task 4.2 文档与交付

- [x] 编写 `worker/README.md`：一句话定位、指向两份文档、首次部署命令（第 5.4 节）、本地开发命令。
- [x] 把本手册中所有复选框更新为实际状态；在 1.7 登记所有冲突与假设。

完成条件：第 7 节验收全部勾选。

---

## 4. 实现细节与接口契约

### 4.1 `env.d.ts`

```ts
interface Env {
  SUBBOOST_KV: KVNamespace;
  ASSETS: Fetcher;
  ADMIN_TOKEN?: string;      // Secret
  ENCRYPTION_KEY?: string;   // Secret
  APP_NAME?: string;         // var，缺省 "SubBoost Lite"
  DEFAULT_USER_AGENT?: string; // var，缺省见 4.7
}
```

### 4.2 `errors.ts` 与 `http.ts`

```ts
export type ApiErrorCode =
  | "BAD_REQUEST" | "VALIDATION_ERROR" | "UNAUTHORIZED" | "NOT_FOUND" | "CONFLICT"
  | "PAYLOAD_TOO_LARGE" | "CONFIGURATION_ERROR" | "UPSTREAM_ERROR" | "INTERNAL_ERROR";

export class ApiError extends Error {
  constructor(public status: number, public code: ApiErrorCode, message: string) { super(message); this.name = "ApiError"; }
}

export const BODY_LIMITS = { small: 64 * 1024, large: 1024 * 1024 } as const;

export function json(data: unknown, status?: number, extraHeaders?: Record<string, string>): Response;
export function error(err: ApiError): Response;            // 体为 buildApiErrorBody(err.message, err.code)
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown>; // 实现方式参照 local/src/lib/http.ts 的流式累加
export function withSecurityHeaders(response: Response): Response; // cache-control: no-store, x-content-type-options: nosniff, referrer-policy: no-referrer
```

### 4.3 `crypto.ts`

```ts
export class CryptoError extends Error {}
export async function deriveKey(secret: string): Promise<CryptoKey>;
//  HKDF-SHA256，salt = "subboost-worker-lite:v1"，info = "aes-256-gcm"，输出 AES-GCM 256 位密钥；同一 secret 在 isolate 内缓存结果
export async function encryptString(plain: string, secret: string): Promise<string>;
//  12 字节随机 IV；输出 `v1:${b64url(iv)}:${b64url(ciphertextWithTag)}`
export async function decryptString(cipher: string, secret: string): Promise<string>;
//  格式不符、解密失败均抛 CryptoError
export async function sha256Hex(input: string): Promise<string>;
export function generateToken(): string;   // crypto.getRandomValues 32 字节 → base64url 无填充
export async function timingSafeEqual(a: string, b: string): Promise<boolean>;
//  对两者分别 sha256 后逐字节异或累加，再与长度相等条件合并，避免提前返回
```

base64url 编解码自行实现（`btoa` 后替换字符并去填充），不依赖 `Buffer`。

### 4.4 `ssrf.ts`

```ts
export type UrlValidation = { ok: true; url: URL } | { ok: false; reason: string };
export function validatePublicHttpUrl(input: string): UrlValidation;
export function isBlockedHostname(hostname: string): boolean;  // 规则见 Plan F8；hostname 需先去掉方括号、尾点并小写
```

实现要点：IPv4 解析为 4 个整数后按 CIDR 判断；IPv6 先展开 `::`，处理 `::ffff:a.b.c.d` 映射形式；任何解析失败视为拦截。

### 4.5 `safe-fetch.ts`

```ts
export class FetchBlockedError extends Error {}
export class TooManyRedirectsError extends Error {}
export class ResponseTooLargeError extends Error {}

export type SafeFetchDeps = { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> };
export type SafeFetchOptions = { userAgent: string; timeoutMs?: number; maxRedirects?: number; maxBytes?: number; maxRetries?: number };
export type SafeFetchResult = { status: number; headers: Record<string, string>; text: string; finalUrl: string };

export async function fetchText(url: string, options: SafeFetchOptions, deps?: SafeFetchDeps): Promise<SafeFetchResult>;
```

缺省：`timeoutMs` 15000、`maxRedirects` 3、`maxBytes` 10 MiB、`maxRetries` 2。每次尝试：`validatePublicHttpUrl` → `fetchImpl(url, { method: "GET", headers: { "User-Agent": userAgent, Accept: "text/plain, application/yaml, application/x-yaml, */*;q=0.8" }, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) })`。3xx 且有 `Location` 则解析为绝对 URL 后重新校验并计数。可重试条件：网络错误（非 `AbortError`）或状态 500、502、503、504、429；退避 `1000 * 2 ** attempt` 毫秒。读取响应体用 `response.body.getReader()` 累加，超限时 `reader.cancel()` 后抛 `ResponseTooLargeError`。不手动设置 `Accept-Encoding`，由平台透明解压。

### 4.6 `store.ts`

KV key 常量：

| 常量 | 值 | TTL |
| --- | --- | --- |
| `KEY_SOURCES` | `meta:sources` | 无 |
| `KEY_SUBS` | `meta:subs` | 无 |
| `KEY_CONFIG` | `meta:config` | 无 |
| `KEY_STATUS` | `meta:status` | 无 |
| `KEY_LOCK` | `meta:refresh-lock` | 600 |
| `tokenIndexKey(hash)` | `tokidx:<hash>` | 无 |
| `snapshotKey(id)` | `nodes:<id>` | 604800 |
| `cacheKey(id)` | `cache:<id>` | 172800 |

```ts
export type Store = ReturnType<typeof createStore>;
export function createStore(env: Env): {
  listSources(): Promise<SourceDto[]>;                 // 解密 payload
  listStoredSources(): Promise<StoredSource[]>;
  saveSources(inputs: SourceInput[]): Promise<SourceDto[]>; // 校验在 router 完成；此处只负责加密与持久化、删除孤儿快照
  listSubscriptions(origin: string): Promise<SubscriptionDto[]>; // link = `${origin}/sub/${decrypt(tokenEnc)}`
  createSubscription(input: { name: string; sourceIds: string[] }): Promise<{ dto: SubscriptionDto; token: string }>;
  deleteSubscription(id: string): Promise<boolean>;
  rotateSubscriptionToken(id: string, origin: string): Promise<SubscriptionDto | null>;
  findSubscriptionByToken(token: string): Promise<StoredSubscription | null>;
  getConfig(): Promise<{ config: Record<string, unknown>; isDefault: boolean }>;
  putConfig(config: Record<string, unknown>): Promise<void>;
  resetConfig(): Promise<void>;
  getSnapshot(sourceId: string): Promise<SnapshotRecord | null>;
  putSnapshot(record: SnapshotRecord): Promise<void>;
  deleteSnapshot(sourceId: string): Promise<void>;
  getCache(subId: string): Promise<CacheRecord | null>;
  putCache(record: CacheRecord): Promise<void>;
  deleteCache(subId: string): Promise<void>;
  getStatus(): Promise<StatusRecord | null>;
  putStatus(status: StatusRecord): Promise<void>;
  acquireLock(owner: string): Promise<boolean>;   // 已存在未过期锁则 false；KV 非原子，尽力而为
  releaseLock(owner: string): Promise<void>;
};
```

`ENCRYPTION_KEY` 缺失时，任何需要加解密的方法抛 `ApiError(503, "CONFIGURATION_ERROR", "ENCRYPTION_KEY 未配置")`。

### 4.7 `sources.ts`

```ts
export type RefreshSourceResult =
  | { ok: true; snapshot: SnapshotRecord }
  | { ok: false; error: string };              // error 已脱敏（去 query 与 userinfo，≤200 字符）

export async function refreshSource(source: SourceDto, deps: { fetchText: typeof fetchText; defaultUserAgent: string; now: () => Date }): Promise<RefreshSourceResult>;
```

- remote：`fetchText(source.url, { userAgent: source.userAgent ?? defaultUserAgent })`；非 2xx 视为失败，错误 `HTTP <status>`；`parseSubscription(text)`。
- manual：`parseSubscription(source.manualText)`。
- `nodes.length === 0` 视为失败，错误含 `errors` 前 3 条。
- `userInfo`：解析 `subscription-userinfo` 头的 `upload`、`download`、`total`、`expire` 为数字，再经 `normalizeSubscriptionResponseInfo` 归一；字段以 `packages/core/src/subscription/subscription-userinfo.ts` 为准（Plan U7）。
- 缺省 UA：`SUBSCRIPTION_IMPORT_USER_AGENTS.find((ua) => ua.startsWith("mihomo/"))`，`Env.DEFAULT_USER_AGENT` 可覆盖。
- 对 `parseSubscription` 的调用包在 try/catch 中：任何异常（含 workerd 下 peggy 触发的 `EvalError`）转为失败结果，错误文本为 `解析失败: <error.name>`。

### 4.8 `pipeline.ts`

```ts
export type PipelineDeps = { store: Store; fetchText: typeof fetchText; now: () => Date; defaultUserAgent: string };

export async function refreshAll(deps: PipelineDeps, opts: { trigger: "cron" | "manual" }): Promise<{ status: StatusRecord } | { skipped: "locked" }>;
export async function generateSubscription(deps: PipelineDeps, sub: StoredSubscription, opts: { onDemand: boolean }): Promise<
  | { kind: "ok"; cache: CacheRecord; info: SubscriptionResponseInfo | null }
  | { kind: "no-nodes" }
>;
export async function getOrGenerateSubscription(deps: PipelineDeps, token: string): Promise<
  | { kind: "ok"; sub: StoredSubscription; cache: CacheRecord; info: SubscriptionResponseInfo | null }
  | { kind: "not-found" } | { kind: "no-nodes" }
>;
export function computeConfigHash(config: Record<string, unknown>): Promise<string>; // sha256Hex(stableJsonStringify(config))
```

`refreshAll` 伪代码：

```text
if !acquireLock(owner): return { skipped: "locked" }
startedAt = now(); deadline = startedAt + 12 min
sources = listSources(); subs = listSubscriptions(); config = getConfig()
results = runWithConcurrency(4, enabledSources, async (source) => {
  if now() > deadline: return { ok: false, error: "deadline-exceeded" }
  r = refreshSource(source, ...)
  if r.ok: putSnapshot(r.snapshot)
  return r
})
for sub of subs: try generateSubscription(sub, { onDemand: false }) catch record error
putStatus({...}); releaseLock(owner)
```

`generateSubscription` 规则：

1. 目标源 = `sub.sourceIds` 为空时所有 `enabled` 源，否则按 `sourceIds` 顺序过滤出存在且 `enabled` 的源。
2. 逐源读快照；`onDemand` 为 true 且快照缺失时调用 `refreshSource` 并写快照。
3. 合并节点，`buildNodeContentKey(node)` 去重保留首次。
4. 节点为空返回 `no-nodes`。
5. `options = buildGenerateOptionsFromConfig(config, { nodes })`；`yaml = generateClashYaml(options)`；异常向上抛，由调用方决定是否回退旧缓存。
6. `info`：所有 remote 目标源的 `userInfo` 都含 `upload`、`download`、`total` 时求和，`expire` 取最小；否则 `null`。
7. 写 `cache:<subId>`，`configHash = computeConfigHash(config)`。

`getOrGenerateSubscription`：`findSubscriptionByToken` 未命中返回 `not-found`；读缓存且 `configHash` 等于当前哈希则命中；否则调用 `generateSubscription(..., { onDemand: true })`；生成抛错且存在旧缓存时返回旧缓存并把错误写入状态。

### 4.9 `auth.ts`

```ts
export async function requireAdmin(request: Request, env: Env): Promise<void>;
// ADMIN_TOKEN 缺失或空：throw ApiError(503, "CONFIGURATION_ERROR", "ADMIN_TOKEN 未配置")
// 头不是 "Bearer <token>" 或 timingSafeEqual 为 false：throw ApiError(401, "UNAUTHORIZED", "Unauthorized")
```

### 4.10 `router.ts` 路由表

| 方法 | 路径 | 鉴权 | 请求体 | 成功响应 |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | 否 | 无 | `200 {"ok":true}` |
| GET | `/api/state` | 是 | 无 | `200 { app: { name, version }, sources, subscriptions, config, configIsDefault, status }` |
| PUT | `/api/sources` | 是 | `{ sources: SourceInput[] }`，上限 1 MiB | `200 { sources }` |
| PUT | `/api/config` | 是 | JSON 对象，上限 1 MiB | `200 { config, configIsDefault: false }` |
| DELETE | `/api/config` | 是 | 无 | `200 { config, configIsDefault: true }` |
| POST | `/api/subscriptions` | 是 | `{ name, sourceIds? }`，上限 64 KiB | `201 { subscription }` |
| PATCH | `/api/subscriptions/:id` | 是 | `{ name?, sourceIds? }`，上限 64 KiB；`sourceIds` 必须引用现存源 | `200 { subscription }`；源不存在 `400 VALIDATION_ERROR`；清空该订阅的 YAML 缓存 |
| DELETE | `/api/subscriptions/:id` | 是 | 无 | `204` |
| POST | `/api/subscriptions/:id/rotate` | 是 | 无 | `200 { subscription }` |
| POST | `/api/subscriptions/:id/short-link` | 是 | 无 | `200 { subscription }`（`shortLink` = `<origin>/s/<8 位 base64url>`）；已有短链时幂等返回同一条；订阅不存在 `404 NOT_FOUND` |
| DELETE | `/api/subscriptions/:id/short-link` | 是 | 无 | `200 { subscription }`（无 `shortLink`）；本来没有短链也返回成功；订阅不存在 `404 NOT_FOUND` |
| GET | `/api/sources/:id/nodes` | 是 | 无 | `200 { source, fetchedAt, nodeCount, renamedCount, nodes, parseErrors }`；手动源无快照时即时解析 `manualText`；源不存在 `404` |
| POST | `/api/nodes/parse` | 是 | `{ text, renames? }`，上限 1 MiB | `200 { nodes, totalParsed, totalFailed, errors }`；空文本返回空列表 |
| GET | `/api/dashboard` | 是 | 无 | `200 DashboardStats`（源/订阅计数、节点总数、协议分布、逐源健康、最近刷新摘要、提醒） |
| POST | `/api/refresh` | 是 | 无 | `200 { status }`；持锁 `409 REFRESH_IN_PROGRESS` |
| GET、HEAD | `/sub/:token` | 否 | 无 | `200` YAML；`404` `Not found`；`503` `No nodes available` + `Retry-After: 600` |
| GET、HEAD | `/s/:code` | 否 | 无 | 与 `/sub/:token` 完全一致（同一份缓存、同一 ETag）；短码不合 `^[A-Za-z0-9_-]{8}$` 时直接 `404` `Not found`，不查 KV |
| 其他 `/api/*` | | | | `404 NOT_FOUND` JSON |
| 其他路径 | | | | `env.ASSETS.fetch(request)` |

`SourceInput` 校验顺序：数量 ≤ 50 → 每项 `name` 1 到 80 字符 → `kind` 合法 → remote 的 `url` 通过 `validatePublicHttpUrl` → manual 的 `manualText` ≤ 512 KiB 且 `parseSubscription` 得到 ≥1 节点 → `userAgent` 若存在 1 到 200 字符 → `nodeRenames` 逐项过滤（key 必须是 16 位小写十六进制，名称 trim 后 1 到 120 字符，最多 4000 条；无有效项时不落库）。错误消息格式：`第 <index+1> 个源：<原因>`。所有源的 `manualText` 之和同时受请求体 1 MiB 上限约束，超出时在读体阶段返回 413。

`/sub/*` 的非 200 响应体一律为纯文本（`Not found`、`No nodes available`、`Internal error`），不使用 JSON 错误体；`/api/*` 的错误一律为 JSON 错误体。

**订阅短链（`shortCode`）**：每条订阅最多一条，`StoredSubscription.shortCode` 为 8 字符 base64url（6 随机字节，48 bit 熵），索引 `short:<code>` -> `subscriptionId`。`findSubscriptionByShortCode` 命中索引后还要与订阅记录里的 `shortCode` 双条件对齐，残留索引不会复活已撤销的短链。短码不加密（是随机生成的公开定位符，不是秘密材料）。撤销（`DELETE` 短链）、删除订阅、轮换 token 都会清掉短码与索引；轮换连带撤销是刻意的，否则「旧链接立即失效」对已泄露的短链不成立。`/s/*` 必须列入 `wrangler.jsonc` 的 `assets.run_worker_first`，否则会被 SPA 回退成 `index.html`。

`app.version` 取 `worker/package.json` 的 `version`，通过 Vite/wrangler 构建时的 `import pkg from "../package.json"` 读取（`resolveJsonModule` 已在基线 tsconfig 开启）。

**节点改名（`nodeRenames`）**：`SourceInput.nodeRenames` 是以节点内容指纹为 key 的显示名覆盖表，key 由 `worker/src/node-renames.ts` 的 `nodeRenameKey(node)` 用 `buildNodeContentKey` 计算。指纹不含 `name`，所以改名后 key 不变、可反复覆盖；服务器/端口/凭据等身份字段变化后 key 变化，旧映射自动失效（不会误改到别的节点）。重命名在 `generateSubscription` 聚合节点时应用，因此 `proxies` 与引用它的 `proxy-groups`、listener 等同时生效；`PUT /api/sources` 保存后会清空全部订阅缓存，改名立即反映到 `/sub/:token`，无需轮换链接。同名冲突仍由生成器的 `ensureUniqueProxyNames` 追加 ` (2)` 后缀兜底。

**仪表板聚合（`GET /api/dashboard`）**：`worker/src/dashboard.ts` 的 `buildDashboardStats` 是纯函数，入参为源/订阅/状态/快照 Map，输出 `DashboardStats`（`sources`、`subscriptions`、`nodes.protocols`、`sourceStats`、`lastRun`、`warnings`）。节点总数与协议分布只统计启用源；`warnings` 覆盖刷新失败源、无快照源、生成失败订阅与空配置。管理页在 `/api/state` 加载成功后自动刷新该接口，失败时降级使用 `/api/state` 的 status 数据。

### 4.11 管理页 API 客户端

```ts
// admin-token.ts
export const ADMIN_TOKEN_STORAGE_KEY = "subboost-worker-admin-token";
export function readAdminToken(storage?: Storage): string | null;
export function writeAdminToken(token: string, storage?: Storage): void;
export function clearAdminToken(storage?: Storage): void;

// api-client.ts
export type ApiClient = {
  get<T>(path: string): Promise<T>;
  send<T>(method: "PUT" | "POST" | "DELETE", path: string, body?: unknown): Promise<T>;
};
export function createApiClient(opts: { getToken: () => string | null; onUnauthorized: () => void; fetchImpl?: typeof fetch }): ApiClient;
// 非 2xx：若 401 先调用 onUnauthorized；随后 throw new Error(await readApiErrorMessage(res, "请求失败"))
```

### 4.12 禁止的实现方式

- 在运行时调用 `peggy.generate`、`eval`、`new Function`。
- import `@subboost/server-core`（包根）或任何 `index.ts` barrel；只允许 3 个文件路径：`@subboost/server-core/subscription/response-headers`、`@subboost/server-core/http`、`@subboost/server-core/subscription/user-agents`。
- 在日志或错误响应中输出上游 URL 全文、token、节点内容。
- 把 `ADMIN_TOKEN`、`ENCRYPTION_KEY` 写入任何被提交的文件。
- 在 `/sub` 响应中透传上游 `profile-web-page-url`、`plan-name`。
- 使用 `text-white/N`、`bg-black/N`、`bg-[#hex]` 等被 `check-ui-consistency` 禁止的类。
- 为通过测试而删除或跳过测试、放宽断言、吞掉异常。

---

## 5. 测试与质量验证

### 5.1 测试矩阵

| 层 | 文件 | 覆盖 |
| --- | --- | --- |
| 单元 | `http.test.ts`、`crypto.test.ts`、`ssrf.test.ts`、`safe-fetch.test.ts`、`store.test.ts`、`sources.test.ts`、`auth.test.ts` | 正常路径、边界、失败路径 |
| 集成（进程内） | `pipeline.test.ts`、`router.test.ts` | 模块协作、配置失配、锁、软截止、响应头 |
| UI 逻辑 | `admin-token.test.ts`、`api-client.test.ts` | token 存储、鉴权头、401 处理 |
| 回归 | 根 `npm run test:unit` 全量 | 现有 `packages/*`、`local/` 测试不受影响 |
| 静态 | `npm run lint`、`npm run worker:typecheck` | 规范与类型 |
| 手动 | 第 5.3 节 | `wrangler dev` 下端到端 |

### 5.2 TDD 顺序

Phase 1 与 Task 2.1、3.2 均先写测试、确认失败、再实现。Task 2.2、3.1、3.3 属于入口接线与界面组装，用手动冒烟与 lint/typecheck 验证，原因是其行为由下层已测模块决定，单独测试收益低。

### 5.3 手动冒烟序列（`worker/` 目录，`npx wrangler dev --test-scheduled` 运行中，默认端口 8787）

```bash
T="$(grep ADMIN_TOKEN .dev.vars | cut -d= -f2)"
B="http://127.0.0.1:8787"

# 1 健康
curl -s $B/api/health                                   # {"ok":true}
# 2 鉴权
curl -s -o /dev/null -w "%{http_code}\n" $B/api/state   # 401
curl -s -H "Authorization: Bearer $T" $B/api/state      # 200 JSON
# 3 SSRF 拒绝
curl -s -X PUT -H "Authorization: Bearer $T" -H "content-type: application/json" \
  -d '{"sources":[{"name":"bad","kind":"remote","url":"http://127.0.0.1/x"}]}' $B/api/sources   # 400 VALIDATION_ERROR
# 4 添加手动源（无需外网）
curl -s -X PUT -H "Authorization: Bearer $T" -H "content-type: application/json" \
  -d '{"sources":[{"name":"manual","kind":"manual","manualText":"<一条合法的 ss:// 或 trojan:// 链接>"}]}' $B/api/sources
# 5 创建订阅并取链接
curl -s -X POST -H "Authorization: Bearer $T" -H "content-type: application/json" \
  -d '{"name":"default"}' $B/api/subscriptions          # 记录 link
# 6 抓订阅
curl -s -D - "<link>" | head -20                        # 200，头含 profile-update-interval: 12，体为 YAML
# 7 未知 token
curl -s -o /dev/null -w "%{http_code}\n" $B/sub/nope    # 404
# 8 手动刷新
curl -s -X POST -H "Authorization: Bearer $T" $B/api/refresh   # 200，status.lastTrigger = manual
# 9 Cron（端点路径见 Plan U8：以 `npx wrangler dev --help` 与当前版本文档为准）
curl -s "$B/__scheduled?cron=0+*/12+*+*+*"              # 之后 GET /api/state 的 status.lastTrigger = cron
```

### 5.4 首次部署序列（用户执行或在用户授权下执行）

```bash
npx wrangler login
npx wrangler kv namespace create SUBBOOST_KV            # 把返回的 id 填入仓库根的 wrangler.jsonc
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put ENCRYPTION_KEY
npm run worker:deploy
npm run worker:deploy
```

部署后用第 5.3 节的序列（把 `$B` 换成 Worker 域名）复核第 1、2、5、6、7 步。

---

## 6. 风险与异常处理

| 编号 | 风险 | 处理策略 | 级别 |
| --- | --- | --- | --- |
| K1 | `@vitejs/plugin-react` 与 vite 8 peer 冲突（Plan U1） | 选用声明兼容 vite 8 的版本；记录到 1.7 | 非阻塞 |
| K2 | CSS 裸包导入不解析（Plan U2） | 改相对路径 | 非阻塞 |
| K3 | `_headers` 不生效（Plan U3） | 改 `run_worker_first: true`，在 `index.ts` 对 `ASSETS.fetch` 的响应追加同一组头 | 非阻塞 |
| K4 | eslint-config-next 误报（Plan U4） | 后续整体替换为 typescript-eslint + jsx-a11y + react-hooks，不再依赖 Next 预设 | 已解决 |
| K5 | `import "peggy"` 在 workerd 模块求值失败（Plan U5） | 在 `wrangler.jsonc` 增加模块别名（字段名以当前 wrangler 配置文档为准，Plan U9），把 `peggy` 指向 `./src/shims/peggy-stub.ts`，该文件只导出抛错的 `generate`；记录到 1.7 | 非阻塞 |
| K6 | 大订阅现场生成超 CPU（Plan U6） | 以 Cron 预生成为主；README 建议 Paid | 非阻塞 |
| K13 | `@types/node` 与 workers-types 类型冲突（Plan U10） | 优先在 worker tsconfig 内解决（调整 `types` 顺序或最小 `declare`）；不得修改 `packages/core` | 非阻塞 |
| K7 | `Buffer` 不可用导致 `base64.ts` 抛错 | 确认 `compatibility_date >= 2026-08-04` 或显式 `nodejs_compat`；仍失败则停止并上报 | 停止并请求决策 |
| K8 | 用户工作区存在未提交修改 | 停止并询问，不得覆盖 | 停止 |
| K9 | 需要新增本手册未列出的依赖 | 停止并请求确认 | 停止 |
| K10 | 发现必须修改 `packages/*` 或 `local/*` 才能完成 | 停止，登记冲突并请求决策 | 停止 |
| K11 | KV 锁失效导致重复刷新 | 接受，文档已说明 | 普通 |
| K12 | `ENCRYPTION_KEY` 轮换 | 不做迁移；管理页提示重新录入 | 普通 |

分类说明：

- 普通实现选择：命名、内部函数拆分、测试替身的具体写法。
- 可记录假设后继续：K1 到 K6 与 K11、K12。
- 必须停止：K7 到 K10，以及任何涉及删除用户数据、修改生产 Secret、推送分支的操作。

---

## 7. 最终验收

验证顺序：

1. `npm run test:unit -- worker` 全绿。
2. `npm run worker:typecheck`、`npm run lint` 通过。
3. `npm run test:unit` 全量通过，`npm run check:local-app` 与基线一致。
4. 第 5.3 节冒烟序列逐步符合预期。
5. `git status --porcelain` 不含 `local/`、`packages/`。

验收勾选（对应 Plan 第 6 节）：

- [x] AC1 鉴权（F1）：冒烟第 2 步；`auth.test.ts`
- [x] AC2 源校验与加密（F2）：冒烟第 3、4 步；`store.test.ts`、`router.test.ts`
- [x] AC3 订阅链接、删除、轮换（F3）：冒烟第 5、7 步；`store.test.ts`
- [x] AC4 配置保存与重置（F4）：`router.test.ts`
- [x] AC5 部分失败与保护性快照（F5）：`pipeline.test.ts`
- [x] AC6 订阅输出与响应头（F6）：冒烟第 6、7 步；`router.test.ts`
- [x] AC7 配置变更后自动重生成（F6）：`pipeline.test.ts`；验收复核发现默认配置因空 `dnsYaml` 丢失基础段且改 `mixedPort` 不生效，已修复并在 `wrangler dev` 下复核 7897 → 45678 → 7897（见 1.7）
- [x] AC8 健康检查（F7）：冒烟第 1 步
- [x] AC9 SSRF 规则与重定向（F8）：`ssrf.test.ts`、`safe-fetch.test.ts`；重定向逐跳校验仅由单测覆盖，本地 `wrangler dev` 自动跟随重定向无法复现应用层拦截，需部署后复核（见 1.7）
- [x] AC10 Cron 触发（F9）：冒烟第 9 步
- [x] AC11 工程接入与无越界改动（S4）：验证顺序第 2、3、5 步
- [x] AC12 管理页主题与令牌合规（D4）：Task 3.3 完成条件；`check-ui-consistency` 无告警；真实浏览器交互复核已补齐，见「验收复核记录（2026-10-12，第二次复核）」

交付标准：以上 12 项全部勾选，且 1.7 冲突记录中没有未处理项。

### 验收复核记录（2026-10-12，独立复核）

复核环境：Windows 11 本机，`wrangler dev --test-scheduled`（本地模式，端口 8899，独立 KV 状态目录），外部依赖 httpbin.org。

1. `npm run test:unit -- worker`：13 文件 / 153 用例通过；修复后 pipeline 套件 20/20（含 5 条新增回归用例）。
2. `npm run worker:typecheck`、`npm run lint`（含 `check:ui-consistency`，353 文件）：通过（typecheck 为修复后）。
3. 全量 `npm run test:unit`：259 文件 / 1838 用例通过，唯一失败为基线既有 `local/scripts/selfhost-lifecycle-shell.test.ts` 超时（环境相关）；`npm run test:coverage` 与 `npm run check:local-app` 在 CI（Linux）通过。
4. 第 5.3 节冒烟序列逐步通过；额外复核：401/503 鉴权、50 源上限、43 字符 token、KV 密文（`payloadEnc`/`tokenEnc` 均为 `v1:` 开头，明文 token 与 `ss://` 文本在 KV 文件中出现 0 次）、跨源去重（3 行含重复 → `proxies=2`）、部分失败源仍生成订阅、轮换后旧链接 404、删除 204 + 再次删除 404、Cron 触发后 `lastTrigger=cron`、未知 token 纯文本 `Not found`、`/api/*` 全部带 `no-store`。
5. `git status --porcelain` 不含 `local/`、`packages/`。
6. 未能在本地验证：重定向逐跳 SSRF 校验（见 1.7，部署后按 README 复核）；AC12 的真实浏览器交互（本会话浏览器工具不可用，采用静态核验：构建产物含 light/dark 主题变量与主题初始化脚本、页面源码无密钥值、`check-ui-consistency` 无告警）。

### 验收复核记录（2026-10-12，第二次复核：处理 PR 未解决问题）

复核环境：Windows 11 本机，`wrangler dev`（本地模式，端口 8787，`worker/.dev.vars` 提供 `ADMIN_TOKEN`/`ENCRYPTION_KEY`），Chrome DevTools 浏览器自动化；全量测试复核期间 `wrangler dev` 保持运行以维持满载条件。

针对 PR「未解决的问题」清单的处理结果：

| 项 | 状态 | 说明 |
| --- | --- | --- |
| #1 重定向逐跳 SSRF 校验未在真实运行时验证 | 维持待部署复核 | 本机 `wrangler` 未登录（auth token 过期，非交互环境无法刷新），无法用 `--remote` 或部署验证；逐跳校验由 `safe-fetch.test.ts` 覆盖，部署后按 README「第 4 步」用 `redirect/5` 源复核 |
| #2 真实 Cron 触发未验证 | 维持待部署复核 | 需部署后确认 Trigger 已注册并观察一次实际触发 |
| #3 管理页主题切换未做真实浏览器交互验证（AC12） | 已补齐 | Chrome 实测：token 门渲染 → 填入 token 进入管理页，四面板（刷新状态/源管理/订阅链接/生成配置）均渲染；主题切换按钮双向生效：dark（`data-theme="dark"`、body 背景 `rgb(10, 10, 10)`）↔ light（`data-theme="light"`、`rgb(246, 248, 252)`），刷新后主题保持（初始化脚本生效，`localStorage["subboost-theme"]` 正确读写，token 存于 `subboost-worker-admin-token`）；截图留档。静态复核：`worker/dist` 全部产物对 `.dev.vars` 密钥值 0 命中；`check-ui-consistency` 359 文件无告警 |
| #4 `worker:typecheck` 未纳入 CI | 已修复 | `.github/workflows/ci.yml` 的 `check` job 在 `lint` 后追加 `npm run worker:typecheck`；本机复核通过 |
| #5 部署前待办 | 维持待用户操作 | 替换 `wrangler.jsonc` 占位 KV id、设置 `ADMIN_TOKEN`/`ENCRYPTION_KEY` secret、选择 Workers Paid 计划，均需用户 Cloudflare 账号操作 |
| #6 本机（Windows）全量单测基线失败 | 已修复 | 双根因（见 1.7）：自定义路径 Git Bash 未被检测 + rollback 用例超 vitest 默认 5s 超时；修复后全量 260 文件 / 1844 用例通过，本机 Windows 首次全绿 |
| #7 Windows `wrangler dev` 重建残留旧产物 | 维持登记状态 | 环境现象，`worker/README.md` 已登记处理方式，无代码改动 |

质量门复核（本次全绿）：`npm run test:unit -- worker` 13 文件 / 158 用例通过；`npm run worker:typecheck` 通过；`check-ui-consistency` 359 文件无告警；全量 `npm run test:unit` 260 文件 / 1844 用例通过。

改动说明：#4 与 #6 的修复涉及 `.github/workflows/ci.yml`（新增一步）、`test/setup-runtime.ts`（仅 Windows Git Bash 检测兜底）、`local/scripts/selfhost-lifecycle-shell.test.ts`（仅测试超时声明）；`local/` 应用与 `packages/*` 行为不变。




