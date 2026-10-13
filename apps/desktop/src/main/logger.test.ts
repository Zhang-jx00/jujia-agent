import { describe, expect, it, vi } from 'vitest';
import type { LogRecord } from '@jujia/agent-core';
import type { LogStore } from './log-store';
import { createLogger, resolveDefaultMinLevel } from './logger';

/**
 * 日志门面（M12 批一 · R10）：级别拦在落盘之前、写盘是发射后不管、
 * 到达 store 的记录**已经洗过**（门面不给人拼裸 JSON 的余地）。
 */

function fakeStore(): { store: LogStore; seen: LogRecord[] } {
  const seen: LogRecord[] = [];
  const store = {
    append: vi.fn(async (record: LogRecord) => {
      seen.push(record);
      return { written: true };
    }),
  } as unknown as LogStore;
  return { store, seen };
}

const clock = (): Date => new Date('2026-10-13T10:00:00.000Z');

describe('createLogger', () => {
  it('门槛是 info：debug 连 store 都不碰，info 及以上落下去', () => {
    const { store, seen } = fakeStore();
    const logger = createLogger(store, { minLevel: 'info', clock });
    logger.debug('app', '不该记');
    logger.info('app', '记这个');
    logger.warn('chat', '警告也要');
    expect(seen.map((r) => r.msg)).toEqual(['记这个', '警告也要']);
  });

  it('到达 store 的记录已过剔密与时钟（门面不留拼裸 JSON 的余地）', () => {
    const { store, seen } = fakeStore();
    const logger = createLogger(store, { clock });
    logger.error('conn', '失败：Authorization: Bearer abcdefghijklmnop', { apiKey: 'sk-abcdefghijkl' });
    expect(seen).toHaveLength(1);
    const r = seen[0];
    expect(r?.ts).toBe('2026-10-13T10:00:00.000Z');
    expect(r?.msg).toContain('Bearer ***');
    expect(r?.data?.['apiKey']).toBe('***');
    expect(JSON.stringify(seen)).not.toContain('abcdefghijkl');
  });

  it('store 写失败不抛穿（发射后不管；失败了由 status/notice 说话）', () => {
    const store = {
      append: vi.fn(async () => ({ written: false, reason: '磁盘满' })),
    } as unknown as LogStore;
    const logger = createLogger(store, { clock });
    expect(() => logger.info('app', '照样调用')).not.toThrow();
  });
});

describe('resolveDefaultMinLevel：默认 info，环境变量能开细节，乱写的值回退 info', () => {
  it('没设 → info', () => {
    expect(resolveDefaultMinLevel({})).toBe('info');
  });
  it('JJ_LOG_LEVEL=debug → debug', () => {
    expect(resolveDefaultMinLevel({ JJ_LOG_LEVEL: 'debug' })).toBe('debug');
  });
  it('乱写的值 → 回退 info（不让错值把日志整个关掉）', () => {
    expect(resolveDefaultMinLevel({ JJ_LOG_LEVEL: 'verbose' })).toBe('info');
  });
});
