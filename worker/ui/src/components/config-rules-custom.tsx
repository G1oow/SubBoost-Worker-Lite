/**
 * 「覆写脚本」形态的完整规则区：自定义完整规则（整段文本）与规则集清单。
 *
 * 解析一律复用 `@subboost/core/rules/custom-rule-batch-import`：文本与配置之间的
 * 双向映射只在这里做，落盘仍走 `../lib/rule-editor` 的自定义规则读写函数。
 */
import * as React from "react";
import { Trash2 } from "lucide-react";
import { Badge } from "@subboost/ui/components/ui/badge";
import { Button } from "@subboost/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@subboost/ui/components/ui/card";
import { EmptyState } from "@subboost/ui/components/ui/empty-state";
import { Icon } from "@subboost/ui/components/ui/icon";
import { IconButton } from "@subboost/ui/components/ui/icon-button";
import { InlineNote } from "@subboost/ui/components/ui/inline-note";
import { Textarea } from "@subboost/ui/components/ui/textarea";
import { parseCustomRuleBatchImport } from "@subboost/core/rules/custom-rule-batch-import";
import { normalizeRuleModelFromConfig } from "@subboost/core/rules/rule-model";
import { BUILTIN_RULE_PROVIDER_ID } from "@subboost/core/generator/proxy-group-modules";
import { resolveModuleName } from "@subboost/core/generator/rules";
import type { CustomRule } from "@subboost/core/types/config";
import {
  getEnabledModuleIds,
  listRuleTargetNames,
  readCustomRules,
  readNameOverrides,
  type ConfigRecord,
  type CustomRuleInput,
} from "../lib/rule-editor";

const PROBLEM_LIMIT = 6;

/** 目标 ref → 下拉里显示的名字；界面上的规则文本一律写名字 */
type NameLookup = Map<string, string>;

function targetName(target: CustomRule["target"], nameByValue: NameLookup): string {
  if (typeof target === "string") return target;
  return nameByValue.get(`${target.kind}:${target.id}`) ?? `${target.kind}:${target.id}`;
}

function serializeRule(rule: Pick<CustomRule, "type" | "value" | "target" | "noResolve">, nameByValue: NameLookup): string {
  const text = [rule.type, rule.value, targetName(rule.target, nameByValue)].join(",");
  return rule.noResolve ? `${text},no-resolve` : text;
}

function useNameLookup(config: ConfigRecord) {
  const names = React.useMemo(() => listRuleTargetNames(config), [config]);
  const nameByValue = React.useMemo(() => new Map(names.map((item) => [item.value, item.name])), [names]);
  const valueByName = React.useMemo(() => new Map(names.map((item) => [item.name, item.value])), [names]);
  return { names, nameByValue, valueByName };
}

// ---------------------------------------------------------------------------
// 自定义完整规则
// ---------------------------------------------------------------------------

export type CustomRulesCardProps = {
  config: ConfigRecord;
  /** 整段替换：调用方负责删掉旧条目再写入新条目 */
  onApply: (rules: CustomRuleInput[]) => void;
  onDelete: (id: string) => void;
};

