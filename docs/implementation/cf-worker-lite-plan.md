# SubBoost Worker Lite 实施方案（Plan）

| 项目 | 内容 |
| --- | --- |
| 文档角色 | 需求、架构与已确认技术决策的唯一依据 |
| 配套文档 | [cf-worker-lite-build.md](./cf-worker-lite-build.md)（执行手册、任务拆分、验收跟踪） |
| 基线提交 | `a7177d7`（main，工作区干净） |
| 编写日期 | 2026-10-12 |
| 状态 | 已确认，待实施 |

> 若实施过程中发现本文档与 Build 文档冲突，必须在 Build 文档「冲突记录」中登记，不得悄悄选择更方便的一方。

---

## 1. 项目背景与目标

### 1.1 现状与问题

SubBoost 当前的自托管形态是 `local/` 下的 Next.js 16 应用，依赖 PostgreSQL、Prisma 7、Node 22 和一个 curl 定时容器（见 `local/docker-compose.yml`）。它面向多订阅、多模板、规则库索引、自动更新失败追踪等完整功能。对「个人使用、只需要把几个上游订阅聚合成一条链接」的场景，这套部署的资源与运维成本过高。

此前已评估过把整个 `local/` 应用迁到 Cloudflare Workers 的路线（OpenNext + Hyperdrive + 外部 PostgreSQL）。该路线保留全部功能，但需要付费计划、外部数据库和约两周改造，与「个人极简」目标不匹配。

### 1.2 要解决的问题

提供一个只依赖 Cloudflare Workers 与 Workers KV 的精简部署形态，满足：

- 聚合多个上游订阅与手动节点，生成 Clash/Mihomo 订阅链接。
- 每 12 小时自动刷新上游。
- 管理端由访问 token 保护。
- 订阅链接具备防泄漏能力。

### 1.3 预期结果

- 仓库新增 workspace `worker/`，`wrangler deploy` 后得到一个可用的 Worker。
- 管理页复用 SubBoost 现有 UI 组件与主题，视觉与 `local/` 应用一致。
- 节点解析与配置生成复用 `packages/core`，输出质量与 `local/` 应用一致。
- 现有 `local/` 应用与 `packages/*` 的行为不受影响。

### 1.4 本次实施范围

| 编号 | 范围内 |
| --- | --- |
| S1 | Worker 后端：管理 API、订阅输出端点、Cron 刷新、KV 数据层 |
| S2 | 管理端 SPA：token 门、源管理、订阅链接管理、生成配置编辑、状态与手动刷新 |
| S3 | 安全：管理 token 鉴权、订阅 token 设计、静态加密、SSRF 校验、响应头 |
| S4 | 工程接入：workspace 注册、根 lint 与 vitest 覆盖、类型检查、部署说明 |

### 1.5 明确排除（非目标）

| 编号 | 不做 | 原因 |
| --- | --- | --- |
| N1 | 多用户、注册、角色 | 个人使用 |
| N2 | PostgreSQL、D1、Prisma、Hyperdrive | 决策 D2 |
| N3 | OpenNext 迁移 `local/` 应用 | 不属于精简版 |
| N4 | 规则库远程索引刷新（对应 `local/app/api/cron/update-rule-index/route.ts`） | 不需要 |
| N5 | 模板库 CRUD、节点测速、Telegram 通知 | 不需要 |
| N6 | Surge / Loon / QuantumultX 配置行格式作为输入源 | 决策 D7 |
| N7 | 自动更新失败计数、配额停用等逻辑（`packages/server-core/src/subscription/auto-update-*.ts`） | 以 12 小时固定刷新替代 |
| N8 | 订阅端点限流 | 决策 D10 |
| N9 | 与 `local/` 应用之间的数据迁移或密文互通 | 决策 D6 |
| N10 | 节点名前缀、节点名模板等输出美化 | 后续可加 |

---

## 2. 需求与行为规范

### 2.1 术语

| 术语 | 含义 |
| --- | --- |
| Source（源） | 一个上游输入。`remote` 类型是 http(s) 订阅 URL；`manual` 类型是一段节点链接文本 |
| Subscription（订阅） | 一条对外分发的订阅链接，由 token 标识，绑定若干 Source |
| Config（生成配置） | 传给 `buildGenerateOptionsFromConfig` 的原始 JSON，结构等同 `packages/core` 的 `UserConfig` |
| Snapshot（快照） | 某个 Source 最近一次成功解析得到的节点列表，KV key `nodes:<sourceId>` |
| Cache（缓存） | 某条 Subscription 最近一次生成的 YAML，KV key `cache:<subId>` |
| 管理 token | Worker Secret `ADMIN_TOKEN`，管理 API 的唯一凭证 |
| 订阅 token | 每条 Subscription 的随机凭证，出现在订阅 URL 中 |

### 2.2 功能与行为

#### F1 管理端鉴权

- 除 `GET /api/health` 外，所有 `/api/*` 请求必须携带 `Authorization: Bearer <ADMIN_TOKEN>`。
- 比较必须是常量时间比较（见 Build 文档 `auth.ts` 契约）。
- 缺失或不匹配：`401 {"error":"Unauthorized","code":"UNAUTHORIZED"}`。
- `ADMIN_TOKEN` 未配置或为空：`503 {"error":"...","code":"CONFIGURATION_ERROR"}`，即 fail closed。
- 前端：无 token 时显示 token 输入页；token 保存在 `localStorage` 键 `subboost-worker-admin-token`；每个 API 请求附带 Bearer 头；收到 401 时清除本地 token 并回到输入页。
- 前端不得把 token 写进 URL、cookie 或页面 HTML。

