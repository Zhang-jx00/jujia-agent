/**
 * 接线行为锁（复核 009 建立，R-12 拆分后扩到全部 ipc 文件）。
 *
 * 为什么用"扫源码"这种形式：D2 是一个**接线缺陷**，不是函数逻辑缺陷 ——
 * 它表现为「两个调用点各自 createDefaultRegistry()，于是 MCP 批准后的工具注册到 A 表、
 * 执行时去 B 表里查，永远查不到」。这类缺陷用普通单测抓不到（要起 Electron + 真 IPC），
 * 但它有一个非常明确的**不变量**：全进程只允许存在一个注册表创建点，
 * 且这个实例必须同时供给「工具执行」与「对话链路」。
 *
 * **R-12 的关键一条**：拆分之后，只看 ipc.ts 就等于什么都没锁 ——
 * 装配根只剩几行 import 与调用，真正的 handler 分散在 ipc/ 下十个模块里。
 * 所以扫描范围 = 装配根 + 全部 ipc 模块，且新增两条只有拆分后才需要的锁：
 *   ① 每一条通道都必须被注册（漏注册 = 能力表标 ✅ 但运行期不可达，就是 F-1/F-2 那一类）；
 *   ② 每个 register*Ipc 模块都必须被装配根调用（写了模块忘了挂 = 静默死代码）。
 *
 * **这两条锁的覆盖边界（所有者与复核方 2026-09-24 明确要求的口径，不得往大里理解）**：
 *   已覆盖 —— ① handler 模块写了但装配根没调用（变异 M16 直接命中装配锁）；
 *             ② channels.ts 里声明了通道却没有任何注册点（同一变异被通道覆盖锁独立抓住）。
 *     这两类已经从"靠人记得"变成"漏了必红"。
 *   **未覆盖** —— ③ **注册了但绑错通道**（A 通道绑了 B 的 handler）：两条锁都只验证"有没有注册"，
 *             不验证绑定的正确性 —— 正确性由 e2e 的行为断言兜（每条能力都有真实 IPC 往返 + 磁盘/运行时真值）；
 *          ④ **5 条纯推送通道的漏发**：它们被显式豁免（主进程单向发出，没有注册点可查），
 *             豁免即盲区，目前由 STATE_CHANGED 一类的推送路径测试间接覆盖。
 *   被高估的覆盖比没有覆盖更危险：改这个文件时若以为"绑定错了也会红"，那是错的。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { IPC } from '@jujia/shared-ipc';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

/**
 * 装配根 + 全部 ipc 模块。
 *
 * **`ipc/` 下现扫**（不再写死清单）：写死的话，新增一个模块就静默离开扫描范围 ——
 * "每一条通道都被注册"那条锁会**照样绿**，而新模块里的通道其实没被检查。
 * M19 加 `ipc/pdf.ts` 时当场踩到（PDF_OPEN 没被注册却只报"缺一条"，看着像漏注册、
 * 实际是锁没扫到那个文件）。顺序不再参与任何断言，所以按名字排序即可。
 */
