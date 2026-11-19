import { describe, expect, it } from "vitest";
import {
  applyNodeNameTemplate,
  extractNodeFlag,
  extractNodeIp,
  nodeNameTemplateValues,
  regionCodeToFlag,
  renderNodeNameTemplate,
  validateNodeNameTemplate,
} from "./node-name-template";

type Node = {
  name: string;
  type?: string;
  server?: string;
  port?: number | string;
};

function node(overrides: Partial<Node> = {}): Node {
  return {
    name: "香港 01",
    type: "vless",
    server: "198.51.100.10",
    port: 443,
    ...overrides,
  };
}

const keyOf = (value: Node) => value.name;

describe("extractNodeIp", () => {
  it("accepts IPv4 and IPv6 but not domains", () => {
    expect(extractNodeIp("198.51.100.10")).toBe("198.51.100.10");
    expect(extractNodeIp("2001:db8::1")).toBe("2001:db8::1");
    expect(extractNodeIp("::1")).toBe("::1");
    expect(extractNodeIp("[2001:db8::1]")).toBe("2001:db8::1");
    expect(extractNodeIp("example.org")).toBe("");
    expect(extractNodeIp("")).toBe("");
  });

  it("rejects out-of-range IPv4 octets", () => {
    expect(extractNodeIp("999.1.1.1")).toBe("");
  });

  it("rejects values that merely contain a colon", () => {
    expect(extractNodeIp("example.org:443")).toBe("");
  });
});

describe("nodeNameTemplateValues", () => {
  it("exposes the seven template variables", () => {
    expect(nodeNameTemplateValues(node(), "机场 A")).toEqual({
      name: "香港 01",
      protocol: "vless",
      ip: "198.51.100.10",
      server: "198.51.100.10",
      port: "443",
      sourceName: "机场 A",
      flag: "",
    });
  });
  it("leaves {ip} empty for a domain but keeps {server}", () => {
    const values = nodeNameTemplateValues(node({ server: "example.org" }));
    expect(values.ip).toBe("");
    expect(values.server).toBe("example.org");
  });

  it("stringifies numeric ports and drops non-numeric ones", () => {
    expect(nodeNameTemplateValues(node({ port: 8080 })).port).toBe("8080");
    expect(nodeNameTemplateValues(node({ port: "8443" })).port).toBe("8443");
    expect(nodeNameTemplateValues(node({ port: "http" })).port).toBe("");
    expect(nodeNameTemplateValues(node({ port: undefined })).port).toBe("");
  });
});

describe("renderNodeNameTemplate", () => {
  it("returns the origin name when the template is blank", () => {
    expect(renderNodeNameTemplate(node(), "")).toEqual({ name: "香港 01", missing: [], applied: false });
    expect(renderNodeNameTemplate(node(), undefined)).toEqual({
      name: "香港 01",
      missing: [],
      applied: false,
    });
  });

  it("substitutes every variable", () => {
    const result = renderNodeNameTemplate(
      node(),
      "{protocol}-{ip}:{port} {name} ({server})"
    );
    expect(result.name).toBe("vless-198.51.100.10:443 香港 01 (198.51.100.10)");
    expect(result.missing).toEqual([]);
    expect(result.applied).toBe(true);
  });

  it("reports variables that resolved to an empty value", () => {
    const result = renderNodeNameTemplate(node({ server: "example.org" }), "{ip} {name}");
    expect(result.name).toBe("香港 01");
    expect(result.missing).toEqual(["ip"]);
  });

  it("falls back to the origin name when everything renders empty", () => {
    const result = renderNodeNameTemplate({ name: "原名" }, "{ip}{port}{server}");
    expect(result.name).toBe("原名");
    expect(result.missing).toEqual(["ip", "port", "server"]);
    expect(result.applied).toBe(false);
  });

  it("treats a template equal to the origin name as unchanged", () => {
    const result = renderNodeNameTemplate(node(), "{name}");
    expect(result).toEqual({ name: "香港 01", missing: [], applied: false });
  });

  it("keeps unknown variables literal rather than dropping them", () => {
    // 校验会在保存前拦下未知变量；这里只保证求值不会把它们吞成空串
    expect(renderNodeNameTemplate(node(), "{protocl} {name}").name).toBe("{protocl} 香港 01");
  });

  it("clamps the rendered name to the node-name length limit", () => {
    const result = renderNodeNameTemplate(node({ name: "x".repeat(200) }), "{name}");
    expect(result.name).toHaveLength(120);
  });
});

