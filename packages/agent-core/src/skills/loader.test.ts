import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSkillCatalog, summarizeCatalog } from './loader';
import {
  DEFAULT_SKILL_LIMITS,
  checkSkillName,
  parseSkillFrontmatter,
  renderSkillCatalog,
  type SkillSource,
} from './types';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jujia-skills-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 写一个技能目录（body 默认给一段正常正文） */
async function writeSkill(
  base: string,
  dirName: string,
  frontmatter: string,
  body = '照着做。',
): Promise<void> {
  await mkdir(join(base, dirName), { recursive: true });
  await writeFile(join(base, dirName, 'SKILL.md'), frontmatter + '\n---\n\n' + body, 'utf8');
}

const source = (path: string): SkillSource => ({ path, origin: 'user' });

describe('frontmatter 解析', () => {
  it('标准形式：name/description + 正文', () => {
    const r = parseSkillFrontmatter('---\nname: review\ndescription: 代码审查流程\n---\n\n步骤 1\n步骤 2\n');
    expect(r.ok).toBe(true);
    expect(r.meta['name']).toBe('review');
    expect(r.meta['description']).toBe('代码审查流程');
    expect(r.body).toBe('步骤 1\n步骤 2');
  });

  it('值可用引号包裹；CRLF 与 BOM 都能处理', () => {
    const r = parseSkillFrontmatter("\uFEFF---\r\nname: \"a-b\"\r\ndescription: '含: 冒号'\r\n---\r\n正文");
    expect(r.ok).toBe(true);
    expect(r.meta['name']).toBe('a-b');
    expect(r.meta['description']).toBe('含: 冒号');
    expect(r.body).toBe('正文');
  });

  it('正文里的 --- 不会被当成分隔符（只认第一次闭合）', () => {
    const r = parseSkillFrontmatter('---\nname: a\ndescription: d\n---\n\n上面\n---\n下面\n');
    expect(r.ok).toBe(true);
    expect(r.body).toContain('下面');
  });

  it('缺 frontmatter / 缺结束标记 / 行不是 key: value → 报错而不是猜', () => {
    expect(parseSkillFrontmatter('# 直接是正文').ok).toBe(false);
    expect(parseSkillFrontmatter('---\nname: a\n').ok).toBe(false);
    expect(parseSkillFrontmatter('---\n这不是键值对\n---\n正文').ok).toBe(false);
  });
});

describe('技能名校验', () => {
  it('只允许 小写字母/数字/-/_，且以字母数字开头', () => {
    expect(checkSkillName('code-review')).toBeNull();
    expect(checkSkillName('a1')).toBeNull();
    expect(checkSkillName('')).not.toBeNull();
    expect(checkSkillName('Code-Review')).not.toBeNull();
    expect(checkSkillName('-lead')).not.toBeNull();
    // 名字会进系统提示与工具参数，字符集必须收窄（否则等于给提示注入留入口）
    expect(checkSkillName('含中文')).not.toBeNull();
    expect(checkSkillName('a'.repeat(65))).not.toBeNull();
  });
});

