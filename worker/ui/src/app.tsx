import * as React from "react";
import { Activity, LayoutDashboard, Layers, Link2, LoaderCircle, Settings } from "lucide-react";
import { Icon } from "@subboost/ui/components/ui/icon";
import { ConfirmDialogHost, confirmDialog } from "@subboost/ui/components/ui/confirm-dialog";
import { useToast } from "@subboost/ui/components/ui/toaster";
import { AppShell, type AppNavItem } from "./components/app-shell";
import { ConfigPanel } from "./components/config-panel";
import { DashboardPanel } from "./components/dashboard-panel";
import { SourcesPanel } from "./components/sources-panel";
import { StatusPanel } from "./components/status-panel";
import { SubscriptionsPanel, type SubscriptionUpdatePatch } from "./components/subscriptions-panel";
import { DemoBanner } from "./components/demo-banner";
import { TokenGate } from "./components/token-gate";
import { clearAdminToken, readAdminToken, writeAdminToken } from "./lib/admin-token";
import { createApiClient } from "./lib/api-client";
import {
  DEFAULT_CONFIG_SECTION,
  formatAppHash,
  isPageId,
  parseAppHash,
  type AppRoute,
  type ConfigSection,
} from "./lib/routes";
import type {
  AppState,
  ChainOption,
  ConfigPreview,
  DashboardStats,
  ParseNodesResponse,
  SourceInput,
  SourceNodesResponse,
  StatusRecord,
} from "./lib/types";
import { runPageTransition } from "./lib/view-transition";

// 构建期常量（由 vite.config.ts 的 define 注入）。写成模块内的本地常量而
// 不是跨文件导入，正式构建才能把它折叠成 false，进而摇掉演示分支与它的 chunk。
const DEMO_MODE: boolean = __SUBBOOST_DEMO__;

type SubscriptionResponse = { subscription: AppState["subscriptions"][number] };
type SourcesResponse = { sources: AppState["sources"] };
type StatusResponse = { status: StatusRecord };
type ConfigResponse = { config: Record<string, unknown>; configIsDefault: boolean };

function readRouteFromHash(): AppRoute {
  if (typeof window === "undefined") return parseAppHash("");
  return parseAppHash(window.location.hash);
}

/** 「生成配置」有未保存的修改时，离开前先确认 */
function confirmDiscardConfigChanges(): Promise<boolean> {
  return confirmDialog({
    title: "放弃未保存的配置修改？",
    description: "「生成配置」里还有没保存的修改，离开后会丢失。",
    confirmText: "放弃并离开",
    cancelText: "留在本页",
    variant: "warning",
  });
}

const NAV_ITEMS: AppNavItem[] = [
  { id: "dashboard", label: "仪表板", icon: <Icon icon={LayoutDashboard} size="md" /> },
  { id: "sources", label: "源管理", icon: <Icon icon={Layers} size="md" /> },
  { id: "subscriptions", label: "订阅链接", icon: <Icon icon={Link2} size="md" /> },
  { id: "status", label: "刷新状态", icon: <Icon icon={Activity} size="md" /> },
  { id: "config", label: "生成配置", icon: <Icon icon={Settings} size="md" /> },
];

