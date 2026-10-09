/**
 * 工具层通用类型（agent-core，无 Electron 依赖）。
 *
 * 设计原则（对齐 PLAN §3.5 / §7 风险 4「权限/路径事故」）：
 * 1. 工具的**副作用等级**是定义的一部分（read / write / exec），执行前据此决定是否需要用户授权；
 * 2. 工具不做「自己判断要不要问」，一律交给执行器统一的权限门；
 * 3. 每次执行都产出**证据**（耗时、字节数、被改路径），供 UI 展示与后续验收用。
 */

/** 副作用等级：只读 / 写盘 / 执行命令 */
export type ToolKind = 'read' | 'write' | 'exec';

export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition<TArgs = Record<string, unknown>> {
  name: string;
  description: string;
  kind: ToolKind;
  /**
   * 哪一条入参是**命令行文本**（值就是属性名，如 `'command'`）。
   *
   * 这是"工具自己声明参数语义"这件事的落点（M4 收尾）：权限规则里的命令前缀
   * 只认声明过的工具，不声明 = 这条工具没有命令行参数 = 前缀规则一律不参与判定。
   * 为什么必须声明而不能由策略层去猜 `args.command`：猜错一次，
   * 用户写的 `deny` 就作用在一段根本不是命令的文本上 —— 看起来拦住了，其实没有。
   */
  commandArg?: string;
  /** 给模型的 JSON Schema（OpenAI tools[].function.parameters） */
  parameters: ToolParameterSchema;
  /** 入参校验与收窄（通常用 zod），失败即拒绝执行 */
  parse: (raw: unknown) => TArgs;
  /** 真正干活；必须使用由 path-guard 解析后的绝对路径 */
  run: (args: TArgs, ctx: ToolContext) => Promise<ToolOutcome>;
}

/**
 * 存储用的工具形态：泛型被擦除，便于把不同入参类型的工具放进同一个注册表。
 *
 * 为什么 run 的入参是 `never`：`ToolDefinition<{path: string}>.run` 只有写成
 * 「接受更窄入参」的形式才能安全地赋给统一类型（参数逆变）。执行器在调用前
 * 已经过 `parse` 校验，因此此处一次性收窄是可接受的、也是唯一安全的做法。
 */
export interface StoredTool {
  name: string;
  description: string;
  kind: ToolKind;
  /** 与 `ToolDefinition.commandArg` 同义（泛型擦除后仍要保留：权限门靠它） */
  commandArg?: string;
  parameters: ToolParameterSchema;
  parse: (raw: unknown) => unknown;
  run: (args: never, ctx: ToolContext) => Promise<ToolOutcome>;
}

export interface ToolContext {
  /** 工作区根目录（绝对路径）。所有路径操作必须落在其内部 */
  workspaceRoot: string;
  signal?: AbortSignal;
}

/** 工具执行结果：给模型看的是 content，给用户看的是 evidence */
export interface ToolOutcome {
  ok: boolean;
  /** 回传给模型的文本（失败时是错误说明，供模型自我纠正） */
  content: string;
  /** 结构化证据，供 UI 展示（不喂给模型） */
  evidence?: {
    bytes?: number;
    /** 本次实际读写的绝对路径 */
    paths?: string[];
    durationMs?: number;
    /** 截断说明（内容被裁剪时必须如实告知，不能假装完整） */
    truncated?: boolean;
  };
}

export interface ToolErrorLike {
  code: 'path_denied' | 'not_found' | 'invalid_args' | 'io_error' | 'aborted' | 'too_large';
  message: string;
}

/** 统一的工具异常：执行器据此区分「拒绝/失败原因」，不做字符串匹配 */
export class ToolError extends Error implements ToolErrorLike {
  constructor(
    readonly code: ToolErrorLike['code'],
    message: string,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}
