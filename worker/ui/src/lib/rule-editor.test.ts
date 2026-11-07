import { describe, expect, it } from "vitest";
import { buildDefaultUserConfig } from "@subboost/core/config/defaults";
import { generateClashConfig } from "@subboost/core/generator";
import { nodeRenameKey } from "@subboost/core/node-rename-key";
import { buildGenerateOptionsFromConfig } from "@subboost/core/subscription/config-utils";
import { ALL_RULES } from "@subboost/core/rules-database";
import {
  buildModuleToggleGroups,
  buildRuleEditorView,
  catalogRuleSetPath,
  deleteCustomRule,
  deleteCustomRuleSet,
  fromTargetValue,
  importCustomEntries,
  isConfigChanged,
  listRuleTargetOptions,
  moveRule,
  moveRuleToLine,
  reconcileWithBaseline,
  saveCustomRule,
  saveCustomRuleSet,
  setBuiltinRuleEnabled,
  setBuiltinRuleTarget,
  setModuleEnabled,
  validateCustomRuleInput,
  type ConfigRecord,
} from "./rule-editor";

function defaultConfig(): ConfigRecord {
  return buildDefaultUserConfig("standard") as unknown as ConfigRecord;
}

function keysOf(config: ConfigRecord): string[] {
  return buildRuleEditorView(config).rows.map((row) => row.key);
}

/** 编辑器展示的最终规则：启用的行 + MATCH */
function editorLines(config: ConfigRecord): string[] {
  const view = buildRuleEditorView(config);
  return [...view.rows.filter((row) => row.enabled).map((row) => row.text), view.matchText];
}

function generatedLines(config: ConfigRecord): string[] {
  return generateClashConfig(buildGenerateOptionsFromConfig(config, { nodes: [] })).rules as string[];
}

const DIRECT_RULE = { type: "DOMAIN-SUFFIX" as const, value: "example.com", target: "DIRECT", noResolve: false };

