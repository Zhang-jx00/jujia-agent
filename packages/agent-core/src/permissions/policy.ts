import type { ToolKind } from '../tools/types';
import { eightDot3Segment } from './short-name';
import { matchRules, type PermissionRule } from './rules';

/**
 * 权限策略层（W5）。
 *
 * 为什么需要它（2026-09-18 联网核实后的设计调整）：
 * 业界已从「一刀切问/不问」转向**按爆炸半径分级**。核实到的结论（来源见文末）：
 * - 「处处都问」等于没问——审查者会橡皮图章式地点允许（审批疲劳）；
 * - 「一律不问」是事故的来源；
 * - 正确做法：**按参数而非仅按工具名分级**——同一个 `write_file`，
 *   写到工作区内的普通文件可以放行，写到敏感路径必须问；
 * - 只读且可逆的调用（read / list / search）不应打扰用户；
 * - `plan` 模式只读，`dontAsk` 模式「拒绝而不问」，`bypassPermissions` 危险需显式开启。
 *
 * 本模块是**纯函数**：输入模式与调用上下文，输出「放行 / 询问 / 拒绝」，可单测、无副作用。
 */

/**
 * 权限模式清单（**唯一来源**）。
 *
 * 为什么用 `as const` 数组再推导类型：`shared-ipc` 里有一份**独立定义**的 zod 枚举
 * （那个包刻意不依赖 agent-core，见其 `contracts.ts` 的说明）。
 * 两个包各自定义是设计选择，但**成员必须完全一致** —— 靠 `policy-consistency.test.ts`
 * 的一致性锁保证，而不是靠人记得同步（此前正是"两处各写一份、谁也不知道有没有漂"）。
 */
export const PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'plan',
  'dontAsk',
  'bypassPermissions',
] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export type RiskLevel = 'low' | 'medium' | 'high';

/**
 * `ask` 分两种（2026-09-23 补）：
 *
 * - **软 ask（`bypassable: true`）**：默认的"写文件要不要做"。用户可以选「本次会话总是允许」把它压掉 ——
 *   因为同一工具的写操作风险差异由**敏感路径**那条硬 ask 兜住。
 * - **硬 ask（`bypassable: false`）**：**任何"总是允许"都压不掉**，必须每次都过人手（或由钩子/规则决定）：
 *   命中高危清单 · 命中用户自己写的 `ask` 规则 · 目标是敏感路径 · **执行类命令**。
 *
 * 为什么执行类也算硬 ask：`alwaysAllow` 是按**工具名**记的，而"总是允许 run_command"等于
 * 把**任意命令**永久放行 —— 那不是省事，那是把权限门拆了。真要全放行请用 `bypassPermissions`
 * 或写一条显式规则，那样至少是**看得见、写下来的决定**。
 *
 * 为什么硬 ask 还要保留钩子：`PermissionRequest` 钩子是用户自己写的审批程序，
 * 它不能被界面上的一个"总是允许"按钮连带废掉。
 */
export type GateDecision =
  | { action: 'allow'; reason: string; risk: RiskLevel }
  | { action: 'ask'; reason: string; risk: RiskLevel; bypassable: boolean }
  | { action: 'deny'; reason: string; risk: RiskLevel };

export interface GateContext {
  mode: PermissionMode;
  toolName: string;
  kind: ToolKind;
  /** 已校验的入参（路径均已过 path-guard；此处只看语义风险） */
  args: Record<string, unknown>;
  /** 需要「无论什么模式都要问」的工具名（高危清单，可由用户配置） */
  alwaysAsk?: ReadonlyArray<string>;
  /** 覆盖写入（目标已存在）时为 true；用于把「覆盖」判为更高风险 */
  isOverwrite?: boolean;
  /**
   * 用户自定义规则（W5c）。**优先于模式**，但三个动作的效力不同：
   * - `deny` / `ask` 绝对生效（连 bypassPermissions 也要让路）；
   * - `allow` 只在本会话没有更严格意图（plan / dontAsk）时生效。
   */
  rules?: ReadonlyArray<PermissionRule>;
  /**
   * 本次这个工具**自己声明**的命令行参数名（来自 `ToolDefinition.commandArg`，由执行器传入）。
   *
   * 只有一点用处：带命令前缀的规则要知道去哪儿取那条命令行文本。没声明（不传）就意味着
   * 这条工具没有命令行参数 —— 前缀规则一律不参与判定，而不是拿 `undefined` 当空命令去比。
   * 为什么由调用方声明、不在这里读 `args['command']`：那样等于策略层替工具猜参数语义，
   * 猜错的那条 deny 规则会作用在一段根本不是命令的文本上（看着拦住了，其实没有）。
   */
  commandArg?: string;
  /**
   * 工作区根（可选）：只给敏感判定用 —— **8.3 短名兜底只扫"相对根"的那一段**。
   * 缺省时保持全串扫描（旧行为），不知道根是谁的门不受影响。
   */
  workspaceRoot?: string;
}