#### F2 源管理

- 字段：`id`、`name`（1 到 80 字符）、`kind`（`remote` 或 `manual`）、`url`（remote 必填）、`manualText`（manual 必填，不超过 512 KiB）、`enabled`（默认 true）、`userAgent`（remote 可选，1 到 200 字符）。
- 校验：
  - remote：URL 必须可解析，协议只允许 `http:` 或 `https:`，不允许包含用户名密码，必须通过 F8 的 SSRF 校验。
  - manual：文本经 `parseSubscription` 解析后必须得到至少 1 个节点，否则拒绝并返回解析错误摘要。
- 保存采用全量替换（`PUT /api/sources`），最多 50 个源。
- `url` 与 `manualText` 以密文落 KV（决策 D6）；管理 API 读取时解密返回，供管理页展示。
- 被删除的源对应的 `nodes:<sourceId>` 快照应在保存时删除（尽力而为，失败不影响保存结果）。

#### F3 订阅管理

- 创建：`name`（1 到 80 字符）、`sourceIds`（可选；空数组或缺省表示「全部启用的源」）。最多 20 条。
- 创建时生成订阅 token：32 字节随机数的 base64url 编码，无填充，固定 43 个字符。
- 订阅链接格式：`<请求 origin>/sub/<token>`。
- 删除：删除订阅记录、token 索引、缓存。
- 轮换：生成新 token，旧链接立即失效。
- KV 中不存明文 token 作为 key；查找通过 `tokidx:<sha256(token)>` 索引完成；明文 token 以密文存于订阅记录供管理页回显链接。

#### F4 生成配置

- 默认值为 `buildDefaultUserConfig("standard")`（`packages/core/src/config/defaults.ts`）。
- `PUT /api/config`：请求体必须是 JSON 对象，否则 `400 VALIDATION_ERROR`；保存后所有缓存视为过期（通过配置哈希失配触发重新生成，见 F6）。
- `DELETE /api/config`：恢复默认。
- `POST /api/config/preview`：请求体 `{ config }`，用草稿试生成一次并返回规则、代理组与节点计数；只读——节点取自全部已启用源的现有快照，不抓上游、不写快照/缓存/状态；生成失败（如基础 YAML 写错）返回 `400 VALIDATION_ERROR`。
- 管理页分「规则 / 链式代理 / 高级 JSON」三个子页（`#/config/rules`、`#/config/chains`、`#/config/json`），共用一份草稿、只有一个保存：
  - 规则子页编辑分流组开关（🚀 节点选择、🐟 漏网之鱼锁定为开启）、内置规则的启停与目标（`builtinRuleEdits`）、自定义规则、自定义规则集（离线规则库或 .mrs 链接）与批量导入；规则目标限于已开启的分流组与 DIRECT/REJECT。
  - 列表即最终规则（带生成行号）：只有自定义规则/规则集可移动，可插到任意两条内置规则之间，内置规则之间的相对顺序固定；顺序有变化时写回覆盖全部模块（含未开启模块）的完整 `ruleOrder`。
  - 可视化只改自己负责的字段，其余字段原样保留；JSON 语法错误时不能切回可视化，也不能保存；有未保存的修改时离开页面需要确认，「恢复默认」需要确认。
- 页面分「规则 / 链式代理 / 高级 JSON」三个子页（`#/config/rules|chains|json`），共用一份草稿、只有一个保存：
  - 链式代理子页（v0.11.0）编辑顶层 `proxyChains: ProxyChain[]`，每条链一张三段卡片（前置 → 落地 → 出口组），带序号、上下移动、启停与删除确认；旧的 `dialerProxyGroups` 保持原样继续生效，界面上只读展示并提示可在高级 JSON 里编辑。
  - 链是严格两跳：选择器按「源 + include/exclude 正则」选节点（`sourceIds` 为空 = 全部已启用源，正则为空 = 不限制），每条启用的链生成出口组（组名即链名，默认 `select`，成员是落地节点）与「<链名> · 前置」组（默认 `url-test`，成员是前置节点），落地节点的 `dialer-proxy` 指向前置组。
  - 落地节点只能经出口组到达：其他分组的成员列表里，落地节点被出口组在原地顶替；⚡ 自动选择只剔除落地、不放入出口组（否则自动测速会退化成手选）。前置节点不做收敛，仍可直接单跳使用。
  - 冲突在生成期消解、不拦保存：落地优先且靠前的链优先；任何链的落地都不会再被别的链当作前置（否则落地会经自己中转）。落地为空则整条链不生成；前置为空则前置组只放 `REJECT`，让链路显式失败而不是被 mihomo 当成直连。出口组/前置组与既有分组重名时该链跳过并给出原因。
- 生成时持久化顺序里缺失的内置规则插回规范位置（紧贴其后第一条已在顺序里的内置规则之前），不再追加到 `geolocation-!cn` 之后。
- `POST /api/config/preview` 额外返回 `chains`：每条链的前置/落地匹配数、出口组与前置组名、状态（`ok` / `empty-relay` / `empty-landing` / `disabled` / `invalid-regex` / `name-conflict` / `invalid`）与原因；预览与订阅生成共用同一份「已占用组名」集合，避免界面显示可生成、实际被跳过。

#### F5 刷新管线

触发方式有三种，行为一致：

1. Cron Trigger：`0 */12 * * *`，即 UTC 每天 00:00 与 12:00。
2. 手动：`POST /api/refresh`。
3. 按需：`GET /sub/<token>` 未命中缓存时，只生成这一条订阅，并对缺少快照的源做即时抓取。

管线行为：