describe("rule editor view", () => {
  it("lists the default rules in generated order with line numbers", () => {
    const view = buildRuleEditorView(defaultConfig());
    expect(view.rows.slice(0, 3).map((row) => [row.line, row.key])).toEqual([
      [1, "module:ad:category-ads-all"],
      [2, "module:private:private"],
      [3, "module:private:private-ip"],
    ]);
    expect(view.rows.at(-1)).toMatchObject({ key: "special:experimental-cn", movable: false });
    expect(view.matchText).toBe("MATCH,🐟 漏网之鱼");
    expect(view.matchLine).toBe(view.rows.length + 1);
    expect(view.counts).toMatchObject({ lines: view.rows.length + 1, builtinDisabled: 0, customRules: 0 });
    expect(editorLines(defaultConfig())).toEqual(generatedLines(defaultConfig()));
  });

  it("falls back to the template groups when enabledGroups is missing", () => {
    const { enabledGroups: _groups, ...withoutGroups } = defaultConfig();
    expect(keysOf(withoutGroups)).toEqual(keysOf(defaultConfig()));
  });

  it("only offers enabled groups plus DIRECT/REJECT as rule targets", () => {
    const options = listRuleTargetOptions(defaultConfig());
    expect(options.map((option) => option.value)).toContain("module:ai");
    expect(options.map((option) => option.value)).not.toContain("module:netflix");
    expect(options.slice(-2)).toEqual([
      { value: "policy:DIRECT", label: "DIRECT（直连）" },
      { value: "policy:REJECT", label: "REJECT（拒绝）" },
    ]);
    expect(fromTargetValue("module:ai")).toEqual({ kind: "module", id: "ai" });
    expect(fromTargetValue("policy:REJECT")).toBe("REJECT");
    expect(fromTargetValue("raw:香港 01")).toBe("香港 01");
  });

  it("offers enabled chains as targets and keeps chain:<id> refs when saving", () => {
    const config = {
      ...defaultConfig(),
      proxyChains: [
        {
          id: "c1",
          name: "🇺🇸 演示链",
          landingNodes: [{ sourceId: "s1", nodeKey: "landing-key" }],
          relayNodes: [{ sourceId: "s1", nodeKey: "relay-key" }],
        },
        { id: "c2", name: "停用链", enabled: false, landingNodes: [], relayNodes: [] },
      ],
      customRules: [{ id: "r1", type: "DOMAIN-SUFFIX", value: "example.com", target: { kind: "chain", id: "c1" } }],
    };
    const options = listRuleTargetOptions(config);
    expect(options).toContainEqual({ value: "chain:c1", label: "🇺🇸 演示链" });
    expect(options.map((option) => option.value)).not.toContain("chain:c2");

    // 存回去必须还是 ref，而不是退化成裸链 id 字符串
    expect(fromTargetValue("chain:c1")).toEqual({ kind: "chain", id: "c1" });

    const row = buildRuleEditorView(config).rows.find((item) => item.key === "custom-rule:r1");
    expect(row).toMatchObject({ targetValue: "chain:c1", targetLabel: "🇺🇸 演示链", targetWarning: null });
    expect(row?.text).toBe("DOMAIN-SUFFIX,example.com,🇺🇸 演示链");
    // 编辑对话框只改类型、不动目标，落盘后仍是 ref（对话框的 target 是下拉的 value 字符串）
    const saved = saveCustomRule(
      config,
      { type: "DOMAIN", value: "example.com", target: "chain:c1", noResolve: false },
      "r1"
    ).config;
    expect((saved.customRules as { target: unknown }[])[0].target).toEqual({ kind: "chain", id: "c1" });
    // 链没有可用节点时出口组不生成、目标按回退处理
    expect(generateClashConfig(buildGenerateOptionsFromConfig(saved, { nodes: [] })).rules).toContain(
      "DOMAIN,example.com,🚀 节点选择"
    );

    // 有节点时目标就是出口组名，与界面一致。节点与链引用必须同源同指纹，name 不参与指纹
    const relayNode = { name: "香港 01", type: "ss", server: "192.0.2.10", port: 8388, cipher: "aes-256-gcm", password: "pass" };
    const landingNode = { name: "落地 01", type: "ss", server: "192.0.2.11", port: 8388, cipher: "aes-256-gcm", password: "pass" };
    const withRefs = {
      ...saved,
      proxyChains: [
        {
          id: "c1",
          name: "🇺🇸 演示链",
          relayNodes: [{ sourceId: "s1", nodeKey: nodeRenameKey(relayNode as never) }],
          landingNodes: [{ sourceId: "s1", nodeKey: nodeRenameKey(landingNode as never) }],
        },
      ],
    };
    const withNodes = generateClashConfig(
      buildGenerateOptionsFromConfig(withRefs, {
        nodes: [
          { ...relayNode, _sourceIds: ["s1"] },
          { ...landingNode, _sourceIds: ["s1"] },
        ] as never,
      })
    );
    expect(withNodes.rules).toContain("DOMAIN,example.com,🇺🇸 演示链");
  });

  it("warns when a chain target is disabled or missing", () => {
    const config = {
      ...defaultConfig(),
      proxyChains: [{ id: "c2", name: "停用链", enabled: false, landing: {}, relay: {} }],
      customRules: [
        { id: "off", type: "DOMAIN", value: "a.example.com", target: { kind: "chain", id: "c2" } },
        { id: "gone", type: "DOMAIN", value: "b.example.com", target: { kind: "chain", id: "nope" } },
      ],
    };
    const rows = buildRuleEditorView(config).rows;
    expect(rows.find((row) => row.key === "custom-rule:off")?.targetWarning).toContain("已停用");
    expect(rows.find((row) => row.key === "custom-rule:gone")?.targetWarning).toContain("不存在");
  });

  it("warns about targets that will fall back during generation", () => {
    const config = {
      ...defaultConfig(),
      customRules: [
        { id: "off", type: "DOMAIN", value: "a.example.com", target: { kind: "module", id: "netflix" } },
        { id: "node", type: "DOMAIN", value: "b.example.com", target: "香港 01" },
      ],
    };
    const rows = buildRuleEditorView(config).rows;
    const off = rows.find((row) => row.key === "custom-rule:off");
    const node = rows.find((row) => row.key === "custom-rule:node");

    // 指向未开启分组：生成器回退到 🚀 节点选择，预览文本也要照实显示
    expect(off).toMatchObject({ text: "DOMAIN,a.example.com,🚀 节点选择", targetValue: "module:netflix" });
    expect(off?.targetWarning).toContain("未开启");
    // 认不出的字符串可能是节点名：原样保留并提示
    expect(node).toMatchObject({ text: "DOMAIN,b.example.com,香港 01", targetValue: "raw:香港 01" });
    expect(node?.targetWarning).toContain("同名节点");
  });

  it("counts invalid entries instead of dropping them from the config", () => {
    const config = { ...defaultConfig(), customRules: [{ type: "BAD", value: "x", target: "DIRECT" }, "junk"] };
    const view = buildRuleEditorView(config);
    expect(view.invalid.customRules).toBe(2);
    const next = saveCustomRule(config, DIRECT_RULE).config;
    expect((next.customRules as unknown[]).slice(0, 2)).toEqual(config.customRules);
  });
});

