import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import {
  BACKGROUND_KINDS,
  BUILTIN_PACKS,
  checkContrast,
  mergePackOverrides,
  themePackToCssVars,
  validateThemePack,
  type BackgroundKind,
  type BackgroundSpec,
  type DialogStyle,
  type ThemePack,
} from '@jujia/ui-tokens';
import { IconTriangleAlert } from '../../ui/icons';

/**
 * 外观设置页（W23 第二部分）。
 *
 * 纪律（来自 docs/ARCH-CLOUD-IDE.md §6.2，也是 W23 第一部分的约束）：
 * 1. **受控字段**：只允许枚举与范围内数值；图片地址走严格白名单。
 *    本页面的所有输入都会经过 `validateThemePack()`，**非法输入整包拒绝并显示原因**，
 *    绝不把用户输入当 CSS 写进 DOM；
 * 2. **对比度守护**：背景与文字对比度不达标时主动提示并给出一键修复；
 * 3. **不假装校验过**：图片/渐变背景无法精确计算对比度时如实说明。
 */

const KIND_LABEL: Record<BackgroundKind, string> = {
  solid: '纯色',
  gradient: '渐变',
  image: '图片',
  glass: '毛玻璃',
};

export interface AppearancePanelProps {
  /** 当前保存的样式包（来自配置）；为空表示用默认 */
  pack: ThemePack;
  /** 保存回调（写入配置） */
  onSave: (pack: ThemePack) => void | Promise<void>;
}

