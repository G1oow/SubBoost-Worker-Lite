import * as React from "react";
import { Braces, CircleCheck, LoaderCircle, RotateCcw, Save, TriangleAlert, Undo2 } from "lucide-react";
import { Icon } from "@subboost/ui/components/ui/icon";
import { Button } from "@subboost/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@subboost/ui/components/ui/card";
import { confirmDialog } from "@subboost/ui/components/ui/confirm-dialog";
import { Textarea } from "@subboost/ui/components/ui/textarea";
import { useToast } from "@subboost/ui/components/ui/toaster";
import { LoadingButton } from "@subboost/ui/motion/loading-button";
import { SegmentedControl } from "@subboost/ui/motion/segmented-control";
import { readChains } from "../lib/chain-editor";
import { isConfigChanged, reconcileWithBaseline, type ConfigRecord } from "../lib/rule-editor";
import type { ConfigSection } from "../lib/routes";
import type { AppState, ConfigPreview } from "../lib/types";
import { ConfigChainsSection } from "./config-chains-section";
import { ConfigRulesSection } from "./config-rules-section";

export type ConfigPanelProps = {
  state: AppState;
  section: ConfigSection;
  onSectionChange: (section: ConfigSection) => void;
  onSave: (config: Record<string, unknown>) => Promise<void>;
  onReset: () => Promise<void>;
  /** 用草稿试生成（只读、不抓上游）；不传就不做服务端校验 */
  onPreview?: (config: Record<string, unknown>) => Promise<ConfigPreview>;
  /** 有未保存的修改（含 JSON 语法错误）时通知上层，用于离开页面前确认 */
  onDirtyChange?: (dirty: boolean) => void;
};

const SECTION_OPTIONS: Array<{ id: ConfigSection; label: string }> = [
  { id: "rules", label: "规则" },
  { id: "chains", label: "链式代理" },
  { id: "json", label: "高级 JSON" },
];
/** tabpanel 的可访问名与分段控件用同一套文案 */
const SECTION_LABELS: Record<ConfigSection, string> = {
  rules: "规则",
  chains: "链式代理",
  json: "高级 JSON",
};
const PREVIEW_DEBOUNCE_MS = 600;

type PreviewState =
  | { status: "idle" }
  | { status: "loading"; data?: ConfigPreview }
  | { status: "ready"; data: ConfigPreview }
  | { status: "error"; message: string };

function prettyJson(config: ConfigRecord): string {
  return JSON.stringify(config, null, 2);
}

function parseJsonDraft(text: string): { ok: true; config: ConfigRecord } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `JSON 语法错误：${err instanceof Error ? err.message : "无法解析"}` };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "配置必须是一个 JSON 对象" };
  }
  return { ok: true, config: parsed as ConfigRecord };
}

/**
 * 生成配置页。
 *
 * 「规则」与「高级 JSON」共用同一份草稿，只有一个保存（PUT /api/config）：
 * 可视化只改自己负责的字段，其余字段原样保留；JSON 写坏时不能切回可视化，也不能保存。
 */
