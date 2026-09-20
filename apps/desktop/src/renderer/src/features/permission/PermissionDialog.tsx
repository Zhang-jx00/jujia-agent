import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { PermissionRequestPayload } from '@jujia/shared-ipc';

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
 */
export function PermissionDialog(): ReactElement | null {
  const [queue, setQueue] = useState<PermissionRequestPayload[]>([]);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editedText, setEditedText] = useState('');
  const current = queue[0];

  const argsText = useMemo(
    () => (current ? JSON.stringify(current.args, null, 2) : ''),
    [current],
  );

  useEffect(() => {
    const unsubscribe = window.jujia.onPermissionRequest((req) => {
      // 串行处理：一次只展示一个，避免弹窗打架与「批量确认」导致误批
      setQueue((prev) => [...prev, req]);
    });
    return unsubscribe;
  }, []);

  async function decide(
    decision: 'allow_once' | 'allow_always' | 'deny' | 'edit',
    updatedArgs?: unknown,
  ): Promise<void> {
    if (!current) return;
    await window.jujia.permissionResolve(
      current.id,
      decision,
      updatedArgs === undefined ? undefined : updatedArgs,
    );
    setEditing(false);
    setQueue((prev) => prev.slice(1));
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

  if (!current) return null;

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
        {!editing && (
          <details>
            <summary>查看完整参数</summary>
            <pre>{argsText}</pre>
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
          <button type="button" className="w2-btn" onClick={() => void decide('allow_always')}>
            本次会话总是允许
          </button>
          <button type="button" className="w2-btn-danger" onClick={() => void decide('deny')}>
            拒绝
          </button>
        </div>
        <p className="p0-subtitle">长时间不响应将按「超时」处理，与主动拒绝区分。</p>
      </div>
    </div>
  );
}
