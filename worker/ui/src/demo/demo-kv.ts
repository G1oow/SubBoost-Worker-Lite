type MemoryEntry = {
  value: string;
  expirationTtl?: number;
};

/**
 * 演示模式用的内存 KV：只实现 Worker 实际用到的 KVNamespace 子集。
 *
 * 数据存放在当前页面的内存里，刷新即重置，也不会写进 localStorage，
 * 因此公开预览站上不会残留任何访问者输入的内容。
 * 过期时间仅记录不生效——演示数据的生命周期本来就只有一次页面会话。
 */
export function createDemoKv(): KVNamespace {
  const entries = new Map<string, MemoryEntry>();

  function readEntry(key: string, type?: "text" | "json"): unknown {
    const entry = entries.get(key);
    if (!entry) return null;
    if (type === "json") {
      try {
        return JSON.parse(entry.value);
      } catch {
        return null;
      }
    }
    return entry.value;
  }

  const kv = {
    async get(key: string | string[], type?: "text" | "json"): Promise<unknown> {
      // 与 Workers 一致：传数组时返回 Map，未命中的 key 值为 null
      if (Array.isArray(key)) {
        const result = new Map<string, unknown>();
        for (const item of key) result.set(item, readEntry(item, type));
        return result;
      }
      return readEntry(key, type);
    },

    async put(
      key: string,
      value: string,
      options?: { expirationTtl?: number }
    ): Promise<void> {
      entries.set(key, { value, expirationTtl: options?.expirationTtl });
    },

    async delete(key: string): Promise<void> {
      entries.delete(key);
    },

    async list(options?: { prefix?: string }): Promise<{
      keys: Array<{ name: string }>;
      list_complete: boolean;
    }> {
      const prefix = options?.prefix ?? "";
      return {
        keys: Array.from(entries.keys())
          .filter((key) => key.startsWith(prefix))
          .map((name) => ({ name })),
        list_complete: true,
      };
    },
  };

  return kv as unknown as KVNamespace;
}