const IPC_FILES: readonly string[] = [
  './ipc.ts',
  ...readdirSync(new URL('./ipc/', import.meta.url))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort()
    .map((f) => `./ipc/${f}`),
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const rawOf = (rel: string): string => read(rel);
const strippedOf = (rel: string): string => stripComments(read(rel));
const unionRaw = IPC_FILES.map(rawOf).join('\n');
const union = IPC_FILES.map(strippedOf).join('\n');
const context = strippedOf('./ipc/context.ts');
const tools = strippedOf('./ipc/tools.ts');
const chat = strippedOf('./ipc/chat.ts');
const core = strippedOf('./ipc/core.ts');

/** 窗口关闭必须收尾挂起的审批（轨道回归计划 2 · R-03） */
const indexSource = stripComments(read('./index.ts'));

describe('拆分本身：装配范围不许失焦', () => {
  it('ipc/ 下每个模块都被装配根调用（写了模块忘了挂 = 静默死代码）', () => {
    const registrars = IPC_FILES.filter((f) => f !== './ipc.ts')
      .flatMap((f) => [...read(f).matchAll(/export function (register\w+Ipc)\b/g)].map((m) => m[1] ?? ''))
      .filter((n) => n !== '');
    expect(registrars.length).toBeGreaterThanOrEqual(9);
    for (const name of registrars) {
      expect(unionRaw).toContain(`${name}(ctx)`);
    }
  });

  it('全仓只有一处裸 ipcMain.handle（除 index.ts 里那条 perf 打点通道，它不走业务面）', () => {
    const bare = union.match(/ipcMain\.handle\(/g) ?? [];
    expect(bare.length).toBe(1);
    expect(strippedOf('./ipc/handle.ts')).toContain('ipcMain.handle(');
    for (const f of IPC_FILES.filter((x) => x !== './ipc/handle.ts')) {
      expect(strippedOf(f)).not.toContain('ipcMain.handle(');
    }
    // 发送方校验只能存在于 handle.ts —— 别的地方各写一遍就会开始漏
    expect(strippedOf('./ipc/handle.ts')).toContain('isTrustedSenderUrl(');
    expect(strippedOf('./ipc/handle.ts')).toContain('event.senderFrame?.url');
  });

  it('每一条 IPC 通道都被注册（推送型通道除外，它们由主进程单向发出）', () => {
    const pushOnly = new Set([
      'PERMISSION_REQUEST',
      'PERMISSION_EXPIRED',
      'CHAT_STREAM',
      'TERMINAL_STREAM',
      'MCP_STATE_CHANGED',
      'BROWSER_STATE_CHANGED',
    ]);
    // 覆盖检查把 index.ts 也算进来：PERF_FIRST_PAINT 是**启动打点**通道，
    // 必须在 handler 装配之前就绑上（晚绑会把首帧漏掉），所以它不在 ipc/ 模块里。
    const coverage = `${union}\n${indexSource}`;
    const missing = Object.keys(IPC)
      .filter((k) => !pushOnly.has(k))
      .filter((k) => !coverage.includes(`IPC.${k},`) && !coverage.includes(`IPC.${k})`));
    expect(missing).toEqual([]);
    // 反向：清单确实来自 IPC 常量表，不是我们手写的名字
    expect(union).toContain('handle(IPC.GIT_COMMIT,');
    expect(union).toContain('handle(IPC.TOOL_RUN,');
  });
});


/**
 * 取一次调用的**整个实参体**（按括号配对扫，不按"固定长度 + 遇到 `);` 就切"）。
 *
 * 为什么要换掉原来的写法：老写法是 `slice(from, from+1200).split(');')[0]` ——
 * 一旦调用体里出现任何嵌套的 `);`（比如新加一个回调参数），它就在中间断掉，
 * 后面的断言全部看不到真实内容，锁会**因为功能增长而红**（本轮加执行审计出口时正是这样）。
 * 本项目已经记过这条："枚举现状的锁一律现扫、不写死清单"；窗口长度也是同一种写死的现状。
 */
function callBody(src: string, marker: string): string {
  const from = src.indexOf(marker);
  if (from < 0) return '';
  let depth = 0;
  for (let i = from + marker.length - 1; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(from, i + 1);
    }
  }
  return src.slice(from);
}

describe('工具注册表接线（防止各处各建一个）', () => {
  it('全进程只有一个注册表创建点', () => {
    expect(context.split('createDefaultRegistry()').length - 1).toBe(1);
  });

  it('注释里提到旧写法也不会让上面那条断言失效（即注释已被剥掉）', () => {
    // 反向锁：确保 stripComments 真的生效 —— 否则上面那条会被注释淹没
    const raw = rawOf('./ipc/context.ts');
    expect(raw.split('createDefaultRegistry()').length - 1).toBeGreaterThan(1);
    expect(context.split('createDefaultRegistry()').length - 1).toBe(1);
  });

  it('唯一实例被声明为共享常量（不是在使用处现场创建）', () => {
    expect(context).toContain('const registry: ToolRegistry = deps.registry ?? createDefaultRegistry();');
    // 全仓不得有第二个创建点
    expect(union.split('createDefaultRegistry()').length - 1).toBe(1);
  });

  it('工具执行链路用的是共享实例', () => {
    expect(tools).toContain('const tool = registry.get(toolName);');
    expect(tools).not.toContain('createDefaultRegistry()');
  });

  it('对话链路也用同一个实例（否则模型看不到 MCP 工具）', () => {
    // 在 sendMessage(...) 的调用体内查找，而不是死盯某几行文本 ——
    // 参数会随功能增加（例如 W5c 加了 mode/rules），但"传的是共享实例"这个不变量不能变
    const from = chat.indexOf('sendMessage(');
    expect(from).toBeGreaterThan(-1);
    const body = callBody(chat, 'sendMessage(');
    expect(body).toContain('registry,');
    expect(body).not.toContain('createDefaultRegistry()');
  });

  it('对话链路带上权限模式与规则（否则规则表只对 TOOL_RUN 生效）', () => {
    const body = callBody(chat, 'sendMessage(');
    expect(body).toContain('mode: policy.mode');
    expect(body).toContain('rules: policy.rules');
    expect(body).toContain('alwaysAsk: policy.alwaysAsk');
  });

  it('工具执行链路也带上权限模式与规则（否则规则表只对对话生效）', () => {
    const body = callBody(tools, 'runTool(');
    expect(body).toContain('mode: policy.mode');
    expect(body).toContain('rules: policy.rules');
    expect(body).toContain('alwaysAsk: policy.alwaysAsk');
    expect(body).toContain('hooks: hookRunner');
    expect(body).not.toContain('createDefaultRegistry()');
  });

  it('MCP 服务拿到的是同一个实例', () => {
    expect(context).toContain('const mcp = new McpService({\n    registry,');
  });

  it('技能服务被接进对话链路，且清单走同一条系统提示', () => {
    expect(context).toContain('createSkillsService(registry');
    const body = callBody(chat, 'sendMessage(');
    expect(body).toContain('skillCatalogText: skills.catalogText()');
  });

  it('钩子运行器被接进工具执行与对话链路（否则钩子配置等于摆设）', () => {
    expect(tools).toContain('hooks: hookRunner');
    expect(chat).toContain('hooks: hookRunner');
  });

  it('钩子配置在启动时被加载，且走同一个运行器实例', () => {
    expect(context).toContain('hooks.load()');
    expect(union.split('createProcessHookRunner(').length - 1).toBe(1);
    expect(context).toContain('getConfig: () => hooks.getConfig()');
  });

  it('插件贡献的技能目录被接进技能来源，且刷新顺序在对话链路里', () => {
    expect(context).toContain('createPluginsService()');
    expect(context).toContain('plugins.skillSources(workspaceRoot)');
    const refresh = chat.slice(chat.indexOf('await plugins.refresh('), chat.indexOf('await plugins.refresh(') + 220);
    expect(refresh).toContain('skills.refresh(');
  });

  it('手动执行工具前也刷新插件与技能（界面显示的状态必须与真实一致）', () => {
    expect(tools).toContain('await plugins.refresh(');
    expect(tools).toContain('await skills.refresh(');
    // 刷新必须发生在 runTool 之前，否则模型看到的工具清单是旧的
    expect(tools.indexOf('await skills.refresh(')).toBeLessThan(tools.indexOf('runTool('));
  });

  it('渲染层写不了工作区与高危清单（工作区是权限边界）', () => {
    expect(union).not.toContain('clean.workspace = parsed.workspace');
    expect(union).not.toContain('clean.alwaysAskTools');
    expect(tools).toContain('alwaysAsk: policy.alwaysAsk');
  });

  it('插件只读接口存在（贡献物与诊断必须能看见）', () => {
    expect(strippedOf('./ipc/extensions.ts')).toContain('IPC.PLUGINS_GET');
    expect(strippedOf('./ipc/extensions.ts')).toContain('pluginsStateSchema.parse');
  });

  it('MCP / 终端 / 浏览器实例都在退出时释放（不留孤儿进程与 webContents）', () => {
    expect(context).toContain('mcp.disposeAll();');
    expect(strippedOf('./ipc/terminal.ts')).toContain('terminal.disposeAll();');
    expect(strippedOf('./ipc/browser.ts')).toContain('browser.dispose();');
  });
});

describe('R-12 之前的修复仍然有锁', () => {
  it('config 写入**真的调用** pickWritableConfig（而不是自己再写一遍白名单）', () => {
    // 否则 config-write 的单测测的是死代码（双份真相）
    expect(core).toContain('pickWritableConfig(parsed)');
    expect(union).not.toContain('const WRITABLE_CONFIG_KEYS');
  });

  it('窗口 closed 时收尾挂起的审批请求', () => {
    /**
     * 判据是"**这一个处理器体内**有收尾调用"，不是"这行之后某处出现过一次"。
     *
     * 为什么改（本轮实测）：T38 给 render-process-gone 也接了一次 cancelAll，
     * 老写法 `indexOf(cancelAll) > indexOf('win.on('closed'')` 当场变瞎 ——
     * 后面那次顶掉了前面那次的位置，M7（删掉 closed 的收尾）在全量变异里**未被拦住**。
     * 位置型断言只要指向"后面某处"，就会被后加的合法代码养活。
     */
    const closedIdx = indexSource.indexOf("win.on('closed'");
    expect(closedIdx).toBeGreaterThanOrEqual(0);
    const callIdx = indexSource.indexOf('permissionBridge.cancelAll(', closedIdx);
    const nextHandler = indexSource.indexOf('win.', closedIdx + "win.on('closed'".length);
    expect(callIdx).toBeGreaterThan(closedIdx);
    expect(nextHandler === -1 || callIdx < nextHandler).toBe(true);
  });

  /**
   * T38：渲染进程**崩溃**也要收尾（`permission-bridge.ts` 头部契约写了两条，代码只接了一条）。
   *
   * 为什么单独一条锁而不是并进上面那条：这两件事的失败模式一样（挂起的请求空等满 120 秒），
   * 但接线点是两个事件；只盯 `closed` 的话，`render-process-gone` 可以被删掉而门禁全绿。
   * 而且从执行审计的角度看，少了这一接，崩溃会被记成"用户没答" —— **后果盖掉事实**。
   */
  it('渲染进程崩溃时同样收尾挂起的审批（不是只 console.error）', () => {
    const goneIdx = indexSource.indexOf("'render-process-gone'");
    expect(goneIdx).toBeGreaterThan(-1);
    const callIdx = indexSource.indexOf('permissionBridge.cancelAll(', goneIdx);
    const nextCall = indexSource.indexOf('win.', goneIdx + 24);
    expect(callIdx).toBeGreaterThan(goneIdx);
    expect(nextCall === -1 || callIdx < nextCall).toBe(true);
    expect(indexSource.slice(goneIdx, callIdx)).toContain('渲染进程');
  });
});

describe('文件规模（R-12 的验收线：每文件 ≤300 行）', () => {
  it('ipc.ts 与 ipc/ 下每个模块都不超过 300 行', () => {
    const over = IPC_FILES.filter((f) => rawOf(f).split('\n').length > 300);
    expect(over).toEqual([]);
  });
});

describe('T30：CHAT_SEND 的入参必须有契约（上限与文案都收在 shared-ipc 一处）', () => {
  const chatIpc = strippedOf('./ipc/chat.ts');

  it('用 chatSendSchema 校验，手写 typeof 那套已经搬走', () => {
    expect(chatIpc).toContain('chatSendSchema.safeParse(payload ?? {})');
    expect(chatIpc).not.toContain("typeof connectionId !== 'string'");
  });

  it('全空白仍然算空（zod 的 min(1) 只看长度，挡不住三个空格）', () => {
    expect(chatIpc).toContain("text.trim() === ''");
  });
});
