import { describe, expect, it } from "vitest";
import { PROXY_GROUP_GROUP_TYPES, type ProxyChain } from "@subboost/core/types/config";
import {
  CHAIN_GROUP_TYPE_OPTIONS,
  CHAIN_STATUS_META,
  chainGroupNames,
  chainStatusMeta,
  compileChainRegex,
  createChain,
  createChainId,
  mergePreviewStatus,
  moveChain,
  nextChainName,
  patchChain,
  patchChainSelector,
  readChains,
  readLegacyDialerGroups,
  removeChain,
  toggleChain,
  toggleChainSource,
  UNPREVIEWED_STATUS_META,
  validateChain,
  writeChains,
} from "./chain-editor";
import type { ConfigPreviewChain } from "./types";

function chain(overrides: Partial<ProxyChain> & { id: string; name: string }): ProxyChain {
  return {
    enabled: true,
    relay: { sourceIds: [] },
    landing: { sourceIds: [] },
    exitGroupType: "select",
    relayGroupType: "url-test",
    ...overrides,
  };
}

function preview(overrides: Partial<ConfigPreviewChain> & { id: string }): ConfigPreviewChain {
  return {
    name: "链式代理 1",
    exitGroupName: "链式代理 1",
    relayGroupName: "链式代理 1 · 前置",
    relayCount: 0,
    landingCount: 0,
    status: "ok",
    active: true,
    ...overrides,
  };
}

describe("读取 proxyChains", () => {
  it("非数组当空，不是对象的条目直接忽略", () => {
    expect(readChains({})).toEqual([]);
    expect(readChains({ proxyChains: "oops" })).toEqual([]);
    expect(readChains({ proxyChains: [null, 3, "x"] })).toEqual([]);
  });

  it("字段缺失补默认，脏数据被规范化", () => {
    const chains = readChains({
      proxyChains: [
        {
          id: " a ",
          name: "  链 A  ",
          relay: { sourceIds: ["s1", " s1 ", "", 7], includeRegex: "  ", excludeRegex: " 过期 " },
          landing: null,
          exitGroupType: "not-a-type",
          relayGroupType: "fallback",
          testUrl: "  https://example.com/ping  ",
        },
      ],
    });

    expect(chains).toEqual([
      {
        id: "a",
        name: "链 A",
        enabled: true,
        relay: { sourceIds: ["s1"], excludeRegex: "过期" },
        landing: { sourceIds: [] },
        exitGroupType: "select",
        relayGroupType: "fallback",
        testUrl: "https://example.com/ping",
      },
    ]);
    // 空正则不落字段：写回时也不会凭空多出 includeRegex: ""
    expect("includeRegex" in chains[0].relay).toBe(false);
  });

  it("缺 id 补兜底 id，重复 id 自动加后缀", () => {
    const chains = readChains({
      proxyChains: [{ name: "A" }, { name: "B" }, { id: "dup", name: "C" }, { id: "dup", name: "D" }],
    });
    expect(chains.map((item) => item.id)).toEqual(["chain-1", "chain-2", "dup", "dup-2"]);
  });

  it("enabled: false 保留，其他写法按启用处理", () => {
    const chains = readChains({ proxyChains: [{ id: "a", name: "A", enabled: false }, { id: "b", name: "B" }] });
    expect(chains.map((item) => item.enabled)).toEqual([false, true]);
  });
});

describe("写回 proxyChains", () => {
  it("没有链就删掉字段，不留空数组", () => {
    const config = { template: "standard", proxyChains: [{ id: "a", name: "A" }] };
    const next = writeChains(config, []);
    expect("proxyChains" in next).toBe(false);
    expect(next.template).toBe("standard");
    expect(writeChains({ template: "standard" }, [])).toEqual({ template: "standard" });
  });

  it("默认值不落盘：启用、默认组类型、空正则与空测速地址都不写", () => {
    const next = writeChains({}, [chain({ id: "a", name: " 链 A " })]);
    expect(next.proxyChains).toEqual([
      {
        id: "a",
        name: "链 A",
        relay: { sourceIds: [] },
        landing: { sourceIds: [] },
      },
    ]);
  });

  it("非默认值才落盘，其余配置字段原样保留", () => {
    const next = writeChains(
      { mixedPort: 7890, dialerProxyGroups: [{ id: "d", name: "旧中转" }] },
      [
        chain({
          id: "a",
          name: "链 A",
          enabled: false,
          relay: { sourceIds: ["s1"], includeRegex: " 香港 " },
          landing: { sourceIds: [], excludeRegex: "过期" },
          exitGroupType: "url-test",
          relayGroupType: "select",
          testUrl: " https://example.com/ping ",
        }),
      ]
    );

    expect(next.mixedPort).toBe(7890);
    expect(next.dialerProxyGroups).toEqual([{ id: "d", name: "旧中转" }]);
    expect(next.proxyChains).toEqual([
      {
        id: "a",
        name: "链 A",
        enabled: false,
        relay: { sourceIds: ["s1"], includeRegex: "香港" },
        landing: { sourceIds: [], excludeRegex: "过期" },
        exitGroupType: "url-test",
        relayGroupType: "select",
        testUrl: "https://example.com/ping",
      },
    ]);
  });

  it("读写一个残缺配置后再也不会丢掉以外的字段", () => {
    const config = { proxyChains: [{ id: "a", name: "A" }, { name: "", relay: {} }] };
    const roundTrip = readChains(writeChains(config, readChains(config)));
    expect(roundTrip.map((item) => item.id)).toEqual(["a", "chain-2"]);
  });
});

