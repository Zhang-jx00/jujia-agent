import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { AppInfo } from '@jujia/shared-ipc';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; info: AppInfo }
  | { phase: 'error'; message: string };

/**
 * P0 阶段壳页面。
 * 作用：证明「main ↔ preload 桥 ↔ renderer」全链路打通，并可视化安全基线。
 * `data-smoke="ok"` 是 `npm run smoke` 的验收标记，仅在拿到 IPC 结果后才置位。
 */
export function App(): ReactElement {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });

  useEffect(() => {
    let alive = true;
    window.jujia
      .appInfo()
      .then((info) => {
        if (alive) setState({ phase: 'ready', info });
      })
      .catch((err: unknown) => {
        if (alive) {
          setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const smokeMarker = state.phase === 'ready' ? 'ok' : state.phase;

  return (
    <main className="p0-shell" data-smoke={smokeMarker}>
      <header>
        <h1 className="p0-title">俱佳Agent</h1>
        <p className="p0-subtitle">P0 · 工程底座与安全壳（开发计划 docs/PLAN.md）</p>
      </header>

      {state.phase === 'loading' && (
        <section className="p0-card">
          <h2>状态</h2>
          <p>正在通过 IPC 读取运行时信息…</p>
        </section>
      )}

      {state.phase === 'error' && (
        <section className="p0-card">
          <h2>状态</h2>
          <p className="p0-err">IPC 调用失败：{state.message}</p>
        </section>
      )}

      {state.phase === 'ready' && (
        <>
          <section className="p0-card">
            <h2>运行时</h2>
            <dl className="p0-kv">
              <dt>应用</dt>
              <dd>
                {state.info.name} v{state.info.version}
              </dd>
              <dt>Electron</dt>
              <dd>{state.info.electron}</dd>
              <dt>Chromium</dt>
              <dd>{state.info.chrome}</dd>
              <dt>Node</dt>
              <dd>{state.info.node}</dd>
              <dt>平台</dt>
              <dd>{state.info.platform}</dd>
              <dt>数据目录</dt>
              <dd>{state.info.dataRoot}</dd>
            </dl>
          </section>

          <section className="p0-card">
            <h2>安全基线（任一为否即拒绝启动）</h2>
            <dl className="p0-kv">
              <dt>contextIsolation</dt>
              <dd className="p0-ok">{String(state.info.security.contextIsolation)}</dd>
              <dt>sandbox</dt>
              <dd className="p0-ok">{String(state.info.security.sandbox)}</dd>
              <dt>nodeIntegration</dt>
              <dd>{String(state.info.security.nodeIntegration)}</dd>
              <dt>webSecurity</dt>
              <dd className="p0-ok">{String(state.info.security.webSecurity)}</dd>
            </dl>
          </section>
        </>
      )}
    </main>
  );
}
