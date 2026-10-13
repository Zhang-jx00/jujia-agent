import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 结构化日志的**接线锁**（M12 批一 · R10）。
 *
 * 这一族断言钉的是"每一环都在"与"边界没被绕过"——
 * 逐环都有单侧变异，因为**漏接的症状是"那条记录从来不出现"而其它全绿**：
 * 日志这种东西，断了不会有人当场发现，只会在他真正需要它的时候给一个空文件。
 */

const here = fileURLToPath(new URL('.', import.meta.url));
const appSrc = join(here, '..'); // apps/desktop/src
const repoRoot = join(here, '..', '..', '..', '..');

const read = (p: string): string => readFileSync(p, 'utf8');
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 递归收集 .ts/.tsx（跳过测试与构建产物） */
function collect(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'out' || name === 'dist' || name === 'release') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collect(p, out);
    else if ((name.endsWith('.ts') || name.endsWith('.tsx')) && !name.includes('.test.')) out.push(p);
  }
  return out;
}

const mainFiles = collect(join(here));
const rendererFiles = collect(join(appSrc, 'renderer', 'src'));
const preloadSrc = stripComments(read(join(appSrc, 'preload', 'index.ts')));
const indexSrc = stripComments(read(join(here, 'index.ts')));

describe('日志接线锁', () => {
  it('生产的日志写入只剩一处：`formatLogLine(` 只在 log-store.ts（落盘必经 store）', () => {
    const users = [...mainFiles, ...rendererFiles].filter((p) =>
      stripComments(read(p)).includes('formatLogLine('),
    );
    expect(users.map((p) => p.split(/[\\/]/).pop())).toEqual(['log-store.ts']);
  });

  it('日志链路不出本机：四个日志模块源码里没有任何网络调用', () => {
    const logFiles = [
      join(repoRoot, 'packages', 'agent-core', 'src', 'log', 'log-record.ts'),
      join(here, 'log-store.ts'),
      join(here, 'logger.ts'),
      join(here, 'ipc', 'logs.ts'),
    ];
    const banned = ['fetch(', 'XMLHttpRequest', 'WebSocket', "from 'node:http", "from 'node:https", "from 'node:net", 'http.request', 'https.request'];
    for (const f of logFiles) {
      const src = stripComments(read(f));
      for (const token of banned) {
        expect(src, `${f} 含网络调用：${token}`).not.toContain(token);
      }
    }
  });

  it('启动线逐环在：建 store/logger → 传给 IPC → 启动记录 → 崩溃记录 → 失败等写完再退', () => {
    expect(indexSrc).toContain('createLogStore(');
    expect(indexSrc).toContain('createLogger(');
    // 同一个 store 传给 IPC（两边共写一本账）
    expect(indexSrc).toContain('logs,');
    // 启动记录（数据根/配置来源）
    expect(indexSrc).toContain("logger.info('app', '启动'");
    // 渲染进程崩溃落一笔（这条以前只进控制台）
    expect(indexSrc).toContain("logger.error('app', '渲染进程异常退出'");
    // 启动失败：**等写完再退**（app.exit 不等异步写，发射后不管等于这条永远到不了盘）
    expect(indexSrc).toContain('await logs.append(createLogRecord(');
  });

  it('preload 三个方法都过契约（读尾部 / 定位 / 上报）', () => {
    expect(preloadSrc).toContain('logPageViewSchema.parse');
    expect(preloadSrc).toContain('logRevealResultSchema.parse');
    expect(preloadSrc).toContain('logReportResultSchema.parse');
  });

  it('渲染层唯一能"写"日志的入口是 ErrorBoundary 的上报（不含卡片自己的读路径）', () => {
    const writers = rendererFiles.filter((p) => stripComments(read(p)).includes('logsReport('));
    expect(writers.map((p) => p.split(/[\\/]/).pop())).toEqual(['ErrorBoundary.tsx']);
  });
});
