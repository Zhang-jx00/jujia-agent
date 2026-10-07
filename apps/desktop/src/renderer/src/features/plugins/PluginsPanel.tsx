import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { PluginsState } from '@jujia/shared-ipc';

/**
 * 插件页（W11b）—— **只读**：装了什么、贡献了什么、哪里有问题。
 *
 * 插件的价值在于"整包分发"：一个 `plugin.json` 可以把技能目录、自定义命令目录、
 * MCP 服务端与选项默认值打包在一起。这里如实展示三件事：
 * 1. 加载到了哪些插件（来自哪个目录）；
 * 2. 每个插件**真的**贡献了什么（技能/命令目录只统计真实存在的）；
 * 3. 哪些地方有问题（清单写错、变量缺失、目录不存在）。
 *
 * 插件贡献的 MCP 服务端**已接入** MCP 列表与连接流程（W11c）；自定义命令目录仍只识别。
 * 配了不能用的事，不能靠用户自己猜。
 */
export function PluginsPanel(): ReactElement {
  const [state, setState] = useState<PluginsState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setState(await window.jujia.pluginsGet());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  return (
    <div className="w2-panel">
      <section className="p0-card">
        <h2>插件</h2>
        <p className="p0-subtitle">
          插件用<strong>一个清单文件</strong>（<code>plugin.json</code>）把技能目录、自定义命令目录、
          MCP 服务端与选项默认值打包在一起 —— 装一次就整套可用。
          插件不引入任何新能力，它只是把已有能力打包并变量化。
        </p>

        {error !== null && (
          <p className="p0-err" role="alert">
            {error}
          </p>
        )}

        <div className="w2-actions">
          <button type="button" className="w2-btn" disabled={busy} onClick={() => void reload()}>
            重新扫描
          </button>
        </div>

        {state !== null && (
          <>
            <p className="p0-subtitle">{state.summary}</p>
            <p className="p0-subtitle">
              扫描目录：{state.scannedDirs.length === 0 ? '（无）' : state.scannedDirs.join(' · ')}
            </p>

            {state.plugins.length === 0 ? (
              <p className="p0-subtitle">
                还没有插件。把插件放在数据目录的 <code>plugins/&lt;名字&gt;/plugin.json</code>，
                或工作区的 <code>.jujia/plugins/&lt;名字&gt;/plugin.json</code> 即可。
              </p>
            ) : (
              <ul className="jj-plugin-list">
                {state.plugins.map((p) => (
                  <li key={p.name} className="jj-plugin-item">
                    <div className="jj-plugin-head">
                      <strong>{p.name}</strong>
                      {p.version !== null && <span className="p0-subtitle">v{p.version}</span>}
                    </div>
                    {p.description !== null && <div className="p0-subtitle">{p.description}</div>}
                    <div className="p0-subtitle">
                      贡献：技能目录 {p.skillsCount} 个 · 命令目录 {p.commandsCount} 个
                      {p.mcpServers.length > 0 && (
                        <>
                          {' · '}
                          MCP 服务端 {p.mcpServers.length} 个（{p.mcpServers.join(', ')}）
                          <strong> —— 已接入，连接与逐工具批准在「MCP」页进行</strong>
                        </>
                      )}
                    </div>
                    <div className="p0-subtitle jj-plugin-dir">{p.dir}</div>
                    {p.diagnostics.length > 0 && (
                      <div className="p0-warn">
                        <ul>
                          {p.diagnostics.map((d, i) => (
                            <li key={`${d.severity}-${i}`}>
                              [{d.severity === 'error' ? '错误' : '警告'}] {d.message}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {state.diagnostics.length > 0 && (
              <details>
                <summary>全部诊断（{state.diagnostics.length} 条）</summary>
                <ul>
                  {state.diagnostics.map((d, i) => (
                    <li key={`${d.plugin}-${i}`} className="p0-subtitle">
                      [{d.severity === 'error' ? '错误' : '警告'}] {d.plugin}：{d.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>
    </div>
  );
}
