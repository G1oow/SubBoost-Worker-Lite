import * as React from "react";
import { Boxes, Network, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@subboost/ui/components/ui/badge";
import { Button } from "@subboost/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@subboost/ui/components/ui/card";
import { confirmDialog } from "@subboost/ui/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@subboost/ui/components/ui/dialog";
import { FormField } from "@subboost/ui/components/ui/form-field";
import { IconButton } from "@subboost/ui/components/ui/icon-button";
import { Input } from "@subboost/ui/components/ui/input";
import { LoadingButton } from "@subboost/ui/motion/loading-button";
import { MotionItem, MotionList } from "@subboost/ui/motion/motion-list";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@subboost/ui/components/ui/select";
import { SwitchField } from "@subboost/ui/components/ui/switch-field";
import { Textarea } from "@subboost/ui/components/ui/textarea";
import { useToast } from "@subboost/ui/components/ui/toaster";
import { NodeRenameEditor } from "./node-rename-editor";
import type {
  AppState,
  NodeRenames,
  NodeSummary,
  ParseNodesResponse,
  SourceDto,
  SourceInput,
  SourceKind,
  SourceNodesResponse,
} from "../lib/types";

export type SourcesPanelProps = {
  state: AppState;
  onSave: (sources: SourceInput[]) => Promise<void>;
  /** 解析手动节点文本，返回节点名称与协议（用于导入时预览/改名） */
  onParseNodes?: (text: string) => Promise<ParseNodesResponse>;
  /** 读取某个源当前解析出的节点，用于单独改名 */
  onLoadNodes?: (sourceId: string) => Promise<SourceNodesResponse>;
};

type Draft = {
  id?: string;
  name: string;
  kind: SourceKind;
  url: string;
  manualText: string;
  userAgent: string;
  enabled: boolean;
  nodeRenames: NodeRenames;
};

type ParseState = {
  status: "idle" | "loading" | "ready" | "error";
  nodes: NodeSummary[];
  errors: string[];
  message?: string;
};

const EMPTY_PARSE: ParseState = { status: "idle", nodes: [], errors: [] };
const PARSE_DEBOUNCE_MS = 450;

function emptyDraft(): Draft {
  return {
    name: "",
    kind: "remote",
    url: "",
    manualText: "",
    userAgent: "",
    enabled: true,
    nodeRenames: {},
  };
}

function toDraft(source: SourceDto): Draft {
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    url: source.url ?? "",
    manualText: source.manualText ?? "",
    userAgent: source.userAgent ?? "",
    enabled: source.enabled,
    nodeRenames: { ...(source.nodeRenames ?? {}) },
  };
}

function toInput(source: SourceDto): SourceInput {
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    ...(source.kind === "remote" ? { url: source.url } : { manualText: source.manualText }),
    enabled: source.enabled,
    ...(source.userAgent ? { userAgent: source.userAgent } : {}),
    ...(source.nodeRenames && Object.keys(source.nodeRenames).length > 0
      ? { nodeRenames: source.nodeRenames }
      : {}),
  };
}

