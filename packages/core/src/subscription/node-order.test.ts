import { describe, expect, it } from "vitest";
import { nodeRenameKey } from "../node-rename-key";
import type { ParsedNode } from "../types/node";
import { MAX_NODE_ORDER_ENTRIES, applyNodeOrder, normalizeNodeOrder } from "./node-order";

function node(name: string, patch: Record<string, unknown> = {}): ParsedNode {
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

const KEY_A = "0".repeat(16);
const KEY_B = "f".repeat(16);

describe("normalizeNodeOrder", () => {
  it("keeps only rename keys, drops duplicates and non-string noise", () => {
    expect(
      normalizeNodeOrder([KEY_A, ` ${KEY_A} `, KEY_B, KEY_B, "not-a-key", 42, null, "", "ABCDEF0123456789"])
    ).toEqual([KEY_A, KEY_B]);
  });

  it("returns an empty list for non-array input", () => {
    expect(normalizeNodeOrder(undefined)).toEqual([]);
    expect(normalizeNodeOrder("abc")).toEqual([]);
    expect(normalizeNodeOrder({ 0: KEY_A })).toEqual([]);
  });

  it("caps the entry count", () => {
    const many = Array.from({ length: MAX_NODE_ORDER_ENTRIES + 10 }, (_, index) =>
      index.toString(16).padStart(16, "0")
    );
    expect(normalizeNodeOrder(many)).toHaveLength(MAX_NODE_ORDER_ENTRIES);
  });
});

describe("applyNodeOrder", () => {
  const a = node("A");
  const b = node("B", { port: 8389 });
  const c = node("C", { port: 8390 });
  const nodes = [a, b, c];

  it("puts ordered nodes first and appends the rest in their original order", () => {
    const next = applyNodeOrder(nodes, [nodeRenameKey(c), nodeRenameKey(a)]);
    expect(next.map((item) => item.name)).toEqual(["C", "A", "B"]);
  });

  it("keeps entries for missing nodes without disturbing anything", () => {
    const next = applyNodeOrder(nodes, [KEY_A, nodeRenameKey(b)]);
    expect(next.map((item) => item.name)).toEqual(["B", "A", "C"]);
  });

  it("returns the input untouched when no entry matches", () => {
    expect(applyNodeOrder(nodes, [KEY_A, KEY_B])).toBe(nodes);
    expect(applyNodeOrder(nodes, [])).toBe(nodes);
    expect(applyNodeOrder([], [KEY_A])).toEqual([]);
  });

  it("survives renamed nodes because the key ignores the display name", () => {
    const renamed = node("B 改名后", { port: 8389 });
    const next = applyNodeOrder([a, renamed, c], [nodeRenameKey(renamed)]);
    expect(next.map((item) => item.name)).toEqual(["B 改名后", "A", "C"]);
  });

  it("drops duplicated nodes sharing one key", () => {
    const twin = node("A2");
    const next = applyNodeOrder([a, twin, b], [nodeRenameKey(b), nodeRenameKey(a)]);
    expect(next.map((item) => item.name)).toEqual(["B", "A"]);
  });
});
