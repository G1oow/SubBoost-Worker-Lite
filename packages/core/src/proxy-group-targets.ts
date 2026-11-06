import type {
  CustomProxyGroup,
  ProxyGroupMemberRef,
  ProxyGroupRuleTarget,
  ProxyGroupTargetRef,
} from "@subboost/core/types/config";

/** 链式代理出口组：引用形式与模块/自定义组一致，`id` 是链的 id，不是组名 */
export type ChainGroupRef = { id: string; name: string };

export function isProxyGroupTargetRef(value: unknown): value is ProxyGroupTargetRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    (item.kind === "module" || item.kind === "custom" || item.kind === "chain") &&
    typeof item.id === "string" &&
    Boolean(item.id.trim())
  );
}

export function normalizeProxyGroupTargetRef(value: unknown): ProxyGroupTargetRef | null {
  if (!isProxyGroupTargetRef(value)) return null;
  return { kind: value.kind, id: value.id.trim() };
}

export function getProxyGroupTargetKey(target: ProxyGroupTargetRef): string {
  return `${target.kind}:${target.id}`;
}

export function getProxyGroupMemberKey(member: ProxyGroupMemberRef): string {
  switch (member.kind) {
    case "node":
      return `node:${member.name}`;
    case "module":
      return `module:${member.id}`;
    case "custom":
      return `custom:${member.id}`;
    case "chain":
      return `chain:${member.id}`;
    case "direct":
      return "direct:DIRECT";
    case "reject":
      return "reject:REJECT";
  }
}

export function resolveProxyGroupTargetName(
  target: ProxyGroupRuleTarget,
  options: {
    moduleNames: Record<string, string>;
    customProxyGroups?: CustomProxyGroup[];
    /** 启用的链：`id` → 出口组名；停用或不存在的链解析为 fallback */
    chainGroups?: ChainGroupRef[];
    fallbackTarget?: string;
  }
): string {
  if (typeof target === "string") {
    return target.trim() || options.fallbackTarget || "";
  }

  const normalized = normalizeProxyGroupTargetRef(target);
  if (!normalized) return options.fallbackTarget || "";

  if (normalized.kind === "module") {
    const moduleName = Object.prototype.hasOwnProperty.call(options.moduleNames, normalized.id)
      ? options.moduleNames[normalized.id]
      : undefined;
    return (typeof moduleName === "string" ? moduleName.trim() : "") || options.fallbackTarget || "";
  }

  if (normalized.kind === "chain") {
    const chainName = (options.chainGroups || [])
      .find((group) => group.id === normalized.id)
      ?.name?.trim();
    return chainName || options.fallbackTarget || "";
  }

  const customName = (options.customProxyGroups || []).find((group) => group.id === normalized.id)?.name?.trim();
  return customName || options.fallbackTarget || "";
}

export function ruleTargetMatchesName(target: ProxyGroupRuleTarget, name: string): boolean {
  return typeof target === "string" && target.trim() === name.trim();
}
