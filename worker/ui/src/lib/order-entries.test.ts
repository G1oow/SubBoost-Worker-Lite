import { describe, expect, it } from "vitest";
import { mergeReorder, orderRefreshEntries } from "./order-entries";
import type { RefreshEntry } from "./refresh-board";

const entry = (id: string): RefreshEntry => ({ id, name: id, kind: "source", ok: true, nodeCount: 0, share: 0 });

describe("refresh board display order", () => {
  it("follows persisted card order and leaves deleted snapshot entries at the end", () => {
    const entries = [entry("removed-a"), entry("current-a"), entry("removed-b"), entry("current-b")];
    expect(orderRefreshEntries(entries, ["current-b", "current-a"]).map(({ id }) => id))
      .toEqual(["current-b", "current-a", "removed-a", "removed-b"]);
    expect(entries.map(({ id }) => id)).toEqual(["removed-a", "current-a", "removed-b", "current-b"]);
  });
});

describe("reorder commit shape", () => {
  it("drops deleted snapshot entries and appends ids missing from the drag result", () => {
    // 拖拽结果里混入已删除对象：剔除后仍是合法排列
    expect(mergeReorder(["removed", "b", "a"], ["a", "b"])).toEqual(["b", "a"]);
    // 拖拽结果漏掉现存对象：按原顺序补回末尾，保证集合一致
    expect(mergeReorder(["b"], ["a", "b"])).toEqual(["b", "a"]);
    // 只有已删除对象时不产生任何现存 id 的移动
    expect(mergeReorder(["removed"], ["a", "b"])).toEqual(["a", "b"]);
  });
});
