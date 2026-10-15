import { readFileSync } from 'node:fs';
import {
  IPC,
  permissionExpiredSchema,
  permissionRequestSchema,
  type PermissionRequestPayload,
} from '@jujia/shared-ipc';
import { describe, expect, it, vi } from 'vitest';
import type { PermissionRequest } from '@jujia/agent-core';
import { PermissionBridge } from './permission-bridge';

/**
 * T59（终端与外部件批 · 2026-10-15）：**审批请求的形状一致性**。
 *
 * 病是这一条链上的三段各说各话：
 *   ① 引擎侧 `PermissionRequest`（agent-core，五个构造点各自字面量满足它）
 *   ② IPC 契约 `permissionRequestSchema`（shared-ipc）
 *   ③ 渲染层入口 `preload` 拿 ② 做 `safeParse`，**不合就整条丢弃**
 * 三段今天对得上，靠的是人逐处看（复核 084）。将来谁给请求加一个必填字段而忘了另一侧，
 * 症状不是"报错"而是**弹窗根本不出现**：桥挂起等 120 秒 → 按 timeout 收尾 →
 * 用户看到的是"我点了没反应"。这是本仓最忌的那一类：事实是契约漂移，界面说的是别的事。
 *
 * 对照口径：`PERMISSION_MODES` 那条 `policy-consistency.test.ts` —— 同一个"新增值必须改两处"的锁。
 */

/**
 * 第一道锁在**编译期**：判的是"引擎交出来的那份，能不能过契约"，两个方向各有分工。
 *
 * - `keyof` 双向相等（`engineKeysMatchContract`）：字段**名单**不许漂 ——
 *   契约加了字段而某个构造点没给，名单立刻对不上；
 * - 引擎 → 契约可赋值（`engineSatisfiesContract`）：这一侧才是**线上真正会出事**的方向，
 *   因为桥拿契约判完就发给渲染层。引擎这份过不了契约 = 弹窗不出现。
 *
 * **为什么不判反方向**（我第一版判了，typecheck 直接把它按住了，原因值得留档）：
 * `z.unknown()` 在 zod 的推断里会让这个键变成**可选**，于是"契约那份"永远不满足引擎的
 * `args: unknown` 必填 —— 反方向天生红，而红的原因不是缺陷：渲染层拿到解析后的 payload
 * 只用来显示，不会把它喂回引擎。留一条恒红的锁比没锁更坏（它会教人无视红灯）。
 * 真正要盯的是"契约会不会收下缺 args 的请求"，那是 `z.unknown()` 的固有宽松，
 * 已在下面那条 key 名单锁的覆盖范围里说明。
 */
type FieldsMatch<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type SubsetOf<A, B> = [A] extends [B] ? true : false;
const engineSatisfiesContract: SubsetOf<PermissionRequest, PermissionRequestPayload> = true;
const engineKeysMatchContract: FieldsMatch<keyof PermissionRequestPayload, keyof PermissionRequest> = true;

describe('审批请求：引擎接口与 IPC 契约是同一张形状（T59）', () => {
  it('编译期锁生效（引擎那份必须过契约；字段名单双向一致）', () => {
    expect(engineSatisfiesContract).toBe(true);
    expect(engineKeysMatchContract).toBe(true);
  });

  it('契约声明的字段清单就是这七个（改动它 = 同时改五个构造点与弹窗，这里先钉住）', () => {
    expect(Object.keys(permissionRequestSchema.shape).sort()).toEqual(
      ['args', 'bypassable', 'id', 'kind', 'paths', 'summary', 'toolName'].sort(),
    );
  });
});

/**
 * 第二道锁在**运行期**：不合契约的请求**不该被推给界面然后静默等 120 秒**。
 *
 * 桥是唯一一道关口（五个构造点都从这儿过），所以在发送前判一次形状：
 * 过不了就当场面失败 —— 按 `timeout` 收尾（**fail closed：一步都不执行**，与"没有窗口"同一档），
 * 并把 zod 那句原因写进告警。旧行为是让不合契约的东西出门，
 * 由 preload 悄悄丢掉，于是同一件事在两侧有两种说法：界面"没反应"，事实"契约漂移"。
 */
