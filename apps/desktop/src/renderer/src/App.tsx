import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { AppInfo, ConfigSnapshot, ConnectionView } from '@jujia/shared-ipc';
import { ConnectionsPanel } from './features/connections/ConnectionsPanel';
import { ChatPanel } from './features/chat/ChatPanel';
import { WorkspaceCard } from './features/workspace/WorkspaceCard';
import { PermissionDialog } from './features/permission/PermissionDialog';

interface Loaded {
  info: AppInfo;
  config: ConfigSnapshot;
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; loaded: Loaded }
  | { phase: 'error'; message: string };

type Tab = 'overview' | 'connections' | 'chat';

const sourceLabel: Record<ConfigSnapshot['source'], string> = {
  primary: '主文件',
  backup: '备份 .bak',
  default: '默认值',
};

const TAB_LABEL: Record<Tab, string> = {
  overview: '概览',
  connections: '连接',
  chat: '对话',
};

/**
 * 应用外壳。
 * `data-smoke="ok"` 与 `data-config-version` 仅供 `npm run smoke` 断言：
 * 只有「main ↔ 预加载桥 ↔ 渲染层 ↔ 原子存储」全链路都通了才会置位。
 */
export function App(): ReactElement {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [tab, setTab] = useState<Tab>('overview');
  const [connections, setConnections] = useState<ConnectionView[]>([]);

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

  useEffect(() => {
    if (state.phase !== 'ready') return;
    window.jujia
      .connectionList()
      .then(setConnections)
      .catch((err: unknown) => console.error('[app] 读取连接失败:', err));
  }, [state.phase]);

  const smokeMarker = state.phase === 'ready' ? 'ok' : state.phase;

  return (
    <div className="app-root">
      <header className="app-header">
        <h1 className="p0-title">俱佳Agent</h1>
        <nav className="app-tabs">
          {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={t === tab ? 'app-tab app-tab-active' : 'app-tab'}
              onClick={() => setTab(t)}
            >
              {TAB_LABEL[t]}
              {t === 'connections' && connections.length > 0 ? ` (${connections.length})` : ''}
            </button>
          ))}
        </nav>
      </header>

      <main
        className="app-body"
        data-smoke={smokeMarker}
        data-config-version={state.phase === 'ready' ? state.loaded.config.version : ''}
        data-config-source={state.phase === 'ready' ? state.loaded.config.source : ''}
      >
        {state.phase === 'loading' && <p className="p0-subtitle">正在通过 IPC 读取运行时信息…</p>}
        {state.phase === 'error' && <p className="p0-err">IPC 调用失败：{state.message}</p>}

        {state.phase === 'ready' && tab === 'overview' && (
          <Overview info={state.loaded.info} config={state.loaded.config} />
        )}
        {state.phase === 'ready' && tab === 'connections' && (
          <ConnectionsPanel onChanged={setConnections} />
        )}
        {state.phase === 'ready' && tab === 'chat' && <ChatPanel connections={connections} />}
      </main>

      {/* 权限审批弹窗挂在最外层：任何页面触发的工具调用都能被审批 */}
      <PermissionDialog />
    </div>
  );
}

function Overview({ info, config }: { info: AppInfo; config: ConfigSnapshot }): ReactElement {
  return (
    <div className="w2-panel">
      <section className="p0-card">
        <h2>运行时</h2>
        <dl className="p0-kv">
          <dt>应用</dt>
          <dd>
            {info.name} v{info.version}
          </dd>
          <dt>Electron</dt>
          <dd>{info.electron}</dd>
          <dt>Chromium</dt>
          <dd>{info.chrome}</dd>
          <dt>Node</dt>
          <dd>{info.node}</dd>
          <dt>平台</dt>
          <dd>{info.platform}</dd>
          <dt>数据目录</dt>
          <dd>{info.dataRoot}</dd>
        </dl>
      </section>

      <section className="p0-card">
        <h2>配置（原子存储，含损坏自愈）</h2>
        {config.recovered && (
          <p className="p0-warn" role="status">
            ⚠ 本次启动检测到配置不可用，已从
            {config.recoveredFrom === 'backup' ? '备份 .bak' : '默认值'}
            自愈写回
            {config.recoveredAt ? `（${config.recoveredAt}）` : ''}。损坏文件已隔离为{' '}
            <code>*.corrupt-*</code> 保留现场。
          </p>
        )}
        <dl className="p0-kv">
          <dt>schema 版本</dt>
          <dd>{config.version}</dd>
          <dt>读取来源</dt>
          <dd className={config.recovered ? 'p0-warn' : 'p0-ok'}>
            {sourceLabel[config.source]}
            {config.recovered ? '（本次启动发生过恢复）' : ''}
          </dd>
          <dt>主题</dt>
          <dd>{config.config.theme}</dd>
          <dt>工作区</dt>
          <dd>{config.config.workspace ?? '（未选择）'}</dd>
        </dl>
      </section>

      <WorkspaceCard />

      <section className="p0-card">
        <h2>安全基线（任一为否即拒绝启动）</h2>
        <dl className="p0-kv">
          <dt>contextIsolation</dt>
          <dd className="p0-ok">{String(info.security.contextIsolation)}</dd>
          <dt>sandbox</dt>
          <dd className="p0-ok">{String(info.security.sandbox)}</dd>
          <dt>nodeIntegration</dt>
          <dd>{String(info.security.nodeIntegration)}</dd>
          <dt>webSecurity</dt>
          <dd className="p0-ok">{String(info.security.webSecurity)}</dd>
        </dl>
      </section>
    </div>
  );
}