export function AppearancePanel({ pack, onSave }: AppearancePanelProps): ReactElement {
  const [draft, setDraft] = useState<ThemePack>(pack);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // 外部配置变化时同步（例如启动时从配置读出来的值）
  useEffect(() => {
    setDraft(pack);
  }, [pack]);

  // 实时预览：把受控 CSS 变量写到 :root
  useEffect(() => {
    const vars = themePackToCssVars(draft);
    const root = document.documentElement;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.dataset['jjBgKind'] = draft.background.kind;
    return () => {
      // 离开页面时保留样式（用户可能切去对话页看效果），因此这里不清理
    };
  }, [draft]);

  const contrast = useMemo(() => checkContrast(draft.background), [draft.background]);

  function updateDialog(patch: Partial<DialogStyle>): void {
    setDraft((d) => ({ ...d, dialog: { ...d.dialog, ...patch } }));
  }

  function updateBackground(patch: Partial<BackgroundSpec>): void {
    setDraft((d) => ({ ...d, background: { ...d.background, ...patch } }));
  }

  function applyPreset(id: string): void {
    const found = BUILTIN_PACKS.find((p) => p.id === id);
    if (found) {
      setDraft(found);
      setSaved(false);
    }
  }

  function doImport(): void {
    setImportError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      setImportError('不是合法的 JSON');
      return;
    }
    const result = validateThemePack(parsed);
    if (!result.ok || !result.pack) {
      setImportError(`样式包被拒绝：${result.errors.join('；')}`);
      return;
    }
    setDraft(result.pack);
    setImportText('');
    setSaved(false);
  }

  async function doSave(): Promise<void> {
    setSaveError(null);
    // 保存前再校验一次（draft 由受控 UI 产生，但防御性校验成本极低）
    const result = validateThemePack(draft);
    if (!result.ok || !result.pack) {
      setSaveError(`保存失败：${result.errors.join('；')}`);
      return;
    }
    try {
      await onSave(result.pack);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="jj-appearance">
      <header className="jj-appearance-head">
        <h2>外观</h2>
        <p className="p0-subtitle">
          对话框样式与背景可自由调整。<strong>样式包只允许受控字段</strong>
          （枚举与范围内数值）——不接受任意 CSS，避免把安全口子开在"可定制"上。
        </p>
      </header>

      {/* ---------------- 样式包 ---------------- */}
      <div className="jj-field">
        <label>样式包</label>
        <div className="jj-pack-list">
          {BUILTIN_PACKS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`jj-pack jj-transition${draft.id === p.id ? ' jj-pack-active' : ''}`}
              onClick={() => applyPreset(p.id)}
            >
              <span className="jj-pack-name">{p.name}</span>
              <span className="jj-pack-kind">{KIND_LABEL[p.background.kind]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ---------------- 对话框样式 ---------------- */}
      <div className="jj-grid">
        <div className="jj-field">
          <label htmlFor="jj-bubble-shape">气泡形状</label>
          <select
            id="jj-bubble-shape"
            value={draft.dialog.bubbleShape}
            onChange={(e) => updateDialog({ bubbleShape: e.target.value as DialogStyle['bubbleShape'] })}
          >
            <option value="rounded">圆角</option>
            <option value="square">直角</option>
            <option value="pill">胶囊</option>
            <option value="tail">带尾巴</option>
          </select>
        </div>

        <div className="jj-field">
          <label htmlFor="jj-density">密度</label>
          <select
            id="jj-density"
            value={draft.dialog.density}
            onChange={(e) => updateDialog({ density: e.target.value as DialogStyle['density'] })}
          >
            <option value="comfortable">舒适</option>
            <option value="compact">紧凑</option>
          </select>
        </div>

        <div className="jj-field">
          <label htmlFor="jj-radius">圆角 {draft.dialog.radiusPx}px</label>
          <input
            id="jj-radius"
            type="range"
            min={0}
            max={32}
            value={draft.dialog.radiusPx}
            onChange={(e) => updateDialog({ radiusPx: Number(e.target.value) })}
          />
        </div>

        <div className="jj-field">
          <label htmlFor="jj-width">气泡最大宽度 {draft.dialog.maxBubbleWidthPct}%</label>
          <input
            id="jj-width"
            type="range"
            min={40}
            max={100}
            value={draft.dialog.maxBubbleWidthPct}
            onChange={(e) => updateDialog({ maxBubbleWidthPct: Number(e.target.value) })}
          />
        </div>

        <label className="jj-check">
          <input
            type="checkbox"
            checked={draft.dialog.showTimestamp}
            onChange={(e) => updateDialog({ showTimestamp: e.target.checked })}
          />
          显示时间戳
        </label>
      </div>

      {/* ---------------- 背景 ---------------- */}
      <div className="jj-field">
        <label>背景</label>
        <div className="jj-kind-row">
          {BACKGROUND_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className={`jj-btn jj-transition${draft.background.kind === k ? ' jj-btn-active' : ''}`}
              onClick={() => updateBackground({ kind: k })}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="jj-grid">
        {(draft.background.kind === 'solid' || draft.background.kind === 'glass') && (
          <div className="jj-field">
            <label htmlFor="jj-bg-color">背景色</label>
            <input
              id="jj-bg-color"
              type="color"
              value={draft.background.color ?? '#141414'}
              onChange={(e) => updateBackground({ color: e.target.value })}
            />
          </div>
        )}

        {draft.background.kind === 'gradient' && (
          <>
            <div className="jj-field">
              <label htmlFor="jj-bg-from">起始色</label>
              <input
                id="jj-bg-from"
                type="color"
                value={draft.background.from ?? '#1b2440'}
                onChange={(e) => updateBackground({ from: e.target.value })}
              />
            </div>
            <div className="jj-field">
              <label htmlFor="jj-bg-to">结束色</label>
              <input
                id="jj-bg-to"
                type="color"
                value={draft.background.to ?? '#0f1117'}
                onChange={(e) => updateBackground({ to: e.target.value })}
              />
            </div>
          </>
        )}

        {draft.background.kind === 'image' && (
          <div className="jj-field jj-field-wide">
            <label htmlFor="jj-bg-image">图片地址（仅 http(s) 或本机绝对路径）</label>
            <input
              id="jj-bg-image"
              type="text"
              placeholder="https://… 或 D:\pics\bg.png"
              value={draft.background.imageUrl ?? ''}
              onChange={(e) => updateBackground({ imageUrl: e.target.value })}
            />
          </div>
        )}

        {draft.background.kind === 'glass' && (
          <>
            <div className="jj-field">
              <label htmlFor="jj-bg-blur">模糊 {draft.background.blurPx ?? 0}px</label>
              <input
                id="jj-bg-blur"
                type="range"
                min={0}
                max={40}
                value={draft.background.blurPx ?? 0}
                onChange={(e) => updateBackground({ blurPx: Number(e.target.value) })}
              />
            </div>
            <div className="jj-field">
              <label htmlFor="jj-bg-opacity">不透明度 {(draft.background.opacity ?? 1).toFixed(2)}</label>
              <input
                id="jj-bg-opacity"
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={draft.background.opacity ?? 1}
                onChange={(e) => updateBackground({ opacity: Number(e.target.value) })}
              />
            </div>
          </>
        )}
      </div>

      {/* ---------------- 对比度守护 ---------------- */}
      <div className={contrast.ok ? 'jj-note' : 'jj-note jj-note-warn'} role="status">
        {contrast.ok ? (
          <>
            <strong>对比度检查通过</strong>
            {contrast.ratio !== null ? `（${contrast.ratio.toFixed(2)}:1）` : ''}
            {contrast.advice ? ` —— ${contrast.advice}` : ''}
          </>
        ) : (
          <>
            <strong>
              <IconTriangleAlert /> 可读性不足：
            </strong>
            {contrast.advice}
            {contrast.suggestedForeground && (
              <button
                type="button"
                className="jj-btn jj-transition"
                onClick={() => updateBackground({ kind: 'solid', color: '#141414' })}
              >
                恢复深色背景（推荐）
              </button>
            )}
          </>
        )}
      </div>

      {/* ---------------- 导入 / 保存 ---------------- */}
      <details className="jj-import">
        <summary>导入样式包（JSON）</summary>
        <textarea
          rows={5}
          spellCheck={false}
          placeholder='{"id":"my","name":"我的","version":1,"dialog":{...},"background":{"kind":"solid","color":"#101820"}}'
          value={importText}
          onChange={(e) => {
            setImportText(e.target.value);
            setImportError(null);
          }}
        />
        <button type="button" className="jj-btn jj-transition" onClick={doImport}>
          校验并应用
        </button>
        {importError && <p className="p0-err">{importError}</p>}
      </details>

      <div className="jj-actions">
        <button type="button" className="w2-btn-primary jj-transition jj-pressable" onClick={() => void doSave()}>
          保存外观
        </button>
        <button
          type="button"
          className="jj-btn jj-transition"
          onClick={() => {
            applyPreset('default-dark');
          }}
        >
          恢复默认
        </button>
        {saved && <span className="p0-subtitle">已保存</span>}
        {saveError && <span className="p0-err">{saveError}</span>}
      </div>
    </section>
  );
}

export { mergePackOverrides };
