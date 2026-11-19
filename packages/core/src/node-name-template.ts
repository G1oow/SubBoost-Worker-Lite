import { makeUniqueName } from "./subscription/node-source-state";

export const DEFAULT_NODE_NAME_TEMPLATE = "[{tag}]{name}";

export function formatNodeNameFromTemplate(params: {
  originName: string;
  tag?: string;
  template?: string;
}): string {
  const originName = params.originName.trim();
  if (!originName) return "";

  const tag = typeof params.tag === "string" ? params.tag.trim() : "";
  if (!tag) return originName;

  const template = typeof params.template === "string" ? params.template.trim() : "";
  const pattern = template || DEFAULT_NODE_NAME_TEMPLATE;

  const formatted = pattern.replaceAll("{tag}", tag).replaceAll("{name}", originName).trim();
  return formatted || originName;
}

/*
 * 源级「命名模板」：一条模板套给该源的全部节点，模板里用变量拼名字。
 *
 * 与上面的 `formatNodeNameFromTemplate` 不是一件事：那个是「可选 tag 前缀」，
 * tag 为空时原样返回；这里是完整命名规则，模板为空才算不启用。
 * 两者语义不同，所以分开实现，避免改动历史行为。
 */

/** 模板可用的变量，顺序即界面上的按钮顺序 */
export const NODE_NAME_TEMPLATE_VARIABLES = [
  "name",
  "protocol",
  "ip",
  "server",
  "port",
  "sourceName",
  "flag",
] as const;

export type NodeNameTemplateVariable = (typeof NODE_NAME_TEMPLATE_VARIABLES)[number];

/** 模板本身的上限：够写「协议 + IP + 端口 + 原名」且有富余 */
export const NODE_NAME_TEMPLATE_MAX_LENGTH = 200;
/** 渲染结果的长度上限，与 MAX_NODE_NAME_LENGTH 保持一致 */
export const NODE_NAME_TEMPLATE_MAX_NAME_LENGTH = 120;

export type NodeNameTemplateValues = Record<NodeNameTemplateVariable, string>;

export type NodeNameTemplateRender = {
  /** 最终名字；模板为空或渲染为空时回退为原名 */
  name: string;
  /** 在这一节点上取不到值、被置空的变量 */
  missing: NodeNameTemplateVariable[];
  /** 是否真的改动了名字（等于原名则不算） */
  applied: boolean;
};

export type NodeNameTemplateHit = {
  before: string;
  /** 最终名字；`applied` 为 false 时与 before 相同 */
  after: string;
  /** 在这一节点上取不到值、被置空的变量 */
  missing: NodeNameTemplateVariable[];
  /** 是否真的改了名。false 表示只有空变量提示、名字未变 */
  applied: boolean;
};

// IPv4 逐段写开：嵌套量词对内置正则也没必要，线性写法更快也更好读
const IPV4_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
// IPv6 只做「像不像」的宽松判断：十六进制与冒号，且不止一个冒号。够覆盖 ::1 / 2001:db8::1
const IPV6_CHARS_PATTERN = /^[0-9a-f:]+$/i;
const PORT_PATTERN = /^\d+$/;
const REGION_CODE_ONLY_PATTERN = /^[A-Z]{2}$/;
// 变量名允许大小写混写，`{sourceName}` 是驼峰，不能只吃小写
const VARIABLE_PATTERN = /\{([A-Za-z]+)\}/g;
// 国旗 emoji 由两个 Regional Indicator 组成，需要 u 标志才能按码点匹配
const FLAG_EMOJI_PATTERN = /\p{Regional_Indicator}{2}/u;
// 没有 emoji 时退而找独立的两位地区码（JP / HK …）；机场名里这种独立两字母词基本就是地区码
const REGION_CODE_PATTERN = /\b([A-Za-z]{2})\b/;

