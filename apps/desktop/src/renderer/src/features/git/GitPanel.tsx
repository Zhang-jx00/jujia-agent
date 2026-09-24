import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { GitDiffSummaryView, GitStatusEntryView } from '@jujia/shared-ipc';

interface StatusEntry extends GitStatusEntryView {
  staged: boolean;
}

/** porcelain 状态码第一列是暂存区、第二列是工作区；`??` 是未跟踪（两列都是 2） */
function splitEntries(entries: ReadonlyArray<GitStatusEntryView>): StatusEntry[] {
  return entries.map((e) => ({
    ...e,
    staged: e.code !== '??' && e.code.charAt(0) !== ' ' && e.code.charAt(0) !== '?',
  }));
}

/**
 * git 页签（M8 接线）。
 *
 * 界面只呈现"仓库现在什么样"与"我能对它做什么"，**不做任何权限判断** ——
 * 档位在主进程的 `git-gate.ts`，弹窗走公共权限桥。
 * 所以这里看不到"已记住就跳过确认"这种逻辑：那是主进程的事，界面跟着撒谎最糟。
 *
 * 三件刻意的可见性：
 * 1. 提交按钮旁**永远显示"会写入仓库历史，每次都需确认"**，让档位是用户看得见的；
 * 2. 噪音文件（锁文件 / 构建产物）默认折叠但**不隐藏**，并显示数量；
 * 3. 被拒绝、超时、被策略挡住的每一次操作都把**理由原文**显示出来。
 */