describe("新建链", () => {
  it("默认名取当前未占用的最小序号", () => {
    expect(nextChainName([])).toBe("链式代理 1");
    expect(nextChainName([chain({ id: "a", name: "链式代理 1" })])).toBe("链式代理 2");
    // 2 被占了但 1 没有：仍然取最小的空位
    expect(nextChainName([chain({ id: "a", name: "链式代理 2" })])).toBe("链式代理 1");
    expect(
      nextChainName([chain({ id: "a", name: "链式代理 1" }), chain({ id: "b", name: "链式代理 3" })])
    ).toBe("链式代理 2");
  });

  it("id 不与已有链重复，且不依赖数组下标", () => {
    const existing = [
      chain({ id: "chain-1", name: "链式代理 1" }),
      chain({ id: "chain-2", name: "链式代理 2" }),
    ];
    const created = createChain(existing);
    expect(created.id.startsWith("chain-")).toBe(true);
    expect(existing.map((item) => item.id)).not.toContain(created.id);
    expect(created.id).not.toBe("chain-3");

    const used = createChainId(["fixed"]);
    expect(used).not.toBe("fixed");
    expect(createChainId([used])).not.toBe(used);
  });

  it("默认两个选择器都为空（= 全部已启用源），组类型用默认值", () => {
    const created = createChain([chain({ id: "a", name: "链式代理 1" })]);
    expect(created).toMatchObject({
      name: "链式代理 2",
      enabled: true,
      relay: { sourceIds: [] },
      landing: { sourceIds: [] },
      exitGroupType: "select",
      relayGroupType: "url-test",
    });
  });

  it("新建后写回配置里就有这条链", () => {
    const config = {};
    const created = createChain(readChains(config));
    const next = writeChains(config, [...readChains(config), created]);
    expect(readChains(next)).toHaveLength(1);
    expect(readChains(next)[0].name).toBe("链式代理 1");
  });
});

