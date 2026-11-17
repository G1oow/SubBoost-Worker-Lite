/**
 * 生成配置 → 规则：按覆写脚本的分区组织（手动域名 / 手动进程 / Steam 路由 /
 * 自定义完整规则 / 规则集 / 最终预览）。
 *
 * 写回规矩：每个分区只改自己负责的字段，其余字段原样透传；
 * 自定义规则与规则集一律走 `../lib/rule-editor` 的读写函数，不在这里另造一份。
 */
import * as React from "react";
import { ListOrdered } from "lucide-react";
import { Button } from "@subboost/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@subboost/ui/components/ui/card";
import { Icon } from "@subboost/ui/components/ui/icon";
import { SwitchField } from "@subboost/ui/components/ui/switch-field";
import { cn } from "@subboost/ui/lib/utils";
import { DisclosureChevron } from "@subboost/ui/motion/disclosure-chevron";
import { MotionReveal } from "@subboost/ui/motion/motion-list";
import { PROXY_GROUP_MODULES } from "@subboost/core/generator/proxy-group-modules";
import { resolveModuleName } from "@subboost/core/generator/rules";
import { normalizeManualProcessList } from "@subboost/core/rules/manual-domains";
import {
  buildRuleEditorView,
  deleteCustomRule,
  deleteCustomRuleSet,
  getEnabledModuleIds,
  importCustomEntries,
  readCustomRules,
  readManualDomains,
  readNameOverrides,
  type ConfigRecord,
  type CustomRuleInput,
} from "../lib/rule-editor";
import {
  DomainOverrideCard,
  ProcessOverrideCard,
  type DomainGroupView,
  type ManualDomainGroupId,
} from "./config-rules-domains";
import { CustomRulesCard, RuleSetsCard } from "./config-rules-custom";

export type ConfigRulesSectionProps = {
  config: ConfigRecord;
  onChange: (next: ConfigRecord) => void;
};

/** Steam 内置清单的规模：直接读 core 的模块数据，不在这里抄一份数字 */
const STEAM_MODULE = PROXY_GROUP_MODULES.find((module) => module.id === "steam");
const STEAM_RULES = STEAM_MODULE?.rules ?? [];
const steamRuleText = (rule: { text?: string }) => rule.text ?? "";
const STEAM_CDN_COUNT = STEAM_RULES.filter((rule) => rule.downloadCdn).length;
const STEAM_PROCESS_COUNT = STEAM_RULES.filter((rule) => steamRuleText(rule).startsWith("PROCESS-NAME,")).length;
const STEAM_DOMAIN_COUNT = STEAM_RULES.filter(
  (rule) => !rule.downloadCdn && /^DOMAIN(?:-SUFFIX)?,/u.test(steamRuleText(rule))
).length;

const DOMAIN_TITLES: Array<{ id: ManualDomainGroupId; title: string; moduleId: string }> = [
  { id: "direct", title: "直连域名", moduleId: "cn" },
  { id: "proxy", title: "代理域名", moduleId: "auto" },
  { id: "reject", title: "拦截域名", moduleId: "ad" },
];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readFlag(config: ConfigRecord, field: string, fallback: boolean): boolean {
  const value = config[field];
  return typeof value === "boolean" ? value : fallback;
}

function replaceCustomRules(config: ConfigRecord, rules: CustomRuleInput[]): ConfigRecord {
  // 文本编辑就是「整段替换」：先清掉现有条目，再按文本顺序插入新的。
  // ruleOrder 由 rule-editor 维护，新条目落回同一段插入点。
  let next = config;
  for (const rule of readCustomRules(config).rules) next = deleteCustomRule(next, rule.id);
  return importCustomEntries(
    next,
    rules.map((rule) => ({ kind: "rule" as const, rule }))
  );
}

