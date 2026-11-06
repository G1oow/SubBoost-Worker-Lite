import getSurgeParser from "./peggy/surge";
import getLoonParser from "./peggy/loon";
import getQxParser from "./peggy/qx";
import { canonicalizeParsedNode } from "../canonical-fields";
import { splitWsPathEarlyData } from "../ws-early-data";
import type { ParsedNode } from "@subboost/core/types/node";

type PlatformKind = "surge" | "loon" | "qx";

export interface PlatformParseContext {
  sections?: Map<string, string[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pickString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function pickNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function extractSurgePortHopping(raw: string): { line: string; ports?: string } {
  const match =
    raw.match(
      /,\s*?port-hopping\s*?=\s*?["']?\s*?((\d+(-\d+)?)([,;]\d+(-\d+)?)*)\s*?["']?\s*?/i
    ) || [];
  const ports = typeof match[1] === "string" && match[1].trim() ? match[1].trim().replace(/;/g, ",") : undefined;
  const removed = typeof match[0] === "string" && match[0] ? raw.replace(match[0], "") : raw;
  return { line: removed, ports };
}

function normalizeWsEarlyDataInPlace(proxy: Record<string, unknown>) {
  if (pickString(proxy.network) !== "ws") return;
  const wsOpts = proxy["ws-opts"];
  if (!isRecord(wsOpts)) return;
  const path = pickString(wsOpts.path);
  if (!path) return;
  const { path: wsPath, earlyData } = splitWsPathEarlyData(path);
  if (earlyData === undefined) return;
  wsOpts.path = wsPath;
  wsOpts["early-data-header-name"] = "Sec-WebSocket-Protocol";
  wsOpts["max-early-data"] = earlyData;
}

function parseEndpoint(raw: string): { server: string; port: number } | null {
  const value = raw.trim().replace(/^"|"$/g, "");
  if (!value) return null;
  const idx = value.lastIndexOf(":");
  if (idx === -1) return null;
  const server = value.slice(0, idx).replace(/^\[/, "").replace(/\]$/, "").trim();
  const port = Number.parseInt(value.slice(idx + 1), 10);
  if (!server || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { server, port };
}

function parseReserved(value: string): number[] | undefined {
  const normalized = value.trim().replace(/^\[/, "").replace(/\]$/, "").replace(/^"|"$/g, "");
  if (!normalized) return undefined;
  const list = normalized
    .split(/[\/,]/)
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isInteger(item));
  return list.length > 0 ? list : undefined;
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function parsePeerKvString(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const regex = /([a-z-]+)\s*=\s*([^"(),]+|".*?")/gi;
  for (const match of Array.from(raw.matchAll(regex))) {
    const key = match[1]?.trim().toLowerCase();
    const value = match[2]?.trim().replace(/^"|"$/g, "");
    if (key && value) out[key] = value;
  }
  return out;
}

function parsePeerList(raw: string): Array<Record<string, unknown>> {
  const peers: Array<Record<string, unknown>> = [];
  for (const match of Array.from(raw.matchAll(/\((.*?)\)/g))) {
    const kv = parsePeerKvString(match[1] || "");
    const endpoint = kv.endpoint ? parseEndpoint(kv.endpoint) : null;
    const reserved = kv.reserved ? parseReserved(kv.reserved) : kv["client-id"] ? parseReserved(kv["client-id"]) : undefined;
    peers.push({
      ...(endpoint ? { server: endpoint.server, port: endpoint.port } : {}),
      ...(kv["public-key"] ? { "public-key": kv["public-key"] } : {}),
      ...(kv["pre-shared-key"] ? { "pre-shared-key": kv["pre-shared-key"] } : {}),
      ...(kv["allowed-ips"] ? { "allowed-ips": splitCsv(kv["allowed-ips"]) } : {}),
      ...(reserved ? { reserved } : {}),
    });
  }
  return peers;
}

function findSectionLines(sections: Map<string, string[]> | undefined, name: string): string[] | undefined {
  if (!sections) return undefined;
  const target = name.trim().toLowerCase();
  for (const [sectionName, lines] of Array.from(sections.entries())) {
    if (sectionName.trim().toLowerCase() === target) return lines;
  }
  return undefined;
}

function parseIniAssignments(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function parseLoonWireGuardLine(line: string): Record<string, unknown> | null {
  const name = line.match(/(^.*?)\s*?=\s*?wireguard\s*?,.+?\s*?=\s*?.+?/i)?.[1]?.trim();
  if (!name) return null;
  const peersRaw = line.match(/,\s*?peers\s*?=\s*?\[\s*?\{\s*?(.+?)\s*?\}\s*?\]/i)?.[1];
  if (!peersRaw) return null;
  const endpointMatch = peersRaw.match(/(,|^)\s*?endpoint\s*?=\s*?"?(.+?):(\d+)"?\s*?(,|$)/i);
  const server = endpointMatch?.[2]?.trim();
  const port = endpointMatch?.[3] ? Number.parseInt(endpointMatch[3], 10) : null;
  if (!server || port === null || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  const mtuRaw = line.match(/(,|^)\s*?mtu\s*?=\s*?"?(\d+?)"?\s*?(,|$)/i)?.[2];
  const keepaliveRaw = line.match(/(,|^)\s*?keepalive\s*?=\s*?"?(\d+?)"?\s*?(,|$)/i)?.[2];
  const reservedRaw = peersRaw.match(/(,|^)\s*?reserved\s*?=\s*?"?(\[\s*?.+?\s*?\])"?\s*?(,|$)/i)?.[2];
  const allowedIps = peersRaw.match(/(,|^)\s*?allowed-ips\s*?=\s*?"(.+?)"\s*?(,|$)/i)?.[2];
  const preSharedKey = peersRaw.match(/(,|^)\s*?preshared-key\s*?=\s*?"?(.+?)"?\s*?(,|$)/i)?.[2];
  const publicKey = peersRaw.match(/(,|^)\s*?public-key\s*?=\s*?"?(.+?)"?\s*?(,|$)/i)?.[2];
  const dns = [
    line.match(/(,|^)\s*?dns\s*?=\s*?"?(.+?)"?\s*?(,|$)/i)?.[2],
    line.match(/(,|^)\s*?dnsv6\s*?=\s*?"?(.+?)"?\s*?(,|$)/i)?.[2],
  ].filter((v): v is string => Boolean(v)).map((v) => v.trim());

  return {
    type: "wireguard",
    name,
    server,
    port,
    ip: line.match(/(,|^)\s*?interface-ip\s*?=\s*?"?(.+?)"?\s*?(,|$)/i)?.[2],
    ipv6: line.match(/(,|^)\s*?interface-ipv6\s*?=\s*?"?(.+?)"?\s*?(,|$)/i)?.[2],
    "private-key": line.match(/(,|^)\s*?private-key\s*?=\s*?"?(.+?)"?\s*?(,|$)/i)?.[2],
    ...(publicKey ? { "public-key": publicKey } : {}),
    ...(preSharedKey ? { "pre-shared-key": preSharedKey } : {}),
    ...(mtuRaw ? { mtu: Number.parseInt(mtuRaw, 10) } : {}),
    ...(keepaliveRaw ? { keepalive: Number.parseInt(keepaliveRaw, 10) } : {}),
    ...(reservedRaw ? { reserved: parseReserved(reservedRaw) } : {}),
    ...(allowedIps ? { "allowed-ips": splitCsv(allowedIps) } : {}),
    ...(dns.length > 0 ? { dns, "remote-dns-resolve": true } : {}),
    udp: true,
    peers: [
      {
        server,
        port,
        ...(publicKey ? { "public-key": publicKey } : {}),
        ...(preSharedKey ? { "pre-shared-key": preSharedKey } : {}),
        ...(allowedIps ? { "allowed-ips": splitCsv(allowedIps) } : {}),
        ...(reservedRaw ? { reserved: parseReserved(reservedRaw) } : {}),
      },
    ],
  };
}

function parseSurgeWireGuardWithContext(proxy: Record<string, unknown>, sections?: Map<string, string[]>): Record<string, unknown> {
  const sectionName = pickString(proxy["section-name"]);
  if (!sectionName) throw new Error("Surge WireGuard 缺少 section-name");
  const lines = findSectionLines(sections, `WireGuard ${sectionName}`);
  if (!lines || lines.length === 0) throw new Error(`未找到 WireGuard section: ${sectionName}`);
  const assignments = parseIniAssignments(lines);
  const peers = parsePeerList(assignments.peer || "");
  const firstPeer = (peers[0] && isRecord(peers[0]) ? peers[0] : {}) as Record<string, unknown>;
  const server = pickString(firstPeer.server);
  const port = pickNumber(firstPeer.port);
  if (!server || port === null || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`WireGuard section ${sectionName} 缺少有效 endpoint`);
  }
  const dns = assignments["dns-server"] ? splitCsv(assignments["dns-server"]) : undefined;
  const mtu = assignments.mtu ? Number.parseInt(assignments.mtu, 10) : undefined;
  const keepalive = assignments.keepalive ? Number.parseInt(assignments.keepalive, 10) : undefined;
  return {
    type: "wireguard",
    name: pickString(proxy.name) || `WireGuard-${sectionName}`,
    server,
    port,
    ip: assignments["self-ip"] || undefined,
    ipv6: assignments["self-ip-v6"] || undefined,
    "private-key": assignments["private-key"] || undefined,
    ...(pickString(firstPeer["public-key"]) ? { "public-key": pickString(firstPeer["public-key"]) } : {}),
    ...(pickString(firstPeer["pre-shared-key"]) ? { "pre-shared-key": pickString(firstPeer["pre-shared-key"]) } : {}),
    ...(Number.isInteger(mtu) ? { mtu } : {}),
    ...(Number.isInteger(keepalive) ? { keepalive } : {}),
    ...(Array.isArray(firstPeer.reserved) ? { reserved: firstPeer.reserved } : {}),
    ...(dns && dns.length > 0 ? { dns, "remote-dns-resolve": true } : {}),
    ...(Array.isArray(firstPeer["allowed-ips"]) ? { "allowed-ips": firstPeer["allowed-ips"] } : {}),
    udp: true,
    peers,
  };
}

function normalizePlatformProxyInPlace(proxy: Record<string, unknown>) {
  const rawType = pickString(proxy.type).toLowerCase();
  if (!rawType) throw new Error("平台代理行缺少 type");
  if (rawType === "http" && proxy.tls === true) proxy.type = "https";
  normalizeWsEarlyDataInPlace(proxy);
  const keystorePrivateKey = pickString(proxy["keystore-private-key"]);
  if (keystorePrivateKey) {
    proxy["private-key"] = keystorePrivateKey;
    delete proxy["keystore-private-key"];
  }
  const tlsFingerprint = pickString(proxy["tls-fingerprint"]);
  if (tlsFingerprint) {
    const type = pickString(proxy.type).toLowerCase();
    if (["vmess", "vless", "trojan", "anytls"].includes(type) && !pickString(proxy["client-fingerprint"])) proxy["client-fingerprint"] = tlsFingerprint;
    if (type === "hysteria2" && !pickString(proxy.fingerprint)) proxy.fingerprint = tlsFingerprint;
    if (type === "ssh" && !pickString(proxy["server-fingerprint"])) proxy["server-fingerprint"] = tlsFingerprint;
    delete proxy["tls-fingerprint"];
  }
  const sni = pickString(proxy.sni);
  const type = pickString(proxy.type).toLowerCase();
  if (sni && (type === "vmess" || type === "vless") && !pickString(proxy.servername)) {
    proxy.servername = sni;
    delete proxy.sni;
  }

  if (type === "anytls") {
    const network = pickString(proxy.network).toLowerCase();
    if (network && network !== "tcp") {
      throw new Error(`AnyTLS 平台配置不支持 network=${network}（Mihomo 仅支持纯 TCP）`);
    }
    // 只有 security=reality 标记、没有 reality-opts 的节点按普通 TLS AnyTLS 保留（与链接解析一致）
    if (proxy["reality-opts"]) {
      throw new Error(
        "AnyTLS 平台配置不支持 Reality 参数（Mihomo 不支持 anytls+reality，请改用 VLESS/Trojan，或为该节点启用 ECH 隐藏 SNI）"
      );
    }
    if (pickString(proxy.servername) && !pickString(proxy.sni)) {
      proxy.sni = pickString(proxy.servername);
      delete proxy.servername;
    }
    // AnyTLS 恒为 TLS，security 只是冗余标记（Reality 已在上面拦掉），不写进节点
    delete proxy.security;
  }
}

function ensureCoreFields(proxy: Record<string, unknown>, kind: PlatformKind) {
  const name = pickString(proxy.name);
  const type = pickString(proxy.type).toLowerCase();
  if (!name) throw new Error(`${kind} 代理行缺少 name`);
  if (!type) throw new Error(`${kind} 代理行缺少 type`);
  if (type === "trusttunnel" || type === "direct" || type === "external") {
    throw new Error(`不支持的平台代理类型: ${type}`);
  }
  const server = pickString(proxy.server);
  const port = pickNumber(proxy.port);
  if (!server || port === null || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${kind} 代理行缺少 server/port 或端口无效`);
  }
}

function tryParseBy(kind: PlatformKind, line: string): Record<string, unknown> | null {
  try {
    if (kind === "surge") {
      const { line: nextLine, ports } = extractSurgePortHopping(line);
      const parsed = getSurgeParser().parse(nextLine) as unknown;
      if (!isRecord(parsed)) return null;
      if (ports) parsed.ports = ports;
      return parsed;
    }
    if (kind === "loon") {
      const parsed = getLoonParser().parse(line) as unknown;
      return isRecord(parsed) ? parsed : null;
    }
    const parsed = getQxParser().parse(line) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parsePlatformProxyLine(line: string, context?: PlatformParseContext): ParsedNode | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const customLoonWireGuard = parseLoonWireGuardLine(trimmed);
  if (customLoonWireGuard) {
    normalizePlatformProxyInPlace(customLoonWireGuard);
    ensureCoreFields(customLoonWireGuard, "loon");
    return canonicalizeParsedNode(customLoonWireGuard as unknown as ParsedNode);
  }
  const bySurge = tryParseBy("surge", trimmed);
  const byLoon = bySurge ? null : tryParseBy("loon", trimmed);
  const byQx = bySurge || byLoon ? null : tryParseBy("qx", trimmed);
  const parsed = bySurge || byLoon || byQx;
  const kind: PlatformKind | null = bySurge ? "surge" : byLoon ? "loon" : byQx ? "qx" : null;
  if (!parsed || !kind) return null;
  const type = pickString(parsed.type).toLowerCase();
  const resolved = type === "wireguard-surge" ? parseSurgeWireGuardWithContext(parsed, context?.sections) : parsed;
  normalizePlatformProxyInPlace(resolved);
  ensureCoreFields(resolved, kind);
  return canonicalizeParsedNode(resolved as unknown as ParsedNode);
}


