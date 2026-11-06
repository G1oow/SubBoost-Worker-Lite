# AGENTS.md

本文件是交给 AI 编码代理与本仓库贡献者的开发规范。修改代码前先读一遍；
`docs/CONTRIBUTING.md` 面向人类贡献者，这里补充代理执行任务时必须遵守的约束。

## 项目定位

SubBoost Worker Lite 是 Cloudflare Workers + Workers KV 上的 Clash/Mihomo 订阅聚合服务，
只依赖 Workers 运行时，没有数据库、容器或常驻进程。管理端是一个构建期产出的 SPA。

技术栈：TypeScript、React 19、Vite 8、Tailwind CSS v4、Radix UI、Vitest、wrangler。

## 仓库结构

```
worker/            Worker 后端（API 路由、KV 存储、定时任务）+ 管理端 SPA
  src/             后端源码
  ui/              管理端 React 源码（构建产物到 worker/dist）
packages/core/     订阅解析与配置生成（纯逻辑，无运行时依赖）
packages/server-core/  响应头、UA 等跨形态共享逻辑
packages/ui/       共享 UI 组件、主题变量、样式
scripts/           构建、部署、仓库校验脚本
docs/              实施方案、贡献指南、第三方声明
test/              回归测试与测试基础设施
```

## 必须执行的校验

提交前至少跑完以下四项，任何一项失败都不得声称完成：

```powershell
npm run lint                 # ESLint + UI 一致性 + 仓库卫生 + 版本一致性
npm run test:unit            # 全量单元/回归测试
npm run worker:typecheck     # 后端与管理端类型检查
npm run worker:build         # 确认产物可构建
```

只改了纯逻辑（`packages/core`）时可先跑 `npm run test:core` 快速反馈，但最终仍需全量。
只在无头环境能验证的事情不作为已通过的结论；无法验证时必须明确说明未验证项与风险。

## 每次改动后开本地预览并交回可用的访问信息（强制）

改完管理端（`worker/ui`、`packages/ui`）或任何会影响页面渲染的代码后，
**主动启动本地预览并在回复末尾给出可直接复制使用的访问信息**，不要等用户来问，
也不要只说"已改完"就结束。

必须交回的内容：

- 地址：`http://127.0.0.1:8799`（端口固定 8799，不随意更换）
- 管理端 token：从**仓库根目录**的 `.dev.vars` 读取 `ADMIN_TOKEN`（值可能带引号，
  读取时 `.Trim('"')`）。本地值班用 `.dev.vars` 里已有的测试值即可，
  该文件已被 gitignore，**绝不允许超出本地范围使用**。
- 前端 localStorage 键：`subboost-worker-admin-token`（token）、`subboost-theme`（主题）
- 本次改动对应的页面路由，例如 `#/sources`、`#/subscriptions`、`#/status`

标准启动方式：

```powershell
# 先确认没有旧实例争用端口：多个 wrangler 同时监听 8799 会导致 TCP 可连但 HTTP 挂起
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*wrangler*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-Process workerd -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3

npx wrangler dev --port 8799 --local
```

启动后约 20–25 秒再探活，**必须返回 200 才能告诉用户可用**：

```powershell
(Invoke-WebRequest -Uri 'http://127.0.0.1:8799/api/state' -TimeoutSec 10 -SkipHttpErrorCheck `
  -Headers @{ Authorization = 'Bearer <ADMIN_TOKEN>' }).StatusCode   # 期望 200
