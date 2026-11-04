import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(join(__dirname, "globals.css"), "utf8");

/** 动画工具类：--animate-<name>: <keyframes 名> ... */
const ANIMATE_TOKENS = /--animate-([\w-]+):\s*([\w-]+)\s/gu;
/** @keyframes 定义 */
const KEYFRAME_BLOCKS = /@keyframes\s+([\w-]+)\s*\{/gu;

const tokenKeyframes = new Map(
  [...globalsCss.matchAll(ANIMATE_TOKENS)].map((match) => [match[1], match[2]])
);
const keyframeNames = new Set([...globalsCss.matchAll(KEYFRAME_BLOCKS)].map((match) => match[1]));

/** 覆盖层 / 弹窗 / 下拉 / Toast 的进出场：Radix Presence 靠退出动画决定何时卸载 */
const OVERLAY_MOTION = {
  "overlay-in": "overlayIn",
  "overlay-out": "overlayOut",
  "modal-in": "modalIn",
  "modal-out": "modalOut",
  "menu-in": "menuIn",
  "menu-out": "menuOut",
  "toast-in": "toastIn",
  "toast-out": "toastOut",
  "toast-progress": "toastProgress",
  "icon-pop": "iconPop",
} as const;

/**
 * 承载文字的入场关键帧：只允许 `opacity`。
 *
 * translate / scale / transform 都会把元素提升为独立合成层：Chrome 只栅格化一次
 * 纹理，随后按**非整数设备像素**逐帧平移，插值采样把整块内容糊掉 ——
 * 文字边缘发虚、卡片阴影的柔和过渡被抹平（看起来像"动画期间没渲染阴影"）。
 * 这条断言是防止有人为了"更有动感"再把位移加回来。
 */
const OPACITY_ONLY_KEYFRAMES = [
  "fadeIn",
  "slideUp",
  "pageIn",
  "rise",
  "popIn",
  "fadeInUp",
  "settleIn",
  "modalIn",
  "modalOut",
  "menuIn",
  "menuOut",
  "toastIn",
  "toastOut",
];

function keyframeBody(name: string): string {
  const start = globalsCss.indexOf(`@keyframes ${name}`);
  if (start < 0) return "";
  // 从声明的 { 起做一次大括号配平，避免正则截断嵌套规则
  let depth = 0;
  let i = globalsCss.indexOf("{", start);
  const from = i;
  for (; i < globalsCss.length; i += 1) {
    if (globalsCss[i] === "{") depth += 1;
    else if (globalsCss[i] === "}") {
      depth -= 1;
      if (depth === 0) return globalsCss.slice(from, i + 1);
    }
  }
  return "";
}

describe("motion tokens", () => {
  it("parses the stylesheet instead of silently matching nothing", () => {
    // 正则若与写法漂移，下面几条会变成空跑的假绿
    expect(tokenKeyframes.size).toBeGreaterThan(10);
    expect(keyframeNames.size).toBeGreaterThan(10);
  });

  it("points every motion token at its keyframes", () => {
    for (const [token, keyframes] of Object.entries(OVERLAY_MOTION)) {
      expect(tokenKeyframes.get(token)).toBe(keyframes);
    }
  });

  it("defines keyframes for every motion token", () => {
    const missing = Object.values(OVERLAY_MOTION).filter((name) => !keyframeNames.has(name));
    expect(missing).toEqual([]);
  });

  it("keeps entering/exiting pairs that Radix Presence can detect", () => {
    // 缺一个退出动画 → Radix 立即卸载 → 用户看到的仍是硬切
    for (const token of Object.keys(OVERLAY_MOTION)) {
      expect(tokenKeyframes.has(token)).toBe(true);
    }
    expect(tokenKeyframes.get("modal-out")).toBe("modalOut");
    expect(tokenKeyframes.get("menu-out")).toBe("menuOut");
    expect(tokenKeyframes.get("toast-out")).toBe("toastOut");
  });
});

describe("text rasterization", () => {
  it("keeps every text-bearing entrance keyframes on opacity alone", () => {
    // 只要出现 translate / scale / transform，元素就会被提升为合成层并按
    // 非整数设备像素平移，整块纹理被插值采样：文字发虚、阴影被抹平。
    for (const name of OPACITY_ONLY_KEYFRAMES) {
      const body = keyframeBody(name);
      expect(body, `@keyframes ${name} 未找到`).not.toBe("");
      expect(body, `@keyframes ${name} 不得使用 transform`).not.toMatch(
        /(^|[^-\w])transform\s*:/u
      );
      expect(body, `@keyframes ${name} 不得使用 translate`).not.toMatch(
        /(^|[^-\w])translate\s*:/u
      );
      expect(body, `@keyframes ${name} 不得使用 scale`).not.toMatch(/(^|[^-\w])scale\s*:/u);
      // 正向要求：确实驱动了透明度，否则动画会变成"什么也没发生"
      expect(body, `@keyframes ${name} 必须驱动 opacity`).toMatch(/opacity\s*:/u);
    }
  });

  it("still allows scale on the tiny icon keyframe", () => {
    // 16px 的图标没有可读文字，缩放不会造成"文字发虚"，
    // 而弹一下的反馈需要缩放来表达。这条断言防止为了统一而误删它。
    expect(keyframeBody("iconPop")).toMatch(/scale\s*:/u);
  });

  it("keeps the decorative bar keyframes off the text path", () => {
    // 占比条与 Toast 进度条都是纯色块，没有文字，用 scaleX 走合成线程最便宜
    expect(keyframeBody("barGrow")).toMatch(/transform\s*:\s*scaleX/u);
    expect(keyframeBody("toastProgress")).toMatch(/scale\s*:/u);
  });
});

describe("no overshoot", () => {
  /**
   * 带过冲的缓动（cubic-bezier 的 y 值 > 1）会让元素越过目标值再弹回来，
   * 观感就是"动画结束后被强制归位"。进场类动效一律用 y ≤ 1 的曲线，
   * 保证最后一帧精确落在终值上。
   */
  it("keeps entering animation easings from overshooting", () => {
    const tokens = [...globalsCss.matchAll(/--animate-([\w-]+):\s*[\w-]+\s+[\d.]+m?s\s+cubic-bezier\(([^)]+)\)/gu)];
    expect(tokens.length).toBeGreaterThan(0);
    for (const [, token, values] of tokens) {
      const points = values.split(",").map((value) => Number.parseFloat(value.trim()));
      // cubic-bezier(x1, y1, x2, y2)：y1 / y2 决定是否越过终值
      const [, y1, , y2] = points;
      expect(y1, `--animate-${token} 的 y1 不得 > 1（会过冲）`).toBeLessThanOrEqual(1);
      expect(y2, `--animate-${token} 的 y2 不得 > 1（会过冲）`).toBeLessThanOrEqual(1);
    }
  });
});

