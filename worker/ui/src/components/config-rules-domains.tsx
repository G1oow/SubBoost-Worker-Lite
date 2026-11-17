/**
 * 「覆写脚本」形态的域名/进程覆盖区（手动域名规则 + 手动进程规则）。
 *
 * 与 core 的分工：界面只负责收集原文，归一化一律交给
 * `@subboost/core/rules/manual-domains`（保存原文，生成期再归一化）。
 * 输入框下方的「将生成 …」直接把 core 生成出来的规则文本拿来看，
 * 避免界面自己再猜一遍 IP / DOMAIN-SUFFIX 的区别。
 */
import * as React from "react";
import { X } from "lucide-react";
import { Badge } from "@subboost/ui/components/ui/badge";
import { Button } from "@subboost/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@subboost/ui/components/ui/card";
import { Icon } from "@subboost/ui/components/ui/icon";
import { IconButton } from "@subboost/ui/components/ui/icon-button";
import { Input } from "@subboost/ui/components/ui/input";
import { InlineNote } from "@subboost/ui/components/ui/inline-note";
import { cn } from "@subboost/ui/lib/utils";
import {
  buildManualDomainRuleTexts,
  buildManualProcessRuleTexts,
  normalizeManualDomain,
} from "@subboost/core/rules/manual-domains";

export type ManualDomainGroupId = "direct" | "proxy" | "reject";

export type DomainGroupView = {
  id: ManualDomainGroupId;
  title: string;
  /** 归属的分流组最终名称（受改名影响） */
  target: string;
  /** 分组没开启时生成会回退到兜底分组，列头要说明白 */
  targetEnabled: boolean;
  values: string[];
};

/** 域名可以一次粘贴多个：逗号（中英文）、顿号、空白、换行都算分隔 */
const DOMAIN_SEPARATORS = /[,，、\s]+/u;
const LINE_SEPARATORS = /\r?\n/u;
/** 只用来拼「将生成 …」的探针目标，不落盘 */
const PROBE_TARGETS = { direct: "直连", proxy: "代理", reject: "拦截" } as const;
const STAGGER_LIMIT = 8;

function splitBy(regex: RegExp) {
  return (raw: string): string[] =>
    raw
      .split(regex)
      .map((token) => token.trim())
      .filter(Boolean);
}

function domainPreview(token: string): string {
  const { texts } = buildManualDomainRuleTexts({ direct: [token], proxy: [], reject: [] }, PROBE_TARGETS);
  const rule = texts[0];
  if (!rule) return "无法归一化，添加时会被忽略";
  const [type = "", value = "", , flag] = rule.split(",");
  return `将生成 ${type},${value}${flag ? `,${flag}` : ""}`;
}

function processPreview(token: string): string {
  if (token.includes(",")) return "含逗号，原样写入";
  return `将生成 ${buildManualProcessRuleTexts([token])[0] ?? ""}`;
}

const domainKey = (token: string) => normalizeManualDomain(token) ?? token.trim().toLowerCase();
const isDomain = (token: string) => normalizeManualDomain(token) !== null;

type ChipEditorProps = {
  /** 条目清单的无障碍名，例如「直连域名条目」 */
  label: string;
  values: string[];
  emptyText: string;
  removeLabel: (value: string) => string;
  onRemove: (value: string) => void;
  /** 悬停时的次要说明，例如归一化结果 */
  titleOf?: (value: string) => string;
  inputLabel: string;
  addLabel: string;
  placeholder: string;
  split: (raw: string) => string[];
  /** 条目本身不合法时返回 false（例如域名归一化失败） */
  isValid?: (token: string) => boolean;
  /** 查重键：域名按归一化结果，进程按原文 */
  keyOf: (token: string) => string;
  hintOf?: (token: string) => string;
  onAdd: (tokens: string[]) => void;
};

/**
 * 条目 chips + 输入框。回车与「添加」走同一条表单提交；
 * 删掉一条后把焦点还给输入框，键盘连删不会掉回 body。
 */
