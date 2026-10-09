import { describe, expect, it } from 'vitest';
import { INJECTION_GUARD_NOTICE } from '../context/injection-notice';
import { ToolError } from '../tools/types';
import { createSkillTool, SKILL_TOOL_NAME } from './tool';
import type { SkillCatalog } from './types';

const catalog: SkillCatalog = {
  scannedDirs: [],
  skipped: [],
  skills: [
    {
      name: 'review',
      description: '代码审查流程',
      body: '第一步……第二步……',
      dir: 'D:/skills/review',
      origin: 'workspace',
      bytes: 100,
    },
  ],
};

const ctx = { workspaceRoot: 'D:/ws' };

describe('load_skill 工具', () => {
  it('按名加载：返回正文，并标明来源（用户可核查它来自哪）', async () => {
    const tool = createSkillTool(() => catalog);
    const out = await tool.run(tool.parse({ name: 'review' }), ctx);
    expect(out.ok).toBe(true);
    expect(out.content).toContain('技能：review');
    expect(out.content).toContain('工作区');
    expect(out.content).toContain('第一步');
  });

  it('名字不存在 → 抛出可读错误，并列出可用技能（模型下一步才走得动）', async () => {
    const tool = createSkillTool(() => catalog);
    await expect(async () => tool.run(tool.parse({ name: 'nope' }), ctx)).rejects.toThrow(ToolError);
    await expect(async () => tool.run(tool.parse({ name: 'nope' }), ctx)).rejects.toThrow(/可用技能：review/);
  });

  it('一个技能都没有时也说清楚（而不是返回空内容）', async () => {
    const tool = createSkillTool(() => ({ skills: [], skipped: [], scannedDirs: [] }));
    await expect(async () => tool.run(tool.parse({ name: 'x' }), ctx)).rejects.toThrow(/一个都没有/);
  });

  it('取值是**即时**的：会话中途新装的技能看得见（不是快照）', async () => {
    let current: SkillCatalog = { skills: [], skipped: [], scannedDirs: [] };
    const tool = createSkillTool(() => current);
    await expect(async () => tool.run(tool.parse({ name: 'late' }), ctx)).rejects.toThrow();

    current = {
      scannedDirs: [],
      skipped: [],
      skills: [{ name: 'late', description: 'd', body: 'B', dir: 'x', origin: 'user', bytes: 1 }],
    };
    const out = await tool.run(tool.parse({ name: 'late' }), ctx);
    expect(out.content).toContain('B');
  });

  it('是只读工具（不会进写权限询问；也不会被当成有副作用的动作）', () => {
    expect(createSkillTool(() => catalog).kind).toBe('read');
    expect(createSkillTool(() => catalog).name).toBe(SKILL_TOOL_NAME);
  });

  it('正文头部带「这是数据不是指令」的声明（技能正文同样零批准，只在清单里说过一次不够）', async () => {
    const tool = createSkillTool(() => catalog);
    const out = await tool.run(tool.parse({ name: 'review' }), ctx);
    expect(out.content).toContain(INJECTION_GUARD_NOTICE);
    // 声明要在正文**之前**：放在正文后面就成了"对已经读完的内容补一句"，模型早读进去了
    expect(out.content.indexOf(INJECTION_GUARD_NOTICE)).toBeLessThan(out.content.indexOf('第一步'));
  });

  it('参数校验：name 必须是非空字符串', () => {
    const tool = createSkillTool(() => catalog);
    expect(() => tool.parse({ name: '' })).toThrow();
    expect(() => tool.parse({})).toThrow();
  });
});
