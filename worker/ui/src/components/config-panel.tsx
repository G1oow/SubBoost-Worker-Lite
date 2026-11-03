import * as React from "react";
import { RotateCcw, Save } from "lucide-react";
import { Button } from "@subboost/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@subboost/ui/components/ui/card";
import { Textarea } from "@subboost/ui/components/ui/textarea";
import { useToast } from "@subboost/ui/components/ui/toaster";
import { LoadingButton } from "@subboost/ui/motion/loading-button";
import type { AppState } from "../lib/types";

export type ConfigPanelProps = {
  state: AppState;
  onSave: (config: Record<string, unknown>) => Promise<void>;
  onReset: () => Promise<void>;
};

export function ConfigPanel({ state, onSave, onReset }: ConfigPanelProps) {
  const { toast } = useToast();
  const [text, setText] = React.useState(() => JSON.stringify(state.config, null, 2));
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setText(JSON.stringify(state.config, null, 2));
  }, [state.config]);

  const handleSave = async () => {
    setError("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError("JSON 格式不合法");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setError("配置必须是一个 JSON 对象");
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed as Record<string, unknown>);
      toast({ variant: "success", title: "已保存配置" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await onReset();
      toast({ variant: "success", title: "已恢复默认配置" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "恢复默认失败",
        description: err instanceof Error ? err.message : "恢复默认失败",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="space-y-1">
          <CardTitle>生成配置</CardTitle>
          <p className="text-xs text-fg-45">
            {state.configIsDefault ? "当前为默认配置" : "当前为自定义配置"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="secondary"
            onClick={handleReset}
            disabled={saving}
            className="flex-1 sm:flex-none"
          >
            <RotateCcw aria-hidden="true" />
            恢复默认
          </Button>
          <LoadingButton
            onClick={handleSave}
            loading={saving}
            loadingLabel="保存中…"
            className="flex-1 sm:flex-none"
          >
            <Save aria-hidden="true" />
            保存
          </LoadingButton>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 窄屏降低最小高度：320px 的编辑器在手机上会占满两屏，必须先滚动才能看见保存按钮 */}
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="min-h-[240px] resize-y font-mono text-xs sm:min-h-[320px]"
          spellCheck={false}
          aria-label="生成配置 JSON"
        />
        {error ? (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