- 只处理 `enabled` 为 true 的源。
- 并发不超过 4；单次请求超时 15 秒；对网络错误与状态 500、502、503、504、429 重试 2 次，退避 1 秒、2 秒；响应体上限 10 MiB。
- remote 源：按 F8 做 SSRF 校验与手动重定向；成功后用 `parseSubscription` 解析；同时读取上游 `subscription-userinfo` 头保存到快照。
- manual 源：直接解析存储的文本。
- 保护性快照：解析得到 0 个节点或抓取失败时，不覆盖已有快照，仅在状态中记录错误。
- 合并快照时给每个节点写入 `_sourceIds`（先记源再套用改名），供链式代理与分流组高级配置的按源过滤使用；`_` 前缀字段在 YAML 序列化时被丢弃，不会进订阅。陈旧源 id 不参与限定（命中不到现存源就不算过滤），避免删源后的旧配置把整组节点打空。
- 每个源的快照写入 `nodes:<sourceId>`，TTL 7 天。
- 所有源处理完后，对每条订阅重新生成 YAML 写入 `cache:<subId>`，TTL 48 小时。
- 生成规则：按订阅的 `sourceIds` 顺序（空表示全部启用源按保存顺序）合并快照，按 `buildNodeContentKey` 去重保留首次出现，再调用 `generateClashYaml(buildGenerateOptionsFromConfig(config, { nodes }))`。节点重名由生成器内部 `ensureUniqueProxyNames` 处理。
- 写入 `meta:status`：本次触发方式、开始时间、耗时、每个源的结果、每条订阅的结果。
- 并发保护：`meta:refresh-lock`（TTL 600 秒）尽力避免 Cron 与手动刷新重叠；持锁时手动刷新返回 `409 REFRESH_IN_PROGRESS`。KV 不提供原子性，该锁只是尽力而为，重叠的后果仅是重复抓取。
- 软截止：单次刷新从开始计 12 分钟后不再发起新的抓取，已发起的等待完成；保证在 Cron 的 15 分钟墙钟上限内结束。

#### F6 订阅输出 `GET /sub/<token>`

- 支持 `GET` 与 `HEAD`。
- 查找 `tokidx:<sha256(token)>`；不存在则 `404`，响应体固定为 `Not found`，不区分「token 不存在」与「订阅已删除」。
- 命中 `cache:<subId>` 且其 `configHash` 等于当前配置哈希：直接返回缓存 YAML。
- 否则按 F5 的按需方式生成；生成后写缓存再返回。
- 可用节点为 0：`503`，响应体固定为 `No nodes available`，附 `Retry-After: 600`。
- 成功响应头由 `buildSubscriptionResponseHeaders`（`packages/server-core/src/subscription/response-headers.ts`）生成，参数固定为 `cacheControl: "no-store"`、`cacheExpirySeconds: 43200`、`autoUpdateIntervalSeconds: 43200`、`isAdmin: false`，因此 `profile-update-interval` 为 `12`。
- `subscription-userinfo`：仅当订阅涉及的所有 remote 源都提供了 `upload`、`download`、`total` 时才输出，三者求和，`expire` 取最小值；否则不输出该头。上游的 `profile-web-page-url` 与 `plan-name` 一律不透传。
- 附加响应头：`X-Content-Type-Options: nosniff`、`X-Robots-Tag: noindex`。

#### F7 状态与健康

- `GET /api/state` 一次返回：应用信息、源列表（解密后）、订阅列表（含完整链接）、当前配置与是否为默认、最近一次状态。
- `GET /api/health`：`200 {"ok":true}`，无鉴权，不包含任何配置信息。

#### F8 防泄漏与 SSRF

防泄漏（可观察行为）：

- 所有 `/api/*` 与 `/sub/*` 响应携带 `Cache-Control: no-store`。
- 日志不输出 token、上游 URL、节点内容；状态记录中的错误信息去掉 URL 的 query 与 userinfo，长度截断到 200 字符。
- `url`、`manualText`、订阅 token 以 AES-256-GCM 密文落 KV。
- 订阅 token 可轮换；轮换后旧 token 立即 404。
- 管理页 HTML 与 JS 中不内嵌任何密钥。
- 输出 YAML 中不包含上游订阅 URL；`subscription-userinfo` 只给聚合数字。

SSRF 校验（remote 源与每一跳重定向）：

- 协议只允许 `http:`、`https:`；禁止 URL 内含用户名密码。
- 主机名拦截：`localhost`、`*.localhost`、`*.local`、`*.internal`、`metadata.google.internal`。
- IPv4 字面量拦截：`0.0.0.0/8`、`10.0.0.0/8`、`100.64.0.0/10`、`127.0.0.0/8`、`169.254.0.0/16`、`172.16.0.0/12`、`192.0.0.0/24`、`192.0.2.0/24`、`192.88.99.0/24`、`192.168.0.0/16`、`198.18.0.0/15`、`198.51.100.0/24`、`203.0.113.0/24`、`224.0.0.0/4`、`240.0.0.0/4`。
- IPv6 字面量拦截：`::`、`::1`、`fc00::/7`、`fe80::/10`、`fec0::/10`、`ff00::/8`、`::ffff:0:0/96` 映射地址按其 IPv4 规则判断、`64:ff9b::/96`、`2002::/16`。
- 重定向：`redirect: "manual"`，最多 3 跳，每跳重新校验；超过或校验失败即失败。
- 平台层面 Workers 本身不允许访问私网与 Cloudflare 内部地址，上述校验是应用层的第二道防线。

#### F9 定时触发

