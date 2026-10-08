import { describe, expect, it } from 'vitest';
import {
  buildTerminalEnv,
  clampSize,
  decideStart,
  describeExitNotice,
  describeTerminalPermission,
  pickShell,
  sensitiveEnvKeys,
  stripUrlCredentials,
  splitChunks,
  TERMINAL_LIMITS,
  trimTail,
} from './terminal';

/**
 * W9b 终端的纯逻辑验收重点：
 * 1. **shell 选择不写死路径**（跟着用户环境走）；
 * 2. 环境变量必须带 `TERM/COLORTERM`（否则单色），且**不能把 ELECTRON_RUN_AS_NODE 传下去**
 *    （本机这个变量会让 Electron 退化成纯 Node，项目里已踩过多次）；
 * 3. 尺寸夹紧是**收敛而不报错**（resize 是高频事件）；
 * 4. 输出必须分块（防止一次巨量输出把 IPC 打爆）。
 */

describe('pickShell', () => {
  it('Windows 用 ComSpec', () => {
    expect(pickShell('win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }).file).toBe(
      'C:\\Windows\\System32\\cmd.exe',
    );
  });

  it('取不到 ComSpec 时退回**绝对路径**的 cmd.exe（2026-09-23 修）', () => {
    // 此前回退成裸 `'cmd.exe'`，那会走 PATH 查找 —— PATH 里靠前的同名文件会被优先执行
    const bySystemRoot = pickShell('win32', { SystemRoot: 'D:\\Win' }).file;
    expect(bySystemRoot).not.toBe('cmd.exe');
    expect(bySystemRoot).toContain('System32');

    const blank = pickShell('win32', { ComSpec: '   ' }).file;
    expect(blank).not.toBe('cmd.exe');
    expect(blank).toContain('System32');

    // 连 SystemRoot 都没有时也要给绝对路径
    expect(pickShell('win32', {}).file).toBe('C:\\Windows\\System32\\cmd.exe');
  });

  it('类 Unix 用 SHELL，取不到时退回 /bin/bash', () => {
    expect(pickShell('linux', { SHELL: '/bin/zsh' }).file).toBe('/bin/zsh');
    expect(pickShell('darwin', {}).file).toBe('/bin/bash');
  });

  it('不额外注入参数（交互式 shell 不接受脚本参数）', () => {
    expect(pickShell('win32', {}).args).toEqual([]);
    expect(pickShell('linux', {}).args).toEqual([]);
  });
});

describe('buildTerminalEnv', () => {
  const base = { PATH: '/usr/bin', ComSpec: 'cmd.exe', ELECTRON_RUN_AS_NODE: '1' };

  it('设置 TERM 与 COLORTERM（没有它们输出是单色的）', () => {
    const env = buildTerminalEnv(base, { workspaceRoot: 'D:\\ws' });
    expect(env['TERM']).toBe('xterm-256color');
    expect(env['COLORTERM']).toBe('truecolor');
  });

  it('**剔除 ELECTRON_RUN_AS_NODE**（否则终端里的子进程也会退化成纯 Node）', () => {
    const env = buildTerminalEnv(base, { workspaceRoot: 'D:\\ws' });
    expect('ELECTRON_RUN_AS_NODE' in env).toBe(false);
  });

  it('保留原有环境变量，并注入 JUJIA_WORKSPACE', () => {
    const env = buildTerminalEnv(base, { workspaceRoot: 'D:\\ws' });
    expect(env['PATH']).toBe('/usr/bin');
    expect(env['JUJIA_WORKSPACE']).toBe('D:\\ws');
  });

  it('值为 undefined 的键被丢弃（不产生 "KEY=undefined"）', () => {
    const env = buildTerminalEnv({ A: undefined, B: 'b' } as Record<string, string | undefined>, {
      workspaceRoot: 'w',
    });
    expect('A' in env).toBe(false);
    expect(env['B']).toBe('b');
  });

  it('不修改传入对象（纯函数）', () => {
    const src: Record<string, string | undefined> = { A: 'a' };
    buildTerminalEnv(src, { workspaceRoot: 'w' });
    expect(src).toEqual({ A: 'a' });
  });
});

describe('clampSize', () => {
  it('正常值原样通过', () => {
    expect(clampSize({ cols: 120, rows: 40 })).toEqual({ cols: 120, rows: 40 });
  });

  it('越界收敛到边界（不抛错）', () => {
    expect(clampSize({ cols: 1, rows: 1 })).toEqual({
      cols: TERMINAL_LIMITS.minCols,
      rows: TERMINAL_LIMITS.minRows,
    });
    expect(clampSize({ cols: 99999, rows: 99999 })).toEqual({
      cols: TERMINAL_LIMITS.maxCols,
      rows: TERMINAL_LIMITS.maxRows,
    });
  });

  it('非法输入走默认值', () => {
    expect(clampSize({})).toEqual({ cols: 80, rows: 24 });
    expect(clampSize({ cols: 'x', rows: null })).toEqual({ cols: 80, rows: 24 });
    expect(clampSize({ cols: Number.NaN, rows: Number.POSITIVE_INFINITY })).toEqual({
      cols: 80,
      rows: 24,
    });
  });

  it('小数向下取整', () => {
    expect(clampSize({ cols: 80.9, rows: 24.9 })).toEqual({ cols: 80, rows: 24 });
  });
});

describe('splitChunks', () => {
  it('短文本原样返回一块', () => {
    expect(splitChunks('hello')).toEqual(['hello']);
  });

  it('空字符串不产生块', () => {
    expect(splitChunks('')).toEqual([]);
  });

  it('超长文本被切成多块，且**拼回去内容不变**', () => {
    const text = 'x'.repeat(1000);
    const chunks = splitChunks(text, 300);
    expect(chunks.length).toBe(4);
    expect(chunks.every((c) => c.length <= 300)).toBe(true);
    expect(chunks.join('')).toBe(text);
  });

  it('正好等于上限时只有一块', () => {
    expect(splitChunks('y'.repeat(300), 300)).toEqual(['y'.repeat(300)]);
  });
});

describe('describeTerminalPermission', () => {
  it('说明文本包含 shell 与工作目录（供审批弹窗展示）', () => {
    const text = describeTerminalPermission({ file: 'cmd.exe', args: [] }, 'D:\\ws');
    expect(text).toContain('cmd.exe');
    expect(text).toContain('D:\\ws');
  });
});

describe('终端环境变量：敏感项不得进入终端（2026-09-23）', () => {
  /**
   * 背景：Agent 能在终端里执行命令 → 终端子进程的环境变量等于一份"随时可被读走的密钥清单"。
   * 模型只要跑一句 `env` 就能带走它们。这些变量对终端里的日常命令也没有用处。
   */
  const withSecrets = {
    PATH: 'C://Windows//System32',
    SystemRoot: 'C://Windows',
    ANTHROPIC_API_KEY: 'sk-ant-xxx',
    OPENAI_API_KEY: 'sk-xxx',
    GITHUB_TOKEN: 'ghp_xxx',
    MY_SECRET: 'shh',
    DB_PASSWORD: 'p@ss',
    AWS_CREDENTIAL_FILE: 'C:/creds',
    HTTPS_PROXY: 'http://user:pass@proxy.local:8080',
    HTTP_PROXY: 'http://proxy.local:8080',
    ELECTRON_RUN_AS_NODE: '1',
  };

  it('API Key / Token / Secret / Password / 凭据类变量一律不传', () => {
    const env = buildTerminalEnv(withSecrets, { workspaceRoot: 'D://ws' });
    for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GITHUB_TOKEN', 'MY_SECRET', 'DB_PASSWORD', 'AWS_CREDENTIAL_FILE']) {
      expect(env[key], `${key} 不该出现在终端环境里`).toBeUndefined();
    }
  });

  it('日常变量照常保留（PATH 等），否则终端根本不能用', () => {
    const env = buildTerminalEnv(withSecrets, { workspaceRoot: 'D://ws' });
    expect(env['PATH']).toBe('C://Windows//System32');
    expect(env['SystemRoot']).toBe('C://Windows');
  });

  it('代理变量**保留**（否则终端里的网络会坏），但内嵌的用户名口令被脱掉', () => {
    const env = buildTerminalEnv(withSecrets, { workspaceRoot: 'D://ws' });
    expect(env['HTTPS_PROXY']).toBe('http://proxy.local:8080');
    expect(env['HTTP_PROXY']).toBe('http://proxy.local:8080');
  });

  it('ELECTRON_RUN_AS_NODE 仍然被清掉（它会让 Electron 退化成纯 Node）', () => {
    const env = buildTerminalEnv(withSecrets, { workspaceRoot: 'D://ws' });
    expect(env['ELECTRON_RUN_AS_NODE']).toBeUndefined();
  });

  it('sensitiveEnvKeys 给出被剔除的名单（可用于界面说明"为什么终端里没有这个变量"）', () => {
    const keys = sensitiveEnvKeys(withSecrets);
    expect(keys).toContain('ANTHROPIC_API_KEY');
    expect(keys).toContain('GITHUB_TOKEN');
    expect(keys).not.toContain('PATH');
    expect(keys).not.toContain('HTTPS_PROXY'); // 代理是脱敏而非剔除
    expect(keys).toEqual([...keys].sort());
  });

  it('stripUrlCredentials 只动凭据，不动主机端口', () => {
    expect(stripUrlCredentials('http://u:p@h:8080')).toBe('http://h:8080');
    expect(stripUrlCredentials('http://h:8080')).toBe('http://h:8080');
    expect(stripUrlCredentials('socks5://h')).toBe('socks5://h');
  });
});

