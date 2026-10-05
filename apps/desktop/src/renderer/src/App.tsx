import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { AppInfo, ConfigSnapshot, ConnectionView } from '@jujia/shared-ipc';
/**
 * 只做 **类型导入**（编译后会被完全擦除，不进产物）。
 * 运行时逻辑改为在启动时**动态 import**，避免把 ui-tokens 拉进首屏 chunk
 * —— 实测它会让首屏 chunk 多出约 40KB 并推迟首帧（见 PERF-BUDGET 的回归记录）。
 */
import type { ThemePack } from '@jujia/ui-tokens';
import { WorkspaceCard } from './features/workspace/WorkspaceCard';
import { PermissionDialog } from './features/permission/PermissionDialog';
import { ErrorBoundary } from './ErrorBoundary';
import { KeepAlive } from './KeepAlive';

// 懒加载：连接页与对话页不在首屏，拆出去可显著减小初始 bundle（懒加载策略见 PERF-BUDGET）
const ConnectionsPanel = lazy(() =>
  import('./features/connections/ConnectionsPanel').then((m) => ({ default: m.ConnectionsPanel })),
);
const ChatPanel = lazy(() =>
  import('./features/chat/ChatPanel').then((m) => ({ default: m.ChatPanel })),
);
const AppearancePanel = lazy(() =>
  import('./features/appearance/AppearancePanel').then((m) => ({ default: m.AppearancePanel })),
);
const TerminalPanel = lazy(() =>
  import('./features/terminal/TerminalPanel').then((m) => ({ default: m.TerminalPanel })),
);
const McpPanel = lazy(() =>
  import('./features/mcp/McpPanel').then((m) => ({ default: m.McpPanel })),
);
const PluginsPanel = lazy(() =>
  import('./features/plugins/PluginsPanel').then((m) => ({ default: m.PluginsPanel })),
);
const HooksPanel = lazy(() =>
  import('./features/hooks/HooksPanel').then((m) => ({ default: m.HooksPanel })),
);
const PermissionRulesPanel = lazy(() =>
  import('./features/permissions/PermissionRulesPanel').then((m) => ({
    default: m.PermissionRulesPanel,
  })),
);
const BrowserPanel = lazy(() =>
  import('./features/browser/BrowserPanel').then((m) => ({ default: m.BrowserPanel })),
);
const GitPanel = lazy(() =>
  import('./features/git/GitPanel').then((m) => ({ default: m.GitPanel })),
);
const DocPanel = lazy(() =>
  import('./features/docs/DocPanel').then((m) => ({ default: m.DocPanel })),
);
const IdePanel = lazy(() =>
  import('./features/ide/IdePanel').then((m) => ({ default: m.IdePanel })),
);
const CanvasPanel = lazy(() =>
  import('./features/canvas/CanvasPanel').then((m) => ({ default: m.CanvasPanel })),
);

/** 兜底样式包改为在启动时从动态导入的模块里取，见下方 useEffect（首屏不加载 ui-tokens） */

/** 懒加载面板的骨架屏：对话页常驻那份与其余页签共享那份都用它（两处各写一遍迟早会漂） */
const PANEL_FALLBACK = (
  <div className="jj-skeleton" aria-busy="true">
    <div className="jj-skeleton-line" />
    <div className="jj-skeleton-line" />
    <div className="jj-skeleton-line" />
  </div>
);

interface Loaded {
  info: AppInfo;
  config: ConfigSnapshot;
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; loaded: Loaded }
  | { phase: 'error'; message: string };

type Tab =
  | 'overview'
  | 'connections'
  | 'chat'
  | 'terminal'
  | 'browser'
  | 'docs'
  | 'git'
  | 'ide'
  | 'canvas'
  | 'mcp'
  | 'permissions'
  | 'hooks'
  | 'plugins'
  | 'appearance';

const sourceLabel: Record<ConfigSnapshot['source'], string> = {
  primary: '主文件',
  backup: '备份 .bak',
  default: '默认值',
};

