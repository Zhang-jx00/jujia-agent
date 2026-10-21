import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { McpApprovalChoice, McpApprovalPlan, McpServerView } from '@jujia/shared-ipc';

/**
 * MCP 服务端管理与「连接同意」界面（W10e）。
 *
 * 这个界面的职责不是"让接入变简单"，而是**让用户看清自己要接入什么**：
 * - 逐字展示**将实际执行的命令**（不做美化、不做省略）；
 * - 风险提示原样呈现，不淡化、也不夸大；
 * - 工具**默认一个都不勾选** —— 用户点「连接」不等于同意接入，
 *   同意必须是对着具体工具逐项做出的动作。
 * - 未勾选的工具不会被注册，因此模型连"试着调用"的机会都没有。
 */

const STATE_LABEL: Record<McpServerView['state'], string> = {
  idle: '未连接',
  connecting: '连接中',
  awaiting_approval: '待你批准',
  connected: '已连接',
  error: '失败',
  exited: '进程已退出',
};

/**
 * 每一档的标签。
 *
 * T53（R47 · 2026-10-21）：`read` 这一档**只可能**来自服务端自述（`annotations.readOnlyHint`，
 * 见 `inferToolKind`：没自述的一律 `exec`）—— 所以标签必须写清"这是服务端声明的"，
 * 不许写成一个看起来像**本机判定**的「只读」。
 * `exec` 那一档相反：它是**本机**的默认值（服务端不声明就按最严格处理），标签照实。
 */
const KIND_LABEL: Record<McpApprovalPlan['tools'][number]['kind'], string> = {
  read: '服务端声明只读',
  write: '写入',
  exec: '每次询问',
};

interface FormState {
  id: string | null;
  name: string;
  command: string;
  argsText: string;
  envText: string;
  /**
   * 进入编辑时的环境变量文本基线。
   *
   * 为什么需要：环境变量的**值从不回传到渲染层**（只回传键名），
   * 所以界面上的这段文本永远不可能等于真实值。若不加区分地把这段文本提交回去，
   * 用户"只改了个名字"就会把环境变量的值静默清空。
   * 规则：**与基线一致 → 提交时不带 env（保持原值）；改动过 → 按你写的内容整体替换。**
   */
  envBaseline: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  name: '',
  command: 'npx',
  argsText: '',
  envText: '',
  envBaseline: '',
};

/** 一行一个参数：比让用户自己写 JSON 数组直观，也避免引号转义问题 */
function parseArgs(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** 一行一个 KEY=VALUE */
function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1);
  }
  return out;
}

