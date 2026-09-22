import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolRegistry, runTool } from '@jujia/agent-core';
import { createSkillsService } from './skills';

/**
 * 技能的**端到端验证**（真目录 + 真文件 + 真注册表 + 真权限门）。
 *
 * 这一条等价于"人工装一个技能、看模型能不能加载"那套手工流程 ——
 * 手工点击没法自动化，但**从磁盘到工具返回**这一段可以真跑，而且跑出来的是硬证据。
 *
 * 唯一不覆盖的是"模型是否真的愿意调用 load_skill"（那取决于模型本身与提示词）。
 */

let root = '';
let userDir = '';
let wsDir = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jujia-skills-e2e-'));
  userDir = join(root, 'data', 'skills');
  wsDir = join(root, 'ws', '.jujia', 'skills');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeSkill(
  base: string,
  dirName: string,
  frontmatter: string,
  body: string,
): Promise<void> {
  await mkdir(join(base, dirName), { recursive: true });
  await writeFile(join(base, dirName, 'SKILL.md'), frontmatter + '\n---\n\n' + body, 'utf8');
}

const ws = (): string => join(root, 'ws');

describe('技能端到端：装进去 → 进系统提示 → 模型能按名加载', () => {
  it('用户级技能：清单进提示、正文能被工具读出来（且不触发权限询问——它是只读工具）', async () => {
    await writeSkill(
      userDir,
      'my-check',
      '---\nname: my-check\ndescription: 我自己的提交前自查清单',
      '1. 列出改动\n2. 说明用途\n3. 提醒我打标签要自己确认',
    );

    const registry = new ToolRegistry();
    const skills = createSkillsService(registry, { userDir, workspaceDir: () => wsDir });

    const catalog = await skills.refresh(ws());
    expect(catalog.skills.map((s) => s.name)).toEqual(['my-check']);

    // ① 清单确实进了系统提示（内容包含名字与描述，且不泄露绝对路径）
    const text = skills.catalogText();
    expect(text).toContain('`my-check`');
    expect(text).toContain('我自己的提交前自查清单');
    expect(text).not.toContain(root);

    // ② 工具真的注册进了注册表，并能通过**真实权限门**把正文取出来
    const asked: string[] = [];
    const res = await runTool(
      registry.get('load_skill'),
      { name: 'my-check' },
      { workspaceRoot: ws() },
      async (req) => {
        asked.push(req.toolName);
        return 'allow_once';
      },
    );
    expect(res.asked).toBe(false); // 只读工具不该打扰用户
    expect(res.outcome.ok).toBe(true);
    expect(res.outcome.content).toContain('提醒我打标签要自己确认');
    expect(res.outcome.content).toContain('（来源：用户级技能目录）');
  });

  it('工作区技能覆盖用户级同名技能（改一处就生效，且来源标注变了）', async () => {
    await writeSkill(userDir, 'review', '---\nname: review\ndescription: 用户级版本', '用户级正文');
    await writeSkill(wsDir, 'review', '---\nname: review\ndescription: 工作区版本', '工作区正文');

    const registry = new ToolRegistry();
    const skills = createSkillsService(registry, { userDir, workspaceDir: () => wsDir });
    await skills.refresh(ws());

    expect(skills.catalogText()).toContain('工作区版本');

    const res = await runTool(
      registry.get('load_skill'),
      { name: 'review' },
      { workspaceRoot: ws() },
      async () => 'deny',
    );
    expect(res.outcome.content).toContain('工作区正文');
    expect(res.outcome.content).toContain('（来源：工作区技能目录）');
  });

  it('会话中途新装的技能**不用重启**就能用（refresh 一次即可）', async () => {
    const registry = new ToolRegistry();
    const skills = createSkillsService(registry, { userDir, workspaceDir: () => wsDir });

    await skills.refresh(ws());
    expect(skills.current().skills).toEqual([]);
    await expect(
      runTool(registry.get('load_skill'), { name: 'late' }, { workspaceRoot: ws() }, async () => 'deny'),
    ).resolves.toMatchObject({ outcome: { ok: false } });

    // 不重启应用，只是新装一个技能
    await writeSkill(userDir, 'late', '---\nname: late\ndescription: 刚装的', '刚装的正文');
    await skills.refresh(ws());

    const res = await runTool(
      registry.get('load_skill'),
      { name: 'late' },
      { workspaceRoot: ws() },
      async () => 'deny',
    );
    expect(res.outcome.ok).toBe(true);
    expect(res.outcome.content).toContain('刚装的正文');
  });

  it('坏技能不会让清单崩掉：好的照常可用，坏的记在 skipped 里', async () => {
    await writeSkill(userDir, 'good', '---\nname: good\ndescription: 正常技能', '正常正文');
    await writeSkill(userDir, 'broken', '---\nname: broken', '缺 description');

    const registry = new ToolRegistry();
    const skills = createSkillsService(registry, { userDir, workspaceDir: () => wsDir });
    const catalog = await skills.refresh(ws());

    expect(catalog.skills.map((s) => s.name)).toEqual(['good']);
    expect(catalog.skipped).toHaveLength(1);
    expect(catalog.skipped[0]?.reason).toContain('description');
    expect(skills.catalogText()).toContain('`good`');
    expect(skills.catalogText()).not.toContain('broken');
  });

  it('系统提示前缀稳定：两次 refresh（内容未变）产出的清单文本逐字节相同', async () => {
    await writeSkill(userDir, 'a', '---\nname: a\ndescription: A', '正文 A');
    await writeSkill(userDir, 'b', '---\nname: b\ndescription: B', '正文 B');
    const registry = new ToolRegistry();
    const skills = createSkillsService(registry, { userDir, workspaceDir: () => wsDir });

    await skills.refresh(ws());
    const first = skills.catalogText();
    await skills.refresh(ws());
    expect(skills.catalogText()).toBe(first);
  });

  it('未选工作区时只有用户级技能可用（不报错）', async () => {
    await writeSkill(userDir, 'only-user', '---\nname: only-user\ndescription: 只有用户级', '正文');
    const registry = new ToolRegistry();
    const skills = createSkillsService(registry, { userDir, workspaceDir: () => wsDir });
    const catalog = await skills.refresh(null);
    expect(catalog.skills.map((s) => s.name)).toEqual(['only-user']);
  });
});
