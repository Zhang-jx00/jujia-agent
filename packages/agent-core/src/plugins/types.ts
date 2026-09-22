/**
 * 插件清单（W11b）：**一个 manifest 打包**技能 + 自定义命令 + MCP 服务端 + 选项默认值。
 *
 * 为什么要有"插件"这一层：技能、命令、MCP 服务端各自都已有独立入口，
 * 但"把一个团队的工作方式整包分发"需要它们**一起装、一起卸、一起带配置**。
 * 插件就是那个包 —— 它不引入新能力，只是把已有能力**打包与变量化**。
 *
 * 三条安全约定（都有对应测试）：
 * 1. **变量只展开 `JUJIA_` 前缀的环境变量** —— 否则插件可以借 `${PATH}`、`${HOME}`
 *    之类把宿主环境读出来塞进配置文件，等于给了一个静默的信息通道。
 * 2. **缺失变量 → 禁用受影响的那个 MCP 服务端并产生诊断**（fail-closed 且可见），
 *    而不是"留个空串照样启动"。
 * 3. **插件不能自带权限** —— 它提供的 MCP 服务端仍然要走连接同意与逐工具批准，
 *    插件只是把"要连什么"替你写好了。
 */

export interface PluginUserConfigOption {
  type: 'string' | 'number' | 'boolean';
  default?: string | number | boolean;
  description?: string;
}

export interface PluginMcpServerConfig {
  /** 目前支持 stdio（command/args/env/cwd）；http/sse 后续再说 */
  type?: 'stdio';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  enabled?: boolean;
  timeoutMs?: number;
}

export interface PluginManifest {
  name: string;
  version?: string;
  description?: string;
  author?: string;
  license?: string;
  /** 技能目录：单个路径或路径数组（相对插件根） */
  skills?: string | string[];
  /** 自定义命令目录（markdown 文件）；本轮只识别、不执行 */
  commands?: string | string[];
  /** 内联 MCP 服务端配置，或指向一个 JSON 文件的相对路径 */
  mcpServers?: Record<string, PluginMcpServerConfig> | string;
  /** 选项默认值：可在变量里用 ${user_config.<key>} 引用 */
  userConfig?: Record<string, PluginUserConfigOption>;
}

export interface PluginDiagnostic {
  /** 插件名（清单解析失败时可能是目录名） */
  plugin: string;
  /** 目录绝对路径（诊断要能定位到文件） */
  dir: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface LoadedPlugin {
  /** 稳定标识：清单里的 name（同名后者覆盖前者，被覆盖的记诊断） */
  name: string;
  dir: string;
  manifest: PluginManifest;
  /** 解析后的技能目录（绝对路径；**只保留真实存在的**） */
  skillsDirs: string[];
  /** 解析后的命令目录（绝对路径；只保留真实存在的） */
  commandsDirs: string[];
  /** 插件声明的 MCP 服务端（变量已展开、缺失变量的已剔除并记诊断） */
  mcpServers: { name: string; config: PluginMcpServerConfig }[];
  /** 该插件自己的诊断（缺失变量等） */
  diagnostics: PluginDiagnostic[];
}

export interface PluginLoadResult {
  plugins: LoadedPlugin[];
  diagnostics: PluginDiagnostic[];
  /** 扫过的插件根目录（便于排查"为什么没加载"） */
  scannedDirs: string[];
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function checkPluginName(name: string): string | null {
  if (name === '') return '插件名不能为空';
  if (name.length > 64) return '插件名过长（最多 64 字符）';
  if (!NAME_RE.test(name)) return '插件名只能用 小写字母/数字/-/_，且以字母或数字开头';
  return null;
}

/** 把 `string | string[]` 归一成数组（清单里两种写法都要支持，别让作者猜） */
export function toStringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}

/**
 * 变量展开。
 *
 * 支持的写法：
 * - `${JUJIA_PLUGIN_ROOT}` —— 插件目录
 * - `${JUJIA_PLUGIN_DATA}` —— 插件数据目录（运行时输出写这里，别写进插件源码目录）
 * - `${JUJIA_PROJECT_DIR}` —— 当前工作区
 * - `${user_config.<key>}` —— 清单里 `userConfig` 的取值（用户配置优先，其次默认值）
 * - `${JUJIA_*}` —— **只展开 JUJIA_ 前缀**的环境变量
 *
 * 返回 `missing`：缺失的变量名列表。**调用方必须据此禁用受影响的服务端**，
 * 而不是拿空串继续 —— 那会让"配置错误"变成"运行时莫名其妙的行为"。
 */
export function expandVariables(
  input: string,
  ctx: {
    pluginRoot: string;
    pluginData: string;
    projectDir: string;
    userConfig: Record<string, string | number | boolean>;
    env?: Record<string, string | undefined>;
  },
): { value: string; missing: string[] } {
  const env = ctx.env ?? (process.env as Record<string, string | undefined>);
  const missing: string[] = [];

  const value = input.replace(/\$\{([^}]+)\}/g, (_all, rawName: string) => {
    const name = rawName.trim();

    if (name === 'JUJIA_PLUGIN_ROOT') return ctx.pluginRoot;
    if (name === 'JUJIA_PLUGIN_DATA') return ctx.pluginData;
    if (name === 'JUJIA_PROJECT_DIR') return ctx.projectDir;

    if (name.startsWith('user_config.')) {
      const key = name.slice('user_config.'.length);
      const v = ctx.userConfig[key];
      if (v === undefined) {
        missing.push(name);
        return '';
      }
      return String(v);
    }

    // **只认 JUJIA_ 前缀**：其它环境变量一律当"缺失"，不给插件读宿主环境的口子
    if (name.startsWith('JUJIA_')) {
      const v = env[name];
      if (v === undefined) {
        missing.push(name);
        return '';
      }
      return v;
    }

    missing.push(name);
    return '';
  });

  return { value, missing };
}

/** 展开一个 MCP 服务端配置里的所有字符串字段；返回缺失变量集合 */
export function expandServerConfig(
  config: PluginMcpServerConfig,
  ctx: Parameters<typeof expandVariables>[1],
): { config: PluginMcpServerConfig; missing: string[] } {
  const missing: string[] = [];
  const run = (text: string): string => {
    const r = expandVariables(text, ctx);
    missing.push(...r.missing);
    return r.value;
  };

  const out: PluginMcpServerConfig = {};
  if (config.type !== undefined) out.type = config.type;
  if (config.command !== undefined) out.command = run(config.command);
  if (config.args !== undefined) out.args = config.args.map(run);
  if (config.cwd !== undefined) out.cwd = run(config.cwd);
  if (config.enabled !== undefined) out.enabled = config.enabled;
  if (config.timeoutMs !== undefined) out.timeoutMs = config.timeoutMs;
  if (config.env !== undefined) {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(config.env)) {
      env[k] = run(v);
    }
    out.env = env;
  }

  return { config: out, missing: [...new Set(missing)] };
}