- Cron 表达式 `0 */12 * * *`。
- `scheduled()` 处理器只调用 F5 管线，触发方式记为 `cron`。
- 间隔不少于 1 小时，因此落在 Workers 为 Cron 分配的 15 分钟 CPU 档；墙钟上限 15 分钟。

### 2.3 数据格式

类型定义以 Build 文档「实现细节与接口契约」为准，这里给出字段语义。

| 类型 | 字段 |
| --- | --- |
| `StoredSource` | `id`、`name`、`kind`、`payloadEnc`（remote 为 URL 密文，manual 为文本密文）、`enabled`、`userAgent?`、`createdAt`、`updatedAt` |
| `StoredSubscription` | `id`、`name`、`tokenHash`（sha256 hex）、`tokenEnc`、`sourceIds`、`createdAt`、`updatedAt` |
| `SnapshotRecord` | `sourceId`、`nodes`（`ParsedNode[]`）、`nodeCount`、`fetchedAt`、`userInfo?`、`parseErrors`（最多保留 20 条） |
| `CacheRecord` | `subscriptionId`、`yaml`、`nodeCount`、`generatedAt`、`configHash` |
| `StatusRecord` | `lastRunAt`、`lastTrigger`、`durationMs`、`sources[]`、`subscriptions[]` |

API 响应中的 DTO 不包含 `payloadEnc`、`tokenEnc`、`tokenHash`；源 DTO 包含解密后的 `url` 或 `manualText`；订阅 DTO 包含 `link`。

错误响应体统一为 `{ "error": string, "code": string }`，与 `packages/server-core/src/http.ts` 的 `buildApiErrorBody` 一致。错误码集合：`BAD_REQUEST`、`VALIDATION_ERROR`、`UNAUTHORIZED`、`NOT_FOUND`、`CONFLICT`、`PAYLOAD_TOO_LARGE`、`CONFIGURATION_ERROR`、`UPSTREAM_ERROR`、`INTERNAL_ERROR`。

### 2.4 边界条件与异常流程

| 场景 | 行为 |
| --- | --- |
| 没有任何源 | `/sub` 返回 503；管理页提示先添加源 |
| 所有源抓取失败且无历史快照 | `/sub` 返回 503；状态记录每个源的错误 |
| 部分源失败 | 使用失败源的历史快照（若有）继续生成；状态标记失败源 |
| 上游响应超过 10 MiB | 该源失败，错误 `响应超过大小上限` |
| 上游重定向到私网 | 该源失败，错误 `目标地址不允许` |
| 上游内容无法解析 | 该源失败，保留旧快照，错误含 `parseSubscription` 的前几条错误摘要 |
| 配置 JSON 非法导致生成抛错 | `/sub` 若有旧缓存则返回旧缓存；无缓存返回 500，响应体固定为纯文本 `Internal error`；状态记录错误；错误信息经脱敏 |
| 轮换 token 时客户端正在使用旧链接 | 旧链接立即 404，属预期 |
| KV 写入失败 | API 返回 `500 INTERNAL_ERROR`；刷新管线记录错误并继续处理其他项 |
| Cron 与手动刷新重叠 | 后者返回 409；极端情况下锁失效导致重复抓取，可接受 |
| `ENCRYPTION_KEY` 更换 | 已有密文无法解密；管理 API 返回 `500 INTERNAL_ERROR` 并提示重新录入源与订阅；不做自动迁移 |

### 2.5 用户可观察的变化

- 新增一个独立部署目标 `worker/`；根 `package.json` 新增 `worker:*` 脚本。
- 根 `npm run lint` 与 `npm run test:unit` 覆盖 `worker/`。
- `local/` 应用、`packages/*`、Docker 部署流程无任何行为变化。

### 2.6 兼容性约束

- 不修改 `packages/core`、`packages/server-core`、`packages/ui`、`packages/config` 的任何源文件。
- 不修改 `local/` 下任何文件。
- 不改动 Prisma schema、Dockerfile、`docker-compose*.yml`、`.github/workflows/*`。
- 密文格式与 `local/` 应用的 `v2:` 格式互不兼容，属设计选择，不承诺迁移。
- 生成配置 JSON 结构与 `local/` 应用的 `UserConfig` 一致，但不承诺从 `local/` 导出的配置可直接粘贴使用。

---

## 3. 已确认的技术决策

