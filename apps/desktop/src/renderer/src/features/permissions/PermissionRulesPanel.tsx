import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { AuditPageView, PermissionMode, PermissionRulesHealth, PermissionRuleView } from '@jujia/shared-ipc';
import { IconTriangleAlert } from '../../ui/icons';

/**
 * 权限设置页（W5c / M15）。
 *
 * 两件事，都直接作用于真实执行路径：
 * 1. **模式**（会话级意图）：default / acceptEdits / plan / dontAsk / bypassPermissions；
 * 2. **规则**（常设配置）：按工具名 glob 表达 allow / deny / ask，
 *    其中 deny / ask 还可以再窄到「命令行的字面前缀」（allow 那一侧校验层直接拒）。
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
  const [prefix, setPrefix] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditPageView | null>(null);
  const [auditMsg, setAuditMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  /** T37 的界面一半（R23）：规则文件从哪一档读出来的 —— 读坏了要在这页上说 */
  const [health, setHealth] = useState<PermissionRulesHealth | null>(null);

  const reload = async (): Promise<void> => {
    try {
      const [list, config, healthNow] = await Promise.all([
        window.jujia.permissionRulesList(),
        window.jujia.configGet(),
        window.jujia.permissionRulesHealth(),
      ]);
      setRules(list);
      setMode(config.config.permissionMode);
      setHealth(healthNow);
      // 审计读失败**不连带拖垮这一页**：规则表还能改，账要单独说一句为什么看不到
      try {
        setAudit(await window.jujia.auditTail(20));
      } catch (err) {
        setAudit(null);
        setAuditMsg({ kind: 'bad', text: `审计读不出来：${err instanceof Error ? err.message : String(err)}` });
      }
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
      const trimmedPrefix = prefix.trim();
      const view = await window.jujia.permissionRulesAdd({
        pattern: pattern.trim(),
        action,
        ...(note.trim() !== '' ? { note: note.trim() } : {}),
        ...(trimmedPrefix !== '' ? { argPrefix: trimmedPrefix } : {}),
      });
      setPattern('');
      setNote('');
      setPrefix('');
      setNotice(`已新增规则：${view.pattern}${view.argPrefix !== null ? `（前缀 ${view.argPrefix}）` : ''} → ${ACTION_LABEL[view.action]}`);
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

  const exportAudit = (): Promise<void> =>
    guard(async () => {
      const res = await window.jujia.auditExport();
      // 三种结果三种话：取消不是失败（用户什么都没做错），失败必须带上原因
      if (res.ok) {
        setAuditMsg({ kind: 'ok', text: `已写出 ${String(res.lines)} 行到 ${res.file}` });
        return;
      }
      setAuditMsg({ kind: res.cancelled ? 'ok' : 'bad', text: res.error });
    });

  const isDenyAll = action === 'deny' && (pattern.trim() === '*' || pattern.trim() === '**');

  return (
    <div className="w2-panel">
      {health !== null && (health.source !== 'primary' || health.recovered) && (
        // T37（R23）：规则读坏了**不静默** —— 旧行为是"悄悄按空表跑"，用户写过的 deny 不生效
        // 而界面显示"还没有任何规则"。这里把来源如实说出来。
        <p className="p0-err" role="status">
          {health.source === 'default'
            ? '规则文件读不出来，已按「没有规则」运行 —— 你写过的 deny 可能没有生效；请检查数据目录的 permission-rules.json（上一份在 .bak 里）'
            : '规则主文件损坏，已从备份 .bak 恢复 —— 请核对下面的列表是否完整'}
        </p>
      )}
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
              placeholder="例如 mcp__* 或 write_file 或 list_dir"
              spellCheck={false}
            />
          </label>
          <label>
            动作
            <select
              value={action}
              onChange={(e) => {
                const next = e.target.value as PermissionRuleView['action'];
                setAction(next);
                // 切成 allow 时那一格连同**内容**一起消失。只藏不清会留下一种最难懂的报错：
                // 提交带出一个界面上根本看不见的 argPrefix，主进程按规矩拒收，
                // 而错误文案指的是一格不存在的位置。
                if (next === 'allow') setPrefix('');
              }}
            >
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
          {action === 'allow' ? (
            <p className="p0-subtitle">
              命令前缀只对<b>拒绝</b>与<b>必须询问</b>开放。「以后不再问某一条命令」不在这一版里做 ——
              命令行是可以拼接的，按前缀永久放行等于把权限门按命令拆掉。
              要放行整类工具就按工具名写 allow，要完全不加判断请用「全部放行」模式。
            </p>
          ) : (
            <label>
              命令前缀（可选，只用于收紧）
              <input
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="例如 rm -rf 或 git push（留空=这条规则管该工具的所有调用）"
                spellCheck={false}
              />
            </label>
          )}
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
            <code>?</code> 单个字符。命令前缀按<b>字面</b>匹配命令行的开头（不是 glob），
            只有声明了自己命令行参数的工具参与 —— 目前只有 <code>run_command</code>。
            前缀没匹配上、或命令里带了 <code>|</code> <code>&amp;</code> <code>;</code>
            这类组合符时，规则一律<b>不生效</b>，执行类命令仍会照常问你一次（少拦住一次不等于多放行一次）。
          </p>
          {/*
            T52（2026-10-15）：这一格到底管多大范围，界面要自己说出口。
            "字面匹配开头"意味着一次改写形态就绕得开 —— 这是**当下真实的行为**，
            不是悲观假设（收紧到按 argv 逐词比对要动"用户写下的承诺算不算数"，属待决策项）。
            不写这句话的代价很具体：用户以为 `deny git push` 拦得住推送，于是别再检查。
          */}
          <p className="p0-warn">
            <b>但请看清这一格的边界</b>：前缀是按<b>字面</b>比对的，所以
            <code>git.exe push</code>、<code>"git" push</code>、<code>C:\...\git\cmd\git.exe push</code>
            这类<b>改写形态</b>不会被 <code>deny git push</code> 命中 —— 写得越具体，越容易被绕开一步。
            组合符（<code>|</code> <code>&amp;</code> <code>;</code>）那条虽然让规则<b>不生效</b>，
            执行类命令<b>还是会问你</b>一次；真正会漏的只有上面这种"同一条命令换了个写法"。
            把匹配收紧到逐词比对会改动既有规则的范围（收紧侧保守、放行侧就是放行），这条还没定。
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
                    {r.argPrefix !== null && (
                      <span className="jj-perm-action">
                        （前缀 <code>{r.argPrefix}</code>）
                      </span>
                    )}
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

      <section className="p0-card">
        <h2>执行审计（今天）</h2>
        <p className="p0-subtitle">
          每次权限判定都在本机留一行：谁被判定、结论、理由（含命中的规则与命令前缀）、有没有人答、
          这件事最后<strong>做没做成</strong>。参数只记键名、长度与指纹，命令记的是<strong>剔掉密钥之后</strong>的文本 ——
          文件正文与密钥值不进这本账，导出时也没有第二次加工。
        </p>
        <p className="p0-warn">
          覆盖范围：工具调用（内置 / MCP / 技能 / 画布）· git 暂存 / 提交 / 推送 · 交给外部程序（系统与自选）·
          钩子配置改动 · <b>内置终端的新起会话</b>。
          {/*
            T41（2026-10-15）：终端这一格改了口径 —— 它现在<b>入账</b>了，
            但记的是「没有策略判定、只有当面答复」那一类（账上的 decidedBy:'person'）。
            原来那句"不在本账里"必须先绝迹：账上真有一行，还说没有就是把事实说反。
          */}
          <b>但"记了账"不等于"规则管得住它"</b>：终端不经过策略判定，
          每次新起会话都<b>当面问</b>一次，所以你在这一页写的 <code>terminal</code> 规则<b>对它无效</b>
          （想让它也按规则判，改的是这台机器的门怎么判 —— 这条还没定）。
        </p>
        {auditMsg && (
          <p className={auditMsg.kind === 'ok' ? 'p0-ok' : 'p0-err'} role={auditMsg.kind === 'ok' ? 'status' : 'alert'}>
            {auditMsg.text}
          </p>
        )}
        {audit === null ? (
          <p className="p0-subtitle">这次没能读到审计（上面的红字是原因）。</p>
        ) : (
          <>
            {audit.notice !== '' && (
              <p className="p0-warn" role="alert">
                {audit.notice}
              </p>
            )}
            {audit.records.length === 0 ? (
              <p className="p0-subtitle">今天还没有判定记录。</p>
            ) : (
              <ul className="jj-audit-list">
                {audit.records.map((r, i) => (
                  <li key={`${String(r.ts)}-${String(r.subject)}-${String(i)}`} className="jj-audit-row">
                    <span>
                      <code>{r.subject}</code>
                      <span className={`jj-perm-action jj-perm-action-${r.outcome === 'allow' ? 'allow' : r.outcome === 'deny' ? 'deny' : 'ask'}`}>
                        [{r.outcome === 'allow' ? '放行' : r.outcome === 'deny' ? '拒绝' : '询问'}
                        {r.executed ? '·已做' : '·未做'}]
                      </span>
                      {'answer' in r && r.answer !== undefined && <span className="p0-subtitle"> 答复 {r.answer}</span>}
                      <span className="p0-subtitle"> {r.reason}</span>
                      {r.args.command !== undefined && <code> {r.args.command}</code>}
                      {r.rules !== undefined && r.rules.degraded && (
                        <span className="p0-warn"> <IconTriangleAlert /> 这一条判定时规则表当时没读出来（按空表跑的）</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="p0-subtitle">
              今天共 {String(audit.total)} 条，这里显示最近 {String(audit.records.length)} 条；账本在{' '}
              <code>{audit.file}</code>（本机）。
            </p>
            <div className="w2-actions">
              <button type="button" className="w2-btn" disabled={busy} onClick={() => void exportAudit()}>
                导出审计到本机文件
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
