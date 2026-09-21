import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { PermissionMode, PermissionRuleView } from '@jujia/shared-ipc';

/**
 * 权限设置页（W5c / M15）。
 *
 * 两件事，都直接作用于真实执行路径：
 * 1. **模式**（会话级意图）：default / acceptEdits / plan / dontAsk / bypassPermissions；
 * 2. **规则**（常设配置）：按工具名 glob 表达 allow / deny / ask。
 *
 * 优先级必须让用户一眼看懂（写在页面上，不是藏在文档里）：
 * deny 与 ask 绝对生效（连 bypassPermissions 也要让路）；
 * allow 只在本会话没有更严格意图（plan / dontAsk）时生效。
 *
 * 注意：`bypassPermissions` 危险，需要一次显式确认才允许保存 —— 这不是装饰性的确认框。
 */

const MODE_LABEL: Record<PermissionMode, string> = {
  default: '默认（写与执行需确认）',
  acceptEdits: '自动接受工作区内文件编辑（exec 仍需确认）',
  plan: '计划（只读，写与执行一律拒绝）',
  dontAsk: '拒绝而不询问（锁定环境）',
  bypassPermissions: '全部放行（危险，需要确认）',
};

const ACTION_LABEL: Record<PermissionRuleView['action'], string> = {
  allow: '自动放行',
  deny: '拒绝',
  ask: '必须询问',
};

export function PermissionRulesPanel(): ReactElement {
  const [rules, setRules] = useState<PermissionRuleView[]>([]);
  const [mode, setMode] = useState<PermissionMode>('default');
  const [bypassConfirmed, setBypassConfirmed] = useState(false);
  const [pattern, setPattern] = useState('');
  const [action, setAction] = useState<PermissionRuleView['action']>('deny');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = async (): Promise<void> => {
    try {
      const [list, config] = await Promise.all([
        window.jujia.permissionRulesList(),
        window.jujia.configGet(),
      ]);
      setRules(list);
      setMode(config.config.permissionMode);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void reload();
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

  const changeMode = (next: PermissionMode): Promise<void> =>
    guard(async () => {
      await window.jujia.configSet({ permissionMode: next });
      setMode(next);
      setNotice(`权限模式已切换为：${MODE_LABEL[next]}`);
    });

  const add = (): Promise<void> =>
    guard(async () => {
      const view = await window.jujia.permissionRulesAdd({
        pattern: pattern.trim(),
        action,
        ...(note.trim() !== '' ? { note: note.trim() } : {}),
      });
      setPattern('');
      setNote('');
      setNotice(`已新增规则：${view.pattern} → ${ACTION_LABEL[view.action]}`);
      await reload();
    });

  const toggle = (rule: PermissionRuleView): Promise<void> =>
    guard(async () => {
      await window.jujia.permissionRulesToggle(rule.id, !rule.enabled);
      await reload();
    });

  const remove = (rule: PermissionRuleView): Promise<void> =>
    guard(async () => {
      await window.jujia.permissionRulesRemove(rule.id);
      setNotice(`已删除规则：${rule.pattern}`);
      await reload();
    });

  const isDenyAll = action === 'deny' && (pattern.trim() === '*' || pattern.trim() === '**');

  return (
    <div className="w2-panel jj-perm">
      <section className="p0-card">
        <h2>权限模式（会话级意图）</h2>
        <p className="p0-subtitle">
          决定「写」与「执行」类操作默认要不要问你。只读操作永远不打扰你 ——
          除非下面的规则明确要求某个工具必须询问。
        </p>
        <div className="jj-perm-modes">
          {(Object.keys(MODE_LABEL) as PermissionMode[]).map((m) => (
            <label key={m} className="jj-perm-mode">
              <input
                type="radio"
                name="perm-mode"
                checked={mode === m}
                disabled={busy || (m === 'bypassPermissions' && !bypassConfirmed)}
                onChange={() => void changeMode(m)}
              />
              <span>{MODE_LABEL[m]}</span>
            </label>
          ))}
        </div>
        {mode === 'bypassPermissions' ? (
          <p className="p0-warn">
            当前为<b>全部放行</b>模式：任何写与执行都不会再询问你。规则表里的 deny / ask 仍然生效 ——
            这也是给危险模式留的最后一条缰绳。
          </p>
        ) : (
          <label className="jj-perm-mode">
            <input
              type="checkbox"
              checked={bypassConfirmed}
              onChange={(e) => setBypassConfirmed(e.target.checked)}
            />
            <span className="p0-subtitle">
              我明白风险，允许我在必要时切换到「全部放行」（不勾选时该选项不可选）
            </span>
          </label>
        )}
      </section>

      <section className="p0-card">
        <h2>规则表（常设配置）</h2>
        <p className="p0-subtitle">
          用「工具名匹配模式 + 动作」表达你的意图。
          <strong>deny 与 ask 绝对生效</strong>（连全部放行模式也要让路）；
          <strong> allow 在 plan / dontAsk 模式下不生效</strong>（会话级只读意图优先）。
          同一工具命中多条规则时取最严格的一侧。
        </p>

        {error && (
          <p className="p0-err" role="alert">
            {error}
          </p>
        )}
        {notice && <p className="p0-ok" role="status">{notice}</p>}

        <div className="jj-perm-form">
          <label>
            匹配模式（工具名 glob）
            <input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="例如 mcp__* 或 write_file 或 git_*"
              spellCheck={false}
            />
          </label>
          <label>
            动作
            <select value={action} onChange={(e) => setAction(e.target.value as PermissionRuleView['action'])}>
              <option value="deny">拒绝</option>
              <option value="ask">必须询问</option>
              <option value="allow">自动放行</option>
            </select>
          </label>
          <label>
            备注（为什么有这条规则）
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如 除非我确认，否则不让任何外部工具跑"
            />
          </label>
          {isDenyAll && (
            <p className="p0-warn">这条规则会拒绝所有工具（相当于一刀切断全部工具调用）。请确认这是你想要的。</p>
          )}
          <div className="w2-actions">
            <button
              type="button"
              className="w2-btn-primary"
              disabled={busy || pattern.trim() === ''}
              onClick={() => void add()}
            >
              新增规则
            </button>
          </div>
          <p className="p0-subtitle">
            匹配语法：<code>*</code> 任意字符（不跨路径分隔符）、<code>**</code> 任意字符、
            <code>?</code> 单个字符。刻意不做「按参数匹配」—— 参数语义需要每个工具自己声明，现在没有，
            做了只会是假能力。
          </p>
        </div>

        {rules.length === 0 ? (
          <p className="p0-subtitle">还没有任何规则。</p>
        ) : (
          <ul className="jj-perm-list">
            {rules.map((r) => (
              <li key={r.id} className={r.enabled ? 'jj-perm-rule' : 'jj-perm-rule jj-perm-rule-off'}>
                <label className="jj-perm-rule-main">
                  <input type="checkbox" checked={r.enabled} onChange={() => void toggle(r)} />
                  <span>
                    <code>{r.pattern}</code>
                    <span className={`jj-perm-action jj-perm-action-${r.action}`}>
                      [{ACTION_LABEL[r.action]}]
                    </span>
                    {r.note !== null && <span className="p0-subtitle"> {r.note}</span>}
                  </span>
                </label>
                <button type="button" className="w2-btn-danger" disabled={busy} onClick={() => void remove(r)}>
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
