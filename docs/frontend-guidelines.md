# 前端开发规范

本文件是管理端（`worker/ui`）与共享 UI 包（`packages/ui`）的**前端唯一规范**。
目标是两件事：

1. **风格统一**：任何人写出来的界面，看起来都像同一个人写的。
2. **不再重复踩坑**：把已经踩过的前端 bug 连同成因、正确写法、守护测试一起钉住。

与 `AGENTS.md` 的分工：`AGENTS.md` 是给代理的执行约束（跑什么校验、怎么发版、脱敏红线），
本文件解释**为什么这样写**。两者冲突时以本文件 + 实际守护测试为准，并同步修正 `AGENTS.md`。

提交前必须跑完 `AGENTS.md`「必须执行的校验」里的四项；只改文档时至少跑 `npm run lint`。

---

## 1. 分层与目录

```
worker/ui/src/          业务页面：只做编排、取数、页面级交互
  components/           页面与页面内区块（*-panel.tsx）
  lib/                  纯逻辑与浏览器适配（api-client、format、scroll-header…）
  demo/                 演示构建专用（内存 KV + 种子），由构建期常量摇树
packages/ui/src/        可复用能力：业务无关
  components/ui/        Radix 包装 + 基础组件（button/card/input/dialog…）
  motion/               JS 驱动动效（FLIP、依赖 layoutId 的滑块、增长条）
  styles/               theme.css（令牌）、globals.css（关键帧与工具类）
  theme/                主题读写与首屏注入脚本
```

**归属判断**（三条就够）：

| 内容 | 放哪 |
| --- | --- |
| 只服务某个页面的区块 | `worker/ui/src/components/` |
| 两个以上页面会用到，或与业务数据无关 | `packages/ui/src/` |
| 纯函数（能脱离 React 单测） | 就近放 `lib/`，**不要塞进组件文件** |

**硬约束**

- `worker/ui/src` 不直接 `import "@radix-ui/react-*"`，一律用 `packages/ui/src/components/ui/` 的包装组件。
  校验：`npm run check:ui-consistency`。
- `packages/ui` 不反向依赖 `worker/`。共享包保持业务无关。
- 不引入新的运行时依赖。当前允许的运行时依赖只有 React、`lucide-react`、`qrcode.react`、`@subboost/*`；
  真要加必须在 PR 里写明理由与体积影响。

---

## 2. 页面结构与数据流

**单一数据源在 `App`。** 页面面板一律「纯展示 + 回调」，不在面板内部自己发请求：

```tsx
// ✅ App 持有 state 与 client，面板只接收数据与回调
<SourcesPanel state={state} onSave={handleSaveSources} onLoadNodes={handleLoadNodes} />

// ❌ 面板内部自己 fetch —— 会出现两套加载态、两处 401 处理
```

约定：

- 请求统一走 `lib/api-client.ts`：`Authorization`、`cache: "no-store"`、401 统一登出、
  错误信息统一用 `readApiErrorMessage` 解析。不要在组件里手搓 `fetch`。
- 失败反馈用 `useToast()`，`role="alert"` 只用于表单内联校验错误。
- 折叠/开关类局部状态留在面板内部；跨页面共享的状态（当前页、token、`AppState`）上提到 `App`。
- 页面切换走 `App` 的 `navigate`，同时把滚动位置归零（`scrollTo({ top: 0, behavior: "auto" })`），
  否则「滚到半页点导航」看起来像没反应。
- 加载中必须有骨架或占位（`.skeleton` + `animate-shimmer`），不要白屏空等。

---

## 3. 样式：只用主题令牌

界面同时支持深色与浅色，**颜色不许写死**。令牌定义在 `packages/ui/src/styles/theme.css`，
两套主题块必须同时定义（`theme-tokens.test.ts` 会对等性校验）。

```tsx
// ✅
<div className="border border-card-border bg-surface text-fg-60" />
<span className="bg-ink/5 text-fg-45" />

// ❌ 深色专用值会直接破坏浅色主题，lint 会拒绝
<div className="bg-white/5 text-white/60 border-white/10" />
<div className="bg-[#0a0a0a] text-zinc-950" />
```

常用令牌速查：