describe("module toggles", () => {
  it("groups modules by category and locks the select and final groups", () => {
    const groups = buildModuleToggleGroups(defaultConfig());
    expect(groups[0]).toMatchObject({ category: "core", label: "核心组" });
    const core = groups[0].modules;
    expect(core.find((module) => module.id === "select")).toMatchObject({ locked: true, enabled: true });
    expect(core.find((module) => module.id === "final")).toMatchObject({ locked: true, enabled: true });
    expect(groups.flatMap((group) => group.modules).find((module) => module.id === "netflix")).toMatchObject({
      enabled: false,
      ruleCount: 2,
    });
  });

  it("counts rules that would fall back when a group is switched off", () => {
    const config = {
      ...defaultConfig(),
      customRules: [{ id: "x", type: "DOMAIN", value: "x.example.com", target: { kind: "module", id: "ai" } }],
      builtinRuleEdits: { "module:google:google": { target: "🤖 AI 服务" } },
    };
    const ai = buildModuleToggleGroups(config)
      .flatMap((group) => group.modules)
      .find((module) => module.id === "ai");
    expect(ai?.references).toBe(2);
  });

  it("enables a module in place, keeps enabledRules in sync and writes a complete order", () => {
    const base = defaultConfig();
    const next = setModuleEnabled(base, "netflix", true);
    const keys = keysOf(next);

    expect(next.enabledGroups).toContain("netflix");
    expect(next.enabledRules).toContain("netflix");
    expect(keys.indexOf("module:netflix:netflix")).toBeLessThan(keys.indexOf("module:global:geolocation-!cn"));
    // 完整顺序覆盖未开启的模块，以后再开启它们也有确定的位置
    expect(next.ruleOrder).toContain("module:adult:category-porn");
    expect(editorLines(next)).toEqual(generatedLines(next));
  });

  it("ignores attempts to switch off locked groups", () => {
    const base = defaultConfig();
    expect(setModuleEnabled(base, "select", false)).toBe(base);
    expect(setModuleEnabled(base, "final", false)).toBe(base);
    expect(setModuleEnabled(base, "missing", true)).toBe(base);
  });

  it("reconciles a toggle that was undone back to the saved config", () => {
    const base = defaultConfig();
    const off = reconcileWithBaseline(setModuleEnabled(base, "telegram", false), base);
    expect(isConfigChanged(off, base)).toBe(true);
    const back = reconcileWithBaseline(setModuleEnabled(off, "telegram", true), base);
    expect(back).toEqual(base);
    expect(isConfigChanged(back, base)).toBe(false);
  });
});

