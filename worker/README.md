# SubBoost Worker Lite

只依赖 Cloudflare Workers + Workers KV 的精简部署形态：聚合多个上游订阅与手动节点，生成 Clash/Mihomo 订阅链接，管理端由访问 token 保护，每 12 小时自动刷新。

设计依据：

- 实施方案（Plan）：`docs/implementation/cf-worker-lite-plan.md`
- 构建手册（Build）：`docs/implementation/cf-worker-lite-build.md`

## 本地开发

```bash
# 1. 准备本地密钥（不要提交）
cp .dev.vars.example .dev.vars
# 填入随机值：ADMIN_TOKEN、ENCRYPTION_KEY

# 2. 构建管理页（输出到 worker/dist）
npm run worker:build

# 3. 启动 Worker（默认 http://127.0.0.1:8787；端口被占用时：npm run worker:dev -- --port 8899）
npm run worker:dev

# 4. 可选：单独启动管理页 Vite 开发服务器（带 /api、/sub 代理）
npm run worker:dev:ui
```

质量门：

```bash
npm run worker:typecheck
npm run test:unit -- worker
npm run lint
```

### 本地开发注意事项

- **本地无法验证重定向相关的 SSRF 逐跳校验。** `wrangler dev` 本地模式的出站 `fetch` 会自动跟随 3xx 重定向，`redirect: "manual"` 不生效，Worker 代码看不到 302，因此 `safe-fetch.ts` 的逐跳校验与「最多 3 跳」限制在本地不会触发（指向私网的重定向会表现为运行时网络错误，而不是「目标地址不允许」）。生产 Workers 运行时按官方文档会把 3xx 响应原样返回给调用方，部署后请按下文「第 2 步：部署后验证」复核。
- **Windows 上重新构建时 `dist` 可能残留旧 `assets/*`。** 当有进程（如正在运行的 `wrangler dev`、预览工具或杀毒扫描）持有这些文件的句柄时，Node 与 Vite 的删除会被推迟（`emptyOutDir` 看似未生效，文件仍在目录中可见）。遇到残留时先停止相关进程并手动删除 `worker/dist` 再构建；部署前确认 `dist/index.html` 引用的 `assets/*` 与目录内容一致。
- 若本机设置了 `http_proxy` / `https_proxy` 环境变量，`wrangler dev` 会让 Worker 的出站请求经过该代理。

## 首次部署

### 前置条件

- Node 版本满足根 `package.json` 的 `engines`：`>=22.13.0 <23 || >=24.0.0`。
- 已在仓库根目录执行 `npm ci` 安装依赖。
- 拥有 Cloudflare 账号，并在本机完成登录：`npx wrangler login`。
- 计划选择：Free 计划每请求 CPU 约 10 ms，现场生成较大订阅可能超限，建议使用 Workers Paid 计划。正常访问走缓存，缓存主要由 Cron 与手动刷新预生成。

### 第 1 步：一条命令完成部署

密钥与 KV 都不需要手工配置，全部由部署脚本处理：

```bash
# Linux / macOS
ADMIN_TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")" \
ENCRYPTION_KEY="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")" \
npm run worker:deploy
```

```powershell
# Windows PowerShell
$env:ADMIN_TOKEN = node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
$env:ENCRYPTION_KEY = node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
npm run worker:deploy
```

`scripts/deploy-worker.cjs` 会依次完成：

1. 校验 `ADMIN_TOKEN` 与 `ENCRYPTION_KEY`（缺失、短于 32 位或仍是示例占位值时直接中止，不会创建任何资源）。
2. 按标题 `SUBBOOST_KV` 查找 KV namespace；已存在则复用，不存在则**自动新建**。
3. 把真实 id 注入一份临时配置 `wrangler.deploy.jsonc`（已加入 `.gitignore`，部署结束后立即删除），仓库里的 `wrangler.jsonc` 始终保持占位符。
4. 通过 `wrangler secret bulk` 的 stdin 上传两个 Secret，密钥不落盘。
5. 执行 `wrangler deploy` 并打印结果。

可选环境变量：

| 变量 | 作用 |
| --- | --- |
| `SUBBOOST_KV_TITLE` | 自定义 KV namespace 标题（默认 `SUBBOOST_KV`） |
| `SUBBOOST_KV_ID` | 直接指定已有 KV namespace id，跳过查找与创建 |
| `SUBBOOST_SKIP_SECRETS=1` | 跳过 Secret 上传（密钥已在 Dashboard 配好时使用） |