| 编号 | 决策 | 原因 | 被排除的替代方案 |
| --- | --- | --- | --- |
| D1 | 部署为 Cloudflare Worker，静态资源用 Workers Static Assets，定时用 Cron Triggers | Worker 拥有原生 Cron、Static Assets 与 `run_worker_first` 路由控制 | Cloudflare Pages Functions：没有原生 Cron，需外部调度器或请求触发的惰性任务 |
| D2 | 存储只用一个 Workers KV namespace | 数据量极小，文档型读写足够 | D1：Prisma 适配器不支持事务、单行 2 MB 上限，对本范围无收益；PostgreSQL + Hyperdrive：需要外部数据库与付费计划 |
| D3 | 节点解析与配置生成直接 import `@subboost/core`；`@subboost/server-core` 只按文件路径 import 三个无 Node 依赖的模块 | `packages/core` 运行时只依赖 js-yaml、safe-regex2、peggy，无 `node:*` 引用，可直接运行于 workerd | 自写解析器：重复造轮子且输出质量不一致 |
| D4 | 管理端为 Vite + React 19 的 SPA，位于 `worker/ui/`，复用 `@subboost/ui/components/ui/*`、`@subboost/ui/lib/utils`、`@subboost/ui/theme/*` 与 `@subboost/ui/styles/globals.css` | 这些模块不依赖 `next/*`；视觉与 `local/` 一致 | 静态导出 `local/app/dashboard`：与 Prisma 数据形状和 Next 服务端能力耦合；OpenNext 全量部署：超出精简范围 |
| D5 | 管理鉴权为 `ADMIN_TOKEN` Bearer，前端存 `localStorage` | 单用户，无需会话、吊销与密码哈希 | Cookie 会话 + bcrypt + 用户表：过度设计；Cloudflare Access：可在部署层叠加，不纳入代码范围 |
| D6 | 静态加密用 WebCrypto AES-256-GCM，密钥由 HKDF-SHA256 从 `ENCRYPTION_KEY` 派生，密文格式 `v1:<iv>:<ciphertext+tag>`（base64url） | WebCrypto 是 workerd 原生能力，不经过 Node 兼容层 | 复用 `packages/server-core/src/crypto/encrypted-field.ts`：依赖 `node:crypto`，且与 `local/` 的数据本来就不互通 |
| D7 | v1 不支持 Surge / Loon / QX 配置行作为输入源 | `packages/core/src/parser/platform/peggy/*.js` 在运行时调用 `peggy.generate()`，内部依赖 eval，Workers 禁止动态代码生成 | 构建期预生成解析器：可行但属于后续任务，不阻塞 v1 |
| D8 | SSRF 防护为应用层主机名与 IP 字面量黑名单 + 手动重定向逐跳校验 | Workers 没有 `dns.lookup`，`node:http` 只是 fetch 包装，原生 socket 不能连 Cloudflare IP 段，因此 `local/src/lib/pinned-http.ts` 的固定 IP 方案无法等价实现 | DNS 预解析 + 固定 IP：平台不支持 |
| D9 | 刷新策略为 Cron 12 小时 + 手动 + 按需；快照与缓存采用保护性覆盖 | 用户明确只需 12 小时刷新一次 | 访问时惰性刷新：可用但行为不可预测 |
| D10 | v1 不做订阅端点限流 | 256 位随机 token 使枚举不可行 | Rate Limiting binding：可作为后续增强 |
| D11 | 工具链：wrangler 4、`@cloudflare/workers-types`、Vite 8 + `@vitejs/plugin-react` + `@tailwindcss/vite`；单元测试用根目录 vitest（Node 环境）加内存 KV 假实现 | 与仓库现有 vitest 4.1、vite 8.3、tailwindcss 4.3 对齐，不引入第二套测试运行器 | `@cloudflare/vitest-pool-workers`：增加依赖与配置，v1 不需要 |
| D12 | 推荐 Workers Paid 计划 | Free 计划每请求 10 ms CPU，对现场生成 YAML 偏紧 | 不限制在 Free 上运行，只做文档提示 |

### 3.1 不允许实现者自行更改的约束

- 不得修改 `local/**`、`packages/**`、`prisma/**`、`Dockerfile`、`docker-compose*.yml`、`.github/workflows/**`。
- 不得使用 `eval`、`new Function`、`vm`，不得在运行时调用 `peggy.generate`。
- 不得 import `packages/server-core` 的包根或 `subscription/index.ts` 等 barrel，只能按文件路径 import D3 列出的三个模块。
- 不得引入依赖 `node:fs`、`node:net`、`node:dns`、`node:child_process` 的包。
- KV key 命名、API 路径、错误体格式、密文格式按本文档与 Build 文档执行。
- 密钥只能来自 Worker Secret 或本地 `.dev.vars`，不得写入仓库。
- 管理页样式必须使用 `packages/ui/src/styles/theme.css` 的主题令牌类（如 `text-fg`、`bg-surface`、`border-ink/10`），根 `npm run lint` 中的 `check-ui-consistency` 会拒绝 `text-white/60` 之类的暗色专用类。

### 3.2 仍存在的不确定事项

| 编号 | 事项 | 阻塞性 | 处理 |
| --- | --- | --- | --- |
| U1 | `@vitejs/plugin-react` 当前版本（6.1.2）对 vite 8 的 peer 兼容性 | 非阻塞 | 安装时以 npm 解析结果为准，必要时选用声明兼容 vite 8 的版本 |
| U2 | Vite 中 `@import "@subboost/ui/styles/globals.css"` 的裸包路径能否解析 | 非阻塞 | 失败则改为相对路径 `../../../packages/ui/src/styles/globals.css` |
| U3 | 当前 wrangler 对静态资源目录内 `_headers` 文件的支持 | 非阻塞 | 不支持则改为 `run_worker_first: true` 并在 Worker 内设置响应头 |
| U4 | `eslint-config-next` 的规则是否会对 `worker/` 文件误报 | 非阻塞 | 仅在实际触发时为 `worker/**` 增加作用域覆盖 |
| U5 | workerd 下 `import * as peggy from "peggy"` 在模块求值阶段是否安全 | 非阻塞 | 预期安全（只有 `generate()` 使用 eval）；若失败，在 wrangler 构建中把 `peggy` 别名为空实现 |
| U6 | Free 计划下现场生成大订阅的 CPU 是否超限 | 非阻塞 | 以缓存为主；部署文档建议 Paid |
| U7 | `SubscriptionUserInfo` 的确切字段 | 非阻塞 | 实施时读取 `packages/core/src/subscription/subscription-userinfo.ts` |
| U8 | `wrangler dev --test-scheduled` 暴露的本地触发端点路径（本文按 `/__scheduled?cron=...` 编写，未在本次会话核实） | 非阻塞 | 以 `npx wrangler dev --help` 与当前版本文档为准 |
| U9 | wrangler 配置中模块别名字段 `alias` 的可用性（仅在 U5 失败时需要） | 非阻塞 | 以当前 wrangler 配置文档为准 |
| U10 | `@types/node` 与 `@cloudflare/workers-types` 在同一 tsconfig 中共存是否产生类型冲突（`packages/core/src/parser/base64.ts` 使用 `Buffer`，worker 的类型检查会引入该文件） | 非阻塞 | 冲突时在 worker tsconfig 内用最小 `declare` 补充 `Buffer` 类型，不改动 `packages/core` |

