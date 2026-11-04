# age 加密订阅：部署与使用

订阅链接本身就是访问凭据：拿到链接的人都能拉取到节点。age 加密给这条链路加一层
**收件人密钥**——Worker 用你的公钥把 YAML 加密成标准 [age](https://age-encryption.org) v1 文件，
只有持有对应私钥的人（也就是你）能解开。

- 公钥（`age1…`）配在 Worker 上，**私钥始终只在你本机**；
- Worker 只做加密，不提供解密接口，也不需要私钥；
- 明文入口默认不受影响，加密是一条**可选**通道。

## 一、部署方：在 Worker 上配置公钥

### 1. 在本机生成密钥对

私钥不要经过任何服务器，直接在你自己的机器上生成：

```bash
# macOS
brew install age
# Debian / Ubuntu
sudo apt install age
# Windows（PowerShell）
winget install FiloSottile.age
# 其它平台：https://github.com/FiloSottile/age/releases

age-keygen -o key.txt
# 输出示例：
# Public key: age1replacewithrealrecipientxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

`key.txt` 里同时包含公钥注释与私钥（`AGE-SECRET-KEY-1…`）。**这个文件不要提交、不要上传、
不要贴进 Issue 或聊天**；它等同于你所有加密订阅的钥匙。

需要多台设备各自独立解密时，生成多把密钥对，把各自的公钥都配上即可（见下文「多把公钥」）。

### 2. 配置 Worker 变量

在 Cloudflare Dashboard：`Worker → Settings → Variables and Secrets → Add`
新增变量（Variables，不是必须用 Secret）：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `AGE_RECIPIENT` | 是 | 收件公钥 `age1…`，全小写；多把用逗号或空白分隔，最多 8 把 |
| `AGE_ONLY` | 否 | 设为 `1` / `true` 时只输出 age 密文，明文入口与一键导入一律 403 |

也可以用 wrangler（值用公钥即可，它不是秘密）：

```bash
npx wrangler secret put AGE_RECIPIENT
npx wrangler secret put AGE_ONLY        # 可选
npx wrangler deploy
```

本地开发写进仓库根目录的 `.dev.vars`（已被 gitignore）：

```ini
AGE_RECIPIENT=age1replacewithrealrecipientxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AGE_ONLY=0
```

多把公钥示例（任意一把对应私钥都能解开同一份密文）：

```ini
AGE_RECIPIENT=age1aaa…,age1bbb…
```

### 3. 验证配置是否生效

管理端 `GET /api/state` 会返回能力声明，`enabled: true` 表示加密通道可用：

```json
{
  "capabilities": {
    "age": { "enabled": true, "only": false, "recipients": ["age1…"], "misconfigured": false }
  }
}
```

直接看响应头也能确认：

```bash
curl -sI 'https://<your-worker>/sub/<token>?format=age' | head -3
# content-type: application/octet-stream
# content-disposition: attachment; filename="<订阅名>.yaml.age"
```

配置非法（例如把私钥串误填进 `AGE_RECIPIENT`）时加密通道返回
`503 Age recipient invalid`，**明文入口照常工作**——配置错误不会锁死实例。

### 4. 部署时的注意事项

- 公钥必须全小写。填成 `AGE1…` 或粘贴私钥都会被判非法。
- 公钥不是秘密：出现在 `/api/state`、分享弹窗指纹里都无害；泄露的是**私钥**才需要换密钥对。
- 更换公钥后，已发出的旧密文仍能用旧私钥解开，新请求用新公钥加密。
- `AGE_ONLY=1` 前请确认你接受「客户端不能自动更新」：Clash/Mihomo 系客户端不支持解密 age，
  只能手动解密后导入（见下一节）。该模式下明文入口与一键导入都会 403。
- 加密是纯 JS 实现（ChaCha20-Poly1305 + X25519），不依赖运行时是否支持这些算法；
  代价是 CPU：约 0.4 MB 配置约 35–45 ms，只在 `?format=age` 这条路径上发生。

## 二、使用方：取密文并解密

### 1. 拿链接

管理端「订阅链接」卡片上点「age 加密」按钮（钥匙图标），弹窗里直接给加密链接；也可以手动在链接后加参数：

| 链接 | 内容 |
| --- | --- |
| `/sub/<token>?format=age` | age v1 二进制密文（`application/octet-stream`） |
| `/sub/<token>?format=age-armor` | 同上，ASCII armor 文本（便于粘贴、邮件传输） |

短链 `/s/<code>` 用法完全相同。密文每次都不一样（随机 file key 与 payload nonce），
所以这类响应带 `cache-control: no-store` 且不发 ETag。

### 2. 解密

```bash
curl -o sub.yaml.age 'https://<your-worker>/sub/<token>?format=age'
age -d -i key.txt -o config.yaml sub.yaml.age
```

Windows PowerShell 里 `curl` 是 `Invoke-WebRequest` 的别名，请显式用 `curl.exe`：

```powershell
curl.exe -s 'https://<your-worker>/sub/<token>?format=age' -o sub.yaml.age
age -d -i key.txt -o config.yaml sub.yaml.age
```

armor 文本同样可以直接喂给 `age -d`（CLI 会自动识别 armor）。

### 3. 导入客户端

解密出来的是普通 Clash/Mihomo YAML，按客户端的「从本地文件导入」流程加载即可。
后续订阅更新依旧是：重新拉密文 → 解密 → 重新导入。

## 三、互操作性

输出严格遵循 [c2sp.org/age](https://c2sp.org/age) 的 v1 格式，已与官方 CLI `age v1.3.2`
做过双向验证：

- 本服务加密的文件，`age -d -i key.txt` 能解开（含 64 KiB / 64 KiB+1 / 200 KiB 等 STREAM 分块边界）；
- 官方 `age -e -r age1…` 加密的文件，本实现也能解密；
- ASCII armor、多 recipient 两种形态互通；
- 无关私钥与篡改密文都会被拒绝。

也就是说 `age`、`rage` 等标准实现都能处理本服务的输出。

## 四、常见问题

**客户端能直接拉密文并自动更新吗？**
不能。Clash/Mihomo 系客户端不支持 age 解密，加密通道面向「离线/手动交付」场景。
需要客户端自动更新时用明文链接（或保持 `AGE_ONLY` 关闭）。

**私钥丢了怎么办？**
重新生成密钥对、更新 `AGE_RECIPIENT`。已经发出的旧密文无法再解，需要重新拉取新密文。

**公钥泄露有风险吗？**
没有。公钥只能用于加密；能解密的是私钥。

**能不能让 Worker 帮我解密/托管私钥？**
不支持，也不建议：那等于把私钥交给服务端，age 的意义就没了。本实现里 Worker 只有公钥。

**一把私钥能解所有订阅吗？**
能。`AGE_RECIPIENT` 是实例级配置，同一把密钥解所有订阅的密文；需要分开时用多把公钥，
或部署多个实例。

**加密后的链接还能用短链吗？**
可以，`/s/<code>?format=age` 与原链接输出完全一致。

**`enabled` 为 false 但我想看看具体原因？**
管理端每条订阅卡片上的「age 加密」按钮会给出当前状态（未配置 / 配置非法 / 只出密文），部署侧也可以直接读
`/api/state` 的 `capabilities.age.misconfigured` 字段。