describe('不合契约的审批请求当场说不，不进那 120 秒（T59）', () => {
  /**
   * 每个用例**各自一份** send 记录（模块级共享数组会串台：
   * 上一用例那笔"没出门"的请求会算进这一用例的计数里 —— 我写完第一版就撞了这个）。
   */
  function harness(timeoutMs: number): {
    bridge: PermissionBridge;
    sent: { channel: string; payload: unknown }[];
    warns: string[];
  } {
    const sent: { channel: string; payload: unknown }[] = [];
    const warns: string[] = [];
    return {
      sent,
      warns,
      bridge: new PermissionBridge({
        send: (channel, payload) => {
          sent.push({ channel, payload });
          return true;
        },
        timeoutMs,
      }),
    };
  }

  /** 用真实超时上限的 60 倍来判：旧写法必然走到计时器，新写法当场返回 */
  const LONG_MS = 60_000;

  const valid: PermissionRequest = {
    id: 'perm-ok',
    toolName: 'write_file',
    kind: 'write',
    summary: '写入 a.txt',
    args: { path: 'a.txt' },
    paths: ['a.txt'],
    bypassable: true,
  };

  // 少一个 `bypassable`：正是"给请求加了必填字段而某处没给"的形状
  const broken = { ...valid, id: 'perm-broken', bypassable: undefined } as unknown as PermissionRequest;

  /** 等一小段时间：旧写法这时还挂着（返回 still-waiting），新写法早已收尾 */
  const race = <T>(p: Promise<T>, ms: number): Promise<T | 'still-waiting'> =>
    new Promise((resolve) => {
      const watcher = setTimeout(() => resolve('still-waiting'), ms);
      p.then((v) => {
        clearTimeout(watcher);
        resolve(v);
      });
    });

  it('缺字段的请求不推给渲染层，且按超时立即收尾（不是让人等满界面上限）', async () => {
    const { bridge, sent, warns } = harness(LONG_MS);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
      warns.push(a.map(String).join(' '));
    });
    const started = Date.now();
    const verdict = await race(bridge.resolve(broken), 2_000);

    expect(verdict).toBe('timeout'); // fail closed：没执行任何操作
    expect(Date.now() - started).toBeLessThan(2_000);
    // 那一格没被填进渲染层：不合契约的东西不该出门
    expect(sent.filter((s) => s.channel === IPC.PERMISSION_REQUEST)).toHaveLength(0);
    // 说的必须是"形状没过契约"，不是"用户没点"（后者会让人去催用户）
    expect(warns.join('|')).toContain('契约');
    expect(warns.join('|')).toContain('perm-broken');
    warnSpy.mockRestore();
  });

  it('反向对照：合契约的请求照旧推给渲染层、照旧等回音（这道守卫不许把正常路径关掉）', async () => {
    const { bridge, sent } = harness(LONG_MS);
    const verdict = await race(bridge.resolve(valid), 200);

    expect(verdict).toBe('still-waiting'); // 正常路径本来就该挂着等用户
    expect(sent.filter((s) => s.channel === IPC.PERMISSION_REQUEST)).toHaveLength(1);
    expect(bridge.pendingCount()).toBe(1);
    // 回填之后能正常收尾
    expect(bridge.settle('perm-ok', 'allow_once')).toBe(true);
  });

  it('作废通知那一侧同样对账：桥发的每个 reason 都在契约里（T58 删掉 cancelled 之后的口径）', () => {
    // 这一条判的是"发送点用的值 ⊆ 契约成员"，不是"schema 会不会收" —— 现扫桥的源码
    const bridgeSrc = readFileSync(new URL('./permission-bridge.ts', import.meta.url), 'utf8');
    const reasons = [...bridgeSrc.matchAll(/this\.expire\([^,]+,\s*'([a-z-]+)'\)/g)].map((m) => m[1]);
    expect(reasons.length, '桥里找不到任何 expire 调用（改形状了，这条锁要跟着改）').toBeGreaterThanOrEqual(2);
    for (const reason of reasons) {
      expect(
        permissionExpiredSchema.safeParse({ id: 'probe', reason }).success,
        `桥发送的 reason "${reason ?? 'undefined'}" 不在契约里`,
      ).toBe(true);
    }
  });
});
