/**
 * DNS 配置生成器
 *
 * 这一版 DNS 与内置规则同源（来自手动覆写脚本）：fake-ip + 境外 DoH 经代理出站，
 * 国内/私有域名走国内 DoH，本地域名钉死回环。
 */

import type { DNSConfig } from "@subboost/core/types/config";

export const DEFAULT_DNS_CONFIG: DNSConfig = {
  enable: true,
  // TUN 接管系统 DNS 后，把本地域名钉到回环，避免 localhost 解析失败
  hosts: {
    localhost: "127.0.0.1",
    "*.localhost": "127.0.0.1",
  },
  "cache-algorithm": "arc",
  // fake-ip 模式下关闭 AAAA，避免双栈应用绕过 fake-ip 走真实 IPv6 直连
  ipv6: false,
  // DNS 连接遵守路由规则：境外 DoH 经代理出站规避污染
  "respect-rules": true,
  "use-hosts": true,
  "use-system-hosts": true,
  "enhanced-mode": "fake-ip",
  "fake-ip-range": "198.18.0.1/16",
  "fake-ip-filter-mode": "blacklist",
  "fake-ip-filter": [
    // 局域网与本地反查
    "+.lan",
    "+.local",
    "+.localhost",
    "+.home.arpa",
    "+.in-addr.arpa",
    "+.ip6.arpa",
    "localhost",
    // STUN / WebRTC（P2P 需真实 IP）
    "stun.l.google.com",
    "stun1.l.google.com",
    "stun2.l.google.com",
    "stun3.l.google.com",
    "stun4.l.google.com",
    "+.stun.qq.com",
    "+.stun.miwifi.com",
    // Windows 网络连接检测
    "+.msftconnecttest.com",
    "+.msftncsi.com",
    "dns.msftncsi.com",
    // 路由器管理面板
    "+.miwifi.com",
    "+.routerlogin.com",
    "+.routerlogin.net",
    "+.tplinkwifi.net",
    "+.tplinklogin.net",
    "router.asus.com",
    // 时间同步
    "time.windows.com",
    "time.apple.com",
    "time-ios.apple.com",
    "time.cloud.tencent.com",
    "ntp.aliyun.com",
    "+.ntp.org",
    // Apple 强制门户检测
    "+.captive.apple.com",
    // QQ 本地登录
    "localhost.ptlogin2.qq.com",
    "localhost.sec.qq.com",
  ],
  // 引导 DNS，必须是纯 IP
  "default-nameserver": ["223.5.5.5", "119.29.29.29"],
  // 解析节点域名：只用国内可信 DoH
  "proxy-server-nameserver": ["https://223.5.5.5/dns-query#disable-ipv6=true"],
  // 仅控制 DIRECT 出站时的域名解析
  "direct-nameserver": ["system"],
  "direct-nameserver-follow-policy": false,
  // 默认 nameserver（境外 DoH，配合 respect-rules 经代理出站）
  nameserver: [
    "https://1.1.1.1/dns-query#disable-ipv6=true",
    "https://8.8.8.8/dns-query#disable-ipv6=true",
  ],
  "nameserver-policy": {
    // 国内 / 私有域名走国内 DoH
    "geosite:private,cn,geolocation-cn": [
      "https://223.5.5.5/dns-query#disable-ipv6=true",
      "https://119.29.29.29/dns-query#disable-ipv6=true",
    ],
  },
};
