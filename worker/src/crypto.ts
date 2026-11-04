export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

// HKDF 参数固定，保证同一 secret 派生结果稳定
const HKDF_SALT = "subboost-worker-lite:v1";
const HKDF_INFO = "aes-256-gcm";
const KEY_CACHE = new Map<string, Promise<CryptoKey>>();

// 复制到独立的 ArrayBuffer，避免 TS 6 下 Uint8Array<ArrayBufferLike> 与 BufferSource 的类型不兼容
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new CryptoError("密文格式不正确");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + "=".repeat(padLength));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function deriveKey(secret: string): Promise<CryptoKey> {
  if (!secret) throw new CryptoError("加密密钥不能为空");
  const cached = KEY_CACHE.get(secret);
  if (cached) return cached;

  const promise = (async () => {
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      "HKDF",
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new TextEncoder().encode(HKDF_SALT),
        info: new TextEncoder().encode(HKDF_INFO),
      },
      material,
      256
    );
    return crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
  })();

  KEY_CACHE.set(secret, promise);
  try {
    return await promise;
  } catch (err) {
    KEY_CACHE.delete(secret);
    throw err;
  }
}

export async function encryptString(plain: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(new TextEncoder().encode(plain))
  );
  return `v1:${toBase64Url(iv)}:${toBase64Url(new Uint8Array(cipher))}`;
}

export async function decryptString(cipher: string, secret: string): Promise<string> {
  const parts = cipher.split(":");
  if (parts.length !== 3 || parts[0] !== "v1") throw new CryptoError("密文格式不正确");
  let iv: Uint8Array;
  let data: Uint8Array;
  try {
    iv = fromBase64Url(parts[1]);
    data = fromBase64Url(parts[2]);
  } catch {
    throw new CryptoError("密文格式不正确");
  }
  if (iv.byteLength !== 12 || data.byteLength < 16) throw new CryptoError("密文格式不正确");

  const key = await deriveKey(secret);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(data)
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new CryptoError("解密失败");
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function generateToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * 短链码：6 字节 base64url，固定 8 字符（48 bit 熵）。
 * 字符集与 token 一致（[A-Za-z0-9_-]），可直接放进 URL 路径。
 */
export function generateShortCode(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(6)));
}

export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [hashA, hashB] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let index = 0; index < hashA.length; index += 1) {
    diff |= hashA.charCodeAt(index) ^ hashB.charCodeAt(index);
  }
  // 长度不等时同样返回 false，但比较过程不提前退出
  return diff === 0 && a.length === b.length;
}

