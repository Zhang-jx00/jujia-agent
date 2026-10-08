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
  /** 推送目标远端名（默认 origin）。刻意做成可改的输入框而不是写死：一台机器上常有多个远端。 */
  const [remote, setRemote] = useState('origin');
  /** 推送成功那一行（失败走下面的 error 区）。见 `doPush` 里"成功也要看得见"的理由。 */
  const [pushNote, setPushNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNoise, setShowNoise] = useState(false);
  /** 逐行 patch（M19：点某个文件才去取那一份，不一次拉全部） */
  const [patch, setPatch] = useState<{ path: string; text: string; truncated: boolean } | null>(null);
  const [patchNote, setPatchNote] = useState<string | null>(null);

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
    // 这里只要摘要那一支：`mode` 缺省就是 summary，但契约上是联合类型，得先收窄再赋值
    if (r.ok && r.mode !== 'patch') setDiff(r.data);
    if (!r.ok) setDiff(null);
    if (!r.ok) setError(r.error);
  }, []);

  /**
   * 看某一个文件的**逐行** patch（M19 §五：复用 git 读侧，不新开通道）。
   * 未跟踪的新文件没有 patch（`git diff` 不显示它们）—— 这种情况如实说明，不假装"没有改动"。
   */
  const showPatch = useCallback(
    async (path: string): Promise<void> => {
      setPatchNote(null);
      const r = await window.jujia.gitDiff(diffStaged, { mode: 'patch', path });
      if (!r.ok) {
        setPatch(null);
        setPatchNote(`取不到 patch：${r.error}`);
        return;
      }
      if (r.mode !== 'patch') {
        setPatch(null);
        setPatchNote('主进程没有返回逐行 patch（协议不对，什么都不显示好过显示错的）。');
        return;
      }
      const hit = r.data.find((f) => f.path === path);
      if (hit === undefined) {
        setPatch(null);
        setPatchNote('这个文件没有逐行 patch（新文件不被 git diff 显示；内容见「文件」页签）。');
        return;
      }
      setPatch({ path: hit.path, text: hit.text, truncated: hit.truncated });
    },
    [diffStaged],
  );

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

  /**
   * 推送（M8 收口）。分支名**取当前状态里的 branch**，为空就直说没分支 ——
   * 不去猜"大概是 main"：猜错的推送会发到一条不存在的分支上，那是**新建**，不是用户想要的。
   */
  const doPush = (): Promise<void> =>
    run(async () => {
      const target = remote.trim();
      if (target === '') return { ok: false, error: '远端名不能为空', data: null };
      if (branch === null) return { ok: false, error: 'HEAD 没指向任何分支（还没有提交），无从推送', data: null };
      const r = await window.jujia.gitPush(target, branch);
      /**
       * 成功也要有一行可见的话。**外发这件事"什么都没显示"是最糟的**：
       * 用户分不清"没点着 / 被拒了 / 已经发出去了"，只能反复点 —— 而每点一次都是一次新的确认与一次新的外发。
       * （这行同时是 e2e 的完成信号：弹窗在"决定送出"时就关了，不等 push 跑完。）
       */
      setPushNote(r.ok ? `已推送到「${target}」：${r.data ?? ''}` : null);
      return r;
    });

  const visibleFiles = useMemo(() => {
    if (diff === null) return [];
    return showNoise ? diff.files : diff.files.filter((f) => !f.noise);
  }, [diff, showNoise]);

  return (
    <div className="w2-panel">
      <section className="p0-card">
        <h2>Git 变更</h2>
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
            <h3>未暂存（{String(unstaged.length)}）</h3>
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
            <h3>已暂存（{String(staged.length)}）</h3>
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
            <h3>提交</h3>
            <p className="p0-warn">会写入仓库历史，且每次都会要求确认 —— 这是硬确认，不能被「总是允许」跳过。</p>            <textarea
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

          <section className="p0-card">
            <h3>推送到远端</h3>
            <p className="p0-warn">
              把提交交到<strong>别人看得见的地方</strong>，撤回需要远端配合 —— 所以每次都会要求确认，
              而且这一项<strong>没有「总是允许」</strong>可用。本应用不做强推（--force）。
            </p>
            <input
              className="jj-git-remote"
              aria-label="远端名"
              value={remote}
              maxLength={64}
              placeholder="origin"
              onChange={(ev) => {
                setRemote(ev.target.value);
              }}
            />
            <div className="w2-actions">
              <button
                type="button"
                className="w2-btn-danger"
                disabled={busy || remote.trim() === ''}
                onClick={() => void doPush()}
              >
                {branch === null
                  ? `推送「${remote.trim() || 'origin'}」（HEAD 无分支）`
                  : `推送「${remote.trim() || 'origin'}」：当前分支 ${branch}`}
              </button>
            </div>
            {pushNote !== null && (
              <p className="p0-subtitle" role="status">
                {pushNote}
              </p>
            )}
          </section>
        </>
      )}

      {isRepo && (
        <section className="p0-card">
          <h3>改动摘要</h3>
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
                    <button type="button" className="jj-git-link" onClick={() => void showPatch(f.path)}>
                      {f.path}
                    </button>
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
              {patchNote !== null && <p className="jj-muted">{patchNote}</p>}
              {patch !== null && (
                <div>
                  <p className="p0-subtitle">
                    {`逐行 patch：${patch.path}${patch.truncated ? '（已截断）' : ''}`}
                  </p>
                  <pre className="jj-patch">
                    {patch.text.split('\n').map((line, i) => (
                      <span
                        key={i}
                        className={
                          line.startsWith('+') ? 'jj-patch-add' : line.startsWith('-') ? 'jj-patch-del' : undefined
                        }
                      >
                        {line}
                        {'\n'}
                      </span>
                    ))}
                  </pre>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {isRepo && log.length > 0 && (
        <section className="p0-card">
          <h3>最近提交</h3>
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
