import * as React from "react";
import { X } from "lucide-react";
import { Badge } from "@subboost/ui/components/ui/badge";
import { Button } from "@subboost/ui/components/ui/button";
import { EmptyState } from "@subboost/ui/components/ui/empty-state";
import { Icon } from "@subboost/ui/components/ui/icon";
import { IconButton } from "@subboost/ui/components/ui/icon-button";
import { Input } from "@subboost/ui/components/ui/input";
import { InlineNote } from "@subboost/ui/components/ui/inline-note";
import {
  NODE_NAME_TEMPLATE_MAX_LENGTH,
  NODE_NAME_TEMPLATE_VARIABLES,
  applyNodeNameTemplate,
  validateNodeNameTemplate,
  type NodeNameTemplateVariable,
} from "@subboost/core/node-name-template";
import { cn } from "@subboost/ui/lib/utils";
import type { NodeSummary } from "../lib/types";

/** 变量按钮上显示的名字；插入的文本始终是 `{key}` */
const VARIABLE_LABEL: Record<NodeNameTemplateVariable, string> = {
  name: "节点名",
  protocol: "代理协议",
  ip: "IP",
  server: "服务器",
  port: "端口",
  sourceName: "源名称",
  flag: "地区国旗",
};

/** 预览里最多对比多少行，够看出效果又不至于把弹窗撑长 */
const PREVIEW_LIMIT = 5;

export type NodeNameTemplateEditorProps = {
  template: string;
  onChange: (next: string) => void;
  /** 该源的名称，供 `{sourceName}` 预览 */
  sourceName?: string;
  /** 当前源的节点，用于内联预览 */
  nodes?: NodeSummary[];
  className?: string;
};

/**
 * 把节点摘要还原成模板求值需要的形状。
 *
 * 预览必须与生成链路算得一样，所以不另写一套：这里只是把 `originName` 摆回 `name`
 * （生成时快照里存的就是上游原名，逐节点改名表在这一步之后才套用）。
 */
function toPreviewNode(node: NodeSummary) {
  return {
    name: node.originName || node.name,
    type: node.type,
    server: node.server,
    port: node.port,
  };
}

/**
 * 命名模板编辑器：一条模板 + 变量插入按钮 + 内联预览。
 *
 * 预览复用 core 的渲染函数（与 Worker 生成订阅同一份实现），所以「看到的」就是
 * 「保存后生成出来的」，不存在前端算一遍、后端再算一遍的漂移。
 */
export function NodeNameTemplateEditor({
  template,
  onChange,
  sourceName,
  nodes = [],
  className,
}: NodeNameTemplateEditorProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const validation = React.useMemo(() => validateNodeNameTemplate(template), [template]);

  const preview = React.useMemo(() => {
    if (nodes.length === 0) return null;
    const rendered = nodes.map(toPreviewNode);
    try {
      return applyNodeNameTemplate(rendered, template, (node) => node.name, [], sourceName);
    } catch {
      return null;
    }
  }, [nodes, template, sourceName]);

  const hasTemplate = template.trim().length > 0;
  const renamedCount = preview?.hitCount ?? 0;
  const hitList = preview ? [...preview.hits.values()] : [];
  const emptyVariableCount = hitList.filter((hit) => hit.missing.length > 0).length;

  /** 在光标处插入变量；没有光标位置就追加到末尾 */
  const insertVariable = (variable: NodeNameTemplateVariable) => {
    const token = `{${variable}}`;
    const element = inputRef.current;
    if (!element) {
      onChange(`${template}${token}`);
      return;
    }
    const start = element.selectionStart ?? template.length;
    const end = element.selectionEnd ?? template.length;
    onChange(`${template.slice(0, start)}${token}${template.slice(end)}`);
    // 光标落到插入内容之后，连续点几个变量顺序才不会倒
    requestAnimationFrame(() => {
      element.focus();
      const caret = start + token.length;
      element.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg-80">命名模板</p>
          <p className="mt-0.5 text-2xs text-fg-45">
            一条模板套给该源全部节点；留空表示不改名。
          </p>
        </div>
        <Badge variant="outline" className="shrink-0">
          {template.length}/{NODE_NAME_TEMPLATE_MAX_LENGTH}
        </Badge>
      </div>

      <div className="space-y-2">
        <div className="flex gap-1.5">
          <Input
            ref={inputRef}
            value={template}
            onChange={(event) => onChange(event.target.value)}
            placeholder="例如：{protocol}-{ip}:{port} {name}"
            aria-label="节点命名模板"
            aria-invalid={!validation.ok}
            className="h-9 flex-1 font-mono text-base sm:h-8 sm:text-xs"
          />
          {hasTemplate ? (
            <IconButton
              label="清空命名模板"
              variant="ghost"
              onClick={() => onChange("")}
              className="min-h-9 min-w-9"
            >
              <Icon icon={X} size="xs" />
            </IconButton>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {NODE_NAME_TEMPLATE_VARIABLES.map((variable) => (
            <Button
              key={variable}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => insertVariable(variable)}
            >
              {VARIABLE_LABEL[variable]}
              <code className="text-2xs opacity-70">{`{${variable}}`}</code>
            </Button>
          ))}
        </div>
      </div>

      {!validation.ok ? (
        <InlineNote tone="danger" alert>
          {validation.message}
        </InlineNote>
      ) : null}

      {!hasTemplate ? (
        <EmptyState className="px-3 py-4 text-2xs">
          还没有命名模板，节点名保持上游原名。点上面的变量按钮开始拼一条。
        </EmptyState>
      ) : preview ? (
        <div className="space-y-2 rounded-xl border border-ink/10 bg-surface-raised px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-2xs text-fg-45">
              预览：改名 {renamedCount} 个节点
              {nodes.length > renamedCount ? `，${nodes.length - renamedCount} 个保持原名` : ""}
            </p>
            {emptyVariableCount > 0 ? (
              <span className="text-2xs text-warning-note-fg">
                {emptyVariableCount} 个节点有变量取不到值
              </span>
            ) : null}
          </div>
          {hitList.length > 0 ? (
            <ul className="space-y-1">
              {hitList.slice(0, PREVIEW_LIMIT).map((hit, index) => (
                <li key={index} className="flex flex-wrap items-baseline gap-x-2 text-2xs">
                  <span className="min-w-0 truncate text-fg-45">{hit.before || "（空）"}</span>
                  <span className="text-fg-35">→</span>
                  <span
                    className={cn("min-w-0 truncate", hit.applied ? "text-fg-80" : "text-fg-45")}
                  >
                    {hit.after || "（空）"}
                  </span>
                  {hit.missing.length > 0 ? (
                    <span className="shrink-0 text-warning-note-fg">
                      {hit.missing.map((name) => `{${name}}`).join(" ")} 为空
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-2xs text-fg-45">模板与原名相同，不会产生改名。</p>
          )}
          {hitList.length > PREVIEW_LIMIT ? (
            <p className="text-2xs text-fg-35">还有 {hitList.length - PREVIEW_LIMIT} 个未列出。</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