describe("custom rules", () => {
  it("adds new rules at the end of the custom block in the order they were added", () => {
    const first = saveCustomRule(defaultConfig(), DIRECT_RULE);
    const second = saveCustomRule(first.config, { ...DIRECT_RULE, value: "example.org" });
    const rows = buildRuleEditorView(second.config).rows;

    expect(rows.slice(3, 5).map((row) => [row.line, row.key])).toEqual([
      [4, first.key],
      [5, second.key],
    ]);
    expect(rows[5].key).toBe("module:ai:openai");
    expect(editorLines(second.config)).toEqual(generatedLines(second.config));
  });

  it("edits a rule in place and only keeps no-resolve on IP rules", () => {
    const added = saveCustomRule(defaultConfig(), { ...DIRECT_RULE, noResolve: true });
    const ip = saveCustomRule(
      added.config,
      { type: "IP-CIDR", value: "192.0.2.0/24", target: "DIRECT", noResolve: true },
      added.key.slice("custom-rule:".length)
    );
    const rules = ip.config.customRules as ConfigRecord[];

    expect((added.config.customRules as ConfigRecord[])[0]).not.toHaveProperty("noResolve");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ type: "IP-CIDR", noResolve: true });
    expect(keysOf(ip.config).indexOf(ip.key)).toBe(3);
    expect(editorLines(ip.config)).toContain("IP-CIDR,192.0.2.0/24,DIRECT,no-resolve");
  });

  it("pins derived ids before deleting so the remaining rules keep their position", () => {
    const base = {
      ...defaultConfig(),
      customRules: [
        { type: "DOMAIN", value: "first.example.com", target: "DIRECT" },
        { type: "DOMAIN", value: "second.example.com", target: "DIRECT" },
      ],
    };
    const [firstRow, secondRow] = buildRuleEditorView(base).rows.filter((row) => row.kind === "custom-rule");
    // 先把第二条挪到油管规则后面，顺序里引用的是按下标推导出的 id。
    // 它原本排在油管之前，挪走后油管上移一行，所以目标行号就是油管原来的下标 + 1
    let config = moveRuleToLine(base, secondRow.key, keysOf(base).indexOf("module:youtube:youtube") + 1);
    expect(keysOf(config).indexOf(secondRow.key)).toBe(keysOf(config).indexOf("module:youtube:youtube") + 1);

    config = deleteCustomRule(config, firstRow.customRule!.id);
    const keys = keysOf(config);
    expect(keys).not.toContain(firstRow.key);
    expect(config.ruleOrder).not.toContain(firstRow.key);
    expect(keys.indexOf(secondRow.key)).toBe(keys.indexOf("module:youtube:youtube") + 1);
    expect(editorLines(config)).toEqual(generatedLines(config));
  });

  it("moves custom rules one visible row at a time and never moves builtin rules", () => {
    const { config: added, key } = saveCustomRule(defaultConfig(), DIRECT_RULE);
    const down = moveRule(added, key, 1);
    expect(keysOf(down).indexOf(key)).toBe(keysOf(down).indexOf("module:ai:openai") + 1);

    const up = moveRule(moveRule(down, key, -1), key, -1);
    expect(keysOf(up).indexOf(key)).toBe(2);
    expect(moveRule(up, "module:ad:category-ads-all", 1)).toBe(up);

    // 挪到 AI 规则后面以后再开启 Gemini：Gemini 落在自己的位置，自定义规则仍在 OpenAI 之后
    const withGemini = setModuleEnabled(down, "gemini", true);
    const keys = keysOf(withGemini);
    expect(keys.indexOf("module:gemini:google-gemini")).toBeLessThan(keys.indexOf("module:ai:openai"));
    expect(keys.indexOf(key)).toBe(keys.indexOf("module:ai:openai") + 1);
  });

  it("moves a rule to an exact line or to the end before MATCH", () => {
    const { config: added, key } = saveCustomRule(defaultConfig(), DIRECT_RULE);
    const top = moveRuleToLine(added, key, 1);
    expect(buildRuleEditorView(top).rows[0]).toMatchObject({ key, line: 1 });

    const bottom = moveRuleToLine(added, key, 9999);
    const rows = buildRuleEditorView(bottom).rows;
    expect(rows.at(-1)).toMatchObject({ key });
    expect(editorLines(bottom).slice(-2)).toEqual(["DOMAIN-SUFFIX,example.com,DIRECT", "MATCH,🐟 漏网之鱼"]);
    expect(editorLines(bottom)).toEqual(generatedLines(bottom));
  });

  it("imports a batch in its original order across rules and rule sets", () => {
    const next = importCustomEntries(defaultConfig(), [
      { kind: "rule", rule: DIRECT_RULE },
      {
        kind: "ruleSet",
        ruleSet: { id: "media", name: "media", behavior: "domain", path: "https://example.com/geosite/media.mrs", target: "REJECT" },
      },
      { kind: "rule", rule: { ...DIRECT_RULE, value: "example.org" } },
    ]);
    const custom = buildRuleEditorView(next).rows.filter((row) => row.movable);
    expect(custom.map((row) => row.text)).toEqual([
      "DOMAIN-SUFFIX,example.com,DIRECT",
      "RULE-SET,media,REJECT",
      "DOMAIN-SUFFIX,example.org,DIRECT",
    ]);
    expect(editorLines(next)).toEqual(generatedLines(next));
  });
});

