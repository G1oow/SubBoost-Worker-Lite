import { describe, expect, it } from "vitest";
import type { AppState, ConfigPreview, DashboardStats } from "../lib/types";
import { createDemoBackend } from "./demo-backend";
import { DEMO_RENAMED_NODE } from "./demo-seed";

/**
 * 预览站的演示后端回归测试。
 *
 * 这里的断言对应预览站能不能用：种子数据能不能起来、真实路由有没有被复用、
 * 生成的订阅内容是不是合法 Clash 配置，以及「不联网、不持久化」这两条底线。
 */

const ORIGIN = "http://preview.example.com";
const VALID_MANUAL_TEXT = `ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@temp.example.com:8388#${encodeURIComponent("临时节点")}`;

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function createBackend() {
  return createDemoBackend({ origin: ORIGIN });
}

function putSources(
  backend: ReturnType<typeof createBackend>,
  sources: Array<Record<string, unknown>>
): Promise<Response> {
  return backend.dispatch("/api/sources", {
    method: "PUT",
    body: JSON.stringify({ sources }),
  });
}

describe("演示模式后端", () => {
  it("首次请求就准备好演示源、订阅与刷新状态", async () => {
    const backend = createBackend();
    const response = await backend.dispatch("/api/state");
    expect(response.status).toBe(200);

    const state = await readJson<AppState>(response);
    expect(state.sources.map((source) => source.enabled)).toEqual([true, true, false]);
    expect(state.sources[0].manualText).toContain("ss://");
    // 演示源全部使用 example.com 保留域名，公开预览站不含可识别信息
    expect(state.sources[0].manualText).toContain("example.com");
    expect(state.subscriptions).toHaveLength(2);
    expect(state.subscriptions[0].link.startsWith(`${ORIGIN}/sub/`)).toBe(true);
    expect(state.status?.lastTrigger).toBe("manual");
    expect(state.status?.sources.filter((item) => item.ok)).toHaveLength(2);
  });

  it("仪表板统计与订阅出站内容都来自真实路由", async () => {
    const backend = createBackend();
    const stats = await readJson<DashboardStats>(await backend.dispatch("/api/dashboard"));
    // 两个启用的手动源：4 + 2 个节点，停用源不计入
    expect(stats.sources.total).toBe(3);
    expect(stats.sources.enabled).toBe(2);
    expect(stats.nodes.total).toBe(6);

    const state = await readJson<AppState>(await backend.dispatch("/api/state"));
    const subscription = await backend.dispatch(state.subscriptions[0].link);
    expect(subscription.status).toBe(200);

    const yaml = await subscription.text();
    expect(yaml).toContain("proxies:");
    // 源上配置的节点改名要在最终配置里生效
    expect(yaml).toContain(DEMO_RENAMED_NODE);
    // 停用的源不参与生成
    expect(yaml).not.toContain("paused-01.example.com");
  });

  it("写操作只落在内存里，重建后端即回到初始种子", async () => {
    const backend = createBackend();
    await backend.dispatch("/api/state");

    const saved = await putSources(backend, [
      { name: "临时源", kind: "manual", manualText: VALID_MANUAL_TEXT, enabled: true },
    ]);
    expect(saved.status).toBe(200);

    const afterSave = await readJson<AppState>(await backend.dispatch("/api/state"));
    expect(afterSave.sources).toHaveLength(1);

    const restarted = await readJson<AppState>(await createBackend().dispatch("/api/state"));
    expect(restarted.sources).toHaveLength(3);
  });

  it("生成配置页的试生成走真实路由，只读不落盘", async () => {
    const backend = createBackend();
    const state = await readJson<AppState>(await backend.dispatch("/api/state"));
    const draft = {
      ...state.config,
      customRules: [{ id: "demo", type: "DOMAIN-SUFFIX", value: "example.org", target: "DIRECT" }],
    };

    const response = await backend.dispatch("/api/config/preview", {
      method: "POST",
      body: JSON.stringify({ config: draft }),
    });
    expect(response.status).toBe(200);
    const preview = await readJson<ConfigPreview>(response);
    // 节点来自种子刷新后的快照：两个启用源共 6 个节点
    expect(preview.nodeCount).toBe(6);
    expect(preview.rules).toContain("DOMAIN-SUFFIX,example.org,DIRECT");
    // 三条演示链：同源两跳与跨源都能生成，第三条故意匹配不到落地
    expect(preview.chains.map((chain) => chain.status)).toEqual(["ok", "ok", "empty-landing"]);
    expect(preview.chains.map((chain) => chain.name)).toEqual([
      "⛓ 演示本地两跳链",
      "🇺🇸 演示跨源链",
      "🇩🇪 演示失效链",
    ]);

    const after = await readJson<AppState>(await backend.dispatch("/api/state"));
    // 演示种子写入过链式代理配置，所以不再是「默认配置」
    expect(after.configIsDefault).toBe(false);
  });

  it("不向外部发起请求：远程源刷新直接失败而不是真的去抓", async () => {
    const backend = createBackend();
    await backend.dispatch("/api/state");

    const saved = await putSources(backend, [
      {
        name: "远程示例源",
        kind: "remote",
        url: "https://example.com/sub?token=placeholder",
        enabled: true,
      },
    ]);
    expect(saved.status).toBe(200);

    const refreshed = await readJson<{ status: AppState["status"] }>(
      await backend.dispatch("/api/refresh", { method: "POST" })
    );
    expect(refreshed.status?.sources[0]).toMatchObject({ ok: false, error: "HTTP 403" });
  });
});
