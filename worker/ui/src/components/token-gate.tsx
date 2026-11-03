import * as React from "react";
import { KeyRound } from "lucide-react";
import { PasswordField } from "@subboost/ui/components/ui/password-field";
import { LoadingButton } from "@subboost/ui/motion/loading-button";
import { SpotlightCard } from "@subboost/ui/motion/spotlight-card";
import { createApiClient } from "../lib/api-client";

export type TokenGateProps = {
  onAuthenticated: (token: string) => void;
};

export function TokenGate({ onAuthenticated }: TokenGateProps) {
  const [token, setToken] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token.trim()) return;
    setLoading(true);
    setError("");
    try {
      const client = createApiClient({
        getToken: () => token.trim(),
        onUnauthorized: () => {},
      });
      await client.get("/api/state");
      onAuthenticated(token.trim());
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(message.includes("Unauthorized") || !message ? "访问 token 无效" : message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-md animate-rise">
        <div className="text-center mb-8">
          <div className="mb-5 flex items-center justify-center gap-2.5">
            <KeyRound className="h-6 w-6 text-primary-400" aria-hidden="true" />
            <span className="text-sm font-medium tracking-tight text-fg-60">SubBoost Lite</span>
          </div>
          <h1 className="text-2xl font-bold text-fg">管理访问</h1>
          <p className="mt-2 text-fg-50">请输入管理访问 token 以继续</p>
        </div>

        <SpotlightCard className="animate-rise stagger-2 p-5 sm:p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <PasswordField
              label="访问 token"
              placeholder="ADMIN_TOKEN"
              autoComplete="current-password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              error={error || undefined}
              className="h-12"
            />
            <LoadingButton
              type="submit"
              disabled={!token.trim()}
              loading={loading}
              loadingLabel="校验中…"
              className="h-12 w-full"
            >
              进入管理页
            </LoadingButton>
            <p className="text-xs leading-relaxed text-fg-45">
              token 仅保存在本机浏览器 localStorage，不会写入 URL、Cookie 或页面 HTML。
            </p>
          </form>
        </SpotlightCard>
      </div>
    </div>
  );
}