describe("validateNodeNameTemplate", () => {
  it("treats blank input as not enabled", () => {
    expect(validateNodeNameTemplate(undefined)).toEqual({ ok: true });
    expect(validateNodeNameTemplate("   ")).toEqual({ ok: true });
  });

  it("trims and accepts a valid template", () => {
    expect(validateNodeNameTemplate("  {protocol} {name}  ")).toEqual({
      ok: true,
      template: "{protocol} {name}",
    });
  });

  it("rejects unknown variables and names the allowed ones", () => {
    const result = validateNodeNameTemplate("{protocol} {protocl}");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("{protocl}");
    expect(result.message).toContain("{protocol}");
  });

  it("rejects non-text and over-long templates", () => {
    expect(validateNodeNameTemplate(42).ok).toBe(false);
    expect(validateNodeNameTemplate("{name}".repeat(50)).ok).toBe(false);
  });
});

describe("applyNodeNameTemplate", () => {
  it("renames every node that the template changes", () => {
    const nodes = [node({ name: "A" }), node({ name: "B", port: 8443 })];
    const result = applyNodeNameTemplate(nodes, "{name}:{port}", keyOf);
    expect(result.nodes.map((item) => item.name)).toEqual(["A:443", "B:8443"]);
    expect(result.hitCount).toBe(2);
  });

  it("returns the input untouched when the template is blank", () => {
    const nodes = [node()];
    const result = applyNodeNameTemplate(nodes, undefined, keyOf);
    expect(result.nodes).toEqual(nodes);
    expect(result.hitCount).toBe(0);
  });

  it("adds a source-local suffix when the template produces duplicates", () => {
    const nodes = [node({ name: "A" }), node({ name: "B" })];
    const result = applyNodeNameTemplate(nodes, "{protocol}", keyOf);
    expect(result.nodes.map((item) => item.name)).toEqual(["vless", "vless (2)"]);
  });

  it("does not steal a name reserved by a manual rename", () => {
    const nodes = [node({ name: "A" }), node({ name: "B" })];
    const result = applyNodeNameTemplate(nodes, "{protocol}", keyOf, ["vless"]);
    expect(result.nodes.map((item) => item.name)).toEqual(["vless (2)", "vless (3)"]);
  });

  it("records before/after and missing variables per key", () => {
    const nodes = [node({ name: "A", server: "example.org" })];
    const result = applyNodeNameTemplate(nodes, "{ip}{name}", keyOf);
    expect(result.hits.get("A")).toEqual({
      before: "A",
      after: "A",
      missing: ["ip"],
      applied: false,
    });
  });
});

describe("extractNodeFlag", () => {
  it("prefers an existing flag emoji", () => {
    expect(extractNodeFlag("🇯🇵 东京 01")).toBe("🇯🇵");
    expect(extractNodeFlag("香港 01 🇭🇰")).toBe("🇭🇰");
  });

  it("converts a standalone two-letter region code to a flag", () => {
    expect(extractNodeFlag("JP 东京 01")).toBe("🇯🇵");
    expect(extractNodeFlag("HK-01")).toBe("🇭🇰");
    expect(extractNodeFlag("[US] 洛杉矶")).toBe("🇺🇸");
  });

  it("returns empty when neither a flag nor a code is present", () => {
    expect(extractNodeFlag("东京 01")).toBe("");
    expect(extractNodeFlag("")).toBe("");
  });

  it("maps both letters independently", () => {
    expect(regionCodeToFlag("jp")).toBe("🇯🇵");
    expect(regionCodeToFlag("A")).toBe("");
    expect(regionCodeToFlag("JPN")).toBe("");
  });
});

describe("{sourceName} 与 {flag}", () => {
  it("renders the source name passed in", () => {
    const result = renderNodeNameTemplate(node({ name: "JP 东京 01" }), "{sourceName} | {flag} | {name}", "机场 A");
    expect(result.name).toBe("机场 A | 🇯🇵 | JP 东京 01");
    expect(result.missing).toEqual([]);
  });

  it("marks both variables missing when no source name and no flag exist", () => {
    const result = renderNodeNameTemplate(node({ name: "东京 01" }), "{sourceName}{flag}{name}");
    expect(result.name).toBe("东京 01");
    expect(result.missing).toEqual(["sourceName", "flag"]);
  });

  it("accepts the camel-case variable written in any case", () => {
    expect(renderNodeNameTemplate(node(), "{sourcename}", "机场 A").name).toBe("机场 A");
    expect(renderNodeNameTemplate(node(), "{SourceName}", "机场 A").name).toBe("机场 A");
  });

  it("validates the two new variables and rejects typos", () => {
    expect(validateNodeNameTemplate("{sourceName} {flag}")).toEqual({
      ok: true,
      template: "{sourceName} {flag}",
    });
    expect(validateNodeNameTemplate("{flags}").ok).toBe(false);
  });

  it("passes the source name through applyNodeNameTemplate", () => {
    const nodes = [node({ name: "香港 01" })];
    const result = applyNodeNameTemplate(nodes, "{sourceName}-{name}", keyOf, [], "机场 A");
    expect(result.nodes[0].name).toBe("机场 A-香港 01");
  });
});
