import { buildNodeContentKey } from "./node-identity";
import type { ParsedNode } from "./types/node";

/**
 * 节点内容指纹的短键。
 *
 * 两个用途共用同一套实现，必须保持一致：
 * - 节点改名表（`nodeRenames`）的 key；
 * - 链式代理的节点引用（`ChainNodeRef.nodeKey`）。
 *
 * 都用「忽略节点名」的内容指纹：改名后键不变，凭据/服务器/端口等身份字段变化后键改变。
 */
const FNV_PRIME = 0x01000193;
// 两个不同的 FNV offset basis，拼成 64 位强度，避免依赖 BigInt（target 是 ES2017）
const FNV_SEED_A = 0x811c9dc5;
const FNV_SEED_B = 0x2545f491;
const RENAME_KEY_PATTERN = /^[0-9a-f]{16}$/;

function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/**
 * 节点内容指纹的短哈希（16 位十六进制）。
 * 用同步实现而不是 WebCrypto，方便在纯函数与测试里直接复用。
 */
export function hashNodeKey(input: string): string {
  const high = fnv1a32(input, FNV_SEED_A).toString(16).padStart(8, "0");
  const low = fnv1a32(input, FNV_SEED_B).toString(16).padStart(8, "0");
  return `${high}${low}`;
}

export function isRenameKey(value: unknown): value is string {
  return typeof value === "string" && RENAME_KEY_PATTERN.test(value);
}

/**
 * 节点的稳定内容键：忽略名称的内容指纹。
 * 名称改了键不变，因此改名映射可以反复覆盖，链引用也不会因为改名失效。
 */
export function nodeRenameKey(node: ParsedNode): string {
  return hashNodeKey(buildNodeContentKey(node));
}
