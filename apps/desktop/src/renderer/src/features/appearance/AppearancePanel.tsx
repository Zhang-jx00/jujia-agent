import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import {
  BACKGROUND_KINDS,
  BUILTIN_PACKS,
  checkContrast,
  checkPrimaryUsable,
  mergePackOverrides,
  themePackToCssVars,
  THEME_PACK_VAR_KEYS,
  validateThemePack,
  type BackgroundKind,
  type BackgroundSpec,
  type DialogStyle,
  type ThemePack,
} from '@jujia/ui-tokens';
import { IconTriangleAlert } from '../../ui/icons';
import { SettingRow } from '../settings/SettingRow';
import { applyThemeVars } from './theme-vars';

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

interface AppearancePanelProps {
  /** 当前保存的样式包（来自配置）；为空表示用默认 */
  pack: ThemePack;
  /** 保存回调（写入配置） */
  onSave: (pack: ThemePack) => void | Promise<void>;
}

/** R58（T79）：主色那一格的界面状态（**实测数字**，不是"大概行不行"） */
interface PrimaryState {
  /** 这个包带不带主色（不带 ⇒ 主按钮沿用默认主色） */
  present: boolean;
  /** 能不能用（按钮字看得见 **且** 焦点环看得见） */
  ok: boolean;
  /** 按钮字色该用哪个 */
  ink: string;
  /** 按钮文字与主色的对比度 */
  inkRatio: number | null;
  /** 主色与界面容器底的对比度 */
  surfaceRatio: number | null;
  /** 不达标时给用户看的一句 */
  advice: string | undefined;
  /** 不达标时建议改成的颜色 */
  suggested: string | undefined;
}

