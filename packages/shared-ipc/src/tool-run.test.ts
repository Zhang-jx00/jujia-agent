import { describe, expect, it } from 'vitest';
import { toolRunSchema } from './contracts-tool';

/**
 * T43：`TOOL_RUN` 的**入参**契约（2026-10-14 审计清零批）。
 *
 * 症状与 T30 那条一模一样，只是漏的是手动执行这条通道：主进程里手写
 * `typeof toolName !== 'string'`，`args` 则以 `unknown` 身份**直接进 `runTool`**，
 * 靠下游各工具自己的 `tool.parse` 兜 —— 于是：
 * ① 工具名没有长度上限（其它通道同族字段都有：连接 128 / 会话 64）；
 * ② `args` 给成数组、字符串、null 时，报错来自 provider 侧的 zod 原文，
 *    而不是"这一条通道的参数不合法" —— 同一种错，两处不同说法，正是本仓反复修的口径差。
 *
 * 这里钉四件事：① 形状判定**只在这一处**；② 超限是拒绝不是截断；
 * ③ `args` 允许省略（preload 的调用方都传对象，但通道本身不该把"没参数"当成非法）；
 * ④ 契约**不替代**各工具自己的 `tool.parse` —— 字段含义只有工具自己知道，
 *    这里只管"是不是一个扁平的对象"。
 */

describe('toolRunSchema（手动执行工具的入站契约）', () => {
  it('正常一条通过：工具名 + 参数对象', () => {
    const r = toolRunSchema.safeParse({ toolName: 'list_dir', args: { path: '.', maxEntries: 500 } });
    expect(r.success).toBe(true);
  });

  it('args 可以省略（等价于"这个工具不收参数"）', () => {
    expect(toolRunSchema.safeParse({ toolName: 'list_dir' }).success).toBe(true);
  });

  it('空工具名 / 非字符串工具名被拒，理由说得出口', () => {
    for (const bad of ['', 42, null, undefined, { n: 1 }]) {
      const r = toolRunSchema.safeParse({ toolName: bad });
      expect(r.success, `toolName=${JSON.stringify(bad)}`).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.path).toEqual(['toolName']);
    }
  });

  it('超长工具名被**拒绝**并写清上限（MCP 限定名形如 服务端id__工具名，上限留得开）', () => {
    const r = toolRunSchema.safeParse({ toolName: 'x'.repeat(129), args: {} });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toContain('128');
      expect(r.error.issues[0]?.path).toEqual(['toolName']);
    }
    // 128 这一格本身要能过，否则上限写错了也没人发现
    expect(toolRunSchema.safeParse({ toolName: 'x'.repeat(128), args: {} }).success).toBe(true);
  });

  it('args 必须是扁平对象：数组 / 字符串 / null / 数字都当场拒', () => {
    for (const bad of [['a'], 'a', null, 42, true]) {
      const r = toolRunSchema.safeParse({ toolName: 'read_file', args: bad });
      expect(r.success, `args=${JSON.stringify(bad)}`).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.path).toEqual(['args']);
    }
  });

  it('值不做深校验（字段含义归各工具的 tool.parse），但形状要过', () => {
    const r = toolRunSchema.safeParse({
      toolName: 'write_file',
      args: { path: 'a.txt', content: 'x'.repeat(50_000), nested: { deep: [1, 2] } },
    });
    expect(r.success).toBe(true);
  });
});
