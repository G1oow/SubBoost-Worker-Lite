import * as React from "react";
import { Activity, LayoutDashboard, Layers, Link2, Loader2, Settings } from "lucide-react";
import { ConfirmDialogHost } from "@subboost/ui/components/ui/confirm-dialog";
import { useToast } from "@subboost/ui/components/ui/toaster";
import { AppShell, type AppNavItem } from "./components/app-shell";
import { ConfigPanel } from "./components/config-panel";
import { DashboardPanel } from "./components/dashboard-panel";
import { SourcesPanel } from "./components/sources-panel";
import { StatusPanel } from "./components/status-panel";
import { SubscriptionsPanel, type SubscriptionUpdatePatch } from "./components/subscriptions-panel";
import { TokenGate } from "./components/token-gate";
import { clearAdminToken, readAdminToken, writeAdminToken } from "./lib/admin-token";
import { createApiClient } from "./lib/api-client";
import type {
  AppState,
  DashboardStats,
  PageId,
  ParseNodesResponse,
  SourceInput,
  SourceNodesResponse,
  StatusRecord,
} from "./lib/types";
import { runPageTransition } from "./lib/view-transition";

type SubscriptionResponse = { subscription: AppState["subscriptions"][number] };
type SourcesResponse = { sources: AppState["sources"] };
type StatusResponse = { status: StatusRecord };
type ConfigResponse = { config: Record<string, unknown>; configIsDefault: boolean };

const PAGE_IDS: PageId[] = ["dashboard", "sources", "subscriptions", "status", "config"];
const DEFAULT_PAGE: PageId = "dashboard";

function isPageId(value: string): value is PageId {
  return (PAGE_IDS as string[]).includes(value);
}

function readPageFromHash(): PageId {
  if (typeof window === "undefined") return DEFAULT_PAGE;
  const raw = window.location.hash.replace(/^#\/?/, "").trim();
  return isPageId(raw) ? raw : DEFAULT_PAGE;
}

const NAV_ITEMS: AppNavItem[] = [
  { id: "dashboard", label: "仪表板", icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: "sources", label: "源管理", icon: <Layers className="h-4 w-4" /> },
  { id: "subscriptions", label: "订阅链接", icon: <Link2 className="h-4 w-4" /> },
  { id: "status", label: "刷新状态", icon: <Activity className="h-4 w-4" /> },
  { id: "config", label: "生成配置", icon: <Settings className="h-4 w-4" /> },
];

export function App() {
  const { toast } = useToast();
  const [token, setToken] = React.useState<string | null>(() => readAdminToken());
  const [state, setState] = React.useState<AppState | null>(null);
  const [stats, setStats] = React.useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [page, setPage] = React.useState<PageId>(() => readPageFromHash());

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
    const onHashChange = () => setPage(readPageFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = React.useCallback((next: string) => {
    if (!isPageId(next)) return;
    // 用 View Transition 包住页面状态更新，实现新旧页面的交叉过渡而不是硬切
    runPageTransition(() => {
      setPage(next);
      if (typeof window !== "undefined" && window.location.hash !== `#/${next}`) {
        window.location.hash = `#/${next}`;
      }
    });
  }, []);

  const handleAuthenticated = (nextToken: string) => {
    writeAdminToken(nextToken);
    setToken(nextToken);
  };

  const handleLogout = () => {
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

  const handleParseNodes = React.useCallback(
    async (text: string) => client.send<ParseNodesResponse>("POST", "/api/nodes/parse", { text }),
    [client]
  );

  const handleLoadNodes = React.useCallback(
    async (sourceId: string) =>
      client.get<SourceNodesResponse>(`/api/sources/${encodeURIComponent(sourceId)}/nodes`),
    [client]
  );

  const handleCreateSubscription = async (input: { name: string; sourceIds: string[] }) => {
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
        onLogout={handleLogout}
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
            <p className="flex items-center justify-center gap-2 py-2 text-sm text-fg-50">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
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
                onParseNodes={handleParseNodes}
                onLoadNodes={handleLoadNodes}
              />
            ) : null}
            {page === "subscriptions" ? (
              <SubscriptionsPanel
                state={state}
                onCreate={handleCreateSubscription}
                onUpdate={handleUpdateSubscription}
                onRotate={handleRotateSubscription}
                onDelete={handleDeleteSubscription}
              />
            ) : null}
            {page === "status" ? (
              <StatusPanel state={state} onRefresh={handleRefresh} refreshing={refreshing} />
            ) : null}
            {page === "config" ? (
              <ConfigPanel state={state} onSave={handleSaveConfig} onReset={handleResetConfig} />
            ) : null}
          </>
        ) : (
          <div className="py-24 text-center text-fg-50">加载失败，请重新输入 token。</div>
        )}
      </AppShell>
      <ConfirmDialogHost />
    </>
  );
}
