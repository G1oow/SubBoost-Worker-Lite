import { describe, expect, it } from "vitest";
import {
  buildCnRuleCandidatesFromSources,
  buildCnRuleVariantIds,
  buildLocalCnRuleCandidates,
  collectCnCandidateParents,
  normalizeRuleListLines,
  type CnRuleCandidateSource,
} from "./cn-candidate-utils";

describe("CN candidate utils", () => {
  it("builds stable CN variant ids from regular and negated parent ids", () => {
    expect(buildCnRuleVariantIds("")).toEqual([]);
    expect(buildCnRuleVariantIds("-!cn").map((item) => item.id)).toEqual([
      "-!cn-cn",
      "-!cn@cn",
      "-!cn-cn@cn",
    ]);
    expect(buildCnRuleVariantIds(" streaming ")).toEqual([
      { id: "streaming-cn", variantKind: "dash-cn" },
      { id: "streaming@cn", variantKind: "at-cn" },
      { id: "streaming-cn@cn", variantKind: "dash-cn-at-cn" },
    ]);
    expect(buildCnRuleVariantIds("streaming-!cn").map((item) => item.id)).toEqual([
      "streaming-!cn-cn",
      "streaming-!cn@cn",
      "streaming-!cn-cn@cn",
      "streaming-cn",
      "streaming@cn",
      "streaming-cn@cn",
    ]);
  });

  it("collects no parent rules because builtin rules are literal instead of rule sets", () => {
    expect(collectCnCandidateParents([], { defaultToAll: false })).toEqual([]);
    expect(collectCnCandidateParents([" select ", " "])).toEqual([]);

    // 内置规则改成了字面量（DOMAIN / PROCESS / GEOSITE），没有任何带 behavior/path 的 mrs 规则集，
    // 所以「按分组开关收集父规则」不再有输入
    expect(collectCnCandidateParents([], { defaultToAll: true })).toEqual([]);
    // core 分组永远跳过；非 core 的 steam 也没有规则集规则
    expect(collectCnCandidateParents(["select", "auto", "cn", "steam"])).toEqual([]);
    // 排除参数仍然接受规则键，只是已没有可被排除的父规则
    expect(
      collectCnCandidateParents(["steam"], { excludedRuleKeys: ["steam:geosite-steam"] })
    ).toEqual([]);
  });

  it("normalizes rule list content before duplicate and coverage checks", () => {
    expect(normalizeRuleListLines([" DOMAIN,a.com ", "", "# comment", "DOMAIN,a.com", null as never])).toEqual([
      "DOMAIN,a.com",
    ]);

    const sources: CnRuleCandidateSource[] = [
      {
        id: " alpha-cn ",
        variantKind: "dash-cn",
        parentModuleId: "media",
        parentRuleId: "alpha",
        lines: ["DOMAIN,a.com", "DOMAIN,a.com"],
      },
      {
        id: "alpha@cn",
        variantKind: "at-cn",
        parentModuleId: "media",
        parentRuleId: "alpha",
        lines: ["DOMAIN,a.com"],
      },
      {
        id: "geo-cn",
        variantKind: "dash-cn",
        parentModuleId: "media",
        parentRuleId: "geo",
        lines: ["DOMAIN,geo.example"],
      },
      {
        id: "empty-cn",
        variantKind: "dash-cn",
        parentModuleId: "media",
        parentRuleId: "empty",
        lines: ["", "# comment"],
      },
      {
        id: " ",
        variantKind: "dash-cn",
        parentModuleId: "media",
        parentRuleId: "skip",
        lines: ["DOMAIN,skip.example"],
      },
    ];

    const candidates = buildCnRuleCandidatesFromSources(sources, ["DOMAIN,geo.example"]);
    const alpha = candidates.find((candidate) => candidate.id === "alpha-cn");
    const alphaDuplicate = candidates.find((candidate) => candidate.id === "alpha@cn");
    const geo = candidates.find((candidate) => candidate.id === "geo-cn");
    const empty = candidates.find((candidate) => candidate.id === "empty-cn");

    expect(candidates.map((candidate) => candidate.id)).toEqual(["alpha-cn", "alpha@cn", "empty-cn", "geo-cn"]);
    expect(alpha).toMatchObject({ canonicalId: "alpha-cn", actionable: true });
    expect(alphaDuplicate).toMatchObject({ canonicalId: "alpha-cn", duplicateOf: "alpha-cn", actionable: false });
    expect(geo).toMatchObject({ coveredByGeolocationCn: true, actionable: false });
    expect(empty).toMatchObject({ empty: true, actionable: false });
  });

  it("uses variant priority and lexical order when duplicate signatures compete", () => {
    const candidates = buildCnRuleCandidatesFromSources(
      [
        {
          id: "z-cn-b",
          variantKind: "dash-cn",
          parentModuleId: "z-module",
          parentRuleId: "z-parent",
          lines: ["DOMAIN,z.example"],
        },
        {
          id: "z-cn-a",
          variantKind: "dash-cn",
          parentModuleId: "z-module",
          parentRuleId: "z-parent",
          lines: ["DOMAIN,z.example"],
        },
        {
          id: "z@cn",
          variantKind: "at-cn",
          parentModuleId: "z-module",
          parentRuleId: "z-parent",
          lines: ["DOMAIN,z.example"],
        },
        {
          id: "a-cn",
          variantKind: "dash-cn",
          parentModuleId: "a-module",
          parentRuleId: "a-parent",
          lines: ["DOMAIN,a.example"],
        },
        {
          id: "b-cn",
          variantKind: "dash-cn",
          parentModuleId: "a-module",
          parentRuleId: "b-parent",
          lines: ["DOMAIN,b.example"],
        },
      ],
      [" ", "# comment"]
    );

    expect(candidates.map((candidate) => candidate.id)).toEqual(["a-cn", "b-cn", "z-cn-a", "z-cn-b", "z@cn"]);
    expect(candidates.find((candidate) => candidate.id === "z-cn-a")).toMatchObject({
      canonicalId: "z-cn-a",
      actionable: true,
    });
    expect(candidates.find((candidate) => candidate.id === "z-cn-b")).toMatchObject({
      canonicalId: "z-cn-a",
      duplicateOf: "z-cn-a",
      actionable: false,
    });
    expect(candidates.find((candidate) => candidate.id === "z@cn")).toMatchObject({
      canonicalId: "z-cn-a",
      duplicateOf: "z-cn-a",
      actionable: false,
    });
  });

  it("builds no local candidates because builtin rule sets were replaced by literal rules", () => {
    const parents = collectCnCandidateParents([], { defaultToAll: true });
    expect(parents).toEqual([]);

    expect(buildLocalCnRuleCandidates({ moduleIds: ["steam"] })).toEqual([]);
    expect(
      buildLocalCnRuleCandidates({
        moduleIds: ["steam"],
        excludedRuleKeys: ["steam:geosite-steam"],
      })
    ).toEqual([]);
    // 已删除的分组 id 同样不产生候选
    expect(buildLocalCnRuleCandidates({ moduleIds: ["google", "apple"] })).toEqual([]);
  });
});
