import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { ConnectionInput, ConnectionView, TestResult } from '@jujia/shared-ipc';

/** 常用厂商的 OpenAI 兼容端点预设，减少手填出错 */
const PRESETS: ReadonlyArray<{ label: string; baseUrl: string; model: string }> = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' },
  { label: 'Moonshot', baseUrl: 'https://api.moonshot.cn', model: 'moonshot-v1-8k' },
  { label: '本地 Ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b' },
];

const emptyForm: ConnectionInput = {
  name: '',
  baseUrl: '',
  apiFormat: 'openai-compatible',
  model: '',
  apiKey: '',
};

interface Props {
  /** 数据变化时通知外层（会话页需要知道有哪些连接） */
  onChanged: (connections: ConnectionView[]) => void;
}

export function ConnectionsPanel({ onChanged }: Props): ReactElement {
  const [items, setItems] = useState<ConnectionView[]>([]);
  const [form, setForm] = useState<ConnectionInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  async function refresh(): Promise<void> {
    const list = await window.jujia.connectionList();
    setItems(list);
    onChanged(list);
  }

  useEffect(() => {
    // 仅在挂载时拉取一次；后续由用户操作触发 refresh
    let alive = true;
    window.jujia
      .connectionList()
      .then((list) => {
        if (!alive) return;
        setItems(list);
        onChanged(list);
      })
      .catch((err: unknown) => {
        if (alive) setMessage({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      alive = false;
    };
  }, [onChanged]);

  async function submit(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      if (editingId) {
        // 编辑时留空的 apiKey 表示「不改动已有密钥」
        const patch: Partial<ConnectionInput> = {
          name: form.name,
          baseUrl: form.baseUrl,
          apiFormat: form.apiFormat,
          model: form.model,
          ...(form.apiKey ? { apiKey: form.apiKey } : {}),
        };
        await window.jujia.connectionUpdate(editingId, patch);
        setMessage({ kind: 'ok', text: '连接已更新' });
      } else {
        await window.jujia.connectionCreate(form);
        setMessage({ kind: 'ok', text: '连接已创建' });
      }
      setForm(emptyForm);
      setEditingId(null);
      await refresh();
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function test(id: string): Promise<void> {
    setBusy(true);
    try {
      const result = await window.jujia.connectionTest(id);
      setTestResults((prev) => ({ ...prev, [id]: result }));
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setBusy(true);
    try {
      await window.jujia.connectionDelete(id);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  function startEdit(item: ConnectionView): void {
    setEditingId(item.id);
    setForm({
      name: item.name,
      baseUrl: item.baseUrl,
      apiFormat: item.apiFormat,
      model: item.model,
      apiKey: '',
    });
  }

  const modelOptions = Object.values(testResults).flatMap((r) => r.models);

  return (
    <div className="w2-panel">
      <section className="p0-card">
        <h2>{editingId ? '编辑连接' : '新增连接'}</h2>
        <div className="w2-presets">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="w2-chip"
              onClick={() =>
                setForm((f) => ({ ...f, baseUrl: p.baseUrl, model: p.model, name: f.name || p.label }))
              }
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="w2-form">
          <label>
            名称
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="例如 DeepSeek 生产"
            />
          </label>
          <label>
            Base URL
            <input
              value={form.baseUrl}
              onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
              placeholder="https://api.deepseek.com"
            />
          </label>
          <label>
            协议
            <select
              value={form.apiFormat}
              onChange={(e) =>
                setForm((f) => ({ ...f, apiFormat: e.target.value as ConnectionInput['apiFormat'] }))
              }
            >
              <option value="openai-compatible">OpenAI 兼容</option>
            </select>
          </label>
          <label>
            模型
            <input
              value={form.model}
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
              placeholder="deepseek-chat"
              list="model-options"
            />
            <datalist id="model-options">
              {modelOptions.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          <label>
            API Key
            <input
              type="password"
              value={form.apiKey ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              placeholder={editingId ? '留空表示不修改' : 'sk-…'}
            />
          </label>
        </div>

        <div className="w2-actions">
          <button type="button" className="w2-btn-primary" disabled={busy} onClick={() => void submit()}>
            {editingId ? '保存' : '创建'}
          </button>
          {editingId && (
            <button
              type="button"
              className="w2-btn"
              onClick={() => {
                setEditingId(null);
                setForm(emptyForm);
              }}
            >
              取消编辑
            </button>
          )}
        </div>

        {message && (
          <p className={message.kind === 'ok' ? 'p0-ok' : 'p0-err'} role="status">
            {message.text}
          </p>
        )}
      </section>

      <section className="p0-card">
        <h2>已有连接（{items.length}）</h2>
        {items.length === 0 && <p className="p0-subtitle">还没有连接，先在上面创建一个。</p>}
        <ul className="w2-list">
          {items.map((item) => {
            const result = testResults[item.id];
            return (
              <li key={item.id} className="w2-list-item">
                <div className="w2-list-main">
                  <strong>{item.name}</strong>
                  <span className="p0-subtitle">
                    {item.model} · {item.baseUrl}
                  </span>
                  <span className={item.hasApiKey ? 'p0-ok' : 'p0-warn'}>
                    {item.hasApiKey ? `密钥 ${item.apiKeyHint}` : '未设置密钥'}
                  </span>
                  {result && (
                    <span className={result.ok ? 'p0-ok' : 'p0-err'}>
                      {result.ok ? '✓' : '✗'} {result.message}
                      {result.ok ? `（${result.latencyMs}ms）` : ''}
                    </span>
                  )}
                </div>
                <div className="w2-actions">
                  <button type="button" className="w2-btn" disabled={busy} onClick={() => void test(item.id)}>
                    测试
                  </button>
                  <button type="button" className="w2-btn" onClick={() => startEdit(item)}>
                    编辑
                  </button>
                  <button type="button" className="w2-btn-danger" disabled={busy} onClick={() => void remove(item.id)}>
                    删除
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
