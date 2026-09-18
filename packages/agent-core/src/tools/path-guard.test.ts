import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertRealPathInside,
  displayPath,
  guardPath,
  isInside,
  resolveInsideWorkspace,
} from './path-guard';

/**
 * 断言「必须以安全原因被拒绝」。
 * 只认 `ToolError.code`，不匹配消息文本——消息是给人看的，code 才是契约
 * （2026-09-19 修正：初版用正则匹配中文消息，措辞一变就误报失败）。
 */
function expectDenied(fn: () => unknown, code = 'path_denied'): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught, '应当抛错但未抛').toBeDefined();
  expect((caught as { code?: string }).code).toBe(code);
}

async function expectDeniedAsync(p: Promise<unknown>, code = 'path_denied'): Promise<void> {
  let caught: unknown;
  try {
    await p;
  } catch (err) {
    caught = err;
  }
  expect(caught, '应当抛错但未抛').toBeDefined();
  expect((caught as { code?: string }).code).toBe(code);
}

/**
 * 路径守卫的对抗性测试。
 * 每一条「必须被拒绝」的用例，都对应一种真实存在的越界手法——
 * 这些用例是本项目的安全回归基线，不允许为了「方便」而放宽。
 */

let root: string; // 工作区
let outside: string; // 工作区之外的同级目录（用于越界测试）
let linkOutside: string; // 指向工作区外的 junction（若平台允许创建）
let linkInside: string;

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), 'jujia-guard-'));
  root = join(base, 'ws');
  outside = join(base, 'ws2'); // 注意：与 ws 同前缀，专门用来打「字符串前缀匹配」的漏洞
  await mkdir(root, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, 'secret.txt'), 'TOP SECRET', 'utf8');
  await mkdir(join(root, 'sub'), { recursive: true });

  linkOutside = join(root, 'link-to-outside');
  linkInside = join(root, 'link-to-sub');
  try {
    // Windows 下目录 junction 无需管理员权限
    await symlink(outside, linkOutside, 'junction');
    await symlink(join(root, 'sub'), linkInside, 'junction');
  } catch {
    // 平台不允许则相关用例自动跳过
  }
});

afterAll(async () => {
  await rm(dirnameOf(root), { recursive: true, force: true });
});

function dirnameOf(p: string): string {
  return resolve(p, '..');
}

describe('resolveInsideWorkspace：必须放行的正常路径', () => {
  it('相对路径按工作区解析', () => {
    expect(resolveInsideWorkspace(root, 'sub/a.txt')).toBe(join(root, 'sub', 'a.txt'));
  });

  it('工作区内的绝对路径', () => {
    expect(resolveInsideWorkspace(root, join(root, 'sub', 'a.txt'))).toBe(
      join(root, 'sub', 'a.txt'),
    );
  });

  it('工作区根自身允许（rel 为空）', () => {
    expect(resolveInsideWorkspace(root, '.')).toBe(root);
  });

  it('不存在的文件也允许解析（写场景，文件尚未创建）', () => {
    expect(resolveInsideWorkspace(root, 'not-created-yet/b.txt')).toBe(
      join(root, 'not-created-yet', 'b.txt'),
    );
  });

  it('Windows 下大小写不敏感', () => {
    if (process.platform !== 'win32') return;
    expect(isInside(root, root.toUpperCase())).toBe(true);
  });
});

describe('resolveInsideWorkspace：必须拒绝的越界手法', () => {
  it.each([
    ['单级向上越界', '..\\secret.txt'],
    ['多级向上越界', '..\\..\\..\\Windows\\System32\\x.dll'],
    ['混合斜杠越界', 'sub/../../secret.txt'],
  ])('%s → 拒绝', (_name, bad) => {
    expect(() => resolveInsideWorkspace(root, bad)).toThrowError(/path_denied|超出工作区/);
  });

  it('绝对路径指向工作区外 → 拒绝', () => {
    expect(() => resolveInsideWorkspace(root, resolve(outside, 'secret.txt'))).toThrowError(
      /path_denied|超出工作区/,
    );
  });

  it('指向系统目录 → 拒绝', () => {
    const sys = process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/passwd';
    expect(() => resolveInsideWorkspace(root, sys)).toThrowError(/path_denied|超出工作区/);
  });

  it('前缀陷阱：ws 与 ws2 同前缀，不得误判为工作区内（经典字符串匹配漏洞）', () => {
    // root=<tmp>/ws，outside=<tmp>/ws2；用 startsWith 实现的守卫会在这里放行
    expectDenied(() => resolveInsideWorkspace(root, join(outside, 'secret.txt')));
    expect(isInside(root, join(outside, 'x.txt'))).toBe(false);
  });

  it.each([
    ['UNC 路径', '\\\\server\\share\\x.txt'],
    ['设备路径 \\\\.\\', '\\\\.\\C:\\Windows\\x.txt'],
    ['设备路径 \\\\?\\', '\\\\?\\C:\\Windows\\x.txt'],
  ])('%s → 拒绝', (_name, bad) => {
    expectDenied(() => resolveInsideWorkspace(root, bad));
  });

  it('备用数据流（ADS）→ 拒绝', () => {
    expectDenied(() => resolveInsideWorkspace(root, 'sub/a.txt:evil'));
  });

  it.each([
    ['尾随点（会被系统剥离）', 'sub/secret.txt.'],
    ['尾随空格（会被系统剥离）', 'sub/secret.txt '],
  ])('%s → 拒绝', (_name, bad) => {
    expectDenied(() => resolveInsideWorkspace(root, bad));
  });

  it.each(['CON', 'nul', 'COM1', 'sub/LPT9.txt', 'aux.log'])(
    'Windows 保留设备名 %s → 拒绝',
    (bad) => {
      expect(() => resolveInsideWorkspace(root, bad)).toThrowError(/保留设备名|path_denied/);
    },
  );

  it('空路径与空字符 → invalid_args', () => {
    expect(() => resolveInsideWorkspace(root, '   ')).toThrowError(/invalid_args|路径为空/);
    expect(() => resolveInsideWorkspace(root, 'a\0b')).toThrowError(/invalid_args|空字符/);
  });
});

describe('assertRealPathInside：符号链接逃逸', () => {
  it('junction 指向工作区外 → 拒绝（真实路径校验）', async () => {
    if (process.platform === 'win32' && !(await exists(linkOutside))) return;
    await expectDeniedAsync(assertRealPathInside(root, join(linkOutside, 'secret.txt')));
  });

  it('junction 指向工作区内部 → 放行', async () => {
    if (process.platform === 'win32' && !(await exists(linkInside))) return;
    await expect(assertRealPathInside(root, join(linkInside, 'ok.txt'))).resolves.toBeTruthy();
  });

  it('目标不存在时向上找已存在祖先，不影响正常写入', async () => {
    await expect(assertRealPathInside(root, join(root, 'a', 'b', 'c.txt'))).resolves.toBeTruthy();
  });
});

describe('guardPath：组合入口', () => {
  it('正常路径通过并可给出相对展示形式', async () => {
    const p = await guardPath(root, 'sub/hello.txt');
    expect(p).toBe(join(root, 'sub', 'hello.txt'));
    expect(displayPath(root, p)).toBe('sub/hello.txt');
  });

  it('越界路径在真实路径校验前就被拦下', async () => {
    await expectDeniedAsync(guardPath(root, '../x.txt'));
  });
});

async function exists(p: string): Promise<boolean> {
  try {
    const { stat } = await import('node:fs/promises');
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