只想确认配置与绑定是否正确、不上传任何东西：

```bash
npm run worker:deploy:dry-run
```

### 手动方式（等价步骤）

不使用脚本时，按下面的步骤手工完成，效果相同：

```bash
# 1. 创建 KV namespace，记下输出里的 id
npx wrangler kv namespace create SUBBOOST_KV

# 2. 把 id 填入临时变量并注入配置（不要提交带真实 id 的配置）
export SUBBOOST_KV_ID=<上一步的 id>

# 3. 设置 Secret（交互式输入，不进入 shell 历史）
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put ENCRYPTION_KEY

# 4. 部署（仍需注入 id，否则占位符会导致部署失败）
node scripts/deploy-worker.cjs
```

密钥生成方式示例：

```bash
openssl rand -base64 32
# 或
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

未设置 `ADMIN_TOKEN` 时所有管理 API 返回 503；未设置 `ENCRYPTION_KEY` 时源与订阅相关接口同样返回 503，即 fail closed。更换 `ENCRYPTION_KEY` 会导致已有密文无法解密，需要重新录入源与订阅。

### 第 2 步：部署后验证

把 `B` 换成实际地址，`T` 换成部署时设置的 `ADMIN_TOKEN`：

```bash
B="https://subboost-worker-lite.<账号子域>.workers.dev"
T="<ADMIN_TOKEN>"
curl -s $B/api/health                                   # {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" $B/api/state   # 401
curl -s -H "Authorization: Bearer $T" $B/api/state      # 200，返回 app / sources / subscriptions / config / status
```

然后在浏览器打开 `B`，输入 `ADMIN_TOKEN` 进入管理页：添加一个源，创建订阅，复制链接，再确认订阅输出：

```bash
curl -s -D - "$B/sub/<订阅 token>" | head -20   # 200，头含 profile-update-interval: 12 与 cache-control: private, no-cache，体为 YAML
```

在「分享订阅」弹窗点「生成短链」后，短链与原链接输出同一份 YAML，可再用短码复核一次：

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$B/s/<短链码>"   # 200
curl -s -D - "$B/s/<短链码>" | head -20                    # 头与上面一致，etag 相同
```

撤销短链后同一条 `curl` 应返回 404 `Not found`，而原链接仍为 200。

以下两项本地无法验证，部署后必须复核：

1. **重定向逐跳 SSRF 校验**：添加 `remote` 源 `https://httpbin.org/redirect/5`，点击「立即刷新」，该源应失败且错误为「重定向次数超过上限」。若错误是节点解析失败，说明运行时自动跟随了重定向，逐跳校验未生效，请先排查再上线。
2. **Cron 触发**：Cloudflare Dashboard 中该 Worker 的 Settings / Triggers 应显示 `0 */12 * * *`；等到下一次整点触发后，`GET /api/state` 的 `status.lastTrigger` 应为 `cron`。也可在 `worker/` 目录执行 `npx wrangler tail` 实时观察触发日志。

### 更新部署

代码更新后重新执行 `npm run worker:deploy` 即可，KV 数据与 Secret 不受影响。管理页若仍显示旧版本，强制刷新浏览器缓存。

### 常见问题

- 部署报 `KV namespace 'REPLACE_WITH_KV_NAMESPACE_ID' is not valid`：配置里的 id 仍是占位符。用 `npm run worker:deploy`（会自动注入），或按「手动方式」设置 `SUBBOOST_KV_ID` 后再执行 `node scripts/deploy-worker.cjs`。
- 部署报「密钥校验未通过」：`ADMIN_TOKEN` / `ENCRYPTION_KEY` 未设置、短于 32 位或仍是示例值；补齐后重试，或加 `SUBBOOST_SKIP_SECRETS=1` 跳过上传（需已在 Dashboard 配好）。
- 管理页能打开但接口全部 503：Secret 未设置，重新执行部署或在 Dashboard 添加 Secret。
- 管理页提示 token 无效：输入值与 `ADMIN_TOKEN` 不一致，重新执行 `npx wrangler secret put ADMIN_TOKEN` 后再试。
- 订阅返回 503 `No nodes available`：所有源抓取失败或尚未刷新，先在管理页点「立即刷新」并查看状态面板的错误信息。
- 订阅生成慢或超限：Free 计划 CPU 限制所致，升级 Paid 或等待 Cron 预生成缓存。
- 短链返回 404：短链被撤销过，或订阅 token 已轮换（轮换会一并撤销短链）。到「分享订阅」弹窗重新生成即可，原链接始终不受影响。

