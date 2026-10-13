import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 更新检查的**接线锁**（M12 批二 · R11）。
 *
 * 最小形态的承诺全部在这里钉住，因为它们都指"某件危险的事**没有**发生"——
 * 没有发生的事没人会当场发现，只有扫源码的锁替我们看着：
 * **不下载、不执行、不改任何东西**；端点在**一处**；**没人点就不出站**。
 */

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const service = stripComments(read('./update-service.ts'));
const ipc = stripComments(read('./ipc/update.ts'));
const version = stripComments(read('../../../../packages/agent-core/src/update/version.ts'));
const card = stripComments(read('../renderer/src/features/update/UpdateCard.tsx'));
const preload = stripComments(read('../preload/index.ts'));

describe('更新检查接线锁', () => {
  it('只读的一次查询：三个模块里没有任何"下载 / 执行 / 写文件"的能力', () => {
    const banned = [
      'writeFile',
      'appendFile',
      'createWriteStream',
      'child_process',
      'execFile(',
      'spawn(',
      'shell.openExternal',
      'shell.openPath',
      'unlink',
      'download',
    ];
    for (const [name, src] of [
      ['update-service.ts', service],
      ['ipc/update.ts', ipc],
      ['version.ts', version],
    ] as const) {
      for (const token of banned) {
        expect(src, `${name} 出现了不该有的能力：${token}`).not.toContain(token);
      }
    }
  });

  it('端点只在一处：生产地址（api.github.com）只由 update-service 的默认值给出', () => {
    expect(service).toContain('api.github.com');
    expect(ipc).not.toContain('api.github.com');
    expect(card).not.toContain('api.github.com');
    // 请求本身也只有 service 里那一处（ipc 只提供 fetch 实现，不自己发请求）
    expect(service).toContain('opts.fetchImpl(');
    expect(ipc).not.toContain('fetchImpl(');
  });

  it('渲染层"没人点就不出站"：更新卡源码里没有 useEffect（没有自动检查的余地）', () => {
    expect(card).not.toContain('useEffect');
    expect(card).toContain('检查更新');
  });

  it('preload 过契约：updateCheck 的返回值经 updateCheckResultSchema.parse', () => {
    expect(preload).toContain('updateCheckResultSchema.parse');
    expect(preload).toContain('IPC.APP_UPDATE_CHECK');
  });
});