```

规则：

- 启动是幂等的：本地预览没有自动热更新，**每次改完都要重新 `npm run worker:build`
  再重启 wrangler**，否则用户看到的是旧产物。
- 不要把 `wrangler dev` 的进程留着跨轮次不管；下一轮改动前先按上面的清理步骤收尾。
- token 只能出现在本机回复里，不许写进 commit、PR 正文、README、测试或任何会公开的位置。
- 探活失败时如实说明失败状态与原因，不要把"进程起来了"当成"可以访问"。

## Vercel 预览站（演示构建）

仓库除 Cloudflare Worker 之外还维护一个**纯静态预览站**形态：同一份管理端代码，
构建时打开演示模式后把 `/api/*` 交给浏览器内存里的真实 Worker 路由处理，
不依赖 Workers 运行时与 KV，也不需要 `ADMIN_TOKEN` / `ENCRYPTION_KEY`。
它只用于对外展示界面，不承载真实数据，访问者在页面上的改动刷新即丢失。

实现位置与硬约定：

- `vercel.json`（仓库根）是唯一部署配置：`buildCommand: node scripts/build-vercel-demo.cjs`、
  `outputDirectory: worker/dist`、SPA 回退与安全响应头。不要改到 Vercel 控制台里另建一套，
  也不要在控制台里 override Build Command / Install Command，否则与仓库配置漂移。
- 演示开关由仓库强制，不依赖 Vercel 控制台配置（这是硬约定）：
  `scripts/build-vercel-demo.cjs` 在子进程环境里写死 `VITE_SUBBOOST_DEMO=1`，构建完成后用
  `scripts/lib/vercel-demo-build.cjs` 校验产物里的演示标记，对不上就以非零码退出——
  宁可部署失败，也不静默发出一份需要 `ADMIN_TOKEN` 的站点。
  `worker/ui/src/lib/demo-mode.ts` 的 `resolveDemoMode` 是第二道保险：`VERCEL=1`
  （Vercel 构建容器自带变量，不受控制台配置影响）且没有显式关闭时一律按演示构建。
  `VITE_SUBBOOST_DEMO=0` / `false` 是唯一关闭方式，只用于以后真要在 Vercel 上托管正式管理端。
- `worker/ui/src/demo/`：`demo-kv.ts`（内存 KV）、`demo-seed.ts`（种子数据）、
  `demo-backend.ts`（在内存 env 里调用 `worker/src/index.ts` 的真实路由，禁用远程抓取）。
  演示数据只能用 `example.com` / RFC 5737 / RFC 3849 保留地址，节点名必须带「演示」标记。
- `worker/ui/vite.config.ts` 调 `resolveDemoMode(process.env)` 并把结果折叠成构建期常量
  `__SUBBOOST_DEMO__`，同时打印 `[subboost] 演示构建：已开启/已关闭` 便于在部署日志里核对；
  `worker/ui/src/app.tsx` 用**模块内本地常量**读它，分支才会被折叠。
  **禁止**在 `app.tsx` 顶层静态 import `src/demo/*`，演示代码一律走动态 `import()`，
  否则正式构建会把 Worker 路由塞进管理端产物。
- `worker/ui/src/demo/demo-backend.test.ts` 守护演示后端（种子、YAML 生成、不持久化、不联网），
  `worker/ui/src/lib/demo-mode.test.ts` 守护开关判定，`test/regression/tooling/vercel-demo-build.test.ts`
  守护 Vercel 构建入口与产物断言；改动演示模式必须同步更新它们。

改动后自检：

```powershell
# 正式构建：不该有任何演示痕迹
npm run worker:build
Get-ChildItem worker/dist/assets/*.js | Select-String -Pattern 'demo-preview-token|演示模式'
# 无输出 = 演示分支已摇掉；有输出说明摇树被破坏，先修再交付

# 演示构建：脚本会自己断言产物，失败即非零码退出
Remove-Item Env:VITE_SUBBOOST_DEMO -ErrorAction SilentlyContinue
$env:VERCEL='1'; node scripts/build-vercel-demo.cjs
# 成功时应看到「[vercel-demo] 产物已确认是演示构建」
```

Vercel 部署日志里必须能看到 `[subboost] 演示构建：已开启` 与 `[vercel-demo] 产物已确认是演示构建`；
看不到或出现断言失败，说明开关被外部配置改坏了，先修再合并 PR。

本地查看演示构建：

```powershell
$env:VITE_SUBBOOST_DEMO='1'
npx vite --config worker/ui/vite.config.ts --configLoader runner --port 5273
# 打开 http://localhost:5273 —— vite 只监听 ::1，用 localhost 而不是 127.0.0.1
```

部署（属于外部写操作，执行前先说明目标与影响）：

```powershell
vercel link --yes --project <小写项目名>   # 目录名含空格，必须显式给合法项目名
vercel deploy                              # preview 部署
vercel --prod                              # 覆盖生产别名
```

- 全新项目的**首次**部署会被 Vercel 指派为 production，之后的 `vercel deploy` 才是 preview，
  回复里要写清落在哪个环境。
- `vercel link` 会生成 `.vercel/` 与 `.env.local`（含 `VERCEL_OIDC_TOKEN`），两者必须在
  `.gitignore` 内；**不要**用 `.env*` 这种宽规则，它会覆盖已有的 `!.env.example`。
- 与"脱敏红线"一致：AGENTS.md、README、提交信息里不写具体部署域名、项目 id 与账号标识，
  只用占位符。

## 版本号规范（强制）

版本号的单一来源是**根 `package.json` 的 `version`**。worker 运行时读取
`worker/package.json` 的 version 并通过 `/api/state` 返回，管理端页头显示同一值，
README 徽章也需一致。任何一次功能变更、缺陷修复或行为调整，都必须同步版本号。

不要手工逐个改文件，用脚本：

```powershell
npm run check:version                    # 校验所有位置是否一致
npm run version:set -- 0.2.0             # 同步写入全部位置
node scripts/check-version.cjs --set 0.2.0 --dry-run   # 只预览
```

脚本会同步：5 个 `package.json`、README 徽章（含 alt）、以及断言了具体版本号的
`worker/src/router.test.ts` 与 `worker/ui/src/components/render.test.ts`。
改完版本必须重跑 `npm run test:unit`，否则硬编码版本的断言会红。

版本号规则（遵循 semver）：

- `0.x.y` 阶段：新功能升 `x`，缺陷修复升 `y`，破坏性变更升 `x` 并写进说明。
- 不允许把版本号留在一个提交里不变而声称"已完成本次变更"。

## 提交规范

- 提交信息用中文，采用 Conventional Commits 前缀：`feat:`、`fix:`、`refactor:`、`docs:`、`test:`、`chore:`。
- 一次提交只做一件事；重构与行为变更不要混在一起。
- 提交信息里要能看出用户可见影响；仅内部调整时说明动机。
- 未经用户明确要求，不执行 `git push`，也不做 `reset --hard`、`rebase`、`commit --amend`
  等重写历史或丢弃改动的操作。

## 脱敏红线（最高优先级）

任何会进入公开可见位置的内容——README、提交信息、PR 正文、Issue、文档、测试样例、
配置示例、截图——一律不得包含用户的真实信息：公网 IPv4/IPv6、网段、ASN、域名、
主机名、Token、密码、私钥、Cookie、连接串、订阅链接、`.env` 内容。

写之前就用占位符，不要先写真实值再回头改：

- IPv4 用 RFC 5737：`192.0.2.0/24`、`198.51.100.0/24`、`203.0.113.0/24`
- IPv6 用 RFC 3849：`2001:db8::/32`
- 域名用 `example.com` / `example.org`
- 凭据用 `<token>`、`<password>` 等占位符

本地联调用的临时密钥只能放 `.dev.vars`（已被 gitignore），用测试值（例如
`localtest-fixture-...` 前缀），不要用真实凭据。`npm run lint` 会拦截疑似真实密钥。

## 代码约定

前端（`worker/ui`、`packages/ui`）的完整规范见 [`docs/frontend-guidelines.md`](docs/frontend-guidelines.md)：
分层归属、样式令牌、组件用法、响应式、动效约束与「已知前端坑」防回归清单都在那里。
下面是必须先记住、且被脚本/测试强校验的硬约束；两处冲突时以该文档 + 守护测试为准。

### 通用

- 延续现有架构与风格，不做无关重构；改动聚焦在任务范围内。
- 保留用户已有的未提交改动，不覆盖、不回退非本任务产生的修改。
- 新增逻辑尽量放在 `packages/` 的纯函数里并配单元测试；`worker/src` 负责 IO 与路由编排。
- 不要引入新的运行时依赖，除非确有必要并在说明中给出理由。当前运行时只依赖
  React、lucide-react、qrcode.react 与 `@subboost/*`。

### 颜色与主题（有强校验）

界面同时支持深色与浅色主题，颜色必须来自主题令牌，不得写死深色值。
在 `packages/ui/src/styles/theme.css` 中同时为 `:root/[data-theme="dark"]` 与
`[data-theme="light"]` 定义变量，再通过生成的工具类使用：

- 文本：`text-fg`、`text-fg-80`、`text-fg-70`、`text-fg-60`、`text-fg-45`、`text-fg-35`（只有这六档）
- 填充与描边：`bg-ink/5`、`border-ink/10`
- 表面：`bg-surface`、`bg-surface-raised`、`bg-header`、`bg-overlay`
- 状态提示：`text-warning-note-fg`、`bg-warning-note-bg`、`border-warning-note-border`
  （`danger` / `success` 同构），由 `InlineNote` / `Badge` / `Toast` 消费
- 字号：`text-2xs`（11px）、`text-xs`、`text-sm`，不用任意值 `text-[11px]`

以下写法会被 `npm run check:ui-consistency` 直接拒绝：`text-white/60`、
`bg-white/5`、`border-white/10`、`bg-black/40`、`bg-[#0a0a0a]`、`text-zinc-950`、
`color-scheme: dark`、刻度外的前景色（`text-fg-50`、`text-fg-40` 等）、
裸调色板状态色（`text-amber-400`、`text-red-400`、`text-emerald-400` 等）、
任意值字号（`text-[11px]`）。协议徽标 `protocol-badge.tsx` 是唯一例外（协议标识色，非状态色）。
新增颜色变量要同时改两个主题块。

### 组件使用

- 业务代码不得直接 `import "@radix-ui/react-*"`，必须用 `packages/ui/src/components/ui/`
  下的包装组件。
- 图标按钮用 `IconButton` 且必须传 `label`；不要用 `Button size="icon"`。
- 裸 `<Switch>` 必须提供 `aria-label` 或 `aria-labelledby`，优先用 `SwitchField`。
- 不要在 `<a>` 里嵌套 `<Button>`，改用 `Button asChild`。
- 图标统一用 lucide-react，不用 emoji 代替功能图标；渲染一律走
  `@subboost/ui/components/ui/icon` 的 `<Icon icon={X} size="…" />`：
  默认 `strokeWidth` 1.75，尺寸只用 `xs/sm/md/lg/xl`（12/14/16/20/24px）五档，
  自带 `aria-hidden`（需要被读屏念出来时传 `label`）。容器已有 `[&_svg]:size-*`
  时不要传 `size`（父选择器特异性更高，会盖掉档位类）。`npm run check:ui-consistency`
  会拒绝把 lucide 图标直接当 JSX 标签用、手写 `<svg>` 以及 lucide 的旧别名
  （`AlertTriangle`、`XCircle`、`CheckCircle2`、`Loader2` 等）。

### 动效（有强校验）

`packages/ui/src/styles/motion.test.ts` 会守护动效约定：

1. **承载文字的入场关键帧只能驱动 `opacity`**，不许出现 `transform` / `translate` /
   `scale`。任何位移或缩放都会把元素提升为独立合成层，Chrome 为这层只栅格化一次纹理，
   之后按非整数设备像素逐帧平移，插值采样会把整块内容糊掉：文字边缘发虚、卡片阴影的
   柔和过渡被抹平（看起来像"动画期间没渲染阴影"），动画结束重新栅格化才突变清晰。
   方向感与层次感交给时长/easing 差异和 `.stagger-*` 时序，它们不产生合成层。
2. 纯色块装饰（`iconPop`、`barGrow`、`toastProgress`）不含文字，仍可用 `scale`；
   新增这类关键帧时不要让它包住文字。
3. Radix 组件的退场动画必须挂在 `data-[state=closed]` 上，Radix Presence 依赖
   `animationend` 才卸载节点；只写进场动画等于关闭时硬切。
4. 新增动效通过 `@theme` 的 `--animate-*` 令牌注册，并在 `globals.css` 定义对应
   `@keyframes`，同时补进 `motion.test.ts` 的期望表。
5. 入场动画用 `backwards` 而非 `both`，避免动画结束后留下合成层。
6. 尊重 `prefers-reduced-motion`，全局降级规则已存在，不要移除。
7. 如果面板背景本身不透明，不要再叠 `backdrop-blur`——它没有视觉效果却要每帧
   对整块背景做模糊，是开合卡顿的常见原因。
8. **常驻覆盖层（`fixed` / `sticky` 的页头、工具条、底栏）同样不许用位移**：
   别用 `translate` / `transform` / `transition-[…translate…]` 做"滑入滑出"，也别把
   半透明的常驻层留在 DOM 里等它淡入。它们会被提升为合成层，滚动期间按非整数设备
   像素平移，压在下方的正文一起被插值采样 —— 表现就是"滚动时顶栏文字发虚、下方卡片
   发虚"。常驻层只在需要时挂载，出场用只驱动 `opacity` 的关键帧（如 `animate-fade-in`），
   表面用不透明 `bg-header`。守护见
   `worker/ui/src/components/pinned-header.test.ts` 的 `FORBIDDEN_MOTION_CLASSES`。

#### 已知陷阱：滚动时"文字发虚、卡片发虚"

本仓库被这一类问题反复咬过，排错时按下面这条链路判断，不要凭感觉调 CSS。

**症状**：动画进行中或页面滚动过程中，文字边缘发毛、卡片阴影变淡，整体像蒙了一层雾；
停下（动画结束 / 滚动停止）又突然恢复锐利。用户通常只会说"发虚""模糊""阴影没渲染"。

**机制**（Chrome 系如此，Firefox / Safari 同理）：

1. 元素只要有非 `none` 的 `transform` / `translate` / `scale`（哪怕值就是 0），
   或带 `will-change` / `filter` / `backdrop-filter`，就会被提升为**独立合成层**。
2. 该层的内容只**栅格化一次**成纹理，之后由合成线程按矩阵平移。滚动与动画中的位移
   常常落在**非整数设备像素**上，整块纹理被双线性插值采样：字形边缘被抹平 → 文字发虚；
   卡片阴影的柔和过渡带被抹平 → 看起来"阴影根本没渲染"。
3. 最严重的一种：常驻的 `fixed` / `sticky` 层（页头、工具条、底栏）带变换时会**长期**
   压在滚动内容上，与之重叠的正文被 squash 进同一个合成层，于是**滚动期间整屏一起
   被重采样**——顶栏文字和下面的卡片同时发虚，停下才清晰。

**判定**（比肉眼可靠）。控制台里直接列会被提升为合成层的节点：

```js
[...document.querySelectorAll("*")].filter((el) => {
  const s = getComputedStyle(el);
  return s.transform !== "none" || s.translate !== "none" || s.scale !== "none"
    || s.willChange !== "auto" || s.filter !== "none" || s.backdropFilter !== "none";
});
```

再对照 DevTools → More tools → Layers：滚动期间被 squashed、或长期存在的合成层就是元凶。

**正确写法**：

- 承载文字的元素，入场/出场**只驱动 `opacity`**，关键帧与过渡一视同仁。
- 常驻覆盖层**只在需要时挂载**，不要留一个 `opacity-0` 还带位移的空壳在 DOM 里等淡入。
- 覆盖层表面用不透明主题令牌（`bg-header` / `bg-surface`），不靠背景模糊造质感。
- 纯色块装饰（图标、占比条、进度条）没有可读文字，仍可用 `scale`，但不要让它包住文字。
- hover 位移用独立的 `translate` 属性（见 `.hover-lift`），且不要把 `box-shadow` 放进过渡。

**反例 / 正例**：

```tsx
// ❌ 常驻 + 位移 + 过渡：隐藏态也带 translate，整页在滚动期间被重采样
<div className={cn("fixed inset-x-0 top-0 transition-[opacity,translate]",
  pinned ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0")} />

// ✅ 需要时才挂载；出场只跑只驱动 opacity 的关键帧，条上没有任何变换
{pinned ? <div className="fixed inset-x-0 top-0 animate-fade-in bg-header" /> : null}
```

**守护断言**（改这三处时不要顺手放宽）：

- `packages/ui/src/styles/motion.test.ts`：关键帧层面——不得出现 `transform` / `translate` /
  `scale`，且必须驱动 `opacity`；
- `worker/ui/src/components/pinned-header.test.ts`：常驻层层面——`FORBIDDEN_MOTION_CLASSES`
  覆盖 `translate` / `transform` / `scale` / `transition`；
- `worker/ui/src/components/mobile-layout.test.ts`：首帧不得渲染常驻固定层。

**历史**：`c833f87`（入场关键帧去位移、页头不再常驻）与 `0.9.0` 的吸顶工具条（覆盖层去位移）。

### 测试

- 新增行为要有测试；修复缺陷要有能复现该缺陷的回归测试。
- 测试数据只用上面「脱敏红线」里的保留地址与占位符。
- 断言 UI 时优先断言语义文本与可访问属性，避免断言脆弱的类名。

## 常见任务流程

新增一个管理端功能：

1. 后端在 `worker/src` 增加路由与 KV 读写，补 `*.test.ts`。
2. 管理端在 `worker/ui/src` 增加组件，复用 `packages/ui` 组件与主题令牌。
3. 更新类型（`worker/ui/src/lib/types.ts`）。
4. `npm run version:set -- <新版本>`，再跑必跑校验四项。
5. 需要时同步 README 截图与文档。

只改文档或注释：至少跑 `npm run lint`（含版本与仓库卫生检查）。

## 部署相关（谨慎）

- `wrangler.jsonc` 里的 KV `id` 必须是占位符 `REPLACE_WITH_KV_NAMESPACE_ID`，
  真实 id 由部署脚本注入，不进仓库。
- `ADMIN_TOKEN`、`ENCRYPTION_KEY` 只能作为 Worker Secret 或 `.dev.vars` 存在。
- 涉及部署、改密钥、改 CI 配置的操作，执行前必须先说明目标与影响并取得确认。
- Vercel 预览站是独立的纯静态形态，只部署管理端演示构建，不涉及 Worker、KV 与密钥；
  实现与部署流程见上文「Vercel 预览站（演示构建）」。同一份仓库同时存在两种部署目标时，
  确认清楚要更新哪一个，不要用预览站流程去改生产 Worker。