describe("列表操作", () => {
  const list = [
    chain({ id: "a", name: "A" }),
    chain({ id: "b", name: "B" }),
    chain({ id: "c", name: "C" }),
  ];

  it("上移下移只交换相邻两条，越界原样返回", () => {
    expect(moveChain(list, 1, -1).map((item) => item.id)).toEqual(["b", "a", "c"]);
    expect(moveChain(list, 1, 1).map((item) => item.id)).toEqual(["a", "c", "b"]);
    expect(moveChain(list, 0, -1).map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(moveChain(list, 2, 1).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("不修改传入的数组", () => {
    const before = list.map((item) => item.id);
    moveChain(list, 0, 1);
    toggleChain(list, "a", false);
    removeChain(list, "a");
    expect(list.map((item) => item.id)).toEqual(before);
  });

  it("启停只改目标链", () => {
    const next = toggleChain(list, "b", false);
    expect(next.map((item) => item.enabled)).toEqual([true, false, true]);
    expect(toggleChain(list, "missing", false)).toEqual(list);
  });

  it("删除按 id 移除", () => {
    expect(removeChain(list, "b").map((item) => item.id)).toEqual(["a", "c"]);
    expect(removeChain(list, "missing")).toHaveLength(3);
  });

  it("按字段和按选择器局部更新", () => {
    expect(patchChain(list, "a", { name: "改名" })[0].name).toBe("改名");
    expect(patchChain(list, "missing", { name: "改名" })).toEqual(list);
    expect(patchChainSelector(list, "a", "landing", { includeRegex: "香港" })[0].landing).toEqual({
      sourceIds: [],
      includeRegex: "香港",
    });
  });

  it("勾选源时把 sourceIds 当成集合处理", () => {
    const selected = toggleChainSource(list, "a", "relay", "s1");
    expect(selected[0].relay.sourceIds).toEqual(["s1"]);
    expect(toggleChainSource(selected, "a", "relay", "s1")[0].relay.sourceIds).toEqual([]);
    expect(toggleChainSource(list, "missing", "relay", "s1")).toEqual(list);
  });
});

describe("本地校验", () => {
  it("空名给出提示", () => {
    const result = validateChain(chain({ id: "a", name: "   " }));
    expect(result.nameError).toContain("不能留空");
    expect(result.ok).toBe(false);
  });

  it("两条链同名判为重名", () => {
    const first = chain({ id: "a", name: "落地美国" });
    const second = chain({ id: "b", name: "落地美国" });
    const result = validateChain(second, [first, second]);
    expect(result.nameConflictError).toContain("组名");
    expect(result.ok).toBe(false);
    expect(validateChain(first, [first, second]).nameConflictError).not.toBeNull();
    // 只有自己时不冲突
    expect(validateChain(first, [first]).nameConflictError).toBeNull();
  });

  it("链名撞上别人派生的前置组名也算重名", () => {
    const first = chain({ id: "a", name: "落地美国" });
    const second = chain({ id: "b", name: "落地美国 · 前置" });
    expect(validateChain(second, [first, second]).nameConflictError).not.toBeNull();
  });

  it("非法正则给出可读提示且不抛异常", () => {
    const result = validateChain(
      chain({
        id: "a",
        name: "链",
        relay: { sourceIds: [], includeRegex: "香港(" },
        landing: { sourceIds: [], excludeRegex: "[a-" },
      })
    );
    expect(result.relayIncludeError).toBe("前置 · 匹配正则 不是有效的正则表达式");
    expect(result.landingExcludeError).toBe("落地 · 排除正则 不是有效的正则表达式");
    expect(result.ok).toBe(false);
  });

  it("合法的正则、空正则都通过", () => {
    expect(compileChainRegex(undefined, "匹配正则 ")).toBeNull();
    expect(compileChainRegex("   ", "匹配正则 ")).toBeNull();
    expect(compileChainRegex("香港|HK", "匹配正则 ")).toBeNull();
    const result = validateChain(
      chain({ id: "a", name: "链", relay: { sourceIds: [], includeRegex: "香港" } })
    );
    expect(result.ok).toBe(true);
  });

  it("组名与生成器一致：出口组 = 链名，前置组 = 链名 + 后缀", () => {
    expect(chainGroupNames(chain({ id: "a", name: " 落地美国 " }))).toEqual({
      exitGroupName: "落地美国",
      relayGroupName: "落地美国 · 前置",
    });
  });

  it("组类型下拉覆盖 core 的全部取值", () => {
    expect(CHAIN_GROUP_TYPE_OPTIONS.map((option) => option.value)).toEqual([...PROXY_GROUP_GROUP_TYPES]);
  });
});

describe("合并预览状态", () => {
  const chains = [
    chain({ id: "a", name: "A" }),
    chain({ id: "b", name: "B" }),
  ];

  it("按 id 贴回状态，预览里没有的视为未预览", () => {
    const merged = mergePreviewStatus(chains, [preview({ id: "a", relayCount: 3, landingCount: 2 })]);
    expect(merged[0].preview).toMatchObject({ id: "a", relayCount: 3, landingCount: 2 });
    expect(merged[1].preview).toBeNull();
  });

  it("没有预览数据时全部是未预览，多余的条目被忽略", () => {
    expect(mergePreviewStatus(chains, undefined).map((item) => item.preview)).toEqual([null, null]);
    expect(mergePreviewStatus(chains, null).map((item) => item.preview)).toEqual([null, null]);
    const merged = mergePreviewStatus(chains, [preview({ id: "ghost" })]);
    expect(merged.map((item) => item.preview)).toEqual([null, null]);
  });

  it("状态文案覆盖全部取值，未预览单独一条", () => {
    expect(Object.keys(CHAIN_STATUS_META).sort()).toEqual(
      ["disabled", "empty-landing", "empty-relay", "invalid", "invalid-regex", "name-conflict", "ok"].sort()
    );
    expect(chainStatusMeta("empty-landing").label).toBe("落地无节点，不生成");
    expect(chainStatusMeta("empty-relay").label).toBe("前置无节点，落地不可用");
    expect(chainStatusMeta("disabled").label).toBe("已停用");
    expect(chainStatusMeta("name-conflict").label).toBe("组名冲突");
    expect(chainStatusMeta("invalid-regex").label).toBe("正则无效");
    expect(chainStatusMeta("invalid").label).toBe("配置不完整");
    expect(chainStatusMeta("ok").label).toBe("正常");
    expect(chainStatusMeta(null)).toBe(UNPREVIEWED_STATUS_META);
  });
});

describe("旧中转组只读视图", () => {
  it("没有数据时是空列表", () => {
    expect(readLegacyDialerGroups({})).toEqual([]);
    expect(readLegacyDialerGroups({ dialerProxyGroups: {} })).toEqual([]);
  });

  it("读出名称、状态与节点数量，脏条目跳过", () => {
    const groups = readLegacyDialerGroups({
      dialerProxyGroups: [
        { id: "d1", name: " 旧中转 ", type: "url-test", relayNodes: ["a"], targetNodes: ["b", "c"] },
        { name: "停用的", enabled: false, relayNodes: [], targetNodes: [] },
        null,
      ],
    });
    expect(groups).toEqual([
      {
        id: "d1",
        name: "旧中转",
        enabled: true,
        type: "url-test",
        relayCount: 1,
        targetCount: 2,
      },
      { id: "dialer-2", name: "停用的", enabled: false, type: "select", relayCount: 0, targetCount: 0 },
    ]);
  });
});