export function AppearancePanel({ pack, onSave }: AppearancePanelProps): ReactElement {
  const [draft, setDraft] = useState<ThemePack>(pack);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /**
   * T81（2026-10-22）：**「毛玻璃」这个包在开了「减少透明」的系统上用不了** ——
   * 系统偏好命中时，`styles/motion.css` 的降级块把整屏模糊换成不透明底
   * （**这是尊重系统偏好，不是 bug**），但用户只看得到"毛玻璃没生效" ⇒ **界面必须说清是谁关掉的**。
   * 实测：本机 Electron 44.4.2 的 `prefers-reduced-transparency: reduce` **默认命中**
   * ⇒ 四个内置包里有一个**在这台机器上永远看不到玻璃**（R54/R55 两轮现扫都量到了）。
   */
  const reducedTransparency = useMemo(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-transparency: reduce)').matches,
    [],
  );

  // 外部配置变化时同步（例如启动时从配置读出来的值）
  useEffect(() => {
    setDraft(pack);
  }, [pack]);

  // 实时预览：把受控 CSS 变量写到 :root
  useEffect(() => {
    // R58（T79）：走 `applyThemeVars` —— **先清残值再写**。
    // `setProperty` 只写不清 ⇒ 从「柔和渐变」切回「默认暗色」时，上一个包的 `--jj-primary`
    // 会赖在 `:root` 上 ⇒ "换包后主色还是上一个包的"（把"主色不变"修成"主色变成上一个的"，一样是坏的）。
    applyThemeVars(document.documentElement, themePackToCssVars(draft), THEME_PACK_VAR_KEYS);
    document.documentElement.dataset['jjBgKind'] = draft.background.kind;
    return () => {
      // 离开页面时保留样式（用户可能切去对话页看效果），因此这里不清理
    };
  }, [draft]);

  const contrast = useMemo(() => checkContrast(draft.background), [draft.background]);

  /**
   * R58（T79）：**当前主色能不能用**（按钮上的字看得见吗？焦点环看得见吗？）。
   *
   * 为什么要在界面上说清：主色是**用户自己带来的**（JSON 导入），
   * 而"按钮看不清"这种事用户只会看到"应用配色怪"⇒ **要告诉他是谁带来的、差多少**。
   * 达标时也显示实测数字（不达标时才说的话 = 一句"平时永远不出现"的解释 ⇒ 反而没人知道主色能配）。
   */
  const primaryState = useMemo<PrimaryState>(() => {
    if (draft.primary === undefined) {
      return {
        present: false,
        ok: true,
        ink: '#101010',
        inkRatio: null,
        surfaceRatio: null,
        advice: undefined,
        suggested: undefined,
      };
    }
    const v = checkPrimaryUsable(draft.primary);
    return {
      present: true,
      ok: v.ok,
      ink: v.ink,
      inkRatio: v.inkRatio,
      surfaceRatio: v.surfaceRatio,
      advice: v.advice,
      suggested: v.suggestedPrimary,
    };
  }, [draft.primary]);

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
    /**
     * R58（T79）：**主色可用性闸门放在导入侧**。
     *
     * ① 为什么**不动** `validateThemePack`：它管着**启动时加载已保存的样式包**，
     *    在那里硬拒绝会把用户**已经存下来**的包静默退回默认包 ⇒ 那是替用户做决定；
     * ② 这里是**新包进来的唯一入口**（面板没有主色选择器）⇒ 闸门在这里最有效；
     * ③ 已经存下来的坏主色怎么办：照旧加载（**不动加载语义**），
     *    字色取"更好的那个"（`--jj-primary-ink`），并在外观页显示那句提醒（见下面的主色说明块）。
     */
    if (result.pack.primary !== undefined) {
      const usable = checkPrimaryUsable(result.pack.primary);
      if (!usable.ok) {
        setImportError(`样式包被拒绝：${usable.advice ?? '这个主色用不了'}`);
        return;
      }
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
      {/*
        标题由**设置中心**给（那一页已经写着「外观」）⇒ 这里只留一句说明，
        不重复一个同名的大标题（两个「外观」摞在一起 = 界面上没想清楚层级）。
      */}
      <header className="jj-appearance-head">
        <p className="p0-subtitle">
          对话框样式与背景可自由调整。<strong>样式包只允许受控字段</strong>
          （枚举与范围内数值）——不接受任意 CSS，避免把安全口子开在"可定制"上。
        </p>
      </header>

      {/* ---------------- 样式包（一整行：4 个预设） ---------------- */}
      <SettingRow title="样式包" hint="内置的几套配色与气泡样式；换一套立刻在界面上生效">
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
      </SettingRow>

      {/* ---------------- 对话框样式 ---------------- */}
      <SettingRow title="气泡形状" hint="对话气泡的轮廓" htmlFor="jj-bubble-shape">
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
      </SettingRow>

      <SettingRow title="信息密度" hint="行距与内边距的松紧" htmlFor="jj-density">
        <select
          id="jj-density"
          value={draft.dialog.density}
          onChange={(e) => updateDialog({ density: e.target.value as DialogStyle['density'] })}
        >
          <option value="comfortable">舒适</option>
          <option value="compact">紧凑</option>
        </select>
      </SettingRow>

      <SettingRow title="气泡圆角" hint={`当前 ${String(draft.dialog.radiusPx)}px`} htmlFor="jj-radius">
        <input
          id="jj-radius"
          type="range"
          min={0}
          max={32}
          value={draft.dialog.radiusPx}
          onChange={(e) => updateDialog({ radiusPx: Number(e.target.value) })}
        />
      </SettingRow>

      <SettingRow
        title="气泡最大宽度"
        hint={`当前 ${String(draft.dialog.maxBubbleWidthPct)}%`}
        htmlFor="jj-width"
      >
        <input
          id="jj-width"
          type="range"
          min={40}
          max={100}
          value={draft.dialog.maxBubbleWidthPct}
          onChange={(e) => updateDialog({ maxBubbleWidthPct: Number(e.target.value) })}
        />
      </SettingRow>

      <SettingRow title="显示时间戳" hint="每条消息旁边标出时间" htmlFor="jj-timestamp">
        {/*
          用**开关**而不是裸 checkbox（R67 的 e2e 当场抓到的）：裸 checkbox 只有 13×13
          ⇒ 用户实际能点到的那一小块太小（T78 同款口径：原生控件判**关联 label**）
          ⇒ 改成开关（44×24 的可点区域，视觉上也与设置页的通行做法一致）。
        */}
        <label className="jj-switch" htmlFor="jj-timestamp">
          <input
            id="jj-timestamp"
            type="checkbox"
            checked={draft.dialog.showTimestamp}
            onChange={(e) => updateDialog({ showTimestamp: e.target.checked })}
          />
          <span className="jj-switch-track" aria-hidden="true" />
        </label>
      </SettingRow>

      {/* ---------------- 背景 ---------------- */}
      <SettingRow title="背景类型" hint="纯色 / 渐变 / 图片 / 毛玻璃">
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
      </SettingRow>
      {draft.background.kind === 'glass' && reducedTransparency && (
        <p className="p0-subtitle" data-reduced-transparency="true">
          你的系统开着「减少透明」⇒ **毛玻璃这个包在这台机器上会用不透明底代替**（不是应用坏了，是系统的偏好；关掉那个偏好就能看到玻璃）。
        </p>
      )}

      {(draft.background.kind === 'solid' || draft.background.kind === 'glass') && (
        <SettingRow title="背景色" hint="窗口底色" htmlFor="jj-bg-color">
          <input
            id="jj-bg-color"
            type="color"
            value={draft.background.color ?? '#141414'}
            onChange={(e) => updateBackground({ color: e.target.value })}
          />
        </SettingRow>
      )}

      {draft.background.kind === 'gradient' && (
        <>
          <SettingRow title="起始色" hint="渐变的上端颜色" htmlFor="jj-bg-from">
            <input
              id="jj-bg-from"
              type="color"
              value={draft.background.from ?? '#1b2440'}
              onChange={(e) => updateBackground({ from: e.target.value })}
            />
          </SettingRow>
          <SettingRow title="结束色" hint="渐变的下端颜色" htmlFor="jj-bg-to">
            <input
              id="jj-bg-to"
              type="color"
              value={draft.background.to ?? '#0f1117'}
              onChange={(e) => updateBackground({ to: e.target.value })}
            />
          </SettingRow>
        </>
      )}

      {draft.background.kind === 'image' && (
        <SettingRow
          title="图片地址"
          hint="仅 http(s) 或本机绝对路径"
          htmlFor="jj-bg-image"
          wide
        >
          <input
            id="jj-bg-image"
            type="text"
            placeholder="https://… 或 D:\pics\bg.png"
            value={draft.background.imageUrl ?? ''}
            onChange={(e) => updateBackground({ imageUrl: e.target.value })}
          />
        </SettingRow>
      )}

      {draft.background.kind === 'glass' && (
        <>
          <SettingRow title="模糊" hint={`当前 ${String(draft.background.blurPx ?? 0)}px`} htmlFor="jj-bg-blur">
            <input
              id="jj-bg-blur"
              type="range"
              min={0}
              max={40}
              value={draft.background.blurPx ?? 0}
              onChange={(e) => updateBackground({ blurPx: Number(e.target.value) })}
            />
          </SettingRow>
          <SettingRow
            title="不透明度"
            hint={`当前 ${(draft.background.opacity ?? 1).toFixed(2)}`}
            htmlFor="jj-bg-opacity"
          >
            <input
              id="jj-bg-opacity"
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={draft.background.opacity ?? 1}
              onChange={(e) => updateBackground({ opacity: Number(e.target.value) })}
            />
          </SettingRow>
        </>
      )}

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

      {/* ---------------- 主色（R58 · T79） ---------------- */}
      {primaryState.present && (
        <div
          className={primaryState.ok ? 'jj-note' : 'jj-note jj-note-warn'}
          role="status"
          data-primary-note="true"
          data-primary-ok={primaryState.ok ? 'true' : 'false'}
        >
          {primaryState.ok ? (
            <>
              <strong>主色 {draft.primary ?? ''}</strong>
              按钮上的文字对比 {primaryState.inkRatio === null ? '?' : primaryState.inkRatio.toFixed(2)}:1
              （AA 4.5）· 与界面底色对比{' '}
              {primaryState.surfaceRatio === null ? '?' : primaryState.surfaceRatio.toFixed(2)}:1（焦点环 3）
              · 按钮字色用 {primaryState.ink}
            </>
          ) : (
            <>
              <strong>
                <IconTriangleAlert /> 这个主色用不了：
              </strong>
              {primaryState.advice}
              {primaryState.suggested !== undefined && (
                <button
                  type="button"
                  className="jj-btn jj-transition"
                  onClick={() =>
                    setDraft((d) => (d.primary === undefined ? d : { ...d, primary: primaryState.suggested }))
                  }
                >
                  改用建议色 {primaryState.suggested}（推荐）
                </button>
              )}
            </>
          )}
        </div>
      )}

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
