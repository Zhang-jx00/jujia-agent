/**
 * 技能加载器（W11a）：扫描目录 → 解析 `SKILL.md` → 产出**确定性**的技能目录。
 *
 * 两条纪律：
 * - **坏技能不静默消失**：解析失败/超限/重名都进 `skipped` 并带原因，界面能看到
 *   （"我明明装了它怎么没生效"必须能查到答案）；
 * - **顺序确定**：结果按名称排序，与文件系统返回顺序无关 —— 这是"系统提示前缀稳定"的前提。
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_SKILL_LIMITS,
  checkSkillName,
  parseSkillFrontmatter,
  type Skill,
  type SkillCatalog,
  type SkillLimits,
  type SkillSource,
  type SkippedSkill,
} from './types';

const SKILL_FILE = 'SKILL.md';

/** 一个技能目录里允许的最大 SKILL.md 体积（超过即跳过：技能是说明书，不是数据仓库） */
export async function loadSkillCatalog(
  sources: ReadonlyArray<SkillSource>,
  limits: SkillLimits = DEFAULT_SKILL_LIMITS,
): Promise<SkillCatalog> {
  const skills: Skill[] = [];
  const skipped: SkippedSkill[] = [];
  const scannedDirs: string[] = [];
  /** 名称 → 已收录的技能（用于按来源优先级覆盖） */
  const byName = new Map<string, Skill>();

  for (const source of sources) {
    scannedDirs.push(source.path);
    const entries = await readdir(source.path, { withFileTypes: true }).catch(() => null);
    // 目录不存在不是错误：用户可能一个技能都没装
    if (entries === null) continue;

    // 排序后遍历：保证"重名覆盖"的结果可复现（不依赖文件系统顺序）
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();

    for (const dirName of dirs) {
      const dir = join(source.path, dirName);
      const file = join(dir, SKILL_FILE);
      const info = await stat(file).catch(() => null);
      if (info === null) {
        // 没有 SKILL.md 的子目录只是普通目录，安静跳过（不算"坏技能"）
        continue;
      }
      if (info.size > limits.maxBodyBytes) {
        skipped.push({
          candidate: dirName,
          dir,
          reason: `${SKILL_FILE} 体积 ${info.size} 字节，超过上限 ${limits.maxBodyBytes}`,
        });
        continue;
      }

      const text = await readFile(file, 'utf8').catch(() => null);
      if (text === null) {
        skipped.push({ candidate: dirName, dir, reason: `${SKILL_FILE} 无法读取` });
        continue;
      }

      const parsed = parseSkillFrontmatter(text);
      if (!parsed.ok) {
        skipped.push({ candidate: dirName, dir, reason: parsed.error });
        continue;
      }

      const name = (parsed.meta['name'] ?? '').trim();
      const nameError = checkSkillName(name, limits.maxNameChars);
      if (nameError !== null) {
        skipped.push({ candidate: dirName, dir, reason: `name 不合法：${nameError}` });
        continue;
      }

      const description = (parsed.meta['description'] ?? '').trim();
      if (description === '') {
        // 描述是渐进披露的全部依据：没有它，模型无从判断该不该加载这个技能
        skipped.push({ candidate: dirName, dir, reason: '缺少 description（渐进披露必须有它）' });
        continue;
      }
      if (parsed.body === '') {
        skipped.push({ candidate: dirName, dir, reason: '正文为空（SKILL.md 只有 frontmatter）' });
        continue;
      }

      const skill: Skill = {
        name,
        description,
        body: parsed.body,
        dir,
        origin: source.origin,
        bytes: info.size,
      };

      const existing = byName.get(name);
      if (existing !== undefined) {
        // 越具体越优先：工作区覆盖用户级；同来源则后扫描的覆盖先扫描的（sources 顺序即优先级）
        skipped.push({
          candidate: dirName,
          dir,
          reason: `与 ${existing.origin} 来源的同名技能冲突，已按优先级采用后者`,
        });
      }
      byName.set(name, skill);
    }
  }

  for (const skill of byName.values()) skills.push(skill);
  // 确定性排序：系统提示前缀稳定的前提
  skills.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  skipped.sort((a, b) => (a.candidate < b.candidate ? -1 : a.candidate > b.candidate ? 1 : 0));

  return { skills, skipped, scannedDirs };
}

/** 供界面/诊断用的一行摘要 */
export function summarizeCatalog(catalog: SkillCatalog): string {
  const names = catalog.skills.map((s) => s.name).join(', ');
  const skip = catalog.skipped.length > 0 ? `；跳过 ${catalog.skipped.length} 个` : '';
  return `已加载 ${catalog.skills.length} 个技能${names === '' ? '' : `（${names}）`}${skip}`;
}
