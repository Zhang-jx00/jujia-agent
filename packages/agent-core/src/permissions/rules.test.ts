import { describe, expect, it } from 'vitest';
import { checkArgvSafety } from '../commands/argv';
import {
  checkRuleInput,
  commandPrefixMatch,
  commandPrefixMatches,
  globToRegExp,
  isDenyAllPattern,
  matchRules,
  ruleMatches,
  type PermissionRule,
} from './rules';

function rule(over: Partial<PermissionRule> = {}): PermissionRule {
  return {
    id: 'r1',
    pattern: 'mcp__*',
    action: 'deny',
    enabled: true,
    createdAt: '2026-09-21T00:00:00.000Z',
    updatedAt: '2026-09-21T00:00:00.000Z',
    ...over,
  };
}

describe('globToRegExp（用户输入直接进正则是注入面）', () => {
  it('`*` 不跨路径分隔符，`**` 全匹配，`?` 单个非分隔符字符', () => {
    expect(globToRegExp('mcp__*').test('mcp__read_file')).toBe(true);
    expect(globToRegExp('mcp__*').test('mcp__a/b')).toBe(false);
    expect(globToRegExp('**').test('a/b/c')).toBe(true);
    expect(globToRegExp('read_?ile').test('read_file')).toBe(true);
    expect(globToRegExp('read_?ile').test('read__file')).toBe(false);
  });

  it('正则元字符被转义（`(` `.` `+` 都按字面匹配）', () => {
    expect(globToRegExp('a(b).c+').test('a(b).c+')).toBe(true);
    expect(globToRegExp('a(b).c+').test('aabcc')).toBe(false);
  });

  it('锚定整串（不是"包含"）', () => {
    expect(globToRegExp('read').test('read_file')).toBe(false);
    expect(globToRegExp('*read*').test('read_file')).toBe(true);
  });

  it('空模式只匹配空串（因此 ruleMatches 会直接判不命中）', () => {
    expect(globToRegExp('').test('')).toBe(true);
    expect(ruleMatches(rule({ pattern: '  ' }), 'read_file')).toBe(false);
  });
});

describe('matchRules（跨类取最严格，同类取列表顺序第一个）', () => {
  it('命中单条启用规则', () => {
    const m = matchRules([rule({ pattern: 'read_file', action: 'deny', note: '不想让它读' })], 'read_file');
    expect(m?.action).toBe('deny');
    expect(m?.reason).toContain('read_file');
    expect(m?.reason).toContain('不想让它读');
  });

  it('deny 压过 ask 与 allow（最严格一侧胜出）', () => {
    const m = matchRules(
      [rule({ id: 'a', pattern: '*', action: 'allow' }), rule({ id: 'b', pattern: '*', action: 'deny' })],
      'write_file',
    );
    expect(m?.action).toBe('deny');
  });

  it('ask 压过 allow', () => {
    const m = matchRules(
      [rule({ id: 'a', pattern: '*', action: 'allow' }), rule({ id: 'b', pattern: '*', action: 'ask' })],
      'write_file',
    );
    expect(m?.action).toBe('ask');
  });

  it('禁用的规则不参与判定（开关必须真实生效）', () => {
    // 注意：pattern 必须真的能命中探针工具名 —— 否则这条断言**形同虚设**
    //（复核 010 的 M4 变异就抓到过：原来的测试用了不匹配的 pattern，开关关掉也照样通过）
    const rules = [rule({ pattern: 'read_*', action: 'deny', enabled: false })];
    expect(matchRules(rules, 'read_file')).toBeNull();
    // 对照组：同一条规则一旦启用就必须命中
    expect(matchRules(rules.map((r) => ({ ...r, enabled: true })), 'read_file')?.action).toBe('deny');
  });

  it('没有命中 → null（交给模式判定）', () => {
    expect(matchRules([rule({ pattern: 'git_*' })], 'read_file')).toBeNull();
    expect(matchRules([], 'read_file')).toBeNull();
  });

  it('同类规则取列表顺序第一个（列表顺序即语义顺序）', () => {
    const rules = [
      rule({ id: 'first', pattern: 'mcp__*', action: 'deny', note: '第一条' }),
      rule({ id: 'second', pattern: 'mcp__read*', action: 'allow', note: '第二条' }),
    ];
    // first(deny) 在前且命中 → 生效的是它（同为命中，deny 更严格）
    expect(matchRules(rules, 'mcp__read_file')?.rule.id).toBe('first');
  });
});

