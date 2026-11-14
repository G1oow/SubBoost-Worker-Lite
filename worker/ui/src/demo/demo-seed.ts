import { parseSubscription } from "@subboost/core/parser";
import { nodeRenameKey } from "../../../src/node-renames";
import type { SourceInput } from "../../../src/types";

/**
 * 预览站的种子数据。
 *
 * 全部使用保留地址与示例域名（example.com / RFC 2606），节点名带「演示」标记，
 * 避免与任何真实订阅混淆，也让公开预览站不含可识别信息。
 */

const DEMO_SS_CREDENTIAL = "YWVzLTI1Ni1nY206cGFzc3dvcmQ";

function ssNode(host: string, port: number, name: string): string {
  return `ss://${DEMO_SS_CREDENTIAL}@${host}:${port}#${encodeURIComponent(name)}`;
}

const PRIMARY_NODES = [
  ssNode("node-01.example.com", 8388, "🇭🇰 香港 01｜演示"),
  ssNode("node-02.example.com", 8388, "🇭🇰 香港 02｜演示"),
  ssNode("node-03.example.com", 8388, "🇯🇵 东京 01｜演示"),
  ssNode("node-04.example.com", 8388, "🇯🇵 东京 02｜演示"),
  ssNode("node-05.example.com", 8388, "🇯🇵 大阪 01｜演示"),
  ssNode("node-06.example.com", 8388, "🇸🇬 新加坡 01｜演示"),
  ssNode("node-07.example.com", 8388, "🇹🇼 台湾 01｜演示"),
  ssNode("node-08.example.com", 8388, "🇰🇷 首尔 01｜演示"),
  ssNode("node-09.example.com", 8388, "🇺🇸 洛杉矶 01｜演示"),
  ssNode("node-10.example.com", 8388, "🇺🇸 圣何塞 01｜演示"),
  ssNode("node-11.example.com", 8388, "🇬🇧 伦敦 01｜演示"),
  ssNode("node-12.example.com", 8388, "🇩🇪 法兰克福 01｜演示"),
];

const BACKUP_NODES = [
  ssNode("backup-01.example.com", 8443, "🇺🇸 西雅图 01｜演示"),
  ssNode("backup-02.example.com", 8443, "🇳🇱 阿姆斯特丹 01｜演示"),
  ssNode("backup-03.example.com", 8443, "🇫🇷 巴黎 01｜演示"),
  ssNode("backup-04.example.com", 8443, "🇨🇦 多伦多 01｜演示"),
  ssNode("backup-05.example.com", 8443, "🇦🇺 悉尼 01｜演示"),
  ssNode("backup-06.example.com", 8443, "🇭🇰 香港 03｜演示"),
];

const DISABLED_NODES = [
  ssNode("paused-01.example.com", 8388, "🇯🇵 东京 03｜演示"),
  ssNode("paused-02.example.com", 8388, "🇯🇵 东京 04｜演示"),
];

const RENAME_ORIGIN = "🇯🇵 东京 02｜演示";
const RENAME_TARGET = "🇯🇵 东京 02｜演示·改名";

/**
 * 重命名表的 key 是节点内容指纹（见 worker/src/node-renames.ts），不是节点名，
 * 所以这里先解析一遍种子文本拿到真实 key，再交给保存接口，
 * 保证演示数据走的是和真实录入完全一致的校验路径。
 */
function buildRenames(manualText: string): Record<string, string> | undefined {
  const node = parseSubscription(manualText).nodes.find((item) => item.name === RENAME_ORIGIN);
  return node ? { [nodeRenameKey(node)]: RENAME_TARGET } : undefined;
}

/** 节点在源里的内容指纹，用于构造链的节点引用 */
function nodeKeyOf(manualText: string, name: string): string | undefined {
  const node = parseSubscription(manualText).nodes.find((item) => item.name === name);
  return node ? nodeRenameKey(node) : undefined;
}

const PRIMARY_TEXT = PRIMARY_NODES.join("\n");
const BACKUP_TEXT = BACKUP_NODES.join("\n");
const PRIMARY_RENAMES = buildRenames(PRIMARY_TEXT);