describe("custom rule sets", () => {
  it("never reuses a builtin rule id as the provider name", () => {
    const openai = ALL_RULES.find((rule) => rule.id === "openai")!;
    const { config, key } = saveCustomRuleSet(defaultConfig(), {
      name: openai.nameZh,
      behavior: openai.behavior,
      path: catalogRuleSetPath(openai),
      target: "DIRECT",
      noResolve: true,
      idHint: openai.id,
    });

    expect(key).toBe("custom-rule-set:openai-2");
    expect((config.customRuleSets as ConfigRecord[])[0]).toEqual({
      id: "openai-2",
      name: "OpenAI",
      behavior: "domain",
      path: "geosite/openai.mrs",
      target: "DIRECT",
    });
    expect(editorLines(config)).toContain("RULE-SET,openai-2,DIRECT");
    expect(generateClashConfig(buildGenerateOptionsFromConfig(config, { nodes: [] }))["rule-providers"]).toMatchObject({
      "openai-2": { url: expect.stringMatching(/\/geosite\/openai\.mrs$/u) },
    });

    const removed = deleteCustomRuleSet(config, "openai-2");
    expect(removed.customRuleSets).toEqual([]);
    expect(removed.ruleOrder).not.toContain(key);
  });

  it("keeps geoip catalog entries as relative ipcidr paths", () => {
    const cn = ALL_RULES.find((rule) => rule.id === "jp-ip")!;
    expect(catalogRuleSetPath(cn)).toBe("geoip/jp.mrs");
  });
});

