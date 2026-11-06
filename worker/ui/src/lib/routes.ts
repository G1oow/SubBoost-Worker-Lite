import type { PageId } from "./types";

/**
 * 管理页的 hash 路由。
 *
 * 顶层是五个页面（`#/sources`）；「生成配置」再分子页（`#/config/rules`、`#/config/json`），
 * 子页共用同一份草稿，切换子页不是换页面，因此单独解析。
 */
export const PAGE_IDS: PageId[] = ["dashboard", "sources", "subscriptions", "status", "config"];
export const DEFAULT_PAGE: PageId = "dashboard";

export const CONFIG_SECTIONS = ["rules", "json"] as const;
export type ConfigSection = (typeof CONFIG_SECTIONS)[number];
export const DEFAULT_CONFIG_SECTION: ConfigSection = "rules";

export type AppRoute = {
  page: PageId;
  /** 只对 config 页有意义；其他页面恒为默认值 */
  configSection: ConfigSection;
};

export function isPageId(value: string): value is PageId {
  return (PAGE_IDS as string[]).includes(value);
}

export function isConfigSection(value: string): value is ConfigSection {
  return (CONFIG_SECTIONS as readonly string[]).includes(value);
}

export function parseAppHash(hash: string): AppRoute {
  const [rawPage = "", rawSection = ""] = hash
    .replace(/^#\/?/, "")
    .split("/")
    .map((part) => part.trim());
  const page = isPageId(rawPage) ? rawPage : DEFAULT_PAGE;
  const configSection =
    page === "config" && isConfigSection(rawSection) ? rawSection : DEFAULT_CONFIG_SECTION;
  return { page, configSection };
}

export function formatAppHash(route: AppRoute): string {
  return route.page === "config" ? `#/config/${route.configSection}` : `#/${route.page}`;
}
