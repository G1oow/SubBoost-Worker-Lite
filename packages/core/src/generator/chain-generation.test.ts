import { describe, expect, it } from "vitest";
import type { ParsedNode } from "@subboost/core/types/node";
import type { ClashConfig } from "@subboost/core/types/config";
import { generateClashConfig, generateClashYaml } from "./index";
import { buildGenerateOptionsFromConfig } from "../subscription/config-utils";

function ss(name: string, patch: Record<string, unknown> = {}): ParsedNode {
  return {
    name,
    type: "ss",
    server: "ss.example.com",
    port: 8388,
    cipher: "aes-128-gcm",
    password: "secret",
    ...patch,
  } as ParsedNode;
}

const NODES: ParsedNode[] = [ss("日本中转"), ss("美国落地-1"), ss("美国落地-2"), ss("香港节点")];

const EXIT_GROUP = "🇺🇸 美国链";
const RELAY_GROUP = "🇺🇸 美国链 · 前置";

function generate(proxyChains: unknown[], extra: Record<string, unknown> = {}): ClashConfig {
  return generateClashConfig(
    buildGenerateOptionsFromConfig(
      {
        proxyChains,
        ...extra,
      },
      { nodes: NODES }
    )
  );
}

function groupsOf(config: ClashConfig): Array<Record<string, unknown>> {
  return (config["proxy-groups"] ?? []) as unknown as Array<Record<string, unknown>>;
}

function groupNames(config: ClashConfig): string[] {
  return groupsOf(config).map((group) => String(group.name));
}

function findGroup(config: ClashConfig, name: string): Record<string, unknown> | undefined {
  return groupsOf(config).find((group) => group.name === name);
}

function membersOf(config: ClashConfig, name: string): string[] {
  const group = findGroup(config, name);
  return ((group?.proxies ?? []) as string[]).slice();
}

function chainEntry(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "chain-us",
    name: EXIT_GROUP,
    relay: { sourceIds: [], includeRegex: "日本中转" },
    landing: { sourceIds: [], includeRegex: "美国落地" },
    ...patch,
  };
}

function nodeByName(config: ClashConfig, name: string): Record<string, unknown> | undefined {
  return (config.proxies ?? []).find((node) => node.name === name) as unknown as
    | Record<string, unknown>
    | undefined;
}