| 用途 | 令牌 |
| --- | --- |
| 正文/次级/弱化文字 | `text-fg`、`text-fg-80`、`text-fg-70`、`text-fg-60`、`text-fg-45`、`text-fg-35` |
| 前景透明填充与描边 | `bg-ink/5`、`bg-ink/10`、`border-ink/10` |
| 表面 | `bg-surface`、`bg-surface-raised`、`bg-surface-popover` |
| 卡片描边/阴影 | `border-card-border`、`shadow-(--surface-shadow)` |
| 常驻色块（页头、底栏） | `bg-header`（必须是不透明实心色） |
| 遮罩 | `bg-overlay` |
| 焦点环 | `ring-focus-ring` |
| 警告/失败/成功提示 | `text-warning-note-fg`、`bg-warning-note-bg`、`border-warning-note-border`（danger / success 同构） |

**前景只有六档**：`fg / fg-80 / fg-70 / fg-60 / fg-45 / fg-35`。浅色主题里相邻几档本就映射到同一个色值，
多写一档只会让同一层级的文字在不同页面深浅不一；`text-fg-50`、`text-fg-40` 这类中间值已从令牌表移除，
`check:ui-consistency` 会拦下来。

写 class 一律过 `cn()`（`@subboost/ui/lib/utils`），让条件类与外部传入的 `className` 能正确合并。

**状态色只走语义令牌。** 警告/失败/成功三种提示的「前景 + 底色 + 描边」是成组的主题令牌，
深浅两套主题各有一份值。不要再在页面里拼 `border-amber-500/30 bg-amber-500/10 text-amber-400`：
同一句提示在不同页面会变成三种底色，而且 `text-amber-400` 在白底上几乎看不清。
直接用 `InlineNote`（页面级提示）或 `Badge` / `Toast` 的 `tone`（状态标签）：

```tsx
// ✅ 组件选 tone，颜色由令牌决定
<InlineNote tone="warning">有 2 条自定义规则格式无效，生成时会被忽略。</InlineNote>

// ❌ 手拼调色板：浅色主题下分叉，且无法统一内边距与字号
<p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">…</p>
```

例外只有协议徽标（`protocol-badge.tsx`）：那里的颜色是**协议标识色**，不表达状态，允许继续用调色板。

**字号只有刻度内档位。** Tailwind 默认从 `text-xs`（12px）起步，界面里大量「比 xs 再小一号」的
说明文字过去写成 `text-[11px]`。现在统一用 `text-2xs`（11px，定义在 `theme.css` 的 `@theme` 里），
任意值字号 `text-[11px]` / `text-[10px]` 一律被拦下。

新增令牌的流程：`theme.css` 两套主题块同时加 → 在 `@theme inline` 里映射成 `--color-*` →
确认 `theme-tokens.test.ts` 通过。

---

## 4. 组件使用

### 图标

```tsx
// ✅ 唯一出口是 <Icon>，尺寸只用五档：xs/sm/md/lg/xl = 12/14/16/20/24px
<Icon icon={RefreshCw} size="md" />
// 容器已经用 [&_svg]:size-* 统一控制时不要传 size（父选择器特异性更高会覆盖）
```

- 禁止把 lucide 图标当 JSX 标签直接用（`<RefreshCw />`），禁止手写 `<svg>`（品牌标记除外）。
- 禁止用 lucide 旧别名：`AlertTriangle` / `XCircle` / `CheckCircle2` / `Loader2` / `MoreHorizontal` / `Home`
  都已被上游改名，导入规范名。
- 图标默认装饰性（`aria-hidden`）；需要读屏念出来时传 `label`。
- 不用 emoji 代替功能图标。

### 按钮

- 纯图标按钮用 `IconButton`，**必须**传 `label`（会同时写 `aria-label` 与 `title`）。
- 不要用 `Button size="icon"` 代替 `IconButton`。
- 链接里不嵌套按钮：用 `Button asChild`。
- 异步按钮用 `LoadingButton`，它自动处理 `disabled` / `aria-busy` / 旋转图标与等待文案。
- 按钮动效只走颜色：hover 150ms 渐变，按下瞬间切到 `--btn-*-bg-active` 按压底色。
  **不用 `active:scale`**（带文字的按钮被提升为合成层，按下那一下文字发虚），
  **不用 `transition-all`**（会把 hover 阴影纳入过渡）。列表里的可点行同理，hover 不做位移。
  守护：`packages/ui/src/styles/motion.test.ts`「button press feedback」。

### 表单

- 输入、开关必须有可访问名：`Label htmlFor` 或 `aria-label`。
- 开关优先用 `SwitchField`（自带 label、描述、`aria-describedby`）；裸 `<Switch>` 必须给
  `aria-label` / `aria-labelledby`。
- 表单控件字号在移动端不得低于 16px（`text-base`，桌面用 `sm:text-sm` 降回 14px），
  否则 iOS Safari 聚焦时会自动放大整页。
