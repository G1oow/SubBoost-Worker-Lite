import * as React from "react";
import { LogOut, Moon, RefreshCw, Sun } from "lucide-react";
import { BrandMark } from "@subboost/ui/components/ui/brand-mark";
import { Button } from "@subboost/ui/components/ui/button";
import { IconButton } from "@subboost/ui/components/ui/icon-button";
import { LoadingButton } from "@subboost/ui/motion/loading-button";
import { SegmentedControl } from "@subboost/ui/motion/segmented-control";
import { cn } from "@subboost/ui/lib/utils";
import { applyTheme, getCurrentTheme, persistTheme, type ThemeName } from "@subboost/ui/theme/theme";

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
  onLogout: () => void;
  children?: React.ReactNode;
  navItems?: AppNavItem[];
  activeNav?: string;
  onNavigate?: (id: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
};

/** 导航滑块共享布局的命名空间，全局唯一即可 */
const NAV_PILL_GROUP = "app-nav";

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

  return (
    <div className="min-h-dvh bg-page text-fg">
      <header className="sticky top-0 z-30 border-b border-ink/10 bg-header">
        {/*
          窄屏只留一行：品牌 + 截断的标题 + 三个图标按钮。
          刷新/退出在桌面用带文字的按钮，移动端换成 IconButton 换行不换位置，
          否则 375px 下页头会被挤成两行并把标题压没。
        */}
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2.5 sm:gap-4 sm:px-6 sm:py-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <BrandMark className="h-8 w-8 shrink-0 shadow-(--btn-primary-shadow) transition-transform duration-300 hover:rotate-6 sm:h-9 sm:w-9" />
            <div className="flex min-w-0 items-baseline gap-2">
              <h1 className="truncate text-base font-semibold text-fg sm:text-lg">{title}</h1>
              <span className="hidden shrink-0 rounded-full border border-ink/10 bg-ink/5 px-2 py-0.5 text-[11px] text-fg-45 sm:inline-block">
                v{version}
              </span>
            </div>
          </div>
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
                  <RefreshCw aria-hidden="true" className={cn(refreshing && "animate-spin")} />
                </IconButton>
                <LoadingButton
                  variant="secondary"
                  size="sm"
                  onClick={onRefresh}
                  loading={refreshing}
                  loadingLabel="刷新中…"
                  className="hidden sm:inline-flex"
                >
                  <RefreshCw aria-hidden="true" />
                  刷新
                </LoadingButton>
              </>
            ) : null}
            <IconButton
              label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
              variant="ghost"
              onClick={toggleTheme}
              className="min-h-9 min-w-9"
            >
              {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            </IconButton>
            <IconButton
              label="退出登录"
              variant="ghost"
              onClick={onLogout}
              className="min-h-9 min-w-9 sm:hidden"
            >
              <LogOut aria-hidden="true" />
            </IconButton>
            <Button variant="ghost" size="sm" onClick={onLogout} className="hidden sm:inline-flex">
              <LogOut aria-hidden="true" />
              退出
            </Button>
          </div>
        </div>

        {/* 桌面导航：胶囊分段控件。移动端换成底部 tab 栏（见下方），这里整块隐藏 */}
        {navOptions.length > 0 ? (
          <div className="mx-auto hidden max-w-6xl px-4 pb-2 sm:block sm:px-6">
            <SegmentedControl
              label="主导航"
              layoutGroupId={NAV_PILL_GROUP}
              options={navOptions}
              activeId={activeId}
              onSelect={(id) => onNavigate?.(id)}
              className="w-auto"
              optionClassName="px-3 py-2"
            />
          </div>
        ) : null}
      </header>

      {/* 底部 tab 栏是 fixed 的，主区域必须留出等高的下内边距，否则最后一张卡被挡住 */}
      <main className="mx-auto max-w-6xl px-3 pb-28 pt-4 sm:px-6 sm:pb-6 sm:pt-6">
        {/* key 换页时重新挂载，触发一次 pageIn 入场；动画只动 opacity/translate */}
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
      */}
      {navOptions.length > 0 ? (
        <nav
          aria-label="主导航"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-header pb-[env(safe-area-inset-bottom)] sm:hidden"
        >
          <ul className="flex items-stretch">
            {navOptions.map((option) => {
              const active = option.id === activeId;
              return (
                <li key={option.id} className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => onNavigate?.(option.id)}
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
