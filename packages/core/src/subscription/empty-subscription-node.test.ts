import { describe, expect, it } from "vitest";
import { isMihomoSupportedProxyNode } from "../mihomo/proxy-sanitizer";
import { createEmptySubscriptionNode, EMPTY_SUBSCRIPTION_NODE_NAME } from "./empty-subscription-node";

describe("createEmptySubscriptionNode", () => {
  it("输出一个能通过生成链路的 direct 占位节点", () => {
    const node = createEmptySubscriptionNode();
    expect(node.name).toBe(EMPTY_SUBSCRIPTION_NODE_NAME);
    expect(node.name).toBe("当前订阅暂无绑定源");
    expect(node.type).toBe("direct");
    // 生成器会先按 mihomo 支持的类型过滤一遍，占位节点被过滤掉就等于什么都没输出
    expect(isMihomoSupportedProxyNode(node)).toBe(true);
  });

  it("每次返回新对象，调用方改字段不会污染后续生成", () => {
    const first = createEmptySubscriptionNode();
    first.name = "被改过了";
    expect(createEmptySubscriptionNode().name).toBe(EMPTY_SUBSCRIPTION_NODE_NAME);
  });
});
