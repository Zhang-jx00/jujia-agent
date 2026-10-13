import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { LogLevelView, LogPageView } from '@jujia/shared-ipc';

/**
 * 运行日志卡（M12 批一 · R10）—— 概览页上"去哪儿看日志"的可见面。
 *
 * 三件事必须写在卡上，不靠文档：
 * 1. **日志在哪**（文件路径原样给出 + 在文件夹中显示）；
 * 2. **今天记了多少、有没有出过岔子**（总数 / 没读出来的行 / 写失败 / 到上限的丢计 ——
 *    这些都是主进程数好的，界面只是搬运，不自己再算一遍）；
 * 3. **不出本机**这句话本身 —— 它是这份日志的产品承诺，得让用户看得见。
 *
 * 读取是**只读**的：界面唯一能"写"日志的路径是错误兜底的上报（见 `ErrorBoundary`），
 * 而且级别固定、形状有契约。
 */

const LEVEL_LABEL: Record<LogLevelView, string> = {
  debug: '调试',
  info: '信息',
  warn: '警告',
  error: '错误',
};

const FILTERS: ReadonlyArray<{ value: LogLevelView | 'all'; label: string }> = [
  { value: 'all', label: '全部级别' },
  { value: 'info', label: '信息以上' },
  { value: 'warn', label: '警告以上' },
  { value: 'error', label: '只看错误' },
];

function formatTs(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

export function LogCard(): ReactElement {
  const [page, setPage] = useState<LogPageView | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<LogLevelView | 'all'>('all');
  const [revealNote, setRevealNote] = useState('');

  const load = useCallback(async (): Promise<void> => {
    try {
      const next =
        filter === 'all'
          ? await window.jujia.logsTail(50)
          : await window.jujia.logsTail(50, filter);
      setPage(next);
      setError('');
    } catch (err) {
      // 读不到就说出来（静默失败是头号禁区）：这是"日志的界面"，它自己更不能装没事
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const reveal = async (): Promise<void> => {
    try {
      const r = await window.jujia.logsReveal();
      setRevealNote(r.ok ? '已在文件管理器中定位今天的日志' : `没能定位：${r.error}`);
    } catch (err) {
      setRevealNote(`没能定位：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <section className="p0-card" data-logs-card>
      <h2>运行日志</h2>
      <p className="p0-subtitle">
        日志只写在本机的这一个文件里 —— 应用不会把它发到任何地方；里面的密钥类内容在落盘之前就已剔除。
      </p>

      <div className="jj-card-actions">
        <select
          aria-label="日志级别过滤"
          className="jj-transition"
          value={filter}
          onChange={(e) => setFilter(e.target.value as LogLevelView | 'all')}
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <button type="button" className="jj-btn jj-btn-quiet jj-transition" onClick={() => void load()}>
          刷新
        </button>
        <button type="button" className="jj-btn jj-btn-quiet jj-transition" onClick={() => void reveal()}>
          在文件夹中显示
        </button>
      </div>

      {error !== '' && (
        <p className="p0-warn" role="alert">
          读不到日志：{error}
        </p>
      )}

      {page !== null && (
        <>
          <dl className="p0-kv">
            <dt>今天的文件</dt>
            <dd>
              <code>{page.file}</code>
            </dd>
            <dt>今天已记</dt>
            <dd>
              {page.total} 条
              {page.records.length < page.total ? `（当前显示最近 ${page.records.length} 条）` : ''}
            </dd>
          </dl>
          {page.notice !== '' && (
            <p className="p0-warn" role="status">
              {page.notice}
            </p>
          )}
          {revealNote !== '' && <p className="p0-subtitle">{revealNote}</p>}

          {page.records.length === 0 ? (
            <p className="p0-subtitle">
              {filter === 'all' ? '今天还没有记录。' : '今天没有达到这个级别的记录。'}
            </p>
          ) : (
            <ul className="jj-log-list">
              {page.records.map((r, i) => (
                <li key={`${r.ts}-${String(i)}`} className={`jj-log jj-log-${r.level}`}>
                  <span className="jj-log-ts" title={r.ts}>
                    {formatTs(r.ts)}
                  </span>
                  <span className="jj-log-level">{LEVEL_LABEL[r.level]}</span>
                  <code className="jj-log-scope">{r.scope}</code>
                  <span className="jj-log-msg">{r.msg}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {page === null && error === '' && <p className="p0-subtitle">正在通过 IPC 读取日志…</p>}
    </section>
  );
}
