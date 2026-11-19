import { describe, expect, it } from "vitest";
import type { ParsedNode } from "@subboost/core/types/node";
import {
  applyNodeRenames,
  collectNodeSummaries,
  countRenamedNodes,
  hashNodeKey,
  isRenameKey,
  nodeRenameKey,
  protocolBreakdown,
  sanitizeNodeRenames,
  toNodeSummary,
  resolveNodeNames,
} from "./node-renames";
import { MAX_NODE_RENAMES } from "./types";

function ssNode(name: string, overrides: Record<string, unknown> = {}): ParsedNode {
  return {
    name,
    type: "ss",
    server: "example.com",
    port: 8388,
    cipher: "aes-256-gcm",
    password: "secret",
    ...overrides,
  } as unknown as ParsedNode;
}

describe("node rename keys", () => {
  it("produces a stable 16-char hex key", () => {
    const key = hashNodeKey("hello");
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(hashNodeKey("hello")).toBe(key);
    expect(hashNodeKey("hellp")).not.toBe(key);
    expect(isRenameKey(key)).toBe(true);
    expect(isRenameKey("not-a-key")).toBe(false);
  });

  it("ignores the node name but tracks identity fields", () => {
    const a = nodeRenameKey(ssNode("香港 01"));
    const b = nodeRenameKey(ssNode("香港 01 改名"));
    expect(b).toBe(a);

    expect(nodeRenameKey(ssNode("香港 01", { server: "other.example.com" }))).not.toBe(a);
    expect(nodeRenameKey(ssNode("香港 01", { port: 443 }))).not.toBe(a);
  });
});

describe("applyNodeRenames", () => {
  it("returns the original node when nothing is mapped", () => {
    const node = ssNode("原名");
    expect(applyNodeRenames(node)).toBe(node);
    expect(applyNodeRenames(node, {})).toBe(node);
    expect(applyNodeRenames(node, { "0000000000000000": "别的名字" })).toBe(node);
  });

  it("overrides the display name without touching other fields", () => {
    const node = ssNode("原名");
    const renames = { [nodeRenameKey(node)]: "🇭🇰 香港 IPLC" };
    const renamed = applyNodeRenames(node, renames);
    expect(renamed).not.toBe(node);
    expect(renamed.name).toBe("🇭🇰 香港 IPLC");
    expect(renamed.server).toBe(node.server);
    expect(renamed.port).toBe(node.port);
    expect(renamed.type).toBe("ss");
  });

  it("ignores a rename that equals the current name", () => {
    const node = ssNode("同名");
    expect(applyNodeRenames(node, { [nodeRenameKey(node)]: "同名" })).toBe(node);
  });
});

describe("node summaries", () => {
  it("reports origin name, protocol and rename state", () => {
    const node = ssNode("香港 01");
    const summary = toNodeSummary(node, { [nodeRenameKey(node)]: "HK-01" });
    expect(summary).toMatchObject({
      key: nodeRenameKey(node),
      name: "HK-01",
      originName: "香港 01",
      type: "ss",
      server: "example.com",
      port: 8388,
      renamed: true,
    });
  });

  it("keeps summaries unchanged when no rename applies", () => {
    const [summary] = collectNodeSummaries([ssNode("东京 02")]);
    expect(summary).toMatchObject({ name: "东京 02", originName: "东京 02", renamed: false });
    expect(summary.renamed).toBe(false);
  });

  it("limits the number of returned summaries", () => {
    const nodes = Array.from({ length: 5 }, (_, index) => ssNode(`n${index}`, { port: 8000 + index }));
    expect(collectNodeSummaries(nodes, undefined, undefined, undefined, 2)).toHaveLength(2);
  });

  it("counts renamed nodes and ignores identity mismatches", () => {
    const a = ssNode("A");
    const b = ssNode("B", { port: 9000 });
    const renames = { [nodeRenameKey(a)]: "A2", [nodeRenameKey(b)]: "B" };
    expect(countRenamedNodes([a, b], renames)).toBe(1);
    expect(countRenamedNodes([a, b])).toBe(0);
  });
});

