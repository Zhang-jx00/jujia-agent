import { describe, expect, it } from 'vitest';
import {
  buildTerminalEnv,
  clampSize,
  describeTerminalPermission,
  pickShell,
  splitChunks,
  TERMINAL_LIMITS,
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
  it('Windows 用 ComSpec，取不到时退回 cmd.exe', () => {
    expect(pickShell('win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }).file).toBe(
      'C:\\Windows\\System32\\cmd.exe',
    );
    expect(pickShell('win32', {}).file).toBe('cmd.exe');
    expect(pickShell('win32', { ComSpec: '   ' }).file).toBe('cmd.exe');
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
