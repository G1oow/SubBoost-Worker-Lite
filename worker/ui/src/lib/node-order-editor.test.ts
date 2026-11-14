import { describe, expect, it } from "vitest";
import type { CanvasNodeSummary } from "./types";
import {
  DEFAULT_GRID_COLUMNS,
  GRID_COLUMNS_STORAGE_KEY,
  applyVisibleOrder,
  autoOrderByRegion,
  filterCanvasNodes,
  mergeOrderWithCanvas,
  readGridColumns,
  readNodeOrder,
  readSelectedSubscription,
  rebuildCanvasOrder,
  saveGridColumns,
  saveSelectedSubscription,
  summarizeCanvasCoverage,
  writeNodeOrder,
} from "./node-order-editor";

const A = "0".repeat(16);
const B = "1".repeat(16);
const C = "2".repeat(16);
const D = "3".repeat(16);

function storage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

function canvasNode(key: string, name: string, type = "ss"): CanvasNodeSummary {
  return { key, name, originName: name, type, renamed: false };
}

describe("nodeOrder 读写", () => {
  it("只保留合法指纹并去重", () => {
    expect(readNodeOrder({ nodeOrder: [A, A, "bad", 7, B] })).toEqual([A, B]);
    expect(readNodeOrder({})).toEqual([]);
    expect(readNodeOrder({ nodeOrder: "abc" })).toEqual([]);
  });

  it("空表时删掉字段，避免配置里留空数组", () => {
    expect(writeNodeOrder({ nodeOrder: [A] }, [])).toEqual({});
    expect(writeNodeOrder({ ruleOrder: [1], nodeOrder: [A] }, [B])).toEqual({ ruleOrder: [1], nodeOrder: [B] });
  });
});

describe("mergeOrderWithCanvas", () => {
  it("把没显示在画布里的旧条目按原相对位置插回去", () => {
    expect(mergeOrderWithCanvas([A, B, C, D], [A, C])).toEqual([A, B, C, D]);
  });

  it("旧条目插在「旧顺序里它后面第一个仍在画布的节点」之前", () => {
    // 旧顺序 B A C，画布改成 C A：B 原本在 A 前面，后续画布节点是 A，于是贴在 A 前面
    expect(mergeOrderWithCanvas([B, A, C], [C, A])).toEqual([C, B, A]);
  });

  it("旧条目在旧顺序里排在所有画布节点之后时追加到末尾", () => {
    expect(mergeOrderWithCanvas([B, D], [A, C])).toEqual([A, C, B, D]);
  });

  it("画布顺序里没有的旧条目不会丢", () => {
    // 旧顺序 A B C，画布是 C A：B 的下一个画布节点是 C，于是贴在 C 前面
    expect(mergeOrderWithCanvas([A, B, C], [C, A])).toEqual([B, C, A]);
  });

  it("画布顺序去重，空画布时保留原样", () => {
    expect(mergeOrderWithCanvas([], [A, A, B])).toEqual([A, B]);
    expect(mergeOrderWithCanvas([B, A], [])).toEqual([B, A]);
  });
});

describe("applyVisibleOrder", () => {
  it("只回填可见槽位，隐藏项占位不动", () => {
    // 完整顺序 A B C D，过滤后可见 A C D：把可见序列改成 D C A 后，B 仍在原位
    expect(applyVisibleOrder([A, B, C, D], [A, C, D], [D, C, A])).toEqual([D, B, C, A]);
  });

  it("不过滤时等价于直接替换", () => {
    expect(applyVisibleOrder([A, B, C], [A, B, C], [C, A, B])).toEqual([C, A, B]);
  });

  it("长度对不上或没有可见项时原样返回", () => {
    expect(applyVisibleOrder([A, B, C], [A, C], [A])).toEqual([A, B, C]);
    expect(applyVisibleOrder([A, B, C], [], [])).toEqual([A, B, C]);
  });
});

describe("rebuildCanvasOrder", () => {
  it("已保存的在前，用户拖过但没保存的段落保留，新节点补在末尾", () => {
    expect(rebuildCanvasOrder([B, C], [A, B, C, D], [C, A])).toEqual([C, A, B, D]);
  });

  it("没有保存顺序时沿用当前顺序与响应顺序", () => {
    expect(rebuildCanvasOrder([B, A], [A, B, C], [])).toEqual([B, A, C]);
    expect(rebuildCanvasOrder([], [A, B], [])).toEqual([A, B]);
  });

  it("已保存顺序里指向未加载节点的条目不参与画布", () => {
    expect(rebuildCanvasOrder([], [A, B], [D, B, C])).toEqual([B, A]);
  });
});

describe("filterCanvasNodes", () => {
  const nodes = [canvasNode(A, "香港 01"), canvasNode(B, "日本 02", "vmess")];

  it("按名称或协议匹配，空查询返回原数组", () => {
    expect(filterCanvasNodes(nodes, "")).toBe(nodes);
    expect(filterCanvasNodes(nodes, " 香港 ")).toEqual([nodes[0]]);
    expect(filterCanvasNodes(nodes, "VMESS")).toEqual([nodes[1]]);
    expect(filterCanvasNodes(nodes, "没有这个")).toEqual([]);
  });
});

describe("autoOrderByRegion", () => {
  it("按地区预设顺序排列，同地区按名称，未识别排最后", () => {
    const nodes = [
      canvasNode(A, "未知节点"),
      canvasNode(B, "日本 02"),
      canvasNode(C, "香港 02"),
      canvasNode(D, "香港 01"),
    ];
    expect(autoOrderByRegion(nodes)).toEqual([D, C, B, A]);
  });
});

describe("summarizeCanvasCoverage", () => {
  it("统计所选订阅的已加载数量与截断数量", () => {
    expect(summarizeCanvasCoverage({ nodeCount: 1000, nodes: new Array(1000).fill(null) })).toEqual({
      loaded: 1000,
      truncated: 0,
    });
    expect(summarizeCanvasCoverage({ nodeCount: 12, nodes: new Array(10).fill(null) })).toEqual({
      loaded: 10,
      truncated: 2,
    });
    expect(summarizeCanvasCoverage(null)).toEqual({ loaded: 0, truncated: 0 });
  });
});

describe("本地偏好", () => {
  it("列数只接受 3/4/5，其余回退默认值", () => {
    const store = storage();
    expect(readGridColumns(store)).toBe(DEFAULT_GRID_COLUMNS);
    saveGridColumns(5, store);
    expect(store.getItem(GRID_COLUMNS_STORAGE_KEY)).toBe("5");
    expect(readGridColumns(store)).toBe(5);

    const broken = storage({ [GRID_COLUMNS_STORAGE_KEY]: "7" });
    expect(readGridColumns(broken)).toBe(DEFAULT_GRID_COLUMNS);
  });

  it("记住的是单条订阅，并能读取早期版本存下的勾选数组", () => {
    const store = storage();
    saveSelectedSubscription("s2", store);
    expect(readSelectedSubscription(store)).toBe("s2");

    // 早期版本存的是数组：取第一项，升级后画布不会突然空掉
    expect(readSelectedSubscription(storage({ "subboost-node-grid-subscriptions": '["s1","s2"]' }))).toBe("s1");
    expect(readSelectedSubscription(storage({ "subboost-node-grid-subscriptions": "{oops" }))).toBeNull();
    expect(readSelectedSubscription(storage({ "subboost-node-grid-subscriptions": '[""]' }))).toBeNull();
    expect(readSelectedSubscription(storage())).toBeNull();

    saveSelectedSubscription(null, store);
    expect(store.getItem("subboost-node-grid-subscriptions")).toBeNull();
  });
});