/** 变量名大小写不敏感：`{sourceName}` 与 `{sourcename}` 都能用，避免手写驼峰出错 */
const VARIABLE_BY_LOWER = new Map<string, NodeNameTemplateVariable>(
  NODE_NAME_TEMPLATE_VARIABLES.map((name) => [name.toLowerCase(), name])
);

function resolveVariable(key: string): NodeNameTemplateVariable | undefined {
  return VARIABLE_BY_LOWER.get(key.toLowerCase());
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

/**
 * 把两位地区码换算成国旗 emoji（A→🇦 … Z→🇿）。
 *
 * 纯计算，不需要码表：Unicode 把 A-Z 连续映射到 U+1F1E6..U+1F1FF。
 */
export function regionCodeToFlag(code: string): string {
  const upper = code.trim().toUpperCase();
  if (!REGION_CODE_ONLY_PATTERN.test(upper)) return "";
  return [...upper]
    .map((letter) => String.fromCodePoint(0x1f1e6 + (letter.charCodeAt(0) - 65)))
    .join("");
}

/**
 * 从节点名里取地区国旗。
 *
 * 顺序：名字里已有的国旗 emoji 优先；没有就找独立的两位地区码并换算成国旗。
 * 两者都没有则置空——`{flag}` 取不到值时不硬编造，界面上会提示该变量为空。
 */
export function extractNodeFlag(name: string): string {
  const value = name.trim();
  if (!value) return "";
  const emoji = FLAG_EMOJI_PATTERN.exec(value);
  if (emoji) return emoji[0];
  const code = REGION_CODE_PATTERN.exec(value);
  if (!code) return "";
  return regionCodeToFlag(code[1]);
}

/**
 * 从服务器字段里取出 IP。
 *
 * 域名不匹配（`{ip}` 置空），此时该用 `{server}`——两者分开正是为了让
 * 「按 IP 命名」和「按域名命名」各自可写，而不是把域名硬塞进 `{ip}`。
 */
export function extractNodeIp(server: string): string {
  const value = server.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!value) return "";
  if (IPV4_PATTERN.test(value)) {
    const octets = value.split(".").map((part) => Number(part));
    return octets.every((octet) => octet <= 255) ? value : "";
  }
  if (!value.includes(":") || !IPV6_CHARS_PATTERN.test(value)) return "";
  const colons = value.split(":").length - 1;
  return colons >= 2 ? value : "";
}

function extractPort(port: unknown): string {
  if (typeof port === "number" && Number.isFinite(port)) return String(port);
  if (typeof port === "string") {
    const trimmed = port.trim();
    return PORT_PATTERN.test(trimmed) ? trimmed : "";
  }
  return "";
}

/**
 * 取出模板可用的变量值；端口统一转字符串，取不到的为空串。
 *
 * `sourceName` 来自源记录而非节点：生成时按源传进来，所以同一个节点在不同源里
 * 会得到不同的 `{sourceName}`——这正是它和 `{name}` 的区别。
 */
export function nodeNameTemplateValues(
  node: unknown,
  sourceName?: string
): NodeNameTemplateValues {
  const record = (node ?? {}) as Record<string, unknown>;
  const server = readString(record, "server");
  const originName = readString(record, "name");
  return {
    name: originName,
    protocol: readString(record, "type").trim(),
    ip: extractNodeIp(server),
    server: server.trim(),
    port: extractPort(record.port),
    sourceName: typeof sourceName === "string" ? sourceName.trim() : "",
    flag: extractNodeFlag(originName),
  };
}

/**
 * 渲染单条节点名。
 *
 * 空值置空并记进 `missing`，整名 trim 后为空则回退原名——模板写错或字段缺失时
 * 宁可保留原名，也不要把「空名字」或残缺分隔符写进生成的 YAML。
 */