/**
 * T23：终端会话的生命周期（pty 常驻但可手工关闭）。
 *
 * 这一组规则**必须**放在纯逻辑层，因为它们的后果全在"进程"上：
 * - 接回已有会话 = 不再启动第二个进程（旧版切走页签会杀会话，回来点启动又新起一个 pty，
 *   而渲染层已经忘了前一个的 id —— 那个进程直到应用退出都没人能关掉）；
 * - 上限判定必须**排在权限门之前**（先弹审批再说"开不了"，等于骗用户点一次确认）；
 * - 到上限时只拒绝、不"顺手关掉最旧那个"（那是替用户决定杀哪个会话，界面看不见）。
 */
describe('decideStart：接回 / 新起 / 拒绝', () => {
  it('本工作区已有仍在跑的会话 → 接回，并把那个会话的 id 交回去', () => {
    const d = decideStart({ liveSessionId: 's-1', liveCount: 0 });
    expect(d.kind).toBe('adopt');
    if (d.kind !== 'adopt') return;
    expect(d.sessionId).toBe('s-1');
  });

  it('接回优先于上限（已到上限时用户只是想回到自己那个还在跑的终端里，不该被拒）', () => {
    const d = decideStart({
      liveSessionId: 's-1',
      liveCount: TERMINAL_LIMITS.maxSessions,
    });
    expect(d.kind).toBe('adopt');
  });

  it('没有会话且未到上限 → 新起（新起才有东西要审批）', () => {
    expect(decideStart({ liveSessionId: null, liveCount: 0 }).kind).toBe('spawn');
  });

  it('到上限 → 拒绝，理由里带上限数字与"先结束一个"', () => {
    const d = decideStart({ liveSessionId: null, liveCount: TERMINAL_LIMITS.maxSessions });
    expect(d.kind).toBe('refuse');
    if (d.kind !== 'refuse') return;
    expect(d.reason).toContain('上限');
    expect(d.reason).toContain(String(TERMINAL_LIMITS.maxSessions));
    expect(d.reason).toContain('结束');
  });

  it('拒绝时**不许**出现"自动关掉最旧的"（那是替用户决定杀哪个会话）', () => {
    const d = decideStart({ liveSessionId: null, liveCount: 99 });
    if (d.kind !== 'refuse') throw new Error('到上限必须拒绝');
    expect(d.reason).not.toMatch(/自动(关闭|结束|关掉|杀)/);
    expect(d.reason).not.toMatch(/最旧/);
  });

  it('liveCount 为负数（不该发生，但要收敛而不报错）按"可以新起"处理', () => {
    expect(decideStart({ liveSessionId: null, liveCount: -1 }).kind).toBe('spawn');
  });
});

