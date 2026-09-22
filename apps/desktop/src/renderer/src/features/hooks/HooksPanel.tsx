import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { HooksState } from '@jujia/shared-ipc';

/**
 * 生命周期钩子设置页（W5d）。
 *
 * 现状与取舍（如实写在界面上，不靠文档兜）：
 * - 配置是**嵌套结构**（事件 → matcher 组 → 钩子列表），本轮以 **JSON 直接编辑**为准，
 *   图形化编辑器未做 —— 与其做一个只能表达最简单情形的表单，不如先把契约与校验做扎实；
 * - 校验失败**不落盘**，错误逐条显示；
 * - 钩子**默认关闭**；这是给"知道自己要什么"的人用的自动化。
 */

const EVENT_LABEL: Record<string, string> = {
  SessionStart: '会话开始',
  UserPromptSubmit: '用户提交提示词',
  PreToolUse: '工具执行前',
  PostToolUse: '工具成功后',
  PostToolUseFailure: '工具失败后',
  PermissionRequest: '需要审批时',
  Stop: '一轮即将结束',
};

/** 已全部接入运行路径；保留这个常量是为了将来新增事件时能先上契约、后接路径 */
const NOT_WIRED: ReadonlyArray<string> = [];

const EXAMPLE = `{
  "enabled": true,
  "timeoutMs": 60000,
  "maxOutputBytes": 32768,
  "events": {
    "PreToolUse": [
      {
        "matcher": "^write_",
        "hooks": [{ "type": "process", "command": "node", "args": ["D:/hooks/guard.mjs"] }]
      }
    ]
  }
}`;

export function HooksPanel(): ReactElement {
  const [state, setState] = useState<HooksState | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = async (): Promise<void> => {
    try {
      const next = await window.jujia.hooksGet();
      setState(next);
      setText(JSON.stringify(next.raw, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        setError('JSON 不合法，请修正后再保存（不会写入任何内容）');
        return;
      }
      const result = await window.jujia.hooksSet(parsed);
      setState(result.state);
      if (!result.ok) {
        setError(`配置未生效：\n${result.errors.join('\n')}`);
        return;
      }
      setNotice(result.state.enabled ? '已保存并启用。' : '已保存（当前为关闭状态，钩子不会运行）。');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function fillExample(): void {
    setText(EXAMPLE);
    setNotice('已填入示例，请把 command/args 改成你自己的脚本路径再保存。');
  }

  return (
    <div className="w2-panel jj-hooks">
      <section className="p0-card">
        <h2>生命周期钩子</h2>
        <p className="p0-subtitle">
          钩子是在关键时刻自动跑一次你自己的程序：读事件 JSON（stdin）→ 回一个 JSON（stdout）。
          <strong>默认关闭</strong>；命令以 <strong>argv 数组</strong>执行、绝不拼 shell 字符串；
          <strong>退出码 2 = 显式拒绝</strong>；其余失败（超时 / 非 JSON / 非 2 的非零退出）
          只记诊断、<strong>不阻断</strong> —— 写坏的钩子不该把应用变成砖，主权限门仍然照常生效。
        </p>

        {error !== null && (
          <p className="p0-err" role="alert" style={{ whiteSpace: 'pre-wrap' }}>
            {error}
          </p>
        )}
        {notice !== null && (
          <p className="p0-ok" role="status">
            {notice}
          </p>
        )}

        <p className="p0-subtitle">
          当前状态：<strong>{state?.enabled === true ? '已启用' : '关闭'}</strong>
          {state !== null && ` · 配置文件：${state.filePath}`}
        </p>

        {state !== null && (
          <table className="jj-hooks-table">
            <thead>
              <tr>
                <th>事件</th>
                <th>已配置钩子数</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(EVENT_LABEL).map(([ev, label]) => (
                <tr key={ev}>
                  <td>
                    <code>{ev}</code>
                  </td>
                  <td>{state.counts[ev] ?? 0}</td>
                  <td className="p0-subtitle">
                    {label}
                    {NOT_WIRED.includes(ev) && <strong> · 尚未接入运行路径</strong>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="p0-card">
        <h2>配置（JSON）</h2>
        <textarea
          className="jj-hooks-editor"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={18}
          spellCheck={false}
        />
        <div className="w2-actions">
          <button type="button" className="w2-btn-primary" disabled={busy} onClick={() => void save()}>
            保存并校验
          </button>
          <button type="button" className="w2-btn" disabled={busy} onClick={fillExample}>
            填入示例
          </button>
          <button type="button" className="w2-btn" disabled={busy} onClick={() => void reload()}>
            放弃修改
          </button>
        </div>
        <p className="p0-subtitle">
          匹配语法：<code>matcher</code> 是 JS 正则字符串（省略 = 该事件全部输入）。
          PreToolUse / PermissionRequest / PostToolUse / PostToolUseFailure 的匹配目标是<strong>工具名</strong>。
          命令与参数里不能出现 shell 元字符（含分号）—— 请把逻辑写进脚本文件。
        </p>
      </section>
    </div>
  );
}
