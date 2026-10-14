import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 断点续跑的接线锁（M17 批一 · R15）。
 *
 * 为什么用"扫源码"：这一轮的三个不变量全是**接线**性质 —— 错了以后门禁未必红、
 * 但行为会静默走样：
 * ① **续跑从唯一入口进**（`ipc/turn-trigger.ts` 的 startTurn）—— 另起一条"直接 runAgentTurn"
 *    的路 = 绕过权限参数的汇聚点（W10g 前的死代码状态就是这条病）；
 * ② **任务记录先于模型调用落盘** —— 写晚了，第一轮在等模型时崩溃就没有"断在哪"；
 * ③ **任务路径不碰 alwaysAllow**（硬约束的结构证据）—— 续跑不得借"总是允许"重放高副作用动作。
 */

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const stripped = (rel: string): string => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const cs = stripped('./chat-service.ts');
const turnTrigger = stripped('./ipc/turn-trigger.ts');
const chatTaskIpc = stripped('./ipc/chat-task.ts');
const taskStoreSrc = stripped('./task-store.ts');
const taskStateSrc = stripped('./task-state.ts');

describe('续跑走唯一入口', () => {
  it('IPC 的续跑处理器调 startTurn 且带上 resumeTaskId（没有第二条起轮的路）', () => {
    const at = chatTaskIpc.indexOf('handle(IPC.CHAT_TASK_RESUME');
    expect(at).toBeGreaterThan(-1);
    const body = chatTaskIpc.slice(at, at + 1_500);
    expect(body).toContain('await startTurn(');
    expect(body).toContain('resumeTaskId: taskId');
  });

  it('turn-trigger 把 resumeTaskId 透传给 sendMessage（唯一入口里的唯一分叉）', () => {
    expect(turnTrigger).toContain('...(resumeTaskId !== undefined ? { resumeTaskId } : {}),');
  });

  it('chat-service 的续跑分支继续同一个 taskId，且记录被换掉时如实报错（不静默换新轮）', () => {
    expect(cs).toContain('prev.taskId !== params.resumeTaskId');
    expect(cs).toContain('taskRec = markResumed(prev, new Date());');
    // 起轮前必须有校验失败就抛的那条路（throw 后绝不往下跑成新轮）
    const branch = cs.slice(cs.indexOf('if (params.resumeTaskId !== undefined) {'), cs.indexOf('await persistTask(session.id, taskRec);'));
    expect(branch).toContain('throw new Error(');
  });
});

describe('任务记录先于模型调用落盘', () => {
  it('persistTask 的第一次调用在 runAgentTurn 之前（写晚了就没有"断在哪"）', () => {
    const firstPersist = cs.indexOf('await persistTask(session.id, taskRec);');
    const loop = cs.indexOf('const result = await runAgentTurn(');
    expect(firstPersist).toBeGreaterThan(-1);
    expect(loop).toBeGreaterThan(-1);
    expect(firstPersist).toBeLessThan(loop);
  });

  it('步进接在两个事件上：tool_start 记 runningStep、tool_end 计数', () => {
    expect([...cs.matchAll(/taskRec = stepStarted\(taskRec, ev\.name, new Date\(\)\);/g)]).toHaveLength(1);
    expect([...cs.matchAll(/taskRec = stepFinished\(taskRec, ev\.name, ev\.ok, new Date\(\)\);/g)]).toHaveLength(1);
  });

  it('轮末收口在 flushSession 之后、done 事件之前（界面收到 done 时记录已是终态）', () => {
    // 区域起点用**代码**（outputStreams.closeAll();）而不是注释：stripped() 会把 // 注释整行抹掉，
    // 拿注释文字当 indexOf 起点会静默退化成"从 0 找"——R25 复跑时核对过这一退化，顺手扶正。
    const region = cs.indexOf('outputStreams.closeAll();');
    expect(region).toBeGreaterThan(-1);
    const flush = cs.indexOf('await flushSession(session);', region);
    const finish = cs.indexOf('taskRec = finishTask(taskRec, outcome, new Date());');
    // R25 换靶：done 事件带上了 notice 字段（单行变多行）——判据不放宽，反而钉死"唯一一处"。
    expect([...cs.matchAll(/type: 'done',/g)]).toHaveLength(1);
    const done = cs.indexOf("type: 'done',");
    expect(flush).toBeGreaterThan(region);
    expect(finish).toBeGreaterThan(flush);
    expect(done).toBeGreaterThan(finish);
  });

  it('读时判定只有 chat-service 一处（task/store 模块自己不判）', () => {
    expect([...cs.matchAll(/interruptIfRunning\(/g)]).toHaveLength(3);
    expect(taskStoreSrc).not.toContain('interruptIfRunning');
    expect(taskStateSrc.match(/interruptIfRunning/g)).toHaveLength(1); // 只有定义本身
  });

  it('读时判定先问"这一轮还活着吗"：活着的轮次不许被读成"被打断"（定时轮次也适用）', () => {
    expect([...cs.matchAll(/interruptIfRunning\(rec, new Date\(\), sessionTurnAlive\(sessionId\)\)/g)]).toHaveLength(3);
    expect(cs).toContain('function sessionTurnAlive(sessionId: string): boolean {');
    expect(cs).toContain('return sessions.get(sessionId)?.running === true;');
  });
});

describe('存储纪律与权限边界', () => {
  it('任务记录只走 JsonStore 原子写（不许 appendFile / 裸 writeFile）', () => {
    expect(taskStoreSrc).toContain('new JsonStore<');
    expect(taskStoreSrc).not.toContain('appendFile');
    expect(taskStoreSrc).not.toContain('writeFile(');
    // 路径只经 sessionDir（会话 id 白名单守卫在同一处）
    expect(taskStoreSrc).toContain('sessionDir(sessionsRoot, id)');
  });

  it('任务路径不碰 alwaysAllow（硬约束的结构证据；唯一那一行是既有执行器参数）', () => {
    for (const src of [taskStateSrc, taskStoreSrc, chatTaskIpc, turnTrigger]) {
      expect(src).not.toContain('alwaysAllow');
    }
    // chat-service 里的出现点全是既有声明与执行器参数，没有一处被任务路径写或清
    const lines = cs.split('\n').filter((l) => l.includes('alwaysAllow'));
    for (const l of lines) {
      expect(l.trim()).toMatch(/^(alwaysAllow: (Set<string>;|new Set<string>\(\),|session\.alwaysAllow,))$/);
    }
  });
});