describe('checkRuleInput（在落盘之前把住）', () => {
  it('合法输入通过', () => {
    const c = checkRuleInput({ pattern: 'mcp__*', action: 'deny' });
    expect(c.ok).toBe(true);
    expect(c.errors).toEqual([]);
  });

  it('空模式 / 过长 / 换行 / 非法动作 / 超长备注都被拒绝', () => {
    expect(checkRuleInput({ pattern: '   ', action: 'deny' }).ok).toBe(false);
    expect(checkRuleInput({ pattern: 'x'.repeat(201), action: 'deny' }).ok).toBe(false);
    expect(checkRuleInput({ pattern: 'a\nb', action: 'deny' }).ok).toBe(false);
    expect(checkRuleInput({ pattern: 'a', action: '随便' }).ok).toBe(false);
    expect(checkRuleInput({ pattern: 'a', action: 'deny', note: 'x'.repeat(201) }).ok).toBe(false);
  });

  it('deny 所有工具 → 合法但给醒目警告（不静默接受也不武断拒绝）', () => {
    const c = checkRuleInput({ pattern: '*', action: 'deny' });
    expect(c.ok).toBe(true);
    expect(c.warnings.join('|')).toContain('拒绝所有工具');
    expect(checkRuleInput({ pattern: '**', action: 'deny' }).warnings.length).toBe(1);
    // 窄模式不该误报
    expect(checkRuleInput({ pattern: 'mcp__*', action: 'deny' }).warnings).toEqual([]);
  });

  it('allow/ask 全匹配不给"拒绝所有"警告（语义不同）', () => {
    expect(checkRuleInput({ pattern: '*', action: 'allow' }).warnings).toEqual([]);
    expect(checkRuleInput({ pattern: '*', action: 'ask' }).warnings).toEqual([]);
  });
});

describe('isDenyAllPattern', () => {
  it('识别一刀切模式，放过窄模式', () => {
    expect(isDenyAllPattern('*')).toBe(true);
    expect(isDenyAllPattern('**')).toBe(true);
    // `?` 只匹配单字符工具名，不是一刀切
    expect(isDenyAllPattern('?')).toBe(false);
    expect(isDenyAllPattern('mcp__*')).toBe(false);
    expect(isDenyAllPattern('*_file')).toBe(false);
    expect(isDenyAllPattern('a*')).toBe(false);
  });
});

/**
 * 命令前缀匹配（M4 收尾 · 其一）。
 *
 * 验收要点全在"宁可少命中，也不能多放行"这一侧：
 * 命中不了 → 回落到执行类**硬 ask**（每次仍要人看）；
 * 错误命中 → 一条 deny 规则把没打算管的命令管掉了。
 * 而 `allow` 方向压根不开放（见下面 checkRuleInput 那组），所以这里不存在"放宽"的可能。
 */
