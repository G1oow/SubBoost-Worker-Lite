import type { DirectNode, ParsedNode } from "../types/node";

/**
 * 订阅没有任何可用绑定源时，写进配置里的占位节点名。
 *
 * 订阅勾选的源被删掉之后有两条路都不能走：放宽成「全部启用源」等于把流量交给用户
 * 没勾选过的源；继续按「无节点」返回 503 则客户端只会沿用旧配置，用户看不到原因。
 * 所以用一个 `direct` 节点把状态直接摆到客户端的节点列表里，导入或更新订阅后一眼可见。
 */
export const EMPTY_SUBSCRIPTION_NODE_NAME = "当前订阅暂无绑定源";

export function createEmptySubscriptionNode(): ParsedNode {
  const node: DirectNode = { name: EMPTY_SUBSCRIPTION_NODE_NAME, type: "direct" };
  return node;
}