## 从 fork 仓库部署（Cloudflare 一键部署按钮 / Workers Builds）

适合不想在本机装 Node、登录 wrangler 的场景：把仓库 fork 到自己名下，交给 Cloudflare 构建并部署。下面两种入口最终落到同一个方式 —— Workers Builds 连接你 fork 的仓库，推送即构建。

### 方式 A：一键部署按钮（推荐首次部署）

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/G1oow/subboost)

1. 点上面的按钮（等价于打开 `https://deploy.workers.cloudflare.com/?url=<你 fork 的仓库 URL>`），用 GitHub 登录并授权 Cloudflare。
2. 在配置页确认三项，其余保持默认：
   - **Git 账号 / 仓库名**：Cloudflare 会把源仓库复制到你自己的 GitHub 账号下，不会改动上游仓库。
   - **Worker 名称**：默认取 `wrangler.jsonc` 的 `name`（`subboost`），可改；改名后 workers.dev 地址随之变化。
   - **KV namespace 名称**：默认 `SUBBOOST_KV`，Cloudflare 按绑定名自动创建，不需要预先存在。

   构建/部署命令由 Cloudflare 从 `package.json` 自动识别并预填：Build command 留空（安装依赖时的 `prepare` 已构建管理页），Deploy command 为 `npm run deploy`。根 `package.json` 的 `deploy` 就是 `SUBBOOST_SKIP_SECRETS=1 npm run worker:deploy`，跳过 CI 里不存在的 Secret 上传，并让脚本按标题查找/创建 KV。
3. 点 Deploy，等待 Workers Builds 完成构建。
4. 部署完成后补两个运行时 Secret，见下方「部署后必须做的两步」。

> **为什么能自动建 KV**：Deploy to Cloudflare 会读取仓库根目录的 Wrangler 配置，按绑定名创建缺失的资源，并把新创建的 namespace id 写回配置。仓库里的 `wrangler.jsonc` 因此只保留绑定名 `SUBBOOST_KV` 与占位符 id `REPLACE_WITH_KV_NAMESPACE_ID`，真实 id 不进版本库。官方说明见 [Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)。

### 部署后必须做的两步

1. **加运行时 Secret**：Worker → Settings → Variables and Secrets，添加 **Secret** 类型的 `ADMIN_TOKEN` 与 `ENCRYPTION_KEY`（各 32 位以上随机串，生成命令见上文「首次部署」）。没配之前管理接口按 fail closed 返回 503。
2. **按「第 2 步：部署后验证」复核**：`/api/health`、`/api/state` 的鉴权行为，以及重定向逐跳 SSRF 校验、Cron 触发两项本地无法验证的内容。

一键部署与 Push 部署的区别只有入口：前者在你账号下新建仓库并立刻构建一次，后者由你已有的 fork 在每次推送时触发构建。之后都按下面的方式维护。

### 方式 B：已有 fork 仓库 + Workers Builds

适合已经 fork 过、想持续跟随上游更新的场景：

1. Workers & Pages → Create → Import a repository → 选择**你自己的 fork**，Production branch 填 `main`。
2. Root directory 保持 `/`；Build command 留空（`prepare` 会自动构建管理页）。
3. Deploy command 保持 `npm run deploy` 即可。三种等价写法，任选其一都不需要再改：

   ```bash
   # 1) 根级脚本，脚本自己按标题 SUBBOOST_KV 查找，找不到就新建
   npm run deploy

   # 2) 显式指定 KV id，跳过查找与创建（复用已有 namespace 时推荐）
   SUBBOOST_KV_ID=<你的 KV id> SUBBOOST_SKIP_SECRETS=1 npm run worker:deploy

   # 3) 把 SUBBOOST_KV_ID / SUBBOOST_SKIP_SECRETS 配成 Build variables
   npm run worker:deploy
   ```

   `SUBBOOST_KV_ID` 存在时优先级最高：脚本直接注入该 id，不调用 `kv namespace list`，也不会新建 namespace。所以写了显式 id 的旧命令（方式 2）长期有效，不会被后来新增的 `npm run deploy` 取代。

   三种写法的共同点：都经过 `node scripts/deploy-worker.cjs`，会生成注入好 id 的临时配置 `.wrangler.deploy.jsonc` 再部署。共同的红线是**不能**用默认的 `npx wrangler deploy` —— 它会读到占位符 id 并报 `KV namespace 'REPLACE_WITH_KV_NAMESPACE_ID' is not valid`。