describe('commandPrefixMatches（把"绝不碰这条命令"写成整词前缀）', () => {
  it('前缀命中要求整词：`git status` 不盖住 `git statuses`', () => {
    expect(commandPrefixMatches('git status', 'git status')).toBe(true);
    expect(commandPrefixMatches('git status', 'git status --short')).toBe(true);
    expect(commandPrefixMatches('git status', 'git statuses')).toBe(false);
    expect(commandPrefixMatches('git', 'gitignore list')).toBe(false);
  });

  it('大小写与连续空格不参与判断（同一台机器上 rm 与 RM 是同一个命令）', () => {
    expect(commandPrefixMatches('RM -RF', 'rm -rf build')).toBe(true);
    expect(commandPrefixMatches('git   status', 'GIT  STATUS --short')).toBe(true);
    expect(commandPrefixMatches('  rm  ', 'rm -rf build')).toBe(true);
  });

  it('命令里有 shell 组合符时一律不算命中（前缀管不住"后面还接了什么"）', () => {
    expect(commandPrefixMatches('git status', 'git status; rm -rf /')).toBe(false);
    expect(commandPrefixMatches('git status', 'git status | sh')).toBe(false);
    expect(commandPrefixMatches('rm', 'echo hi && rm -rf x')).toBe(false);
  });

  it('与 argv 安全检查共用同一张元字符表（两处口径不许各说各话）', () => {
    for (const meta of ['|', '&', ';', '<', '>', '`', '$', '\r', '\n']) {
      const cmd = `git status ${meta}tail`;
      expect(checkArgvSafety(cmd, []).ok).toBe(false);
      expect(commandPrefixMatches('git status', cmd)).toBe(false);
    }
  });

  it('空前缀 / 空命令都不命中（缺字段不等于匹配一切）', () => {
    expect(commandPrefixMatches('', 'rm -rf build')).toBe(false);
    expect(commandPrefixMatches('   ', 'rm -rf build')).toBe(false);
    expect(commandPrefixMatches('rm', '')).toBe(false);
    expect(commandPrefixMatches('rm', '   ')).toBe(false);
  });
});

/**
 * R47 · T52 收紧：前缀比的是**「程序名 + 参数」两段**，不再是整串字面开头。
 *
 * 这一组是本轮**正反用例**的所在地：正例 = 三种改写形态现在都拦得住；
 * 反例 = 不该拦的一条都不许拦（过度拦截与漏拦一样是缺陷）。
 */
describe('commandPrefixMatches：程序名 + 参数（R47 · T52 收紧）', () => {
  it('正例：`git.exe push` / `"git" push` / 带路径的 `git.exe` 都被 `git push` 命中', () => {
    // ① 可执行扩展名
    expect(commandPrefixMatches('git push', 'git.exe push')).toBe(true);
    expect(commandPrefixMatches('git push', 'git.exe push --force')).toBe(true);
    // ② 引号包住的程序名
    expect(commandPrefixMatches('git push', '"git" push')).toBe(true);
    // ③ 带空格的绝对路径（中间目录 `Program` 不许被当成程序名）
    expect(commandPrefixMatches('git push', 'C:\\Program Files\\Git\\cmd\\git.exe push')).toBe(true);
    expect(commandPrefixMatches('git push', '"C:\\Program Files\\Git\\cmd\\git.exe" push')).toBe(true);
    // ④ 前缀写成绝对路径时，同一个程序按文件名对上
    expect(commandPrefixMatches('C:\\Program Files\\Git\\cmd\\git.exe push', 'git push')).toBe(true);
  });

  it('反例：不该拦的一条都不许拦（过度拦截和漏拦一样是缺陷）', () => {
    // 程序名不是同一个
    expect(commandPrefixMatches('git push', 'gitk push')).toBe(false);
    expect(commandPrefixMatches('git push', 'gitignore push')).toBe(false);
    // 参数不是整词前缀
    expect(commandPrefixMatches('git push', 'git pushx')).toBe(false);
    expect(commandPrefixMatches('git push', 'git pull')).toBe(false);
    // 参数插在中间（这一条**仍管不到**，界面必须说出口）
    expect(commandPrefixMatches('git push', 'git -C x push')).toBe(false);
    // 套一层 shell（同样仍管不到）
    expect(commandPrefixMatches('git push', 'cmd /c git push')).toBe(false);
    // 另一个程序恰好同名但在别的目录：两边都带路径时比整条路径
    expect(commandPrefixMatches('C:\\tools\\mytool', 'D:\\other\\mytool')).toBe(false);
    // 但只写了一边路径时比文件名（`deny git` 仍要拦得住 `C:\\...\\git.exe`）
    expect(commandPrefixMatches('git push', 'C:\\other\\git.exe push')).toBe(true);
  });

  it('参数按整词比：前缀带几个词就管到第几个词', () => {
    expect(commandPrefixMatches('git push', 'git push origin main')).toBe(true);
    expect(commandPrefixMatches('git push origin', 'git push origin main')).toBe(true);
    expect(commandPrefixMatches('git push origin', 'git push upstream main')).toBe(false);
  });

  it('命中细节要说清"拦的是哪一段"（用户写的是 git push，被拦下的是 git.exe push）', () => {
    const hit = commandPrefixMatch('git push', 'git.exe push --force');
    expect(hit?.rawProgram).toBe('git.exe');
    expect(hit?.program).toBe('git');
    expect(hit?.prefixArgs).toEqual(['push']);
    expect(hit?.restArgs).toEqual(['--force']);
    // 没改写时不必多嘴
    expect(commandPrefixMatch('git push', 'git push origin main')?.rawProgram).toBe('git');
  });
});

