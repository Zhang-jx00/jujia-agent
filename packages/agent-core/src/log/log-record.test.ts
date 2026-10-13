import { describe, expect, it } from 'vitest';
import { createLogRecord, formatLogLine, parseLogLine, shouldLog } from './log-record';

/**
 * 结构化日志的**纯规则层**（M12 批一 · R10）。
 *
 * 这一层只回答三件事：这条要不要记（分级）、记下来长什么样（形状与截断）、
 * 以及**落盘之前剔掉了什么**（密钥永远进不了那一行 —— 日志是第二个磁盘位置，
 * 抄错一次等于凭空多一处泄露）。
 */

const clock = (): Date => new Date('2026-10-13 12:00:00Z');

describe('分级：记不记由级别门槛说了算', () => {
  it('门槛是 info 时：debug 拒收，info 及以上放行', () => {
    expect(shouldLog('debug', 'info')).toBe(false);
    expect(shouldLog('info', 'info')).toBe(true);
    expect(shouldLog('warn', 'info')).toBe(true);
    expect(shouldLog('error', 'info')).toBe(true);
  });

  it('门槛是 debug 时全放行；门槛是 error 时只收 error', () => {
    expect(shouldLog('debug', 'debug')).toBe(true);
    expect(shouldLog('error', 'debug')).toBe(true);
    expect(shouldLog('warn', 'error')).toBe(false);
    expect(shouldLog('error', 'error')).toBe(true);
  });
});

describe('落盘前剔密：密钥进不了那一行', () => {
  it('正文里的 Bearer 令牌被换成 ***', () => {
    const r = createLogRecord(
      { level: 'info', scope: 'chat', msg: '请求失败：Authorization: Bearer abcdefghijklmnop' },
      clock,
    );
    expect(r.msg).toContain('Bearer ***');
    expect(r.msg).not.toContain('abcdefghijklmnop');
  });

  it('data 里键名像密钥的：键还在（看得见有这个字段）、值不写', () => {
    const r = createLogRecord(
      { level: 'info', scope: 'conn', msg: '连接', data: { apiKey: 'sk-1234567890abcdef', model: 'gpt' } },
      clock,
    );
    expect(r.data?.['apiKey']).toBe('***');
    expect(r.data?.['model']).toBe('gpt');
    expect(JSON.stringify(r)).not.toContain('sk-1234567890abcdef');
  });

  it('嵌套对象与数组里的密钥同样被剔（深度以内一并走）', () => {
    const r = createLogRecord(
      {
        level: 'warn',
        scope: 'mcp',
        msg: '握手',
        data: { server: { env: { AUTH_TOKEN: 'tok-abcdefghijklmnop' }, name: 'demo' }, args: ['--token=abcdefghijklmnop123456'] },
      },
      clock,
    );
    const text = JSON.stringify(r);
    expect(text).not.toContain('tok-abcdefghijklmnop');
    expect(text).not.toContain('abcdefghijklmnop123456');
    expect(text).toContain('demo');
  });

  it('URL 内嵌凭据被剥掉（与终端/审计共用同一条判据）', () => {
    const r = createLogRecord(
      { level: 'error', scope: 'git', msg: '拉取失败 https://user:pass1234@example.com/repo.git' },
      clock,
    );
    expect(r.msg).not.toContain('pass1234');
    expect(r.msg).toContain('example.com/repo.git');
  });
});

describe('形状与边界：收敛但不静默', () => {
  it('记录形状：注入时钟的 ISO 时间 + 级别 / 范围 / 正文', () => {
    const r = createLogRecord({ level: 'info', scope: 'app', msg: '启动完成' }, clock);
    expect(r.ts).toBe('2026-10-13T12:00:00.000Z');
    expect(r.level).toBe('info');
    expect(r.scope).toBe('app');
    expect(r.msg).toBe('启动完成');
  });

  it('没有 data 时不带 data 键（省掉一格空洞）', () => {
    const r = createLogRecord({ level: 'info', scope: 'app', msg: '启动' }, clock);
    expect('data' in r).toBe(false);
  });

  it('超长正文被截断，并写明原文长度（截断不静默）', () => {
    // 注意：夹具要用**像人写的**文本 —— 一整段无空格的 ASCII 长串会被"裸长随机串"那条判据
    // 当成密钥抹掉（首版夹具 5000 个 x 就撞上了它，红得有理），那是判据在尽职，不是 bug
    const long = '这是一段很长的正文。'.repeat(310); // 3100 字
    const r = createLogRecord({ level: 'info', scope: 'app', msg: long }, clock);
    expect(r.msg.length).toBeLessThan(2200);
    expect(r.msg).toContain('已截断');
    expect(r.msg).toContain('3100');
  });

  it('深过上限与超长数组：收敛成看得见的说明（不把整棵树抄进去）', () => {
    let deep: Record<string, unknown> = { leaf: 'ok' };
    for (let i = 0; i < 8; i += 1) deep = { next: deep };
    const arr = Array.from({ length: 50 }, (_v, i) => i);
    const r = createLogRecord(
      { level: 'debug', scope: 'app', msg: '深处', data: { deep, arr } },
      clock,
    );
    const text = JSON.stringify(r.data);
    expect(text).toContain('深度超限');
    expect(text).toContain('只记前 20');
    expect(text).not.toContain('"next"'.repeat(8));
  });

  it('循环引用不抛异常（标成 [循环引用]）', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a['self'] = a;
    const r = createLogRecord({ level: 'info', scope: 'app', msg: '环', data: { a } }, clock);
    expect(JSON.stringify(r.data)).toContain('循环引用');
  });
});

describe('行格式：一行一条 JSON，坏行读成 null', () => {
  it('format → parse 往返一致', () => {
    const r = createLogRecord({ level: 'warn', scope: 'chat', msg: '重试', data: { n: 2 } }, clock);
    const parsed = parseLogLine(formatLogLine(r));
    expect(parsed).toEqual(r);
  });

  it('坏行 / 非 JSON / 形状不对：一律 null，不抛', () => {
    expect(parseLogLine('')).toBeNull();
    expect(parseLogLine('not json')).toBeNull();
    expect(parseLogLine('{"level":"fatal","ts":"t","scope":"s","msg":"m"}')).toBeNull();
    expect(parseLogLine('{"level":"info","ts":123,"scope":"s","msg":"m"}')).toBeNull();
  });
});