无阻塞性不确定事项。

---

## 4. 系统架构与模块职责

### 4.1 整体架构

```text
浏览器（管理页 SPA，worker/ui 构建产物）
   │  Authorization: Bearer <ADMIN_TOKEN>
   ▼
Cloudflare Worker（worker/src/index.ts）
   ├─ /api/*            管理 API（router.ts → 各 handler）
   ├─ /sub/<token>      订阅输出（pipeline.ts 按需生成或读缓存）
   ├─ 其他路径          静态资源（Workers Static Assets，SPA 回退到 index.html）
   └─ scheduled()       Cron 每 12 小时 → pipeline.refreshAll()
        │
        ▼
Workers KV（binding SUBBOOST_KV）
   ├─ meta:sources / meta:subs / meta:config / meta:status / meta:refresh-lock
   ├─ tokidx:<sha256(token)> → subscriptionId
   ├─ nodes:<sourceId>       源快照（TTL 7 天）
   └─ cache:<subId>          订阅 YAML（TTL 48 小时）
        │
        ▼（抓取上游时）
上游订阅 URL（经 ssrf.ts 校验，safe-fetch.ts 发起 fetch）
```

### 4.2 核心模块与职责

| 模块（计划路径） | 职责 | 依赖 |
| --- | --- | --- |
| `worker/src/index.ts` | 导出 `fetch` 与 `scheduled`；把请求交给 router；全局错误兜底 | router、pipeline |
| `worker/src/router.ts` | 路径与方法分发；调用 auth；调用 handler；统一响应头 | auth、http、store、pipeline |
| `worker/src/auth.ts` | 管理 token 校验（常量时间） | crypto |
| `worker/src/http.ts` | JSON 响应与错误响应、请求体限额读取、安全响应头 | `@subboost/server-core/http` |
| `worker/src/errors.ts` | `ApiError` 类型（status + code + message） | 无 |
| `worker/src/crypto.ts` | HKDF 派生、AES-GCM 加解密、sha256、随机 token、常量时间比较 | WebCrypto |
| `worker/src/ssrf.ts` | URL 与主机名校验（F8） | 无 |
| `worker/src/safe-fetch.ts` | 带 SSRF 校验的 fetch：手动重定向、超时、重试、大小上限 | ssrf |
| `worker/src/store.ts` | KV 读写封装：sources、subs、config、status、snapshot、cache、token 索引、锁 | crypto、types |
| `worker/src/sources.ts` | 单个源的抓取与解析，产出 `SnapshotRecord` | safe-fetch、`@subboost/core/parser` |
| `worker/src/pipeline.ts` | 刷新管线（F5）与订阅生成（F6）；聚合、去重、调用生成器、写缓存与状态 | store、sources、`@subboost/core/*` |
| `worker/src/types.ts` | 所有存储类型与 DTO | `@subboost/core/types/node` |
| `worker/src/env.d.ts` | `Env` 绑定类型 | `@cloudflare/workers-types` |
| `worker/ui/src/*` | 管理页 SPA | `@subboost/ui/*`、react |

### 4.3 数据流与关键调用

保存源（管理页 → Worker → KV）：

1. 管理页 `PUT /api/sources`，携带 Bearer。
2. `router` → `auth.requireAdmin` → `http.readJsonBody`（1 MiB 上限）。
3. 逐项校验（F2）；remote 走 `ssrf.validatePublicHttpUrl`；manual 走 `parseSubscription` 试解析。
4. `store.saveSources`：加密 payload，写 `meta:sources`；删除已移除源的 `nodes:*`。
5. 返回解密后的源列表 DTO。

定时刷新（Cron → Worker → 上游 → KV）：

1. `scheduled()` → `pipeline.refreshAll(env, deps, { trigger: "cron" })`。
2. 取锁 `meta:refresh-lock`；取 `meta:sources`、`meta:subs`、`meta:config`。
3. 以并发 4 对启用源调用 `sources.refreshSource` → `safe-fetch.fetchText` → `parseSubscription` → 写 `nodes:<id>`（0 节点或失败时不写）。
4. 对每条订阅调用 `pipeline.generateSubscription`：读快照、去重、`buildGenerateOptionsFromConfig` + `generateClashYaml`、写 `cache:<id>`。
5. 写 `meta:status`，释放锁。

订阅输出（客户端 → Worker → KV）：

1. `GET /sub/<token>` → `crypto.sha256Hex(token)` → `store.getSubscriptionIdByTokenHash`。
2. 读 `cache:<subId>`；比较 `configHash` 与当前配置哈希。
3. 命中则返回；否则 `pipeline.generateSubscription({ onDemand: true })`，对缺快照的源即时抓取。
4. 用 `buildSubscriptionResponseHeaders` 组装响应头后返回。

### 4.4 错误传播

- 业务层抛 `ApiError(status, code, message)`；`router` 捕获后输出 `{ error, code }`。
- 非 `ApiError` 异常：`index.ts` 兜底为 `500 INTERNAL_ERROR`，日志只打印错误名与简短消息。
- 刷新管线内部对每个源、每条订阅独立 try/catch，单项失败不终止整体；错误写入状态记录。

### 4.5 日志、安全、性能与资源