describe('matchRules 带上命令之后', () => {
  const prefixDeny = rule({ pattern: 'run_command', action: 'deny', argPrefix: 'rm -rf' });

  it('规则带前缀时，工具名与命令前缀**都要**命中才算命中', () => {
    expect(matchRules([prefixDeny], 'run_command', 'rm -rf build')?.action).toBe('deny');
    expect(matchRules([prefixDeny], 'run_command', 'ls -la')).toBeNull();
    expect(matchRules([prefixDeny], 'write_file', 'rm -rf build')).toBeNull();
  });

  it('没给命令时前缀规则永不命中（不能把"这条工具没有命令参数"当成空命令误伤）', () => {
    expect(matchRules([prefixDeny], 'run_command')).toBeNull();
  });

  it('不带前缀的老规则完全不受影响（无论有没有命令）', () => {
    const plain = rule({ pattern: 'run_command', action: 'deny' });
    expect(matchRules([plain], 'run_command', 'ls')?.action).toBe('deny');
    expect(matchRules([plain], 'run_command')?.action).toBe('deny');
  });

  it('命中理由里要写清是哪条前缀管的，用户才知道自己被什么拦下', () => {
    const m = matchRules(
      [rule({ pattern: 'run_command', action: 'ask', argPrefix: 'git push', note: '推之前问我' })],
      'run_command',
      'git push origin main',
    );
    expect(m?.reason).toContain('前缀');
    expect(m?.reason).toContain('git push');
    expect(m?.reason).toContain('推之前问我');
  });

  it('多条规则命中同一条命令时仍取最严格一侧（前缀不参与优先级）', () => {
    const rules = [
      rule({ id: 'a', pattern: 'run_command', action: 'ask', argPrefix: 'git' }),
      rule({ id: 'b', pattern: 'run_command', action: 'deny', argPrefix: 'git push' }),
    ];
    expect(matchRules(rules, 'run_command', 'git push origin main')?.rule.id).toBe('b');
    expect(matchRules(rules, 'run_command', 'git status')?.rule.id).toBe('a');
  });

  it('禁用的前缀规则不参与判定（与老规则同一口径）', () => {
    expect(matchRules([rule({ ...prefixDeny, enabled: false })], 'run_command', 'rm -rf build')).toBeNull();
  });

  /**
   * R47 · T52：**收紧**要真的落到判定上（不只是纯函数那一层）。
   *
   * 原来 `deny git push` 拦不住 `git.exe push --force` ——
   * 那是"用户写下的承诺"在执行路径上失效，不是一个显示问题。
   */
  it('deny 前缀规则现在拦得住改写形态（`git.exe push --force`）', () => {
    const denyPush = rule({ pattern: 'run_command', action: 'deny', argPrefix: 'git push' });
    expect(matchRules([denyPush], 'run_command', 'git push origin main')?.action).toBe('deny');
    expect(matchRules([denyPush], 'run_command', 'git.exe push --force')?.action).toBe('deny');
    expect(matchRules([denyPush], 'run_command', '"git" push')?.action).toBe('deny');
    // 反向对照：不是同一个命令就不该被这条规则拦住
    expect(matchRules([denyPush], 'run_command', 'git pull')).toBeNull();
  });

  it('命中理由说清"哪一个程序按哪一个名字判的"（否则用户不知道自己被什么拦下）', () => {
    const denyPush = rule({ pattern: 'run_command', action: 'deny', argPrefix: 'git push' });
    const m = matchRules([denyPush], 'run_command', 'git.exe push --force');
    expect(m?.reason).toContain('git.exe');
    expect(m?.reason).toContain('git');
  });

  /**
   * **放行侧不许被这次收紧带宽**：`allow` + 前缀这一格按规矩不存在（`checkRuleInput` 直接拒），
   * 万一真存在（老数据 / 绕过校验层），它也不许放行任何东西 ——
   * "放行侧多命中一次就是放行"是这次改动最不该碰的一侧。
   */
  it('allow 规则带前缀时不放行任何东西（收紧不许顺带放宽）', () => {
    const allowWithPrefix = rule({ pattern: 'run_command', action: 'allow', argPrefix: 'git push' });
    expect(matchRules([allowWithPrefix], 'run_command', 'git push origin main')).toBeNull();
    expect(matchRules([allowWithPrefix], 'run_command', 'git.exe push')).toBeNull();
    // 不带前缀的 allow 规则照常按工具名命中（老行为不变）
    const plainAllow = rule({ pattern: 'run_command', action: 'allow' });
    expect(matchRules([plainAllow], 'run_command', 'git push origin main')?.action).toBe('allow');
  });
});

