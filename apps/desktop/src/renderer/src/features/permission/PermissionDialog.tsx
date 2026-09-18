import { useEffect, useState } from 'react';
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
  const current = queue[0];

  useEffect(() => {
    const unsubscribe = window.jujia.onPermissionRequest((req) => {
      // 串行处理：一次只展示一个，避免弹窗打架与「批量确认」导致误批
      setQueue((prev) => [...prev, req]);
    });
    return unsubscribe;
  }, []);

  async function decide(decision: 'allow_once' | 'allow_always' | 'deny'): Promise<void> {
    if (!current) return;
    await window.jujia.permissionResolve(current.id, decision);
    setQueue((prev) => prev.slice(1));
  }

  if (!current) return null;

  const argsPreview = JSON.stringify(current.args, null, 2);

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
        <details>
          <summary>查看完整参数</summary>
          <pre>{argsPreview}</pre>
        </details>
        {queue.length > 1 && <p className="p0-subtitle">还有 {queue.length - 1} 个请求在排队</p>}
        <div className="w2-actions">
          <button type="button" className="w2-btn-primary" onClick={() => void decide('allow_once')}>
            允许一次
          </button>
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