- 日志只包含事件名、id、计数与耗时；禁止输出 token、URL、节点内容。
- 安全响应头：API 与 `/sub` 由 Worker 设置；静态资源通过 `_headers` 文件设置（见 U3）。
- CPU：订阅输出走缓存时 CPU 开销极小；现场生成主要在 Cron 中完成，Cron 档位有 15 分钟 CPU。
- 出站连接：并发限制 4，低于平台每请求 6 个并发连接的上限。
- 资源释放：每次 fetch 使用 `AbortSignal.timeout`；读取超限时 `reader.cancel()`；不在全局作用域缓存请求级对象。

---

## 5. 项目现状与约束

### 5.1 已存在的相关实现（只读参考，不修改）

| 路径 | 作用 | 与本任务的关系 |
| --- | --- | --- |
| `local/src/lib/subscription-service.ts` 第 433 行 `generateSubscriptionYaml` | 解密 → `buildGenerateOptionsFromConfig` → `generateClashYaml` | 生成调用方式的参考模板 |
| `local/app/api/subscriptions/[id]/config.yaml/route.ts` | 公开订阅端点 | 响应头与错误处理的参考 |
| `local/src/lib/source-import.ts`、`local/src/lib/pinned-http.ts` | SSRF 校验与固定 IP 抓取 | 校验规则参考；固定 IP 部分不可移植（D8） |
| `local/src/lib/http.ts` | `readJsonBody(request, maxBytes)`、`apiError` | 请求体限额读取的参考写法；该文件依赖 `next/server`，不能直接 import |
| `local/src/lib/rate-limit.ts` | 进程内限流 | 不复用（D10） |
| `local/next.config.mjs` | 安全响应头清单 | 复用同一组头 |
| `local/app/layout.tsx` | 引入 `@subboost/ui/styles/globals.css`、`THEME_INIT_SCRIPT`、`<Toaster />`、`<html data-theme="dark">` | SPA `index.html` 与根组件按同样方式接入主题与 toast |
| `local/src/components/local-login.tsx` | 登录页布局与组件用法 | token 输入页的视觉参考；其 `next/image`、`next/link` 不可复用 |

### 5.2 可直接复用的模块（已核实无 `node:*` 依赖）

| 导入路径 | 导出 | 用途 |
| --- | --- | --- |
| `@subboost/core/parser` | `parseSubscription(content): ParseResult` | 解析上游内容与手动节点文本 |
| `@subboost/core/generator` | `generateClashYaml(options: GenerateOptions): string` | 生成 YAML |
| `@subboost/core/subscription/config-utils` | `buildGenerateOptionsFromConfig(rawConfig, { nodes, proxyProviders? })` | 配置转生成选项 |
| `@subboost/core/config/defaults` | `buildDefaultUserConfig(template)`、`DEFAULT_SUBBOOST_CONFIG` | 默认配置 |
| `@subboost/core/node-identity` | `buildNodeContentKey(node, opts?)`、`stableJsonStringify(value)` | 跨源去重、配置哈希 |
| `@subboost/core/subscription/subscription-response-info` | `normalizeSubscriptionResponseInfo`、`SubscriptionResponseInfo` | 聚合 userinfo |
| `@subboost/core/types/node` | `ParsedNode`、`ParseResult` | 类型 |
| `@subboost/core/types/config` | `TemplateType`、`UserConfig` | 类型 |
| `@subboost/server-core/subscription/response-headers` | `buildSubscriptionResponseHeaders(name, info, options)` | `/sub` 响应头 |
| `@subboost/server-core/http` | `buildApiErrorBody(error, code)` | 错误体 |
| `@subboost/server-core/subscription/user-agents` | `SUBSCRIPTION_IMPORT_USER_AGENTS` | 默认 UA 取其中 `mihomo/…` 项 |
| `@subboost/ui/components/ui/*`（除 `safe-image`） | Button、Input、Textarea、FormField、PasswordField、Card、Dialog、ConfirmDialog、Switch、SwitchField、Table、Tabs、Badge、IconButton、Select、Popover、ScrollArea、Toaster | 管理页 |
| `@subboost/ui/components/ui/toaster` | `useToast`、`toast`、`Toaster` | 提示 |
| `@subboost/ui/lib/utils` | `cn`、`readApiErrorMessage(res, fallback)` | 工具 |
| `@subboost/ui/theme/theme`、`@subboost/ui/theme/theme-init-script` | `applyTheme`、`getCurrentTheme`、`persistTheme`、`THEME_INIT_SCRIPT` 等 | 主题 |
| `@subboost/ui/styles/globals.css` | Tailwind 入口与主题令牌 | 样式 |

### 5.3 不得复用的模块及原因

| 路径 | 原因 |
| --- | --- |
| `packages/server-core/src/subscription/ssrf-ip.ts`、`doh-resolver.ts` | `import { isIP } from "node:net"` |
| `packages/server-core/src/crypto/*` | `node:crypto` |
| `packages/server-core/src/app-version.ts` | `node:fs` |
| `packages/server-core/src/index.ts`、`subscription/index.ts` | barrel 会把上述模块一起打进来 |
| `packages/ui/src/components/{layout,auth}/*`、`components/ui/safe-image.tsx`、`dashboard/*`、`product/*`、`templates/*` | 依赖 `next/*` |
| `local/src/lib/*` 全部 | 依赖 `next/*`、Prisma 或 `node:*` |

### 5.4 框架、依赖与版本（来自 `package.json` 与 `package-lock.json`）