describe("sanitizeNodeRenames", () => {
  it("drops invalid keys, empty names and over-long names", () => {
    const key = nodeRenameKey(ssNode("A"));
    const other = nodeRenameKey(ssNode("B", { port: 9000 }));
    const result = sanitizeNodeRenames({
      [key]: "  新名字  ",
      [other]: "   ",
      "not-a-key": "x",
      [nodeRenameKey(ssNode("C", { port: 9100 }))]: "x".repeat(121),
    });
    expect(result).toEqual({ [key]: "新名字" });
  });

  it("returns undefined for non-object input and empty results", () => {
    expect(sanitizeNodeRenames(null)).toBeUndefined();
    expect(sanitizeNodeRenames([])).toBeUndefined();
    expect(sanitizeNodeRenames({})).toBeUndefined();
    expect(sanitizeNodeRenames({ "not-a-key": "x" })).toBeUndefined();
  });

  it("caps the number of stored renames", () => {
    const input: Record<string, string> = {};
    for (let index = 0; index < MAX_NODE_RENAMES + 10; index += 1) {
      input[index.toString(16).padStart(16, "0")] = `node-${index}`;
    }
    expect(Object.keys(sanitizeNodeRenames(input) ?? {})).toHaveLength(MAX_NODE_RENAMES);
  });
});

describe("protocolBreakdown", () => {
  it("counts protocols and sorts by count then name", () => {
    const nodes = [
      ssNode("a"),
      ssNode("b", { port: 9001 }),
      { ...ssNode("c"), type: "vless" } as unknown as ParsedNode,
      { ...ssNode("d", { port: 9002 }), type: "vless" } as unknown as ParsedNode,
      { ...ssNode("e"), type: "trojan" } as unknown as ParsedNode,
    ];
    expect(protocolBreakdown(nodes)).toEqual([
      { type: "ss", count: 2 },
      { type: "vless", count: 2 },
      { type: "trojan", count: 1 },
    ]);
  });

  it("returns an empty list for no nodes", () => {
    expect(protocolBreakdown([])).toEqual([]);
  });
});

describe("resolveNodeNames / 命名模板", () => {
  const template = "{protocol}-{port} {name}";

  it("applies the template when there are no manual renames", () => {
    const node = { ...ssNode("香港 01"), type: "vless" } as unknown as ParsedNode;
    const resolved = resolveNodeNames([node], undefined, template);
    expect(resolved.get(nodeRenameKey(node))).toEqual({
      name: "vless-8388 香港 01",
      source: "template",
    });
  });

  it("lets a manual rename win over the template", () => {
    const node = { ...ssNode("香港 01"), type: "vless" } as unknown as ParsedNode;
    const resolved = resolveNodeNames([node], { [nodeRenameKey(node)]: "我起的名" }, template);
    expect(resolved.get(nodeRenameKey(node))).toEqual({ name: "我起的名", source: "manual" });
  });

  it("keeps template output from colliding with a manual name", () => {
    const a = { ...ssNode("A"), type: "vless" } as unknown as ParsedNode;
    const b = { ...ssNode("B", { port: 9001 }), type: "vless" } as unknown as ParsedNode;
    const resolved = resolveNodeNames([a, b], { [nodeRenameKey(a)]: "vless" }, "{protocol}");
    expect(resolved.get(nodeRenameKey(a))).toEqual({ name: "vless", source: "manual" });
    expect(resolved.get(nodeRenameKey(b))).toEqual({ name: "vless (2)", source: "template" });
  });

  it("ignores a template that renders the original name", () => {
    const node = ssNode("香港 01");
    // `{name}` 只回填原名，结果与原名相同，不该算作已改名
    expect(resolveNodeNames([node], undefined, "{name}").size).toBe(0);
  });

  it("exposes the rename source in node summaries", () => {
    const node = { ...ssNode("香港 01"), type: "vless" } as unknown as ParsedNode;
    const summary = toNodeSummary(node, undefined, template);
    expect(summary).toMatchObject({
      name: "vless-8388 香港 01",
      originName: "香港 01",
      renamed: true,
      renameSource: "template",
    });
  });

  it("counts template renames in countRenamedNodes", () => {
    const node = { ...ssNode("香港 01"), type: "vless" } as unknown as ParsedNode;
    expect(countRenamedNodes([node], undefined, template)).toBe(1);
  });
});