- 校验错误用 `role="alert"` 内联显示，不要只靠 toast。

### 状态提示与空状态

- **提示**统一用 `InlineNote`：`tone` 选 `warning` / `danger` / `success`，
  `variant="plain"` 用于「只有一行附注」的场合（不加底色描边），`alert` 只在需要立刻朗读时传。
  不要再手写 `flex items-start gap-1.5` + 调色板的组合；图标可覆盖（例如锁、盾牌）或传 `null` 去掉。
- **空状态**统一用 `EmptyState`：虚线框、居中文案，可选 `icon` 与 `action`（例如「新建链」按钮）。
  列表为空、筛选无结果、首次进入都走它，不要各自写 `rounded-xl border border-dashed`。
- 空状态文案要说清「现在没有」和「下一步做什么」，不要只写「暂无数据」。

### 可折叠列表卡片

同构条目（链式代理、未来的规则组等）一张卡片内有大量字段时，默认展开会把页面拉成几屏，
必须做成可折叠。约定如下：

- **正文按需挂载**，不用 `hidden`：收起时 DOM 里不留三分栏、不留十几个输入框。
  统一用 `MotionReveal`（`@subboost/ui/motion/motion-list`）包住正文：它只在展开时挂载，
  开合做高度 + 透明度过渡（0.22s、`EASE_OUT`），退场播完再卸载。仪表板的源节点、
  分流组开关、链式代理卡片都是这一套，不要再给正文套 `animate-fade-in` 之类的入场动画。
- **摘要行开合前后结构不变**：不要把摘要行在展开时替换成输入框（例如链名），
  可编辑字段放进正文，否则每次开合摘要行高度都会跳。
- **折叠状态由父级持有**，一次只展开一条（或明确允许多开），收起其余；新建后自动展开这一条。
- **摘要行给键盘入口**：摘要行要 `role="button"` + `tabIndex={0}`，
  处理 `Enter` / `空格`，并带 `aria-expanded`。展开态的 `aria-controls` 才指向正文 id，
  收起时留 `undefined`，避免指向不存在的节点。
- **状态必须常驻在折叠区之外**：收起后仍要能看出这条为什么没生成（状态徽标、节点计数、冲突原因、
  链名为空这类字段错误）。
- 箭头一律用 `DisclosureChevron`（`@subboost/ui/motion/disclosure-chevron`），不要手写
  `ChevronDown` + `rotate-180` + 各自的时长：它的时长与曲线和 `MotionReveal` 对齐。
  切换按钮用 `IconButton` + 轮换 `label`（`展开 X` / `收起 X`）。
- 守护：`worker/ui/src/components/mobile-layout.test.ts`「disclosure motion」。


### 容器

- 卡片统一用 `Card` / `CardHeader` / `CardTitle` / `CardContent`，不要手写等价 div。
- `confirm` 用 `ConfirmDialogHost`，不要用 `window.confirm`。

---

## 5. 响应式与移动端

断点以 `sm`（640px）为主，`md` 只用于「桌面才展开」的增强（例如吸顶工具条里的完整导航）。
`375×667` 与 `390×844` 是最低验收尺寸。

必须遵守的几条：

- **卡片头**：`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4`，
  窄屏竖向堆叠，否则长标题会把主按钮挤成竖排文字。
- **列表行操作**：窄屏换行到第二行并贴右（`self-end sm:self-auto`），不要与标题抢横向空间。
- **固定底栏**：主区域必须留出等高下内边距（`pb-28`），否则最后一张卡被底栏挡住。
- **安全区**：贴边固定元素用 `env(safe-area-inset-*)`（`viewport-fit=cover` 已在 `index.html` 声明）。
- **长串**：订阅链接、错误信息这类无空格长串必须 `break-words` / `truncate`，
  页面级已用 `overflow-x: hidden` 兜底，但不能靠它掩盖布局问题。
- **选择器**：可点区域不小于 44×44（移动端按钮 `min-h-9` 起步，底栏项 `min-h-14`）。

---

## 6. 动效

动效的原则只有一句：**承载文字的元素，入场/出场只驱动 `opacity`。**

位移/缩放会把元素提升为独立合成层，Chrome 只栅格化一次纹理，随后按**非整数设备像素**
平移这张位图，插值采样把整块内容糊掉 —— 文字边缘发虚、卡片阴影被抹平。
完整机制、判定脚本与正反例见 `AGENTS.md`「已知陷阱：滚动时"文字发虚、卡片发虚"」。

落地规则：