4. 在 Worker 的 Settings → Variables and Secrets 添加 `ADMIN_TOKEN`、`ENCRYPTION_KEY` 两个 Secret。
5. 之后每次 push 到 `main` 自动构建部署；同步上游用 GitHub 的 Sync fork（或 `git pull upstream main`）后推送即可，KV 数据与 Secret 不受影响。

### fork 部署常见问题

- **构建报了 KV id 无效**：Deploy command 被改成了 `npx wrangler deploy`。改回 `npm run deploy`，或改用上面方式 2 的 `SUBBOOST_KV_ID=<你的 KV id> SUBBOOST_SKIP_SECRETS=1 npm run worker:deploy`。
- **构建时提示密钥校验未通过**：Deploy command 里缺少 `SUBBOOST_SKIP_SECRETS=1`（例如直接写 `npm run worker:deploy`），而 CI 里没有 `ADMIN_TOKEN` / `ENCRYPTION_KEY`。加上该变量，或改用自带它的 `npm run deploy`；运行时密钥走 Dashboard 的 Worker Secret（见「运行时 Secret」）。
- **管理页打开但接口全 503**：`ADMIN_TOKEN` / `ENCRYPTION_KEY` 只配在 Build variables 里。Build variables 只在构建阶段生效，运行时 Secret 必须在 Worker Settings 里另加。
- **Node 版本过旧**：Workers Builds 构建镜像默认 Node 24.18.0，低于仓库 `.nvmrc` 要求的 24.22.1；Workers Builds 会自动识别 `.nvmrc` 覆盖，若构建日志显示的版本不符，可显式设置 `NODE_VERSION=24.22.1`。
- **改了 Worker 名称**：`wrangler.jsonc` 的 `name` 与 Dashboard 里的项目名以后部署的为准；改名等于换了一个 workers.dev 域名，原订阅链接需要重新分发。
- **想改回本地部署**：本地 `npm run worker:deploy` 与 Workers Builds 部署的是同一个 Worker，同名以后部署的为准，属正常覆盖；Cron `0 */12 * * *` 随每次部署重新注册。

## Git 集成部署（Workers Builds，手工配置）

上一节是走按钮或已有 fork 的推荐路径；这一节是等价的纯手工配置，适合不经过 Deploy to Cloudflare、自己把仓库接到 Workers Builds 的场景（也可以用来理解上一节的每一步在 Dashboard 里对应什么）。

> **重要：Deploy command 不能用默认的 `npx wrangler deploy`。** 仓库里的 `wrangler.jsonc` 只保留 KV id 占位符，直接 `npx wrangler deploy` 会报 `KV namespace 'REPLACE_WITH_KV_NAMESPACE_ID' is not valid`。必须走 `node scripts/deploy-worker.cjs`，它会在构建后生成注入好 id 的临时配置 `.wrangler.deploy.jsonc` 再部署。两种可接受写法：`npm run deploy`（自带 `SUBBOOST_SKIP_SECRETS=1`，KV 按标题查找/创建），或 `SUBBOOST_KV_ID=<你的 KV id> SUBBOOST_SKIP_SECRETS=1 npm run worker:deploy`（显式指定 id）。

1. Workers & Pages → Create → Import a repository → 选择本仓库，Production branch 填 `main`。
2. Root directory 保持 `/`，Build command 留空（`prepare` 会自动构建）。
3. **Deploy command** 填 `npm run deploy`；若已有带显式 id 的旧命令（`SUBBOOST_KV_ID=<id> SUBBOOST_SKIP_SECRETS=1 npm run worker:deploy`），保留原样即可，效果等价。
4. （可选）想固定复用某个已存在的 KV，而不是让脚本按标题 `SUBBOOST_KV` 查找/创建：把 `SUBBOOST_KV_ID=<你的 KV id>` 配成 Workers Builds 的 **Build variable**。id 取自 Storage & Databases → KV。
5. 在 Worker 的 Settings → Variables & Secrets 添加两个 Secret 类型的运行时变量：`ADMIN_TOKEN`、`ENCRYPTION_KEY`。这两个不配，管理接口按 fail closed 返回 503。
6. 推送代码即完成构建与部署。

