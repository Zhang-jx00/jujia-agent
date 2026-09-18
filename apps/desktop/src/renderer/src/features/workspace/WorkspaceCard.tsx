import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { ToolRunResult, WorkspaceInfo } from '@jujia/shared-ipc';

/**
 * 工作区卡片 + 工具自检台（W3）。
 *
 * 为什么在 UI 里放「试跑」按钮：W3 的验收标准是「工作区外写入被拒且有提示」，
 * 只有能在界面上真的跑一次工具，这条标准才可被人工复核（也是 M2 的验收入口）。
 */
export function WorkspaceCard(): ReactElement {
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [probePath, setProbePath] = useState('jujia-selftest.txt');
  const [last, setLast] = useState<ToolRunResult | null>(null);

  async function refresh(): Promise<void> {
    setInfo(await window.jujia.workspaceGet());
  }

  useEffect(() => {
    refresh().catch((err: unknown) => console.error('[workspace]', err));
  }, []);

  async function pick(): Promise<void> {
    setBusy(true);
    try {
      setInfo(await window.jujia.workspacePick());
    } finally {
      setBusy(false);
    }
  }

  async function clear(): Promise<void> {
    setBusy(true);
    try {
      setInfo(await window.jujia.workspaceClear());
      setLast(null);
    } finally {
      setBusy(false);
    }
  }

  async function run(toolName: string): Promise<void> {
    setBusy(true);
    setLast(null);
    try {
      const args: Record<string, unknown> =
        toolName === 'write_file'
          ? { path: probePath, content: `由俱佳Agent 写入于 ${new Date().toLocaleString()}\n` }
          : toolName === 'read_file'
            ? { path: probePath }
            : { path: '.' };
      setLast(await window.jujia.toolRun(toolName, args));
    } catch (err) {
      setLast({
        ok: false,
        toolName,
        content: err instanceof Error ? err.message : String(err),
        durationMs: 0,
        asked: false,
        decision: null,
        paths: [],
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="p0-card">
      <h2>工作区（写操作需授权，越界一律拒绝）</h2>
      {info === null && <p className="p0-subtitle">读取中…</p>}
      {info && (
        <>
          <dl className="p0-kv">
            <dt>目录</dt>
            <dd>{info.root ?? '（未选择）'}</dd>
            <dt>状态</dt>
            <dd className={info.valid && info.writable ? 'p0-ok' : 'p0-warn'}>{info.message}</dd>
          </dl>
          <div className="w2-actions">
            <button type="button" className="w2-btn-primary" disabled={busy} onClick={() => void pick()}>
              选择目录…
            </button>
            <button type="button" className="w2-btn" disabled={busy || !info.root} onClick={() => void clear()}>
              清除
            </button>
          </div>

          {info.valid && (
            <>
              <h2 style={{ marginTop: 16 }}>工具自检（验证权限门与路径守卫）</h2>
              <div className="w2-form">
                <label>
                  测试用路径（相对工作区）
                  <input value={probePath} onChange={(e) => setProbePath(e.target.value)} />
                </label>
              </div>
              <div className="w2-actions">
                <button type="button" className="w2-btn" disabled={busy} onClick={() => void run('read_file')}>
                  read_file（自动放行）
                </button>
                <button type="button" className="w2-btn" disabled={busy} onClick={() => void run('write_file')}>
                  write_file（需授权）
                </button>
                <button type="button" className="w2-btn" disabled={busy} onClick={() => void run('list_dir')}>
                  list_dir
                </button>
                <button
                  type="button"
                  className="w2-btn-danger"
                  disabled={busy}
                  onClick={() => setProbePath('../越界测试.txt')}
                >
                  填入越界路径
                </button>
              </div>
              {last && (
                <div className="w3-probe">
                  <p className={last.ok ? 'p0-ok' : 'p0-err'} role="status">
                    {last.ok ? '✓' : '✗'} {last.toolName} · {last.durationMs}ms
                    {last.asked ? ` · 已询问用户（${last.decision ?? '无响应'}）` : ' · 无需询问'}
                  </p>
                  <pre>{last.content}</pre>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
