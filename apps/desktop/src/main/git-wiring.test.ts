import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IPC } from '@jujia/shared-ipc';
import {
  decideGitAction,
  gitAskClass,
  shouldRememberAlwaysAllow,
} from './git-gate';

/**
 * git 接线的**接线锁**（M8）。
 *
 * 要防的事故只有一件：`git-gate.ts` 与 `git-service.ts` 都写得很好，
 * 但 **ipc.ts 里的某个 handler 忘了过门** —— 那时候所有单元测试照样全绿，
 * 而用户点"提交"就真的不弹确认了。这正是本项目 F-1/F-2（"代码齐了但运行期不可达"）的镜像：
 * **能力表标 ✅ 的前提是运行路径真的通到**。
 *
 * 所以这里既扫源码（结构不变量），也真调纯函数（行为不变量），两边都锁。
 */

const here = resolve(fileURLToPath(import.meta.url), '..');
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// R-12 拆分后：git 通道的注册在 ipc/git.ts；跨文件的「全仓只有一处裸入口」由 ipc-wiring.test.ts 统一锁
const ipcSource = stripComments(readFileSync(join(here, 'ipc', 'git.ts'), 'utf8'));
const serviceSource = stripComments(readFileSync(join(here, 'git-service.ts'), 'utf8'));
const preloadSource = stripComments(readFileSync(join(here, '../preload/index.ts'), 'utf8'));

const GIT_CHANNELS = ['GIT_STATUS', 'GIT_DIFF', 'GIT_LOG', 'GIT_STAGE', 'GIT_UNSTAGE', 'GIT_COMMIT', 'GIT_PUSH'] as const;

describe('通道登记与命名', () => {
  it('七条 git 通道都在 channels.ts 里登记（不是裸字符串）', () => {
    for (const name of GIT_CHANNELS) {
      expect(IPC).toHaveProperty(name);
    }
  });

  it('没有"通用 git 命令"通道 —— 那会让按动作分级失效', () => {
    const names = Object.keys(IPC).join(' ');
    expect(names).not.toMatch(/GIT_RUN|GIT_EXEC|GIT_RAW|GIT_SHELL/);
  });

  it('每条通道都经统一入口注册（自带发送方校验）', () => {
    for (const name of GIT_CHANNELS) {
      expect(ipcSource).toContain(`handle(IPC.${name},`);
    }
    // 本模块不许出现裸 ipcMain.handle（唯一入口在 ipc/handle.ts）
    const bare = ipcSource.match(/ipcMain\.handle\(/g) ?? [];
    expect(bare.length).toBe(0);
  });
});

describe('判档只在一个地方', () => {
  it('注册模块里不出现 bypassable / decideGate —— 判档没被抄进胶水层', () => {
    expect(ipcSource).not.toContain('bypassable');
    expect(ipcSource).not.toContain('decideGate');
    expect(ipcSource).toContain('createGitService(');
  });

  it('服务层每次写操作都真的调判档与自证', () => {
    expect(serviceSource).toContain('const gate = decideGitAction({');
    expect(serviceSource).toContain('assertHardAskInert(action, gate)');
    expect(serviceSource).toContain('shouldRememberAlwaysAllow(action, gate, decision)');
    // 自证必须在弹窗之前调用：先 assert 后 resolvePermission
    expect(serviceSource.indexOf('assertHardAskInert')).toBeLessThan(serviceSource.indexOf('resolvePermission(request)'));
  });

  it('服务层不直接 spawn 进程 —— git 命令只能走 agent-core（那边已有真仓库测试）', () => {
    expect(serviceSource).not.toContain('child_process');
    expect(serviceSource).not.toContain('execFile');
  });

  it('档位清单与所有者口径一致（只读不问 / 暂存软 / 提交与推送硬）', () => {
    expect(gitAskClass('status')).toBe('none');
    expect(gitAskClass('diff')).toBe('none');
    expect(gitAskClass('log')).toBe('none');
    expect(gitAskClass('stage')).toBe('soft');
    expect(gitAskClass('unstage')).toBe('soft');
    expect(gitAskClass('commit')).toBe('hard');
    expect(gitAskClass('push')).toBe('hard');
  });

  it('运行时：commit 在任何模式下都不会拿到"可被总是允许压掉"的判定', () => {
    for (const mode of ['default', 'acceptEdits', 'plan', 'dontAsk'] as const) {
      const gate = decideGitAction({ action: 'commit', mode });
      if (gate.action === 'ask') expect(gate.bypassable).toBe(false);
      else expect(['deny']).toContain(gate.action);
    }
    expect(shouldRememberAlwaysAllow('commit', decideGitAction({ action: 'commit', mode: 'default' }), 'allow_always')).toBe(false);
  });
});

describe('预加载桥只暴露具体方法', () => {
  it('七个方法一一对应通道，出参再校验一次', () => {
    for (const m of ['gitStatus', 'gitDiff', 'gitLog', 'gitStage', 'gitUnstage', 'gitCommit', 'gitPush']) {
      expect(preloadSource).toContain(`${m}(`);
    }
    expect(preloadSource).toContain('gitActionResultSchema.parse(await ipcRenderer.invoke(IPC.GIT_COMMIT');
    expect(preloadSource).toContain('ipcRenderer.invoke(IPC.GIT_PUSH');
  });

  it('不给渲染层留"万能转发"口子（一方法一通道，不能有 invoke(channel, …) 式的方法）', () => {
    expect(preloadSource).not.toMatch(/channel[^)]*\)[^}]*ipcRenderer\.invoke\(\s*channel/);
    // 也不许把 ipcRenderer 本身挂出去
    expect(preloadSource).not.toMatch(/:\s*ipcRenderer\s*[,}]/);
  });
});

