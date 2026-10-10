/**
 * 审计记录的**落盘前剔密**（M4 收尾 · 其二）。
 *
 * 审计文件是"把判定过程抄到另一处磁盘"的动作，抄错就等于凭空多一次泄露：
 * 用户刚写进文件的正文、刚敲进命令的令牌，原本只在那一份该去的地方，
 * 一不留神就被复制进一个没人加密、还会被人点"导出"发出去的日志里。
 * 所以这一层的默认答案是**不抄**：只留能核对"是哪一次、有多长、指纹是什么"的信息。
 *
 * 三条口径：
 * 1. **键名像密钥的，连长度都不写** —— 位数本身就是要保护的信息（`token` 长度能框出密钥规格）。
 * 2. **正文类只写长度与指纹**：`digests` 是值的规范化 JSON 的 sha256 前 12 位，
 *    能回答"审计里那次和现在这份是不是同一个内容"，反过来推不出内容。
 * 3. **路径保留可读形态，但只在工作区内**；工作区外只留末两段 ——
 *    绝对路径会把本机用户名连同目录结构一起抄进第二处磁盘。
 *
 * 判据一律**共用已有的那一张表**（`isSensitiveEnvName` / `stripUrlCredentials`），不在这里另立一套。
 */

import { createHash } from 'node:crypto';
import { isSensitiveEnvName, stripUrlCredentials } from '../terminal/terminal';

/** 一条参数摘要：可核对，不可复现内容 */
export interface ArgSummary {
  /** 出现过的参数名（排序；不含值） */
  keys: string[];
  /** 每个参数值的长度（键名像密钥的**不进这张表**） */
  lengths: Record<string, number>;
  /** 每个参数值的指纹（规范化 JSON 的 sha256 前 12 位） */
  digests: Record<string, string>;
  /** 路径类参数的可读形态（工作区内为相对路径；工作区外为末两段） */
  paths: string[];
  /** 命令类参数：剔密后的原文（过长会截断并写明） */
  command?: string;
  /** 被收敛掉的项与原因（不静默 —— 看得见"这条为什么没内容"） */
  redacted: string[];
}

export interface SummarizeOptions {
  /** 工作区根（绝对路径，用来判断路径能不能原样留在审计里） */
  workspaceRoot?: string | undefined;
  /** 哪个参数是命令行文本（来自工具的 `commandArg` 声明；不声明就没有 command 那一格） */
  commandKey?: string | undefined;
}

/** 路径类参数的名字形态（与 path-guard 那侧一致的几个叫法） */
const PATH_KEY_RE = /(^|[^a-z])(path|dir|folder|cwd|file)$/i;

/** 命令行里"键名=值 / 键名 值"形态的密钥（值取 12 个字符以上才动手，避免把 `Bearer` 这类词误伤） */
const KV_SECRET_RE =
  /([A-Za-z0-9_.-]*(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY|AUTH)[A-Za-z0-9_.-]*)([=:]?\s*)([A-Za-z0-9+/_.-]{12,})/gi;

/** 没有键名可依附的长随机串：一整段、无空格、不含 / 与 . （路径与文件名放过，令牌通常不长成那样） */
const BARE_SECRET_RE = /(?:^|\s)([A-Za-z0-9+/=_-]{32,})(?=\s|$)/g;

/** `Authorization: Bearer xxx` / `Basic xxx` */
const HEADER_SECRET_RE = /((?:Bearer|Basic|Digest)\s+)([A-Za-z0-9+/=_.-]{12,})/gi;

/** 审计里命令行的保留上限：够看清做了什么，不够把一整篇脚本抄进日志 */
const COMMAND_MAX_CHARS = 400;

/** 把文本里的密钥形态换成 `***`，并说清动了哪几处 */
export function maskSecrets(text: string): { text: string; hits: string[] } {
  const hits: string[] = [];
  let out = text;

  out = out.replace(HEADER_SECRET_RE, (_m, prefix: string, _value: string) => {
    hits.push(`头里的 ${String(prefix).trim()}`);
    return `${prefix}***`;
  });
  out = out.replace(KV_SECRET_RE, (_m, key: string, gap: string, _value: string) => {
    hits.push(key);
    return `${key}${gap}***`;
  });
  out = out.replace(BARE_SECRET_RE, (_m, _value: string) => {
    hits.push('一段长随机串');
    return ' *** ';
  });
  // URL 内嵌凭据那条判据与终端环境**共用**（`stripUrlCredentials`），不在这儿重写一遍。
  // 但要按"逐个 URL"来喂它：那条正则锚在串首（它的原始用途是整条 env 值就是一个 URL），
  // 直接把整行命令递过去，`git clone https://user:pass@host` 里那个 `git clone ` 前缀会让它**完全不生效**。
  out = out.replace(/(^|\s)([a-z][a-z0-9+.-]*:\/\/\S+)/gi, (_m, lead: string, url: string) => {
    const stripped = stripUrlCredentials(url);
    if (stripped === url) return `${lead}${url}`;
    hits.push('URL 内嵌凭据');
    return `${lead}${stripped}`;
  });
  return { text: out, hits };
}

/** 规范化序列化：键序固定，于是"同一个值"永远得到同一个指纹 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex').slice(0, 12);
}

function toForwardSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

/** 路径怎么抄才不泄露：工作区内给相对路径，区外只留末两段 */
function pathForm(raw: string, workspaceRoot: string | undefined): { shown: string; outside: boolean } {
  const p = toForwardSlashes(raw);
  if (workspaceRoot !== undefined && workspaceRoot !== '') {
    const root = toForwardSlashes(workspaceRoot).replace(/\/+$/, '');
    if (p.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
      return { shown: p.slice(root.length + 1), outside: false };
    }
  }
  const segments = p.split('/').filter((s) => s !== '');
  return { shown: segments.slice(-2).join('/'), outside: true };
}

/**
 * 把一次调用的入参收成**可以落盘**的摘要。
 * 注意：返回里绝不出现任何参数值的原文（命令那一格除外，且它已经过 `maskSecrets` 与长度上限）。
 */
export function summarizeArgs(raw: unknown, opts: SummarizeOptions): ArgSummary {
  const summary: ArgSummary = { keys: [], lengths: {}, digests: {}, paths: [], redacted: [] };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    summary.redacted.push('入参不是对象，只记形状不记内容');
    return summary;
  }
  const source = raw as Record<string, unknown>;
  const keys = Object.keys(source).sort();
  summary.keys = keys;

  for (const key of keys) {
    const value = source[key];
    if (isSensitiveEnvName(key)) {
      summary.redacted.push(`${key}（键名像密钥：值与长度都不写）`);
      continue;
    }
    const text = canonical(value);
    summary.lengths[key] = typeof value === 'string' ? value.length : text.length;
    summary.digests[key] = digest(value);

    if (typeof value === 'string' && PATH_KEY_RE.test(key)) {
      const form = pathForm(value, opts.workspaceRoot);
      summary.paths.push(form.shown);
      if (form.outside) summary.redacted.push(`${key} 在工作区外，只留末两段`);
    }
    if (opts.commandKey !== undefined && key === opts.commandKey && typeof value === 'string') {
      const masked = maskSecrets(value);
      for (const hit of masked.hits) summary.redacted.push(`命令里剔掉一处：${hit}`);
      summary.command =
        masked.text.length > COMMAND_MAX_CHARS
          ? `${masked.text.slice(0, COMMAND_MAX_CHARS)}…（已截断，原文 ${masked.text.length} 字符）`
          : masked.text;
    }
  }
  return summary;
}