/** 即使处于 acceptEdits，也不自动放行的敏感路径特征（按参数分级的关键） */
const SENSITIVE_PATH_PATTERNS: ReadonlyArray<{ re: RegExp; why: string }> = [
  { re: /(^|[\\/])\.env(\.|$)/i, why: '环境变量文件常含密钥' },
  { re: /(^|[\\/])\.git([\\/]|$)/i, why: '版本库元数据，误改会破坏仓库' },
  { re: /(^|[\\/])(id_rsa|id_ed25519|\.pem|\.key|\.pfx|\.p12)$/i, why: '私钥类文件' },
  { re: /(^|[\\/])(\.npmrc|\.git-credentials|credentials|\.netrc)$/i, why: '凭据文件' },
  { re: /(^|[\\/])(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i, why: '锁文件，改动影响依赖解析' },
  { re: /(^|[\\/])(\.github[\\/]workflows)([\\/]|$)/i, why: 'CI 配置，改动影响流水线与密钥使用' },
];

function pathOf(args: Record<string, unknown>): string | null {
  const p = args['path'];
  return typeof p === 'string' ? p : null;
}

/**
 * 本次调用的命令行文本 —— **只有工具自己声明了 `commandArg` 才取得到**（M4 收尾）。
 * 取不到就返回 undefined，让带前缀的规则一律不命中。
 */
function commandOf(ctx: GateContext): string | undefined {
  if (ctx.commandArg === undefined) return undefined;
  const raw = ctx.args[ctx.commandArg];
  return typeof raw === 'string' ? raw : undefined;
}

/** 盘符前缀（`C:`）里的冒号不是数据流分隔符，判断 ADS 之前要先剥掉 */
const DRIVE_PREFIX = /^[a-zA-Z]:[\\/]/;

/**
 * 把 NTFS 路径拆成「宿主文件」与「流名」。
 *
 * 为什么要拆：`.env:$DATA` 的冒号会让 `\.env(\.|$)` 这类**带结尾锚点**的模式失配，
 * 而它落在 `.env` **这个文件对象**上（NTFS 的一个文件可挂多条数据流）——
 * 不剥离就等于给敏感清单开了一条"加后缀"的旁路（实测见复核 034 的 E-1）。
 */
function splitAds(target: string): { host: string; stream: string | null } {
  const offset = DRIVE_PREFIX.test(target) ? 2 : 0;
  const body = target.slice(offset);
  const idx = body.indexOf(':');
  if (idx < 0) return { host: target, stream: null };
  return { host: target.slice(0, offset + idx), stream: body.slice(idx + 1) };
}

/**
 * 该路径是否属于「必须人工确认」的敏感目标。
 *
 * `workspaceRoot` 只有一个用处：**8.3 短名兜底只扫"相对根"的那一段**（见下）。
 * 不传（旧调用点 / 没有工作区概念的门）时保持全串扫描，行为与从前一致。
 */
export function sensitiveReason(target: string, workspaceRoot?: string): string | null {
  const { host, stream } = splitAds(target);
  for (const { re, why } of SENSITIVE_PATH_PATTERNS) {
    // 按**宿主名**匹配，而不是按整串匹配（外部审查 T2）
    if (re.test(host)) return why;
  }
  /**
   * 清单没命中，但路径里有 8.3 短名形态：**按敏感对待**。
   *
   * 为什么这条必须存在（外部审查 T16，机理实测）：`.git` 在这类卷上就是 `GIT~1`、
   * `.env` 就是 `ENV~1`，写的还是同一个文件；而上面那张清单是纯词法正则，
   * `realpath` 又不展开短名 —— 于是换一个写法就能让清单失配、变成"不问就读"。
   * 与下面"带流名"是同一条推理：**认不出来就归到要问的一侧**（fail closed，但不是拒绝）。
   *
   * **只看"相对根"的那一段（CI 首跑逼出来的修正）**：GitHub 托管机上临时目录是
   * `C:\Users\RUNNER~1\AppData\...` —— 全串扫描会把**根下每一个文件**都判成敏感，
   * 于是"读自己的临时文件"也要问（executor 三例在 CI 全红；本机用户没有短名别名，永远绿）。
   * 别名攻击改的是"被匹配名字"的写法，那段**必然在根之下**；根自己的前缀叫 RUNNER~1
   * 不构成任何绕过。根之外的路径保持全串扫描（保守不变）。
   */
  const scanned = relToRoot(host, workspaceRoot);
  const short = eightDot3Segment(scanned);
  if (short !== null) {
    return `路径含 8.3 短名形态（${short}），敏感名清单按字面匹配会被绕开`;
  }
  // 清单没命中，但路径带流名：流内容可以远大于"文件名看起来是什么"，
  // 而且这里到底是不是 ADS 取决于文件系统 —— 不确定就归到要问的一侧（fail closed）
  if (stream !== null) return '路径含冒号（NTFS 备用数据流形态），流名不构成独立文件';
  return null;
}

/**
 * `host` 相对 `root` 的那一段；不在根之下（或没有根）时返回**原串**。
 * 大小写不敏感（Windows 语义）；边界按目录分隔符判 —— `ws2` 不是 `ws` 之下。
 */
function relToRoot(host: string, root: string | undefined): string {
  if (root === undefined || root === '') return host;
  const h = host.replace(/\//g, '\\').toLowerCase();
  const r = root.replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '');
  if (!h.startsWith(r)) return host;
  const rest = h.slice(r.length);
  if (rest !== '' && rest !== '\\' && !rest.startsWith('\\')) return host; // 前缀发生在文件名中间：不算在根下
  // 按原串切（长度与 toLowerCase 一一对应，切片后保留原大小写）
  return host.slice(r.length);
}

/**
 * 分级判定：返回放行 / 询问 / 拒绝。
 *
 * 决策顺序（越靠前的规则越优先，便于用户理解与测试）：
 * 0. **用户规则**（W5c）：deny / ask 绝对生效；allow 在 plan / dontAsk 下让位于会话意图
 *    （规则可以再窄到**命令前缀**，但前缀只用于收紧，且工具必须声明 `commandArg`）
 * 1. 高危清单命中 → 询问（任何模式、任何副作用等级都问，**含只读**）
 * 2. bypassPermissions → 放行（附风险提示）
 * 3. plan / dontAsk → 拒绝写与执行（只读仍继续往下走：plan 模式的全部用途就是读）
 * 4. **敏感目标 → 硬 ask**（dontAsk 下直接拒绝，因为它不提供询问机会）
 * 5. 只读且可逆 → 放行（不打扰）
 * 6. acceptEdits 且是工作区内、非敏感的写 → 放行
 * 7. 其余写 → 软 ask；执行 → 硬 ask
 *
 * **第 4 条为什么必须在第 5 条之前（2026-09-27 外部审查 T1，严重）**：
 * 原来"只读放行"排在最前面，于是 `read_file` 读 `.env`、`id_rsa`、`.git-credentials`
 * 全部静默通过 —— 密钥直接进模型上下文，而模型有外发能力（打开外部程序、执行命令、发请求）。
 * "只读"防的是**改坏磁盘**，防不了**把东西读出去**，所以敏感路径必须与副作用等级**正交**：
 * 它是"这个东西能不能被看见"的判断，不是"能不能被改动"的判断。
 * 同一条重排顺带修好了高危清单：它以前也排在只读放行之后，对只读工具同样是死代码。
 *
 * 唯一的两个让路口径与旧版一致：用户自己写下的 `allow` 规则、以及显式开启的 `bypassPermissions` ——
 * 二者都是**看得见、写下来**的决定，不在这里偷偷推翻它们（真要收紧就在规则表里别写 allow）。
 *
 * **W10g 起本函数才真正接入执行路径**：此前它只被自己的测试调用，
 * 执行器只按 `tool.kind` 询问 —— 也就是说模式、敏感路径、高危清单在运行时全是死代码。
 * 这个缺陷由复核 010 的接线检查发现并修复。
 */
export function decideGate(ctx: GateContext): GateDecision {
  const target = pathOf(ctx.args);

  // 0) 用户规则：优先于模式（见 GateContext.rules 的说明）
  //    带命令前缀的规则要多看一眼本次命令行（见 GateContext.commandArg）
  const matched = ctx.rules ? matchRules(ctx.rules, ctx.toolName, commandOf(ctx)) : null;
  if (matched?.action === 'deny') {
    return { action: 'deny', reason: matched.reason, risk: 'high' };
  }
  if (matched?.action === 'ask') {
    // 用户自己写下的 ask 规则：**硬 ask**，不被「总是允许」抑制
    return { action: 'ask', reason: matched.reason, risk: 'high', bypassable: false };
  }
  if (matched?.action === 'allow' && ctx.mode !== 'plan' && ctx.mode !== 'dontAsk') {
    return { action: 'allow', reason: matched.reason, risk: 'low' };
  }

  // 1) 高危清单：无论模式与副作用等级如何都要人来确认（含只读工具）
  if (ctx.alwaysAsk?.includes(ctx.toolName)) {
    return {
      action: 'ask',
      reason: `${ctx.toolName} 在高危清单中，需人工确认`,
      risk: 'high',
      bypassable: false,
    };
  }

  // 2) 显式放行模式
  if (ctx.mode === 'bypassPermissions') {
    return {
      action: 'allow',
      reason: '当前为 bypassPermissions 模式（全部放行），请确认你处于可信沙箱内',
      risk: 'high',
    };
  }

  // 3) 只读类模式：写与执行一律拒绝。只读**不在这里拒** —— plan 模式就是要让人读着规划
  if (ctx.kind !== 'read' && (ctx.mode === 'plan' || ctx.mode === 'dontAsk')) {
    const modeName = ctx.mode === 'plan' ? '计划（只读）' : 'dontAsk（拒绝而不询问）';
    return {
      action: 'deny',
      reason: `当前为${modeName}模式，不允许${ctx.kind === 'write' ? '写入' : '执行命令'}`,
      risk: 'medium',
    };
  }

  // 4) 敏感目标：**先问再说**，acceptEdits 也一样（按参数分级）。
  //    这一条排在只读放行之前，所以 `read_file` 读 `.env` 现在会弹硬确认（T1 的修复点，变异 M26）
  if (target !== null) {
    const why = sensitiveReason(target, ctx.workspaceRoot);
    if (why !== null) {
      if (ctx.mode === 'dontAsk') {
        // 文案是批复点名的（2026-09-27 复核 034 的 R-6）：必须说清**这次没发生**，
        // 而不是让用户或模型读成"先跳过了，回头再补" —— 后者会诱发"那我再等等"或重试同一操作。
        return {
          action: 'deny',
          reason: `敏感路径读取被直接拒绝，不是被跳过（${why}）；dontAsk 模式不提供询问机会`,
          risk: 'high',
        };
      }
      return {
        action: 'ask',
        reason: `目标是敏感路径（${why}），需人工确认`,
        risk: 'high',
        bypassable: false,
      };
    }
  }

  // 5) 只读且可逆：到这里才不打扰用户
  if (ctx.kind === 'read') {
    return { action: 'allow', reason: '只读操作，不修改任何状态', risk: 'low' };
  }

  if (ctx.mode === 'acceptEdits' && ctx.kind === 'write') {
    return {
      action: 'allow',
      reason: ctx.isOverwrite ? 'acceptEdits 模式：覆盖工作区内文件' : 'acceptEdits 模式：写入工作区内文件',
      risk: ctx.isOverwrite ? 'medium' : 'low',
    };
  }

  // 6) 默认：写与执行都要问
  if (ctx.kind === 'write') {
    return {
      action: 'ask',
      reason: ctx.isOverwrite ? '覆盖已有文件，需确认' : '写入文件，需确认',
      risk: ctx.isOverwrite ? 'medium' : 'low',
      // 软 ask：同一工具的写操作风险差异由上面那条**敏感路径**硬 ask 兜住
      bypassable: true,
    };
  }
  // 执行类：**硬 ask**。按工具名记住「总是允许」等于放行**任意命令** ——
  // 那不是省事，那是把权限门拆了；真要全放行请用 bypassPermissions 或写一条显式规则。
  return { action: 'ask', reason: '执行命令，需确认', risk: 'high', bypassable: false };
}

/*
 * 已删除（轨道回归计划 2 · R-04/R-05，2026-09-23）：
 *
 * - `MODE_LABEL`：界面文案放错了地方（本模块自称纯函数层），且**没有任何生产调用方**
 *   —— 渲染层自己有一份并且用的是它。死导出只会让人以为"改了这里就改了界面"。
 * - `fatigueHint`：审批疲劳提示**从未接线**（没有任何调用方）。审计把它记为"防护缺失"，
 *   但如实判断是：疲劳的缓解已由**硬/软 ask 分级**（执行类每次必问、普通写可「总是允许」）
 *   与"只读不打扰"承担；再挂一个没人调用的提示函数不是防护，是**看起来有防护**。
 *   若将来要真做，应做在审批弹窗里（需要 main 侧记录连续批准次数），并配测试。
 *   → 已登记到 `docs/TRACK-ROADMAP.md`，需要时按那条做，而不是留个死函数假装做了。
 */