export function GitPanel(): ReactElement {
  const [branch, setBranch] = useState<string | null>(null);
  const [entries, setEntries] = useState<StatusEntry[]>([]);
  const [isRepo, setIsRepo] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<GitDiffSummaryView | null>(null);
  const [diffStaged, setDiffStaged] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showNoise, setShowNoise] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    const st = await window.jujia.gitStatus();
    if (!st.ok) {
      setIsRepo(false);
      setEntries([]);
      setBranch(null);
      setHint(st.error);
      return;
    }
    setIsRepo(st.data.isRepo);
    setBranch(st.data.branch);
    setEntries(splitEntries(st.data.entries));
    setHint(st.data.truncated ? '变更过多，列表已截断到前 500 条（不是全部）' : null);
  }, []);

  const reloadDiff = useCallback(async (staged: boolean): Promise<void> => {
    const r = await window.jujia.gitDiff(staged);
    setDiff(r.ok ? r.data : null);
    if (!r.ok) setError(r.error);
  }, []);

  const reloadLog = useCallback(async (): Promise<void> => {
    const r = await window.jujia.gitLog(20);
    setLog(r.ok ? r.data : []);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await Promise.all([reload(), reloadDiff(false), reloadLog()]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [reload, reloadDiff, reloadLog]);

  const unstaged = useMemo(() => entries.filter((e) => !e.staged), [entries]);
  const staged = useMemo(() => entries.filter((e) => e.staged), [entries]);

  const toggle = (path: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  /** 每一次动作后都重新读盘 + 重新算 diff：界面显示的必须是仓库的真实状态 */
  const run = useCallback(
    async (action: () => Promise<{ ok: boolean; error: string | null }>): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        const r = await action();
        if (!r.ok) setError(r.error ?? '操作未完成');
        setSelected(new Set());
        await Promise.all([reload(), reloadDiff(diffStaged), reloadLog()]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [reload, reloadDiff, reloadLog, diffStaged],
  );

  const stageSelected = (): Promise<void> =>
    run(async () => {
      const paths = [...selected].filter((p) => entries.find((e) => e.path === p)?.staged === false);
      if (paths.length === 0) return { ok: false, error: '先勾选要暂存的文件', data: null };
      return await window.jujia.gitStage(paths);
    });

  const unstageSelected = (): Promise<void> =>
    run(async () => {
      const paths = [...selected].filter((p) => entries.find((e) => e.path === p)?.staged === true);
      if (paths.length === 0) return { ok: false, error: '先勾选要取消暂存的文件', data: null };
      return await window.jujia.gitUnstage(paths);
    });

  const doCommit = (): Promise<void> =>
    run(async () => {
      const text = message.trim();
      if (text === '') return { ok: false, error: '提交信息不能为空', data: null };
      const r = await window.jujia.gitCommit(text);
      if (r.ok) setMessage('');
      return r;
    });

  const visibleFiles = useMemo(() => {
    if (diff === null) return [];
    return showNoise ? diff.files : diff.files.filter((f) => !f.noise);
  }, [diff, showNoise]);

  return (
    <div className="w2-panel jj-git">
      <section className="p0-card">
        <h2 className="p0-h2">Git 变更</h2>
        <p className="p0-subtitle">
          {isRepo ? `分支：${branch ?? '（无提交，HEAD 未指向任何分支）'}` : (hint ?? '不可用')}
        </p>
        <div className="w2-actions">
          <button
            type="button"
            className="w2-btn-primary"
            onClick={() => {
              setError(null);
              void Promise.all([reload(), reloadDiff(diffStaged), reloadLog()]);
            }}
          >
            刷新
          </button>
        </div>
      </section>

      {error !== null && (
        <p className="p0-err" role="alert">
          {error}
        </p>
      )}
      {hint !== null && !isRepo && <p className="jj-muted">{hint}</p>}

      {isRepo && (
        <>
          <section className="p0-card">
            <h3 className="p0-h3">未暂存（{String(unstaged.length)}）</h3>
            {unstaged.length === 0 ? (
              <p className="jj-muted">没有未暂存的改动</p>
            ) : (
              <ul className="jj-git-list">
                {unstaged.map((e) => (
                  <li key={e.path} className="jj-git-row">
                    <input
                      type="checkbox"
                      aria-label={`选择 ${e.path}`}
                      checked={selected.has(e.path)}
                      onChange={() => toggle(e.path)}
                    />
                    <span className="jj-git-code">{e.code}</span>
                    <span className="jj-git-label">{e.label}</span>
                    <code>{e.path}</code>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="w2-btn-primary" disabled={busy} onClick={() => void stageSelected()}>
              暂存所选（需确认）
            </button>
          </section>

          <section className="p0-card">
            <h3 className="p0-h3">已暂存（{String(staged.length)}）</h3>
            {staged.length === 0 ? (
              <p className="jj-muted">暂存区是空的</p>
            ) : (
              <ul className="jj-git-list">
                {staged.map((e) => (
                  <li key={e.path} className="jj-git-row">
                    <input
                      type="checkbox"
                      aria-label={`选择 ${e.path}`}
                      checked={selected.has(e.path)}
                      onChange={() => toggle(e.path)}
                    />
                    <span className="jj-git-code">{e.code}</span>
                    <span className="jj-git-label">{e.label}</span>
                    <code>{e.path}</code>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="w2-btn-primary" disabled={busy} onClick={() => void unstageSelected()}>
              取消暂存所选（需确认）
            </button>
          </section>

          <section className="p0-card">
            <h3 className="p0-h3">提交</h3>
            <p className="p0-warn">会写入仓库历史，且每次都会要求确认 —— 这是硬确认，不能被「总是允许」跳过。</p>
            <textarea
              className="jj-git-message"
              aria-label="提交信息"
              rows={3}
              maxLength={2000}
              value={message}
              placeholder="这次改动做了什么，为什么"
              onChange={(ev) => {
                setMessage(ev.target.value);
              }}
            />
            <div className="w2-actions">
              <button
                type="button"
                className="w2-btn-danger"
                disabled={busy || message.trim() === ''}
                onClick={() => void doCommit()}
              >
                提交（会写入仓库历史）
              </button>
            </div>
          </section>
        </>
      )}

      {isRepo && (
        <section className="p0-card">
          <h3 className="p0-h3">改动摘要</h3>
          <div className="w2-actions">
            <button
              type="button"
              className={diffStaged ? 'w2-btn-primary' : 'w2-btn'}
              onClick={() => {
                setDiffStaged(true);
                void reloadDiff(true);
              }}
            >
              看暂存区
            </button>
            <button
              type="button"
              className={diffStaged ? 'w2-btn' : 'w2-btn-primary'}
              onClick={() => {
                setDiffStaged(false);
                void reloadDiff(false);
              }}
            >
              看工作区
            </button>
          </div>
          {diff === null ? (
            <p className="jj-muted">没有可显示的改动</p>
          ) : (
            <>
              <p className="jj-muted">
                +{String(diff.totalAdded)} / -{String(diff.totalRemoved)}，共 {String(diff.files.length)} 个文件；
                噪音文件 {String(diff.noiseFiles)} 个
                <button type="button" className="jj-git-link" onClick={() => setShowNoise((v) => !v)}>
                  {showNoise ? '隐藏噪音文件' : '显示噪音文件'}
                </button>
              </p>
              {diff.note !== null && <p className="jj-note-warn">{diff.note}</p>}
              <ul className="jj-git-list">
                {visibleFiles.map((f) => (
                  <li key={f.path} className="jj-git-diff">
                    <span>
                      +{String(f.added)} / -{String(f.removed)}
                    </span>
                    <code>{f.path}</code>
                    {f.noise && <span className="jj-git-badge">噪音</span>}
                    {f.truncated && <span className="jj-git-badge">摘录已截断</span>}
                    <ul className="jj-git-lines">
                      {f.highlights.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {isRepo && log.length > 0 && (
        <section className="p0-card">
          <h3 className="p0-h3">最近提交</h3>
          <ul className="jj-git-list">
            {log.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