describe('目录加载（真文件系统）', () => {
  it('正常加载并按名称排序（确定性）', async () => {
    const base = join(root, 'user');
    await writeSkill(base, 'zeta', '---\nname: zeta\ndescription: 最后一个');
    await writeSkill(base, 'alpha', '---\nname: alpha\ndescription: 第一个');
    const catalog = await loadSkillCatalog([source(base)]);
    expect(catalog.skills.map((s) => s.name)).toEqual(['alpha', 'zeta']);
    expect(catalog.skipped).toEqual([]);
  });

  it('目录不存在 → 空目录且不报错（用户可能一个技能都没装）', async () => {
    const catalog = await loadSkillCatalog([{ path: join(root, 'nope'), origin: 'user' }]);
    expect(catalog.skills).toEqual([]);
    expect(catalog.skipped).toEqual([]);
  });

  it('没有 SKILL.md 的子目录安静跳过；有 SKILL.md 但坏掉的**记账跳过**', async () => {
    const base = join(root, 'user');
    await mkdir(join(base, 'just-a-folder'), { recursive: true });
    await writeSkill(base, 'no-desc', '---\nname: no-desc');
    await writeSkill(base, 'bad-name', '---\nname: Bad_Name\ndescription: 名字不合法');
    await writeSkill(base, 'ok', '---\nname: ok\ndescription: 正常');

    const catalog = await loadSkillCatalog([source(base)]);
    expect(catalog.skills.map((s) => s.name)).toEqual(['ok']);
    expect(catalog.skipped.map((s) => s.candidate).sort()).toEqual(['bad-name', 'no-desc']);
    expect(catalog.skipped.map((s) => s.reason).join('|')).toContain('description');
  });

  it('工作区来源覆盖用户级同名技能，并记入 skipped', async () => {
    const user = join(root, 'user');
    const ws = join(root, 'ws');
    await writeSkill(user, 'review', '---\nname: review\ndescription: 用户级版本');
    await writeSkill(ws, 'review', '---\nname: review\ndescription: 工作区版本');

    // sources 的顺序即优先级：先用户级、后工作区 → 工作区胜出
    const catalog = await loadSkillCatalog([
      { path: user, origin: 'user' },
      { path: ws, origin: 'workspace' },
    ]);
    expect(catalog.skills).toHaveLength(1);
    expect(catalog.skills[0]?.description).toBe('工作区版本');
    expect(catalog.skills[0]?.origin).toBe('workspace');
    expect(catalog.skipped[0]?.reason).toContain('同名技能冲突');
  });

  it('正文超限（> maxBodyBytes）→ 跳过并说明', async () => {
    const base = join(root, 'user');
    await writeSkill(base, 'big', '---\nname: big\ndescription: 太大', 'x'.repeat(5000));
    const catalog = await loadSkillCatalog([source(base)], {
      ...DEFAULT_SKILL_LIMITS,
      maxBodyBytes: 1000,
    });
    expect(catalog.skills).toEqual([]);
    expect(catalog.skipped[0]?.reason).toContain('超过上限');
  });

  it('只有 frontmatter 没有正文 → 跳过（空说明书没有意义）', async () => {
    const base = join(root, 'user');
    await mkdir(join(base, 'empty'), { recursive: true });
    await writeFile(
      join(base, 'empty', 'SKILL.md'),
      '---\nname: empty\ndescription: 没有正文\n---\n\n',
      'utf8',
    );
    const catalog = await loadSkillCatalog([source(base)]);
    expect(catalog.skills).toEqual([]);
    expect(catalog.skipped[0]?.reason).toContain('正文为空');
  });

  it('摘要一句话说清"加载了什么、跳过了什么"', async () => {
    const base = join(root, 'user');
    await writeSkill(base, 'ok', '---\nname: ok\ndescription: 正常');
    await writeSkill(base, 'bad', '---\nname: bad');
    const text = summarizeCatalog(await loadSkillCatalog([source(base)]));
    expect(text).toContain('已加载 1 个技能');
    expect(text).toContain('跳过 1 个');
  });
});

describe('清单渲染（前缀稳定性）', () => {
  it('目录内容不变 → 渲染结果**逐字节相同**（这是模型前缀缓存的基础）', async () => {
    const base = join(root, 'user');
    await writeSkill(base, 'b', '---\nname: b\ndescription: B');
    await writeSkill(base, 'a', '---\nname: a\ndescription: A');
    const first = renderSkillCatalog(await loadSkillCatalog([source(base)]));
    const second = renderSkillCatalog(await loadSkillCatalog([source(base)]));
    expect(first).toBe(second);
    // 也不该出现绝对路径或日期（否则前缀必然每轮都在变）
    expect(first).not.toContain(root);
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('没有技能时返回空串（不注入空章节）', async () => {
    expect(renderSkillCatalog(await loadSkillCatalog([]))).toBe('');
  });

  it('超过条数上限时按名称截断并**说明还有多少个**', async () => {
    const base = join(root, 'user');
    for (const n of ['a', 'b', 'c']) {
      await writeSkill(base, n, '---\nname: ' + n + '\ndescription: ' + n);
    }
    const catalog = await loadSkillCatalog([source(base)]);
    const text = renderSkillCatalog(catalog, { ...DEFAULT_SKILL_LIMITS, maxSkills: 2 });
    expect(text).toContain('`a`');
    expect(text).toContain('`b`');
    expect(text).not.toContain('`c`');
    expect(text).toContain('另有 1 个技能');
  });

  it('描述过长会截断（有界）', async () => {
    const base = join(root, 'user');
    await writeSkill(base, 'long', '---\nname: long\ndescription: ' + 'x'.repeat(500));
    const catalog = await loadSkillCatalog([source(base)]);
    const text = renderSkillCatalog(catalog, { ...DEFAULT_SKILL_LIMITS, maxDescriptionChars: 50 });
    expect(text).toContain('…');
    expect(text.length).toBeLessThan(400);
  });

  it('清单里明确要求"先 load_skill 再照做"（防止模型凭名字猜内容）', async () => {
    const base = join(root, 'user');
    await writeSkill(base, 'a', '---\nname: a\ndescription: A');
    const text = renderSkillCatalog(await loadSkillCatalog([source(base)]));
    expect(text).toContain('load_skill');
    expect(text).toContain('不要凭技能名猜测内容');
  });
});