const TAB_LABEL: Record<Tab, string> = {
  overview: '概览',
  connections: '连接',
  chat: '对话',
  terminal: '终端',
  browser: '浏览器',
  docs: '文档',
  git: 'Git',
  ide: '文件',
  canvas: '画布',
  mcp: 'MCP',
  permissions: '权限',
  hooks: '钩子',
  plugins: '插件',
  appearance: '外观',
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
  /**
   * 对话页的**重挂轮次**（T22 报备 §二 第三条）。
   *
   * 对话页从此常驻（不随切页签卸载），于是 `ErrorBoundary key={tab}` 那条"换页签即重挂、
   * 坏页面自动重来一次"的逃生口也一并消失了。规矩：**正常态保持、错误态重挂** ——
   * 错误态本来就没有正常内容可保，而"重来一次"正是用户此刻唯一想要的。
   * 所以离开对话页时若它处于错误态，就把它这一轮的 key 换掉。
   */
  const [chatEpoch, setChatEpoch] = useState(0);
  const chatBrokenRef = useRef(false);
  const markChatBroken = useCallback((): void => {
    chatBrokenRef.current = true;
  }, []);
  /**
   * 当前样式包。
   * 启动时由**动态导入**的模块解析后填入；解析完成前为 null（外观页显示骨架屏）。
   * 这样首屏完全不依赖 ui-tokens。
   */
  const [themePack, setThemePack] = useState<ThemePack | null>(null);

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

  /** 离开对话页时：若它这一轮是坏的，就把它的重挂轮次 +1（下次进来是一次干净的重挂） */
  useEffect(() => {
    if (tab === 'chat') return;
    if (!chatBrokenRef.current) return;
    chatBrokenRef.current = false;
    setChatEpoch((n) => n + 1);
  }, [tab]);

  // 启动即应用已保存的外观。
  // 关键：**动态导入** ui-tokens —— 它不参与首屏渲染，因此首帧不等待它。
  // 代价是"极短暂地显示默认样式后再切外观"，比首帧变慢更划算（首屏性能优先）。
  useEffect(() => {
    if (state.phase !== 'ready') return;
    const saved = state.loaded.config.config.appearance;
    let cancelled = false;
    void (async () => {
      const { BUILTIN_PACKS, validateThemePack, themePackToCssVars } = await import(
        '@jujia/ui-tokens'
      );
      if (cancelled) return;
      const check = validateThemePack(saved.pack ?? null);
      const pack = (check.ok && check.pack ? check.pack : BUILTIN_PACKS[0]) as ThemePack;
      const root = document.documentElement;
      for (const [k, v] of Object.entries(themePackToCssVars(pack))) root.style.setProperty(k, v);
      root.dataset['jjBgKind'] = pack.background.kind;
      setThemePack(pack);
    })();
    return () => {
      cancelled = true;
    };
  }, [state]);

  // 首帧回报（在布局与首次绘制之后触发，供 M18 启动性能实测使用）
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      window.jujia.reportFirstPaint().catch(() => {
        /* perf 埋点失败不影响功能 */
      });
    });
    return () => cancelAnimationFrame(raf);
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
        {/*
          对话页常驻（T22 报备 §二，批复①）：切页签只切可见性、**不卸载** ——
          流订阅与面板自己那 24 个 state 都留着，所以"流式中切走再切回"能接回现有流。
          首次激活前不挂载，所以首屏 chunk 与启动时间线不受影响（懒加载性质没丢）。
          它用**自己的**错误边界与稳定 key：`key={tab}` 那套会把它重挂、状态照样丢。
        */}
        {state.phase === 'ready' && (
          <KeepAlive active={tab === 'chat'}>
            <ErrorBoundary key={`chat-${String(chatEpoch)}`} area={TAB_LABEL.chat} onError={markChatBroken}>
              <Suspense fallback={PANEL_FALLBACK}>
                <ChatPanel connections={connections} active={tab === 'chat'} />
              </Suspense>
            </ErrorBoundary>
          </KeepAlive>
        )}
        <ErrorBoundary key={tab} area={TAB_LABEL[tab]}>
          <Suspense fallback={PANEL_FALLBACK}>
          {state.phase === 'ready' && tab === 'connections' && (
            <ConnectionsPanel onChanged={setConnections} />
          )}
          {state.phase === 'ready' && tab === 'terminal' && (
            <TerminalPanel workspaceRoot={state.loaded.config.config.workspace} />
          )}
          {state.phase === 'ready' && tab === 'browser' && <BrowserPanel />}
          {state.phase === 'ready' && tab === 'docs' && <DocPanel />}
          {state.phase === 'ready' && tab === 'git' && <GitPanel />}
          {state.phase === 'ready' && tab === 'ide' && <IdePanel />}
          {state.phase === 'ready' && tab === 'canvas' && <CanvasPanel />}
          {state.phase === 'ready' && tab === 'mcp' && <McpPanel />}
          {state.phase === 'ready' && tab === 'permissions' && <PermissionRulesPanel />}
          {state.phase === 'ready' && tab === 'hooks' && <HooksPanel />}
          {state.phase === 'ready' && tab === 'plugins' && <PluginsPanel />}
          {state.phase === 'ready' && tab === 'appearance' && themePack !== null && (
            <AppearancePanel
              pack={themePack}
              onSave={async (pack) => {
                await window.jujia.configSet({
                  appearance: { packId: pack.id, pack },
                });
                setThemePack(pack);
              }}
            />
          )}
          </Suspense>
        </ErrorBoundary>
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