| 项 | 值 |
| --- | --- |
| Node | `>=22.13.0 <23 \|\| >=24.0.0`；CI 使用 22.19.0 |
| 包管理 | npm workspaces（`packages/*`、`local`） |
| TypeScript | `^6.0.3` |
| React | 19.2.7 |
| Vite（锁文件已有） | 8.3.0 |
| Vitest | 4.1.11 |
| Tailwind | 4.3.0，经 `@tailwindcss/postcss` |
| js-yaml | `^4.3.2` |
| peggy | `^5.1.0` |
| 新增（worker 包内声明，当前 npm 最新） | wrangler 4.149.0、`@cloudflare/workers-types` 5.20261011.1、`@vitejs/plugin-react` 6.1.2、`@tailwindcss/vite` 4.3.3 |

### 5.5 现有编码风格与约定（已核实）

- TypeScript strict、ESM、`moduleResolution: bundler`、双引号、2 空格缩进、分号。
- 测试与源文件同目录，命名 `*.test.ts`；根 `vitest.config.ts` 的 `include` 是显式白名单，新目录必须加入。
- 根 `eslint.config.mjs` 使用 `eslint-config-next`，`settings.next.rootDir` 为 `local/`。
- `scripts/check-ui-consistency.cjs` 禁止暗色专用类与硬编码色值。
- `docs/CONTRIBUTING.md`：先跑 `npm run lint`、`npm run test:unit`、`npm run check:local-app`；不擅自升级依赖版本；README 中英双语。
- 代码注释允许中文；错误提示面向用户时使用中文。

### 5.6 技术债务与已知风险

| 编号 | 事项 | 影响 |
| --- | --- | --- |
| R1 | `packages/core/src/parser/platform/peggy/*.js` 运行时 `peggy.generate` | Workers 上 Surge/Loon/QX 输入格式不可用（D7）；需要按源隔离异常 |
| R2 | `packages/core/src/parser/base64.ts` 使用 `Buffer.from` | 依赖 nodejs_compat 提供的全局 `Buffer`；compatibility_date 取 2026-10-01 以上即默认启用 |
| R3 | 根 vitest `include` 白名单 | 不加入则 worker 测试不会运行 |
| R4 | `eslint-config-next` 作用于非 Next 代码 | 可能需要作用域覆盖（U4） |
| R5 | KV 最终一致 | 配置修改后最长 60 秒在其他区域可见；个人场景可接受 |
| R6 | 单请求 6 个并发出站连接 | 管线并发固定为 4 |
| R7 | Free 计划 CPU 10 ms | 现场生成可能超限（U6） |
| R8 | 本机为 Windows，根测试需要 Git Bash（`test/setup-runtime.ts`） | 执行环境需具备 Git for Windows |

---

## 6. 验收标准

每条标准对应第 2 节的功能编号，判定方法见 Build 文档第 7 节。

| 编号 | 对应 | 条件 |
| --- | --- | --- |
| AC1 | F1 | 无 Bearer 请求 `GET /api/state` 返回 401 且体为 `{"error":"Unauthorized","code":"UNAUTHORIZED"}`；错误 token 同样 401；正确 token 返回 200；`ADMIN_TOKEN` 为空时返回 503 `CONFIGURATION_ERROR` |
| AC2 | F2 | `PUT /api/sources` 提交 `http://127.0.0.1/x` 返回 400 `VALIDATION_ERROR`；提交合法 https URL 后 `GET /api/state` 能看到该源且 `url` 为明文；KV 中 `meta:sources` 的 `payloadEnc` 以 `v1:` 开头 |
| AC3 | F3 | `POST /api/subscriptions` 返回的 `link` 形如 `<origin>/sub/<43 个 base64url 字符>`；`DELETE` 后原链接 404；`rotate` 后旧链接 404、新链接 200 |
| AC4 | F4 | `PUT /api/config` 提交 `[]` 返回 400；提交对象后 `GET /api/state` 的 `configIsDefault` 为 false；`DELETE /api/config` 后为 true |
| AC5 | F5 | 两个源其中一个指向返回 500 的地址：`POST /api/refresh` 返回 200，`status.sources` 中该源 `ok` 为 false 且另一源 `ok` 为 true；失败源若此前有快照，其 `nodeCount` 不变 |
| AC6 | F6 | `GET /sub/<token>` 返回 200，`content-type` 为 `text/yaml;charset=utf-8`，含 `profile-update-interval: 12`、`cache-control: no-store`、`x-content-type-options: nosniff`；响应体可被 js-yaml 解析且 `proxies` 长度等于去重后节点数；未知 token 返回 404 且体为 `Not found` |
| AC7 | F6 | 修改配置后再次 `GET /sub/<token>` 的 YAML 与修改前不同（例如改 `mixedPort`），且无需手动刷新 |
| AC8 | F7 | `GET /api/health` 无鉴权返回 `{"ok":true}` |
| AC9 | F8 | 单元测试覆盖第 2.2 节 F8 列出的每一类主机名与 IP 段，均被拒绝；重定向到 `http://10.0.0.1/` 的源刷新失败且状态错误不含上游 URL 的 query |
| AC10 | F9 | `wrangler dev --test-scheduled` 下触发 `/__scheduled?cron=0+*/12+*+*+*` 后，`meta:status.lastTrigger` 为 `cron` |
| AC11 | S4 | 根目录 `npm run lint`、`npm run test:unit`、`npm run worker:typecheck` 全部通过；`local/` 与 `packages/` 无文件改动（`git status` 仅显示 worker 相关与本任务允许的根配置文件） |
| AC12 | D4 | 管理页在暗色与浅色主题下均可用；页面源码中不含 `ADMIN_TOKEN`、`ENCRYPTION_KEY` 字样之外的任何密钥值；`check-ui-consistency` 无告警 |
