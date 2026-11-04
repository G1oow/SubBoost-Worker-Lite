import { describe, expect, it } from "vitest";
import { PINNED_HEADER_THRESHOLD, readScrollOffset, resolvePinnedHeader } from "./scroll-header";

/**
 * 吸顶判定的边界。
 *
 * 这些值决定了"已经在半页却显示未吸顶"或"来回滚动时在同一个位置闪烁"，
 * 只有真机手感和人眼才看得出，所以用断言钉住。
 */
describe("resolvePinnedHeader", () => {
  it("只在真正滚过阈值后才吸顶", () => {
    expect(resolvePinnedHeader(0)).toBe(false);
    expect(resolvePinnedHeader(PINNED_HEADER_THRESHOLD - 1)).toBe(false);
    // 正好停在阈值上不吸顶：>= 会让两个形态在同一个像素上互相踩
    expect(resolvePinnedHeader(PINNED_HEADER_THRESHOLD)).toBe(false);
    expect(resolvePinnedHeader(PINNED_HEADER_THRESHOLD + 1)).toBe(true);
  });

  it("把回弹产生的负偏移与异常值一律当成未吸顶", () => {
    // iOS 顶部回弹时 scrollY 是负数
    expect(resolvePinnedHeader(-120)).toBe(false);
    expect(resolvePinnedHeader(Number.NaN)).toBe(false);
    // 非有限值（Infinity）同样按 0 处理，不会被当成"已经滚过阈值"
    expect(resolvePinnedHeader(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("阈值可以被覆盖，非法阈值回落到默认值", () => {
    expect(resolvePinnedHeader(120, 200)).toBe(false);
    expect(resolvePinnedHeader(120, Number.NaN)).toBe(true);
    expect(resolvePinnedHeader(120, -5)).toBe(true);
  });
});

describe("readScrollOffset", () => {
  it("读出有效偏移", () => {
    expect(readScrollOffset({ scrollY: 0 })).toBe(0);
    expect(readScrollOffset({ scrollY: 640 })).toBe(640);
  });

  it("缺失或非法时兜底为 0，而不是把 NaN 传下去", () => {
    expect(readScrollOffset({})).toBe(0);
    expect(readScrollOffset({ scrollY: Number.NaN })).toBe(0);
    // 负数偏移按 0 算：回弹期间不该被当成"往上滚了负距离"
    expect(readScrollOffset({ scrollY: -40 })).toBe(0);
    // node 环境没有 window，等价于 SSR 首帧
    expect(readScrollOffset(null)).toBe(0);
  });
});
