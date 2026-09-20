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
  if (pack.primary) vars['--jj-primary'] = pack.primary;
  return vars;
}
