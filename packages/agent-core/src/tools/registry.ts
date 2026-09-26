import { FILE_TOOLS } from './builtin/file-tools';
import { EXEC_TOOLS } from './builtin/exec-tool';
import { NOTE_TOOLS } from './builtin/note-tool';
import type { StoredTool } from './types';

/**
 * 工具注册表。
 * 纪律：模型只能调用注册表里的工具；未注册的名字一律拒绝，
 * 不做「模糊匹配」或「猜一个相近的」——那会让路径/权限校验失去意义。
 */
export class ToolRegistry {
  private readonly tools = new Map<string, StoredTool>();

  constructor(defs: ReadonlyArray<StoredTool> = []) {
    for (const def of defs) this.register(def);
  }

  register(def: StoredTool): void {
    if (this.tools.has(def.name)) {
      throw new Error(`工具名重复注册：${def.name}`);
    }
    this.tools.set(def.name, def);
  }

  get(name: string): StoredTool {
    const def = this.tools.get(name);
    if (!def) {
      throw new Error(`未注册的工具：${name}（可用：${this.names().join(', ') || '无'}）`);
    }
    return def;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 移除工具（MCP 服务端断开时使用）。
   *
   * 返回**是否真的移除了**：名字不存在时返回 false，而不是静默"成功"——
   * 否则上层会以为工具已经不可调用，而实际上它还在表里。
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  names(): string[] {
    return [...this.tools.keys()].sort();
  }

  all(): ReadonlyArray<StoredTool> {
    return [...this.tools.values()];
  }

  /** 转换为 OpenAI `tools` 参数（只暴露 name/description/parameters，不泄露内部实现） */
  toOpenAiTools(): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: unknown };
  }> {
    return this.all().map((def) => ({
      type: 'function' as const,
      function: {
        name: def.name,
        description: def.description,
        parameters: def.parameters,
      },
    }));
  }
}

/**
 * 默认注册表：内置文件工具 + 内置命令执行工具（M4）。
 *
 * `run_command` 的 `kind` 是 `'exec'`，权限引擎对执行类一律**硬 ask** ——
 * 也就是说"注册进来"不等于"能自己跑"，每次仍要过人手，且"总是允许"压不掉。
 * 这一条由 `exec-tool.test.ts` 与变异 M13 共同钉住。
 */
export function createDefaultRegistry(): ToolRegistry {
  return new ToolRegistry([...FILE_TOOLS, ...EXEC_TOOLS, ...NOTE_TOOLS]);
}