export const DEMO_SOURCES: SourceInput[] = [
  {
    name: "演示主线路（手动节点）",
    kind: "manual",
    manualText: PRIMARY_TEXT,
    enabled: true,
    ...(PRIMARY_RENAMES ? { nodeRenames: PRIMARY_RENAMES } : {}),
  },
  {
    name: "演示备用线路（手动节点）",
    kind: "manual",
    manualText: BACKUP_TEXT,
    enabled: true,
  },
  {
    name: "演示停用线路（未启用）",
    kind: "manual",
    manualText: DISABLED_NODES.join("\n"),
    enabled: false,
  },
];

/**
 * 订阅种子。sourceIndexes 指向 DEMO_SOURCES 的下标，留空表示「包含全部已启用源」；
 * chainIds 在落库拿到真实链 id 之后再解析，用来展示「链只在勾选它的订阅里生成」。
 */
export const DEMO_SUBSCRIPTIONS: Array<{
  name: string;
  sourceIndexes: number[];
  chainKeys: string[];
}> = [
  // 第一条订阅挂上演示链：能看到链路生效
  { name: "演示订阅 · 全部线路", sourceIndexes: [], chainKeys: ["demo-local-chain", "demo-unused-chain"] },
  // 第二条只选主线路、不挂链：同样的链不会出现在它的配置里
  { name: "演示订阅 · 仅主线路", sourceIndexes: [0], chainKeys: [] },
];

/** 改名后的展示名，测试与文档复用同一处定义 */
export const DEMO_RENAMED_NODE = RENAME_TARGET;

/**
 * 演示用的链式代理草稿。
 *
 * 引用是 (源下标, 节点名)，真正的 `sourceId` 与 `nodeKey` 在 bootstrap 里换成真实值：
 * - 「本地两跳链」用同一个源里的两个节点（东京 → 大阪），展示同源不同节点的链；
 * - 「跨源链」用主线路节点当前置、备用线路节点当落地；
 * - 「失效链」引用不存在的节点，用来看「引用失效」提示。
 */
export const DEMO_CHAINS: Array<{
  id: string;
  name: string;
  enabled?: boolean;
  relay: Array<{ sourceIndex: number; nodeName: string }>;
  landing: Array<{ sourceIndex: number; nodeName: string }>;
}> = [
  {
    id: "demo-local-chain",
    name: "⛓ 演示本地两跳链",
    relay: [{ sourceIndex: 0, nodeName: "🇯🇵 东京 01｜演示" }],
    landing: [{ sourceIndex: 0, nodeName: "🇯🇵 大阪 01｜演示" }],
  },
  {
    id: "demo-unused-chain",
    name: "🇺🇸 演示跨源链",
    relay: [{ sourceIndex: 0, nodeName: "🇸🇬 新加坡 01｜演示" }],
    landing: [{ sourceIndex: 1, nodeName: "🇺🇸 西雅图 01｜演示" }],
  },
  {
    id: "demo-broken-chain",
    name: "🇩🇪 演示失效链",
    relay: [{ sourceIndex: 0, nodeName: "🇯🇵 东京 01｜演示" }],
    landing: [{ sourceIndex: 0, nodeName: "不存在的落地" }],
  },
];

/** 把「源下标 + 节点名」换成真实的 `{ sourceId, nodeKey }`；解析不到的节点保留假的 key */
export function buildDemoChain(
  chain: (typeof DEMO_CHAINS)[number],
  sourceIds: string[],
  manualTextsByIndex: string[]
): Record<string, unknown> {
  const toRef = (item: { sourceIndex: number; nodeName: string }) => {
    const sourceId = sourceIds[item.sourceIndex];
    if (!sourceId) return null;
    const nodeKey = nodeKeyOf(manualTextsByIndex[item.sourceIndex] ?? "", item.nodeName) ?? `missing-${item.nodeName}`;
    return { sourceId, nodeKey };
  };
  const relayNodes = chain.relay.map(toRef).filter(Boolean);
  const landingNodes = chain.landing.map(toRef).filter(Boolean);
  return {
    id: chain.id,
    name: chain.name,
    ...(chain.enabled === false ? { enabled: false } : {}),
    relayNodes,
    landingNodes,
  };
}

/** 演示源的手动文本，按 DEMO_SOURCES 下标对齐，供构造节点指纹使用 */
export const DEMO_SOURCE_TEXTS = [PRIMARY_TEXT, BACKUP_TEXT, DISABLED_NODES.join("\n")];
