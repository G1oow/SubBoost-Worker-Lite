// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SubscriptionDto } from "../lib/types";
import { SubscriptionAgeDialog } from "./subscription-age-dialog";

/**
 * 这条用例守护用户可见的引导链路：
 * 没配 `AGE_RECIPIENT` 时点开「age 加密」按钮，弹窗必须直接给出部署文档入口，
 * 而不是只留一句「未配置」。
 */

const SUBSCRIPTION: SubscriptionDto = {
  id: "sub-1",
  name: "默认订阅",
  sourceIds: [],
  link: "https://worker.example.com/sub/tokenvalue",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

afterEach(cleanup);

describe("SubscriptionAgeDialog", () => {
  it("未配置公钥时给出说明与文档链接", () => {
    render(
      React.createElement(SubscriptionAgeDialog, {
        subscription: SUBSCRIPTION,
        onClose: () => undefined,
      })
    );

    expect(screen.getByText(/还没配置 age 公钥/)).toBeTruthy();
    const link = screen.getByRole("link", { name: /查看部署与使用文档/ });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/G1oow/SubBoost-Worker-Lite/blob/main/docs/age-encryption.md"
    );
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("配置好之后显示加密链接，不再显示引导", () => {
    render(
      React.createElement(SubscriptionAgeDialog, {
        subscription: SUBSCRIPTION,
        onClose: () => undefined,
        age: {
          enabled: true,
          only: false,
          recipients: ["age1demoexampleexampleexampleexample"],
          misconfigured: false,
        },
      })
    );

    expect(
      screen.getByText("https://worker.example.com/sub/tokenvalue?format=age")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /复制加密链接/ })).toBeTruthy();
    expect(screen.queryByText(/还没配置 age 公钥/)).toBeNull();
  });
});
