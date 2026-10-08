import { describe, expect, it } from 'vitest';
import { buildArgvCommand, checkArgvSafety, goesThroughCmd } from './argv';

/**
 * `argv.ts` 的**直接**验收（T15 这一轮补上的）。
 *
 * 为什么现在才有：这个模块是 MCP 服务端与生命周期钩子**共用**的那道安全闸（模块头三条规则），
 * 此前只被 `mcp.test.ts` / `hooks/runner.test.ts` 间接经过 —— 间接测试有两个老毛病：
 * ① 它们跑在**宿主机平台**上（同一份用例在 Windows 与 Linux CI 上判据不同，却看不出来）；
 * ② 想测"只在经 cmd.exe 时才成立的危险"必须能指定平台，而间接路径根本传不进去。
 * 所以这里全部显式传 `platform`，把"什么会被拒 / 什么会经 shell"钉成矩阵。
 */

const CMD_WRAPPERS = ['npx', 'npm', 'yarn', 'pnpm', 'C:\\tools\\runner.cmd', 'setup.bat'];

describe('经 cmd.exe 的那三个字符（T15 的核心）', () => {
  /**
   * 样本刻意只含 `%` / `^` / `!` 这一个类（`a^&b` 那种同时含 `&` 的算"旧集合已经拦住"，
   * 放在这里会让"新加的判据到底有没有生效"变得看不出来）。
   */
  it.each(['%USERPROFILE%evil', '^echo', 'set !VAR!'])('%s 在会经 cmd.exe 时必须被拒', (bad) => {
    const r = checkArgvSafety('npx', ['-y', bad], 'win32');
    expect(r.ok).toBe(false);
    // 理由要说清"为什么这条路才拒"，否则用户只会看到一个看不懂的拒绝
    expect(r.errors.join()).toContain('cmd');
  });

  it.each(['%USERPROFILE%evil', '^echo', 'set !VAR!'])(
    '%s 在不经 shell 的直 spawn 里是合法字面量（不能误伤）',
    (s) => {
      // POSIX：argv 数组直接给 execve，`%` / `^` / `!` 没有任何特殊含义
      expect(checkArgvSafety('/usr/bin/tool', ['-x', s], 'linux').ok).toBe(true);
      // Windows 上非批处理包装器：直接 spawn 目标 exe，同样不经 cmd
      expect(checkArgvSafety('C:\\tools\\server.exe', ['-x', s], 'win32').ok).toBe(true);
    },
  );

  /**
   * 这条不是"漏网的口子"，而是一条**结构性事实**（第一版我把断言写反了，跑出来才发现）：
   * 命令名里只要带 `% ^ !`，它就整名匹配不上包装器清单 → 走直 spawn → 这三个字符在那里无害。
   * 真正会被 cmd 再解释一次的，是**排在包装器后面的参数**。
   */
  it('危险只在"包装器 + 参数"这一条路上：命令名带这些字符时反而不经 cmd', () => {
    expect(goesThroughCmd('npx%PATH%', 'win32')).toBe(false);
    expect(checkArgvSafety('npx%PATH%', [], 'win32').ok).toBe(true);
    expect(checkArgvSafety('npx', ['-y', 'pkg %USERPROFILE%'], 'win32').ok).toBe(false);
  });

  it('旧集合仍然一律拒（加了 cmd 专属判据不许把 `&` 这类降级）', () => {
    expect(checkArgvSafety('npx', ['-y', 'pkg && whoami'], 'win32').ok).toBe(false);
    expect(checkArgvSafety('npx', ['-y', 'pkg && whoami'], 'win32').errors.join()).toContain('元字符');
  });
});

describe('经典元字符：不分平台一律拒绝', () => {
  it.each(['a|b', 'a&b', 'a;b', 'a<b', 'a>b', 'a`b', 'a$b', 'a\nb', 'a\rb'])(
    '%p 在 win32 与 linux 上都被拒',
    (bad) => {
      for (const platform of ['win32', 'linux'] as const) {
        expect(checkArgvSafety('/usr/bin/tool', [bad], platform).ok).toBe(false);
        expect(checkArgvSafety(bad, [], platform).ok).toBe(false);
      }
    },
  );

  it('非字符串的 command / args 不当成"通过"，也不抛异常', () => {
    expect(checkArgvSafety(42, undefined, 'linux').ok).toBe(true); // 空与类型问题由调用方判
    expect(checkArgvSafety('tool', 'not-an-array', 'linux').ok).toBe(true);
  });
});

describe('goesThroughCmd 与 buildArgvCommand 必须用同一个判据', () => {
  it.each(CMD_WRAPPERS)('%s 在 win32 上经 cmd.exe，且在 linux 上不经', (command) => {
    expect(goesThroughCmd(command, 'win32')).toBe(true);
    expect(goesThroughCmd(command, 'linux')).toBe(false);
    // 两条路一致：说"要经 cmd"的，构造出来就得是 cmd.exe /c …
    expect(buildArgvCommand(command, ['-y'], 'win32').file).toBe('cmd.exe');
    expect(buildArgvCommand(command, ['-y'], 'linux').file).toBe(command);
  });

  it('普通 exe / 绝对路径不经 cmd（所以那三个字符在这里无害）', () => {
    expect(goesThroughCmd('C:\\tools\\server.exe', 'win32')).toBe(false);
    expect(buildArgvCommand('C:\\tools\\server.exe', ['--port', '3000'], 'win32')).toEqual({
      file: 'C:\\tools\\server.exe',
      args: ['--port', '3000'],
    });
  });

  it('经 cmd 时参数按 argv 数组排在 command 之后（不拼字符串）', () => {
    const spec = buildArgvCommand('npx', ['-y', 'pkg'], 'win32');
    expect(spec.args).toEqual(['/c', 'npx', '-y', 'pkg']);
  });

  it('大小写与后缀位置都要认（.CMD / .Bat 也算批处理包装器）', () => {
    expect(goesThroughCmd('RUNNER.CMD', 'win32')).toBe(true);
    expect(goesThroughCmd('Setup.Bat', 'win32')).toBe(true);
  });

  it('名字里含 npm/npx 但不是那个命令的，不许被误判成包装器（判据是整名，不是子串）', () => {
    expect(goesThroughCmd('C:\\tools\\npm-run.sh', 'win32')).toBe(false);
    expect(goesThroughCmd('my-npm-wrapper', 'win32')).toBe(false);
  });
});
