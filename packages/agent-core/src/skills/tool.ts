/**
 * 技能工具：`load_skill`（W11a）。
 *
 * 为什么是"只读工具"而不是"把正文塞进系统提示"：
 * 技能正文可能很长；模型只有在**真要用**的时候才需要它。
 * 只读 + 按需读取 = 省 token，也让"模型是否加载了技能"这件事在工具调用记录里**可见可审计**。
 */

import { z } from 'zod';
import { ToolError, type ToolDefinition, type ToolOutcome } from '../tools/types';
import type { SkillCatalog } from './types';

export const SKILL_TOOL_NAME = 'load_skill';

/**
 * 注入给工具的**即时**取值函数（而不是快照）。
 * 理由：技能是"用户随时会加"的东西，用快照会让新装的技能在本次会话里看不见。
 */
export function createSkillTool(getCatalog: () => SkillCatalog): ToolDefinition<{ name: string }> {
  return {
    name: SKILL_TOOL_NAME,
    description:
      '读取某个技能的完整说明（技能是"按需查阅的说明书"）。使用前先用它拿到正文，再照着做；' +
      '技能名来自系统提示里的「可用技能」清单。',
    kind: 'read',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '技能名（系统提示的技能清单里的名字）' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    parse: (raw) => z.object({ name: z.string().min(1) }).parse(raw),
    async run(args): Promise<ToolOutcome> {
      const catalog = getCatalog();
      const skill = catalog.skills.find((s) => s.name === args.name);

      if (skill === undefined) {
        const available = catalog.skills.map((s) => s.name).join(', ');
        // 不静默返回空：把"有哪些可选"和"你可能写错了"一起说清楚，模型下一步才走得动
        throw new ToolError(
          'not_found',
          `没有名为 ${args.name} 的技能。当前可用技能：${available === '' ? '（一个都没有）' : available}`,
        );
      }

      const header = `# 技能：${skill.name}\n（来源：${skill.origin === 'workspace' ? '工作区' : '用户级'}技能目录）\n\n`;
      return {
        ok: true,
        content: header + skill.body,
        evidence: { bytes: skill.bytes },
      };
    },
  };
}
