import { describe, expect, it } from 'vitest';
import { maskSecrets, summarizeArgs } from './redact';

/**
 * 审计的**安全核心**（M4 收尾 · 其二）。
 *
 * 这一层只回答一个问题：**这条记录落盘之后，会不会多出本来没有的泄露？**
 * 审计文件是"把判定过程抄到另一处磁盘"的动作 —— 抄错了就等于把用户刚写的密钥、
 * 刚读的文件正文，复制第二遍到没人加密的目录里，还会被人拿去"导出"发给同事。
 * 所以断言全写在"不该出现的东西确实没出现"这一侧。
 */

describe('maskSecrets（命令文本里可能夹着密钥）', () => {
  it('KEY=VALUE 形态的值被换成星号，键名保留（审计要看得出"设过某个变量"）', () => {
    const r = maskSecrets('set GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456');
    expect(r.text).toContain('GITHUB_TOKEN');
    expect(r.text).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456');
    expect(r.hits).toContain('GITHUB_TOKEN');
  });

  it('--password=xxx / -ApiKey xxx 这类命令行选项值同样剔掉', () => {
    expect(maskSecrets('db --password=hunter2secret').text).not.toContain('hunter2secret');
    expect(maskSecrets('curl -ApiKey abc123def456ghi789jkl').text).not.toContain('abc123def456ghi789jkl');
  });

  it('Authorization: Bearer <token> 的 token 剔掉，"Bearer" 这个词留着', () => {
    const r = maskSecrets('curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"');
    expect(r.text).toContain('Bearer');
    expect(r.text).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  it('URL 里内嵌的凭据走 terminal 那一条既有判据（不复制第二张表）', () => {
    const r = maskSecrets('git clone https://user:s3cr3tPass@git.example.com/x.git');
    expect(r.text).not.toContain('s3cr3tPass');
    expect(r.text).toContain('git.example.com');
  });

  it('长得像密钥的长 base64 / hex 串一律剔（没有键名可依附的那种才是常态）', () => {
    const b64 = 'AKIA' + 'IOSFAEXAMPLEKEYVALUE12'.repeat(2);
    expect(maskSecrets(`aws configure set aws_access_key_id ${b64}`).text).not.toContain(b64);
    expect(maskSecrets(`printf %s ${'a'.repeat(40)}`).text).not.toContain('a'.repeat(40));
  });

  it('普通命令一字不改（把 `git status` 洗成星号等于审计废掉）', () => {
    for (const cmd of ['git status', 'npm run test', 'ls -la', 'git push origin main', 'python 分析.py']) {
      const r = maskSecrets(cmd);
      expect(r.text).toBe(cmd);
      expect(r.hits).toEqual([]);
    }
  });

  it('剔过几处要说得出来（hits 是给人看的键名列表，不是布尔）', () => {
    const r = maskSecrets('set A_TOKEN=aaaaaaaaaaaaaaaaaaaaaa; set B_PASSWORD=bbbbbbbbbbbbbbbbbbbb');
    expect(r.hits.length).toBeGreaterThanOrEqual(2);
  });
});

describe('summarizeArgs（参数摘要：可核对，不可复现内容）', () => {
  it('正文类参数只记长度与指纹，绝不带内容', () => {
    const s = summarizeArgs(
      { path: 'notes/a.md', content: '这是一段刚写的文件正文，含密码 password=zzzzzzzzzzzzzzzz' },
      { workspaceRoot: 'D:/work/demo' },
    );
    const json = JSON.stringify(s);
    expect(json).not.toContain('这是一段刚写的文件正文');
    expect(json).not.toContain('zzzzzzzzzzzzzzzz');
    expect(s.keys).toContain('content');
    expect(s.lengths['content']).toBe('这是一段刚写的文件正文，含密码 password=zzzzzzzzzzzzzzzz'.length);
    expect(s.digests['content']).toMatch(/^[0-9a-f]{12}$/);
  });

  it('同一内容两次摘要指纹相同、改一个字符就不同（审计要能核对"是不是那份"）', () => {
    const a = summarizeArgs({ content: 'x'.repeat(30) }, {}).digests['content'];
    const b = summarizeArgs({ content: 'x'.repeat(30) }, {}).digests['content'];
    const c = summarizeArgs({ content: 'x'.repeat(29) + 'y' }, {}).digests['content'];
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('工作区内的路径记成相对形态；工作区外的只留末两段并标出来（不把用户名主目录整条抄进去）', () => {
    const inside = summarizeArgs({ path: 'D:/work/demo/src/a.ts' }, { workspaceRoot: 'D:/work/demo' });
    expect(JSON.stringify(inside)).toContain('src/a.ts');
    // 用 D:/... 而不是 C:/Users/...：后者在本仓库里会被 check:docs 的隐私规则当场抓住
    // （"张三"里含真实用户名前两字，整串正好以本机主目录开头）—— 规则是对的，我踩得值。
    const outside = summarizeArgs(
      { path: 'D:/elsewhere/someone/Desktop/private/secret.txt' },
      { workspaceRoot: 'D:/work/demo' },
    );
    expect(JSON.stringify(outside)).not.toContain('someone');
    expect(JSON.stringify(outside)).not.toContain('Desktop');
    expect(outside.paths).toEqual(['private/secret.txt']);
    expect(outside.redacted.join()).toContain('工作区外');
  });

  it('键名本身像密钥的参数：值与长度都不写（长度会框出密钥位数）', () => {
    const s = summarizeArgs({ apiKey: 'sk-abcdefghijklmnopqrstuv', model: 'gpt' }, {});
    expect(JSON.stringify(s)).not.toContain('sk-abcdefghijklmnopqrstuv');
    expect(s.lengths['apiKey']).toBeUndefined();
    expect(s.redacted.join()).toContain('apiKey');
    expect(s.keys).toContain('apiKey');
    expect(s.digests['model']).toBeDefined();
  });

  it('命令类参数保留**剔密后**的原文，超长截断并如实标注（"看过这条命令行"是审批的事实）', () => {
    const s = summarizeArgs({ command: 'echo TOKEN=abcdefghijklmnopqrstuv && npm run build' }, { commandKey: 'command' });
    expect(s.command).toContain('npm run build');
    expect(s.command).not.toContain('abcdefghijklmnopqrstuv');
    // 用一条"长但不像密钥"的命令验截断：一串 40 个 a 会被当作裸令牌剔掉，测不到这一格
    const longCmd = `ls ${Array.from({ length: 80 }, (_, i) => `dir${i}/file.txt`).join(' ')}`;
    const long = summarizeArgs({ command: longCmd }, { commandKey: 'command' });
    expect(long.command!.length).toBeLessThanOrEqual(420);
    expect(long.command).toContain('截断');
    expect(long.command).toContain('dir0/file.txt');
  });

  it('非对象入参不许静默变成空摘要：要留一条说明（漏记与记错是两种病）', () => {
    for (const bad of [undefined, null, '字符串', 42, ['a']]) {
      const s = summarizeArgs(bad, {});
      expect(s.redacted.join()).toContain('入参不是对象');
    }
  });

  it('嵌套对象/数组也按同一套规矩（键名 + 长度 + 指纹，不带内容）', () => {
    const s = summarizeArgs({ patch: [{ op: 'replace', text: '机密正文内容机密正文内容' }] }, {});
    expect(JSON.stringify(s)).not.toContain('机密正文内容');
    expect(s.keys).toContain('patch');
    expect(s.lengths['patch']).toBeGreaterThan(0);
  });

  it('参数名排序稳定（同一份输入两次落盘的 JSON 必须逐字节相同，否则diff 不出证据）', () => {
    const one = JSON.stringify(summarizeArgs({ b: 1, a: 2, c: 'zz' }, {}));
    const two = JSON.stringify(summarizeArgs({ c: 'zz', a: 2, b: 1 }, {}));
    expect(one).toBe(two);
  });
});