export function renderNodeNameTemplate(
  node: unknown,
  template: string | undefined,
  sourceName?: string
): NodeNameTemplateRender {
  const values = nodeNameTemplateValues(node, sourceName);
  const origin = values.name;
  const raw = typeof template === "string" ? template.trim() : "";
  if (!raw) return { name: origin, missing: [], applied: false };

  const missing = new Set<NodeNameTemplateVariable>();
  const rendered = raw
    .replace(VARIABLE_PATTERN, (whole, key: string) => {
      const variable = resolveVariable(key);
      if (!variable) return whole;
      const value = values[variable];
      if (!value) missing.add(variable);
      return value;
    })
    .trim();

  const name = (rendered || origin).slice(0, NODE_NAME_TEMPLATE_MAX_NAME_LENGTH);
  return { name, missing: [...missing], applied: name !== origin };
}

export type NodeNameTemplateValidation =
  | { ok: true; template?: string }
  | { ok: false; message: string };

/**
 * 校验用户填的模板。
 *
 * 未知变量直接报错而不是当字面量保留：`{protocl}` 这种拼写错误如果静默输出，
 * 用户只会在订阅里看到一堆花括号，很难联想到是自己打错了。
 */
export function validateNodeNameTemplate(value: unknown): NodeNameTemplateValidation {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== "string") return { ok: false, message: "命名模板必须是文本" };

  const template = value.trim();
  if (!template) return { ok: true };
  if (template.length > NODE_NAME_TEMPLATE_MAX_LENGTH) {
    return { ok: false, message: `命名模板最多 ${NODE_NAME_TEMPLATE_MAX_LENGTH} 个字符` };
  }

  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    if (!resolveVariable(match[1])) {
      const available = NODE_NAME_TEMPLATE_VARIABLES.map((name) => `{${name}}`).join(" ");
      return { ok: false, message: `未知变量 {${match[1]}}，可用变量：${available}` };
    }
  }

  return { ok: true, template };
}
/**
 * 对一个源的整批节点套用模板，并对**被模板改过名的节点**做源内去重。
 *
 * `reserved` 是已被占用的名字（典型是逐节点手动改名），模板产物不会顶掉它们；
 * `sourceName` 供 `{sourceName}` 使用，按源传入（同一个节点在不同源里取值不同）。
 * 没被模板改动的节点保持原名，即使重名也不加后缀。
 */
export function applyNodeNameTemplate<T>(
  nodes: readonly T[],
  template: string | undefined,
  keyOf: (node: T) => string,
  reserved?: Iterable<string>,
  sourceName?: string
): { nodes: T[]; hits: Map<string, NodeNameTemplateHit>; hitCount: number } {
  const hits = new Map<string, NodeNameTemplateHit>();
  const raw = typeof template === "string" ? template.trim() : "";
  if (!raw) return { nodes: [...nodes], hits, hitCount: 0 };

  const usedNames = new Set<string>(reserved ?? []);
  const renders = nodes.map((node) => ({
    node,
    render: renderNodeNameTemplate(node, raw, sourceName),
  }));
  // 先占位未被模板改动的名字，避免模板产物「抢走」别人的原名
  for (const { render } of renders) {
    if (!render.applied) usedNames.add(render.name);
  }

  const next: T[] = [];
  let hitCount = 0;
  for (const { node, render } of renders) {
    const before = readString(node as Record<string, unknown>, "name");
    if (!render.applied) {
      next.push(node);
      // 名字没变但有空变量时也要记一笔：界面上要提示「这个节点的 {ip} 为空」
      if (render.missing.length > 0) {
        hits.set(keyOf(node), { before, after: before, missing: render.missing, applied: false });
      }
      continue;
    }
    const uniqueName = makeUniqueName(render.name, usedNames);
    usedNames.add(uniqueName);
    hitCount += 1;
    hits.set(keyOf(node), { before, after: uniqueName, missing: render.missing, applied: true });
    next.push(
      uniqueName === before
        ? node
        : ({ ...(node as Record<string, unknown>), name: uniqueName } as T)
    );
  }

  return { nodes: next, hits, hitCount };
}