describe("scroll container overflow", () => {
  /**
   * 入场不再做位移，因此不存在"向下偏移被计入 scrollHeight、动画期间冒出滚动条"
   * 的问题：滚动容器内外共用同一套纯淡入。这里守住这个前提，
   * 否则有人把 y 位移加回 settleIn，滚动条问题会跟着回来。
   */
  it("keeps the in-scroller entrance free of any offset", () => {
    const body = keyframeBody("settleIn");
    expect(body, "@keyframes settleIn 未找到").not.toBe("");
    expect(body).not.toMatch(/translate\s*:/u);
    expect(body).not.toMatch(/translate[XY]?\(/u);
  });

  it("points the settle-in token at that keyframes", () => {
    expect(tokenKeyframes.get("settle-in")).toBe("settleIn");
  });
});

describe("positioning vs. animation property conflicts", () => {
  /**
   * Tailwind v4 的 translate-x/y-* 写的是独立的 translate 属性。
   * 关键帧里再写 translate 会与它互相覆盖：动画期间定位被吞掉，
   * 元素从错位处飞入、结束再跳回，表现为「动画错位」。
   * 现在关键帧只用 opacity，冲突根源已移除，但定位写法仍要保持干净。
   */
  it("keeps dialog content free of translate utilities", () => {
    const dialogSource = readFileSync(join(__dirname, "../components/ui/dialog.tsx"), "utf8");
    // 居中改由 grid 容器承担，内容元素上不应再有 translate-x/y 工具类
    expect(dialogSource).not.toMatch(/translate-[xy]-\[?-?[0-9]/u);
    // 关键帧不得再用 translate，避免与定位争同一个属性
    expect(keyframeBody("modalIn")).not.toMatch(/translate\s*:/u);
  });

  it("keeps select offsets on margin instead of translate", () => {
    const selectSource = readFileSync(join(__dirname, "../components/ui/select.tsx"), "utf8");
    // 与触发器的间距用 margin，不能再用 translate-y-*
    expect(selectSource).not.toMatch(/(?:^|["\s])translate-[xy]-1/u);
    expect(selectSource).toMatch(/data-\[side=bottom\]:mt-1/u);
    expect(keyframeBody("menuIn")).not.toMatch(/translate\s*:/u);
  });
});

describe("reduced motion", () => {
  it("keeps the escape hatch", () => {
    expect(globalsCss).toContain("@media (prefers-reduced-motion: reduce)");
  });
});

describe("compositing discipline", () => {
  /**
   * 不透明面板上叠 backdrop-blur 是纯成本：模糊看不出效果，
   * 却要在出入场动画期间每帧对整块背景重算一次。曾经的 .glass-card 就是这种写法，
   * 直接后果是 Toast / 卡片在动画中"发虚 + 震颤"。
   */
  it("keeps background blur off opaque surfaces in the stylesheet", () => {
    expect(globalsCss).not.toMatch(/\.glass-card\b/u);
    expect(globalsCss).not.toMatch(/backdrop-blur/u);
  });

  /**
   * hover 的层次感交给边框与背景色；大范围模糊阴影若进了 transition，
   * 每次悬停都要逐帧重算整块阴影，观感就是卡片在"喘"。
   */
  it("does not transition shadows or transform on hover-lift", () => {
    const block = (selector: string) => {
      const matched = new RegExp(`${selector}\\s*\\{([^}]*)\\}`, "u").exec(globalsCss);
      expect(matched, `${selector} 未找到`).not.toBeNull();
      return matched?.[1] ?? "";
    };

    const lift = block("\\.hover-lift");
    // 悬停位移用独立的 translate 属性，不用 transform
    expect(lift).not.toMatch(/(^|[^-\w])transform\s*:/u);
    expect(lift).not.toMatch(/box-shadow/u);
    expect(lift).toContain("translate");

    const liftHover = block("\\.hover-lift:hover");
    expect(liftHover).toMatch(/translate:\s*0\s*-?[\d.]+px/u);
    expect(liftHover).not.toMatch(/(^|[^-\w])transform\s*:/u);
  });

  /** 卡片本身也不许把阴影放进过渡：0 12px 32px 这类模糊每帧重算代价极高 */
  it("keeps card surfaces from transitioning their shadow", () => {
    const cards = [
      join(__dirname, "../components/ui/card.tsx"),
      join(__dirname, "../motion/spotlight-card.tsx"),
    ];
    for (const file of cards) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} 仍在过渡 box-shadow`).not.toContain(
        "transition-[border-color,box-shadow]"
      );
      expect(source, `${file} 仍有 hover 阴影放大`).not.toContain(
        "hover:shadow-(--card-shadow-hover)"
      );
    }
  });
});

describe("FLIP layout semantics", () => {
  /**
   * 布尔 layout 会让 Motion 用 scaleX/scaleY 模拟宽高变化，
   * 行内文字随之被压扁 —— 这是列表项"文字抖动"的来源。
   * 必须写成 layout="position"（只插值位置）。
   */
  it("keeps list items on position-only layout", () => {
    const source = readFileSync(join(__dirname, "../motion/motion-list.tsx"), "utf8");
    expect(source).toMatch(/layout=\{layout \? "position" : false\}/u);
    expect(source).not.toMatch(/layout=\{layout\}/u);
  });
});
