<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <img src="./docs/assets/logo.svg" width="96" alt="SubBoost 图标">
</p>

<h1 align="center">SubBoost Worker Lite</h1>

<p align="center">把多个上游订阅与手动节点聚合成一条 Clash/Mihomo 链接，只跑在 Cloudflare Workers 与 Workers KV 上，不需要服务器、数据库或容器。</p>

<p align="center">
  <a href="./README.en.md">English</a> | <a href="./README.md">简体中文</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Cloudflare%20Workers%20%2B%20KV-4B5563?style=flat-square" alt="平台：Cloudflare Workers + KV">
  <img src="https://img.shields.io/badge/version-0.14.1-F59E0B?style=flat-square" alt="Version 0.14.1">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-22C55E?style=flat-square" alt="License: AGPL-3.0-only"></a>
  <img src="https://img.shields.io/badge/Node-%3E%3D22.23.4-3776AB?style=flat-square" alt="Node 版本要求">
</p>
<!-- markdownlint-enable MD033 MD041 -->

**SubBoost Worker Lite** 是 [SubBoost](https://github.com/SubBoost/subboost) 的精简部署形态。订阅源与手动节点存放在 Workers KV 中，对外只暴露一条 Clash/Mihomo 订阅链接：自己一个人用，也只维护这一个 URL，不需要服务器、数据库或容器。

## 核心亮点

| 亮点 | 为什么重要 |
| --- | --- |
| 一条链接交付全部节点 | 多个上游订阅与手动节点合并后统一去重（`packages/core` 的 `dedupeParsedNodes`），客户端只填一个订阅地址 |
| 不需要服务器、数据库或容器 | 逻辑全在同一个 Worker 里，状态放 Workers KV；Cron `0 */12 * * *` 提前抓取上游，订阅请求多数直接命中 KV 里的缓存 |
| 落库字段静态加密 | 订阅 token 等字段以 AES-256-GCM 加密，密钥由 `ENCRYPTION_KEY` 经 HKDF-SHA256 派生 |
| 抓取上游有防护 | 协议与凭据校验、私网网段拦截、重定向逐跳复核（默认上限 3 跳、超时 15 秒、单次最多 10 MB） |
| 交付形态可选 | 明文 YAML、age 密文（`?format=age`、`age-armor`）、客户端深链（`?target=`），或 8 字符短链 `/s/<code>` |
| 管理端就在 Worker 里 | token 保护的 SPA：源与订阅管理、刷新状态；分流组、链式代理、规则与规则集可视化编辑，也能直接改 JSON |

## 架构

```text
        ┌──────────────┐                          ┌──────────────────┐
        │ Clash/Mihomo │                          │ Admin SPA        │
        │ client       │                          │ worker/dist      │
        └──────┬───────┘                          └────────┬─────────┘
               │ GET /sub/<token>                          │ /api/* + Bearer token
               │ ?format= | ?target=                       │
               ▼                                           ▼
┌──────────────┬───────────────────────────────────────────┬─────────┐
│ Cloudflare Worker · worker/src                                     │
│ ADMIN_TOKEN auth · refresh · Clash/Mihomo YAML output              │
│ API: cache-control no-store · subscription: private, no-cache      │
└──────────────┬───────────────────────────────────────────┬─────────┘
               │ read / write                              │ fetch upstream
               ▼                                           ▼
┌──────────────┬───────────┐          ┌────────────────────┬───────┐
│ Workers KV · SUBBOOST_KV │          │ Upstream subscriptions     │
│ AES-256-GCM at rest      │          │ SSRF checks · 3 redirects  │
└──────────────▲───────────┘          └────────────────────────────┘
               │ write
┌──────────────┴─────────┐
│ Cron 0 */12 * * *      │
└────────────────────────┘
```

客户端不直接访问上游：Worker 抓取并合并结果写入 KV，`/sub/<token>` 从这份缓存返回。

## 使用示例

同一条订阅有五种取法，`/sub/<token>` 与短链 `/s/<code>` 行为完全一致：

| 请求 | 返回 |
| --- | --- |
| `GET /sub/<token>` | Clash/Mihomo YAML，带 ETag，支持 304 |
| `GET /sub/<token>?format=age` | age v1 二进制密文 |
| `GET /sub/<token>?format=age-armor` | 同上，改为 ASCII armor 文本 |
| `GET /sub/<token>?target=<app>` | 302 到客户端深链 |
| `GET /s/<code>` | 8 字符短链，输出与原链接一致 |

`<app>` 可取 `clash`、`stash`、`shadowrocket`、`singbox`、`v2rayng`、`hiddify`：

```text
https://<your-worker>/sub/<token>?target=clash
```

服务端只校验一次订阅是否存在，再把同一条链接（自动去掉 `target`）塞进对应 App 的深链并 302 过去；未知的 `target` 会被忽略，按普通订阅请求返回 YAML。微信、QQ 等应用内浏览器通常会拦截自定义 scheme，拉不起来时改用复制链接。

age 交付需要先在 Worker 上配 `AGE_RECIPIENT`（`age1…` 收件公钥），拉到的密文只有持有对应私钥的人能解开；完整步骤、密钥管理与解密流程见 [docs/age-encryption.md](./docs/age-encryption.md)。

## 快速安装

三条路线最终都落在同一个由 `SUBBOOST_KV` 支撑的 Worker 上，选一条即可。

### 方式 A：fork 本仓库后在 Cloudflare 绑定 GitHub 仓库

希望推送即自动重新部署时用这条。

1. 把本仓库 fork 到你自己的 GitHub 账号。
2. Cloudflare 控制台：Workers & Pages → Create → Import a repository，选择你 fork 的仓库，Production branch 填 `main`。
3. Root directory 保持 `/`，Build command 留空（安装依赖时 `prepare` 会构建管理端）。Deploy command 填 `npm run deploy`。
4. 按下方「配置」添加两个 Secret。之后每次推送 `main` 都会重新构建并部署。

`npm run deploy` 会调用 `node scripts/deploy-worker.cjs`：按标题复用或新建 `SUBBOOST_KV`，把真实 id 注入临时配置后部署。不要换成裸的 `npx wrangler deploy` —— 仓库里的 `wrangler.jsonc` 只保留 KV id 占位符，直接部署会报错。

### 方式 B：一键部署按钮

<a href="https://deploy.workers.cloudflare.com/?url=https://github.com/G1oow/SubBoost-Worker-Lite"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare" height="32"></a>

Cloudflare 会把本仓库复制到你自己的 GitHub 账号下，按仓库的 `wrangler.jsonc` 创建 Worker 与 KV 绑定。部署完成后按下方「配置」补两个 Secret。

### 方式 C：本机命令部署

```bash
npx wrangler login
ADMIN_TOKEN=<32 位以上随机串> ENCRYPTION_KEY=<32 位以上随机串> npm run worker:deploy
```

PowerShell 下先设置 `$env:ADMIN_TOKEN` 与 `$env:ENCRYPTION_KEY`，再执行 `npm run worker:deploy`。脚本会拒绝占位值或过短的密钥，按标题复用或新建 `SUBBOOST_KV`，把真实 id 注入临时配置，上传两个 Secret 后部署；仓库里的 `wrangler.jsonc` 始终保留占位符 id。

方式 A、B 需要手工添加的两个 Secret，都可以用同一条命令生成：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## 快速开始

本地跑起来不需要 Cloudflare 账号，前置为 Node.js 24.22.1（见 `.nvmrc`；`engines` 允许 `>=22.23.4 <23 || >=24.22.1`）与 npm：

```bash
npm ci
cp .dev.vars.example .dev.vars   # 填入随机 ADMIN_TOKEN 与 ENCRYPTION_KEY（各 32 位以上）
npm run worker:build
npm run worker:dev               # http://127.0.0.1:8787
```

PowerShell 下第二步换成 `Copy-Item .dev.vars.example .dev.vars`。

打开 `http://127.0.0.1:8787`，用你配置的 `ADMIN_TOKEN` 登录，添加一个上游源，再创建订阅。订阅以 Clash/Mihomo YAML 的形式从 `/sub/<token>` 输出，把这条链接填进客户端即可。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run worker:dev` | 本地运行 Worker（端口 8787） |
| `npm run worker:build` | 构建管理端到 `worker/dist` |
| `npm run worker:deploy` | 构建、建/绑 KV、上传 Secret、部署 |
| `npm run worker:deploy:dry-run` | 只校验配置与绑定，不上传 |
| `npm run worker:typecheck` | Worker 与管理端类型检查 |
| `npm run test:unit` | 全量单元/回归测试 |
| `npm run lint` | ESLint、UI 一致性、仓库卫生、版本校验 |

## 配置

两个 Secret 缺一不可，在 Worker → Settings → Variables and Secrets 里以 Secret 类型添加：

| 名称 | 类型 | 作用 |
| --- | --- | --- |
| `ADMIN_TOKEN` | Secret | 管理端登录 token，至少 32 位随机串 |
| `ENCRYPTION_KEY` | Secret | KV 落库字段的加密密钥（AES-256-GCM），至少 32 位随机串 |
| `AGE_RECIPIENT` | 变量（可选） | age 收件公钥 `age1…`，逗号或空白分隔可配多把；留空则不启用加密输出 |
| `AGE_ONLY` | 变量（可选） | 设为 `1` 时只输出 age 密文，明文订阅入口与一键导入返回 403 |

两个 Secret 缺失时管理接口按 fail closed 返回 503；事后更换 `ENCRYPTION_KEY` 会导致已有数据无法解密，需要重新录入源与订阅。

## 部署与运维

部署后验证步骤与常见报错见 [worker/README.md](./worker/README.md)。

想额外挂一个只用于展示的在线预览时，仓库根目录的 `vercel.json` 已经配好：构建命令 `node scripts/build-vercel-demo.cjs`，输出 `worker/dist`，演示开关由构建脚本强制开启并在产物里校验，不需要在 Vercel 控制台配环境变量，也不需要任何密钥。演示站数据只存在于浏览器内存，刷新即重置。

## 文档

| 主题 | 内容 | 链接 |
| --- | --- | --- |
| 部署与运维 | 手动部署步骤、部署后验证、fork / Workers Builds 流程、常见报错 | [worker/README.md](./worker/README.md) |
| age 加密交付 | 密钥生成、`AGE_RECIPIENT` 配置、本地解密与常见问题 | [docs/age-encryption.md](./docs/age-encryption.md) |
| 实施方案 | Workers-only 形态的设计取舍 | [docs/implementation/cf-worker-lite-plan.md](./docs/implementation/cf-worker-lite-plan.md) |
| 构建手册 | 移植过程中处理的冲突与验收记录 | [docs/implementation/cf-worker-lite-build.md](./docs/implementation/cf-worker-lite-build.md) |
| 贡献指南 | Issue / PR 规则、本地校验、UI 颜色约定 | [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) |
| 前端规范 | 分层归属、样式令牌、组件用法、动效、已知前端坑与守护测试 | [docs/frontend-guidelines.md](./docs/frontend-guidelines.md) |
| 第三方声明 | 依赖与生态归属说明 | [docs/THIRD_PARTY_NOTICES.md](./docs/THIRD_PARTY_NOTICES.md) |

## 参与贡献

Issue 与 PR 规则、本地校验要求见 [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md)。提交前至少跑完 `npm run lint`、`npm run test:unit`、`npm run worker:typecheck`、`npm run worker:build`。

## 社区与支持

- 使用问题、缺陷与功能建议请开 [GitHub Issue](https://github.com/G1oow/SubBoost-Worker-Lite/issues)。
- 感谢 [linux.do](https://linux.do) 社区在讨论与反馈中给出的建议，这套精简部署形态因此得以成形。
- 本项目基于上游 [SubBoost](https://github.com/SubBoost/subboost)，`packages/` 里的解析、清洗与配置生成逻辑源自该项目的实现。

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=G1oow%2FSubBoost-Worker-Lite&type=Date)](https://star-history.com/#G1oow/SubBoost-Worker-Lite&Date)

## 许可证

[GNU Affero General Public License v3.0 only](./LICENSE)。

如果你修改本仓库并向网络用户提供服务，AGPL-3.0 要求你向这些用户提供对应的源代码。

## 免责声明

本项目不提供任何代理服务，不对第三方订阅内容的可用性与合法性作任何保证。
