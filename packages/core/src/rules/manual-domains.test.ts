import { describe, expect, it } from "vitest";
import {
  buildManualDomainRuleTexts,
  buildManualProcessRuleTexts,
  normalizeManualDomain,
  normalizeManualDomainList,
  normalizeManualProcessList,
} from "./manual-domains";

const targets = { direct: "国内直连", proxy: "节点选择", reject: "广告拦截" };

describe("normalizeManualDomain", () => {
  it("把通配符、URL、端口、结尾点归一化成裸域名", () => {
    expect(normalizeManualDomain(" *.Example.com ")).toBe("example.com");
    expect(normalizeManualDomain(".example.com")).toBe("example.com");
    expect(normalizeManualDomain("https://example.com/path?x=1#h")).toBe("example.com");
    expect(normalizeManualDomain("user:pass@example.com:8443")).toBe("example.com");
    expect(normalizeManualDomain("example.com.")).toBe("example.com");
    expect(normalizeManualDomain("sub.example.com")).toBe("sub.example.com");
  });

  it("无法用域名规则表达的值返回 null", () => {
    expect(normalizeManualDomain("a.*.com")).toBeNull();
    expect(normalizeManualDomain("")).toBeNull();
    expect(normalizeManualDomain("   ")).toBeNull();
    expect(normalizeManualDomain("exa mple.com")).toBeNull();
  });

  it("清单归一化保持顺序并去重", () => {
    expect(normalizeManualDomainList(["*.a.com", "A.com", "b.com", "a.*.com"])).toEqual([
      "a.com",
      "b.com",
    ]);
    expect(normalizeManualDomainList(undefined)).toEqual([]);
    expect(normalizeManualDomainList("not-an-array")).toEqual([]);
  });
});

describe("buildManualDomainRuleTexts", () => {
  it("三份清单各自指向自己的分组", () => {
    const { texts, dropped } = buildManualDomainRuleTexts(
      { direct: ["cdn.example.com"], proxy: ["api.example.org"], reject: ["ads.example.net"] },
      targets
    );
    expect(texts).toEqual([
      "DOMAIN-SUFFIX,cdn.example.com,国内直连",
      "DOMAIN-SUFFIX,api.example.org,节点选择",
      "DOMAIN-SUFFIX,ads.example.net,广告拦截",
    ]);
    expect(dropped).toEqual([]);
  });

  it("IP 字面量转 /32 CIDR 并带 no-resolve", () => {
    const { texts } = buildManualDomainRuleTexts({ direct: [], proxy: ["192.0.2.10"], reject: [] }, targets);
    expect(texts).toEqual(["IP-CIDR,192.0.2.10/32,节点选择,no-resolve"]);
  });

  it("更具体的域名排在前面", () => {
    const { texts } = buildManualDomainRuleTexts(
      { direct: [], proxy: ["example.com", "a.b.example.com", "b.example.com"], reject: [] },
      targets
    );
    expect(texts).toEqual([
      "DOMAIN-SUFFIX,a.b.example.com,节点选择",
      "DOMAIN-SUFFIX,b.example.com,节点选择",
      "DOMAIN-SUFFIX,example.com,节点选择",
    ]);
  });

  it("同一域名出现在多份清单时，拦截 > 代理 > 直连", () => {
    const { texts } = buildManualDomainRuleTexts(
      { direct: ["example.com"], proxy: ["example.com"], reject: ["example.com"] },
      targets
    );
    expect(texts).toEqual(["DOMAIN-SUFFIX,example.com,广告拦截"]);
  });

  it("归一化失败的值被丢弃并单独返回", () => {
    const { texts, dropped } = buildManualDomainRuleTexts(
      { direct: ["a.*.com"], proxy: [], reject: [] },
      targets
    );
    expect(texts).toEqual([]);
    expect(dropped).toEqual(["a.*.com"]);
  });
});

describe("手动进程规则", () => {
  it("进程名补成 PROCESS-NAME，含逗号的完整规则原样透传", () => {
    expect(buildManualProcessRuleTexts(["curl", "PROCESS-PATH-REGEX,(?i)leigod,DIRECT", " curl "])).toEqual([
      "PROCESS-NAME,curl,DIRECT",
      "PROCESS-PATH-REGEX,(?i)leigod,DIRECT",
    ]);
  });
});

describe("边界输入", () => {
  it("空值与空目标不会生成规则", () => {
    expect(normalizeManualDomain(null)).toBeNull();
    expect(normalizeManualDomain(undefined)).toBeNull();
    // 只有通配前缀时归一化后为空
    expect(normalizeManualDomain("*.")).toBeNull();
    expect(normalizeManualDomainList([null, 123, " "])).toEqual(["123"]);

    const { texts, dropped } = buildManualDomainRuleTexts(
      { direct: ["example.com"], proxy: ["example.org"], reject: ["example.net"] },
      { direct: "", proxy: "", reject: "" }
    );
    expect(texts).toEqual([]);
    expect(dropped).toEqual([]);
  });

  it("被丢弃的条目只记录非空原值", () => {
    const { dropped } = buildManualDomainRuleTexts(
      { direct: ["", "  ", "a.*.com"], proxy: [], reject: [] },
      targets
    );
    expect(dropped).toEqual(["a.*.com"]);
  });

  it("进程清单忽略空值并接受非字符串", () => {
    expect(normalizeManualProcessList([null, undefined, " ", "curl"])).toEqual(["curl"]);
    expect(normalizeManualProcessList(42)).toEqual([]);
  });
});

describe("清单目标缺失", () => {
  it("目标为空时整列跳过，不产生死规则", () => {
    const { texts } = buildManualDomainRuleTexts(
      { direct: ["example.com"], proxy: ["example.org"], reject: ["example.net"] },
      { direct: undefined as never, proxy: null as never, reject: "" }
    );
    expect(texts).toEqual([]);
  });

  it("null 条目既不生成规则也不进丢弃列表", () => {
    const { texts, dropped } = buildManualDomainRuleTexts(
      { direct: [null as never, "cdn.example.com"], proxy: [], reject: [] },
      targets
    );
    expect(texts).toEqual(["DOMAIN-SUFFIX,cdn.example.com,国内直连"]);
    expect(dropped).toEqual([]);
  });
});