export function McpPanel(): ReactElement {
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [plan, setPlan] = useState<McpApprovalPlan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = async (): Promise<void> => {
    try {
      setServers(await window.jujia.mcpServerList());
      /**
       * 批准计划的**事实一直在主进程**（`session.pendingPlan`），以前只随「连接」的回包出来一次，
       * 界面把它存在组件 state 里 —— 切个页签回来就没了，只能重新连一次（外部审查 T9）。
       * 这里在每次刷新时把它读回来；已经在看同一份就不动，避免把用户勾了一半的选择清空。
       */
      const pending = await window.jujia.mcpPendingPlan();
      if (pending !== null && plan === null) {
        setPlan(pending);
        setSelected(new Set());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void reload();
    // 主进程会广播状态变化（进程退出、握手失败等），UI 因此不需要轮询
    return window.jujia.onMcpStateChanged(setServers);
  }, []);

  async function guard(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const save = (): Promise<void> =>
    guard(async () => {
      const envDirty = form.envText !== form.envBaseline;
      const view = await window.jujia.mcpServerSave({
        ...(form.id !== null ? { id: form.id } : {}),
        name: form.name.trim(),
        command: form.command.trim(),
        args: parseArgs(form.argsText),
        // 没动过这一段就**不带 env**：保持原有环境变量不变（值不会回传到界面）
        ...(envDirty ? { env: parseEnv(form.envText) } : {}),
      });
      setForm(EMPTY_FORM);
      setNotice(
        `已保存「${view.name}」。改动过启动命令的话，旧连接已被断开。` +
          (form.id !== null && !envDirty ? ' 环境变量按原样保留（你未改动那一段）。' : ''),
      );
      await reload();
    });

  const connect = (id: string): Promise<void> =>
    guard(async () => {
      setNotice(null);
      const result = await window.jujia.mcpConnect(id);
      if (!result.ok) {
        setError(`连接失败：${result.error}`);
        await reload();
        return;
      }
      // 默认一个都不勾选：同意必须是对着具体工具做出的动作
      setSelected(new Set());
      setPlan(result.plan);
      await reload();
    });

  const approve = (action: 'deny' | 'approve_all' | 'approve_partial'): Promise<void> =>
    guard(async () => {
      if (!plan) return;
      const choice: McpApprovalChoice =
        action === 'approve_partial'
          ? { action: 'approve_partial', toolNames: [...selected] }
          : { action };
      const out = await window.jujia.mcpApprove(plan.serverId, choice);
      setPlan(null);
      setSelected(new Set());
      const extra =
        out.skipped.length > 0
          ? ` 未启用/被跳过 ${out.skipped.length} 个：${out.skipped
              .map((s) => `${s.name}（${s.reason}）`)
              .join('；')}`
          : '';
      setNotice(`${out.note}${extra}`);
      await reload();
    });

  const disconnect = (id: string): Promise<void> =>
    guard(async () => {
      await window.jujia.mcpDisconnect(id);
      setNotice('已断开：它的工具已从工具表里摘掉，子进程也已退出。');
      await reload();
    });

  const remove = (s: McpServerView): Promise<void> =>
    guard(async () => {
      await window.jujia.mcpServerDelete(s.id);
      setNotice(`已删除「${s.name}」。`);
      await reload();
    });

  /**
   * 勾/取消「掉线后自动重连」（T31 · 选项 B）。
   *
   * 走**同一条保存通道**（白名单是配置的一部分），因此：
   * - 命令/参数原样带回（不重填），**env 省略 = 保持原值**（值从来不回传到界面）；
   * - 改它**不会**断开连接 —— 断开只由"启动命令/参数/环境变量变了"触发。
   * 取消勾选 ⇒ 主进程会**取消正在排队的重连**（不再重试）。
   */
  const toggleAutoReconnect = (s: McpServerView, next: boolean): Promise<void> =>
    guard(async () => {
      await window.jujia.mcpServerSave({
        id: s.id,
        name: s.name,
        command: s.command,
        args: s.args,
        autoReconnect: next,
      });
      setNotice(
        next
          ? `已为「${s.name}」打开「掉线后自动重连」（最多试 3 次）。` +
              '重连后仍然要你重新批准工具 —— 自动重连只免掉「再点一次连接」。'
          : `已关闭「${s.name}」的「掉线后自动重连」，排队中的重连已取消。`,
      );
      await reload();
    });

  return (
    <div className="w2-panel">
      <section className="p0-card">
        <h2>MCP 服务端</h2>
        <p className="p0-subtitle">
          接入外部 MCP 服务端等于把第三方能力接进这台电脑。因此：<strong>点「连接」之后还要逐个工具批准</strong>，
          未批准的工具不会被注册，模型连"试着调用"的机会都没有。命令、风险与工具清单都会先给你看。
        </p>

        {error && (
          <p className="p0-err" role="alert">
            {error}
          </p>
        )}
        {notice && <p className="p0-ok" role="status">{notice}</p>}

        {servers.length === 0 ? (
          <p className="p0-subtitle">还没有配置任何 MCP 服务端。可以在下面新增一个。</p>
        ) : (
          <ul className="jj-mcp-list">
            {servers.map((s) => (
              <li key={s.id} className="jj-mcp-item">
                <div className="jj-mcp-head">
                  <strong>{s.name}</strong>
                  <span className={`jj-mcp-state jj-mcp-state-${s.state}`}>{STATE_LABEL[s.state]}</span>
                  <span className="jj-mcp-source">
                    {s.source === 'plugin' ? `插件 ${s.pluginName ?? ''}` : '你自己配置'}
                  </span>
                </div>
                <div className="jj-mcp-cmd">
                  <code>
                    {s.command} {s.args.join(' ')}
                  </code>
                  {s.envKeys.length > 0 && (
                    <span className="p0-subtitle"> · 环境变量：{s.envKeys.join(', ')}（只显示键名）</span>
                  )}
                </div>
                <div className="p0-subtitle">
                  发现工具 {s.discoveredTools} 个 · 已启用 {s.enabledTools.length} 个
                  {s.lastError ? ` · ${s.lastError}` : ''}
                </div>
                {/*
                  「掉线后自动重连」那一格（T31 · 选项 B · R52）。
                  **默认不勾**：自动重连 = 在没人点过的情况下再起一个第三方进程，
                  所以它必须是**逐个服务端显式授权**的（白名单），不是全局开关。
                  勾上之后界面必须说清两件事：① 这个服务端被授权在掉线后自动重启；
                  ② **重连仍要重新批准**（自动重连只免掉"再点一次连接"）。
                  重连的次数与最后一次失败原因复用上面那行 `lastError`（不新开一格）。
                */}
                {s.source === 'user' && (
                  <>
                    <label className="jj-check">
                      <input
                        type="checkbox"
                        checked={s.autoReconnect}
                        disabled={busy}
                        onChange={() => void toggleAutoReconnect(s, !s.autoReconnect)}
                      />
                      <span>掉线后自动重连</span>
                    </label>
                    <p className="p0-subtitle">
                      {s.autoReconnect
                        ? '已授权：这个服务端掉线后会被自动重新启动（最多试 3 次，间隔 2 秒 / 8 秒 / 30 秒）。'
                        : '默认关闭。勾上之后，它掉线时会自己重连（最多试 3 次，间隔 2 秒 / 8 秒 / 30 秒）。'}
                      <strong>自动重连只免掉「再点一次连接」，不免掉「再批一次工具」</strong> ——
                      重连后的会话会重新停在「待你批准」，一个工具都不会自动启用。随时可以取消勾选。
                    </p>
                  </>
                )}
                {s.disabledByPlugin && (
                  <p className="p0-warn">
                    插件清单把它标成了 <code>enabled: false</code> —— 已停用，不能连接。
                    要用请改那个插件的清单。
                  </p>
                )}
                <div className="w2-actions">
                  {s.state === 'connected' || s.state === 'awaiting_approval' ? (
                    <button type="button" className="w2-btn" disabled={busy} onClick={() => void disconnect(s.id)}>
                      断开
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="w2-btn-primary"
                      disabled={busy || s.disabledByPlugin}
                      title={s.disabledByPlugin ? '插件清单里 enabled 为 false，已停用' : undefined}
                      onClick={() => void connect(s.id)}
                    >
                      连接
                    </button>
                  )}
                  {s.source === 'user' && (
                    <button
                      type="button"
                      className="w2-btn"
                      disabled={busy}
                      onClick={() => {
                        // 值不会回传到界面，这里只回填键名并留空值；不动这一段即保持原值
                        const envText = s.envKeys.map((k) => `${k}=`).join('\n');
                        setForm({
                          id: s.id,
                          name: s.name,
                          command: s.command,
                          argsText: s.args.join('\n'),
                          envText,
                          envBaseline: envText,
                        });
                      }}
                    >
                      编辑
                    </button>
                  )}
                  {s.source === 'user' && (
                    <button type="button" className="w2-btn-danger" disabled={busy} onClick={() => void remove(s)}>
                      删除
                    </button>
                  )}
                </div>
                {s.source === 'plugin' && (
                  <p className="p0-subtitle">
                    这个服务端由插件提供：<strong>不能在这里编辑或删除</strong> —— 它由插件清单决定，
                    插件更新后会跟着变。连接与逐工具批准照常需要。
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="p0-card">
        <h2>{form.id === null ? '新增服务端' : '编辑服务端'}</h2>
        <div className="jj-mcp-form">
          <label>
            显示名
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例如 文件系统"
            />
          </label>
          <label>
            命令
            <input
              value={form.command}
              onChange={(e) => setForm({ ...form, command: e.target.value })}
              placeholder="npx"
            />
          </label>
          <label>
            参数（一行一个）
            <textarea
              rows={3}
              value={form.argsText}
              onChange={(e) => setForm({ ...form, argsText: e.target.value })}
              placeholder={'-y\n@modelcontextprotocol/server-filesystem\nD:\\某个目录'}
              spellCheck={false}
            />
          </label>
          <label>
            环境变量（一行一个 KEY=VALUE，不要放密钥）
            <textarea
              rows={2}
              value={form.envText}
              onChange={(e) => setForm({ ...form, envText: e.target.value })}
              spellCheck={false}
            />
          </label>
          {form.id !== null && form.envText === form.envBaseline && form.envBaseline !== '' && (
            <p className="p0-subtitle">
              这一行只显示键名 —— 值不会回传到界面。<strong>不改动这一段就保持原值</strong>；
              如果你改了它，就会按你写的内容<strong>整体替换</strong>（想保留某个键的值需要重新填写）。
            </p>
          )}
          <p className="p0-subtitle">
            启动命令里若含 shell 元字符（管道、重定向、分号等）会被直接拒绝 —— 我们以数组传参，不走 shell。
          </p>
          <div className="w2-actions">
            <button
              type="button"
              className="w2-btn-primary"
              disabled={busy || form.name.trim() === '' || form.command.trim() === ''}
              onClick={() => void save()}
            >
              {form.id === null ? '新增' : '保存修改'}
            </button>
            {form.id !== null && (
              <button type="button" className="w2-btn" onClick={() => setForm(EMPTY_FORM)}>
                取消编辑
              </button>
            )}
          </div>
        </div>
      </section>

      {plan && (
        <ConsentDialog
          plan={plan}
          selected={selected}
          busy={busy}
          onToggle={(name) => {
            const next = new Set(selected);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            setSelected(next);
          }}
          onSelectAll={() => setSelected(new Set(plan.tools.map((t) => t.qualifiedName)))}
          onSelectReadOnly={() =>
            setSelected(new Set(plan.tools.filter((t) => t.kind === 'read').map((t) => t.qualifiedName)))
          }
          onClear={() => setSelected(new Set())}
          onDecide={approve}
        />
      )}
    </div>
  );
}

function ConsentDialog({
  plan,
  selected,
  busy,
  onToggle,
  onSelectAll,
  onSelectReadOnly,
  onClear,
  onDecide,
}: {
  plan: McpApprovalPlan;
  selected: Set<string>;
  busy: boolean;
  onToggle: (qualifiedName: string) => void;
  onSelectAll: () => void;
  onSelectReadOnly: () => void;
  onClear: () => void;
  onDecide: (action: 'deny' | 'approve_all' | 'approve_partial') => Promise<void>;
}): ReactElement {
  return (
    <div className="w3-mask" role="dialog" aria-modal="true" aria-label="MCP 连接同意">
      <div className="w3-dialog jj-mcp-consent">
        <h3>要接入「{plan.serverName}」</h3>

        <p className="p0-subtitle">这个进程将被启动（原样展示，不做省略）：</p>
        <pre>{plan.commandLine}</pre>

        {plan.envKeys.length > 0 && (
          <p className="p0-subtitle">会附带这些环境变量：{plan.envKeys.join(', ')}（只显示键名，不显示值）</p>
        )}

        {plan.warnings.length > 0 && (
          <div className="p0-warn">
            <strong>风险提示</strong>
            <ul>
              {plan.warnings.map((w) => (
                <li key={w.code}>{w.message}</li>
              ))}
            </ul>
          </div>
        )}

        <p className="p0-subtitle">
          它提供了 {plan.toolCount} 个工具：其中 {plan.alwaysAskCount} 个属于「每次调用都会再问你一次」，
          {plan.readOnlyCount} 个是服务端声明的只读。
          <strong> 默认一个都不勾选</strong> —— 请只勾选你确实要用的。
        </p>

        {/*
          T53（R47 · 2026-10-21）：**信任边界不移动，但要说清边界在哪**。
          授权已定：服务端自述 `readOnlyHint` 只当提示，判定仍以本机敏感路径表为准
          （见 `docs/DECISION-SELF-DIRECTED.md`）。
          这句话说的是今天**仍然成立**的三件事，不许夸大也不许淡化：
          ① 「只读」这一档是**服务端自己声明**的，本机不替它担保；
          ② 走到这一档的调用**不再问你**；
          ③ 本机仍会查一次敏感路径表，**但那张表只认参数里叫 `path` 的那个键** ——
          服务端换个键名，本机就认不出那条路径。
          配套的现状锁（`mcp-selfdeclared-readonly.test.ts`）一个字未动。
        */}
        {plan.readOnlyCount > 0 && (
          <p className="p0-warn">
            <b>「只读」这一档是服务端自己声明的</b>（它写 <code>readOnlyHint</code>，本机不替它担保）：
            走到这一档的调用<b>不再问你</b>就直接执行。本机仍会查一次敏感路径表 ——
            但那张表只认参数里叫 <code>path</code> 的那个键，服务端换个键名（本机叫不出名字）就认不出那条路径。
            不放心就别勾这一档。
          </p>
        )}

        <div className="w2-actions">
          <button type="button" className="w2-btn" onClick={onSelectAll}>
            全选
          </button>
          <button type="button" className="w2-btn" onClick={onSelectReadOnly}>
            只选只读的
          </button>
          <button type="button" className="w2-btn" onClick={onClear}>
            全不选
          </button>
        </div>

        <ul className="jj-mcp-tools">
          {plan.tools.map((t) => (
            <li key={t.qualifiedName}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.has(t.qualifiedName)}
                  onChange={() => onToggle(t.qualifiedName)}
                />
                <span>
                  <code>{t.rawName}</code>
                  <span className={`jj-mcp-kind jj-mcp-kind-${t.kind}`}>[{KIND_LABEL[t.kind]}]</span>
                  <span className="p0-subtitle"> {t.description}</span>
                  <br />
                  <span className="p0-subtitle">分级依据：{t.kindReason}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        <div className="w2-actions">
          <button
            type="button"
            className="w2-btn-primary"
            disabled={busy || selected.size === 0}
            onClick={() => void onDecide('approve_partial')}
          >
            批准所选（{selected.size}）
          </button>
          <button type="button" className="w2-btn" disabled={busy} onClick={() => void onDecide('approve_all')}>
            全部批准
          </button>
          <button type="button" className="w2-btn-danger" disabled={busy} onClick={() => void onDecide('deny')}>
            拒绝接入
          </button>
        </div>
        <p className="p0-subtitle">
          拒绝会把这个进程也一起退掉，不会留下一个后台进程。每次连接都需要重新批准（服务端升级后工具可能变化）。
        </p>
      </div>
    </div>
  );
}
