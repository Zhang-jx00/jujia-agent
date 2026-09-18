import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { ConnectionInput, ConnectionView, TestResult } from '@jujia/shared-ipc';

/**
 * 厂商预设 —— **2026-09-18 依官方文档实测核实**，不可凭记忆改动。
 *
 * 核实原则（避免引用过时信息）：
 * - 能自动发现的就**不预设模型名**（Ollama 取决于本机已 pull 的模型；OpenAI 模型迭代极快），
 *   点「测试」后由 `/v1/models` 拉真实列表让用户选；
 * - 只有能从官方文档确认到**当前有效 ID** 的才写死。
 *
 * 核实结论摘要（详见 knowledge/cards/009-vendor-api-verification-2026-09.md）：
 * - DeepSeek：`deepseek-chat` / `deepseek-reasoner` 已于 **2026-07-24 弃用**，
 *   现行模型为 `deepseek-flash`（V4.1-Flash）与 `deepseek-v4-pro`；base `https://api.deepseek.com`
 * - 智谱：现行旗舰 `glm-5.3`，另有免费额度模型 `glm-4.7-flash`；
 *   base `https://open.bigmodel.cn/api/paas/v4`（原 `glm-4-plus` 已不在模型列表中）
 * - Moonshot：最新 `kimi-k2.6`（其次 `kimi-k2.5`；`moonshot-v1-8k` 属第一代）；
 *   base 国内 `https://api.moonshot.cn/v1`、全球 `https://api.moonshot.ai/v1`
 * - OpenAI：`gpt-4o` / `gpt-4o-mini` 已废弃；base `https://api.openai.com/v1`
 *   （注：本机网络对 api.openai.com 不通，实测返回 000）
 * - Ollama：base `http://127.0.0.1:11434`（自动补 `/v1`），apiKey 任意非空即可
 */
const PRESETS: ReadonlyArray<{ label: string; baseUrl: string; model: string; note: string }> = [
  {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    note: 'deepseek-chat / deepseek-reasoner 已于 2026-07-24 弃用；现行为 deepseek-flash 与 deepseek-v4-pro',
  },
  {
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.3',
    note: '现行旗舰 glm-5.3；预算敏感可改用免费额度模型 glm-4.7-flash',
  },
  {
    label: 'Kimi（Moonshot）',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.6',
    note: '最新 kimi-k2.6；全球站为 https://api.moonshot.ai/v1',
  },
  {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    note: '模型迭代快（gpt-4o 系列已废弃），建议点「测试」后从返回列表中选择',
  },
  {
    label: '本地 Ollama',
    baseUrl: 'http://127.0.0.1:11434',
    model: '',
    note: '模型取决于本机已 pull 的内容，点「测试」即可读取本机模型列表',
  },
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
  const [presetNote, setPresetNote] = useState<string>('');

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
              title={p.note}
              onClick={() => {
                setForm((f) => ({
                  ...f,
                  baseUrl: p.baseUrl,
                  model: p.model,
                  name: f.name || p.label,
                }));
                setPresetNote(`${p.label}：${p.note}`);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        {presetNote && (
          <p className="p0-subtitle" role="note">
            ℹ {presetNote}
          </p>
        )}

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
              placeholder="选预设自动填入，或点「测试」后从候选列表选择"
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
