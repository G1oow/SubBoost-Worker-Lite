import {
  resolveClientProfileUpdateIntervalSeconds,
  type SubscriptionResponseInfo,
} from "@subboost/core/subscription/subscription-response-info";

type BuildSubscriptionResponseHeadersOptions = {
  cacheControl?: string;
  cacheExpirySeconds?: number;
  autoUpdateIntervalSeconds?: number | null;
  isAdmin: boolean;
  /** 附件名后缀，例如 age 加密输出要加 `.yaml.age` */
  fileNameSuffix?: string;
};

function normalizeHeaderFileNameBase(name: string): string {
  return (
    String(name || "config")
      .trim()
      .replace(/[\r\n"]/g, "")
      .replace(/\.(?:ya?ml)$/i, "")
      .slice(0, 80) || "config"
  );
}

function normalizeAsciiFileNameBase(name: string): string {
  return (
    name
      // 仅保留可打印 ASCII，避免部分客户端忽略 filename* 时出现乱码。
      .replace(/[^\x20-\x7E]+/g, "")
      // 去掉 Windows/macOS 常见非法文件名字符。
      .replace(/[<>:"/\\|?*]+/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 60) || "config"
  );
}

function serializeSubscriptionUserInfo(subscriptionInfo: SubscriptionResponseInfo): string | null {
  const parts: string[] = [];
  if (subscriptionInfo.upload !== undefined) parts.push(`upload=${subscriptionInfo.upload}`);
  if (subscriptionInfo.download !== undefined) parts.push(`download=${subscriptionInfo.download}`);
  if (subscriptionInfo.total !== undefined) parts.push(`total=${subscriptionInfo.total}`);
  if (subscriptionInfo.expire !== undefined) parts.push(`expire=${subscriptionInfo.expire}`);
  return parts.length > 0 ? parts.join("; ") : null;
}

function buildContentDisposition(name: string, suffix = ""): string {
  const safeNameBase = `${normalizeHeaderFileNameBase(name)}${suffix}`;
  const asciiFileNameBase = normalizeAsciiFileNameBase(safeNameBase);
  const encodedFileName = encodeURIComponent(safeNameBase);
  if (asciiFileNameBase === safeNameBase) {
    return `attachment; filename=\"${asciiFileNameBase}\"; filename*=UTF-8''${encodedFileName}`;
  }
  return `attachment; filename*=UTF-8''${encodedFileName}`;
}

export function buildSubscriptionResponseHeaders(
  name: string,
  subscriptionInfo: SubscriptionResponseInfo,
  options: BuildSubscriptionResponseHeadersOptions
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "text/yaml;charset=utf-8",
    // 订阅客户端可能把 filename 当作订阅显示名，响应头不要补 .yaml。
    "content-disposition": buildContentDisposition(name, options.fileNameSuffix),
    "cache-control": options.cacheControl ?? "no-cache",
  };

  const recommendedIntervalSeconds = resolveClientProfileUpdateIntervalSeconds({
    cacheExpirySeconds: options.cacheExpirySeconds,
    autoUpdateIntervalSeconds: options.autoUpdateIntervalSeconds,
    isAdmin: options.isAdmin,
  });
  if (typeof recommendedIntervalSeconds === "number" && Number.isFinite(recommendedIntervalSeconds)) {
    headers["profile-update-interval"] = String(Math.max(1, Math.ceil(recommendedIntervalSeconds / 3600)));
  }

  const userInfoHeader = serializeSubscriptionUserInfo(subscriptionInfo);
  if (userInfoHeader) headers["subscription-userinfo"] = userInfoHeader;
  if (subscriptionInfo.profileWebPageUrl) headers["profile-web-page-url"] = subscriptionInfo.profileWebPageUrl;
  if (subscriptionInfo.planName) headers["plan-name"] = subscriptionInfo.planName;

  return headers;
}
