import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { DIALOG_PREVIEW_MAX_LINES, type PermissionRequestPayload } from '@jujia/shared-ipc';

const KIND_LABEL: Record<PermissionRequestPayload['kind'], string> = {
  read: '读取',
  write: '写入',
  exec: '执行命令',
};

/**
 * 权限审批弹窗（W3）。
 *
 * 硬约束（来自知识卡片 002 与 PLAN §3.6）：
 * - **永不自动拒绝**：请求进来一定展示给用户，由用户决定；
 * - 拒绝与超时是两种不同结果，文案必须区分；
 * - 弹窗期间不做「默认焦点落在允许」这种危险默认，两个按钮同等对待。
 *
 * 这一轮补的两条（外部审查 T19 / T9）：
 * - **按钮不许承诺引擎做不到的事**：「本次会话总是允许」只在**软 ask** 上存在。
 *   硬 ask（执行类 / 敏感路径 / 高危清单 / 改钩子配置）上以前也渲染这个按钮，
 *   而引擎只会在软 ask 上记住这个决定 —— 用户点了以为以后不问了，实际下次照弹。
 *   档位由载荷里的 `bypassable` 一路带过来（判档本来就有这个信息，是"最后一米"没传）。
 * - **主进程说结束了就关掉那一张**：订阅 `onPermissionExpired`，按 id 精确移除并说明原因。
 *   以前主进程 120 秒超时按"未响应"继续走，弹窗还挂在那里 —— 用户再点就是点到空气上。
 *   回填返回 `false`（请求已不在）或抛错时同样必须说出来，不能静默。
 */
