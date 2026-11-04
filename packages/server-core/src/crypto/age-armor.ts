import { fromBase64Padded, toBase64Padded } from "./bytes";

/**
 * age 的 ASCII armor：严格 PEM（RFC 7468 §3），标签大小写敏感、base64 带 `=` 填充。
 * 与报文内部的无填充 base64 不同，别混用。
 */

export const AGE_ARMOR_LABEL = "AGE ENCRYPTED FILE";
const BEGIN_LINE = `-----BEGIN ${AGE_ARMOR_LABEL}-----`;
const END_LINE = `-----END ${AGE_ARMOR_LABEL}-----`;
const LINE_WIDTH = 64;

export class AgeArmorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgeArmorError";
  }
}

/** 把二进制 age 文件编成 armor 文本（LF 换行，末尾带换行） */
export function armorAge(file: Uint8Array): string {
  const base64 = toBase64Padded(file);
  const lines: string[] = [BEGIN_LINE];
  for (let offset = 0; offset < base64.length; offset += LINE_WIDTH) {
    lines.push(base64.slice(offset, offset + LINE_WIDTH));
  }
  lines.push(END_LINE);
  return `${lines.join("\n")}\n`;
}

/**
 * 解码 armor。宽容：允许前后空白、CRLF；严格：拒绝块外杂质、非规范 base64、缺尾行。
 */
export function dearmorAge(text: string): Uint8Array {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  const lines = normalized.split("\n").map((line) => line.trim());

  if (lines[0] !== BEGIN_LINE) throw new AgeArmorError("缺少 AGE ENCRYPTED FILE 起始行");
  const endIndex = lines.indexOf(END_LINE);
  if (endIndex < 0) throw new AgeArmorError("缺少 AGE ENCRYPTED FILE 结束行");
  if (endIndex !== lines.length - 1) throw new AgeArmorError("armor 块之后还有其他内容");

  const body = lines.slice(1, endIndex);
  if (body.length === 0) throw new AgeArmorError("armor 内容为空");
  for (let index = 0; index < body.length; index += 1) {
    const line = body[index];
    if (line.length === 0) throw new AgeArmorError("armor 内容含空行");
    if (index < body.length - 1 && line.length !== LINE_WIDTH) {
      throw new AgeArmorError("armor 内容行宽不合法");
    }
    if (line.length > LINE_WIDTH) throw new AgeArmorError("armor 内容行宽不合法");
  }

  const joined = body.join("");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(joined)) throw new AgeArmorError("armor 内容不是规范 base64");

  const decoded = fromBase64Padded(joined);
  // 重新编码必须一致，否则说明填充/尾比特非规范
  if (toBase64Padded(decoded) !== joined) throw new AgeArmorError("armor 内容不是规范 base64");
  return decoded;
}
