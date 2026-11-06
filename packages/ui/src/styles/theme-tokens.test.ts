import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const themeCss = readFileSync(join(__dirname, "theme.css"), "utf8");

/**
 * 把 `:root, [data-theme="dark"] { ... }` 与 `[data-theme="light"] { ... }`
 * 两个块里的自定义属性名都抽出来，用于对等性比较。
 */
function blockNames(startPattern: RegExp): Set<string> {
  const start = themeCss.search(startPattern);
  if (start < 0) return new Set();
  const from = themeCss.indexOf("{", start);
  let depth = 0;
  let end = from;
  for (let i = from; i < themeCss.length; i += 1) {
    if (themeCss[i] === "{") depth += 1;
    else if (themeCss[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = themeCss.slice(from, end);
  // 只看 `--name: value;` 形式的定义，注释与嵌套规则里的也会命中，但名字是唯一的
  return new Set([...body.matchAll(/(--[\w-]+)\s*:/gu)].map((match) => match[1]));
}

const darkNames = blockNames(/:root,\s*\n\s*\[data-theme="dark"\]/u);
const lightNames = blockNames(/\[data-theme="light"\]/u);
const themeBlockNames = blockNames(/@theme inline/u);

describe("theme token parity", () => {
  it("parses both theme blocks instead of silently matching nothing", () => {
    // 正则若与写法漂移，后面的对等性断言会变成空跑的假绿
    expect(darkNames.size).toBeGreaterThan(50);
    expect(lightNames.size).toBeGreaterThan(50);
    expect(themeBlockNames.size).toBeGreaterThan(50);
  });

  /**
   * 浅色块定义、深色块漏定义，会让 `bg-surface-raised` 这类工具类在深色下
   * 解析成空值 —— 元素背景直接消失（下拉菜单透明、卡片透出底图）。
   * 这类缺失不会报错、不会构建失败，只在切到深色时看得见，所以必须靠测试守住。
   */
  it("defines every light-theme token in the dark block too", () => {
    const missing = [...lightNames].filter((name) => !darkNames.has(name));
    expect(missing).toEqual([]);
  });

  /**
   * 反方向不需要强制对等：深色块里的 `--glow-*` 等装饰令牌在浅色主题下
   * 沿用 `:root` 的继承值即可，不算缺陷。真正会掉背景的是「浅色块定义了、
   * 深色块漏了」——上面那条已经守住。
   */
  it("keeps inherited-only tokens out of the light block requirement", () => {
    const darkOnly = [...darkNames].filter((name) => !lightNames.has(name));
    // 允许存在，但必须是我们已知的装饰类令牌，避免将来漏掉语义令牌也当成"可继承"
    expect(darkOnly.sort()).toEqual(["--glow-indigo", "--glow-primary"]);
  });

  /**
   * `@theme inline` 把语义令牌映射成 Tailwind 工具类。
   * 映射的目标变量若在两套主题里都没定义，工具类同样会解析成空值。
   */
  it("maps every @theme inline color to a token that both themes define", () => {
    const targets = [...themeCss.matchAll(/--color-[\w-]+:\s*var\((--[\w-]+)\)/gu)].map(
      (match) => match[1]
    );
    expect(targets.length).toBeGreaterThan(20);
    const undefinedTargets = [...new Set(targets)].filter(
      (name) => !darkNames.has(name) || !lightNames.has(name)
    );
    expect(undefinedTargets).toEqual([]);
  });

  it("keeps the raised and popover surfaces opaque enough for a dropdown", () => {
    // 下拉菜单直接用它做背景：没有明确值就等于透明浮层
    expect(darkNames.has("--surface-raised")).toBe(true);
    expect(darkNames.has("--surface-popover")).toBe(true);
  });

  /**
   * 前景刻度只留六档。浅色主题里 35/40/45/50 曾映射到同一个色值，
   * 结果同一层级的说明文字在不同页面深浅不一；把这些中间档重新加回来
   * 等于把分叉重新引进来。
   */
  it("keeps the foreground scale at exactly six steps", () => {
    const steps = [...themeCss.matchAll(/--color-fg(-[\w-]+)?:\s*var\(/gu)]
      .map((match) => match[1]?.slice(1) ?? "base")
      .sort();
    expect(steps).toEqual(["35", "45", "60", "70", "80", "base"]);
  });

  /**
   * 状态提示是「前景 + 底色 + 描边」成组的令牌。少任何一个，组件就只能
   * 回退到手拼调色板，浅色主题下的对比度又会分叉。
   */
  it("defines the full warning/danger/success note token triplets", () => {
    for (const tone of ["warning", "danger", "success"]) {
      for (const part of ["fg", "bg", "border"]) {
        const name = `--${tone}-note-${part}`;
        expect(darkNames.has(name), `深色块缺 ${name}`).toBe(true);
        expect(lightNames.has(name), `浅色块缺 ${name}`).toBe(true);
        expect(themeBlockNames.has(`--color-${tone}-note-${part}`), `@theme inline 缺 ${name}`).toBe(true);
      }
    }
  });
});

describe("opaque chrome", () => {
  /**
   * 页头与移动端底栏是全站唯一的常驻色块，必须是实心色：
   * 一旦带上 alpha，滚动时内容会从它下面透出来，深色下明显发灰发脏，
   * 而且只能靠 backdrop-blur 补救 —— 那条路已经在 globals.css 里被禁掉了。
   */
  it("keeps the header bar fully opaque in both themes", () => {
    const values = [...themeCss.matchAll(/--header-bg:\s*([^;]+);/gu)].map((match) => match[1].trim());
    // 深色与浅色各一处
    expect(values).toHaveLength(2);
    for (const value of values) {
      expect(value, `--header-bg 不得带 alpha：${value}`).not.toMatch(
        /transparent|rgba?\(|color-mix\(/iu
      );
      // 只接受实心十六进制色值
      expect(value).toMatch(/^#(?:[\da-f]{3}|[\da-f]{6})$/iu);
    }
  });
});
