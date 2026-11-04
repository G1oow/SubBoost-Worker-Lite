import * as React from "react";
import { LogOut, Moon, RefreshCw, Sun } from "lucide-react";
import { Icon } from "@subboost/ui/components/ui/icon";
import { BrandMark } from "@subboost/ui/components/ui/brand-mark";
import { Button } from "@subboost/ui/components/ui/button";
import { IconButton } from "@subboost/ui/components/ui/icon-button";
import { LoadingButton } from "@subboost/ui/motion/loading-button";
import { SegmentedControl } from "@subboost/ui/motion/segmented-control";
import { cn } from "@subboost/ui/lib/utils";
import { applyTheme, getCurrentTheme, persistTheme, type ThemeName } from "@subboost/ui/theme/theme";
import { useScrollHeaderPinned } from "../lib/scroll-header";
import { prefersReducedMotion } from "../lib/view-transition";

export type AppNavItem = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** 右侧小徽标，例如未读/数量提示 */
  badge?: number;
};

export type AppShellProps = {
  title: string;
  version: string;
  /** 演示构建没有登录态可退，不传就不渲染退出入口 */
  onLogout?: () => void;
  children?: React.ReactNode;
  navItems?: AppNavItem[];
  activeNav?: string;
  onNavigate?: (id: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
};

/** 页头导航滑块共享布局的命名空间，全局唯一即可 */
const NAV_PILL_GROUP = "app-nav";
/**
 * 吸顶工具条里的第二套胶囊。
 *
 * layoutId 必须与页头那套区分开：两套同时挂在 DOM 里，若共用同一个 layoutId，
 * 高亮块会在页头与工具条之间来回飞行。
 */
const PINNED_NAV_PILL_GROUP = "app-nav-pinned";

type HeaderBrandProps = {
  title: string;
  version?: string;
  /**
   * 紧凑形态：给吸顶工具条用。
   * 标记缩到 28px、标题单行、不带版本徽章——工具条只有 56px 高，
   * 版本号在这里既读不清也挤位。
   */
  compact?: boolean;
};

/** 品牌块：页头与吸顶工具条共用，避免两处各写一份、改一处忘一处 */
function HeaderBrand({ title, version, compact = false }: HeaderBrandProps) {
  return (
    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
      <BrandMark
        className={cn(
          "shrink-0 shadow-(--btn-primary-shadow) transition-transform duration-300 hover:rotate-6",
          compact ? "h-7 w-7" : "h-8 w-8 sm:h-9 sm:w-9"
        )}
      />
      <div className={cn("flex min-w-0 gap-2", compact ? "items-center" : "items-baseline")}>
        {compact ? (
          <span className="max-w-[10rem] truncate text-sm font-semibold text-fg">{title}</span>
        ) : (
          <h1 className="truncate text-base font-semibold text-fg sm:text-lg">{title}</h1>
        )}
        {!compact && version ? (
          <span className="hidden shrink-0 rounded-full border border-ink/10 bg-ink/5 px-2 py-0.5 text-[11px] text-fg-45 sm:inline-block">
            v{version}
          </span>
        ) : null}
      </div>
    </div>
  );
}

type HeaderActionsProps = {
  theme: ThemeName;
  onToggleTheme: () => void;
  onRefresh?: (() => void) | undefined;
  refreshing: boolean;
  onLogout?: (() => void) | undefined;
};

/** 刷新 / 主题 / 退出。窄屏降级成图标按钮，桌面才显示带文字的那版 */
function HeaderActions({
  theme,
  onToggleTheme,
  onRefresh,
  refreshing,
  onLogout,
}: HeaderActionsProps) {
  return (
    <div className="flex shrink-0 items-center gap-1 sm:gap-2">
      {onRefresh ? (
        <>
          <IconButton
            label="立即刷新"
            variant="secondary"
            onClick={onRefresh}
            disabled={refreshing}
            className="min-h-9 min-w-9 sm:hidden"
          >
            <Icon icon={RefreshCw} className={cn(refreshing && "animate-spin")} />
          </IconButton>
          <LoadingButton
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            loading={refreshing}
            loadingLabel="刷新中…"
            className="hidden sm:inline-flex"
          >
            <Icon icon={RefreshCw} />
            刷新
          </LoadingButton>
        </>
      ) : null}
      <IconButton
        label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
        variant="ghost"
        onClick={onToggleTheme}
        className="min-h-9 min-w-9"
      >
        {theme === "dark" ? <Icon icon={Sun} /> : <Icon icon={Moon} />}
      </IconButton>
      {onLogout ? (
        <>
          <IconButton
            label="退出登录"
            variant="ghost"
            onClick={onLogout}
            className="min-h-9 min-w-9 sm:hidden"
          >
            <Icon icon={LogOut} />
          </IconButton>
          <Button
            variant="ghost"
            size="sm"
            onClick={onLogout}
            className="hidden sm:inline-flex"
          >
            <Icon icon={LogOut} />
            退出
          </Button>
        </>
      ) : null}
    </div>
  );
}

export function AppShell({
  title,
  version,
  onLogout,
  children,
  navItems,
  activeNav,
  onNavigate,
  onRefresh,
  refreshing = false,
}: AppShellProps) {
  const [theme, setTheme] = React.useState<ThemeName>(() => getCurrentTheme());
  /** 滚过阈值后切到吸顶工具条（订阅细节见 lib/scroll-header.ts） */
  const pinnedHeader = useScrollHeaderPinned();

  const toggleTheme = () => {
    const next: ThemeName = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    persistTheme(next);
  };

  const navOptions = React.useMemo(
    () =>
      (navItems ?? []).map((item) => ({
        id: item.id,
        label: item.label,
        ...(item.icon ? { icon: item.icon } : {}),
        ...(typeof item.badge === "number" && item.badge > 0 ? { badge: item.badge } : {}),
      })),
    [navItems]
  );

  const activeId = activeNav ?? navOptions[0]?.id ?? "";

  /**
   * 换页。
   *
   * 除了交给上层的 navigate，这里还要把滚动位置拉回顶部：
   * 两套导航（页头胶囊、吸顶胶囊）和移动端底栏都可能在"已经滚到半页"时被点到，
   * 若只换内容不归位，用户看到的就是"点了没反应"。
   */
  const selectNav = (id: string) => {
    onNavigate?.(id);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  };

  /** 吸顶工具条左上角的品牌徽章兼"回到顶部"按钮 */
  const backToTop = () => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };

  const actions = (
    <HeaderActions
      theme={theme}
      onToggleTheme={toggleTheme}
      onRefresh={onRefresh}
      refreshing={refreshing}
      onLogout={onLogout}
    />
  );

  return (
    <div className="min-h-dvh bg-page text-fg">
      {/*
        页头本身仍然是"页面最上面的一块普通内容"：不 sticky、不加底板、不加分隔线，
        随页面一起滚走，永不遮挡正文。

        常驻的顶部控制交给下面的吸顶工具条：它只在滚过阈值后才浮现，
        所以"页头盖住内容"和"滚动时按钮全消失"这两个问题不会同时出现。

        结构保持原样，位置不动：
        - 第一行：品牌 + 标题 + 版本徽章，右侧是刷新 / 主题 / 退出；
        - 第二行：页面切换胶囊独占一行（比挤在页头里更好点，命中面积更大）。
      */}
      <header>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2.5 sm:gap-4 sm:px-6 sm:py-3">
          <HeaderBrand title={title} version={version} />
          {actions}
        </div>

        {/* 桌面导航：胶囊分段控件独占一行。移动端换成底部 tab 栏（见下方），这里整块隐藏 */}
        {navOptions.length > 0 ? (
          <div className="mx-auto hidden max-w-6xl px-4 pb-2 sm:block sm:px-6">
            <SegmentedControl
              label="主导航"
              layoutGroupId={NAV_PILL_GROUP}
              options={navOptions}
              activeId={activeId}
              onSelect={selectNav}
              className="w-auto"
              optionClassName="px-3 py-2"
            />
          </div>
        ) : null}
      </header>

      {/*
        吸顶工具条：滚过阈值后浮现的第二形态。

        为什么是独立的一层、而不是把上面的 <header> 改成 sticky：
        sticky 元素仍然占文档流，一旦在吸顶状态下改变它的高度（收起第二行、
        缩小内边距），整个页面内容就会跟着上下跳。这一层是 fixed、脱离文档流，
        它的高度变化对正文零影响；页头依旧按普通内容滚走。

        ⚠️ 这一层**不许**出现 translate / transform / transition：
        带位移的元素会被提升为独立合成层，Chrome 只栅格化一次纹理，之后按
        非整数设备像素逐帧平移这张位图，插值采样把压在它下面的内容一起糊掉 ——
        表现就是滚动时顶栏文字发虚、工具条下方的卡片发虚。这条机制在上一轮
        "动效发虚与卡片震颤"里已经定性过，别再用位移做"滑入"。

        所以出场只有一条路：挂载时跑一次**只驱动 opacity** 的关键帧
        （animate-fade-in）。未吸顶时整条不挂载 —— DOM 里不存在常驻的固定层，
        滚动期间的栅格化路径与没有这条工具条时完全一致。

        表面用不透明 --header-bg（bg-header）：这条工具条会一直压着下文滚动，
        半透明加背景模糊既没有视觉效果，又要在每帧对整块背景重算一次。
      */}
      {pinnedHeader ? (
        <div
          data-pinned-header="true"
          className="fixed inset-x-0 top-0 z-30 animate-fade-in border-b border-card-border bg-header"
        >
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-3 sm:gap-4 sm:px-6">
            <button
              type="button"
              onClick={backToTop}
              aria-label="回到顶部"
              title="回到顶部"
              className="flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-ink/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <BrandMark className="h-7 w-7 shrink-0 shadow-(--btn-primary-shadow)" />
              <span className="max-w-[10rem] truncate text-sm font-semibold text-fg">{title}</span>
            </button>

            {/* 桌面保留完整的页面切换胶囊：滚动到长列表中间时导航仍然可用；窄屏交给底部 tab 栏 */}
            {navOptions.length > 0 ? (
              <div className="hidden min-w-0 flex-1 justify-center md:flex">
                <SegmentedControl
                  label="主导航"
                  layoutGroupId={PINNED_NAV_PILL_GROUP}
                  options={navOptions}
                  activeId={activeId}
                  onSelect={selectNav}
                  className="w-auto"
                  optionClassName="px-2.5 py-1.5"
                />
              </div>
            ) : null}

            <div className="ml-auto shrink-0">{actions}</div>
          </div>
        </div>
      ) : null}

      {/* 底部 tab 栏是 fixed 的，主区域必须留出等高的下内边距，否则最后一张卡被挡住 */}
      <main className="mx-auto max-w-6xl px-3 pb-28 pt-4 sm:px-6 sm:pb-6 sm:pt-6">
        {/* key 换页时重新挂载，触发一次 pageIn 入场；动画只动 opacity */}
        <div key={activeNav ?? "page"} className={cn("page-content animate-page-in space-y-4 sm:space-y-6")}>
          {children}
        </div>
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-24 text-center text-xs text-fg-35 sm:px-6 sm:pb-8">
        SubBoost Lite · Cloudflare Workers + KV
      </footer>

      {/*
        移动端底部 tab 栏：五个页面在拇指可达区，且不会像横向胶囊那样被压扁。
        用 nav + aria-current 表达“当前页”，与桌面 tablist 的语义互补而不是重复：
        两者靠 hidden/sm:hidden 互斥，任一断点下只有一套进入无障碍树。
        底栏常驻压着内容，所以保留实心表面（--header-bg）。
      */}
      {navOptions.length > 0 ? (
        <nav
          aria-label="主导航"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-card-border bg-header pb-[env(safe-area-inset-bottom)] sm:hidden"
        >
          <ul className="flex items-stretch">
            {navOptions.map((option) => {
              const active = option.id === activeId;
              return (
                <li key={option.id} className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => selectNav(option.id)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-14 w-full flex-col items-center justify-center gap-1 px-1 pb-2 pt-2 text-[11px] font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset",
                      active ? "text-primary-200" : "text-fg-45 active:text-fg-70"
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "relative flex h-5 w-5 items-center justify-center [&_svg]:h-5 [&_svg]:w-5",
                        active ? "text-primary-300" : undefined
                      )}
                    >
                      {option.icon}
                      {typeof option.badge === "number" ? (
                        <span className="absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-primary-500/25 px-1 text-center text-[10px] leading-4 tabular-nums text-primary-200">
                          {option.badge}
                        </span>
                      ) : null}
                    </span>
                    <span className="w-full truncate text-center">{option.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