export function PermissionDialog(): ReactElement | null {
  const [queue, setQueue] = useState<PermissionRequestPayload[]>([]);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  /** 决定没送达 / 请求已结束的说明（与"用户自己点了拒绝"严格区分） */
  const [notice, setNotice] = useState<string | null>(null);
  const [editedText, setEditedText] = useState('');
  const current = queue[0];

  const argsText = useMemo(
    () => (current ? JSON.stringify(current.args, null, 2) : ''),
    [current],
  );

  /**
   * 参数预览的**呈现**上限（M19 报备 §四 2，批复同意）。
   *
   * 为什么要有：保存一个大文件时，参数里带着整份内容 —— 不设上限就是往弹窗里塞 1MB 文本，
   * 界面卡住、而人根本不会去读。截断必须**如实标注**："共 M 行，仅预览前 N 行"。
   *
   * 只动呈现：`editedText`（用户点「修改参数」后提交的那份）保持完整原文 ——
   * 在编辑通道上截断等于悄悄改掉用户批准的东西。
   */
  const preview = useMemo(() => {
    const lines = argsText.split('\n');
    if (lines.length <= DIALOG_PREVIEW_MAX_LINES) return { text: argsText, note: null as string | null };
    return {
      text: lines.slice(0, DIALOG_PREVIEW_MAX_LINES).join('\n'),
      note: `共 ${String(lines.length)} 行，仅预览前 ${String(DIALOG_PREVIEW_MAX_LINES)} 行`,
    };
  }, [argsText]);

  useEffect(() => {
    const unsubscribe = window.jujia.onPermissionRequest((req) => {
      // 串行处理：一次只展示一个，避免弹窗打架与「批量确认」导致误批
      setQueue((prev) => [...prev, req]);
    });
    const unsubscribeExpired = window.jujia.onPermissionExpired(({ id, reason }) => {
      // 按 id 精确关闭：同一时刻可能还有别的请求在排队，一把全清等于把别人的选择权也关掉
      setQueue((prev) => prev.filter((r) => r.id !== id));
      setNotice(
        reason === 'timeout'
          ? '有一个审批请求在主进程等待超时，已自动关闭 —— 那一步没有执行，需要的话请重新发起'
          : '窗口已关闭，未答复的审批请求全部作废（没有任何操作被执行）',
      );
    });
    return () => {
      unsubscribe();
      unsubscribeExpired();
    };
  }, []);

  async function decide(
    decision: 'allow_once' | 'allow_always' | 'deny' | 'edit',
    updatedArgs?: unknown,
  ): Promise<void> {
    if (!current) return;
    const request = current;
    let settled: boolean;
    try {
      settled = await window.jujia.permissionResolve(
        request.id,
        decision,
        updatedArgs === undefined ? undefined : updatedArgs,
      );
    } catch (err) {
      setNotice(
        `回填审批结果失败：${err instanceof Error ? err.message : String(err)} —— ` +
          '这一步没有执行，请重新发起操作',
      );
      setQueue((prev) => prev.filter((r) => r.id !== request.id));
      setEditing(false);
      return;
    }
    if (!settled) {
      // 主进程那边已经没有这个请求了（多半刚好撞上超时）：必须说出来，
      // 否则界面看起来"批准过了"，实际什么都没发生
      setNotice(
        '这个请求已经在主进程侧结束（超时或窗口关闭），刚才的决定没有生效 —— 需要的话请重新发起操作',
      );
    }
    setEditing(false);
    // T40：按 id 移除（与 catch 分支同一口径）—— `slice(1)` 会在"队首恰已被超时事件移除"
    // 的竞态里把排队中的下一张卡一起删掉：那张卡没被决定就从界面上消失了。
    setQueue((prev) => prev.filter((r) => r.id !== request.id));
  }

  /** 允许但先改参数：JSON 不合法就地报错，不提交 */
  async function submitEdit(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(editedText);
      await decide('edit', parsed);
    } catch {
      setEditError('JSON 不合法，请修正后再提交（不会执行任何操作）');
    }
  }

  if (!current) {
    /**
     * 弹窗可以不在了，话得留下：超时 / 决定没送达 这两类"什么都没发生"必须看得见。
     * 早返回里直接把 notice 一起卸载，等于把静默失败从"没提示"升级成"提示闪一下就没了"。
     */
    return notice === null ? null : (
      <div className="w2-panel">
        <div className="p0-card">
          <p className="p0-err" role="status">
            {notice}
          </p>
          <div className="w2-actions">
            <button type="button" className="w2-btn" onClick={() => setNotice(null)}>
              知道了
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w3-mask" role="dialog" aria-modal="true" aria-label="权限请求">
      <div className="w3-dialog">
        <h3>需要你确认：{current.summary}</h3>
        <p className="p0-subtitle">
          工具 <code>{current.toolName}</code> 属于「{KIND_LABEL[current.kind]}」类操作，不会自动执行。
        </p>
        {current.paths.length > 0 && (
          <p className="p0-warn">
            涉及路径：{current.paths.map((p) => (
              <code key={p}>{p}</code>
            ))}
          </p>
        )}
        {!current.bypassable && (
          <p className="p0-warn">
            此操作每次都会要求确认 —— 这是硬确认，不能被「总是允许」跳过。
            想减少打扰请写 allow 规则或改用 acceptEdits 模式 —— 两者都是显式的、可查看、可删除。
          </p>
        )}
        {!editing && (
          <details>
            <summary>查看完整参数</summary>
            {preview.note !== null && <p className="p0-subtitle">{preview.note}</p>}
            <pre>{preview.text}</pre>
          </details>
        )}

        {editing && (
          <>
            <p className="p0-subtitle">
              修改参数后点「按修改执行」——参数会**重新过一遍校验**，越界或非法一律拒绝。
            </p>
            <textarea
              className="w3-args-edit"
              value={editedText}
              onChange={(e) => {
                setEditedText(e.target.value);
                setEditError(null);
              }}
              rows={8}
              spellCheck={false}
            />
            {editError && <p className="p0-err">{editError}</p>}
          </>
        )}
        {notice !== null && (
          <p className="p0-err" role="status">
            {notice}
          </p>
        )}
        {queue.length > 1 && <p className="p0-subtitle">还有 {queue.length - 1} 个请求在排队</p>}
        <div className="w2-actions">
          {editing ? (
            <button type="button" className="w2-btn-primary" onClick={() => void submitEdit()}>
              按修改执行
            </button>
          ) : (
            <button type="button" className="w2-btn-primary" onClick={() => void decide('allow_once')}>
              允许一次
            </button>
          )}
          {!editing && (
            <button
              type="button"
              className="w2-btn"
              onClick={() => {
                setEditedText(argsText);
                setEditing(true);
              }}
            >
              允许并修改参数…
            </button>
          )}
          {!editing &&
            current.bypassable && (
              <button type="button" className="w2-btn" onClick={() => void decide('allow_always')}>
                本次会话总是允许
              </button>
            )}
          <button type="button" className="w2-btn-danger" onClick={() => void decide('deny')}>
            拒绝
          </button>
        </div>
        <p className="p0-subtitle">长时间不响应将按「超时」处理，与主动拒绝区分。</p>
      </div>
    </div>
  );
}