describe('push（M8 收口）：外发只有一条路，那条路必过硬 ask，界面真的可达', () => {
  const coreGitSource = stripComments(
    readFileSync(join(here, '../../../../packages/agent-core/src/git/git.ts'), 'utf8'),
  );
  const panelSource = stripComments(
    readFileSync(join(here, '../renderer/src/features/git/GitPanel.tsx'), 'utf8'),
  );

  it('服务层里 `gitPushRun(` 恰好一处，且就在 guarded 的回调里 —— 没有第二条不过门的路', () => {
    const calls = serviceSource.split('gitPushRun(').length - 1;
    expect(calls).toBe(1);
    expect(serviceSource).toContain("guarded('push', { remote, branch }, (root) => gitPushRun(root, remote, branch))");
  });

  it('git 侧的 push 走数组参数，且这条通道里**没有强推与镜像**（形状收在名字里）', () => {
    expect(coreGitSource).toMatch(/const args = b === null \? \['push', r, 'HEAD'\] : \['push', r, b\];/);
    expect(coreGitSource).toContain('git(cwd, args');
    // 这些字样若出现在 push 的命令里就是"能强推 / 能删远端分支"，本模块明确不做
    expect(coreGitSource).not.toContain("'--force'");
    expect(coreGitSource).not.toContain("'--mirror'");
    expect(coreGitSource).not.toContain("'--delete'");
  });

  it('界面真的挂着推送（不是"能力齐了但点不到"）', () => {
    expect(panelSource).toContain('window.jujia.gitPush(');
    // 硬 ask 的语义必须写在界面上：用户不该点了之后才发现"原来每次都问"
    expect(panelSource).toContain('没有「总是允许」');
    expect(panelSource).toContain('不做强推');
  });

  it('运行时：push 在四种非 bypass 模式下都不会变成"可压掉的 ask"', () => {
    for (const mode of ['default', 'acceptEdits', 'plan', 'dontAsk'] as const) {
      const gate = decideGitAction({ action: 'push', mode });
      if (gate.action === 'ask') expect(gate.bypassable).toBe(false);
      else expect(gate.action).toBe('deny');
    }
    expect(shouldRememberAlwaysAllow('push', decideGitAction({ action: 'push', mode: 'default' }), 'allow_always')).toBe(false);
  });
});

describe('T29：未跟踪条目的内容读取只有一个入口，且不跟符号链接', () => {
  const coreGitSource = stripComments(
    readFileSync(join(here, '../../../../packages/agent-core/src/git/git.ts'), 'utf8'),
  );

  it('摘要里读盘只有 readUntrackedFile 一处（原来计数与摘录各读一遍，两处判断迟早分叉）', () => {
    expect(coreGitSource.split('readUntrackedFile(').length - 1).toBe(2); // 定义一次 + 调用一次
    expect(coreGitSource).not.toMatch(/readFile\(join\(cwd,/);
  });

  it('判据在：先 lstat 再决定读不读（不是"读完了再说"）', () => {
    const idxStat = coreGitSource.indexOf('await fs.lstat(absPath)');
    const idxRead = coreGitSource.indexOf('await fs.readFile(absPath');
    expect(idxStat).toBeGreaterThan(-1);
    expect(idxRead).toBeGreaterThan(idxStat);
  });

  it('"没读"这件事必须在界面上说出来（只写 0 行 = 让人以为新文件是空的）', () => {
    expect(coreGitSource).toContain('个未跟踪条目是符号链接');
    expect(coreGitSource).toContain('个未跟踪条目读不到内容');
  });
});
