import { describe, expect, it } from "vitest";
import {
  defaultItemLabel,
  resolveDrop,
  resolveReorder,
  resolveSwap,
  resolveDropWithLocked,
  sortableAnnouncements,
} from "./sortable-order";

const IDS = ["a", "b", "c"];

describe("resolveReorder", () => {
  it("moves the dragged id to the drop position", () => {
    expect(resolveReorder(IDS, { id: "a" }, { id: "c" })).toEqual(["b", "c", "a"]);
    expect(resolveReorder(IDS, { id: "c" }, { id: "a" })).toEqual(["c", "a", "b"]);
    // 原数组不能被就地改写：调用方可能还在用它渲染
    const ids = [...IDS];
    resolveReorder(ids, { id: "a" }, { id: "b" });
    expect(ids).toEqual(IDS);
  });

  it("does nothing when the drop is a no-op or the list is disabled", () => {
    // 拾起又原地放下
    expect(resolveReorder(IDS, { id: "a" }, { id: "a" })).toBeNull();
    // 没拾起 / 没落在任何项上
    expect(resolveReorder(IDS, null, { id: "b" })).toBeNull();
    expect(resolveReorder(IDS, { id: "a" }, null)).toBeNull();
    // 列表禁用（保存进行中）
    expect(resolveReorder(IDS, { id: "a" }, { id: "b" }, true)).toBeNull();
  });

  it("refuses ids that are not part of the current list", () => {
    // 拖拽结果来自过期数据时不能写出错误顺序
    expect(resolveReorder(IDS, { id: "missing" }, { id: "b" })).toBeNull();
    expect(resolveReorder(IDS, { id: "a" }, { id: "missing" })).toBeNull();
    expect(resolveReorder([], { id: "a" }, { id: "b" })).toBeNull();
  });
});

describe("resolveSwap", () => {
  it("swaps the dragged id with the drop target and leaves the rest alone", () => {
    // 首尾交换：中间的 b 不许被顺延
    expect(resolveSwap(IDS, { id: "a" }, { id: "c" })).toEqual(["c", "b", "a"]);
    expect(resolveSwap(IDS, { id: "c" }, { id: "a" })).toEqual(["c", "b", "a"]);
    expect(resolveSwap(IDS, { id: "a" }, { id: "b" })).toEqual(["b", "a", "c"]);
    // 原数组不能被就地改写
    const ids = [...IDS];
    resolveSwap(ids, { id: "a" }, { id: "c" });
    expect(ids).toEqual(IDS);
  });

  it("shares the same bail-outs as resolveReorder", () => {
    expect(resolveSwap(IDS, { id: "a" }, { id: "a" })).toBeNull();
    expect(resolveSwap(IDS, null, { id: "b" })).toBeNull();
    expect(resolveSwap(IDS, { id: "a" }, null)).toBeNull();
    expect(resolveSwap(IDS, { id: "a" }, { id: "b" }, true)).toBeNull();
    expect(resolveSwap(IDS, { id: "missing" }, { id: "b" })).toBeNull();
  });
});

describe("resolveDrop", () => {
  it("defaults to the insert semantics and switches on swap", () => {
    expect(resolveDrop(IDS, { id: "a" }, { id: "c" })).toEqual(resolveReorder(IDS, { id: "a" }, { id: "c" }));
    expect(resolveDrop(IDS, { id: "a" }, { id: "c" }, false, "insert")).toEqual(["b", "c", "a"]);
    expect(resolveDrop(IDS, { id: "a" }, { id: "c" }, false, "swap")).toEqual(["c", "b", "a"]);
    expect(resolveDrop(IDS, { id: "a" }, { id: "c" }, true, "swap")).toBeNull();
  });
});

