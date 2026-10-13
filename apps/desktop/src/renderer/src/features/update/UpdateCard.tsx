import { useState } from 'react';
import type { ReactElement } from 'react';
import type { UpdateCheckResultView } from '@jujia/shared-ipc';

/**
 * 更新检查卡（M12 批二 · R11）—— **无依赖最小形态**的可见面。
 *
 * 三条纪律写在组件里：
 * 1. **只在点击时查**（没有 `useEffect` 自动检查 —— 没人点就不出站，也不产生第二个定时器）；
 * 2. **不下载、不执行**：查到的只是"有没有新版本 + 发布页地址"，打开那一步走
 *    既有的三档打开方式（系统默认浏览器那一档**每次硬 ask**，地址即授权）；
 * 3. **三种结局三种话**：有新版本 / 已是最新 / 查不到（404、断网、超时、版本号读不懂）——
 *    最后那种绝不许被显示成"已是最新"。
 */

export function UpdateCard({ currentVersion }: { currentVersion: string }): ReactElement {
  const [result, setResult] = useState<UpdateCheckResultView | null>(null);
  const [busy, setBusy] = useState(false);
  const [openNote, setOpenNote] = useState('');

  const check = async (): Promise<void> => {
    setBusy(true);
    setOpenNote('');
    try {
      setResult(await window.jujia.updateCheck());
    } catch (err) {
      setResult({
        ok: false,
        current: currentVersion,
        latest: '',
        hasUpdate: false,
        url: '',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const openReleases = async (): Promise<void> => {
    if (result === null || result.url === '') return;
    try {
      const r = await window.jujia.browserOpenWith(result.url, 'system');
      setOpenNote(
        r.ok
          ? r.asked
            ? '已交给系统默认浏览器（这次你点了允许）'
            : '已交给系统默认浏览器'
          : `没能打开：${r.error ?? '未知原因'}`,
      );
    } catch (err) {
      setOpenNote(`没能打开：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <section className="p0-card" data-update-card>
      <h2>更新</h2>
      <dl className="p0-kv">
        <dt>当前版本</dt>
        <dd>v{currentVersion}</dd>
      </dl>
      <div className="jj-card-actions">
        <button
          type="button"
          className="jj-btn jj-btn-quiet jj-transition"
          disabled={busy}
          onClick={() => void check()}
        >
          {busy ? '检查中…' : '检查更新'}
        </button>
        {result !== null && result.hasUpdate && (
          <button type="button" className="jj-btn jj-btn-quiet jj-transition" onClick={() => void openReleases()}>
            打开发布页
          </button>
        )}
      </div>

      {result !== null && (
        <p className={result.hasUpdate ? 'p0-ok' : result.ok ? 'p0-subtitle' : 'p0-warn'} role="status">
          {result.hasUpdate
            ? `有新版本 ${result.latest}（到发布页看说明；本应用不自动下载、不自动安装）`
            : result.ok
              ? `已是最新（${result.latest}）`
              : `暂时查不到：${result.error}`}
        </p>
      )}
      {openNote !== '' && <p className="p0-subtitle">{openNote}</p>}
      <p className="p0-subtitle">
        检查更新是一次只读查询：只在点按钮时发出，只问"有没有新版本"；不自动下载、不自动安装。
      </p>
    </section>
  );
}
