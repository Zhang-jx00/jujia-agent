/**
 * argv 命令适配与安全检查（共用模块）。
 *
 * 为什么单独成文件：MCP 服务端与生命周期钩子都要"启动一个用户配置的外部进程"，
 * 二者必须遵守**同一套**规则 ——
 * 1. **以 argv 数组传参，绝不拼 shell 字符串**；
 * 2. 命令与参数里出现 shell 元字符一律拒绝（否则 `; rm -rf` 之类会被当作命令的一部分）；
 * 3. 只有 Windows 上的批处理包装器（.cmd/.bat 与 npx/npm/yarn/pnpm）才经 cmd.exe 转一道。
 *
 * 各写一份的后果是两份安全规则会逐渐分叉，最后总有一边漏掉一条。
 */

/** shell 元字符与换行：一旦出现在 command/args 里就拒绝（我们不拼 shell 字符串） */
const SHELL_METACHAR = /[|&;<>`$]|\r|\n/;

/**
 * 这段文本里有没有 shell 元字符。**判据的唯一来源是上面那张表**。
 *
 * 为什么导出给权限规则用（M4 收尾）：命令前缀规则也得分清"这条命令就是前缀那一小段"
 * 和"前缀后面还接了别的东西"。两处若各写一张表，迟早一边多一个字符、另一边少一个 ——
 * 而这里的分叉不是显示错乱，是**一条 deny 规则以为管住了、其实没管住**。
 */
export function containsShellMetachar(text: string): boolean {
  return SHELL_METACHAR.test(text);
}

/**
 * **只有经 `cmd.exe` 那一道才会被解释**的三个字符（T15）：
 * - `%` 变量展开（`%USERPROFILE%` 在命令行被替换成实际值 —— 藏得住内容，也带得进路径）；
 * - `^` 是 cmd 的转义符（能把上面那张表里的字符"洗白"再让 cmd 重新解释一次）；
 * - `!` 在开启延迟展开的 cmd 里同样是展开符。
 *
 * 刻意**不并进上面那张表**： argv 数组直 spawn 时（POSIX 一律如此，Windows 上非批处理包装器也如此）
 * 这三个字符就是普通字面量，一起禁会误伤合法参数（例如 `--format=%Y-%m-%d`）。
 * 判据必须跟着"到底走不走 shell"走 —— 这比"多禁几个字符"看起来更严，实际更准。
 */
const CMD_METACHAR = /[%^!]/;

/**
 * 这条命令会不会经 `cmd.exe` 转一道。**唯一的判据在这里**：
 * `buildArgvCommand` 与 `checkArgvSafety` 都调它。
 * 之前判据长在 `buildArgvCommand` 里面，安全检查看不到它 —— 那正是 T15 能存在的形状：
 * 两个函数各自决定"什么算危险"，久了必分叉（本模块头部说的事，这次轮到我自己踩）。
 */
export function goesThroughCmd(command: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return false;
  // 批处理包装器不能直接 spawn；名字要**整名匹配**，`my-npm-wrapper` 那种不算
  return /\.(cmd|bat)$/i.test(command) || /^(npx|npm|yarn|pnpm)$/i.test(command);
}

/* ------------------------------------------------------------------ *
 * 命令行文本 → 「程序名 + 参数」（R47 · T52 收紧）
 * ------------------------------------------------------------------ */

/**
 * 可执行扩展名（**只认这四个**）。
 *
 * 为什么只认这四个：同一个程序写成 `git` 与 `git.exe` 是**同一件事**
 * （Windows 上 `git` 就是 `git.exe`），而 `my.tool` 里的 `.tool` **不是**扩展名 ——
 * 把它也剥掉的话，一条 `deny my.tool` 会去拦所有 `my` 开头的别的东西（那是**过度拦截**）。
 */
const EXEC_EXTENSIONS = ['.exe', '.com', '.cmd', '.bat'];

/** 路径的最后一段（`C:\a\b\git.exe` → `git.exe`） */
function lastSegment(text: string): string {
  const parts = text.split(/[\\/]/);
  return parts[parts.length - 1] ?? text;
}

/** 这一段文本的最后一段是不是带可执行扩展名 */
export function hasExecExtension(text: string): boolean {
  const last = lastSegment(text);
  const dot = last.lastIndexOf('.');
  if (dot <= 0) return false;
  return EXEC_EXTENSIONS.includes(last.slice(dot).toLowerCase());
}

/** 去掉末尾的可执行扩展名（`git.exe` → `git`；`my.tool` 原样返回） */
export function stripExecExtension(text: string): string {
  const last = lastSegment(text);
  const dot = last.lastIndexOf('.');
  if (dot <= 0) return text;
  if (!EXEC_EXTENSIONS.includes(last.slice(dot).toLowerCase())) return text;
  return text.slice(0, text.length - (last.length - dot));
}

export interface CommandLineParts {
  /** 程序名（原样：可能带引号与路径） */
  program: string;
  /** 程序名之后的参数（按空白切开） */
  args: string[];
}

/**
 * 把一行命令行文本拆成「程序名 + 参数」。
 *
 * 为什么要有这一层（R47 · T52）：命令前缀规则原先比的是**整串字面开头**，
 * 于是 `git.exe push` / `"git" push` / `C:\Program Files\Git\cmd\git.exe push`
 * 三种形态全都绕得开 —— 而用户写下的 `deny git push` 承诺的是"不许推送"。
 * 只比字符串前缀救不了这件事：**要先把"这个命令行跑的是哪个程序"认出来**。
 *
 * 三种形态各自怎么认：
 * 1. **整词被引号包住**（`"git" push`）⇒ 去掉引号就是程序名；
 * 2. **引号跨词**（`"C:\Program Files\Git\cmd\git.exe" push`）⇒ 引号里的整段是程序名；
 * 3. **没引号**（`git.exe push` / `C:\Program Files\Git\cmd\git.exe push`）⇒
 *    程序名是**最早**那个「累加后以可执行扩展名结尾」的词区间 ——
 *    这样带空格的路径（`C:\Program Files\...`）也能认出来，
 *    而不会把路径里的**中间目录**（`Program`）误当成程序名。
 *
 * 认不出来时**不猜**：引号没闭合就退回第一个词，宁可少命中（少命中回落到硬 ask）。
 */
export function splitCommandLine(text: string): CommandLineParts {
  const trimmed = text.trim();
  if (trimmed === '') return { program: '', args: [] };
  const tokens = trimmed.split(/\s+/);
  const first = tokens[0] as string;
  const quote = first[0];

  // ① 整词被引号包住：`"git"` / `'git'`
  if ((quote === '"' || quote === "'") && first.length > 1 && first.endsWith(quote)) {
    return { program: first.slice(1, -1), args: tokens.slice(1) };
  }

  // ② 引号跨词：`"C:\Program Files\Git\cmd\git.exe" push`
  if (quote === '"' || quote === "'") {
    const close = trimmed.indexOf(quote, 1);
    if (close > 0) {
      const rest = trimmed.slice(close + 1).trim();
      return {
        program: trimmed.slice(1, close),
        args: rest === '' ? [] : rest.split(/\s+/),
      };
    }
    // 引号没闭合：退回第一个词（不猜）
    return { program: first, args: tokens.slice(1) };
  }

  // ③ 没引号：程序名可能是一段带空格的路径
  let program = first;
  let end = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const acc = i === 0 ? first : `${program} ${tokens[i] as string}`;
    if (hasExecExtension(acc)) {
      program = acc;
      end = i;
      break;
    }
  }
  return { program, args: tokens.slice(end + 1) };
}

export interface ProgramKey {
  /** 归一化后的完整路径（去引号 / 统一分隔符 / 剥可执行扩展名 / 小写） */
  full: string;
  /** 归一化后的**最后一段**（文件名） */
  base: string;
  /** 原文本里带不带目录 */
  hasPath: boolean;
}

/**
 * 程序名的归一化形式（判定"是不是同一个程序"时用）。
 *
 * 为什么要分 `full` 与 `base` 两份：**两边都带路径时比整条路径**，
 * 只带一边（或都不带）时比**文件名** ——
 * 这样 `deny C:\tools\mytool` 不会去拦 `D:\other\mytool`（过度拦截），
 * 而 `deny git` 仍然拦得住 `C:\...\git.exe`（漏拦）。
 *
 * **引号不在这一层处理** —— 它由 `splitCommandLine` 那一层摘掉（只有它知道引号在哪儿结束）。
 * 两层都摘 = 一层是白摘的（白摘的那层还会让"改坏它"这种变异测不出任何东西）。
 */
export function programKey(program: string): ProgramKey {
  const cleaned = program.replace(/\//g, '\\').toLowerCase();
  const hasPath = cleaned.includes('\\');
  const segs = cleaned.split('\\').filter((s) => s !== '');
  const last = segs.length > 0 ? (segs[segs.length - 1] as string) : cleaned;
  const base = stripExecExtension(last);
  const full = segs.length > 0 ? [...segs.slice(0, -1), base].join('\\') : base;
  return { full, base, hasPath };
}

export interface ArgvSpec {
  file: string;
  args: string[];
}

export interface ArgvCheck {
  ok: boolean;
  errors: string[];
}

/**
 * 校验 command/args 是否安全（不检查是否为空，那是调用方的业务规则）。
 * `platform` 只影响"要不要额外拒 `% ^ !`"这一条 —— 其余判据不分平台。
 */
export function checkArgvSafety(
  command: unknown,
  args: unknown,
  platform: NodeJS.Platform = process.platform,
): ArgvCheck {
  const errors: string[] = [];
  const viaCmd = typeof command === 'string' && goesThroughCmd(command, platform);
  const bad = (s: string): boolean => containsShellMetachar(s) || (viaCmd && CMD_METACHAR.test(s));
  // 拒绝理由要说清"为什么这条路才拒"，否则用户遇到的是一个看不懂的禁令
  const why = viaCmd ? '含 shell 元字符（这条命令会经 cmd.exe，%VAR% 与 ^ 会被解释），已拒绝' : '含 shell 元字符，已拒绝（防止命令注入）';

  if (typeof command === 'string' && bad(command)) {
    errors.push(`command ${why}`);
  }
  if (Array.isArray(args)) {
    for (const a of args) {
      if (typeof a === 'string' && bad(a)) {
        errors.push(`args ${why}：${a.slice(0, 40)}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 把「命令 + 参数数组」翻译成可 spawn 的形式。
 * **不做任何字符串拼接** —— 返回的 args 仍是数组，由 spawn 以 argv 方式传给进程。
 */
export function buildArgvCommand(
  command: string,
  args: ReadonlyArray<string>,
  platform: NodeJS.Platform = process.platform,
): ArgvSpec {
  if (!goesThroughCmd(command, platform)) return { file: command, args: [...args] };
  return { file: 'cmd.exe', args: ['/c', command, ...args] };
}
