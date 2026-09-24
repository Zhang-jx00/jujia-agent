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

const GIT_CHANNELS = ['GIT_STATUS', 'GIT_DIFF', 'GIT_LOG', 'GIT_STAGE', 'GIT_UNSTAGE', 'GIT_COMMIT'] as const;

describe('通道登记与命名', () => {
  it('六条 git 通道都在 channels.ts 里登记（不是裸字符串）', () => {
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

  it('档位清单与所有者口径一致（只读不问 / 暂存软 / 提交硬）', () => {
    expect(gitAskClass('status')).toBe('none');
    expect(gitAskClass('diff')).toBe('none');
    expect(gitAskClass('log')).toBe('none');
    expect(gitAskClass('stage')).toBe('soft');
    expect(gitAskClass('unstage')).toBe('soft');
    expect(gitAskClass('commit')).toBe('hard');
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
  it('六个方法一一对应通道，出参再校验一次', () => {
    for (const m of ['gitStatus', 'gitDiff', 'gitLog', 'gitStage', 'gitUnstage', 'gitCommit']) {
      expect(preloadSource).toContain(`${m}(`);
    }
    expect(preloadSource).toContain('gitActionResultSchema.parse(await ipcRenderer.invoke(IPC.GIT_COMMIT');
  });

  it('不给渲染层留"万能转发"口子（一方法一通道，不能有 invoke(channel, …) 式的方法）', () => {
    expect(preloadSource).not.toMatch(/channel[^)]*\)[^}]*ipcRenderer\.invoke\(\s*channel/);
    // 也不许把 ipcRenderer 本身挂出去
    expect(preloadSource).not.toMatch(/:\s*ipcRenderer\s*[,}]/);
  });
});
