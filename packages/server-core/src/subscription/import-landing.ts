import {
  IMPORT_TARGETS,
  buildImportDeepLink,
  importTargetLabel,
  sanitizeName,
  type ImportTargetId,
} from "./import-targets";

/**
 * `?target=` 的浏览器落地页。
 *
 * 为什么需要这一页：服务端 302 到 `clash://…` 这类自定义 scheme 时，Chromium 要求
 * 导航由用户手势发起，否则直接拦掉（页面停在空白），移动端 Safari 往往也不跟随——
 * 表现就是「加了 target 参数一片空白」。改成返回一个页面、由页内按钮承载用户手势，
 * 才能真的拉起客户端；订阅客户端、curl 这类非浏览器请求仍然走 302。
 *
 * 页面必须自包含：Worker 没有静态资源可依赖，也不引外部字体/CDN。
 */

export type ImportLandingOptions = {
  /** Worker 的应用名（`env.APP_NAME`），用于页头品牌与标题 */
  appName: string;
  /** 订阅的明文地址，已去掉 `target` 参数 */
  link: string;
  /** 订阅名：展示与深链共用同一份清洗 */
  name: string;
  /** 用户请求的客户端 */
  target: ImportTargetId;
};

/**
 * 插值前统一转义：订阅名与链接都来自用户输入，直接拼进 HTML 就是反射型 XSS。
 * 深链本身也要转义，因为查询串里的 `&` 在属性值中必须写成 `&amp;`。
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 生成落地页 HTML（完整文档，由 Worker 直接以 text/html 返回） */
export function buildImportLandingPage(options: ImportLandingOptions): string {
  const deepLink = (target: ImportTargetId): string =>
    escapeHtml(buildImportDeepLink(target, { url: options.link, name: options.name }));

  const appName = escapeHtml(options.appName.trim() || "SubBoost");
  const subscriptionName = escapeHtml(sanitizeName(options.name) || "未命名订阅");
  const label = escapeHtml(importTargetLabel(options.target));
  const plainLink = escapeHtml(options.link);
  const others = IMPORT_TARGETS.filter((target) => target.id !== options.target)
    .map((target) => `        <li><a href="${deepLink(target.id)}">${escapeHtml(target.label)}</a></li>`)
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<title>在 ${label} 中打开订阅 · ${appName}</title>
<style>
:root {
  /* 页面不在 SPA 里，拿不到 theme.css 的令牌；靠 color-scheme 让浏览器按系统主题切换。
     老浏览器没有 light-dark() 时退回系统色（Canvas/CanvasText），同样跟随系统主题。 */
  color-scheme: light dark;
  --bg: Canvas;
  --card: Canvas;
  --fg: CanvasText;
  --muted: GrayText;
  --line: color-mix(in srgb, CanvasText 16%, Canvas);
  --accent: CanvasText;
  --accent-fg: Canvas;
}
@supports (color: light-dark(#fff, #000)) {
  :root {
    --bg: light-dark(#f5f5f4, #0b0b0d);
    --card: light-dark(#ffffff, #17171a);
    --fg: light-dark(#18181b, #f4f4f5);
    --muted: light-dark(#6b7280, #a1a1aa);
    --line: light-dark(#e4e4e7, #2a2a2f);
    --accent: light-dark(#18181b, #f4f4f5);
    --accent-fg: light-dark(#fafafa, #18181b);
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--bg);
  color: var(--fg);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Noto Sans SC", sans-serif;
  font-size: 15px;
  line-height: 1.6;
  -webkit-text-size-adjust: 100%;
}
main {
  width: 100%;
  max-width: 30rem;
  padding: 28px 24px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 16px;
}
.brand {
  margin: 0 0 18px;
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
}
h1 {
  margin: 0;
  font-size: 20px;
  line-height: 1.4;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.name {
  margin: 6px 0 20px;
  color: var(--muted);
  font-size: 13px;
  word-break: break-all;
}
.open {
  display: block;
  padding: 12px 16px;
  border-radius: 10px;
  background: var(--accent);
  color: var(--accent-fg);
  font-weight: 600;
  text-align: center;
  text-decoration: none;
}
.open:focus-visible,
a:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--fg);
  outline-offset: 2px;
}
.hint {
  margin: 16px 0 8px;
  color: var(--muted);
  font-size: 13px;
}
.link {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg);
  overflow-x: auto;
}
.link code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--fg);
  user-select: all;
}
details {
  margin-top: 18px;
  border-top: 1px solid var(--line);
  padding-top: 14px;
}
summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--muted);
}
details ul {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
details a {
  display: inline-block;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--fg);
  font-size: 13px;
  text-decoration: none;
}
footer {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
}
footer p { margin: 0 0 4px; }
</style>
</head>
<body>
<main>
<p class="brand">${appName}</p>
<h1>在 ${label} 中打开订阅</h1>
<p class="name">${subscriptionName}</p>
<a class="open" href="${deepLink(options.target)}" rel="noreferrer">打开 ${label}</a>
<p class="hint">按钮没反应就复制下面的订阅地址，回到客户端里手动添加：</p>
<pre class="link"><code>${plainLink}</code></pre>
<details>
<summary>换一个客户端</summary>
<ul>
${others}
</ul>
</details>
<footer>
<p>微信 / QQ 等应用内浏览器会拦截自定义 scheme，遇到这种情况请复制链接到系统浏览器打开。</p>
<p>这条链接只用于拉起客户端，不会输出配置内容。</p>
</footer>
</main>
</body>
</html>
`;
}