function ChipEditor({
  label,
  values,
  emptyText,
  removeLabel,
  onRemove,
  titleOf,
  inputLabel,
  addLabel,
  placeholder,
  split,
  isValid,
  keyOf,
  hintOf,
  onAdd,
}: ChipEditorProps) {
  const [text, setText] = React.useState("");
  const [rejected, setRejected] = React.useState<{ invalid: string[]; duplicates: string[] } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const tokens = split(text);
  const hint = tokens.length > 0 && hintOf ? hintOf(tokens[0] ?? "") : "";

  /** 收下这些条目：不合法的与已存在的分别记下来，返回真正写入的条数 */
  const commit = (incoming: string[]) => {
    const known = new Set(values.map(keyOf));
    const accepted: string[] = [];
    const invalid: string[] = [];
    const duplicates: string[] = [];
    for (const token of incoming) {
      if (isValid && !isValid(token)) {
        invalid.push(token);
        continue;
      }
      const key = keyOf(token);
      if (known.has(key)) {
        duplicates.push(token);
        continue;
      }
      known.add(key);
      accepted.push(token);
    }
    setRejected(invalid.length > 0 || duplicates.length > 0 ? { invalid, duplicates } : null);
    setText("");
    if (accepted.length > 0) onAdd(accepted);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (tokens.length === 0) return;
    commit(tokens);
  };

  // 单行 input 会吞掉换行（HTML 的 value 规范化），一次粘贴多行就只剩一串没分隔的文本。
  // 所以剪贴板里的内容多于一条时自己接管：按同一套分隔符拆开直接添加。
  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = split(event.clipboardData?.getData("text") ?? "");
    if (pasted.length <= 1) return;
    event.preventDefault();
    commit([...tokens, ...pasted]);
  };

  return (
    <div className="mt-auto space-y-2 pt-1">
      {values.length === 0 ? (
        <p className="text-2xs leading-relaxed text-fg-35">{emptyText}</p>
      ) : (
        <ul aria-label={label} className="flex flex-wrap gap-1.5">
          {values.map((value, index) => (
            <li
              key={value}
              title={titleOf?.(value)}
              className={cn(
                // 只驱动 opacity 的入场，按顺序小延迟；不做位移，长串也不会糊
                "flex max-w-full animate-settle-in items-center gap-1 rounded-lg border border-ink/10 bg-surface py-0.5 pl-2 pr-0.5",
                index < STAGGER_LIMIT && `stagger-${index + 1}`
              )}
            >
              <span className="min-w-0 break-all font-mono text-xs text-fg-80">{value}</span>
              <IconButton
                label={removeLabel(value)}
                variant="ghost"
                onClick={() => {
                  onRemove(value);
                  inputRef.current?.focus();
                }}
                className="size-6 shrink-0 rounded-md text-fg-45 hover:text-fg"
              >
                <Icon icon={X} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="space-y-1.5">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setRejected(null);
            }}
            aria-label={inputLabel}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            onPaste={handlePaste}
            className="min-w-0 flex-1"
          />
          <Button
            type="submit"
            variant="secondary"
            aria-label={addLabel}
            disabled={tokens.length === 0}
            className="h-11 shrink-0 px-3 sm:h-10"
          >
            添加
          </Button>
        </div>
        {hint ? <p className="break-all text-2xs leading-relaxed text-fg-45">{hint}</p> : null}
        {rejected && rejected.invalid.length > 0 ? (
          <InlineNote variant="plain" tone="warning">
            {`无法归一化，已忽略：${rejected.invalid.join("、")}`}
          </InlineNote>
        ) : null}
        {rejected && rejected.duplicates.length > 0 ? (
          <InlineNote variant="plain" tone="warning">
            {`已在列表中：${rejected.duplicates.join("、")}`}
          </InlineNote>
        ) : null}
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 手动域名规则
// ---------------------------------------------------------------------------

export type DomainOverrideCardProps = {
  groups: DomainGroupView[];
  onAdd: (group: ManualDomainGroupId, values: string[]) => void;
  onRemove: (group: ManualDomainGroupId, value: string) => void;
};

function DomainColumn({
  group,
  onAdd,
  onRemove,
}: {
  group: DomainGroupView;
  onAdd: (group: ManualDomainGroupId, values: string[]) => void;
  onRemove: (group: ManualDomainGroupId, value: string) => void;
}) {
  return (
    <section
      aria-label={group.title}
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-ink/10 bg-ink/5 p-3"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium text-fg-80">{group.title}</h4>
        <Badge variant="secondary" className="shrink-0 tabular-nums">
          {group.values.length}
        </Badge>
      </header>
      <p className="text-2xs leading-relaxed text-fg-45">
        {`→ ${group.target}${group.targetEnabled ? "" : "（分组未开启，生成时回退到兜底组）"}`}
      </p>
      <ChipEditor
        label={`${group.title}条目`}
        values={group.values}
        emptyText="还没有条目，输入域名后按回车添加。"
        removeLabel={(value) => `删除 ${group.title} ${value}`}
        onRemove={(value) => onRemove(group.id, value)}
        titleOf={domainPreview}
        inputLabel={`输入${group.title}`}
        addLabel={`添加${group.title}`}
        placeholder="example.com"
        split={splitBy(DOMAIN_SEPARATORS)}
        isValid={isDomain}
        keyOf={domainKey}
        hintOf={domainPreview}
        onAdd={(values) => onAdd(group.id, values)}
      />
    </section>
  );
}

export function DomainOverrideCard({ groups, onAdd, onRemove }: DomainOverrideCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>手动域名规则</CardTitle>
        {/* 中文说明写成单个字符串：JSX 换行会在中文之间折出一个多余的空格 */}
        <p className="text-xs leading-relaxed text-fg-45">
          {`每列绑定一个分流组，命中就走该组。通配符 *.x.com、URL、带端口或结尾点的写法会自动归一化成裸域名；IP 转成 IP-CIDR,x.x.x.x/32,no-resolve；无法归一化的条目在添加时就会被拒绝。一次可粘贴多条（逗号、空格或换行分隔）。`}
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-3">
          {groups.map((group) => (
            <DomainColumn key={group.id} group={group} onAdd={onAdd} onRemove={onRemove} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 手动进程规则
// ---------------------------------------------------------------------------

export type ProcessOverrideCardProps = {
  values: string[];
  onAdd: (values: string[]) => void;
  onRemove: (value: string) => void;
};

export function ProcessOverrideCard({ values, onAdd, onRemove }: ProcessOverrideCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>手动进程规则</CardTitle>
        <p className="text-xs leading-relaxed text-fg-45">
          {`一行一个进程名，命中的流量固定走 DIRECT。Windows 写 steam.exe 这样带扩展名的名字；含逗号的完整规则（例如 PROCESS-NAME,foo.exe,DIRECT）原样透传，不再追加目标。`}
        </p>
      </CardHeader>
      <CardContent>
        <ChipEditor
          label="手动进程规则条目"
          values={values}
          emptyText="还没有进程规则，输入进程名后按回车添加。"
          removeLabel={(value) => `删除进程规则 ${value}`}
          onRemove={onRemove}
          titleOf={processPreview}
          inputLabel="输入进程名"
          addLabel="添加进程规则"
          placeholder="steam.exe"
          split={splitBy(LINE_SEPARATORS)}
          keyOf={(token) => token}
          hintOf={processPreview}
          onAdd={onAdd}
        />
      </CardContent>
    </Card>
  );
}