export function SourcesPanel({ state, onSave, onParseNodes, onLoadNodes }: SourcesPanelProps) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(emptyDraft());
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [parse, setParse] = React.useState<ParseState>(EMPTY_PARSE);

  const [nodesDialog, setNodesDialog] = React.useState<{
    source: SourceDto;
    loading: boolean;
    data: SourceNodesResponse | null;
    renames: NodeRenames;
    error: string;
  } | null>(null);

  const statusBySource = new Map((state.status?.sources ?? []).map((item) => [item.sourceId, item]));

  // 手动节点文本变化后做一次防抖解析，导入时即可看到节点名称与协议
  React.useEffect(() => {
    if (!open || draft.kind !== "manual" || !onParseNodes) {
      setParse(EMPTY_PARSE);
      return;
    }
    const text = draft.manualText;
    if (!text.trim()) {
      setParse({ status: "ready", nodes: [], errors: [] });
      return;
    }

    let cancelled = false;
    setParse((current) => ({ ...current, status: "loading" }));
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await onParseNodes(text);
          if (cancelled) return;
          setParse({ status: "ready", nodes: result.nodes, errors: result.errors });
        } catch (err) {
          if (cancelled) return;
          setParse({
            status: "error",
            nodes: [],
            errors: [],
            message: err instanceof Error ? err.message : "解析失败",
          });
        }
      })();
    }, PARSE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, draft.kind, draft.manualText, onParseNodes]);

  const openCreate = () => {
    setDraft(emptyDraft());
    setEditingIndex(null);
    setError("");
    setParse(EMPTY_PARSE);
    setOpen(true);
  };

  const openEdit = (source: SourceDto) => {
    setDraft(toDraft(source));
    setEditingIndex(state.sources.findIndex((item) => item.id === source.id));
    setError("");
    setParse(EMPTY_PARSE);
    setOpen(true);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!draft.name.trim()) {
      setError("请填写源名称");
      return;
    }
    if (draft.kind === "remote" && !draft.url.trim()) {
      setError("请填写订阅 URL");
      return;
    }
    if (draft.kind === "manual" && !draft.manualText.trim()) {
      setError("请填写节点文本");
      return;
    }

    const renames = Object.keys(draft.nodeRenames).length > 0 ? draft.nodeRenames : undefined;
    const input: SourceInput = {
      ...(draft.id ? { id: draft.id } : {}),
      name: draft.name.trim(),
      kind: draft.kind,
      enabled: draft.enabled,
      ...(draft.userAgent.trim() ? { userAgent: draft.userAgent.trim() } : {}),
      ...(renames ? { nodeRenames: renames } : {}),
      ...(draft.kind === "remote" ? { url: draft.url.trim() } : { manualText: draft.manualText }),
    };

    const next = state.sources.map(toInput);
    if (editingIndex === null) next.push(input);
    else next[editingIndex] = input;

    setSaving(true);
    try {
      await onSave(next);
      toast({ variant: "success", title: "已保存源" });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (source: SourceDto) => {
    const confirmed = await confirmDialog({
      title: "删除源？",
      description: `删除「${source.name}」会同时移除它的节点快照，引用它的订阅将重新生成。`,
      confirmText: "删除",
      variant: "destructive",
    });
    if (!confirmed) return;
    const next = state.sources.filter((item) => item.id !== source.id).map(toInput);
    try {
      await onSave(next);
      toast({ variant: "success", title: "已删除源" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "删除失败",
        description: err instanceof Error ? err.message : "删除失败",
      });
    }
  };

  const openNodes = async (source: SourceDto) => {
    setNodesDialog({ source, loading: true, data: null, renames: { ...(source.nodeRenames ?? {}) }, error: "" });
    if (!onLoadNodes) {
      setNodesDialog((current) =>
        current ? { ...current, loading: false, error: "当前版本不支持读取节点列表。" } : current
      );
      return;
    }
    try {
      const data = await onLoadNodes(source.id);
      setNodesDialog((current) => (current ? { ...current, loading: false, data } : current));
    } catch (err) {
      setNodesDialog((current) =>
        current
          ? { ...current, loading: false, error: err instanceof Error ? err.message : "加载节点失败" }
          : current
      );
    }
  };

  const saveNodeRenames = async () => {
    if (!nodesDialog) return;
    const { source, renames } = nodesDialog;
    const next = state.sources.map((item) => {
      if (item.id !== source.id) return toInput(item);
      const base = toInput(item);
      const cleaned: NodeRenames = Object.fromEntries(
        Object.entries(renames).filter(([, value]) => value.trim().length > 0)
      );
      const { nodeRenames: _ignored, ...rest } = base;
      return Object.keys(cleaned).length > 0 ? { ...rest, nodeRenames: cleaned } : rest;
    });
    setSaving(true);
    try {
      await onSave(next);
      toast({ variant: "success", title: "已保存节点名称" });
      setNodesDialog(null);
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

  const dialogNodes = parse.nodes;
  const renamedCount = Object.keys(draft.nodeRenames).length;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="space-y-1">
          <CardTitle>源管理</CardTitle>
          <p className="text-xs text-fg-45">导入上游订阅或手动节点，可解析节点名称/协议并逐个改名。</p>
        </div>
        <Button onClick={openCreate} className="w-full shrink-0 sm:w-auto">
          <Plus aria-hidden="true" />
          添加源
        </Button>
      </CardHeader>
      <CardContent>
        {state.sources.length === 0 ? (
          <div className="animate-fade-in-up rounded-xl border border-dashed border-ink/15 px-4 py-10 text-center">
            <Boxes aria-hidden="true" className="mx-auto mb-2 h-6 w-6 text-fg-35" />
            <p className="text-sm text-fg-50">还没有源，先添加一个上游订阅或手动节点。</p>
          </div>
        ) : (
          /*
           * 每行是一张独立卡片，而不是表格行。
           * 表格的 <tr> 无法做出卡片轮廓与行间距，列宽还由表格算法强制对齐，
           * 源数量多时操作区被拉得很开、视线难以横向读完。改成卡片列表后
           * 每行自带边框与圆角，行间用 space-y 分隔，边界清楚。
           */
          <MotionList as="ul" className="space-y-2.5" animateOnMount>
            {state.sources.map((source) => {
              const status = statusBySource.get(source.id);
              const renamed = Object.keys(source.nodeRenames ?? {}).length;
              return (
                <MotionItem as="li" key={source.id} itemKey={source.id}>
                  {/* 窄屏改成上下两段：文本一行、操作一行贴右，避免长源名把三个图标挤出屏幕 */}
                  <div className="flex flex-col gap-2 rounded-xl border border-card-border bg-surface px-3 py-3 transition-[border-color,box-shadow] duration-200 hover:border-card-border-hover hover:shadow-(--card-shadow-hover) sm:flex-row sm:items-center sm:gap-3 sm:px-4">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-fg">{source.name}</span>
                        <Badge variant="secondary">
                          {source.kind === "remote" ? "远程" : "手动"}
                        </Badge>
                        <Badge variant={source.enabled ? "success" : "outline"}>
                          {source.enabled ? "启用" : "停用"}
                        </Badge>
                        {status?.ok === false ? <Badge variant="destructive">失败</Badge> : null}
                      </div>
                      <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-fg-45">
                        <span className="tabular-nums">{status?.nodeCount ?? "-"} 个节点</span>
                        {renamed > 0 ? <span>· 已改名 {renamed} 个</span> : null}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
                      <IconButton
                        label={`查看 ${source.name} 的节点`}
                        variant="ghost"
                        onClick={() => void openNodes(source)}
                        className="min-h-9 min-w-9"
                      >
                        <Network aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label={`编辑 ${source.name}`}
                        variant="ghost"
                        onClick={() => openEdit(source)}
                        className="min-h-9 min-w-9"
                      >
                        <Pencil aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label={`删除 ${source.name}`}
                        variant="ghost"
                        onClick={() => handleDelete(source)}
                        className="min-h-9 min-w-9"
                      >
                        <Trash2 aria-hidden="true" />
                      </IconButton>
                    </div>
                  </div>
                </MotionItem>
              );
            })}
          </MotionList>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingIndex === null ? "添加源" : "编辑源"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormField label="名称" required>
              <Input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="例如：机场 A"
              />
            </FormField>

            <FormField label="类型" required>
              <Select
                value={draft.kind}
                onValueChange={(value) => setDraft({ ...draft, kind: value as SourceKind })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="remote">远程订阅 URL</SelectItem>
                  <SelectItem value="manual">手动节点文本</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            {draft.kind === "remote" ? (
              <FormField label="订阅 URL" required description="仅支持 http/https，且必须通过 SSRF 校验。">
                <Input
                  value={draft.url}
                  onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                  placeholder="https://example.com/sub?token=..."
                />
              </FormField>
            ) : (
              <FormField label="节点文本" required description="每行一个节点链接，最多 512 KiB。">
                <Textarea
                  value={draft.manualText}
                  onChange={(event) => setDraft({ ...draft, manualText: event.target.value })}
                  className="min-h-[160px] font-mono text-xs"
                  placeholder="ss://..."
                />
              </FormField>
            )}

            {draft.kind === "manual" ? (
              <div className="space-y-2 rounded-xl border border-ink/10 bg-ink/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-fg-80">解析出的节点</p>
                  {parse.status === "loading" ? (
                    <span className="text-[11px] text-fg-45">解析中…</span>
                  ) : parse.status === "error" ? (
                    <span className="text-[11px] text-red-400">{parse.message}</span>
                  ) : (
                    <span className="text-[11px] text-fg-45">可直接修改节点名称</span>
                  )}
                </div>
                <NodeRenameEditor
                  nodes={dialogNodes}
                  renames={draft.nodeRenames}
                  onChange={(next) => setDraft({ ...draft, nodeRenames: next })}
                  loading={parse.status === "loading"}
                  emptyHint="粘贴节点链接后会自动解析出名称与协议。"
                />
                {parse.errors.length > 0 ? (
                  <p className="text-[11px] text-amber-400">
                    {parse.errors.length} 条节点解析失败：{parse.errors.slice(0, 2).join("；")}
                  </p>
                ) : null}
                {renamedCount > 0 ? (
                  <p className="text-[11px] text-fg-45">保存后立即生效，订阅链接无需更换。</p>
                ) : null}
              </div>
            ) : null}

            <FormField label="User-Agent" description="可选，留空使用默认 mihomo UA。">
              <Input
                value={draft.userAgent}
                onChange={(event) => setDraft({ ...draft, userAgent: event.target.value })}
                placeholder="mihomo/1.19.24"
              />
            </FormField>

            <SwitchField
              label="启用该源"
              description="停用后刷新与订阅生成都会跳过它。"
              checked={draft.enabled}
              onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })}
            />

            {error ? (
              <p className="text-sm text-red-400" role="alert">
                {error}
              </p>
            ) : null}

            <DialogFooter className="gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                取消
              </Button>
              <LoadingButton type="submit" loading={saving} loadingLabel="保存中…">
                保存
              </LoadingButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={nodesDialog !== null} onOpenChange={(next) => (next ? undefined : setNodesDialog(null))}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{nodesDialog ? `节点 · ${nodesDialog.source.name}` : "节点"}</DialogTitle>
          </DialogHeader>
          {nodesDialog ? (
            <div className="space-y-4">
              {nodesDialog.error ? (
                <p className="text-sm text-red-400" role="alert">
                  {nodesDialog.error}
                </p>
              ) : null}
              <NodeRenameEditor
                nodes={nodesDialog.data?.nodes ?? []}
                renames={nodesDialog.renames}
                onChange={(next) => setNodesDialog({ ...nodesDialog, renames: next })}
                loading={nodesDialog.loading}
                maxHeightClassName="max-h-[52dvh] sm:max-h-[420px]"
                emptyHint={
                  nodesDialog.source.kind === "manual"
                    ? "该源还没有可解析的节点文本。"
                    : "还没有节点快照，先刷新一次即可看到节点。"
                }
              />
              {nodesDialog.data?.parseErrors.length ? (
                <p className="text-[11px] text-amber-400">
                  {nodesDialog.data.parseErrors.length} 条节点解析失败：
                  {nodesDialog.data.parseErrors.slice(0, 2).join("；")}
                </p>
              ) : null}
              <DialogFooter className="gap-2">
                <Button type="button" variant="secondary" onClick={() => setNodesDialog(null)}>
                  取消
                </Button>
                <LoadingButton
                  type="button"
                  onClick={() => void saveNodeRenames()}
                  disabled={nodesDialog.loading}
                  loading={saving}
                  loadingLabel="保存中…"
                >
                  保存名称
                </LoadingButton>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
