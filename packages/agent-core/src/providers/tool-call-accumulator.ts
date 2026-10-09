/**
 * 流式 tool_calls 拼装器。
 *
 * 规则来自 2026-09-18 联网核实（见 knowledge/cards/011）：
 * 1. 按 `index` 归位，**不能按到达顺序 append**——交错返回多个调用时会参数错位；
 * 2. `function.name` 也可能分片，必须**串接**而不是赋值；
 * 3. `arguments` 是分片拼出的 JSON 字符串，只有 `finish_reason === 'tool_calls'`
 *    （或流结束时）才合法，提前 parse 必然失败；
 * 4. 首帧通常只有 role、没有 content。
 */

export interface ToolCallDelta {
  /**
   * OpenAI 协议里必填，但**兼容网关常省略**（外部审查 T28）。
   * 省略时按"这一片在帧内的位置"归位 —— 不是恒归 slot 0：
   * 同一帧给多个调用时，恒 0 会把 name 与 arguments 串成一个调用（参数错乱，
   * 而表面上"调用成功了"，比报错更难查）。
   */
  index?: number | undefined;
  id?: string | undefined;
  function?: { name?: string | undefined; arguments?: string | undefined } | undefined;
}

export interface AssembledToolCall {
  index: number;
  id: string;
  name: string;
  /** 原始 JSON 字符串（**未解析**，解析由调用方在流结束后进行） */
  argumentsText: string;
  /** 仅在能解析时才给出；解析失败为 null，由调用方决定如何回传给模型 */
  arguments: Record<string, unknown> | null;
  /** 解析失败原因（若有） */
  parseError: string | null;
}

export class ToolCallAccumulator {
  private readonly slots = new Map<number, { id: string; name: string; args: string }>();

  /** 喂入一帧里的 tool_calls 片段（可以是空数组/undefined） */
  push(deltas: ReadonlyArray<ToolCallDelta> | undefined): void {
    if (!deltas) return;
    for (const [position, d] of deltas.entries()) {
      // 省略 index 的网关：按**帧内位置**归位（T28）。恒归 slot 0 会让同帧的多个调用串成一个。
      const raw = d.index;
      const index = typeof raw === 'number' && Number.isFinite(raw) ? raw : position;
      const slot = this.slots.get(index) ?? { id: '', name: '', args: '' };
      if (d.id) slot.id = d.id;
      const fn = d.function;
      if (fn?.name) slot.name += fn.name; // 关键：串接
      if (fn?.arguments) slot.args += fn.arguments;
      this.slots.set(index, slot);
    }
  }

  hasCalls(): boolean {
    return this.slots.size > 0;
  }

  /** 流结束后调用：产出可执行的完整调用列表（按 index 排序） */
  finish(): AssembledToolCall[] {
    return [...this.slots.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, slot]) => {
        let parsed: Record<string, unknown> | null = null;
        let parseError: string | null = null;
        const text = slot.args.trim();
        if (text === '') {
          parsed = {}; // 无参工具：合法的空对象
        } else {
          try {
            const value: unknown = JSON.parse(text);
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
              parsed = value as Record<string, unknown>;
            } else {
              parseError = '参数不是 JSON 对象';
            }
          } catch (err) {
            parseError = err instanceof Error ? err.message : String(err);
          }
        }
        return {
          index,
          id: slot.id || `call_${index}`,
          name: slot.name,
          argumentsText: slot.args,
          arguments: parsed,
          parseError,
        };
      });
  }

  reset(): void {
    this.slots.clear();
  }
}
