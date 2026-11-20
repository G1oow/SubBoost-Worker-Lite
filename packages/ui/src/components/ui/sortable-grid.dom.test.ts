// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SortableGrid } from "./sortable-grid";
import { SortableItem } from "./sortable-list";

/**
 * 网格容器的接线测试：落点语义（insert/swap）、落点回调与锁定都活在 dnd-kit 的事件里，
 * 纯函数测试（lib/sortable-order.test.ts）覆盖不到 onDragEnd / onDragOver / onDragCancel 这几段。
 * 用真实的键盘拖拽跑一遍，与 `sortable-list.dom.test.ts` 保持同一套写法。
 */

const IDS = ["a", "b", "c"];

/** jsdom 不做布局：给每个条目一段确定的几何，键盘坐标才能算出「上一个/下一个」 */
function stubGeometry() {
  screen.getAllByRole("listitem").forEach((node, index) => {
    const top = index * 60;
    const rect = {
      top,
      bottom: top + 56,
      height: 56,
      left: 0,
      right: 320,
      width: 320,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
    node.getBoundingClientRect = () => rect;
  });
}

function renderGrid(options: {
  onReorder: (ids: string[]) => void;
  onOverChange?: (id: string | null) => void;
  mode?: "insert" | "swap";
  locked?: ReadonlySet<string>;
}) {
  const items = IDS.map((id) =>
    React.createElement(
      SortableItem,
      {
        key: id,
        id,
        label: id,
        activator: "card" as const,
        ...(options.locked?.has(id) ? { disabled: true } : {}),
      },
      React.createElement("div", { className: "card" }, id)
    )
  );
  return render(
    React.createElement(
      SortableGrid,
      {
        ids: IDS,
        onReorder: options.onReorder,
        labelOf: (id: string) => `条目 ${id}`,
        ...(options.onOverChange ? { onOverChange: options.onOverChange } : {}),
        ...(options.mode ? { mode: options.mode } : {}),
        ...(options.locked ? { locked: options.locked } : {}),
      },
      items
    )
  );
}

function cardOf(id: string): HTMLElement {
  return screen.getByRole("button", { name: id });
}

function liveText(): string {
  return document.querySelector('[aria-live]')?.textContent ?? "";
}

async function startDrag(id: string): Promise<HTMLElement> {
  const card = cardOf(id);
  card.focus();
  fireEvent.keyDown(card, { code: "Space" });
  await waitFor(() => expect(liveText()).not.toBe(""));
  return card;
}

beforeEach(() => {
  // dnd-kit 用 ResizeObserver 观察尺寸；jsdom 没有实现，给个空壳避免报错
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(cleanup);

describe("sortable grid keyboard dragging", () => {
  it("补位语义下重排，并把落点与落点清空报给调用方", async () => {
    const onReorder = vi.fn();
    const onOverChange = vi.fn();
    renderGrid({ onReorder, onOverChange });
    stubGeometry();

    const card = await startDrag("a");
    fireEvent.keyDown(card, { code: "ArrowDown" });
    await waitFor(() => expect(onOverChange).toHaveBeenCalledWith("b"));

    fireEvent.keyDown(card, { code: "Space" });

    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"]);
    // 松手时先清掉落点高亮，再提交新顺序
    expect(onOverChange).toHaveBeenLastCalledWith(null);
    await waitFor(() => expect(liveText()).toBe("「条目 a」已放在「条目 b」的位置"));
  });

  it("交换语义下与落点互换，播报也换成交换措辞", async () => {
    const onReorder = vi.fn();
    renderGrid({ onReorder, mode: "swap" });
    stubGeometry();

    const card = await startDrag("a");
    fireEvent.keyDown(card, { code: "ArrowDown" });
    fireEvent.keyDown(card, { code: "Space" });

    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"]);
    await waitFor(() => expect(liveText()).toBe("「条目 a」已与「条目 b」交换位置"));
  });

  it("取消拖拽只清落点，不改顺序", async () => {
    const onReorder = vi.fn();
    const onOverChange = vi.fn();
    renderGrid({ onReorder, onOverChange });
    stubGeometry();

    const card = await startDrag("a");
    fireEvent.keyDown(card, { code: "ArrowDown" });
    fireEvent.keyDown(card, { code: "Escape" });

    expect(onReorder).not.toHaveBeenCalled();
    expect(onOverChange).toHaveBeenLastCalledWith(null);
    await waitFor(() => expect(liveText()).toBe("已取消排序，「条目 a」回到原位"));
  });
});

describe("sortable grid locks", () => {
  it("锁定的卡片拖不动（把手被禁用）", () => {
    renderGrid({ onReorder: vi.fn(), locked: new Set(["b"]) });

    expect(cardOf("b").getAttribute("aria-disabled")).toBe("true");
    expect(cardOf("a").getAttribute("aria-disabled")).toBe("false");
  });

  it("交换语义下落到锁定卡片上不动作", async () => {
    const onReorder = vi.fn();
    renderGrid({ onReorder, mode: "swap", locked: new Set(["b"]) });
    stubGeometry();

    const card = await startDrag("a");
    fireEvent.keyDown(card, { code: "ArrowDown" });
    fireEvent.keyDown(card, { code: "Space" });

    expect(onReorder).not.toHaveBeenCalled();
  });
});