export function ConfigPanel({
  state,
  section,
  onSectionChange,
  onSave,
  onReset,
  onPreview,
  onDirtyChange,
}: ConfigPanelProps) {
  const { toast } = useToast();
  const baseline = state.config;
  const [draft, setDraft] = React.useState<ConfigRecord>(baseline);
  const [jsonText, setJsonText] = React.useState(() => prettyJson(baseline));
  const [jsonError, setJsonError] = React.useState<string | null>(null);
  const [sectionNotice, setSectionNotice] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const [preview, setPreview] = React.useState<PreviewState>({ status: "idle" });

  const baselineRef = React.useRef(baseline);
  const draftRef = React.useRef(draft);
  const jsonErrorRef = React.useRef(jsonError);
  const discardOnNextBaselineRef = React.useRef(false);

  React.useEffect(() => {
    draftRef.current = draft;
    jsonErrorRef.current = jsonError;
  }, [draft, jsonError]);

  // 上层重新拉取状态时 config 是一个新对象：没有未保存的修改就跟随它，
  // 有修改就保留草稿，免得「保存源」之类的刷新把正在编辑的内容冲掉
  React.useEffect(() => {
    const previous = baselineRef.current;
    if (previous === baseline) return;
    baselineRef.current = baseline;
    const discard = discardOnNextBaselineRef.current;
    discardOnNextBaselineRef.current = false;
    if (!discard && (jsonErrorRef.current || isConfigChanged(draftRef.current, previous))) return;
    setDraft(baseline);
    setJsonText(prettyJson(baseline));
    setJsonError(null);
  }, [baseline]);

  // 进入 JSON 子页时按当前草稿重排一遍文本（可视化里的修改要能在这里看到）
  React.useEffect(() => {
    if (section === "json" && !jsonErrorRef.current) setJsonText(prettyJson(draftRef.current));
  }, [section]);

  const activeSection: ConfigSection = jsonError ? "json" : section;
  React.useEffect(() => {
    if (jsonError && section !== "json") onSectionChange("json");
  }, [jsonError, section, onSectionChange]);

  const dirty = React.useMemo(
    () => jsonError !== null || isConfigChanged(draft, baseline),
    [draft, baseline, jsonError]
  );
  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  React.useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  React.useEffect(() => {
    if (!onPreview || jsonError) return;
    let cancelled = false;
    // 校验期间保留上一次的数字，避免每次改动摘要都闪一下
    setPreview((current) =>
      current.status === "ready" || (current.status === "loading" && current.data)
        ? { status: "loading", data: current.data }
        : { status: "loading" }
    );
    const timer = setTimeout(() => {
      onPreview(draft).then(
        (data) => {
          if (!cancelled) setPreview({ status: "ready", data });
        },
        (err: unknown) => {
          if (!cancelled) {
            setPreview({ status: "error", message: err instanceof Error ? err.message : "校验失败" });
          }
        }
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft, jsonError, onPreview]);

  const applyVisual = React.useCallback((next: ConfigRecord) => {
    setDraft(reconcileWithBaseline(next, baselineRef.current));
  }, []);

  const handleJsonChange = (text: string) => {
    setJsonText(text);
    const result = parseJsonDraft(text);
    if (result.ok) {
      setDraft(result.config);
      setJsonError(null);
      setSectionNotice("");
    } else {
      setJsonError(result.error);
    }
  };

  const selectSection = (id: string) => {
    const next = id as ConfigSection;
    if (next === activeSection) return;
    if (next !== "json" && jsonError) {
      setSectionNotice("JSON 有语法错误，修正后才能切回可视化编辑。");
      return;
    }
    setSectionNotice("");
    onSectionChange(next);
  };

  const handleSave = async () => {
    if (jsonError || saving) return;
    if (preview.status === "error") {
      const confirmed = await confirmDialog({
        title: "生成校验未通过，仍要保存？",
        description: `${preview.message}\n\n保存后订阅会继续使用上一次成功生成的结果，直到配置修正。`,
        confirmText: "仍然保存",
        variant: "warning",
      });
      if (!confirmed) return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      toast({ variant: "success", title: "已保存配置", description: "订阅下次被拉取时按新配置重新生成。" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "保存失败",
        description: err instanceof Error ? err.message : "保存失败",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = async () => {
    const confirmed = await confirmDialog({
      title: "放弃未保存的修改？",
      description: "草稿会恢复成上一次保存的配置。",
      confirmText: "放弃修改",
      variant: "warning",
    });
    if (!confirmed) return;
    setDraft(baseline);
    setJsonText(prettyJson(baseline));
    setJsonError(null);
    setSectionNotice("");
  };

  const handleReset = async () => {
    const confirmed = await confirmDialog({
      title: "恢复默认配置？",
      description: `${dirty ? "当前未保存的修改会被丢弃，" : ""}已保存的配置会被删除并恢复为默认值：自定义规则、规则集、分流组开关与顺序调整都会清空。此操作不可撤销。`,
      confirmText: "恢复默认",
      variant: "destructive",
    });
    if (!confirmed) return;
    setResetting(true);
    discardOnNextBaselineRef.current = true;
    try {
      await onReset();
      toast({ variant: "success", title: "已恢复默认配置" });
    } catch (err) {
      discardOnNextBaselineRef.current = false;
      toast({
        variant: "destructive",
        title: "恢复默认失败",
        description: err instanceof Error ? err.message : "恢复默认失败",
      });
    } finally {
      setResetting(false);
    }
  };

  const statusText = [
    state.configIsDefault ? "当前使用默认配置" : "当前使用自定义配置",
    dirty ? "有未保存的修改" : "",
  ]
    .filter(Boolean)
    .join(" · ");

  // 预览里的逐条链状态：还没跑完第一次校验、或校验直接失败时没有这层数据
  const previewChains =
    preview.status === "idle" || preview.status === "error" ? undefined : preview.data?.chains;
  // 分段控件上的数量徽标：不点进去也能看出有几条链
  const chainCount = React.useMemo(() => readChains(draft).length, [draft]);
  const sectionOptions = SECTION_OPTIONS.map((option) =>
    option.id === "chains" && chainCount > 0 ? { ...option, badge: chainCount } : option
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="space-y-1">
            <CardTitle>生成配置</CardTitle>
            <p className="text-xs text-fg-45">{statusText}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => void handleReset()}
              disabled={saving || resetting || (state.configIsDefault && !dirty)}
              className="flex-1 sm:flex-none"
            >
              <Icon icon={RotateCcw} />
              恢复默认
            </Button>
            <LoadingButton
              onClick={() => void handleSave()}
              loading={saving}
              loadingLabel="保存中…"
              disabled={!dirty || jsonError !== null || resetting}
              className="flex-1 sm:flex-none"
            >
              <Icon icon={Save} />
              保存
            </LoadingButton>
          </div>
        </CardHeader>
        {/* 分区切换与生成校验放同一行：切换的同时就能看到这份草稿能不能生成 */}
        <CardContent className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
          <SegmentedControl
            label="生成配置分区"
            layoutGroupId="config-sections"
            options={sectionOptions}
            activeId={activeSection}
            onSelect={selectSection}
            className="self-start"
          />
          {sectionNotice ? (
            <p className="text-xs text-danger-note-fg" role="alert">
              {sectionNotice}
            </p>
          ) : null}
          {onPreview && !sectionNotice ? <PreviewStatusLine preview={preview} /> : null}
        </CardContent>
      </Card>

      {/* 子页切换与顶层切页同一套入场：只淡入，按分区重新挂载 */}
      <div
        key={activeSection}
        role="tabpanel"
        aria-label={SECTION_LABELS[activeSection]}
        className="animate-page-in space-y-4 sm:space-y-6"
      >
        {activeSection === "rules" ? <ConfigRulesSection config={draft} onChange={applyVisual} /> : null}
        {activeSection === "chains" ? (
          <ConfigChainsSection
            config={draft}
            sources={state.sources}
            previewChains={previewChains}
            onChange={applyVisual}
          />
        ) : null}
        {activeSection === "json" ? (
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="space-y-1">
                <CardTitle>高级 JSON</CardTitle>
                <p className="text-xs leading-relaxed text-fg-45">
                  与「规则」「链式代理」共用同一份草稿：可视化不认识的字段在这里原样保留。JSON 写坏时不能切回可视化，也不能保存。
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setJsonText(prettyJson(draft))}
                disabled={jsonError !== null}
                className="shrink-0 self-end sm:self-auto"
              >
                <Icon icon={Braces} />
                格式化
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* 窄屏降低最小高度：320px 以上的编辑器在手机上会占满两屏 */}
              <Textarea
                value={jsonText}
                onChange={(event) => handleJsonChange(event.target.value)}
                className="min-h-[240px] resize-y font-mono text-xs sm:min-h-[420px]"
                spellCheck={false}
                aria-label="生成配置 JSON"
                aria-invalid={jsonError !== null}
                aria-describedby={jsonError ? "config-json-error" : undefined}
              />
              {jsonError ? (
                <p id="config-json-error" className="text-sm text-danger-note-fg" role="alert">
                  {jsonError}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* 保存条是 fixed 的：留出等高空白，最后一张卡不会被它挡住 */}
      {dirty ? <div aria-hidden="true" className="h-16" /> : null}

      {/*
        未保存时才挂载的保存条：规则列表很长，滚到中间改完不必再回到顶部保存。
        常驻覆盖层的约定同吸顶工具条——不用 translate / transition，只跑只驱动 opacity 的入场关键帧，
        表面用不透明 bg-header；移动端坐在底部 tab 栏之上。
      */}
      {dirty ? (
        <div
          data-config-save-bar="true"
          className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 animate-fade-in px-3 pb-2 sm:bottom-0 sm:px-6 sm:pb-4"
        >
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 rounded-2xl border border-card-border bg-header px-4 py-2.5 shadow-(--popover-shadow)">
            <p className="text-sm text-fg-70" aria-live="polite">
              {jsonError ? "JSON 有语法错误，修正后才能保存" : "有未保存的修改"}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => void handleDiscard()} disabled={saving}>
                <Icon icon={Undo2} />
                放弃
              </Button>
              <LoadingButton
                size="sm"
                onClick={() => void handleSave()}
                loading={saving}
                loadingLabel="保存中…"
                disabled={jsonError !== null || resetting}
              >
                <Icon icon={Save} />
                保存
              </LoadingButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PreviewStatusLine({ preview }: { preview: PreviewState }) {
  if (preview.status === "idle") return null;
  if (preview.status === "error") {
    return (
      <p className="flex items-start gap-1.5 text-xs text-danger-note-fg" role="alert">
        <Icon icon={TriangleAlert} size="sm" className="mt-px shrink-0" />
        <span>生成校验未通过：{preview.message}</span>
      </p>
    );
  }

  const loading = preview.status === "loading";
  const data = preview.data;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-fg-45 lg:justify-end" role="status">
      <Icon
        icon={loading ? LoaderCircle : CircleCheck}
        size="sm"
        className={loading ? "animate-spin" : "animate-icon-pop text-success-note-fg"}
      />
      <span className="font-medium text-fg-70">
        {loading ? (data ? "正在重新校验…" : "正在按草稿试生成…") : "生成校验通过"}
      </span>
      {data ? (
        <>
          <span className="tabular-nums">
            {`· ${data.rules.length} 条规则 · ${data.proxyGroupCount} 个代理组 · ${data.ruleProviderCount} 个规则集`}
          </span>
          <span
            className="tabular-nums"
            title="试生成只读现有快照，不抓取上游，也不写缓存"
          >
            {`· 基于 ${data.snapshotCount}/${data.sourceCount} 个源的快照（${data.nodeCount} 个节点）`}
          </span>
        </>
      ) : null}
    </p>
  );
}
