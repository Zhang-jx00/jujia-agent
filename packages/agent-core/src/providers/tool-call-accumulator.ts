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

/**
 * 纯类型引用（T56）：`StreamEnd` 定义在 `types.ts`，而那边也要这里的 `AssembledToolCall`。
 * 两边都只 `import type`，编译后被完全擦除，不存在运行期循环依赖；
 * 仓里的 eslint 也没开 `import/no-cycle`（复核 088 记过一句：把类型放一处、别为了躲环复制第二套字面量 ——
 * 两套口径迟早只改一套，那才是真风险）。
 */
import type { StreamEnd } from './types';

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

  /**
   * 流结束后调用：产出可执行的完整调用列表（按 index 排序）。
   *
   * `end` 是**必填**的（T56 · R31）：这一格回答的是"参数到底是没送过来，还是这个工具本来就没参数"。
   * 判据只有一条 —— **`arguments` 一个字节的分片都没收到** 且 **流没有任何结束证据**
   * （既没有 `[DONE]` 也没有 `finish_reason`，即 `end === 'no_end_marker'`）时，
   * 不许把 `{}` 当成合法零参交给 `run_tool`：
   * 那种形状下用户会看见"工具执行成功"，而 `write_file` 一个字的内容都没收到。
   *
   * 为什么选"拒绝执行 + 说清原因"而不是"照旧当零参"：两种情况分不出来时，
   * 选**副作用小的那边**（与本项目"说不出真相就别说谎，也更别替模型动手"同一条纪律）。
   * 反过来，**有结束标记**时仍然按 `{}` 放行 —— 无参工具的网关常见形态就是不给 arguments，
   * 把它们一律打回是拿兼容换清白。
   */
  finish(end: StreamEnd): AssembledToolCall[] {
    return [...this.slots.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, slot]) => {
        let parsed: Record<string, unknown> | null = null;
        let parseError: string | null = null;
        const text = slot.args.trim();
        if (text === '') {
          if (end === 'no_end_marker') {
            parseError =
              '流在参数送过来之前就结束了（没收到任何 arguments 分片，也没有结束标记）—— ' +
              '这一次调用没有执行，因为无法区分"这个工具没有参数"与"参数还没送到"。请重发一次。';
          } else {
            parsed = {}; // 无参工具：合法的空对象（有结束证据才敢这么判）
          }
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