1. CSS 入场动画用 `@theme` 的 `--animate-*` 令牌，关键帧在 `globals.css` 定义，
   并且**只写 `opacity`**；方向感交给时长/easing 与 `.stagger-*` 时序。
2. 动画 `fill-mode` 用 `backwards`，不用 `both`（`both` 会在动画结束后把恒等矩阵永久留在元素上，
   给每个元素留一个合成层）。
3. 纯色块装饰（`iconPop`、`barGrow`、`toastProgress`）没有可读文字，可以用 `scale`。
4. Radix 组件的退场动画必须挂在 `data-[state=closed]` 上，Presence 依赖 `animationend` 才卸载。
5. **常驻覆盖层**（`fixed` / `sticky` 的页头、工具条、底栏）**不许用位移与过渡**：
   只在需要时挂载，出场用只驱动 `opacity` 的关键帧（`animate-fade-in`），
   表面用不透明 `bg-header`。不要留一个 `opacity-0` 还带 `translate` 的空壳在 DOM 里等淡入。
6. `hover` 位移用独立的 `translate` 属性（见 `.hover-lift`），**不要**把 `box-shadow` 放进过渡：
   大范围模糊阴影每帧重算就是「卡片在喘」。
7. 不透明面板上不要叠 `backdrop-blur`：看不出效果，却要每帧对整块背景重算。
8. 尊重 `prefers-reduced-motion`：全局降级规则已存在，不要移除，新动效不要绕过。
9. 需要 FLIP / 共享布局（`layoutId`）时才用 JS 驱动（`packages/ui/src/motion/`），
   参数从 `motion/tokens.ts` 取，不要就地写魔法数字。列表 FLIP 一律 `layout="position"`。

---

## 7. 已知前端坑（防回归清单）

每条都对应一次真实事故。**改动涉及这些地方时，先读对应守护测试。**

| # | 症状 | 根因 | 正确写法 | 守护 |
| --- | --- | --- | --- | --- |
| 1 | 动画中/滚动时文字发虚、卡片发虚，停下才清晰 | 带 `transform`/`translate`/`scale` 的元素被提升为合成层，按非整数像素平移被双线性采样；常驻 `fixed` 层会把它覆盖的正文一起 squash 进同一层 | 承载文字只驱动 `opacity`；常驻层按需挂载、不做位移；表面用不透明 `bg-header` | `packages/ui/src/styles/motion.test.ts`、`worker/ui/src/components/pinned-header.test.ts`、`mobile-layout.test.ts`、`config-panel.test.ts`（生成配置的未保存保存条） |
| 2 | 打开弹窗/下拉时整页横跳 4px，关闭又弹回 | `html` 的 `scrollbar-gutter: stable` 与 react-remove-scroll 对 `body` 的补偿**各留了一次**滚动条宽度，布局视口凭空少 8px | `html` 独占占位；`body[data-scroll-locked]` 把库自带补偿清零；遮罩与弹窗容器用 `w-screen` 盖住 | `packages/ui/src/styles/scroll-lock.test.ts` |
| 3 | 切页卡顿、动画像慢放 | `startViewTransition` 就绪前要整页快照，主线程不可中断阻塞 25–89ms | 不用 View Transitions，改用单一合成层的 `animate-page-in` | `worker/ui/src/lib/view-transition.test.ts` |
| 4 | 页面越用越卡、切页次数越多越明显 | 入场动画 `fill-mode: both` 把终态恒等 transform 永久留在元素上，仪表板单页累积 40+ 合成层 | 一律 `backwards` | `motion.test.ts`（令牌层面） |
| 5 | hover 时卡片发颤、像在「喘」 | `box-shadow` 进了 `transition`，模糊阴影每帧重算 | 只过渡 `border-color` / `background-color` | `motion.test.ts`、`card.tsx` |
| 6 | 深色好好的，切浅色后卡片背景消失、下拉透明 | 浅色块定义了令牌，深色块漏定义，工具类解析成空值 | 两套主题块同时定义 | `packages/ui/src/styles/theme-tokens.test.ts` |
| 7 | 手机点输入框，整页被放大 | 表单控件字号 < 16px，iOS Safari 聚焦缩放 | `text-base` + `sm:text-sm` | `mobile-layout.test.ts` |
| 8 | 手机最后一张卡被底栏挡住 | 固定底栏不占文档流 | 主区域 `pb-28` | `mobile-layout.test.ts` |
| 9 | 窄屏卡片头被挤成竖排按钮 | 标题与操作同一行 `flex-row` | `flex-col` → `sm:flex-row` | `mobile-layout.test.ts` |
| 10 | 一条长订阅链接把整页推出横向滚动 | 无空格长串 | `break-words` / `truncate` + 页面级 `overflow-x: hidden` | `mobile-layout.test.ts` |
| 11 | 页头压住正文，且滚动时挡操作 | 常驻 `sticky` 页头 + 高度变化使文档流跳动 | 页头是普通内容随页面滚走；需要常驻时用 `fixed` 独立层按需挂载 | `mobile-layout.test.ts` |
| 12 | 两套导航同时进入无障碍树、读屏重复念 | 同一导航在多处渲染但没做互斥 | 断点互斥（`sm:hidden` / `hidden md:flex`）或按需挂载 | `mobile-layout.test.ts` |
| 13 | 同一条警告在不同页面是三种底色、两种字号 | 每个页面自己拼 amber/red 的透明度变体与内边距 | `InlineNote` + `*-note-*` 令牌；`check:ui-consistency` 拒绝裸调色板 | `test/regression/tooling/ui-consistency-checker.test.ts`、`note-and-empty-state.test.ts` |
| 14 | 浅色主题下警告文字几乎看不见 | 直接写 `text-amber-400`：深色下尚可，白底上对比度不足 | 用 `text-warning-note-fg`（两套主题各一份值） | 同上 |
| 15 | 列表空状态样式五花八门（虚线色、字号、内边距各异） | 各处手写 `rounded-xl border border-dashed` | 统一 `EmptyState`，可选 `icon` 与 `action` | `note-and-empty-state.test.ts` |
| 16 | 说明文字字号在 10/11/12px 之间跳 | 任意值字号 `text-[11px]` 没有刻度约束 | `text-2xs`（11px）/ `text-xs` / `text-sm` | `ui-consistency-checker.test.ts` |

