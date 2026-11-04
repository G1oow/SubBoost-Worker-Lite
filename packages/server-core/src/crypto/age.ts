import { decodeAgeRecipient, decodeAgeSecretKey } from "./bech32";
import {
  bytesEqual,
  concatBytes,
  fromBase64NoPad,
  isAllZero,
  randomBytes,
  toBase64NoPad,
  utf8Encode,
} from "./bytes";
import { AEAD_TAG_BYTES, open, seal } from "./chacha20-poly1305";
import { hkdfSha256, hmacSha256 } from "./hkdf";
import { x25519, x25519PublicKeyFromSecret } from "./x25519";

/**
 * age v1 文件格式（c2sp.org/age）。
 *
 * 这里只实现 X25519 recipient：
 *
 *     age-encryption.org/v1
 *     -> X25519 <ephemeral share>
 *     <wrapped file key>
 *     --- <header MAC>
 *     <16 字节随机 nonce><STREAM 分块密文>
 *
 * 关键细节（照着规范，不能凭直觉改）：
 * - header MAC 是**完整**的 HMAC-SHA-256（32 字节，43 列 base64），不截断；
 * - header MAC 的 HKDF salt 是**空**，info 是 "header"；
 * - 报文里所有 base64 都是「标准字母表 + 无填充」；
 * - payload key 的 HKDF salt 是 payload 开头的 16 字节随机 nonce；
 * - STREAM 的 nonce = 11 字节大端块计数 + 1 字节「是否末块」标志。
 */

export const AGE_VERSION_LINE = "age-encryption.org/v1";
/** 一次加密的 recipient 上限：每把要两次 X25519 标量乘，不设上限会被请求拖慢 */
export const MAX_AGE_RECIPIENTS = 8;

const FILE_KEY_BYTES = 16;
const CHUNK_BYTES = 64 * 1024;
const PAYLOAD_NONCE_BYTES = 16;
const HEADER_MAC_BYTES = 32;
const STANZA_TYPE = "X25519";
const MAC_LINE_PREFIX = "--- ";
const WRAP_INFO = utf8Encode("age-encryption.org/v1/X25519");
const HEADER_INFO = utf8Encode("header");
const PAYLOAD_INFO = utf8Encode("payload");
const ZERO_NONCE = new Uint8Array(12);
const EMPTY = new Uint8Array(0);

export class AgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgeError";
  }
}

export type AgeStanza = {
  type: string;
  args: string[];
  body: Uint8Array;
};

export type ParsedAgeHeader = {
  stanzas: AgeStanza[];
  mac: Uint8Array;
  /** 参与 MAC 计算的原文：从版本行到 `---`（不含其后的空格与 MAC） */
  authenticated: Uint8Array;
  /** payload 在文件里的起始偏移 */
  payloadOffset: number;
};

function asciiLine(bytes: Uint8Array, start: number, end: number): string {
  let text = "";
  for (let index = start; index < end; index += 1) text += String.fromCharCode(bytes[index]);
  return text;
}

function indexOfNewline(bytes: Uint8Array, from: number): number {
  for (let index = from; index < bytes.byteLength; index += 1) {
    if (bytes[index] === 0x0a) return index;
  }
  return -1;
}

function streamNonce(counter: number, isFinal: boolean): Uint8Array {
  const nonce = new Uint8Array(12);
  let rest = counter;
  for (let index = 10; index >= 0; index -= 1) {
    nonce[index] = rest & 0xff;
    rest = Math.floor(rest / 256);
  }
  nonce[11] = isFinal ? 1 : 0;
  return nonce;
}

/** 解析 age 文件头；结构不符合 v1 规范时抛 AgeError */
export function parseAgeHeader(file: Uint8Array): ParsedAgeHeader {
  const versionEnd = indexOfNewline(file, 0);
  if (versionEnd < 0) throw new AgeError("age 报文缺少版本行");
  if (asciiLine(file, 0, versionEnd) !== AGE_VERSION_LINE) {
    throw new AgeError("不是 age v1 报文");
  }

  const stanzas: AgeStanza[] = [];
  let offset = versionEnd + 1;

  while (true) {
    const lineEnd = indexOfNewline(file, offset);
    if (lineEnd < 0) throw new AgeError("age 报文头不完整");

    if (asciiLine(file, offset, lineEnd).startsWith(MAC_LINE_PREFIX)) {
      const macText = asciiLine(file, offset + MAC_LINE_PREFIX.length, lineEnd);
      if (macText.length !== 43) throw new AgeError("age header MAC 长度不合法");
      const mac = fromBase64NoPad(macText);
      if (mac.byteLength !== HEADER_MAC_BYTES) throw new AgeError("age header MAC 长度不合法");
      return {
        stanzas,
        mac,
        authenticated: file.subarray(0, offset + MAC_LINE_PREFIX.length - 1),
        payloadOffset: lineEnd + 1,
      };
    }

    const argLine = asciiLine(file, offset, lineEnd);
    if (!argLine.startsWith("-> ")) throw new AgeError("age 报文头结构不合法");
    const args = argLine.slice(3).split(" ");
    if (args.length < 1 || args.some((arg) => arg.length === 0)) {
      throw new AgeError("age recipient stanza 参数不合法");
    }

    // stanza 正文是 64 列 base64，最后一行必然短于 64 列（可以为空）
    const bodyLines: string[] = [];
    let cursor = lineEnd + 1;
    while (true) {
      const bodyEnd = indexOfNewline(file, cursor);
      if (bodyEnd < 0) throw new AgeError("age recipient stanza 正文不完整");
      const bodyLine = asciiLine(file, cursor, bodyEnd);
      if (bodyLine.length > 64) throw new AgeError("age recipient stanza 正文行过长");
      if (bodyLine.length > 0) bodyLines.push(bodyLine);
      cursor = bodyEnd + 1;
      if (bodyLine.length < 64) break;
    }

    stanzas.push({
      type: args[0],
      args,
      body: bodyLines.length > 0 ? fromBase64NoPad(bodyLines.join("")) : new Uint8Array(0),
    });
    offset = cursor;
  }
}

