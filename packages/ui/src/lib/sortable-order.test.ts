import { describe, expect, it } from "vitest";
import { defaultItemLabel, resolveReorder, sortableAnnouncements } from "./sortable-order";

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

  it("stays silent while no item is under the pointer", () => {
    const announce = sortableAnnouncements(labelOf);
    expect(announce.onDragOver({ active: { id: "a" }, over: null } as never)).toBe("");
    expect(announce.onDragEnd({ active: { id: "a" }, over: null } as never)).toBe("");
  });

  it("falls back to the id when the caller passes nothing", () => {
    expect(defaultItemLabel("s1")).toBe("s1");
    const announce = sortableAnnouncements(defaultItemLabel);
    expect(announce.onDragStart({ active: { id: "s1" } } as never)).toBe("已拾起「s1」");
  });
});