export function App() {
  const { toast } = useToast();
  const [token, setToken] = React.useState<string | null>(() =>
    // 演示构建不需要真实凭据：给一个非空占位直接进入（鉴权由内存后端统一注入）
    DEMO_MODE ? "demo-session" : readAdminToken()
  );
  const [state, setState] = React.useState<AppState | null>(null);
  const [stats, setStats] = React.useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [route, setRoute] = React.useState<AppRoute>(() => readRouteFromHash());
  const page = route.page;
  const routeRef = React.useRef(route);
  /** 由生成配置页上报；只在事件回调里读取，不触发重渲染 */
  const configDirtyRef = React.useRef(false);

  React.useEffect(() => {
    routeRef.current = route;
  }, [route]);

  const handleUnauthorized = React.useCallback(() => {
    clearAdminToken();
    setToken(null);
    setState(null);
    setStats(null);
  }, []);

  const client = React.useMemo(
    () =>
      createApiClient({
        getToken: () => token,
        onUnauthorized: handleUnauthorized,
        // 演示构建把所有 /api 请求交给浏览器内存里的真实路由处理。
        // 这里用动态 import，正式构建折叠掉该分支后，演示代码与它的 chunk 都不会产生。
        ...(DEMO_MODE
          ? {
              fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) =>
                import("./demo/demo-backend").then((mod) =>
                  mod.getDemoBackend().dispatch(input, init)
                )) as typeof fetch,
            }
          : {}),
      }),
    [token, handleUnauthorized]
  );

  const loadState = React.useCallback(async () => {
    setLoading(true);
    try {
      const next = await client.get<AppState>("/api/state");
      setState(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : "加载失败";
      toast({ variant: "destructive", title: "加载失败", description: message });
    } finally {
      setLoading(false);
    }
  }, [client, toast]);

  const loadStats = React.useCallback(async () => {
    setStatsLoading(true);
    try {
      setStats(await client.get<DashboardStats>("/api/dashboard"));
    } catch {
      // 仪表板允许降级：/api/state 的数据仍可渲染大部分内容
    } finally {
      setStatsLoading(false);
    }
  }, [client]);

  React.useEffect(() => {
    if (token) void loadState();
  }, [token, loadState]);

  React.useEffect(() => {
    if (state) void loadStats();
  }, [state, loadStats]);

  // 用 hash 保存当前页面，刷新/前进后退都能回到同一页
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onHashChange = () => {
      const next = parseAppHash(window.location.hash);
      const current = routeRef.current;
      if (next.page === current.page && next.configSection === current.configSection) return;
      if (current.page === "config" && next.page !== "config" && configDirtyRef.current) {
        // 浏览器前进/后退离开生成配置：先把地址栏放回去，确认放弃后再真正离开
        window.history.replaceState(null, "", formatAppHash(current));
        void confirmDiscardConfigChanges().then((confirmed) => {
          if (!confirmed) return;
          configDirtyRef.current = false;
          window.history.replaceState(null, "", formatAppHash(next));
          setRoute(next);
        });
        return;
      }
      setRoute(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // 关闭或刷新标签页时由浏览器弹出它自己的确认框
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!configDirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const handleConfigDirtyChange = React.useCallback((dirty: boolean) => {
    configDirtyRef.current = dirty;
  }, []);

  /** 返回 false 表示没有换页（例如在确认框里选择了留下），外壳据此决定是否回到顶部 */
  const navigate = React.useCallback((next: string): boolean | Promise<boolean> => {
    if (!isPageId(next)) return false;
    const current = routeRef.current;
    if (next === current.page) return true;

    const go = () => {
      const nextRoute: AppRoute = { page: next, configSection: DEFAULT_CONFIG_SECTION };
      // 用 View Transition 包住页面状态更新，实现新旧页面的交叉过渡而不是硬切
      runPageTransition(() => {
        routeRef.current = nextRoute;
        setRoute(nextRoute);
        const hash = formatAppHash(nextRoute);
        if (typeof window !== "undefined" && window.location.hash !== hash) {
          window.location.hash = hash;
        }
      });
      return true;
    };

    if (current.page === "config" && configDirtyRef.current) {
      return confirmDiscardConfigChanges().then((confirmed) => {
        if (!confirmed) return false;
        configDirtyRef.current = false;
        return go();
      });
    }
    return go();
  }, []);

  /** 子页切换不新增历史记录：前进/后退仍然是在页面之间走 */
  const handleConfigSectionChange = React.useCallback((section: ConfigSection) => {
    const nextRoute: AppRoute = { page: "config", configSection: section };
    routeRef.current = nextRoute;
    setRoute(nextRoute);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", formatAppHash(nextRoute));
    }
  }, []);

  const handleAuthenticated = (nextToken: string) => {
    writeAdminToken(nextToken);
    setToken(nextToken);
  };

  const handleLogout = async () => {
    if (routeRef.current.page === "config" && configDirtyRef.current) {
      if (!(await confirmDiscardConfigChanges())) return;
      configDirtyRef.current = false;
    }
    clearAdminToken();
    setToken(null);
    setState(null);
    setStats(null);
  };

  const handleSaveSources = async (sources: SourceInput[]) => {
    const result = await client.send<SourcesResponse>("PUT", "/api/sources", { sources });
    setState((current) => (current ? { ...current, sources: result.sources } : current));
    await loadState();
  };

  const handleReorderSources = async (ids: string[]) => {
    const result = await client.send<SourcesResponse>("PUT", "/api/sources/order", { ids });
    setState((current) => (current ? { ...current, sources: result.sources } : current));
  };

  const handleReorderSubscriptions = async (ids: string[]) => {
    const result = await client.send<{ subscriptions: AppState["subscriptions"] }>(
      "PUT", "/api/subscriptions/order", { ids }
    );
    setState((current) => (current ? { ...current, subscriptions: result.subscriptions } : current));
  };

  const handleParseNodes = React.useCallback(
    async (text: string) => client.send<ParseNodesResponse>("POST", "/api/nodes/parse", { text }),
    [client]
  );

  const handleLoadNodes = React.useCallback(
    async (sourceId: string) =>
      client.get<SourceNodesResponse>(`/api/sources/${encodeURIComponent(sourceId)}/nodes`),
    [client]
  );

  const handleCreateSubscription = async (input: {
    name: string;
    sourceIds: string[];
    chainIds: string[];
  }) => {
    const result = await client.send<SubscriptionResponse>("POST", "/api/subscriptions", input);
    setState((current) =>
      current ? { ...current, subscriptions: [...current.subscriptions, result.subscription] } : current
    );
  };
  const handleUpdateSubscription = async (id: string, patch: SubscriptionUpdatePatch) => {
    const result = await client.send<SubscriptionResponse>(
      "PATCH",
      `/api/subscriptions/${encodeURIComponent(id)}`,
      patch
    );
    setState((current) =>
      current
        ? {
            ...current,
            subscriptions: current.subscriptions.map((item) =>
              item.id === id ? result.subscription : item
            ),
          }
        : current
    );
  };

  const handleRotateSubscription = async (id: string) => {
    const result = await client.send<SubscriptionResponse>(
      "POST",
      `/api/subscriptions/${encodeURIComponent(id)}/rotate`
    );
    setState((current) =>
      current
        ? {
            ...current,
            subscriptions: current.subscriptions.map((item) =>
              item.id === id ? result.subscription : item
            ),
          }
        : current
    );
  };

  /** 短链与 token 链接指向同一条订阅；生成后按 id 替换该项，弹窗与列表立即刷新 */
  const handleCreateShortLink = async (id: string) => {
    const result = await client.send<SubscriptionResponse>(
      "POST",
      `/api/subscriptions/${encodeURIComponent(id)}/short-link`
    );
    setState((current) =>
      current
        ? {
            ...current,
            subscriptions: current.subscriptions.map((item) =>
              item.id === id ? result.subscription : item
            ),
          }
        : current
    );
  };

  const handleRevokeShortLink = async (id: string) => {
    const result = await client.send<SubscriptionResponse>(
      "DELETE",
      `/api/subscriptions/${encodeURIComponent(id)}/short-link`
    );
    setState((current) =>
      current
        ? {
            ...current,
            subscriptions: current.subscriptions.map((item) =>
              item.id === id ? result.subscription : item
            ),
          }
        : current
    );
  };

  const handleDeleteSubscription = async (id: string) => {
    await client.send<void>("DELETE", `/api/subscriptions/${encodeURIComponent(id)}`);
    setState((current) =>
      current
        ? { ...current, subscriptions: current.subscriptions.filter((item) => item.id !== id) }
        : current
    );
  };

  const handleSaveConfig = async (config: Record<string, unknown>) => {
    const result = await client.send<ConfigResponse>("PUT", "/api/config", config);
    setState((current) =>
      current ? { ...current, config: result.config, configIsDefault: result.configIsDefault } : current
    );
  };

  const handleResetConfig = async () => {
    const result = await client.send<ConfigResponse>("DELETE", "/api/config");
    setState((current) =>
      current ? { ...current, config: result.config, configIsDefault: result.configIsDefault } : current
    );
  };

  const handlePreviewConfig = React.useCallback(
    async (config: Record<string, unknown>) =>
      client.send<ConfigPreview>("POST", "/api/config/preview", { config }),
    [client]
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const result = await client.send<StatusResponse>("POST", "/api/refresh");
      setState((current) => (current ? { ...current, status: result.status } : current));
      toast({ variant: "success", title: "刷新完成" });
    } finally {
      setRefreshing(false);
    }
  };

  if (!token) return <TokenGate onAuthenticated={handleAuthenticated} />;

  /* 可勾进订阅的链：链建好后就是一个源，这里把配置里的链投影成选项（不用 useMemo：本行在早返回之后） */
  const chainOptions: ChainOption[] = (() => {
    const raw = state?.config?.proxyChains;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        id: typeof item.id === "string" ? item.id.trim() : "",
        name: typeof item.name === "string" ? item.name.trim() : "",
        enabled: item.enabled !== false,
      }))
      .filter((item) => item.id);
  })();

  const navItems = NAV_ITEMS.map((item) =>
    item.id === "sources" && state
      ? { ...item, badge: state.sources.length }
      : item.id === "subscriptions" && state
        ? { ...item, badge: state.subscriptions.length }
        : item
  );

  return (
    <>
      <AppShell
        title={state?.app.name ?? "SubBoost Lite"}
        version={state?.app.version ?? ""}
        onLogout={DEMO_MODE ? undefined : () => void handleLogout()}
        navItems={state ? navItems : undefined}
        activeNav={page}
        onNavigate={navigate}
        onRefresh={state ? () => void handleRefresh() : undefined}
        refreshing={refreshing}
      >
        {loading && !state ? (
          <div className="space-y-4">
            <div className="skeleton h-28 w-full animate-shimmer" aria-hidden="true" />
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="skeleton h-24 w-full animate-shimmer" aria-hidden="true" />
              ))}
            </div>
            <div className="skeleton h-64 w-full animate-shimmer" aria-hidden="true" />
            <p className="flex items-center justify-center gap-2 py-2 text-sm text-fg-45">
              <Icon icon={LoaderCircle} size="md" className="animate-spin" />
              加载中…
            </p>
          </div>
        ) : state ? (
          <>
            {page === "dashboard" ? (
              <DashboardPanel
                state={state}
                stats={stats}
                statsLoading={statsLoading}
                refreshing={refreshing}
                onRefresh={handleRefresh}
                onNavigate={navigate}
                onLoadNodes={handleLoadNodes}
              />
            ) : null}
            {page === "sources" ? (
              <SourcesPanel
                state={state}
                onSave={handleSaveSources}
                onReorder={handleReorderSources}
                onParseNodes={handleParseNodes}
                onLoadNodes={handleLoadNodes}
              />
            ) : null}
            {page === "subscriptions" ? (
              <SubscriptionsPanel
                state={state}
                chains={chainOptions}
                onCreate={handleCreateSubscription}
                onReorder={handleReorderSubscriptions}
                onUpdate={handleUpdateSubscription}
                onRotate={handleRotateSubscription}
                onCreateShortLink={handleCreateShortLink}
                onRevokeShortLink={handleRevokeShortLink}
                onDelete={handleDeleteSubscription}
              />
            ) : null}
            {page === "status" ? (
              <StatusPanel state={state} onRefresh={handleRefresh} refreshing={refreshing} onReorderSources={handleReorderSources} onReorderSubscriptions={handleReorderSubscriptions} />
            ) : null}
            {page === "config" ? (
              <ConfigPanel
                state={state}
                section={route.configSection}
                onSectionChange={handleConfigSectionChange}
                onSave={handleSaveConfig}
                onReset={handleResetConfig}
                onPreview={handlePreviewConfig}
                onDirtyChange={handleConfigDirtyChange}
                onLoadNodes={handleLoadNodes}
              />
            ) : null}
          </>
        ) : (
          <div className="py-24 text-center text-fg-45">
            {DEMO_MODE ? "演示数据加载失败，请刷新重试。" : "加载失败，请重新输入 token。"}
          </div>
        )}
      </AppShell>
      <ConfirmDialogHost />
      {DEMO_MODE ? <DemoBanner /> : null}
    </>
  );
}