describe("链式代理生成", () => {
  it("生成出口组与前置组，落地节点带 dialer-proxy", () => {
    const config = generate([chainEntry()]);

    expect(findGroup(config, EXIT_GROUP)).toMatchObject({
      type: "select",
      proxies: ["美国落地-1", "美国落地-2"],
    });
    expect(findGroup(config, RELAY_GROUP)).toMatchObject({
      type: "url-test",
      proxies: ["日本中转"],
    });

    expect(nodeByName(config, "美国落地-1")).toMatchObject({ "dialer-proxy": RELAY_GROUP });
    expect(nodeByName(config, "美国落地-2")).toMatchObject({ "dialer-proxy": RELAY_GROUP });
    // 前置节点自己直连出站，不带 dialer-proxy
    expect(nodeByName(config, "日本中转")).not.toHaveProperty("dialer-proxy");
  });

  it("落地节点退出各分组，出口组顶替它原来的坑位", () => {
    const config = generate([chainEntry()]);
    const selectGroup = membersOf(config, "🚀 节点选择");

    expect(selectGroup).toContain(EXIT_GROUP);
    expect(selectGroup).not.toContain("美国落地-1");
    expect(selectGroup).not.toContain("美国落地-2");
    // 前置节点仍然可选（可以直接单跳使用）
    expect(selectGroup).toContain("日本中转");
    // 坑位顺序：日本中转 → 出口组 → 香港节点
    expect(selectGroup.indexOf("日本中转")).toBeLessThan(selectGroup.indexOf(EXIT_GROUP));
    expect(selectGroup.indexOf(EXIT_GROUP)).toBeLessThan(selectGroup.indexOf("香港节点"));
  });

  it("⚡ 自动选择只剔除落地节点，不放入出口组", () => {
    const config = generate([chainEntry()]);
    const autoGroup = membersOf(config, "⚡ 自动选择");

    expect(autoGroup).not.toContain(EXIT_GROUP);
    expect(autoGroup).not.toContain("美国落地-1");
    expect(autoGroup).toEqual(expect.arrayContaining(["日本中转", "香港节点"]));
  });

  it("落地节点不出现在出口组以外的任何分组", () => {
    const config = generate([chainEntry()]);
    for (const group of groupsOf(config)) {
      const name = String(group.name);
      if (name === EXIT_GROUP) continue;
      const members = ((group.proxies ?? []) as string[]).slice();
      expect(members).not.toContain("美国落地-1");
      expect(members).not.toContain("美国落地-2");
    }
  });

  it("出口组排在前置组之前，二者都紧跟在自动选择之后", () => {
    const config = generate([chainEntry()]);
    const names = groupNames(config);

    expect(names.indexOf("⚡ 自动选择")).toBeLessThan(names.indexOf(EXIT_GROUP));
    expect(names.indexOf(EXIT_GROUP)).toBeLessThan(names.indexOf(RELAY_GROUP));
    // 旧中转组等其他分组仍在链的组之后
    expect(names.indexOf(RELAY_GROUP)).toBeLessThan(names.indexOf("🌍 非中国"));
  });

  it("前置为空时前置组只放 REJECT，落地仍然生成", () => {
    const config = generate([
      chainEntry({ relay: { sourceIds: [], includeRegex: "不存在的中转" } }),
    ]);

    expect(membersOf(config, RELAY_GROUP)).toEqual(["REJECT"]);
    expect(nodeByName(config, "美国落地-1")).toMatchObject({ "dialer-proxy": RELAY_GROUP });
    expect(membersOf(config, EXIT_GROUP)).toEqual(["美国落地-1", "美国落地-2"]);
  });

  it("落地为空时整条链不生成，节点仍在分组里可用", () => {
    const config = generate([
      chainEntry({ landing: { sourceIds: [], includeRegex: "不存在的落地" } }),
    ]);

    expect(findGroup(config, EXIT_GROUP)).toBeUndefined();
    expect(findGroup(config, RELAY_GROUP)).toBeUndefined();
    expect(membersOf(config, "🚀 节点选择")).toContain("美国落地-1");
    expect(nodeByName(config, "美国落地-1")).not.toHaveProperty("dialer-proxy");
  });

  it("与内置分组重名时跳过该链", () => {
    const config = generate([chainEntry({ name: "🚀 节点选择" })]);
    const names = groupNames(config);

    expect(names.filter((name) => name === "🚀 节点选择")).toHaveLength(1);
    expect(findGroup(config, "🚀 节点选择 · 前置")).toBeUndefined();
    expect(nodeByName(config, "美国落地-1")).not.toHaveProperty("dialer-proxy");
  });

  it("停用的链不生成分组", () => {
    const config = generate([chainEntry({ enabled: false })]);
    expect(findGroup(config, EXIT_GROUP)).toBeUndefined();
    expect(membersOf(config, "🚀 节点选择")).toContain("美国落地-1");
  });

  it("出口组类型可配，url-test 带 url 与 interval", () => {
    const config = generate([chainEntry({ exitGroupType: "url-test", testUrl: "https://example.com/generate_204" })]);
    expect(findGroup(config, EXIT_GROUP)).toMatchObject({
      type: "url-test",
      url: "https://example.com/generate_204",
      proxies: ["美国落地-1", "美国落地-2"],
    });
  });

  it("多条链先到先得，后一条链落地被占后不生成", () => {
    const config = generate([
      chainEntry(),
      chainEntry({
        id: "chain-second",
        name: "🇺🇸 美国链二",
        landing: { sourceIds: [], includeRegex: "美国落地-1" },
      }),
    ]);

    expect(findGroup(config, EXIT_GROUP)).toBeDefined();
    expect(findGroup(config, "🇺🇸 美国链二")).toBeUndefined();
  });

  it("proxyGroupOrder 里的 chain:<id> 能把出口组排到最前", () => {
    const config = generate([chainEntry()], { proxyGroupOrder: ["chain:chain-us"] });
    expect(groupNames(config)[0]).toBe(EXIT_GROUP);
  });

  it("_sourceIds 不会漏进 proxies 段", () => {
    const yaml = generateClashYaml(
      buildGenerateOptionsFromConfig(
        { proxyChains: [chainEntry()] },
        {
          nodes: NODES.map((node) => ({ ...(node as unknown as Record<string, unknown>), _sourceIds: ["src-1"] }) as ParsedNode),
        }
      )
    );
    expect(yaml).not.toContain("_sourceIds");
  });
});
