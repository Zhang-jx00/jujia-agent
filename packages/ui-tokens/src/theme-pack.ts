/**
 * 外观样式包与背景规格（W23 核心 · 纯逻辑，零依赖）。
 *
 * 两条硬约束（来自 `docs/ARCH-CLOUD-IDE.md` §6.2）：
 * 1. **只允许受控字段** —— 样式包不接受任意 CSS/JS 字符串。否则「可定制」等于把
 *    XSS 与 RCE 一起请进来（2026-09 曾出现影响主流编码 agent 的零点击 RCE，见卡片 013）；
 * 2. **对比度守护** —— 用户选的背景若让文字看不清，要主动提示并提供一键修复，
 *    而不是静默让人瞎着眼用。
 *
 * 本模块不碰 DOM、不碰 fs，因此可单测、可被渲染层与主进程共用。
 */

/* ------------------------------------------------------------------ *
 * 一、受控字段定义（白名单）
 * ------------------------------------------------------------------ */

export const BUBBLE_SHAPES = ['rounded', 'square', 'pill', 'tail'] as const;
export type BubbleShape = (typeof BUBBLE_SHAPES)[number];

export const DENSITIES = ['compact', 'comfortable'] as const;
export type Density = (typeof DENSITIES)[number];

export const ALIGNMENTS = ['left', 'right'] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

export const BACKGROUND_KINDS = ['solid', 'gradient', 'image', 'glass'] as const;
export type BackgroundKind = (typeof BACKGROUND_KINDS)[number];

/** 数值走范围校验，字符串走白名单/安全模式校验 */
const HEX = /^#[0-9a-fA-F]{3,8}$/;
/** 图片只允许本地绝对路径或 http(s) URL —— 明确拒绝 data:/javascript:/file: 等 */
const SAFE_IMAGE = /^(https?:\/\/[^\s"']+|[a-zA-Z]:[\\/][^\s"']+|\/[^\s"']+)$/;

export interface DialogStyle {
  bubbleShape: BubbleShape;
  density: Density;
  /** 头像/标签显示方式 */
  showRoleLabel: boolean;
  showTimestamp: boolean;
  /** 气泡最大宽度（百分比，40–100） */
  maxBubbleWidthPct: number;
  userAlign: Alignment;
  radiusPx: number;
  borderWidthPx: number;
}

export interface BackgroundSpec {
  kind: BackgroundKind;
  /** solid / glass 用 */
  color?: string | undefined;
  /** gradient 用（两个色标） */
  from?: string | undefined;
  to?: string | undefined;
  /** image 用 */
  imageUrl?: string | undefined;
  /** 透明度 0–1（glass/整体浮层用） */
  opacity?: number | undefined;
  /** 模糊半径 px（glass 用，0–40） */
  blurPx?: number | undefined;
}

export interface ThemePack {
  /** 包标识（用于展示与去重） */
  id: string;
  name: string;
  version: 1;
  dialog: DialogStyle;
  background: BackgroundSpec;
  /** 主色（会用于按钮/强调） */
  primary?: string | undefined;
}

export interface ValidationResult {
  ok: boolean;
  pack?: ThemePack;
  errors: string[];
}

/* ------------------------------------------------------------------ *
 * 二、校验：只认白名单字段，拒绝可疑内容
 * ------------------------------------------------------------------ */