describe("builtin rule edits", () => {
  it("switches a builtin rule off in place and cleans the edit up when it comes back", () => {
    const base = defaultConfig();
    const off = setBuiltinRuleEnabled(base, "module:private:private-ip", false);
    const rows = buildRuleEditorView(off).rows;

    expect(rows[2]).toMatchObject({ key: "module:private:private-ip", enabled: false, line: null });
    expect(rows[3].line).toBe(3);
    expect(editorLines(off)).toEqual(generatedLines(off));

    const on = setBuiltinRuleEnabled(off, "module:private:private-ip", true);
    expect(on.builtinRuleEdits).toEqual({});
    expect(reconcileWithBaseline(on, base)).toEqual(base);
  });

  it("链改回原写法时也能回到已保存状态", () => {
    const base: ConfigRecord = {
      ...defaultConfig(),
      proxyChains: [{ id: "c1", name: "🇺🇸 演示链", relay: { includeRegex: "香港" }, landing: { includeRegex: "落地" } }],
    };
    // 编辑过一次：补上了 sourceIds: []（链页的默认写法）
    const dirty: ConfigRecord = {
      ...base,
      proxyChains: [
        {
          id: "c1",
          name: "🇺🇸 演示链",
          enabled: true,
          relay: { sourceIds: [], includeRegex: "香港" },
          landing: { sourceIds: [], includeRegex: "落地" },
        },
      ],
    };
    expect(isConfigChanged(dirty, base)).toBe(true);
    // 语义没变，回滚到基线写法后视为没有未保存的修改
    expect(reconcileWithBaseline(dirty, base)).toEqual(base);
    expect(isConfigChanged(reconcileWithBaseline(dirty, base), base)).toBe(false);
    // 真正改了内容时不能回滚
    const changed: ConfigRecord = {
      ...dirty,
      proxyChains: [{ ...(dirty.proxyChains as ConfigRecord[])[0], name: "改了名" }],
    };
    expect(reconcileWithBaseline(changed, base)).toEqual(changed);
  });

  it("retargets a builtin rule and treats its own group as the default", () => {
    const base = defaultConfig();
    const moved = setBuiltinRuleTarget(base, "module:google:google", "module:select");
    const row = buildRuleEditorView(moved).rows.find((item) => item.key === "module:google:google");

    expect(moved.builtinRuleEdits).toEqual({ "module:google:google": { target: { kind: "module", id: "select" } } });
    expect(row).toMatchObject({ text: "RULE-SET,google,🚀 节点选择", defaultTarget: false });
    expect(editorLines(moved)).toEqual(generatedLines(moved));

    const restored = setBuiltinRuleTarget(moved, "module:google:google", "module:google");
    expect(restored.builtinRuleEdits).toEqual({});
  });

  it("leaves fields the visual editor does not own untouched", () => {
    const base = { ...defaultConfig(), dnsYaml: "dns:\n  enable: true\n", futureField: { keep: [1, 2] } };
    let next = setModuleEnabled(base, "netflix", true);
    next = setBuiltinRuleEnabled(next, "module:ad:category-ads-all", false);
    next = saveCustomRule(next, DIRECT_RULE).config;
    expect(next.dnsYaml).toBe(base.dnsYaml);
    expect(next.futureField).toEqual({ keep: [1, 2] });
  });
});

describe("custom rule validation", () => {
  const config = saveCustomRule(defaultConfig(), DIRECT_RULE).config;

  it.each([
    [{ type: "DOMAIN" as const, value: " " }, "请填写规则值"],
    [{ type: "DOMAIN" as const, value: "a,b" }, "逗号"],
    [{ type: "DOMAIN" as const, value: "a b" }, "空白"],
    [{ type: "IP-CIDR" as const, value: "192.0.2.0" }, "IPv4"],
    [{ type: "IP-CIDR" as const, value: "300.0.2.0/24" }, "IPv4"],
    [{ type: "IP-CIDR6" as const, value: "2001:db8::/129" }, "IPv6"],
    [{ type: "DST-PORT" as const, value: "70000" }, "端口"],
  ])("rejects %o", (input, message) => {
    expect(validateCustomRuleInput({ ...input, target: "DIRECT" }, config)).toContain(message);
  });

  it("accepts well-formed values and process names with spaces", () => {
    for (const input of [
      { type: "IP-CIDR" as const, value: "203.0.113.0/24" },
      { type: "IP-CIDR6" as const, value: "2001:db8::/32" },
      { type: "DST-PORT" as const, value: "8000-9000/443" },
      { type: "PROCESS-NAME" as const, value: "Google Chrome" },
    ]) {
      expect(validateCustomRuleInput({ ...input, target: "DIRECT" }, config)).toBeNull();
    }
  });

  it("flags duplicates except the rule being edited", () => {
    const id = (config.customRules as ConfigRecord[])[0].id as string;
    expect(validateCustomRuleInput({ ...DIRECT_RULE, value: "EXAMPLE.com" }, config)).toContain("相同");
    expect(validateCustomRuleInput(DIRECT_RULE, config, id)).toBeNull();
    expect(validateCustomRuleInput({ ...DIRECT_RULE, target: "REJECT" }, config)).toBeNull();
  });
});
