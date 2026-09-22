/**
 * 接线行为锁（复核 009）。
 *
 * 为什么用"扫源码"这种形式：D2 是一个**接线缺陷**，不是函数逻辑缺陷 ——
 * 它表现为「两个调用点各自 `createDefaultRegistry()`，于是 MCP 批准后的工具注册到 A 表、
 * 执行时去 B 表里查，永远查不到」。这类缺陷用普通单测抓不到（要起 Electron + 真 IPC），
 * 但它有一个非常明确的**不变量**：全进程只允许存在一个注册表创建点，
 * 且这个实例必须同时供给「工具执行」与「对话链路」。
 *
 * 这正是"行为锁"的用法：把边界固定成清单，边界一动测试就失败。
 * 修改 ipc.ts 时若不小心又写了一个创建点，这里会立刻红。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ipcRaw = readFileSync(fileURLToPath(new URL('./ipc.ts', import.meta.url)), 'utf8');

/**
 * 剥掉注释再做源码扫描。
 *
 * **必须剥**：本文件第一版没剥，结果计数把注释里出现的 `createDefaultRegistry()` 也算进去，
 * 断言在干净基线上直接失败（幸好是"失败"而不是"永真"）。
 * 这与复核 007 里"注释是否计入条目数"的变异是同一类教训 ——
 * 凡是"数某段代码出现几次"的断言，都要先说清楚注释算不算。
 *
 * 只剥块注释与**整行**行注释：不处理字符串里的 `//`（例如 URL），
 * 那种情况用正则剥会误伤代码。这里要数的标识符不会出现在字符串里。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const ipcSource = stripComments(ipcRaw);

describe('工具注册表接线（防止各处各建一个）', () => {
  it('全进程只有一个注册表创建点', () => {
    const hits = ipcSource.split('createDefaultRegistry()').length - 1;
    // 允许出现 1 次：`const registry = deps.registry ?? createDefaultRegistry()`
    expect(hits).toBe(1);
  });

  it('注释里提到旧写法也不会让上面那条断言失效（即注释已被剥掉）', () => {
    // 反向锁：确保 stripComments 真的生效 —— 否则上面那条会被注释淹没
    expect(ipcRaw).toContain('createDefaultRegistry()');
    expect(ipcRaw.split('createDefaultRegistry()').length - 1).toBeGreaterThan(1);
    expect(ipcSource.split('createDefaultRegistry()').length - 1).toBe(1);
  });

  it('唯一实例被声明为共享常量（不是在使用处现场创建）', () => {
    expect(ipcSource).toContain('const registry: ToolRegistry = deps.registry ?? createDefaultRegistry();');
  });

  it('工具执行链路用的是共享实例', () => {
    expect(ipcSource).toContain('const tool = registry.get(toolName);');
    // 不能再出现第二个局部注册表
    expect(ipcSource).not.toContain('const registryUsed');
  });

  it('对话链路也用同一个实例（否则模型看不到 MCP 工具）', () => {
    // 在 sendMessage(...) 的调用体内查找，而不是死盯某几行文本 ——
    // 参数会随功能增加（例如 W5c 加了 mode/rules），但"传的是共享实例"这个不变量不能变
    const from = ipcSource.indexOf('sendMessage(');
    expect(from).toBeGreaterThan(-1);
    const callBody = ipcSource.slice(from, from + 1200).split(');')[0] ?? '';
    expect(callBody).toContain('registry,');
    expect(callBody).not.toContain('createDefaultRegistry()');
  });

  it('对话链路带上权限模式与规则（否则规则表只对 TOOL_RUN 生效）', () => {
    const from = ipcSource.indexOf('sendMessage(');
    const callBody = ipcSource.slice(from, from + 1200).split(');')[0] ?? '';
    expect(callBody).toContain('mode: policy.mode');
    expect(callBody).toContain('rules: policy.rules');
  });

  it('工具执行链路也带上权限模式与规则（否则规则表只对对话生效）', () => {
    const from = ipcSource.indexOf('runTool(');
    expect(from).toBeGreaterThan(-1);
    const callBody = ipcSource.slice(from, from + 900).split(');')[0] ?? '';
    expect(callBody).toContain('mode: policy.mode');
    expect(callBody).toContain('rules: policy.rules');
    expect(callBody).not.toContain('createDefaultRegistry()');
  });

  it('MCP 服务拿到的是同一个实例', () => {
    expect(ipcSource).toContain('const mcp = new McpService({\n    registry,');
  });

  it('技能服务被接进对话链路，且清单走同一条系统提示', () => {
    // 断言共享注册表仍是第一个参数，而不是死盯整行文本 —— 参数会随功能增加
    expect(ipcSource).toContain('createSkillsService(registry');
    expect(ipcSource).toContain('await skills.refresh(');
    const chat = ipcSource.slice(ipcSource.indexOf('sendMessage('), ipcSource.indexOf('sendMessage(') + 1400).split(');')[0] ?? '';
    expect(chat).toContain('skillCatalogText: skills.catalogText()');
  });

  it('钩子运行器被接进工具执行与对话链路（否则钩子配置等于摆设）', () => {
    const toolCall = ipcSource.slice(ipcSource.indexOf('runTool('), ipcSource.indexOf('runTool(') + 900).split(');')[0] ?? '';
    expect(toolCall).toContain('hooks: hookRunner');
    const chat = ipcSource.slice(ipcSource.indexOf('sendMessage('), ipcSource.indexOf('sendMessage(') + 1200).split(');')[0] ?? '';
    expect(chat).toContain('hooks: hookRunner');
  });

  it('钩子配置在启动时被加载，且走同一个运行器实例', () => {
    expect(ipcSource).toContain('hooksService.load()');
    expect(ipcSource.split('createProcessHookRunner(').length - 1).toBe(1);
    expect(ipcSource).toContain('getConfig: () => hooksService.getConfig()');
  });

  it('插件贡献的技能目录被接进技能来源，且刷新顺序在对话链路里', () => {
    expect(ipcSource).toContain('createPluginsService()');
    expect(ipcSource).toContain('plugins.skillSources(workspaceRoot)');
    // 先刷新插件、再刷新技能（否则插件贡献的目录这一轮看不到）
    const refresh = ipcSource.slice(ipcSource.indexOf('await plugins.refresh('), ipcSource.indexOf('await plugins.refresh(') + 220);
    expect(refresh).toContain('await skills.refresh(');
  });

  it('手动执行工具前也刷新插件与技能（界面显示的状态必须与真实一致）', () => {
    // 按通道切出 TOOL_RUN 的整段处理逻辑（刷新发生在 runTool 之前，不能只从 runTool( 开始切）
    const from = ipcSource.indexOf('IPC.TOOL_RUN');
    const to = ipcSource.indexOf('IPC.MCP_SERVER_LIST');
    const region = ipcSource.slice(from, to);
    expect(region).toContain('await plugins.refresh(');
    expect(region).toContain('await skills.refresh(');
    expect(region).toContain('runTool(');
  });

  it('插件只读接口存在（贡献物与诊断必须能看见）', () => {
    expect(ipcSource).toContain('IPC.PLUGINS_GET');
    expect(ipcSource).toContain('pluginsStateSchema.parse');
  });

  it('MCP 服务在应用退出时被释放（不留孤儿进程）', () => {
    expect(ipcSource).toContain('mcp.disposeAll();');
  });
});