const DANGEROUS = [
  /[{}]/, // 花括号：CSS 规则块 / 模板注入
  /<\s*\/?\s*(script|style|iframe|img|svg)/i, // 标签注入
  /javascript:/i,
  /expression\s*\(/i,
  /url\s*\(/i, // 任意 url() 一律拒绝（图片走 imageUrl 专用字段）
  /@import/i,
  /[\\]/, // 反斜杠：CSS 转义绕过
];

function safeString(value: unknown, field: string, errors: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    errors.push(`${field} 必须是字符串`);
    return undefined;
  }
  for (const re of DANGEROUS) {
    if (re.test(value)) {
      errors.push(`${field} 含被拒绝的内容（疑似 CSS/JS 注入）`);
      return undefined;
    }
  }
  return value;
}

function inRange(value: unknown, min: number, max: number, field: string, errors: string[]): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${field} 必须是数字`);
    return undefined;
  }
  if (value < min || value > max) {
    errors.push(`${field} 超出允许范围（${min}–${max}），收到 ${value}`);
    return undefined;
  }
  return value;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  errors: string[],
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    errors.push(`${field} 必须是以下之一：${allowed.join(' / ')}`);
    return undefined;
  }
  return value as T;
}

const KNOWN_TOP_KEYS = new Set(['id', 'name', 'version', 'dialog', 'background', 'primary']);
const KNOWN_DIALOG_KEYS = new Set([
  'bubbleShape',
  'density',
  'showRoleLabel',
  'showTimestamp',
  'maxBubbleWidthPct',
  'userAlign',
  'radiusPx',
  'borderWidthPx',
]);
const KNOWN_BG_KEYS = new Set([
  'kind',
  'color',
  'from',
  'to',
  'imageUrl',
  'opacity',
  'blurPx',
]);

function rejectUnknown(obj: Record<string, unknown>, known: Set<string>, where: string, errors: string[]): void {
  for (const k of Object.keys(obj)) {
    if (!known.has(k)) errors.push(`${where} 含未知字段：${k}（只允许受控字段）`);
  }
}

export const DEFAULT_DIALOG_STYLE: DialogStyle = {
  bubbleShape: 'rounded',
  density: 'comfortable',
  showRoleLabel: true,
  showTimestamp: false,
  maxBubbleWidthPct: 88,
  userAlign: 'right',
  radiusPx: 8,
  borderWidthPx: 1,
};

export const DEFAULT_BACKGROUND: BackgroundSpec = { kind: 'solid', color: '#141414' };

/** 内置样式包（用户可直接切换，也可导入自己的） */
export const BUILTIN_PACKS: ThemePack[] = [
  {
    id: 'default-dark',
    name: '默认暗色',
    version: 1,
    dialog: { ...DEFAULT_DIALOG_STYLE },
    background: { kind: 'solid', color: '#141414' },
    primary: '#4c8dff',
  },
  {
    id: 'compact-dark',
    name: '紧凑暗色',
    version: 1,
    dialog: { ...DEFAULT_DIALOG_STYLE, density: 'compact', radiusPx: 4, borderWidthPx: 1 },
    background: { kind: 'solid', color: '#141414' },
    primary: '#4c8dff',
  },
  {
    id: 'soft-gradient',
    name: '柔和渐变',
    version: 1,
    dialog: { ...DEFAULT_DIALOG_STYLE, bubbleShape: 'pill', radiusPx: 18 },
    background: { kind: 'gradient', from: '#1b2440', to: '#0f1117' },
    primary: '#6ba0ff',
  },
  {
    id: 'frosted',
    name: '毛玻璃',
    version: 1,
    dialog: { ...DEFAULT_DIALOG_STYLE, bubbleShape: 'rounded' },
    background: { kind: 'glass', color: '#1f1f1f', opacity: 0.72, blurPx: 16 },
    primary: '#8ab4ff',
  },
];

/** 校验并规范化一个样式包；任何未知字段或可疑内容都会导致整包被拒 */
export function validateThemePack(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['样式包必须是一个对象'] };
  }
  const raw = input as Record<string, unknown>;
  rejectUnknown(raw, KNOWN_TOP_KEYS, '样式包', errors);

  const id = safeString(raw['id'], 'id', errors);
  const name = safeString(raw['name'], 'name', errors);
  if (!id) errors.push('缺少 id');
  if (!name) errors.push('缺少 name');
  if (raw['version'] !== 1) errors.push('version 必须为 1');

  const rawDialog = (raw['dialog'] ?? {}) as Record<string, unknown>;
  if (typeof rawDialog !== 'object' || rawDialog === null || Array.isArray(rawDialog)) {
    return { ok: false, errors: [...errors, 'dialog 必须是对象'] };
  }
  rejectUnknown(rawDialog, KNOWN_DIALOG_KEYS, 'dialog', errors);

  const rawBg = (raw['background'] ?? {}) as Record<string, unknown>;
  if (typeof rawBg !== 'object' || rawBg === null || Array.isArray(rawBg)) {
    return { ok: false, errors: [...errors, 'background 必须是对象'] };
  }
  rejectUnknown(rawBg, KNOWN_BG_KEYS, 'background', errors);

  const bubbleShape = oneOf(rawDialog['bubbleShape'], BUBBLE_SHAPES, 'dialog.bubbleShape', errors);
  const density = oneOf(rawDialog['density'], DENSITIES, 'dialog.density', errors);
  const userAlign = oneOf(rawDialog['userAlign'], ALIGNMENTS, 'dialog.userAlign', errors);
  const maxBubbleWidthPct = inRange(rawDialog['maxBubbleWidthPct'], 40, 100, 'dialog.maxBubbleWidthPct', errors);
  const radiusPx = inRange(rawDialog['radiusPx'], 0, 32, 'dialog.radiusPx', errors);
  const borderWidthPx = inRange(rawDialog['borderWidthPx'], 0, 4, 'dialog.borderWidthPx', errors);

  const kind = oneOf(rawBg['kind'], BACKGROUND_KINDS, 'background.kind', errors);
  const color = safeString(rawBg['color'], 'background.color', errors);
  const from = safeString(rawBg['from'], 'background.from', errors);
  const to = safeString(rawBg['to'], 'background.to', errors);
  const opacity = inRange(rawBg['opacity'], 0, 1, 'background.opacity', errors);
  const blurPx = inRange(rawBg['blurPx'], 0, 40, 'background.blurPx', errors);

  // 注意：imageUrl **不**套用 safeString 的「反斜杠=注入」规则——
  // Windows 绝对路径必须用反斜杠（单测实测被误伤）。改为直接走 SAFE_IMAGE 严格白名单，
  // 白名单本身就排除了注入面。
  let imageUrl: string | undefined;
  if (rawBg['imageUrl'] !== undefined) {
    if (typeof rawBg['imageUrl'] !== 'string' || !SAFE_IMAGE.test(rawBg['imageUrl'])) {
      errors.push('background.imageUrl 只允许 http(s) 链接或本机绝对路径');
    } else {
      imageUrl = rawBg['imageUrl'];
    }
  }

  for (const [field, val] of [
    ['background.color', color],
    ['background.from', from],
    ['background.to', to],
  ] as const) {
    if (val !== undefined && !HEX.test(val)) errors.push(`${field} 必须是 #RRGGBB 形式`);
  }

  if (kind === 'image' && imageUrl === undefined) errors.push('kind=image 时必须提供 imageUrl');
  if (kind === 'gradient' && (from === undefined || to === undefined)) {
    errors.push('kind=gradient 时必须提供 from 与 to');
  }

  const primary = safeString(raw['primary'], 'primary', errors);
  if (primary !== undefined && !HEX.test(primary)) errors.push('primary 必须是 #RRGGBB 形式');

  if (errors.length > 0) return { ok: false, errors };

  const dialog: DialogStyle = {
    bubbleShape: bubbleShape ?? DEFAULT_DIALOG_STYLE.bubbleShape,
    density: density ?? DEFAULT_DIALOG_STYLE.density,
    showRoleLabel: rawDialog['showRoleLabel'] !== false,
    showTimestamp: rawDialog['showTimestamp'] === true,
    maxBubbleWidthPct: maxBubbleWidthPct ?? DEFAULT_DIALOG_STYLE.maxBubbleWidthPct,
    userAlign: userAlign ?? DEFAULT_DIALOG_STYLE.userAlign,
    radiusPx: radiusPx ?? DEFAULT_DIALOG_STYLE.radiusPx,
    borderWidthPx: borderWidthPx ?? DEFAULT_DIALOG_STYLE.borderWidthPx,
  };

  const background: BackgroundSpec = {
    kind: kind ?? DEFAULT_BACKGROUND.kind,
    ...(color !== undefined ? { color } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    ...(imageUrl !== undefined ? { imageUrl } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    ...(blurPx !== undefined ? { blurPx } : {}),
  };

  return { ok: true, pack: { id: id as string, name: name as string, version: 1, dialog, background, ...(primary !== undefined ? { primary } : {}) }, errors: [] };
}

/* ------------------------------------------------------------------ *
 * 三、对比度守护（WCAG 相对亮度算法）
 * ------------------------------------------------------------------ */

function expandHex(hex: string): string | null {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  // 必须同时校验长度与字符——只查长度会把 'nonsense'（恰好 8 字符）误当 8 位色，
  // 解析出 NaN 并往下传播（单测实测）
  if (!/^[0-9a-fA-F]+$/.test(h)) return null;
  if (h.length === 3) return h.split('').map((c) => c + c).join('');
  if (h.length === 6) return h;
  if (h.length === 8) return h.slice(0, 6);
  return null;
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number | null {
  const full = expandHex(hex);
  if (!full) return null;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG 对比度：1:1 到 21:1 */
export function contrastRatio(fg: string, bg: string): number | null {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  if (l1 === null || l2 === null) return null;
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export const CONTRAST_AA_NORMAL = 4.5;
export const CONTRAST_AA_LARGE = 3;

/**
 * **非文本对比度下限**（WCAG 1.4.11 / 2.4.11：焦点环、边框这类"看得见"的图形用 3:1）。
 *
 * 为什么主色要按这条判：主色不只做按钮底色，还做**焦点环**（`input:focus` 的 outline）
 * 与**边框**（选中页签、chip 悬停）。⇒ 主色太深 ⇒ 焦点环在深色界面上等于没有。
 */
export const CONTRAST_NON_TEXT = 3;

/**
 * 主色上候选的按钮字色。
 *
 * 为什么是这两个：`#101010` = 渲染层的 `--c-bg-input`（现有主按钮的字色，基线实测 5.94:1），
 * `#ffffff` = 白字。⇒ 两者里取**对比度更高**的那个（见 `pickPrimaryInk`）。
 */
export const PRIMARY_INK_CANDIDATES = ['#101010', '#ffffff'] as const;

/**
 * 主色要跟哪个底色比"看得见"——**界面容器底**（`--c-bg-container` = #1f1f1f）。
 *
 * 为什么不用页面底（`--c-bg-layout` = #141414）：控件（输入框、chip、页签）都住在容器底那一档上，
 * 而容器底**比页面底亮**（L 0.0137 vs 0.0070）⇒ 同一个主色对容器底的对比**更低** ⇒
 * 拿更严的那一档判，才不会出现"按页面底算过了、放到控件上却看不见"。
 */
export const PRIMARY_SURFACE = '#1f1f1f';

export interface ContrastAdvice {
  ok: boolean;
  ratio: number | null;
  /** 不达标时的建议（可直接展示给用户） */
  advice?: string;
  /** 一键修复：建议的前景色 */
  suggestedForeground?: string;
}

/**
 * 背景若为图片/渐变/毛玻璃，无法精确算对比度 —— 此时返回 ok:true 但标注「无法精确校验」，
 * 并给出保守建议（加半透明遮罩层）。**不假装校验过**。
 */
export function checkContrast(background: BackgroundSpec, foreground = '#f5f5f5'): ContrastAdvice {
  if (background.kind === 'image' || background.kind === 'gradient') {
    return {
      ok: true,
      ratio: null,
      advice: '图片/渐变背景无法精确计算对比度；已自动叠加半透明遮罩以保证可读性，如需更强对比可调高遮罩不透明度。',
    };
  }
  const bg = background.color ?? '#141414';
  const ratio = contrastRatio(foreground, bg);
  if (ratio === null) {
    return { ok: false, ratio: null, advice: '前景或背景色格式无法解析，已回退到默认配色。' };
  }
  if (ratio >= CONTRAST_AA_NORMAL) return { ok: true, ratio };
  const lum = relativeLuminance(bg) ?? 0;
  const suggestedForeground = lum > 0.4 ? '#111111' : '#ffffff';
  return {
    ok: false,
    ratio,
    advice: `当前前景与背景对比度仅 ${ratio.toFixed(2)}:1，低于 WCAG AA 的 ${CONTRAST_AA_NORMAL}:1，文字会看不清。`,
    suggestedForeground,
  };
}

/* ------------------------------------------------------------------ *
 * 四、主色可用性（接线与闸门的口径本体 · T79）
 *
 * 为什么需要这一段：主色一旦**真的接到渲染层**（`--primary` 读它），
 * 它就同时管三件事 —— ① 按钮底色 ② 按钮上的字色 ③ 焦点环与边框的颜色。
 * ⇒ "主色好不好"不能只看它好不好看，要看**它在这三处分别够不够看得见**。
 *
 * 两条判定（缺一不可）：
 *   A. **按钮字色**：主色上的字取 `#101010` / `#ffffff` 里对比度更高的那个，
 *      它对主色的对比必须 ≥ **4.5:1**（AA 正文）。
 *      ⚠️ 存在一段**灰带**：主色亮度落在 (0.1833, 0.1969) 时，**两种字色都到不了 4.5:1**
 *      （约等于 #777777–#7a7a7a 这一小段）⇒ 这不是"选一个没那么差的"，是**两个都不行**。
 *   B. **焦点环/边框**：主色对界面容器底的对比必须 ≥ **3:1**（非文本）。
 *      ⇒ 主色太深时按钮字色可能很够看（白字 14:1），但**焦点环直接消失在深色界面上**。
 * ------------------------------------------------------------------ */

export interface PrimaryUsability {
  /** 这个主色能不能用（按钮看得见 **且** 焦点环看得见） */
  ok: boolean;
  /** 按钮字色该用哪个（`#101010` / `#ffffff` 里对比度更高的那个） */
  ink: string;
  /** 按钮文字与主色的对比度 */
  inkRatio: number | null;
  /** 主色与界面容器底的对比度（焦点环/边框看得见吗） */
  surfaceRatio: number | null;
  /** 不达标时给用户看的一句（带实测数字，不是"请检查你的颜色"） */
  advice?: string;
  /** 不达标时建议改成的颜色（能算出来就给得出） */
  suggestedPrimary?: string;
}

/** 主色上的按钮字色：两个候选里取对比度更高的那个 */
export function pickPrimaryInk(primary: string): string {
  let best = PRIMARY_INK_CANDIDATES[0] as string;
  let bestRatio = -1;
  for (const ink of PRIMARY_INK_CANDIDATES) {
    const r = contrastRatio(ink, primary) ?? -1;
    if (r > bestRatio) {
      bestRatio = r;
      best = ink;
    }
  }
  return best;
}

/** 判定本体（**不产建议色** —— 建议色要靠二分缩放去试，算建议色时不能再回头调建议色） */
function primaryVerdict(primary: string): {
  ink: string;
  inkRatio: number | null;
  surfaceRatio: number | null;
  inkOk: boolean;
  surfaceOk: boolean;
} {
  const ink = pickPrimaryInk(primary);
  const inkRatio = contrastRatio(ink, primary);
  const surfaceRatio = contrastRatio(primary, PRIMARY_SURFACE);
  return {
    ink,
    inkRatio,
    surfaceRatio,
    inkOk: inkRatio !== null && inkRatio >= CONTRAST_AA_NORMAL,
    surfaceOk: surfaceRatio !== null && surfaceRatio >= CONTRAST_NON_TEXT,
  };
}

/**
 * 判一个主色能不能用，并给出**可读的**理由与建议色。
 *
 * 为什么这道闸门放在**导入侧**而不是 `validateThemePack` 里：
 * `validateThemePack` 管着**启动时加载已保存的样式包**（`App.tsx` 启动时拿它校验已存包），
 * 在那里硬拒绝会把用户**已经存下来**的包静默退回默认包 ⇒ 那是"替用户做决定"。
 * ⇒ 这道闸门只管**新进来的**包（导入 / 选择），已存的老包照旧加载，但界面上要说清它不达标。
 */
export function checkPrimaryUsable(primary: string): PrimaryUsability {
  const v = primaryVerdict(primary);
  if (v.inkOk && v.surfaceOk) {
    return { ok: true, ink: v.ink, inkRatio: v.inkRatio, surfaceRatio: v.surfaceRatio };
  }
  const parts: string[] = [];
  if (!v.surfaceOk) {
    parts.push(
      `主色与界面底色的对比只有 ${v.surfaceRatio === null ? '?' : v.surfaceRatio.toFixed(2)}:1` +
        `（焦点环与边框需要 ${String(CONTRAST_NON_TEXT)}:1）⇒ 这个主色在深色界面上会看不见`,
    );
  }
  if (!v.inkOk) {
    parts.push(
      `主色上的按钮文字对比只有 ${v.inkRatio === null ? '?' : v.inkRatio.toFixed(2)}:1` +
        `（AA 需要 ${String(CONTRAST_AA_NORMAL)}:1）⇒ 这个主色做按钮底色看不清`,
    );
  }
  const suggestedPrimary = suggestUsablePrimary(primary);
  const base = `这个主色用不了：${parts.join('；')}。`;
  return {
    ok: false,
    ink: v.ink,
    inkRatio: v.inkRatio,
    surfaceRatio: v.surfaceRatio,
    advice:
      base +
      (suggestedPrimary === undefined
        ? '请换一个更亮或更暗的主色。'
        : `建议改成 ${suggestedPrimary}（保留原色相的最近可用色）。`),
    ...(suggestedPrimary === undefined ? {} : { suggestedPrimary }),
  };
}

function hexToRgb(hex: string): [number, number, number] | null {
  const full = expandHex(hex);
  if (!full) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function rgbToHex(rgb: readonly [number, number, number]): string {
  return (
    '#' +
    rgb
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
  );
}

/**
 * 给一个**最近可用**的主色（保留原色相：往白或往黑的方向缩放，取改动最小的那一档）。
 *
 * 为什么用"缩放"而不是"直接给默认色"：直接退回默认主色等于替用户改了他的配色；
 * 缩放只动明暗 ⇒ 改完还是他挑的那个色相。
 */
export function suggestUsablePrimary(primary: string): string | undefined {
  const rgb = hexToRgb(primary);
  if (rgb === null) return undefined;
  let best: { t: number; hex: string } | undefined;
  for (const target of [
    [255, 255, 255],
    [0, 0, 0],
  ] as const) {
    for (let step = 1; step <= 100; step += 1) {
      const t = step / 100;
      const mixed: [number, number, number] = [
        rgb[0] + (target[0] - rgb[0]) * t,
        rgb[1] + (target[1] - rgb[1]) * t,
        rgb[2] + (target[2] - rgb[2]) * t,
      ];
      const hex = rgbToHex(mixed);
      const v = primaryVerdict(hex);
      if (v.inkOk && v.surfaceOk) {
        if (best === undefined || t < best.t) best = { t, hex };
        break;
      }
    }
  }
  return best?.hex;
}

/* ------------------------------------------------------------------ *
 * 五、样式包产出的全部受控变量（换包时清残值要用）
 * ------------------------------------------------------------------ */

/**
 * 样式包**可能**产出的全部 `--jj-*` 变量名。
 *
 * 为什么要有这张清单：把变量写到 `:root` 用的是 `setProperty` —— 它**只写不清**。
 * ⇒ 换包时，上一个包留下的变量会**留在 `:root` 上**（今天 `--jj-primary` 是惰性字段，
 * 残留看不出来；一接线，"换包后主色还是上一个包的"立刻变成真的）。
 * ⇒ 换包时必须按这张清单把**这次没定义**的那些**清掉**。
 *
 * ⚠️ 这张清单与 `themePackToCssVars` 的产出**必须对齐**（单测守着：两向都查）。
 */
export const THEME_PACK_VAR_KEYS = [
  '--jj-bubble-radius',
  '--jj-bubble-border-width',
  '--jj-bubble-max-width',
  '--jj-density-gap',
  '--jj-bg-kind',
  '--jj-bg-color',
  '--jj-bg-from',
  '--jj-bg-to',
  '--jj-bg-opacity',
  '--jj-bg-blur',
  '--jj-bg-image',
  '--jj-primary',
  '--jj-primary-ink',
] as const;

/** 把样式包渲染为 CSS 变量（**只产出受控变量，不产出任意 CSS 文本**） */
export function themePackToCssVars(pack: ThemePack): Record<string, string> {
  const vars: Record<string, string> = {
    '--jj-bubble-radius': `${pack.dialog.radiusPx}px`,
    '--jj-bubble-border-width': `${pack.dialog.borderWidthPx}px`,
    '--jj-bubble-max-width': `${pack.dialog.maxBubbleWidthPct}%`,
    '--jj-density-gap': pack.dialog.density === 'compact' ? '6px' : '12px',
    '--jj-bg-kind': pack.background.kind,
  };
  if (pack.background.color) vars['--jj-bg-color'] = pack.background.color;
  if (pack.background.from) vars['--jj-bg-from'] = pack.background.from;
  if (pack.background.to) vars['--jj-bg-to'] = pack.background.to;
  if (pack.background.opacity !== undefined) vars['--jj-bg-opacity'] = String(pack.background.opacity);
  if (pack.background.blurPx !== undefined) vars['--jj-bg-blur'] = `${pack.background.blurPx}px`;
  // 图片路径经 SAFE_IMAGE 校验，且**用 url() 的唯一位置**（不允许用户自行拼 url()）
  if (pack.background.imageUrl) vars['--jj-bg-image'] = `url("${pack.background.imageUrl}")`;
  if (pack.primary) {
    vars['--jj-primary'] = pack.primary;
    // **按钮字色跟着主色走**（T79）：固定字色（#101010）碰上深主色时对比度可低到 1:1（按钮看不见）。
    // ⇒ 这里给的是"两个候选里更好的那个"，能不能用由 `checkPrimaryUsable` 判（导入侧闸门）。
    vars['--jj-primary-ink'] = pickPrimaryInk(pack.primary);
  }
  return vars;
}

/**
 * 把「部分覆盖」合并进一个基准样式包，并**重新走一遍校验**。
 *
 * 为什么需要它：用户改的往往只是一两项（比如只换个背景色），
 * 不该逼他提供完整样式包；但合并结果**必须重新过校验**——
 * 否则拼接过程本身就是绕过受控字段的缺口。
 */
export function mergePackOverrides(
  base: ThemePack,
  overrides: { dialog?: Partial<DialogStyle> | undefined; background?: Partial<BackgroundSpec> | undefined },
): ValidationResult {
  const merged = {
    ...base,
    dialog: { ...base.dialog, ...(overrides.dialog ?? {}) },
    background: { ...base.background, ...(overrides.background ?? {}) },
  };
  return validateThemePack(merged);
}
