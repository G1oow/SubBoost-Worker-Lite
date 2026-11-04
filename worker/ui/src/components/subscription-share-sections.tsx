import { BookOpen, Check, Copy, Lock, ShieldAlert } from "lucide-react";
import { Button } from "@subboost/ui/components/ui/button";
import { Icon } from "@subboost/ui/components/ui/icon";
import { AGE_ENCRYPTION_DOC_URL } from "../lib/docs-links";
import { buildAgeLinks, buildImportLinks } from "../lib/share-links";
import type { AgeCapabilities } from "../lib/types";

/**
 * 订阅分享相关的两个内容区块。
 * 分享弹窗、一键导入弹窗、age 加密弹窗都复用这里，避免同一段 JSX 抄三份。
 */

/** 一键导入：每个客户端一个深链按钮，服务端收到 `?target=<id>` 后 302 到对应 scheme */
export function ImportLinksSection({
  link,
  heading = true,
}: {
  link: string;
  /** 弹窗自己已经有同名标题时传 false，避免「一键导入」出现两次 */
  heading?: boolean;
}) {
  const hint = "手机上点按直接唤起对应客户端；桌面端请复制链接。";
  return (
    <div className="space-y-2">
      {heading ? (
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-fg-70">一键导入</p>
          <p className="text-xs text-fg-45">{hint}</p>
        </div>
      ) : (
        <p className="text-xs text-fg-45">{hint}</p>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {buildImportLinks(link).map((item) => (
          <Button key={item.id} asChild variant="secondary" size="sm">
            <a href={item.href}>{item.label}</a>
          </Button>
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-fg-45">
        微信 / QQ 等应用内浏览器会拦截自定义 scheme，拉不起来时改用「复制链接」。
      </p>
    </div>
  );
}

/** AGE_ONLY 模式下的说明：此时一键导入没有意义 */
export function AgeOnlyNotice() {
  return (
    <p className="flex items-start gap-1.5 rounded-xl border border-ink/10 bg-ink/5 px-3 py-2 text-xs text-fg-60">
      <Icon icon={Lock} size="sm" className="mt-px shrink-0" />
      <span>当前实例只输出 age 密文：客户端无法直接导入，需要先用私钥解密成 YAML 再导入。</span>
    </p>
  );
}

/** AGE_RECIPIENT 配错时的提示 */
export function AgeMisconfiguredNotice() {
  return (
    <p className="flex items-start gap-1.5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
      <Icon icon={ShieldAlert} size="sm" className="mt-px shrink-0" />
      <span>AGE_RECIPIENT 配置无效，age 加密通道已关闭；请检查 Worker 上的 age 公钥。</span>
    </p>
  );
}

export type AgeSectionProps = {
  link: string;
  age: AgeCapabilities;
  /** 加密链接刚复制成功 */
  copied?: boolean;
  onCopy?: () => void;
};

/** age 加密链接区块：链接 + 复制 + 公钥指纹 + 解密说明 */
export function AgeSection({ link, age, copied = false, onCopy }: AgeSectionProps) {
  return (
    <div className="space-y-2 rounded-xl border border-ink/10 bg-ink/5 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-fg-70">age 加密订阅</p>
        <Button type="button" variant="secondary" size="sm" onClick={onCopy}>
          {copied ? (
            <Icon icon={Check} className="animate-icon-pop text-emerald-400" />
          ) : (
            <Icon icon={Copy} />
          )}
          {copied ? "已复制" : "复制加密链接"}
        </Button>
      </div>
      <p className="select-all break-all rounded-lg border border-ink/10 bg-surface px-2 py-1 font-mono text-[11px] leading-relaxed text-fg-60">
        {buildAgeLinks(link).binary}
      </p>
      <p className="text-[11px] leading-relaxed text-fg-45">
        公钥{" "}
        {age.recipients
          .map((recipient) => `${recipient.slice(0, 12)}…${recipient.slice(-4)}`)
          .join("、")}
        ，下载后执行 <code>age -d -i key.txt</code> 解密即可导入。
      </p>
    </div>
  );
}

/**
 * 还没配公钥时的引导：说明还差什么，并直接给部署文档地址。
 * 「点开 age 加密按钮 → 弹窗里看到文档入口」就是靠这个组件。
 */
export function AgeSetupHint() {
  return (
    <div className="space-y-2 rounded-xl border border-ink/10 bg-ink/5 px-3 py-2.5">
      <p className="text-xs leading-relaxed text-fg-60">
        这台 Worker 还没配置 age 公钥，所以暂时只能输出明文 YAML。
      </p>
      <p className="text-xs leading-relaxed text-fg-45">
        在环境变量里设置 <code className="font-mono">AGE_RECIPIENT=age1…</code> 即可开启加密输出，
        私钥由你自己在本机生成与保管。
      </p>
      <Button asChild variant="secondary" size="sm">
        <a href={AGE_ENCRYPTION_DOC_URL} target="_blank" rel="noreferrer noopener">
          <Icon icon={BookOpen} />
          查看部署与使用文档
        </a>
      </Button>
    </div>
  );
}