function toSecretKeyBytes(identity: string | Uint8Array): Uint8Array {
  if (identity instanceof Uint8Array) {
    if (identity.byteLength !== 32) throw new AgeError("age 私钥必须是 32 字节");
    return identity;
  }
  try {
    return decodeAgeSecretKey(identity);
  } catch (err) {
    throw new AgeError(err instanceof Error ? err.message : "age 私钥不合法");
  }
}

/** 用给定 identity 解封 file key；stanza 结构不合法时直接失败，而不是静默跳过 */
export async function unwrapAgeFileKey(
  header: ParsedAgeHeader,
  identities: Array<string | Uint8Array>
): Promise<Uint8Array> {
  const secrets = identities.map((identity) => toSecretKeyBytes(identity));

  for (const stanza of header.stanzas) {
    if (stanza.type !== STANZA_TYPE) continue;
    if (stanza.args.length !== 2) throw new AgeError("X25519 stanza 参数个数不合法");
    const share = fromBase64NoPad(stanza.args[1]);
    if (share.byteLength !== 32) throw new AgeError("X25519 stanza 的 ephemeral share 长度不合法");
    if (stanza.body.byteLength !== 32) throw new AgeError("X25519 stanza 正文长度不合法");

    for (const secret of secrets) {
      const shared = x25519(secret, share);
      // 规范要求：共享密钥全零（低阶点）时必须中止，而不是继续尝试
      if (isAllZero(shared)) throw new AgeError("X25519 共享密钥为全零，拒绝解封");
      const publicKey = x25519PublicKeyFromSecret(secret);
      const wrapKey = await hkdfSha256(shared, concatBytes(share, publicKey), WRAP_INFO);
      const fileKey = open(wrapKey, ZERO_NONCE, stanza.body);
      if (fileKey) {
        if (fileKey.byteLength !== FILE_KEY_BYTES) throw new AgeError("file key 长度不合法");
        return fileKey;
      }
    }
  }

  throw new AgeError("没有匹配的 age 私钥");
}

/** 校验 header MAC；不通过说明 header 被篡改过 */
export async function verifyAgeHeaderMac(
  header: ParsedAgeHeader,
  fileKey: Uint8Array
): Promise<void> {
  const macKey = await hkdfSha256(fileKey, EMPTY, HEADER_INFO);
  const expected = await hmacSha256(macKey, header.authenticated);
  if (!bytesEqual(expected, header.mac)) throw new AgeError("age header MAC 校验失败");
}

/**
 * 加密 payload：`nonce || 分块密文`。
 * `nonce` 只在测试里显式传入（用于和官方 testkit 向量逐字节对齐），线上永远随机生成。
 */
export async function encryptAgePayload(
  fileKey: Uint8Array,
  plaintext: Uint8Array,
  nonce: Uint8Array = randomBytes(PAYLOAD_NONCE_BYTES)
): Promise<Uint8Array> {
  if (fileKey.byteLength !== FILE_KEY_BYTES) throw new AgeError("file key 必须是 16 字节");
  if (nonce.byteLength !== PAYLOAD_NONCE_BYTES) throw new AgeError("payload nonce 必须是 16 字节");

  const payloadKey = await hkdfSha256(fileKey, nonce, PAYLOAD_INFO);
  const chunkCount = Math.max(1, Math.ceil(plaintext.byteLength / CHUNK_BYTES));
  const parts: Uint8Array[] = [nonce];

  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * CHUNK_BYTES;
    const chunk = plaintext.subarray(start, Math.min(start + CHUNK_BYTES, plaintext.byteLength));
    parts.push(seal(payloadKey, streamNonce(index, index === chunkCount - 1), chunk));
  }

  return concatBytes(...parts);
}

