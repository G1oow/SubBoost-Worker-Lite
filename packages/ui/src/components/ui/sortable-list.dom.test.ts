// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SortableHandle, SortableItem, SortableList } from "./sortable-list";

/**
 * 用真实的键盘拖拽跑一遍 dnd-kit 接线：手柄能不能拾起卡片、方向键能不能换位、
 * 播报是不是中文且带条目名、原地放下与禁用时会不会误改顺序。
 * 这些是组件里的接线分支，纯函数测试（lib/sortable-order.test.ts）覆盖不到。
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

function renderList(options: { onReorder: (ids: string[]) => void; disabled?: boolean; withLabels?: boolean }) {
  const items = IDS.map((id) =>
    React.createElement(
      SortableItem,
      { key: id, id, label: id, ...(options.disabled ? { disabled: true } : {}) },
      React.createElement("div", { className: "card" }, React.createElement(SortableHandle))
    )
  );
  return render(
    React.createElement(
      SortableList,
      {
        ids: IDS,
        onReorder: options.onReorder,
        ...(options.disabled ? { disabled: true } : {}),
        ...(options.withLabels ? { labelOf: (id: string) => `条目 ${id}` } : {}),
      },
      items
    )
  );
}

function handleOf(id: string): HTMLElement {
  return screen.getByRole("button", { name: `拖动排序 ${id}` });
}

function liveText(): string {
  return document.querySelector('[aria-live]')?.textContent ?? "";
}

/** 按下空格并等拖拽真正开始（dnd-kit 的激活是异步的，播报会先落到 live region） */
async function startDrag(id: string): Promise<HTMLElement> {
  const handle = handleOf(id);
  handle.focus();
  fireEvent.keyDown(handle, { code: "Space" });
  await waitFor(() => expect(liveText()).not.toBe(""));
  return handle;
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

describe("sortable list keyboard dragging", () => {
  it("picks a card up with Space and reports the new order with the item name", async () => {
    const onReorder = vi.fn();
    renderList({ onReorder, withLabels: true });
    stubGeometry();

    const handle = await startDrag("a");
    fireEvent.keyDown(handle, { code: "ArrowDown" });
    fireEvent.keyDown(handle, { code: "Space" });

    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"]);
    await waitFor(() => expect(liveText()).toBe("「条目 a」已放在「条目 b」的位置"));
  });

  it("cancels with Escape without touching the order", async () => {
    const onReorder = vi.fn();
    renderList({ onReorder, withLabels: true });
    stubGeometry();

    const handle = await startDrag("a");
    fireEvent.keyDown(handle, { code: "ArrowDown" });
    fireEvent.keyDown(handle, { code: "Escape" });

    expect(onReorder).not.toHaveBeenCalled();
    await waitFor(() => expect(liveText()).toBe("已取消排序，「条目 a」回到原位"));
  });

  it("keeps the order when the card is dropped in place", async () => {
    const onReorder = vi.fn();
    renderList({ onReorder, withLabels: true });
    stubGeometry();

    const handle = await startDrag("a");
    fireEvent.keyDown(handle, { code: "Space" });

    expect(onReorder).not.toHaveBeenCalled();
  });

  it("falls back to the internal id when the caller passes no labelOf", async () => {
    const onReorder = vi.fn();
    renderList({ onReorder });
    stubGeometry();

    const handle = await startDrag("a");
    fireEvent.keyDown(handle, { code: "ArrowDown" });
    fireEvent.keyDown(handle, { code: "Space" });

    await waitFor(() => expect(liveText()).toBe("「a」已放在「b」的位置"));
  });

  it("leaves a disabled list alone", () => {
    const onReorder = vi.fn();
    renderList({ onReorder, disabled: true });
    stubGeometry();

    const handle = handleOf("a") as HTMLButtonElement;
    // 禁用时手柄自身不可用，键盘按下也不会开始拖拽
    expect(handle.disabled).toBe(true);
    fireEvent.keyDown(handle, { code: "Space" });
    fireEvent.keyDown(handle, { code: "ArrowDown" });
    fireEvent.keyDown(handle, { code: "Space" });

    expect(onReorder).not.toHaveBeenCalled();
    expect(liveText()).toBe("");
  });
});
