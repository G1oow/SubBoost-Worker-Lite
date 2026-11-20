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

/**
 * 整卡拖拽（`activator="card"`）：网格画布不需要手柄，按住卡片就能拖。
 * 这里验证接线真的落在卡片上、手柄不再渲染，键盘同样能用。
 */
function renderCardList(options: { onReorder: (ids: string[]) => void }) {
  const items = IDS.map((id) =>
    React.createElement(
      SortableItem,
      { key: id, id, label: id, activator: "card" as const },
      React.createElement("div", { className: "card" }, id)
    )
  );
  return render(
    React.createElement(
      SortableList,
      { ids: IDS, onReorder: options.onReorder, labelOf: (id: string) => `条目 ${id}` },
      items
    )
  );
}

describe("sortable card activator", () => {
  it("把监听挂在卡片上，并且不再渲染手柄", async () => {
    renderCardList({ onReorder: vi.fn() });

    expect(screen.queryByRole("button", { name: /拖动排序/ })).toBeNull();
    const card = screen.getByRole("button", { name: "a" });
    expect(card.getAttribute("aria-roledescription")).toBe("sortable");
    expect(card.getAttribute("tabindex")).toBe("0");
    // 列表语义保留：卡片外层仍是 listitem
    expect(screen.getAllByRole("listitem")).toHaveLength(IDS.length);
  });

  it("键盘仍然可以拾起、移动与放下", async () => {
    const onReorder = vi.fn();
    renderCardList({ onReorder });
    stubGeometry();

    const card = screen.getByRole("button", { name: "a" });
    card.focus();
    fireEvent.keyDown(card, { code: "Space" });
    await waitFor(() => expect(liveText()).not.toBe(""));
    fireEvent.keyDown(card, { code: "ArrowDown" });
    fireEvent.keyDown(card, { code: "Space" });

    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"]);
    await waitFor(() => expect(liveText()).toBe("「条目 a」已放在「条目 b」的位置"));
  });
});

/**
 * 整卡拖拽的「轻点」（`onTap`）：锁定这类附加动作走它。
 * 指针路径要区分「点一下」和「拖完松手」，键盘路径是 L —— 把手的 Space/Enter 已被拖拽占用。
 */
function renderTappableCard(onTap: () => void) {
  return render(
    React.createElement(
      SortableList,
      { ids: ["a"], onReorder: vi.fn(), labelOf: (id: string) => `条目 ${id}` },
      React.createElement(
        SortableItem,
        { id: "a", label: "a", activator: "card" as const, onTap },
        React.createElement("div", { className: "card" }, "a")
      )
    )
  );
}

/** jsdom 没有 PointerEvent：用同名的 MouseEvent 派发，React 按事件类型照样接得住 */
function pointerDown(node: HTMLElement, x: number, y: number) {
  node.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: x, clientY: y }));
}

describe("sortable card tap", () => {
  it("按下后没移动就松手算轻点", () => {
    const onTap = vi.fn();
    renderTappableCard(onTap);
    const card = screen.getByRole("button", { name: "a" });

    pointerDown(card, 10, 10);
    fireEvent.click(card, { clientX: 12, clientY: 11 });

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(card.getAttribute("aria-keyshortcuts")).toBe("L");
  });

  it("拖完再松手不触发轻点", () => {
    const onTap = vi.fn();
    renderTappableCard(onTap);
    const card = screen.getByRole("button", { name: "a" });

    pointerDown(card, 10, 10);
    fireEvent.click(card, { clientX: 120, clientY: 10 });

    expect(onTap).not.toHaveBeenCalled();
  });

  it("没有 pointerdown 记录的 click 也算轻点（键盘与读屏的合成点击）", () => {
    const onTap = vi.fn();
    renderTappableCard(onTap);

    fireEvent.click(screen.getByRole("button", { name: "a" }));

    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("键盘用 L 触发，其它键不抢", () => {
    const onTap = vi.fn();
    renderTappableCard(onTap);
    const card = screen.getByRole("button", { name: "a" });

    fireEvent.keyDown(card, { key: "a" });
    expect(onTap).not.toHaveBeenCalled();

    fireEvent.keyDown(card, { key: "l" });
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("没传 onTap 时不挂点击与快捷键", () => {
    renderCardList({ onReorder: vi.fn() });
    const card = screen.getByRole("button", { name: "a" });

    expect(card.getAttribute("aria-keyshortcuts")).toBeNull();
    fireEvent.click(card, { clientX: 10, clientY: 10 });
    expect(screen.getAllByRole("listitem")).toHaveLength(IDS.length);
  });
});