describe('checkRuleInput 对前缀的把关', () => {
  it('allow + 前缀 = 直接拒绝：命令级「以后不再问」这一档本轮不开', () => {
    const c = checkRuleInput({ pattern: 'run_command', action: 'allow', argPrefix: 'git status' });
    expect(c.ok).toBe(false);
    expect(c.errors.join('；')).toContain('只能用来收紧');
  });

  it('前缀为空 / 含 shell 元字符 / 含换行 / 过长都被拒绝', () => {
    expect(checkRuleInput({ pattern: 'run_command', action: 'deny', argPrefix: '   ' }).ok).toBe(false);
    expect(checkRuleInput({ pattern: 'run_command', action: 'deny', argPrefix: 'rm -rf x; y' }).ok).toBe(false);
    expect(checkRuleInput({ pattern: 'run_command', action: 'deny', argPrefix: 'git\nstatus' }).ok).toBe(false);
    expect(checkRuleInput({ pattern: 'run_command', action: 'deny', argPrefix: 'x'.repeat(201) }).ok).toBe(false);
  });

  it('deny / ask + 合法前缀通过；不填前缀的老输入照常通过', () => {
    expect(checkRuleInput({ pattern: 'run_command', action: 'deny', argPrefix: 'rm -rf' }).ok).toBe(true);
    expect(checkRuleInput({ pattern: 'run_command', action: 'ask', argPrefix: 'git push' }).ok).toBe(true);
    expect(checkRuleInput({ pattern: 'mcp__*', action: 'deny' }).ok).toBe(true);
  });

  it('前缀里出现 glob 通配符要拒绝：它按字面匹配，写 `*` 不等于匹配任意（避免假能力）', () => {
    const c = checkRuleInput({ pattern: 'run_command', action: 'deny', argPrefix: 'git *' });
    expect(c.ok).toBe(false);
    expect(c.errors.join('；')).toContain('字面');
  });
});