排错顺序建议：先在控制台跑 `AGENTS.md` 里那段合成层扫描脚本，再去 DevTools →
Layers 看滚动期间哪些层被 squashed，最后才怀疑具体 CSS 数值。

---

## 8. 可访问性

- 语义优先：导航用 `nav` + `aria-label`，当前页用 `aria-current="page"`，
  分段控件用 `role="tablist"` / `role="tab"` + `aria-selected`。
- 所有可交互元素可键盘到达，焦点可见：`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring`。
- 纯装饰元素 `aria-hidden="true"`；状态点这类视觉信息必须另有文字等价物。
- 弹窗必须有标题（`DialogTitle`）；图标按钮必须有 `label`。
- `eslint-plugin-jsx-a11y` 已开 `click-events-have-key-events`、`no-static-element-interactions`、
  `label-has-associated-control`，不要用 `eslint-disable` 绕过。

---

## 9. 测试要求

| 要验证的东西 | 用什么 |
| --- | --- |
| 纯函数、阈值、格式化 | 普通单测（node 环境） |
| 首次渲染的静态结构、文案、无障碍属性 | `renderToStaticMarkup` |
| effect、事件、rAF、挂载/卸载 | `// @vitest-environment jsdom` + `@testing-library/react` |
| 「源码里不许出现某写法」的架构约束 | `readFileSync` 断言源码文本 |

注意：

- vitest 的 `include` 只匹配 `*.test.ts`，写成 `.test.tsx` 会被漏收；用 `React.createElement` 代替 JSX。
- 断言 UI 优先断言语义文本与可访问属性（`getByRole`、`getByLabelText`），少断言脆弱类名；
  但**架构约束类**（禁止位移类、必须 `inert`）恰恰要断言类名/属性，那是契约。
- 修 bug 必须附一个能复现该 bug 的回归测试；新增交互分支要有覆盖。
- 测试数据只用保留地址与占位符（`example.com`、`192.0.2.0/24`、`2001:db8::/32`、`<token>`）。

---

## 10. 提交前自检清单

- [ ] `npm run lint`（ESLint + UI 一致性 + 仓库卫生 + 版本一致）
- [ ] `npm run worker:typecheck`
- [ ] `npm run test:unit`
- [ ] `npm run worker:build`
- [ ] 深色 / 浅色两套主题都看过一遍
- [ ] 375px 与桌面都看过，没有横向滚动、没有元素被固定层挡住
- [ ] 滚动整页一遍：文字全程锐利，没有「发虚」「阴影消失」
- [ ] 键盘 Tab 走一遍主要路径，焦点环可见
- [ ] 触发动效时打开 DevTools → Layers，确认没有残留的常驻合成层
- [ ] 新增的坑（如果又踩了）已连同成因与守护测试补进第 7 节
- [ ] 版本号已按 `AGENTS.md`「版本号规范」同步
