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
import { NAV_GROUPS, TAB_ICON, TAB_LABEL } from './nav';
import type { Tab } from './nav';
import { applyThemeVars } from './features/appearance/theme-vars';
import { LogCard } from './features/logs/LogCard';
import { UpdateCard } from './features/update/UpdateCard';
import { PermissionDialog } from './features/permission/PermissionDialog';
import { ErrorBoundary } from './ErrorBoundary';
import { KeepAlive } from './KeepAlive';
import { IconGear, IconSearch, IconTriangleAlert, ICON_BY_NAME } from './ui/icons';
import { FailureNotices } from './ui/failure-notice';
import { CommandPalette } from './features/launcher/CommandPalette';
import type { AppCommand } from './features/launcher/commands';

// 懒加载：连接页与对话页不在首屏，拆出去可显著减小初始 bundle（懒加载策略见 PERF-BUDGET）
const ConnectionsPanel = lazy(() =>
  import('./features/connections/ConnectionsPanel').then((m) => ({ default: m.ConnectionsPanel })),
);
const ChatPanel = lazy(() =>
  import('./features/chat/ChatPanel').then((m) => ({ default: m.ChatPanel })),
);
const MediaGenPanel = lazy(() =>
  import('./features/media/MediaGenPanel').then((m) => ({ default: m.MediaGenPanel })),
);
const TerminalPanel = lazy(() =>
  import('./features/terminal/TerminalPanel').then((m) => ({ default: m.TerminalPanel })),
);
const SettingsCenter = lazy(() =>
  import('./features/settings/SettingsCenter').then((m) => ({ default: m.SettingsCenter })),
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
const SchedulePanel = lazy(() =>
  import('./features/schedule/SchedulePanel').then((m) => ({ default: m.SchedulePanel })),
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

const sourceLabel: Record<ConfigSnapshot['source'], string> = {
  primary: '主文件',
  backup: '备份 .bak',
  default: '默认值',
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
  /**
   * 设置中心开着没有（R67 · 设置中心 · **R68 改成盖住整窗**）。
   *
   * 为什么是**外壳的一等状态**而不是又一个页签：设置是"整页覆盖"的那种界面
   * （左导航分组 + 右侧内容）。
   * R67 取的是"占主区、左栏保持可见" ⇒ 界面上同时出现**两根左栏**（应用那根 + 设置中心那根）
   * ⇒ R68 改成**盖住整窗**：整个外壳（连左栏）一起被藏起来 ⇒ **任何时候只剩一根左栏**。
   * 正文**只是被藏，不许卸载**（T22 报备 §二「对话页常驻」：会话 / 连接选择 / 在飞的流都留着）。
   */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * 启动器开着没有（R68 · 左栏瘦身的第二入口）。
   *
   * 为什么要有它：左栏瘦到 7 项之后，低频入口（连接 / 浏览器 / 绘图 / 定时）**不在侧栏了**
   * ⇒ 必须有**一处搜得到**的路（否则就是重犯 T83 那条「入口藏起来 ⇒ 用户不知道还有」的错）。
   */
  const [paletteOpen, setPaletteOpen] = useState(false);

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
      const { BUILTIN_PACKS, validateThemePack, themePackToCssVars, THEME_PACK_VAR_KEYS } =
        await import('@jujia/ui-tokens');
      if (cancelled) return;
      const check = validateThemePack(saved.pack ?? null);
      const pack = (check.ok && check.pack ? check.pack : BUILTIN_PACKS[0]) as ThemePack;
      const root = document.documentElement;
      // R58（T79）：走 `applyThemeVars`（**先清残值再写**）—— `setProperty` 只写不清，
      // 不清就会把上一个包的 `--jj-primary` 留在 `:root` 上 ⇒ "换包后主色还是上一个包的"。
      applyThemeVars(root, themePackToCssVars(pack), THEME_PACK_VAR_KEYS);
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

  /**
   * 启动器的快捷键：**Ctrl/Cmd + Shift + P**（同类 IDE 的命令面板惯例）。
   *
   * **不用 Ctrl+K**：画布的命令面板已经占着它（`CanvasPanel` 的窗口级监听）⇒ 两个面板撞键。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (!e.shiftKey) return;
      if (e.key.toLowerCase() !== 'p') return;
      e.preventDefault();
      setPaletteOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** 启动器里选中一条 ⇒ 跳过去（设置这一项是"开设置中心"，其余是"切到那一页"） */
  const runCommand = useCallback((cmd: AppCommand): void => {
    setPaletteOpen(false);
    if (cmd.target === 'settings') {
      setSettingsOpen(true);
      return;
    }
    setTab(cmd.target);
    setSettingsOpen(false);
  }, []);

  const smokeMarker = state.phase === 'ready' ? 'ok' : state.phase;

  return (
    <div className="app-root">
      {/*
        **这一整块只是被藏起来，不许卸载**（R67 的 e2e 当场抓到的真回归）：
        之前用「条件分支」换页面 ⇒ 打开设置中心会把**对话页一起卸载**
        ⇒ 它的会话、连接选择、**在飞的流**全丢 ⇒ 违反 T22 报备的「**对话页常驻**」。
        ⇒ 改法：外壳整体 `hidden`（`display:none`），DOM 结构一直在。
        ⇒ R68：设置中心**盖住整窗**（连左栏一起盖）⇒ 任何时候**只有一根左栏**。
      */}
      <div className="app-shell" hidden={settingsOpen}>
      {/*
        左栏（R66 · 主界面两栏化 · R68 · 左栏瘦身）：品牌 → 分组导航 → 底部信息。
        为什么从顶栏搬下来：16 个入口横排在顶栏里，窗口一窄就被压扁/换行，
        而"入口"是**导航**（左栏是导航的天然位置），"当前在看哪一页"才是顶栏的活。
        R68：左栏只留**工作区类**入口（7 项）⇒ 低频的那几项去**启动器**（一处搜得到，不是藏起来）。
      */}
      <aside className="app-rail">
        <div className="app-rail-brand">
          <span className="app-rail-mark" aria-hidden="true" />
          <span className="app-rail-name">俱佳Agent</span>
        </div>
        {/*
          **启动器的鼠标入口**（R68）。
          为什么非有不可：低频入口（连接 / 浏览器 / 绘图 / 定时）已经离开左栏 ⇒
          它们只剩启动器这一条路 ⇒ 而启动器如果**只有快捷键**，对不用键盘的人来说
          就是**藏起来** ⇒ 正是本仓 T83 那条教训（「入口藏起来 ⇒ 用户不知道还有 ⇒ 更糟」）。
          ⇒ 所以左栏顶上给一个**看得见、点得到**的搜索按钮。
          （这条有判据盯着：见 `features/launcher/launcher-wiring.test.ts` 的「鼠标入口」一条。）
        */}
        <button
          type="button"
          className="jj-rail-search jj-transition"
          title="搜索功能（Ctrl/Cmd+Shift+P）"
          onClick={() => setPaletteOpen(true)}
        >
          <IconSearch size={15} />
          <span>搜索功能</span>
        </button>
        <nav className="app-tabs" aria-label="主导航">
          {NAV_GROUPS.map((group) => (
            <div className="app-rail-group" key={group.title}>
              <div className="app-rail-group-title">{group.title}</div>
              <div className="app-rail-group-items">
                {group.tabs.map((t) => {
                  const Icon = ICON_BY_NAME[TAB_ICON[t]];
                  return (
                    <button
                      key={t}
                      type="button"
                      className={t === tab ? 'app-tab app-tab-active' : 'app-tab'}
                      aria-current={t === tab ? 'page' : undefined}
                      onClick={() => {
                        setTab(t);
                        // 点左栏的入口 = "我要去那一页" ⇒ **顺手把设置中心收起来**
                        // （否则设置中心会一直占着主区，而用户已经换了目的地）。
                        setSettingsOpen(false);
                      }}
                    >
                      {Icon === undefined ? null : <Icon size={15} />}
                      <span className="app-tab-text">{TAB_LABEL[t]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="app-rail-foot">
          {/*
            设置入口（R67）：设置类面板全部收进**设置中心**（整页覆盖主区）⇒
            左栏只留干活的入口（11 项）+ 这一个齿轮 ⇒ 同一个目的地只有一处门。
          */}
          <button
            type="button"
            className="jj-rail-settings jj-transition"
            onClick={() => setSettingsOpen(true)}
          >
            <IconGear size={15} />
            <span>设置</span>
          </button>
          <div className="app-rail-foot-line">
            <span className="app-rail-foot-line">
              {state.phase === 'ready' ? `v${state.loaded.info.version}` : 'v—'}
            </span>
            <span
              className="app-rail-foot-line app-rail-foot-dim"
              title={state.phase === 'ready' ? state.loaded.info.dataRoot : undefined}
            >
              本地优先
            </span>
          </div>
        </div>
      </aside>

      <div className="app-main">
        {/*
          注意：**这一段不许被卸载**（R67 的 e2e 当场抓到的真回归）：
          之前这里是「设置中心开 ⇒ 整段换成设置中心」的**条件分支** ⇒
          打开设置中心会把**对话页一起卸载** ⇒ 它的会话、连接选择、在飞的流**全丢**
          ⇒ 违反 T22 报备的「**对话页常驻**（切页签只切可见性、不卸载）」。
          ⇒ 改法：设置中心与正文**并存**，正文用 `hidden` 藏起来（`display:none`，不卸载）。
          R68：整个**外壳**（左栏 + 主区）一起藏 ⇒ 设置中心盖住整窗 ⇒ 只剩一根左栏。
        */}
        <div className="app-content">
          <header className="app-header">
            <h1 className="p0-title">{TAB_LABEL[tab]}</h1>
            <div className="app-header-meta">
              {connections.length > 0 ? `${String(connections.length)} 个连接` : '尚未配置连接'}
            </div>
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
              {/* 媒体生成 · 文生图（M11 剩余 · R51 · S1）：走当前连接，产物落本应用数据目录 */}
              {state.phase === 'ready' && tab === 'media' && <MediaGenPanel connections={connections} />}
              {state.phase === 'ready' && tab === 'terminal' && (
                <TerminalPanel workspaceRoot={state.loaded.config.config.workspace} />
              )}
              {state.phase === 'ready' && tab === 'browser' && <BrowserPanel />}
              {state.phase === 'ready' && tab === 'docs' && <DocPanel />}
              {state.phase === 'ready' && tab === 'git' && <GitPanel />}
              {state.phase === 'ready' && tab === 'ide' && <IdePanel />}
              {state.phase === 'ready' && tab === 'canvas' && <CanvasPanel />}
              {state.phase === 'ready' && tab === 'schedule' && <SchedulePanel />}
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>
      </div>
      </div>

      {/*
        设置中心（R67 · R68 盖整窗）：**外壳的兄弟节点** ⇒ 它一开，左栏与主区一起被盖住
        ⇒ 任何时候**只有一根左栏**（R67 留下"两根左栏并排"，是所有者那句抱怨的另一半）。
        ⇒ 正文**只是被藏起来**（上面的 `.app-shell[hidden]`）⇒ 对话页**不会被卸载**（T22）。
      */}
      {settingsOpen && (
        <ErrorBoundary key="settings" area="设置">
          <Suspense fallback={PANEL_FALLBACK}>
            <SettingsCenter
              pack={themePack}
              onSavePack={async (pack) => {
                await window.jujia.configSet({
                  appearance: { packId: pack.id, pack },
                });
                setThemePack(pack);
              }}
              onClose={() => setSettingsOpen(false)}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/*
        启动器（R68 · 左栏瘦身的第二入口）：一处搜全部。
        快捷键用 **Ctrl/Cmd+Shift+P**（同类 IDE 的命令面板惯例）——
        **不用 Ctrl+K**：画布的命令面板已经占着它（节点命令，与这个不是一回事）。
      */}
      {paletteOpen && (
        <ErrorBoundary key="launcher" area="启动器">
          <CommandPalette onClose={() => setPaletteOpen(false)} onRun={runCommand} />
        </ErrorBoundary>
      )}

      {/* 权限审批弹窗挂在最外层：任何页面触发的工具调用都能被审批 */}
      <PermissionDialog />
      {/* T45：失败兜底同样挂最外层 —— 它接的是"没人 catch 的那一步"（见 ui/failure-notice.tsx） */}
      <FailureNotices />
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
            <IconTriangleAlert /> 本次启动检测到配置不可用，已从
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

      <LogCard />
      <UpdateCard currentVersion={info.version} />
    </div>
  );
}