/** 解密 payload；任何一块认证失败或数据截断都抛错 */
export async function decryptAgePayload(
  fileKey: Uint8Array,
  payload: Uint8Array
): Promise<Uint8Array> {
  if (fileKey.byteLength !== FILE_KEY_BYTES) throw new AgeError("file key 必须是 16 字节");
  if (payload.byteLength < PAYLOAD_NONCE_BYTES + AEAD_TAG_BYTES) {
    throw new AgeError("age payload 过短");
  }

  const nonce = payload.subarray(0, PAYLOAD_NONCE_BYTES);
  const payloadKey = await hkdfSha256(fileKey, nonce, PAYLOAD_INFO);
  const parts: Uint8Array[] = [];

  let offset = PAYLOAD_NONCE_BYTES;
  let index = 0;
  while (offset < payload.byteLength) {
    const remaining = payload.byteLength - offset;
    const isFinal = remaining <= CHUNK_BYTES + AEAD_TAG_BYTES;
    // 非末块必须正好是 64 KiB 明文 + tag，长度不对说明被截断或拼接过
    const take = isFinal ? remaining : CHUNK_BYTES + AEAD_TAG_BYTES;
    const opened = open(
      payloadKey,
      streamNonce(index, isFinal),
      payload.subarray(offset, offset + take)
    );
    if (!opened) throw new AgeError("age payload 认证失败");
    if (isFinal && opened.byteLength === 0 && index > 0) {
      throw new AgeError("age payload 末块不能为空");
    }
    parts.push(opened);
    offset += take;
    index += 1;
  }

  if (index === 0) throw new AgeError("age payload 缺少数据块");
  return concatBytes(...parts);
}

export type EncryptAgeOptions = {
  plaintext: string | Uint8Array;
  /** `age1…` 公钥列表，任意一个对应私钥都能解开 */
  recipients: string[];
};

/** 生成 age 密文（header + payload） */
export async function encryptAge(options: EncryptAgeOptions): Promise<Uint8Array> {
  const plaintext =
    typeof options.plaintext === "string" ? utf8Encode(options.plaintext) : options.plaintext;
  const recipients = options.recipients.map((recipient) => recipient.trim()).filter(Boolean);
  if (recipients.length === 0) throw new AgeError("至少需要一个 age 公钥");
  if (recipients.length > MAX_AGE_RECIPIENTS) {
    throw new AgeError(`最多支持 ${MAX_AGE_RECIPIENTS} 个 age 公钥`);
  }

  const recipientKeys = recipients.map((recipient) => {
    try {
      return decodeAgeRecipient(recipient);
    } catch (err) {
      throw new AgeError(err instanceof Error ? err.message : "age 公钥不合法");
    }
  });

  const fileKey = randomBytes(FILE_KEY_BYTES);
  const lines: string[] = [AGE_VERSION_LINE];

  for (const recipientKey of recipientKeys) {
    // 每个 stanza 用独立的 ephemeral secret（规范强制要求）
    const ephemeralSecret = randomBytes(32);
    const share = x25519PublicKeyFromSecret(ephemeralSecret);
    const shared = x25519(ephemeralSecret, recipientKey);
    if (isAllZero(shared)) throw new AgeError("age 公钥无效（共享密钥为全零）");
    const wrapKey = await hkdfSha256(shared, concatBytes(share, recipientKey), WRAP_INFO);
    lines.push(
      `-> ${STANZA_TYPE} ${toBase64NoPad(share)}`,
      toBase64NoPad(seal(wrapKey, ZERO_NONCE, fileKey))
    );
  }

  const authenticated = utf8Encode(`${lines.join("\n")}\n---`);
  const macKey = await hkdfSha256(fileKey, EMPTY, HEADER_INFO);
  const mac = await hmacSha256(macKey, authenticated);
  const header = concatBytes(authenticated, utf8Encode(` ${toBase64NoPad(mac)}\n`));

  return concatBytes(header, await encryptAgePayload(fileKey, plaintext));
}

/**
 * 解密 age 文件（校验 header MAC + 逐块认证）。
 * 线上不提供解密接口，这里给测试与本地自检用。
 */
export async function decryptAgeFile(
  file: Uint8Array,
  identities: Array<string | Uint8Array>
): Promise<Uint8Array> {
  const header = parseAgeHeader(file);
  const fileKey = await unwrapAgeFileKey(header, identities);
  await verifyAgeHeaderMac(header, fileKey);
  return decryptAgePayload(fileKey, file.subarray(header.payloadOffset));
}

/** 是否是合法的 `age1…` 公钥 */
export function isAgeRecipient(value: string): boolean {
  try {
    decodeAgeRecipient(value.trim());
    return true;
  } catch {
    return false;
  }
}