### 为什么这样配置

- `wrangler.jsonc` 放在**仓库根目录**，`main` 指向 `worker/src/index.ts`，`assets.directory` 指向 `worker/dist`，两个路径都相对配置文件解析。
- 根 `package.json` 的 `prepare` 脚本会在 Workers Builds 安装依赖（`npm ci`）后自动执行 `npm run worker:build`，所以 Build command 可以留空；本地手动构建用 `npm run build`。
- 非生产分支由 `npx wrangler preview` 部署，根配置里的 `previews: {}` 是这条命令的硬性要求，缺了会直接报错退出。

### 前置

- 仓库已推送到 GitHub（Workers Builds 只读你连接的那个仓库/分支）。
- KV namespace 不需要预先创建：`npm run deploy` 会按标题 `SUBBOOST_KV` 查找，找不到就新建。只有想固定复用某个已有 namespace 时，才需要拿到它的 id 并通过 Build variable `SUBBOOST_KV_ID` 传入（仓库里不保存该 id）。
- Node 版本：Workers Builds 构建镜像默认 Node 24.18.0，低于 2026-10 安全版本线（22.23.4 / 24.22.1，含 CVE-2026-105482 / 105483 / 106069 / 106072 / 111497）。仓库根目录已放 `.nvmrc`（`24.22.1`），Workers Builds 会自动识别并覆盖默认版本，无需在 Dashboard 配置 `NODE_VERSION`。CI 与本地同用 24.22.1。

### 运行时 Secret

Workers Builds 的 Build variables/secrets 只作用于构建阶段，不会注入运行时。`ADMIN_TOKEN`、`ENCRYPTION_KEY` 需在 Worker 的 Settings → Variables & Secrets 里添加为 **Secret** 类型（或部署后在仓库根执行 `npx wrangler secret put ADMIN_TOKEN`），否则管理接口按 fail closed 返回 503。

### Preview（非生产分支）构建

非 `main` 分支由 `npx wrangler preview` 部署，结果会挂到 PR 的检查项上。注意 Preview 环境**不继承**生产配置：根配置的 `previews` 块目前为空，预览实例因此没有 KV、`APP_NAME` 与 Secret，页面能打开但功能不完整。要让它可用：

- 建一个独立的预览 KV，写进 `previews.kv_namespaces`（不要指向生产 KV，避免预览分支写入生产数据）。
- `npx wrangler preview base-config secret put ADMIN_TOKEN` / `ENCRYPTION_KEY`。

不需要分支预览时，可在 Settings → Build → Branch control 关闭 Enable Preview Builds。

### 注意事项

- Cron `0 */12 * * *` 由 `wrangler.jsonc` 声明，随每次部署注册，无需额外配置。
- 每次 push 到 `main` 都会触发一次构建与部署，注意 Free 计划的构建额度与时长。
- 部署后仍按上文「第 2 步：部署后验证」复核，尤其是重定向逐跳 SSRF 校验与 Cron 触发两项。
- Preview（`npx wrangler preview`）同样会读到占位符 KV id，需要时在 Preview command 里用同样的方式注入 `SUBBOOST_KV_ID`，或按 `previews.kv_namespaces` 配置独立的预览 KV。
- 本地 `npm run worker:deploy` 与 Workers Builds 部署的是同一个 Worker，两种方式可并存；同名 Worker 以后部署的为准，属正常覆盖行为。
- 本地开发：`wrangler dev` 通过 `--config ../wrangler.jsonc` 读取根配置，`.dev.vars` 因此位于**仓库根目录**，`worker/.dev.vars` 不再被读取。

## 说明

- 节点解析与 YAML 生成复用 `@subboost/core`，输出与 `local/` 应用一致。
- 生成配置为 `UserConfig` 结构的 JSON，管理页以 JSON 文本框编辑。
- Free 计划每请求 CPU 限制较紧，建议使用 Workers Paid 计划，并依赖 Cron 预生成缓存。
- v1 不支持 Surge / Loon / QuantumultX 配置行作为输入源。