export function CustomRulesCard({ config, onApply, onDelete }: CustomRulesCardProps) {
  const { names, nameByValue, valueByName } = useNameLookup(config);
  const { rules, invalidCount } = React.useMemo(() => readCustomRules(config), [config]);
  const rulesText = React.useMemo(
    () => rules.map((rule) => serializeRule(rule, nameByValue)).join("\n"),
    [rules, nameByValue]
  );

  const [text, setText] = React.useState(rulesText);
  // 配置里的自定义规则变了（在下面的清单里删除、或在别的子页改动）就重新对齐文本：
  // 文本只是这份清单的一种写法，清单才是唯一事实来源。
  React.useEffect(() => setText(rulesText), [rulesText]);

  const parsed = React.useMemo(
    () =>
      parseCustomRuleBatchImport({
        text,
        // 只写值的行在这里没有意义：目标留空会报「目标不能为空」，比默默补一个默认目标更清楚
        defaultType: "DOMAIN-SUFFIX",
        defaultTarget: "",
        defaultNoResolve: false,
        targetOptions: names.map((item) => item.name),
        // 整段替换：已有规则本身就是这些行，不能算重复
        existingRules: [],
        existingRuleSets: [],
      }),
    [text, names]
  );

  const appliedText = React.useMemo(
    () => parsed.rules.map((rule) => serializeRule(rule, nameByValue)).join("\n"),
    [parsed.rules, nameByValue]
  );
  const ruleSetLines = parsed.items.filter((item) => item.rule?.type === "RULE-SET").length;
  const problems = parsed.items.filter((item) => item.status === "error" || item.status === "duplicate");
  const canApply =
    parsed.rules.length > 0 &&
    parsed.errorCount === 0 &&
    parsed.duplicateCount === 0 &&
    appliedText !== rulesText;

  const apply = () => {
    if (!canApply) return;
    onApply(
      parsed.rules.map((rule) => ({
        type: rule.type,
        value: rule.value,
        target:
          typeof rule.target === "string"
            ? valueByName.get(rule.target) ?? `raw:${rule.target}`
            : `${rule.target.kind}:${rule.target.id}`,
        noResolve: Boolean(rule.noResolve),
      }))
    );
  };

  const statusText = [
    `可写入 ${parsed.rules.length} 条`,
    parsed.duplicateCount > 0 ? `重复 ${parsed.duplicateCount} 行` : "",
    parsed.errorCount > 0 ? `无法解析 ${parsed.errorCount} 行` : "",
    ruleSetLines > 0 ? `规则集行 ${ruleSetLines} 不写入` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card>
      <CardHeader>
        <CardTitle>自定义完整规则</CardTitle>
        <p className="text-xs leading-relaxed text-fg-45">
          {`每行一条完整 Clash 规则，例如 DOMAIN-SUFFIX,example.net,自动选择；目标写分流组名称或 DIRECT / REJECT。空行与注释（# 或 //）会跳过；应用时用这些行整段替换现有的自定义规则，排序仍由系统决定。`}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label="自定义完整规则"
          placeholder={"DOMAIN-SUFFIX,example.net,自动选择\nIP-CIDR,192.0.2.0/24,DIRECT,no-resolve"}
          spellCheck={false}
          className="min-h-[132px] resize-y font-mono text-xs"
        />
        {text.trim() ? <p className="text-xs text-fg-60">{statusText}</p> : null}
        {problems.length > 0 ? (
          <InlineNote tone="warning">
            <div className="space-y-1">
              {problems.slice(0, PROBLEM_LIMIT).map((item) => (
                <p key={item.lineNumber} className="break-all">
                  {`第 ${item.lineNumber} 行：${item.message}`}
                </p>
              ))}
              {problems.length > PROBLEM_LIMIT ? <p>{`另有 ${problems.length - PROBLEM_LIMIT} 行有同样的问题。`}</p> : null}
              <p>有错误或重复的行时不能应用，改掉后再试。</p>
            </div>
          </InlineNote>
        ) : null}
        {ruleSetLines > 0 ? (
          <InlineNote variant="plain" tone="warning">
            {`有 ${ruleSetLines} 行是 RULE-SET 规则集，请在下方「规则集」分区管理，这些行不会写进自定义规则。`}
          </InlineNote>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={apply} disabled={!canApply}>
            应用规则
          </Button>
          <Button variant="ghost" onClick={() => setText(rulesText)} disabled={text === rulesText}>
            还原
          </Button>
          <span className="text-2xs text-fg-45">应用后文本框会按实际写入的规则重排。</span>
        </div>

        <div className="space-y-2 border-t border-ink/10 pt-3">
          <h4 className="text-xs font-medium text-fg-60">{`现有自定义规则（${rules.length}）`}</h4>
          {rules.length === 0 ? (
            <EmptyState>还没有自定义规则。把整条规则粘贴到上面的文本框并应用，它就会出现在这里。</EmptyState>
          ) : (
            <ul aria-label="现有自定义规则" className="space-y-1.5">
              {rules.map((rule) => {
                const ruleText = serializeRule(rule, nameByValue);
                return (
                  <li
                    key={rule.id}
                    className="flex items-start gap-2 rounded-lg border border-ink/10 bg-ink/5 px-2.5 py-1.5"
                  >
                    <span className="min-w-0 flex-1 break-all font-mono text-2xs leading-relaxed text-fg-70">
                      {ruleText}
                    </span>
                    <IconButton
                      label={`删除规则 ${ruleText}`}
                      variant="ghost"
                      onClick={() => onDelete(rule.id)}
                      className="size-7 shrink-0"
                    >
                      <Icon icon={Trash2} />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          )}
          {invalidCount > 0 ? (
            <InlineNote tone="warning">
              {`有 ${invalidCount} 条自定义规则格式无效，生成时会被忽略，可在「高级 JSON」里修改。`}
            </InlineNote>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 规则集
// ---------------------------------------------------------------------------

export type RuleSetsCardProps = {
  config: ConfigRecord;
  onDelete: (id: string) => void;
};

export function RuleSetsCard({ config, onDelete }: RuleSetsCardProps) {
  const { nameByValue } = useNameLookup(config);
  const ruleSets = React.useMemo(() => normalizeRuleModelFromConfig(config).customRuleSets, [config]);
  const rawCount = Array.isArray(config.customRuleSets) ? config.customRuleSets.length : 0;
  const invalidCount = Math.max(0, rawCount - ruleSets.length);
  const adEnabled = React.useMemo(() => getEnabledModuleIds(config).includes("ad"), [config]);
  const overrides = React.useMemo(() => readNameOverrides(config), [config]);
  const adTarget = resolveModuleName("ad", overrides);

  return (
    <Card>
      <CardHeader>
        <CardTitle>规则集</CardTitle>
        <p className="text-xs leading-relaxed text-fg-45">
          {`内置的广告域名集合只读，由「广告拦截」分流组的开关控制是否生成；自己添加的 .mrs 规则集在这里只能删除，删除后它生成的 RULE-SET 规则一并消失。`}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ink/10 bg-ink/5 px-3 py-2">
          <span className="min-w-0 break-all font-mono text-xs text-fg-80">{`RULE-SET,${BUILTIN_RULE_PROVIDER_ID}`}</span>
          <span aria-hidden="true" className="text-xs text-fg-45">
            →
          </span>
          <Badge variant="secondary" className="shrink-0">
            {adTarget}
          </Badge>
          <Badge variant="outline" className="shrink-0">
            内置 · 只读
          </Badge>
          {adEnabled ? null : (
            <span className="text-2xs text-fg-45">「广告拦截」分组未开启，这条规则集不会生成。</span>
          )}
        </div>

        <div className="space-y-2">
          <h4 className="text-xs font-medium text-fg-60">{`自定义规则集（${ruleSets.length}）`}</h4>
          {ruleSets.length === 0 ? (
            <EmptyState>还没有自定义规则集。需要时可以在「高级 JSON」子页里按 customRuleSets 的写法添加。</EmptyState>
          ) : (
            <ul aria-label="自定义规则集" className="space-y-1.5">
              {ruleSets.map((ruleSet) => (
                <li
                  key={ruleSet.id}
                  className="flex items-start gap-2 rounded-lg border border-ink/10 bg-ink/5 px-2.5 py-1.5"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="break-all text-xs text-fg-80">{ruleSet.name}</p>
                    <p className="break-all font-mono text-2xs leading-relaxed text-fg-45">{ruleSet.path}</p>
                  </div>
                  {/* 组名可能很长：截断并保留完整名字，长串不会把整行顶出卡片 */}
                  <Badge
                    variant="secondary"
                    className="max-w-32 shrink-0 truncate"
                    title={targetName(ruleSet.target, nameByValue)}
                  >
                    {targetName(ruleSet.target, nameByValue)}
                  </Badge>
                  <IconButton
                    label={`删除规则集 ${ruleSet.name}`}
                    variant="ghost"
                    onClick={() => onDelete(ruleSet.id)}
                    className="size-7 shrink-0"
                  >
                    <Icon icon={Trash2} />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
          {invalidCount > 0 ? (
            <InlineNote tone="warning">
              {`有 ${invalidCount} 个规则集格式无效或 id 重复，生成时会被忽略。`}
            </InlineNote>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