export function ConfigRulesSection({ config, onChange }: ConfigRulesSectionProps) {
  const view = React.useMemo(() => buildRuleEditorView(config), [config]);
  const manualDomains = React.useMemo(() => readManualDomains(config), [config]);
  const processRules = React.useMemo(() => normalizeManualProcessList(config.manualProcessRules), [config]);
  const overrides = React.useMemo(() => readNameOverrides(config), [config]);
  const enabledModules = React.useMemo(() => new Set(getEnabledModuleIds(config)), [config]);

  const [previewOpen, setPreviewOpen] = React.useState(false);

  const steamViaProxy = readFlag(config, "steamViaProxy", true);
  const steamDownloadViaProxy = readFlag(config, "steamDownloadViaProxy", false);

  const domainGroups = React.useMemo<DomainGroupView[]>(
    () =>
      DOMAIN_TITLES.map(({ id, title, moduleId }) => ({
        id,
        title,
        target: resolveModuleName(moduleId, overrides),
        targetEnabled: enabledModules.has(moduleId),
        values: manualDomains[id],
      })),
    [manualDomains, overrides, enabledModules]
  );

  /** 手动域名三表写回：其它字段（含 manualDomains 里不认识的键）原样保留 */
  const writeDomains = (group: ManualDomainGroupId, values: string[]) => {
    const current = isPlainRecord(config.manualDomains) ? config.manualDomains : {};
    const next = { ...current, [group]: values };
    const empty = DOMAIN_TITLES.every(({ id }) => (Array.isArray(next[id]) ? next[id].length === 0 : true));
    // 加完又删空、本来就没有这三张表：不留下一个空对象当成改动
    if (empty && !("manualDomains" in config)) return;
    onChange({ ...config, manualDomains: next });
  };

  const addDomains = (group: ManualDomainGroupId, values: string[]) => {
    const current = manualDomains[group];
    writeDomains(group, [...current, ...values]);
  };

  const removeDomain = (group: ManualDomainGroupId, value: string) => {
    writeDomains(
      group,
      manualDomains[group].filter((item) => item !== value)
    );
  };

  const writeProcessRules = (values: string[]) => {
    if (values.length === 0 && !("manualProcessRules" in config)) return;
    onChange({ ...config, manualProcessRules: values });
  };

  const addProcessRules = (values: string[]) => writeProcessRules([...processRules, ...values]);
  const removeProcessRule = (value: string) => writeProcessRules(processRules.filter((item) => item !== value));

  const setSteam = (field: "steamViaProxy" | "steamDownloadViaProxy", value: boolean) => {
    onChange({ ...config, [field]: value });
  };

  const disabledPreviewRows = view.rows.filter((row) => !row.enabled).length;
  const previewCounts = [
    `共 ${view.counts.lines} 条：内置 ${view.counts.builtin}`,
    view.counts.builtinDisabled > 0 ? `（另有 ${view.counts.builtinDisabled} 条已停用）` : "",
    ` · 自定义 ${view.counts.customRules} · 规则集 ${view.counts.customRuleSets}。`,
  ].join("");

  return (
    <>
      <DomainOverrideCard groups={domainGroups} onAdd={addDomains} onRemove={removeDomain} />
      <ProcessOverrideCard values={processRules} onAdd={addProcessRules} onRemove={removeProcessRule} />

      <Card>
        <CardHeader>
          <CardTitle>Steam 路由</CardTitle>
          <p className="text-xs leading-relaxed text-fg-45">
            {`Steam 的进程、服务域名与下载 CDN 分成两组开关：关掉后这些规则改走 DIRECT，仍留在规则列表里。下载 CDN 默认直连，避免更新游戏时把代理流量打满。`}
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          <SwitchField
            label="Steam 流量走 Steam 代理"
            description="关闭后 Steam 进程与 Steam/Valve 服务域名全部直连。"
            checked={steamViaProxy}
            onCheckedChange={(checked) => setSteam("steamViaProxy", checked)}
          />
          <SwitchField
            label="下载 CDN 也走代理（默认直连）"
            description={
              steamViaProxy
                ? "开启后 Steam 下载 CDN 跟着走 Steam 代理；关闭时下载直连。"
                : "需要先开启「Steam 流量走 Steam 代理」，否则下载 CDN 始终直连。"
            }
            checked={steamDownloadViaProxy}
            disabled={!steamViaProxy}
            onCheckedChange={(checked) => setSteam("steamDownloadViaProxy", checked)}
          />
          <p className="text-2xs leading-relaxed text-fg-45">
            {`内置 ${STEAM_DOMAIN_COUNT} 个 Steam/Valve 域名、${STEAM_CDN_COUNT} 个下载 CDN、${STEAM_PROCESS_COUNT} 个进程规则（steam.exe 等）。`}
          </p>
        </CardContent>
      </Card>

      <CustomRulesCard
        config={config}
        onApply={(rules) => onChange(replaceCustomRules(config, rules))}
        onDelete={(id) => onChange(deleteCustomRule(config, id))}
      />

      <RuleSetsCard config={config} onDelete={(id) => onChange(deleteCustomRuleSet(config, id))} />

      <Card>
        <CardHeader className="flex flex-col gap-3 pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="space-y-1">
            <CardTitle>最终规则预览</CardTitle>
            <p className="text-xs leading-relaxed text-fg-45">
              {`${previewCounts}自上而下逐条匹配、命中即停，MATCH 固定在最后。预览只读，改上面的分区即可。`}
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => setPreviewOpen((open) => !open)}
            aria-expanded={previewOpen}
            aria-controls={previewOpen ? "config-rule-preview" : undefined}
            className="w-full shrink-0 sm:w-auto"
          >
            {previewOpen ? "收起预览" : "展开预览"}
            <DisclosureChevron open={previewOpen} />
          </Button>
        </CardHeader>
        <MotionReveal open={previewOpen} id="config-rule-preview">
          <CardContent className="pt-4">
            <ol
              aria-label="最终规则预览"
              className="custom-scrollbar max-h-96 space-y-0.5 overflow-y-auto rounded-xl border border-ink/10 bg-ink/5 p-2"
            >
              {view.rows.map((row) => (
                <li
                  key={row.key}
                  className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-2 rounded-md px-1 py-0.5"
                >
                  <span
                    className="text-right font-mono text-2xs tabular-nums text-fg-35"
                    title={row.line ? `第 ${row.line} 行` : "已停用，不会生成"}
                  >
                    {row.line ?? "–"}
                  </span>
                  <span
                    className={cn(
                      "break-all font-mono text-xs leading-relaxed",
                      row.enabled ? "text-fg-70" : "text-fg-45 line-through"
                    )}
                  >
                    {row.text}
                  </span>
                </li>
              ))}
              <li className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-2 rounded-md px-1 py-0.5">
                <span className="text-right font-mono text-2xs tabular-nums text-fg-35" title={`第 ${view.matchLine} 行`}>
                  {view.matchLine}
                </span>
                <span className="break-all font-mono text-xs leading-relaxed text-fg-80">{view.matchText}</span>
              </li>
            </ol>
            <p className="mt-2 flex items-center gap-1.5 text-2xs text-fg-45">
              <Icon icon={ListOrdered} size="sm" />
              {disabledPreviewRows > 0
                ? `带删除线的 ${disabledPreviewRows} 条已停用，不会生成。`
                : "所有规则都会生成；自定义条目固定插在「广告规则集」之前。"}
            </p>
          </CardContent>
        </MotionReveal>
      </Card>
    </>
  );
}
