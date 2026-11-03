type MemoryEntry = {
  value: string;
  expirationTtl?: number;
};

// 内存 KV 假实现，供单元测试使用（不模拟真实过期时间）
export class MemoryKV {
  private readonly entries = new Map<string, MemoryEntry>();
  readonly expirationTtls = new Map<string, number | undefined>();
  // 模拟 Workers 的「外部操作次数」：批量读算 1 次，与真实 KV 计费/限制口径一致
  operationCount = 0;

  async get(key: string | string[], type?: "text" | "json"): Promise<unknown> {
    this.operationCount += 1;

    if (Array.isArray(key)) {
      const result = new Map<string, unknown>();
      for (const item of key) {
        result.set(item, this.readEntry(item, type));
      }
      return result;
    }

    return this.readEntry(key, type);
  }

  private readEntry(key: string, type?: "text" | "json"): unknown {
    const entry = this.entries.get(key);
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

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void> {
    this.operationCount += 1;
    this.entries.set(key, { value, expirationTtl: options?.expirationTtl });
    this.expirationTtls.set(key, options?.expirationTtl);
  }

  async delete(key: string): Promise<void> {
    this.operationCount += 1;
    this.entries.delete(key);
    this.expirationTtls.delete(key);
  }

  async list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean }> {
    this.operationCount += 1;
    const prefix = options?.prefix ?? "";
    const keys = Array.from(this.entries.keys())
      .filter((key) => key.startsWith(prefix))
      .map((name) => ({ name }));
    return { keys, list_complete: true };
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  raw(key: string): string | undefined {
    return this.entries.get(key)?.value;
  }
}

export function createExecutionContext(): ExecutionContext {
  const promises: Promise<unknown>[] = [];
  return {
    waitUntil(promise: Promise<unknown>) {
      promises.push(promise);
    },
    passThroughOnException() {},
    props: {},
    promises,
  } as unknown as ExecutionContext;
}