/**
 * 切走页签期间的输出去哪了：主进程留一段**有界**尾部，回来时补回视图。
 * 有界是重点 —— 一段 `yes` 死循环的输出如果全留着，会话越活越久内存就无限涨。
 */
describe('trimTail：切走期间的输出只留尾部', () => {
  it('没超长时原样拼接（一个字都不能丢）', () => {
    expect(trimTail('abc', 'def', 100)).toBe('abcdef');
  });

  it('超长时留下的是**连续的尾部**（截中间会让终端里出现凭空少一段的假象）', () => {
    const out = trimTail('a'.repeat(50), 'b'.repeat(50), 30);
    expect(out.length).toBe(30);
    expect(out).toBe('b'.repeat(30));
  });

  it('默认上限取自 TERMINAL_LIMITS.maxTailChars，且是正数', () => {
    expect(TERMINAL_LIMITS.maxTailChars).toBeGreaterThan(0);
    expect(trimTail('x'.repeat(TERMINAL_LIMITS.maxTailChars + 10), '').length).toBe(
      TERMINAL_LIMITS.maxTailChars,
    );
  });

  it('max 给 0 或负数一律收成空串（不留"负数长度"这种没定义的状态）', () => {
    expect(trimTail('abc', 'def', 0)).toBe('');
    expect(trimTail('abc', 'def', -5)).toBe('');
  });
});

describe('describeExitNotice：切走期间进程退出了要看得见', () => {
  it('提示里有"退出码"和具体数字（只写"已退出"用户会以为是页签切换导致的）', () => {
    const text = describeExitNotice(1);
    expect(text).toContain('退出码');
    expect(text).toContain('1');
  });

  it('0 也照样说明（正常退出同样要让回来的人知道会话已经结束）', () => {
    expect(describeExitNotice(0)).toContain('退出码');
  });
});
