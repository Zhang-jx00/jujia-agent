/**
 * 技能（Skills）：目录 + `SKILL.md` + **渐进披露**（W11a）。
 *
 * 设计要点与理由（这几条决定了实现长什么样）：
 *
 * 1. **渐进披露**：系统提示里只放"技能清单"（名称 + 一句话描述），完整正文由模型**按需**用
 *    `load_skill` 读取。理由：把几十份技能正文全塞进系统提示，既贵又会把真正的指令淹掉。
 *
 * 2. **前缀必须稳定**（本轮从"前缀缓存"这件事上学到的硬约束）：
 *    同样的技能集合必须产生**逐字节相同**的注入文本 —— 因此
 *    **按名称确定性排序**、**不含时间戳/随机量/绝对路径**。
 *    否则每一轮系统提示都在变，模型的缓存全部失效，成本与延迟都上去了。
 *
 * 3. **有界**：技能条数、描述长度、正文体积都有上限，超出即**跳过并说明原因**（宁缺勿滥）。
 *
 * 4. **来源优先级明确**：工作区技能覆盖用户级同名技能（越具体越优先），被覆盖的记入 `skipped`。
 */

export type SkillOrigin = 'workspace' | 'user';

export interface SkillSource {
  /** 技能根目录（其下每个子目录若含 SKILL.md 即视为一个技能） */
  path: string;
  origin: SkillOrigin;
}

export interface Skill {
  name: string;
  description: string;
  body: string;
  dir: string;
  origin: SkillOrigin;
  bytes: number;
}

export interface SkippedSkill {
  /** 目录名或标称技能名（可能解析失败，故不一定等于 name） */
  candidate: string;
  dir: string;
  reason: string;
}

export interface SkillCatalog {
  skills: Skill[];
  skipped: SkippedSkill[];
  scannedDirs: string[];
}

export interface SkillLimits {
  maxSkills: number;
  maxDescriptionChars: number;
  maxBodyBytes: number;
  maxNameChars: number;
}

export const DEFAULT_SKILL_LIMITS: SkillLimits = {
  maxSkills: 40,
  maxDescriptionChars: 200,
  maxBodyBytes: 64 * 1024,
  maxNameChars: 64,
};

/**
 * 技能名规则：小写字母/数字开头，允许小写字母、数字、`-`、`_`。
 * 限制字符集不是为了好看 —— 名字会出现在系统提示与工具参数里，
 * 允许任意字符等于给"提示注入"留了入口。
 */
const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function checkSkillName(name: string, maxChars = DEFAULT_SKILL_LIMITS.maxNameChars): string | null {
  if (name === '') return '技能名不能为空';
  if (name.length > maxChars) return `技能名过长（最多 ${maxChars} 字符）`;
  if (!NAME_RE.test(name)) return '技能名只能用 小写字母/数字/-/_，且以字母或数字开头';
  return null;
}

export interface FrontmatterResult {
  ok: boolean;
  error: string;
  meta: Record<string, string>;
  body: string;
}

/**
 * 解析 `SKILL.md` 的 frontmatter。
 *
 * 刻意**不引 YAML 依赖**：只支持 `key: value` 单行（值可用单/双引号包裹），
 * 这也是技能文件的常见写法；引一个 YAML 库只为解析五行元数据不划算，
 * 而且 YAML 的能力越大，"技能文件里藏东西"的空间就越大。
 */
export function parseSkillFrontmatter(text: string): FrontmatterResult {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { ok: false, error: '缺少 frontmatter（文件必须以 --- 开头）', meta: {}, body: '' };
  }
  const rest = normalized.slice(4);
  const end = rest.indexOf('\n---');
  if (end === -1) {
    return { ok: false, error: 'frontmatter 没有结束标记（缺少单独一行的 ---）', meta: {}, body: '' };
  }
  const head = rest.slice(0, end);
  // 结束标记之后可能还有同一行的残余，丢掉它
  const afterMarker = rest.slice(end + 4);
  const body = afterMarker.startsWith('\n') ? afterMarker.slice(1) : afterMarker;

  const meta: Record<string, string> = {};
  for (const rawLine of head.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) {
      return { ok: false, error: `frontmatter 行无法解析（应为 key: value）：${line.slice(0, 60)}`, meta: {}, body: '' };
    }
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (key === '') continue;
    meta[key] = value;
  }

  return { ok: true, error: '', meta, body: body.trim() };
}

/**
 * 渲染注入系统提示的**技能清单**。
 *
 * 这个函数的输出必须**可复现**：同样的目录内容 → 逐字节相同（有测试钉住）。
 * 因此这里不出现时间、不出现目录绝对路径、不依赖文件系统返回顺序。
 */
export function renderSkillCatalog(
  catalog: SkillCatalog,
  limits: SkillLimits = DEFAULT_SKILL_LIMITS,
): string {
  if (catalog.skills.length === 0) return '';

  const shown = catalog.skills.slice(0, limits.maxSkills);
  const lines = shown.map((s) => {
    const desc =
      s.description.length > limits.maxDescriptionChars
        ? `${s.description.slice(0, limits.maxDescriptionChars)}…`
        : s.description;
    return `- \`${s.name}\`：${desc}`;
  });

  const dropped = catalog.skills.length - shown.length;
  const tail =
    dropped > 0
      ? `\n（另有 ${dropped} 个技能因超出本轮清单上限未列出；可用 load_skill 直接按名称加载。）`
      : '';

  return [
    '## 可用技能',
    '',
    '下列技能是"按需查阅的说明书"。**要用某个技能时，先用 `load_skill` 读取它的完整说明，再照着做** ——',
    '不要凭技能名猜测内容。',
    '',
    ...lines,
  ].join('\n') + tail;
}
