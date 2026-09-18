import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { AppInfo, ConfigSnapshot } from '@jujia/shared-ipc';

interface Loaded {
  info: AppInfo;
  config: ConfigSnapshot;
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; loaded: Loaded }
  | { phase: 'error'; message: string };

const sourceLabel: Record<ConfigSnapshot['source'], string> = {
  primary: '主文件',
  backup: '备份 .bak',
  default: '默认值',
};

/**
 * P0/P1 壳页面。
 * 作用：证明「main ↔ 预加载桥 ↔ renderer ↔ 原子存储」全链路打通，并可视化安全基线。
 * `data-smoke="ok"` 仅在 IPC 全部返回且配置读取成功后才置位，供 `npm run smoke` 断言。
 */
export function App(): ReactElement {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });

  useEffect(() => {
    let alive = true;
    Promise.all([window.jujia.appInfo(), window.jujia.configGet()])
      .then(([info, config]) => {
        if (alive) setState({ phase: 'ready', loaded: { info, config } });
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
    <main
      className="p0-shell"
      data-smoke={smokeMarker}
      data-config-version={state.phase === 'ready' ? state.loaded.config.version : ''}
      data-config-source={state.phase === 'ready' ? state.loaded.config.source : ''}
    >
      <header>
        <h1 className="p0-title">俱佳Agent</h1>
        <p className="p0-subtitle">P0 底座 + W1 原子存储（开发计划 docs/PLAN.md）</p>
      </header>

      {state.phase === 'loading' && (
        <section className="p0-card">
          <h2>状态</h2>
          <p>正在通过 IPC 读取运行时信息与配置…</p>
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
                {state.loaded.info.name} v{state.loaded.info.version}
              </dd>
              <dt>Electron</dt>
              <dd>{state.loaded.info.electron}</dd>
              <dt>Chromium</dt>
              <dd>{state.loaded.info.chrome}</dd>
              <dt>Node</dt>
              <dd>{state.loaded.info.node}</dd>
              <dt>平台</dt>
              <dd>{state.loaded.info.platform}</dd>
              <dt>数据目录</dt>
              <dd>{state.loaded.info.dataRoot}</dd>
            </dl>
          </section>

          <section className="p0-card">
            <h2>配置（原子存储，含损坏自愈）</h2>
            {state.loaded.config.recovered && (
              <p className="p0-warn" role="status">
                ⚠ 本次启动检测到配置不可用，已从
                {state.loaded.config.recoveredFrom === 'backup' ? '备份 .bak' : '默认值'}
                自愈写回
                {state.loaded.config.recoveredAt
                  ? `（${state.loaded.config.recoveredAt}）`
                  : ''}
                。损坏文件已隔离为 <code>*.corrupt-*</code> 保留现场。
              </p>
            )}
            <dl className="p0-kv">
              <dt>schema 版本</dt>
              <dd>{state.loaded.config.version}</dd>
              <dt>读取来源</dt>
              <dd className={state.loaded.config.recovered ? 'p0-warn' : 'p0-ok'}>
                {sourceLabel[state.loaded.config.source]}
                {state.loaded.config.recovered ? '（本次启动发生过恢复）' : ''}
              </dd>
              <dt>主题</dt>
              <dd>{state.loaded.config.config.theme}</dd>
              <dt>工作区</dt>
              <dd>{state.loaded.config.config.workspace ?? '（未选择）'}</dd>
            </dl>
          </section>

          <section className="p0-card">
            <h2>安全基线（任一为否即拒绝启动）</h2>
            <dl className="p0-kv">
              <dt>contextIsolation</dt>
              <dd className="p0-ok">{String(state.loaded.info.security.contextIsolation)}</dd>
              <dt>sandbox</dt>
              <dd className="p0-ok">{String(state.loaded.info.security.sandbox)}</dd>
              <dt>nodeIntegration</dt>
              <dd>{String(state.loaded.info.security.nodeIntegration)}</dd>
              <dt>webSecurity</dt>
              <dd className="p0-ok">{String(state.loaded.info.security.webSecurity)}</dd>
            </dl>
          </section>
        </>
      )}
    </main>
  );
}
