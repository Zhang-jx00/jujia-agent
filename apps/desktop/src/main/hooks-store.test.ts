import { describe, expect, it } from 'vitest';
import { createMemoryHooksService } from './hooks-store';

describe('钩子配置服务（校验与落盘同一段代码）', () => {
  it('默认关闭：空配置时 enabled=false', async () => {
    const svc = createMemoryHooksService();
    await svc.load();
    expect(svc.getConfig().enabled).toBe(false);
    expect(svc.getConfig().timeoutMs).toBe(60_000);
  });

  it('保存合法配置后**立即**生效（不做缓存）', async () => {
    const svc = createMemoryHooksService();
    const out = await svc.save({
      enabled: true,
      events: {
        PreToolUse: [{ hooks: [{ type: 'process', command: 'node', args: ['a.mjs'] }] }],
      },
    });
    expect(out.ok).toBe(true);
    expect(svc.getConfig().enabled).toBe(true);
    expect(svc.getConfig().events.PreToolUse).toHaveLength(1);
  });

  it('校验失败**不落盘**：配置保持原样，错误逐条返回', async () => {
    const svc = createMemoryHooksService({ enabled: true, events: {} });
    const before = svc.getConfig().enabled;
    const out = await svc.save({ enabled: true, events: { PretoolUse: [] } }); // 事件名拼错
    expect(out.ok).toBe(false);
    expect(out.errors.join('|')).toContain('未知的钩子事件名');
    expect(svc.getConfig().enabled).toBe(before);
    expect(svc.raw()).toEqual({ enabled: true, events: {} });
  });

  it('原始 JSON 会被原样保留（界面编辑用），不因归一化而丢字段', async () => {
    const svc = createMemoryHooksService();
    const raw = {
      enabled: true,
      statusMessage: '自定义字段',
      events: { Stop: [{ hooks: [{ type: 'process', command: 'node' }] }] },
    };
    await svc.save(raw);
    expect(svc.raw()).toEqual(raw);
  });
});
