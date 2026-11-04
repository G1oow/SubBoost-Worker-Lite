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
  ssNode("node-01.example.com", 8388, "东京 · 演示 01"),
  ssNode("node-02.example.com", 8388, "东京 · 演示 02"),
  ssNode("node-03.example.com", 8388, "大阪 · 演示 03"),
  ssNode("node-04.example.com", 8388, "新加坡 · 演示 04"),
];

const BACKUP_NODES = [
  ssNode("backup-01.example.com", 8443, "洛杉矶 · 备用 01"),
  ssNode("backup-02.example.com", 8443, "法兰克福 · 备用 02"),
];

const DISABLED_NODES = [ssNode("paused-01.example.com", 8388, "已停用 · 演示 05")];

const RENAME_ORIGIN = "东京 · 演示 02";
const RENAME_TARGET = "东京 · 演示 02（已改名）";

/**
 * 重命名表的 key 是节点内容指纹（见 worker/src/node-renames.ts），不是节点名，
 * 所以这里先解析一遍种子文本拿到真实 key，再交给保存接口，
 * 保证演示数据走的是和真实录入完全一致的校验路径。
 */
function buildRenames(manualText: string): Record<string, string> | undefined {
  const node = parseSubscription(manualText).nodes.find((item) => item.name === RENAME_ORIGIN);
  return node ? { [nodeRenameKey(node)]: RENAME_TARGET } : undefined;
}

const PRIMARY_TEXT = PRIMARY_NODES.join("\n");
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
    manualText: BACKUP_NODES.join("\n"),
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
 * 订阅种子。sourceIndexes 指向 DEMO_SOURCES 的下标，留空表示「包含全部已启用源」，
 * 与真实 Worker 的语义一致（下标在落库拿到真实 id 之后再解析）。
 */
export const DEMO_SUBSCRIPTIONS: Array<{ name: string; sourceIndexes: number[] }> = [
  { name: "演示订阅 · 全部线路", sourceIndexes: [] },
  { name: "演示订阅 · 仅主线路", sourceIndexes: [0] },
];

/** 改名后的展示名，测试与文档复用同一处定义 */
export const DEMO_RENAMED_NODE = RENAME_TARGET;