describe("sortableAnnouncements", () => {
  const labelOf = (id: string) => `条目 ${id}`;

  it("describes every step with the item name instead of the internal id", () => {
    const announce = sortableAnnouncements(labelOf);
    expect(announce.onDragStart({ active: { id: "a" } } as never)).toBe("已拾起「条目 a」");
    expect(announce.onDragOver({ active: { id: "a" }, over: { id: "b" } } as never)).toBe(
      "「条目 a」移动到「条目 b」的位置"
    );
    expect(announce.onDragEnd({ active: { id: "a" }, over: { id: "b" } } as never)).toBe(
      "「条目 a」已放在「条目 b」的位置"
    );
    expect(announce.onDragCancel({ active: { id: "a" } } as never)).toBe("已取消排序，「条目 a」回到原位");
  });

  it("announces a swap when the drop mode swaps instead of inserting", () => {
    const announce = sortableAnnouncements(labelOf, "swap");
    expect(announce.onDragOver({ active: { id: "a" }, over: { id: "b" } } as never)).toBe(
      "「条目 a」将与「条目 b」交换位置"
    );
    expect(announce.onDragEnd({ active: { id: "a" }, over: { id: "b" } } as never)).toBe(
      "「条目 a」已与「条目 b」交换位置"
    );
    // 拾起与取消跟落点语义无关
    expect(announce.onDragStart({ active: { id: "a" } } as never)).toBe("已拾起「条目 a」");
    expect(announce.onDragCancel({ active: { id: "a" } } as never)).toBe("已取消排序，「条目 a」回到原位");
  });

  it("stays silent while no item is under the pointer", () => {
    for (const mode of ["insert", "swap"] as const) {
      const announce = sortableAnnouncements(labelOf, mode);
      expect(announce.onDragOver({ active: { id: "a" }, over: null } as never)).toBe("");
      expect(announce.onDragEnd({ active: { id: "a" }, over: null } as never)).toBe("");
    }
  });

  it("falls back to the id when the caller passes nothing", () => {
    expect(defaultItemLabel("s1")).toBe("s1");
    const announce = sortableAnnouncements(defaultItemLabel);
    expect(announce.onDragStart({ active: { id: "s1" } } as never)).toBe("已拾起「s1」");
  });
});

describe("resolveDropWithLocked", () => {
  const ids = ["a", "lock", "b", "c"];
  const locked = new Set(["lock"]);

  it("锁定的条目钉在自己的下标上，其余条目在剩下的槽位里重排", () => {
    // c 拖到最前面：未锁定的 a/b/c → c/a/b，锁定项仍在 1 号位
    expect(resolveDropWithLocked(ids, { id: "c" }, { id: "a" }, false, "insert", locked)).toEqual([
      "c",
      "lock",
      "a",
      "b",
    ]);
    // 落在锁定卡片上：插到它前面那个未锁定槽位的边界，锁定项不动
    expect(resolveDropWithLocked(ids, { id: "c" }, { id: "lock" }, false, "insert", locked)).toEqual([
      "a",
      "lock",
      "c",
      "b",
    ]);
  });

  it("没有可移动目标时返回 null", () => {
    // 被拖的条目自己锁定
    expect(resolveDropWithLocked(ids, { id: "lock" }, { id: "a" }, false, "insert", locked)).toBeNull();
    // 已经紧挨着锁定卡片的那个边界：等于没动
    expect(resolveDropWithLocked(["a", "lock", "b"], { id: "b" }, { id: "lock" }, false, "insert", locked)).toBeNull();
    // 交换语义下，锁着的卡片不参与互换
    expect(resolveDropWithLocked(ids, { id: "c" }, { id: "lock" }, false, "swap", locked)).toBeNull();
  });

  it("交换语义只在未锁定槽位之间互换", () => {
    expect(resolveDropWithLocked(["a", "lock", "b"], { id: "a" }, { id: "b" }, false, "swap", locked)).toEqual([
      "b",
      "lock",
      "a",
    ]);
  });

  it("没有锁定时与 resolveDrop 完全一致", () => {
    const none = new Set<string>();
    expect(resolveDropWithLocked(ids, { id: "a" }, { id: "c" }, false, "insert", none)).toEqual(
      resolveDrop(ids, { id: "a" }, { id: "c" }, false, "insert")
    );
    expect(resolveDropWithLocked(ids, { id: "a" }, { id: "c" }, false, "swap", none)).toEqual(
      resolveDrop(ids, { id: "a" }, { id: "c" }, false, "swap")
    );
  });
});
