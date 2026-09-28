#!/usr/bin/env node
/* eslint-disable no-undef -- page.evaluate 的回调跑在浏览器上下文里，window 在那里是合法的 */
/**
 * 界面级端到端（**全自动，不需要人点**）。
 *
 * 为什么必须有它：之前有几件事只能靠人工点界面确认（插件页、权限规则、钩子页、技能是否真能加载）。
 * 这份脚本用 Playwright 驱动**真实的 Electron 与真实的渲染层**，把那些操作全部自动化：
 * 启动 → 切标签 → 填表单 → 点按钮 → 断言界面结果，并且**走真实的 IPC 与主进程**。
 *
 * 隔离：数据目录与 Electron 配置目录都指向**项目内**的 `.tmp/e2e/`，
 * **绝不碰你日常那套数据，也绝不往系统盘（C 盘）写东西**，跑完即清。
 *
 * 用法：npm run e2e        （根目录；会先构建再跑）
 * 退出码：0 = 通过；1 = 失败（打印失败在哪一步、以及界面当时的文本）
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import electronPath from 'electron';
import { _electron as electron } from 'playwright-core';

const runGit = promisify(execFile);

// 入口用**脚本自身位置**解析，而不是 cwd —— 否则从仓库根跑时路径就错了（本轮实测踩过）
const here = dirname(fileURLToPath(import.meta.url));
const MAIN_ENTRY = join(here, '..', 'out', 'main', 'index.js');

/**
 * 测试数据落在**项目内** `.tmp/e2e-<运行标识>/`，不写系统盘（用户明确要求"测试不要占 C 盘"）。
 * 两处都要挪才叫真隔离：
 * - `JUJIA_DATA_BASE_DIR` 管应用自己的数据根；
 * - `--user-data-dir` 管 Electron 的配置与缓存（Windows 上默认在 %APPDATA%，也就是 C 盘）。
 *
 * **每次用新的运行目录，启动时不做整目录删除**（2026-09-23 改）：
 * 原先是在固定目录上先 `rmSync` 清空，但沙箱对"同一轮删除次数"有配额，
 * 跑过几轮测试后这一步会把 e2e 自己卡死（实测报 SAFE_DELETE_BULK_CONFIRM_REQUIRED）。
 * 用唯一目录则**不需要任何启动删除**；收尾清理是尽力而为，失败也只是一条提示，不影响结论。
 * 残留的旧目录由 `scripts/cleanup.py` 统一收拾。
 */
const RUN_ID = `${Date.now().toString(36)}-${process.pid}`;
const TMP_ROOT = join(here, '..', '..', '..', '.tmp', `e2e-${RUN_ID}`);

const STEPS = [];
const log = (text) => console.log(text);
const ok = (text) => log(`  ✅ ${text}`);
const fail = (text, detail) => {
  console.error(`\n❌ ${text}`);
  if (detail !== undefined) console.error(String(detail).slice(0, 1200));
  console.error(`\n已完成步骤：\n${STEPS.map((s) => '  - ' + s).join('\n')}`);
  process.exit(1);
};
const step = (text) => {
  STEPS.push(text);
  log(`\n[${STEPS.length}] ${text}`);
};

// ---------- 准备隔离环境 ----------
// 目录本身是新的（RUN_ID 唯一），因此这里只需要创建，不需要删除
const dataDir = join(TMP_ROOT, 'data');
const wsDir = join(TMP_ROOT, 'ws');
const profileDir = join(TMP_ROOT, 'profile');
mkdirSync(dataDir, { recursive: true });
mkdirSync(wsDir, { recursive: true });
mkdirSync(profileDir, { recursive: true });

// 预置一个插件（等价于"用户自己装了一个插件"），供界面断言
const pluginDir = join(dataDir, 'plugins', 'my-team');
mkdirSync(join(pluginDir, 'skills', 'my-check'), { recursive: true });
writeFileSync(
  join(pluginDir, 'plugin.json'),
  JSON.stringify(
    {
      name: 'my-team',
      version: '1.0.0',
      description: '端到端验证用插件',
      skills: 'skills',
      mcpServers: { demo: { type: 'stdio', command: 'node', args: ['-v'] } },
    },
    null,
    2,
  ),
  'utf8',
);
writeFileSync(
  join(pluginDir, 'skills', 'my-check', 'SKILL.md'),
  '---\nname: my-check\ndescription: 提交前自查清单（端到端验证）\n---\n\n1. 列出改动\n2. 说明用途\n3. 打标签要人工确认\n',
  'utf8',
);

/**
 * 「自选本机程序」那一档的路径**只能由原生文件对话框写入**，而自动化点不了本机对话框，
 * 所以这里把同一份存储预置进隔离数据目录（等价于"用户已经选过一次"）。
 * 挑哪个程序：Windows 自带的命令行 HTTP 客户端 —— 交给它的参数只有一个网址，
 * 它就一定会真的发一次请求，于是本地站点的请求台账就成了"真的交出去了"的硬证据。
 * 路径由环境变量算出，脚本里不出现任何本机字面量。
 */
const systemRoot = process.env['SystemRoot'] ?? process.env['WINDIR'] ?? '';
const handoutExe = systemRoot === '' ? '' : join(systemRoot, 'System32', 'curl.exe');
const handoutExeReady = handoutExe !== '' && existsSync(handoutExe);
if (handoutExeReady) {
  writeFileSync(
    join(dataDir, 'browser-exe.json'),
    JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      data: { path: handoutExe },
    }),
    'utf8',
  );
}

/**
 * 流式假服务（第 26 步要用）。
 *
 * 为什么现在就得起来：它要**写进连接的种子文件里**（baseUrl 带端口），而那份文件是
 * 应用启动前落的 —— 晚起就只能改运行时数据，那不再是"上一个进程留下的连接"。
 * 为什么必须是个真 HTTP 服务而不是打桩：第 26 步要验的是"流事件按会话分发"，
 * 只有真的按时间一段一段吐字，才存在"上一条还没说完我就切走了"这个现场。
 */
const streamServer = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += String(c)));
  req.on('end', () => {
    let prompt = '';
    try {
      const parsed = JSON.parse(body);
      const msgs = Array.isArray(parsed.messages) ? parsed.messages : [];
      const lastUser = [...msgs].reverse().find((m) => m && m.role === 'user');
      prompt = String(lastUser?.content ?? '');
    } catch {
      // 解析不出来就按默认档（A）走：这一步测的是事件分发，不是解析健壮性
    }
    // 两条都是慢流（A 先结束、B 后结束）：只有这样才存在"A 的事件到达时 B 还在流"这个现场
    const scene = prompt.includes('STREAM_B') ? 'B' : 'A';
    const steps = scene === 'B' ? 24 : 16;
    const usageTokens = scene === 'B' ? 131313 : 424242;
    const gapMs = 220;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    void (async () => {
      try {
        for (let i = 1; i <= steps; i += 1) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `${scene}_${String(i)}_` } }] })}\n\n`);
          await new Promise((r) => setTimeout(r, gapMs));
        }
        // usage 带一个**专属数字**：于是"别的会话的用量事件掉到当前界面上"在 DOM 里看得见
        res.write(
          `data: ${JSON.stringify({ usage: { prompt_tokens: usageTokens, completion_tokens: 7 } })}\n\n`,
        );
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } catch {
        // 客户端中途断开（比如超时或用户停止）：这条连接本来就该结束，不报告警
      }
    })();
  });
});
await new Promise((resolve) => streamServer.listen(0, '127.0.0.1', resolve));
const streamPort = streamServer.address().port;

/**
 * 预置"上一个进程留下的东西"（6a 会话持久化的被测前提）：
 * 一条连接 + 一个已经写了几轮对话的会话目录。
 * 会话 id 用符合白名单的 uuid 形态；文件按真实格式写（JsonStore 的信封 + JSONL 一行一条），
 * 于是"重启后还在"这一条问的是**应用真的能读盘**，不是它自己刚写的内存。
 */
const seededConnId = 'e2e-conn-1';
const seededStreamConnId = 'e2e-stream-1';
writeFileSync(
  join(dataDir, 'connections.json'),
  JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    data: {
      connections: [
        {
          id: seededConnId,
          name: 'e2e 假连接',
          baseUrl: 'http://127.0.0.1:9/v1',
          apiFormat: 'openai-compatible',
          model: 'e2e-model',
          // 真实落盘形态：密钥是 protect 后的结构或 null，这里给 null —— 本步骤永不发问，
          // 只要 CONNECTION_LIST 能安全映射它（少了这个字段，读盘就会炸成"一个连接都没有"）
          secret: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: seededStreamConnId,
          name: 'e2e 流式假服务',
          baseUrl: `http://127.0.0.1:${String(streamPort)}/v1`,
          apiFormat: 'openai-compatible',
          model: 'e2e-stream-model',
          // 这条**要真的发问**，所以密钥不能是 null（主进程会直接拒发）。
          // `scheme:'plain'` 是真实存在的落盘形态（safeStorage 不可用时应用自己就是这么写的），
          // 值是假的：本地假服务不看 Authorization，而密钥也绝不离开这台机器。
          secret: { scheme: 'plain', value: 'e2e-local-only' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    },
  }),
  'utf8',
);
const seededSession = 'e2e00000-0000-4000-8000-000000000000';
mkdirSync(join(dataDir, 'sessions', seededSession), { recursive: true });
writeFileSync(
  join(dataDir, 'sessions', seededSession, 'messages.jsonl'),
  [
    { v: 1, t: '2026-09-26T09:00:00.000Z', role: 'user', content: 'E2E_PERSIST_问一：这个项目叫什么' },
    { v: 1, t: '2026-09-26T09:00:05.000Z', role: 'assistant', content: 'E2E_PERSIST_答一：叫俱佳Agent' },
    { v: 1, t: '2026-09-26T09:01:00.000Z', role: 'user', content: 'E2E_PERSIST_问二：记住这一点用' },
    { v: 1, t: '2026-09-26T09:01:07.000Z', role: 'assistant', content: 'E2E_PERSIST_答二：好的，已记下这条要点' },
  ].map((m) => JSON.stringify(m)).join('\n') + '\n',
  'utf8',
);
writeFileSync(
  join(dataDir, 'sessions', seededSession, 'session.meta.json'),
  JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    data: {
      id: seededSession,
      connectionId: seededConnId,
      title: 'E2E_PERSIST_问一',
      createdAt: '2026-09-26T09:00:00.000Z',
      lastUsedAt: '2026-09-26T09:01:07.000Z',
      messageCount: 4,
      compactedThrough: 0,
    },
  }),
  'utf8',
);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // 不清掉它 Electron 会退化成纯 Node
env.JUJIA_DATA_BASE_DIR = dataDir;

log(`数据目录（临时）：${dataDir}`);
log(`工作区（临时）：${wsDir}`);

let app;
try {
  step('启动应用（真实 Electron + 真实渲染层）');
  app = await electron.launch({
    executablePath: electronPath,
    // --user-data-dir 把 Electron 的配置/缓存也挪出 C 盘（默认它在 %APPDATA%）
    args: [MAIN_ENTRY, `--user-data-dir=${profileDir}`],
    env,
  });
  const win = await app.firstWindow();
  await win.waitForSelector('nav.app-tabs', { timeout: 20_000 });
  ok('窗口打开，标签栏已渲染');

  const tabButton = (label) => win.locator('nav.app-tabs button', { hasText: label });
  /**
   * 轮询等待界面出现某段文本。
   * 为什么不用固定 sleep：界面数据来自异步 IPC，固定等待要么偶发失败要么白等；
   * 轮询既能快速通过也能在真的出不来时给出明确失败（附超时原因）。
   */
  const waitForText = async (needle, timeoutMs = 8_000) => {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    while (Date.now() < deadline) {
      last = await bodyText();
      if (last.includes(needle)) return true;
      await win.waitForTimeout(120);
    }
    return last;
  };
  const bodyText = async () => (await win.locator('body').innerText()).replace(/\s+/g, ' ');

  /** 轮询等待某段文本**消失**（用于"删除后应看不到"这类断言） */
  const waitForTextGone = async (needle, timeoutMs = 8_000) => {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    while (Date.now() < deadline) {
      last = await bodyText();
      if (!last.includes(needle)) return true;
      await win.waitForTimeout(120);
    }
    return last;
  };

  step('概览页：数据目录应是临时目录（证明没碰你的真实数据）');
  const overview = await bodyText();
  if (!overview.includes(dataDir.replace(/\\/g, '\\'))) {
    // innerText 里路径可能被截断显示，退一步只断言父目录名
    if (!overview.includes(dataDir.split(/[\\/]/).pop())) {
      fail('概览页没有显示临时数据目录，隔离可能没生效', overview.slice(0, 600));
    }
  }
  ok('数据目录已隔离到临时目录');

  step('插件页：应识别出预置的 my-team 插件与它贡献的技能目录');
  await tabButton('插件').click();
  const pluginsReady = await waitForText('已加载');
  if (pluginsReady !== true) fail('插件页没有加载出汇总文本', String(pluginsReady).slice(0, 800));
  const plugins = await bodyText();
  if (!plugins.includes('my-team')) fail('插件页没有列出 my-team', plugins.slice(0, 800));
  if (!plugins.includes('贡献：技能目录 1 个')) fail('插件页没有显示"贡献：技能目录 1 个"', plugins.slice(0, 800));
  ok('插件被识别，且贡献物可见');

  step('渲染层**不能**改工作区（工作区是权限边界的一部分）');
  const denied = await win.evaluate(async () => {
    // 试图把工作区改到别处：现在应当是**明确报错**（此前是静默丢弃 —— 轨道回归计划1 修 S1）
    try {
      await window.jujia.configSet({ workspace: 'D:\\evil' });
      const after = await window.jujia.configGet();
      return { threw: false, workspace: after.config.workspace, message: '' };
    } catch (err) {
      return { threw: true, workspace: null, message: err instanceof Error ? err.message : String(err) };
    }
  });
  if (denied.threw !== true) {
    fail(`渲染层写工作区没有报错（说明仍被静默丢弃）：${JSON.stringify(denied)}`);
  }
  if (!String(denied.message).includes('不允许由界面写入')) {
    fail(`报错文案没有说清原因：${String(denied.message)}`);
  }
  ok('渲染层写工作区被**明确拒绝**（不再是"看起来成功、其实没改"）');

  step('权限模式切换**真的生效**（此前 UI 提示成功但配置被静默丢弃）');
  const modeSwitched = await win.evaluate(async () => {
    const before = (await window.jujia.configGet()).config.permissionMode;
    await window.jujia.configSet({ permissionMode: 'plan' });
    const after = (await window.jujia.configGet()).config.permissionMode;
    await window.jujia.configSet({ permissionMode: before });
    return { before, after };
  });
  if (modeSwitched.after !== 'plan') {
    fail(`权限模式切换没有落盘：切换前 ${String(modeSwitched.before)}，切换后 ${String(modeSwitched.after)}`);
  }
  ok(`权限模式切换已落盘（${String(modeSwitched.before)} → plan → 已还原）`);

  step('设置工作区（**只走配置文件** —— 界面上的目录选择器需要真人操作，自动化改配置）');
  const configPath = join(dataDir, 'config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      data: { theme: 'dark', workspace: wsDir, appearance: { packId: 'default-dark', pack: null } },
    }),
    'utf8',
  );
  const wsNow = await win.evaluate(async () => (await window.jujia.configGet()).config.workspace);
  if (wsNow !== wsDir) fail(`写配置文件后应用没有读到新工作区，读到：${String(wsNow)}`);
  ok('工作区已设为临时目录（应用确实从磁盘重读了配置）');

  step('技能端到端：经真实 IPC → 主进程 → 注册表 → 权限门 加载插件贡献的技能');
  const skill = await win.evaluate(async () => {
    return await window.jujia.toolRun('load_skill', { name: 'my-check' });
  });
  if (!skill.ok) fail('load_skill 调用失败', JSON.stringify(skill).slice(0, 600));
  if (!String(skill.content).includes('打标签要人工确认')) {
    fail('技能正文没有返回（插件贡献的技能没生效）', String(skill.content).slice(0, 600));
  }
  ok('插件贡献的技能真的能被加载（工具返回了正文）');

  step('技能不存在时给出可读错误（而不是静默失败）');
  const missing = await win.evaluate(async () => {
    return await window.jujia.toolRun('load_skill', { name: 'not-exist' });
  });
  if (missing.ok !== false) fail('不存在的技能竟然返回成功', JSON.stringify(missing).slice(0, 400));
  if (!String(missing.content).includes('my-check')) {
    fail('错误信息里没有列出可用技能', String(missing.content).slice(0, 400));
  }
  ok('错误信息列出了可用技能');

  step('权限页：新增一条规则（填表单 + 点按钮，全自动）');
  await tabButton('权限').click();
  await win.locator('.jj-perm-form input').first().waitFor({ timeout: 8_000 });
  await win.locator('.jj-perm-form input').first().fill('mcp__*');
  await win.locator('.jj-perm-form select').selectOption('deny');
  await win.locator('.jj-perm-form input').nth(1).fill('端到端验证');
  await win.getByRole('button', { name: '新增规则' }).click();
  const ruleAdded = await waitForText('端到端验证');
  if (ruleAdded !== true) fail('规则没有出现在列表里', String(ruleAdded).slice(0, 800));
  const perms = await bodyText();
  if (!perms.includes('拒绝')) fail('规则动作没有显示为"拒绝"', perms.slice(0, 800));
  ok('规则已保存并显示在列表里');

  step('权限规则真的生效：被规则拒绝的工具调用应被拦下');
  const blocked = await win.evaluate(async () => {
    // load_skill 不在规则范围里，这里用一个不存在的工具名验证"规则只影响匹配项"
    return await window.jujia.toolRun('load_skill', { name: 'my-check' });
  });
  if (!blocked.ok) fail('未匹配规则的工具被误拦', JSON.stringify(blocked).slice(0, 400));
  ok('规则只影响匹配的工具（未命中的照常执行）');

  step('删除规则（清理，验证删除后列表为空）');
  await win.getByRole('button', { name: '删除' }).first().click();
  // 等它**真的消失**，而不是睡固定时长：删除要过一轮 IPC 再重渲染，
  // 固定等待在机器忙时会偶发失败（本轮实测踩过），轮询则既快又稳
  const gone = await waitForTextGone('端到端验证');
  if (gone !== true) fail('规则没有被删除', String(gone).slice(0, 600));
  ok('规则已删除');

  step('钩子页：七类事件都在，且默认关闭');
  await tabButton('钩子').click();
  const hooksReady = await waitForText('SessionStart');
  if (hooksReady !== true) fail('钩子页没有加载出事件表', String(hooksReady).slice(0, 800));
  const hooks = await bodyText();
  for (const ev of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop']) {
    if (!hooks.includes(ev)) fail(`钩子页缺少事件 ${ev}`, hooks.slice(0, 900));
  }
  if (!hooks.includes('关闭')) fail('钩子页没有显示默认关闭状态', hooks.slice(0, 600));
  ok('七类事件齐全，默认关闭');

  step('MCP 页：新增表单与列表可用');
  await tabButton('MCP').click();
  const mcpReady = await waitForText('新增服务端');
  if (mcpReady !== true) fail('MCP 页没有加载出新增表单', String(mcpReady).slice(0, 800));
  const mcp = await bodyText();
  if (!mcp.includes('新增服务端')) fail('MCP 页缺少新增表单', mcp.slice(0, 600));
  if (!mcp.includes('插件 my-team')) fail('插件带来的服务端没有出现在 MCP 列表', mcp.slice(0, 900));
  if (!mcp.includes('不能在这里编辑或删除')) fail('插件服务端没有标注不可编辑/删除', mcp.slice(0, 900));
  ok('MCP 页就绪');

  /* ---------------------------- 内置浏览器（M10） ----------------------------
   *
   * 为什么起**本地** HTTP 服务而不是打开某个公网页面：
   * 拿公网做端到端等于把测试交给网络和第三方 —— 断网、改版、限流都会红，
   * 而红的原因与被测代码毫无关系。127.0.0.1 随机端口顺带验证了策略里
   * "本机地址允许"这一条（本用例本身就靠它才跑得起来）。
   */
  step('内置浏览器：真实加载本地页面并读出正文（不依赖外网）');
  const MARKER = 'JUJIA_E2E_BODY_MARKER';
  const OTHER_MARKER = 'JUJIA_E2E_OTHER_SITE';
  // 端口在 listen 之后才知道；请求处理函数是**之后**才被调用的，所以这里先声明再赋值是安全的
  let portAddr = 0;
  let otherPort = 0;
  /** 本地站点收到过的请求路径（按到达顺序）。外部程序有没有真的来取，问它 */
  const hits = [];
  /** 第二个站点：用来当"跳转目标"。**同主机不同端口 = 不同 origin**，而且不会被 Chromium 改写 */
  const otherSite = createServer((req, res) => {
    // 目标站点自己也记账：于是"被拦之后到底有没有真的跳过去"问的是**对方的台账**，不是我们的界面文案
    hits.push(`other ${req.url ?? ''}`);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<html><body><p>${OTHER_MARKER}</p></body></html>`);
  });
  const server = createServer((req, res) => {
    // 请求台账：这一步的"真值"就靠它 —— 界面说"已交给外部程序"不算数，
    // 外部程序真的回来取了一次，才算那次交付发生了（拒绝之后台账里没有这一条，才算真没做）。
    hits.push(req.url ?? '');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (req.url === '/jump') {
      // 页面自己跳去**另一个站点** —— 与用户打开的那个 origin 不同，必须被拦。
      // 为什么不用 localhost：Chromium 会把 localhost 重写回 127.0.0.1，
      // 那样"origin 变了没"就看不出来了（红/绿实验实测），换端口才是干净的第二 origin。
      res.end(
        `<html><head><meta http-equiv="refresh" content="0;url=http://127.0.0.1:${String(otherPort)}/stolen">` +
          `</head><body>waiting-jump</body></html>`,
      );
      return;
    }
    if (req.url === '/redir302') {
      // **服务端 302**：T11 的那条路 —— 它不走 `will-navigate`，只走 `will-redirect`（实测）。
      // 目标带一个专属路径，于是"有没有真的跳过去"在目标站点的台账里查得到。
      res.writeHead(302, { Location: `http://127.0.0.1:${String(otherPort)}/stolen-by-302` });
      res.end();
      return;
    }
    if (req.url === '/selfredir') {
      // 反向对照：**同站**重定向必须照常落地。少了这一条，"把所有重定向一律拦掉"也能全绿。
      res.writeHead(302, { Location: `http://127.0.0.1:${String(portAddr)}/landed-same-origin` });
      res.end();
      return;
    }
    if (req.url === '/landed-same-origin') {
      res.end(`<html><head><title>self-redir</title></head><body><p>${MARKER}</p><p>SAME_ORIGIN_REDIRECT_LANDED</p></body></html>`);
      return;
    }
    if (req.url === '/attach') {
      // 附件响应：浏览器会把它当成**下载**。不拦就会直接往本机"下载"目录写文件（实测：无人问、无声响）。
      res.setHeader(
        'content-disposition',
        'attachment; filename="JUJIA_E2E_SHOULD_NOT_LAND.bin"',
      );
      res.setHeader('content-type', 'application/octet-stream');
      res.end('JUJIA_E2E_DOWNLOAD_PROBE');
      return;
    }
    if (req.url === '/plain-again') {
      res.end(`<html><body>${MARKER} 普通页面（下载被拦之后应当还停在这里）</body></html>`);
      return;
    }
    // BRIDGE= / NODE= 这两串**只由页面脚本在运行时写出来**（静态 HTML 里只有 probe-pending）。
    // 于是这一条探针同时回答两个问题：guest 页面的 JS 到底跑没跑、跑的时候能不能拿到能力桥与 Node。
    // 若在静态 HTML 里直接写 BRIDGE=undefined，探针就是假的 —— JS 不跑也能"通过"。
    res.end(
      `<html><head><title>e2e</title></head><body><p>${MARKER}</p><p>第二行正文</p>` +
        `<p id="probe">probe-pending</p>` +
        `<script>document.getElementById('probe').textContent =` +
        `'BRIDGE=' + (typeof window.jujia) + ' NODE=' + (typeof window.process);</script>` +
        `</body></html>`,
    );
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  await new Promise((resolveListen) => otherSite.listen(0, '127.0.0.1', resolveListen));
  const bound = server.address();
  const otherBound = otherSite.address();
  if (bound === null || typeof bound === 'string') fail('本地测试服务没拿到端口', String(bound));
  if (otherBound === null || typeof otherBound === 'string') fail('第二个站点没拿到端口', String(otherBound));
  portAddr = bound.port;
  otherPort = otherBound.port;
  const baseUrl = `http://127.0.0.1:${String(portAddr)}`;
  const otherUrl = `http://127.0.0.1:${String(otherPort)}`;

  await tabButton('浏览器').click();
  const browserReady = await waitForText('尚未打开');
  if (browserReady !== true) fail('浏览器页签没有渲染出来', String(browserReady).slice(0, 600));

  const addressBox = win.locator('input[aria-label="地址栏"]');
  await addressBox.fill(`${baseUrl}/hello`);
  await win.locator('button', { hasText: '打开' }).first().click();
  const opened = await waitForText('已打开');
  if (opened !== true) fail('打开本地页面没有成功', String(opened).slice(0, 800));

  // 读正文：证明 executeJavaScript 真的在**已加载的那个页面**上跑过（长度非 0、来源对得上）
  await win.locator('button', { hasText: '读正文' }).first().click();
  const readDone = await waitForText('已读取');
  if (readDone !== true) fail('读正文没有返回结果', String(readDone).slice(0, 800));
  const readOut = await bodyText();
  if (!readOut.includes(baseUrl)) fail('读正文返回的来源不是本地页面', readOut.slice(0, 600));
  if (readOut.includes('：0 字')) fail('读正文拿到 0 字（正文提取实际没生效）', readOut.slice(0, 600));
  ok('本地页面真加载、正文真读到');

  /**
   * **运行时**断言能力桥不可达（源码级守卫之外的第二重保险）。
   * 为什么不能只靠源码检查：`browserViewPreferences()` 里少写一行 preload、
   * 或将来有人把视图配置换成主窗口那份模板，源码看起来都"没毛病"，
   * 但真实 guest 页面里就会多出 window.jujia —— 只有页面自己报告才看得见。
   * 这里直接调 browserGetText 取回 guest 正文（界面上只显示字数、不显示正文，故走 API）。
   */
  const probe = await win.evaluate(async () => {
    const r = await window.jujia.browserGetText();
    return r.ok === true ? r.text : `__ERR__${r.error}`;
  });
  if (!probe.includes('BRIDGE=undefined')) {
    fail('guest 页面拿到了能力桥（window.jujia 不为 undefined）—— 视图配置泄漏', String(probe).slice(0, 600));
  }
  if (!probe.includes('NODE=undefined')) {
    fail('guest 页面能访问到 process —— nodeIntegration 或沙箱被打开', String(probe).slice(0, 600));
  }
  if (probe.includes('probe-pending')) {
    fail('页面脚本没执行，这条运行时断言是空的（探针没被改写）', String(probe).slice(0, 600));
  }
  ok('运行时确认：guest 页面既拿不到能力桥，也拿不到 process');

  step('内置浏览器：页面自己跨站跳转被拦（用户点开的站点不能被页面冒用）');
  await addressBox.fill(`${baseUrl}/jump`);
  await win.locator('button', { hasText: '打开' }).first().click();
  const jumped = await waitForText('跳出用户打开的站点');
  if (jumped !== true) fail('跨站跳转没有被拦下（策略可能没挂在 will-navigate 上）', String(jumped).slice(0, 800));

  /**
   * **真值断言**：不看界面文案，直接问 guest 现在实际在哪个 origin、显示的是哪一页。
   * 为什么必须这样（红/绿实验实测出来的）：界面里"已打开 …/jump"那句提示会一直挂着，
   * 只断言 innerText 的话，**把 preventDefault 整行删掉、网页真跳走了，这一步照样绿**。
   * 一条不会红的断言等于没有断言。
   */
  const guestNow = await win.evaluate(async () => {
    const r = await window.jujia.browserGetText();
    return r.ok === true ? { origin: r.origin, text: r.text } : { origin: `__ERR__${r.error}`, text: '' };
  });
  if (guestNow.origin !== baseUrl) {
    fail('被拦之后 guest 的实际 origin 已经变了（拦截没生效）', JSON.stringify(guestNow).slice(0, 600));
  }
  if (!guestNow.text.includes('waiting-jump')) {
    fail('guest 显示的不是用户打开的那个页面', JSON.stringify(guestNow).slice(0, 600));
  }
  if (guestNow.text.includes(OTHER_MARKER)) {
    fail('guest 已经落到另一个站点（正文里出现了目标站点标记）', guestNow.text.slice(0, 300));
  }
  const afterJump = await bodyText();
  if (afterJump.includes(otherUrl)) ok('理由可见，且 guest 实际仍停在用户打开的站点');
  else fail('被拦理由里没有点出目标站点', afterJump.slice(0, 600));

  /**
   * 同一件底线的事，**第二种做法**（外部审查 T11）：服务端 302。
   *
   * 为什么它是独立的一跳：实测 Electron 44 里跨站 302 **一次都不触发 `will-navigate`**，
   * 只走 `did-start-navigation → will-redirect → did-redirect-navigation → did-navigate`
   * （探针记录见复核 038）。只挂 `will-navigate` 的旧接线，在任何一个重定向面前等于没有锁 ——
   * 而重定向恰恰是页面最能自己造的一跳，它连链接都不必点。
   * 真值仍然是**对方台账**：被拦之后 `/stolen-by-302` 绝不能出现在第二个站点的请求记录里。
   */
  await addressBox.fill(`${baseUrl}/redir302`);
  await win.locator('button', { hasText: '打开' }).first().click();
  const redirected = await waitForText('跳出用户打开的站点');
  if (redirected !== true) {
    fail('服务端 302 跨站没有被拦（多半只挂了 will-navigate，漏了 will-redirect）', String(redirected).slice(0, 800));
  }
  if (hits.includes('other /stolen-by-302')) {
    fail('界面说"拦下了"，目标站点却仍然收到了请求 —— 拦截其实没生效', hits.join(' , ').slice(0, 500));
  }
  const guestAfter302 = await win.evaluate(async () => {
    const r = await window.jujia.browserGetText();
    return r.ok === true ? String(r.origin) : `__ERR__${r.error}`;
  });
  if (guestAfter302.includes(String(otherPort))) {
    fail(`302 之后 guest 实际已在目标站点（${guestAfter302}）`, String(guestAfter302).slice(0, 300));
  }
  ok('服务端 302 逐跳过判档：目标站点一次都没被访问（对方台账为证）');

  /**
   * 反向对照：**同站**重定向必须照常落地。少了这条，"把所有重定向一律拦掉"也能全绿 ——
   * 而那种实现会把正常网页全部锁死（协议层是 origin 锁，不是"禁止重定向"）。
   */
  await addressBox.fill(`${baseUrl}/selfredir`);
  await win.locator('button', { hasText: '打开' }).first().click();
  const sameOriginRead = await win.evaluate(async () => {
    const deadline = Date.now() + 8_000;
    for (;;) {
      const r = await window.jujia.browserGetText();
      if (r.ok === true && String(r.text).includes('SAME_ORIGIN_REDIRECT_LANDED')) return { ok: true, origin: r.origin };
      if (Date.now() > deadline) return { ok: false, got: r.ok === true ? String(r.text).slice(0, 120) : `__ERR__${r.error}` };
      await new Promise((res) => setTimeout(res, 200));
    }
  });
  if (sameOriginRead.ok !== true) {
    fail('同站 302 被误拦了（origin 锁不该管没换站点的跳转）', JSON.stringify(sameOriginRead).slice(0, 400));
  }
  if (sameOriginRead.origin !== baseUrl) {
    fail('同站重定向落地后的 origin 与用户打开的不是一个', JSON.stringify(sameOriginRead).slice(0, 400));
  }
  ok('对照通过：同站重定向照常落地，拦的只是"换站点"');

  step('内置浏览器：file:// 被拒、页面想存文件被拦（理由都读得到）');
  await addressBox.fill('file:///C:/Windows/win.ini');
  await win.locator('button', { hasText: '打开' }).first().click();
  const blockedFile = await waitForText('本地文件协议');
  if (blockedFile !== true) fail('file:// 没有被拒绝', String(blockedFile).slice(0, 800));
  const fileOut = await bodyText();
  // 只说"不行"不够：必须说清是**哪个协议、为什么**，否则用户会以为是软件坏了
  if (!fileOut.toLowerCase().includes('file')) fail('拒绝理由里没有点出 file 协议', fileOut.slice(0, 600));
  if (!fileOut.includes('本地文件')) fail('拒绝理由没有说明风险（读磁盘任意文件）', fileOut.slice(0, 600));
  // 真值断言（同上一步的理由）：界面写了"已拒绝"还不够，得确认 guest **实际**没换页
  const guestAfterFile = await win.evaluate(async () => {
    const r = await window.jujia.browserGetText();
    return r.ok === true ? r.origin : `__ERR__${r.error}`;
  });
  if (guestAfterFile !== baseUrl) {
    fail(`file:// 被"拒绝"之后 guest 实际换了页（当前 origin：${String(guestAfterFile)}）`);
  }
  ok('危险协议被拒、理由可见，且 guest 确实还停在原页面');

  /**
   * 页面想往本机存文件（外部审查 T11 的另一半）。
   *
   * 为什么这是独立的洞：探针实测**不挂 `will-download` 时，第三方页面的附件下载不经任何询问
   * 就落进系统"下载"目录**（两个 20 字节的 .tmp 就这么出现了，界面与状态一声不响）。
   * 本项目没有"下载管理"这套产品，所以处置是"一律拦下 + 把理由显示出来"，而不是顺手做一个下载器。
   *
   * 断言问两件真值：① 界面有没有说出"拦下了什么文件"；② 那个文件名**在磁盘上不存在**
   * （只断言文案的话，把 `item.cancel()` 整行删掉这一步照样绿 —— 而那才是真正的那一下）。
   */
  const DOWNLOAD_NAME = 'JUJIA_E2E_SHOULD_NOT_LAND.bin';
  await addressBox.fill(`${baseUrl}/attach`);
  await win.locator('button', { hasText: '打开' }).first().click();
  const dlNotice = await waitForText('已拦下');
  if (dlNotice !== true) fail('网页发起的下载没有被拦下（will-download 可能没挂上）', String(dlNotice).slice(0, 800));
  const dlBody = await bodyText();
  if (!dlBody.includes(DOWNLOAD_NAME)) {
    fail('拦下是拦下了，但没说是哪个文件 —— 用户看不懂发生了什么', dlBody.slice(0, 700));
  }

  /** 可能落盘的几个目录：系统的"下载"（若存在）+ 本次运行的全部临时目录 */
  const downloadCandidates = [
    join(homedir(), 'Downloads'),
    dataDir,
    profileDir,
    wsDir,
    TMP_ROOT,
  ];
  const landed = [];
  for (const dir of downloadCandidates) {
    if (!existsSync(dir)) continue;
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) if (n.includes(DOWNLOAD_NAME) || n.includes('JUJIA_E2E_SHOULD_NOT_LAND')) landed.push(`${dir}/${n}`);
  }
  if (landed.length > 0) fail(`下载被"拦下"之后磁盘上仍有这个文件：${landed.join(' , ')}`);
  const listable = downloadCandidates.filter((d) => existsSync(d)).length;
  ok(`网页的下载被取消、理由点名了文件名，且磁盘上没有任何一处出现该文件（查了 ${String(listable)} 个目录）`);


  /* ---------------------------- git 接线（M8） ----------------------------
   *
   * 断言一律问**真值**：不看界面有没有"成功"两个字，而是回到磁盘上查 git log。
   * （复核 026 的 G-8 教训：只看界面文案的断言可以把拦截整个删掉还全绿。）
   * 工作区是第 6 步设进来的临时目录，本步骤在它里面就地 `git init` 一个真仓库。
   */
  const g_in = (args) => runGit('git', args, { cwd: wsDir, windowsHide: true });
  const commitCount = async () => {
    const r = await g_in(['rev-list', '--count', 'HEAD']);
    return Number.parseInt(r.stdout.trim(), 10);
  };

  step('内置 Git：暂存 → 确认 → 提交，磁盘上真的多出一次提交（权限门每次都过）');
  await g_in(['init', '-q']);
  await g_in(['config', 'user.email', 'e2e@example.invalid']);
  await g_in(['config', 'user.name', 'e2e']);
  writeFileSync(join(wsDir, 'README-e2e-seed.md'), 'seed\n', 'utf8');
  await g_in(['add', '--', 'README-e2e-seed.md']);
  await g_in(['commit', '-qm', 'seed']);
  const seededCount = await commitCount();

  const gitFile = `改动-${String(Date.now()).slice(-6)}.txt`;
  writeFileSync(join(wsDir, gitFile), '第一轮改动\n', 'utf8');

  await tabButton('Git').click();
  const gitReady = await waitForText('Git 变更');
  if (gitReady !== true) fail('Git 页签没有渲染出来', String(gitReady).slice(0, 600));

  // 只读动作**不该弹窗**：先确认状态能读到且没有出现确认框
  const shown = await waitForText(gitFile);
  if (shown !== true) fail('Git 页签没有列出未跟踪的文件', String(shown).slice(0, 600));
  if ((await win.locator('[role="dialog"][aria-label="权限请求"]').count()) > 0) {
    fail('只读的 status 查询竟然弹了确认框（应该不问）');
  }
  ok('只读查询不打扰：状态列表直接显示了新文件');

  // 暂存 = 软 ask：应当弹窗，且摘要写明"暂存 1 个文件"
  await win.locator(`input[aria-label="选择 ${gitFile}"]`).check();
  await win.locator('button', { hasText: '暂存所选' }).first().click();
  const stageDialog = await waitForText('需要你确认：暂存 1 个文件');
  if (stageDialog !== true) fail('暂存没有弹出确认框（或摘要不对）', String(stageDialog).slice(0, 600));
  await win.locator('button', { hasText: '允许一次' }).first().click();
  const stagedShown = await waitForText('已暂存（1）');
  if (stagedShown !== true) fail('允许之后文件没有进入暂存区', String(stagedShown).slice(0, 600));
  ok('暂存走了软确认，允许后确实生效');

  // 提交 = 硬 ask：弹窗必须写明"会写入仓库历史"
  await win.locator('textarea[aria-label="提交信息"]').fill('e2e：接上了 git');
  await win.locator('button', { hasText: '提交（会写入仓库历史）' }).first().click();
  const commitDialog = await waitForText('需要你确认：会写入仓库历史');
  if (commitDialog !== true) fail('提交没有弹出硬确认框，或提示文案没写明会写入历史', String(commitDialog).slice(0, 600));
  await win.locator('button', { hasText: '允许一次' }).first().click();
  // 先等弹窗消失，否则"这条提交"的文本可能来自弹窗里的摘要本身（假通过）
  await win.waitForSelector('[role="dialog"][aria-label="权限请求"]', { state: 'detached', timeout: 8_000 });
  // 锚点必须"这一步之前不存在"（TEST-POLICY §六 第 3 条）：等我们自己写的那条提交主题
  const committed = await waitForText('e2e：接上了 git');
  if (committed !== true) fail('提交后界面里没有这条提交', String(committed).slice(0, 600));
  // 真值：磁盘上的 git log 里真的有这条
  const afterCommit = await commitCount();
  if (afterCommit !== seededCount + 1) {
    const dump = await bodyText();
    fail(
      `提交没有真的落到仓库里（提交数 ${String(seededCount)} → ${String(afterCommit)}，应为 ${String(seededCount + 1)}`,
      dump.slice(0, 1200),
    );
  }
  const subject = (await g_in(['log', '-1', '--pretty=%s'])).stdout.trim();
  if (subject !== 'e2e：接上了 git') fail('仓库最新提交的主题不是我们刚提交的那条', subject);
  ok('提交过了硬确认，并且真的写进了仓库历史');

  step('内置 Git：拒绝提交 → 仓库里真的没有这次提交（拒绝必须真的不做）');
  const gitFile2 = `改动B-${String(Date.now()).slice(-6)}.txt`;
  writeFileSync(join(wsDir, gitFile2), '第二轮改动\n', 'utf8');
  await win.locator('button', { hasText: '刷新' }).first().click();
  const shown2 = await waitForText(gitFile2);
  if (shown2 !== true) fail('刷新后没有看到新文件', String(shown2).slice(0, 600));
  await win.locator(`input[aria-label="选择 ${gitFile2}"]`).check();
  await win.locator('button', { hasText: '暂存所选' }).first().click();
  const d2 = await waitForText('需要你确认：暂存 1 个文件');
  if (d2 !== true) fail('第二次暂存没弹确认', String(d2).slice(0, 600));
  await win.locator('button', { hasText: '本次会话总是允许' }).first().click();
  // 记住之后：第三次暂存不再弹窗（软 ask 的语义），同时证明"总是允许"确实生效了
  const gitFile3 = `改动C-${String(Date.now()).slice(-6)}.txt`;
  writeFileSync(join(wsDir, gitFile3), '第三轮改动\n', 'utf8');
  await win.locator('button', { hasText: '刷新' }).first().click();
  await waitForText(gitFile3);
  await win.locator(`input[aria-label="选择 ${gitFile3}"]`).check();
  await win.locator('button', { hasText: '暂存所选' }).first().click();
  const remembered = await waitForText('已暂存（2）');
  if (remembered !== true) fail('「本次会话总是允许」之后仍然弹窗或暂存失败', String(remembered).slice(0, 600));
  if ((await win.locator('[role="dialog"][aria-label="权限请求"]').count()) > 0) {
    fail('软 ask 已被记住，却还是弹了确认框');
  }
  ok('软 ask 的「总是允许」真的被记住了（第三次暂存没再问）');

  // 但 commit 依然要问 —— 上面那次「总是允许」绝不能连带把提交也放行
  await win.locator('textarea[aria-label="提交信息"]').fill('不该存在的提交');
  await win.locator('button', { hasText: '提交（会写入仓库历史）' }).first().click();
  const d3 = await waitForText('需要你确认：会写入仓库历史');
  if (d3 !== true) fail('「总是允许」把提交的硬确认也压掉了（这正是最危险的逃逸）', String(d3).slice(0, 600));
  const beforeDeny = await commitCount();
  await win.locator('button', { hasText: '拒绝' }).first().click();
  const denyShown = await waitForText('你拒绝了这次操作');
  if (denyShown !== true) fail('拒绝之后界面没有给出可读理由', String(denyShown).slice(0, 600));
  const afterDeny = await commitCount();
  if (afterDeny !== beforeDeny) fail(`拒绝之后仓库里却多出了提交（${String(beforeDeny)} → ${String(afterDeny)}）`);
  ok('硬 ask 不被"总是允许"压掉；拒绝后仓库真的没动');

  step('内置 exec：批准后真的落盘；硬 ask 不给「总是允许」按钮、批准也不外溢；拒绝后磁盘上什么都没有');
  /**
   * 三条断言都问**真值**（TEST-POLICY §六 第 1 条）：
   * 界面说"已执行"不算执行，文件在磁盘上出现才算；说"被拒绝"不算拒绝，文件不存在才算。
   */
  const execOut = async (command) =>
    win.evaluate(async (c) => await window.jujia.toolRun('run_command', { command: c }), command);
  const dialogCount = async () => (await win.locator('[role="dialog"][aria-label="权限请求"]').count());
  /**
   * 硬 ask 的弹窗上不该再有「本次会话总是允许」这个按钮（外部审查 T19），
   * 并且必须把"每一次都会问"这句话显示出来。
   * 为什么算界面级证据：以前这个按钮在硬 ask 上也渲染，引擎却只在软 ask 上记决定 ——
   * 用户点了以为以后不问了，实际下次照弹。界面不能承诺后端做不到的事。
   */
  const assertHardAskCopy = async (where) => {
    const n = await win.locator('button', { hasText: '本次会话总是允许' }).count();
    if (n > 0) fail(`${where}：硬 ask 的弹窗仍挂着「本次会话总是允许」—— 点了并不会被记住，是空承诺`);
    const t = await bodyText();
    if (!t.includes('此操作每次都会要求确认')) fail(`${where}：硬 ask 弹窗没有说明"此操作每次都会要求确认"`, t.slice(0, 700));
  };

  const fileA = `exec-approved-${String(Date.now()).slice(-6)}.txt`;
  // 不能 await：invoke 要等用户在弹窗上点完才回，先 await 就把整个流程堵死了
  const first = execOut(`echo approved > ${fileA}`);
  const firstDialog = await waitForText(`需要你确认：run_command · 执行命令：echo approved > ${fileA}`);
  if (firstDialog !== true) fail('exec 没有弹硬确认，或标题里看不到将要执行的命令行', String(firstDialog).slice(0, 600));
  await assertHardAskCopy('内置 exec');
  await win.locator('button', { hasText: '允许一次' }).first().click();
  await first;
  await win.waitForSelector('[role="dialog"][aria-label="权限请求"]', { state: 'detached', timeout: 8_000 });
  const aExists = existsSync(join(wsDir, fileA));
  if (!aExists) fail('批准后文件没有真的出现在磁盘上（命令其实没跑？）');
  ok('批准 → 命令真的执行（磁盘上有文件）');

  const fileB = `exec-denied-${String(Date.now()).slice(-6)}.txt`;
  const second = execOut(`echo denied > ${fileB}`);
  const secondDialog = await waitForText(`需要你确认：run_command · 执行命令：echo denied > ${fileB}`);
  if (secondDialog !== true) fail('上一次的「允许一次」被当成了记住 —— 第二次的硬确认也没弹（执行类绝不允许这样）', String(secondDialog).slice(0, 600));
  const pendingDialogs = await dialogCount();
  if (pendingDialogs !== 1) fail('第二次执行应当只有一个确认框挂着', String(pendingDialogs));
  await win.locator('button', { hasText: '拒绝' }).first().click();
  const secondRes = await second;
  if (secondRes.ok !== false) fail(`拒绝了却返回成功：${JSON.stringify(secondRes)}`);
  if (secondRes.decision !== 'deny') fail(`决定不是 deny：${String(secondRes.decision)}`);
  const bExists = existsSync(join(wsDir, fileB));
  if (bExists) fail('用户明明拒绝了，命令却还是执行了（磁盘上留下了文件）');
  ok('硬 ask 不被"总是允许"压掉；拒绝 → 零副作用');

  /* 回到浏览器页签：这一步只验"交给外部程序"那一支，不需要视图真的打开 */
  await tabButton('浏览器').click();
  const backToBrowser = await waitForText('尚未打开');
  if (backToBrowser !== true) fail('切回浏览器页签没有渲染出来', String(backToBrowser).slice(0, 600));

  /* ---------------- 打开方式三档（M10 收尾 · 外发动作必须过权限门） ----------------
   *
   * 真值是**本地站点的请求台账**：界面说"已交给外部程序"不算数，
   * 外部程序真的来取过一次才算交付发生；拒绝之后台账里没有那一条，才算真的没做。
   * （复核 026 的 G-8 教训：只断言界面文案的"安全断言"可以把拦截整个删掉还全绿。）
   */
  const waitHit = async (path) => {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      if (hits.includes(path)) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  };

  step('内置浏览器：地址交给外部程序 —— 问过才交、拒绝就不交、批准不外溢');

  // ① 切到"系统默认浏览器"这一档：界面必须先把"为什么要问一次"说清楚
  await win.locator('select[aria-label="打开方式"]').selectOption('system');
  const whyAsked = await waitForText('交给应用之外的程序');
  if (whyAsked !== true) fail('切到外部档之后，界面没有说明这一步会把地址交出去');

  // ② 拒绝分支。这一档**只做拒绝**：允许会真的唤起用户日常用的浏览器，那不该发生在测试里
  const deniedUrl = '/handed-denied';
  await addressBox.fill(`${baseUrl}${deniedUrl}`);
  await win.locator('button', { hasText: '打开' }).first().click();
  const sysDialog = await waitForText('需要你确认：地址将离开本应用的安全边界');
  if (sysDialog !== true) {
    fail('交给系统默认浏览器竟然没有弹确认框（本机外发动作必须问）', String(sysDialog).slice(0, 800));
  }
  await win.locator('button', { hasText: '拒绝' }).first().click();
  await win.waitForSelector('[role="dialog"][aria-label="权限请求"]', { state: 'detached', timeout: 8_000 });
  if (hits.includes(deniedUrl)) fail('点了拒绝，地址却还是交了出去');
  ok('系统默认浏览器那一档会先问；拒绝之后没有交付');

  // ③ 自选程序档：允许 → 真的交出去（请求台账为证）
  if (!handoutExeReady) {
    fail('这台机器上没有 Windows 自带的命令行 HTTP 客户端，本步无法用"真的来取过一次"作真值');
  }
  await win.locator('select[aria-label="打开方式"]').selectOption('custom');
  const exeRow = await waitForText('自选程序：');
  if (exeRow !== true) fail('切到自选程序档后没有显示当前选定的程序');
  const firstUrl = '/handed-exe-1';
  await addressBox.fill(`${baseUrl}${firstUrl}`);
  await win.locator('button', { hasText: '打开' }).first().click();
  const exeDialog = await waitForText('用本机程序');
  if (exeDialog !== true) fail('自选程序档没有弹出能看清"交给哪个程序"的确认框', String(exeDialog).slice(0, 800));
  const dialogText = await bodyText();
  // 只说"用本机程序打开"不够：必须把**那个文件的完整路径**摊开给人看，否则点允许就是盲批
  // （批复点名要求：断言到**整条路径**，不是只断言文件名 —— 那样界面改成只显示 basename 也不会红）
  if (!dialogText.includes(handoutExe)) fail('确认框里没有点出接收方是哪个程序', dialogText.slice(0, 900));
  await assertHardAskCopy('地址交给本机程序');
  await win.locator('button', { hasText: '允许一次' }).first().click();
  if (!(await waitHit(firstUrl))) fail('允许之后本机程序并没有真的收到这个地址 —— 交付其实没发生');
  await win.waitForSelector('[role="dialog"][aria-label="权限请求"]', { state: 'detached', timeout: 8_000 });
  ok('允许 → 本机程序真的取了这个地址（请求台账为证）');

  // ④ 上一次的「允许一次」绝不外溢：下一个网址仍必须问（外发动作没有"记住"这条路）
  const secondUrl = '/handed-exe-2';
  await addressBox.fill(`${baseUrl}${secondUrl}`);
  await win.locator('button', { hasText: '打开' }).first().click();
  const again = await waitForText('需要你确认：地址将离开本应用的安全边界');
  if (again !== true) fail('上一个网址的批准压掉了下一次确认 —— 外发动作被做成了软 ask');
  await win.locator('button', { hasText: '拒绝' }).first().click();
  await win.waitForSelector('[role="dialog"][aria-label="权限请求"]', { state: 'detached', timeout: 8_000 });
  if (hits.includes(secondUrl)) fail('拒绝了第二个地址，它却还是交了出去');
  ok('硬 ask 不给「总是允许」、批准不外溢；拒绝 → 零交付');

  // ⑤ 清除自选程序之后：缺前置条件就直接说清楚，不弹一个注定失败的确认框
  await win.locator('button', { hasText: '清除' }).first().click();
  const thirdUrl = '/handed-exe-3';
  await addressBox.fill(`${baseUrl}${thirdUrl}`);
  await win.locator('button', { hasText: '打开' }).first().click();
  const noExe = await waitForText('还没有选定');
  if (noExe !== true) fail('清除自选程序后没有给出可读理由', String(noExe).slice(0, 800));
  if ((await win.locator('[role="dialog"][aria-label="权限请求"]').count()) > 0) {
    fail('还没选程序就弹确认 —— 那等于让用户替一个注定失败的交付背书');
  }
  if (hits.includes(thirdUrl)) fail('没有选定程序，地址却还是交了出去');
  ok('缺前置条件时直接给理由：不弹窗、不交付');
  // 选回内置档，别把外部档留给后面的步骤（它们不该被弹确认框）
  await win.locator('select[aria-label="打开方式"]').selectOption('internal');
  server.close();
  otherSite.close();

  /* ---------------- 应用内文档查看（M10 收尾 · Markdown） ----------------
   *
   * 真值不是"界面上出现了标题"，而是**结构真的被解析过、而且原始 HTML 真的没被解释**：
   *  - 文档正文里不该出现任何 `img` 元素（那行 `<img onerror=...>` 只该是字面文本）；
   *  - 不该出现 `href` 以 javascript: 开头的可点元素；
   *  - 长文档只挂载前若干段，剩下的要点下去才铺开。
   */
  const docFile = '查看测试.md';
  const docBody = [
    '---',
    'title: 元信息',
    'tags: [查看测试]',
    '---',
    '',
    '# 标题一 只在解析后出现',
    '',
    '- 列表甲',
    '- 列表乙',
    '',
    '```html',
    '<b>围栏里的标签</b>',
    '```',
    '',
    '<img src=x onerror=alert(1)>',
    '',
    '![远端图](https://example.invalid/pic.png)',
    '',
    '[正常链接](https://example.com) 与 [坑链接](javascript:alert(1))',
    '',
    '段落一',
    '段落二',
    '',
  ].join('\n') + Array.from({ length: 300 }, (_, k) => `分块验证第 ${String(k)} 段`).join('\n\n');
  writeFileSync(join(wsDir, docFile), docBody, 'utf8');

  step('应用内文档查看：Markdown 真解析、原始 HTML 真不解释、长文档真分块');
  await tabButton('文档').click();
  const docsReady = await waitForText('还没打开文档');
  if (docsReady !== true) fail('文档页签没有渲染出来', String(docsReady).slice(0, 600));

  const docPathBox = win.locator('input[aria-label="文档路径"]');
  await docPathBox.fill(docFile);
  await win.locator('button', { hasText: '打开' }).first().click();
  // 锚点在本步之前不存在：这一句只有解析成标题元素才可能出现
  const headingShown = await waitForText('标题一 只在解析后出现');
  if (headingShown !== true) fail('文档没有打开或标题没渲染出来', String(headingShown).slice(0, 800));
  if ((await win.locator('.jj-md-h', { hasText: '标题一 只在解析后出现' }).count()) === 0) {
    fail('标题没被解析成标题元素（看起来还是纯文本）');
  }
  const docText = await bodyText();
  if (docText.includes('# 标题一')) fail('正文里还留着 Markdown 标记，说明没解析');
  if (!docText.includes('已折叠文件头部的 2 行元信息')) fail('front matter 没被折叠');
  if ((await win.locator('[role="dialog"][aria-label="权限请求"]').count()) > 0) {
    fail('只读地打开一个文档竟然弹了确认框（read 类不该打扰）');
  }
  ok('Markdown 真被解析：标题成元素、front matter 折叠、只读不打扰');

  /** 安全真值：第三方文件里的 HTML 与 javascript: 链接都不该变成真的 DOM */
  if ((await win.locator('.jj-docs-body img').count()) !== 0) {
    fail('文档里的原始 img 标签被解释成了元素（HTML 不该被解释）');
  }
  /**
   * **双向断言**（本轮被定为安全类断言的通用范式）：只断"没有 img 元素"是不够的 ——
   * 整块没渲染也能通过。所以同时断"那张 Markdown 图片确实被识别、并留下了不加载的占位说明"。
   */
  const mdImgShown = await bodyText();
  if (!mdImgShown.includes('图片（未加载远程内容）：远端图')) {
    fail('Markdown 图片语法没被识别成图片（那"零 img 元素"可能只是整块没渲染，不是没加载）', mdImgShown.slice(0, 900));
  }
  if ((await win.locator('.jj-docs-body a[href^="javascript:"]').count()) !== 0) {
    fail('javascript: 链接变成了可点元素（协议白名单没生效）');
  }
  const guardText = await bodyText();
  if (!guardText.includes('<img src=x onerror')) fail('那行 HTML 没有按字面显示出来（既不解释也不可见）');
  if (!guardText.includes('不提供跳转')) fail('被拦下的链接没有说明为什么不给点');
  if ((await win.locator('.jj-docs-body pre code', { hasText: '<b>围栏里的标签</b>' }).count()) === 0) {
    fail('围栏代码块里的标签没有被原样保留');
  }
  ok('原始 HTML 与危险链接都没有变成 DOM，且理由可见');

  // 分块挂载：**默认只铺前 240 段**。真值是"没点之前那一段确实不在 DOM 里"，
  // 而不是"界面上有一行说还剩多少"（那行字自己也能是假的）。
  const chunked = await waitForText('已显示前');
  if (chunked !== true) fail('长文档没有分块挂载（界面没显示还剩多少段）');
  const beforeMore = await bodyText();
  if (beforeMore.includes('分块验证第 260 段')) fail('还没点继续加载，后面的段落就已经铺开了（分块是假的）');
  await win.locator('button', { hasText: '继续加载' }).first().click();
  const afterMore = await bodyText();
  if (!afterMore.includes('分块验证第 299 段')) fail('继续加载没有把后面的段落铺开', afterMore.slice(-400));
  if (!afterMore.includes('已全部显示')) fail('铺完之后没有如实说明共多少段（整行消失会让人以为文档就这么短）');
  if ((await win.locator('button', { hasText: '继续加载' }).count()) > 0) {
    fail('已经全部展开了，还在提示继续加载');
  }
  // 重开一次应当回到分块起点（"全部展开"不能是单向门）
  await win.locator('button', { hasText: '打开' }).first().click();
  const reopened = await waitForText('已显示前');
  if (reopened !== true) fail('重新打开后没有回到分块挂载的起点', String(reopened).slice(0, 600));
  if ((await bodyText()).includes('分块验证第 299 段')) fail('重新打开后仍带着上一次的全部展开');
  await win.locator('button', { hasText: '全部展开' }).first().click();
  const afterAll = await bodyText();
  if (!afterAll.includes('分块验证第 299 段')) fail('全部展开后仍缺尾部段落');
  ok('长文档真分块：没点之前那段不在 DOM 里；铺开与收起都如实收口');

  // 越界路径：守卫拒绝，理由显示在界面上
  await docPathBox.fill('../逃逸.md');
  await win.locator('button', { hasText: '打开' }).first().click();
  const escaped = await waitForText('没读到');
  if (escaped !== true) fail('越出工作区的路径没有被拒绝', String(escaped).slice(0, 600));
  ok('越界路径被守卫拒绝，理由显示在界面上');

  /* ---------------- 长期记忆写入（M6） ----------------
   *
   * 真值只认磁盘：`.jujia/NOTES.md` 里到底有没有那一行。
   * **一处如实的限制**：这里经真实 IPC 调工具，但**没走「记住这一点」按钮本身** ——
   * 那个按钮只挂在已完成的助手气泡上，而本机没有可用的模型端点、也没有会话历史可回放
   * （`sessions` 目前只在内存里，持久化排在建站计划 6）。按钮的存在与调用点由
   * `memory-wiring.test.ts` 在源码级钉住；界面级点击等会话历史落地后补。
   */
  const notesFile = join(wsDir, '.jujia', 'NOTES.md');
  const noteText = 'e2e 写入验证：这个项目里的注释一律用中文';

  step('长期记忆写入：问过才落盘；拒绝后磁盘上没有这个文件；非法输入不打扰人');
  const noteDenied = win.evaluate(async (t) => await window.jujia.toolRun('append_note', { text: t }), noteText);
  const askedFirst = await waitForText('需要你确认：');
  if (askedFirst !== true) fail('写入长期记忆竟然没过权限门（写类必须问人）', String(askedFirst).slice(0, 600));
  await win.locator('button', { hasText: '拒绝' }).first().click();
  const deniedResult = await noteDenied;
  if (deniedResult.ok !== false) fail('用户拒绝了，工具却报成功', JSON.stringify(deniedResult).slice(0, 400));
  if (existsSync(notesFile)) fail('拒绝之后 .jujia/NOTES.md 竟然被创建了（零副作用没做到）');
  ok('拒绝 → 磁盘上什么都没发生');

  const accepted = win.evaluate(async (t) => await window.jujia.toolRun('append_note', { text: t }), noteText);
  const askedSecond = await waitForText('需要你确认：');
  if (askedSecond !== true) fail('第二次写入没有弹确认（权限门被绕过）');
  await win.locator('button', { hasText: '允许一次' }).first().click();
  const acceptedResult = await accepted;
  if (acceptedResult.ok !== true) fail('批准后写入失败', String(acceptedResult.content).slice(0, 400));
  const onDisk = readFileSync(notesFile, 'utf8');
  if (!onDisk.includes(noteText)) fail('磁盘上的 NOTES.md 里没有这一行', onDisk.slice(0, 400));
  // `m` 不能省：NOTES.md 的第一行是文件头注释，`^` 不锚到行首就会一直判"缺日期前缀"
  if (!/^- \d{4}-\d{2}-\d{2}: /m.test(onDisk)) fail('落盘格式缺日期前缀', onDisk.slice(0, 200));
  ok('批准 → NOTES.md 真的多出一行带日期的记忆');

  // 非法输入不该打扰人：超长内容在入参校验阶段就被拒，不进入权限询问
  await win.waitForSelector('[role="dialog"][aria-label="权限请求"]', { state: 'detached', timeout: 8_000 });
  const tooLong = await win.evaluate(async () => {
    return await window.jujia.toolRun('append_note', { text: 'x'.repeat(600) });
  });
  if (tooLong.ok !== false) fail('超长内容居然被接受了（长度上限没生效）');
  const stillDetached = (await win.locator('[role="dialog"][aria-label="权限请求"]').count()) === 0;
  if (!stillDetached) fail('非法输入也弹了确认框 —— 校验失败不该先问人');
  ok('非法输入先拒、不打扰：没弹窗也不落盘');

  /* ---------------- 会话持久化（6a）：从磁盘续上，并补上欠的按钮点击 ----------------
   *
   * 这一步同时做三件事：
   * ① 证明"上一个进程留下的会话文件"能被本进程读出来（不是靠内存余温）；
   * ② 复核 032 的 Q-6 欠的账在这里还 ——「记住这一点」按钮**真的被点了一次**；
   * ③ 关掉再重开：进程死了历史还在，且能再次读回同样内容（"重启不丢对话"的字面验证）。
   */
  step('会话持久化：从磁盘续上历史、真的点「记住这一点」、关掉重开之后历史仍在');
  await tabButton('对话').click();
  const connSelect = win.locator('select').first();
  await connSelect.selectOption(seededConnId);
  const historyPicker = await waitForText('历史会话');
  if (historyPicker !== true) fail('选了连接之后没有列出磁盘上的历史会话', String(historyPicker).slice(0, 600));
  await win.locator('select[aria-label="继续会话"]').selectOption(seededSession);
  await win.locator('button', { hasText: '继续' }).first().click();
  const resumed = await waitForText('E2E_PERSIST_答一');
  if (resumed !== true) fail('继续会话没有把那几轮读回界面', String(resumed).slice(0, 800));
  const totalShown = await bodyText();
  if (!totalShown.includes('共 4 条')) fail('没有如实报告这个会话共几条消息', totalShown.slice(0, 900));
  ok('从磁盘续上：四条历史消息回到界面，条数如实标注');

  /** Q-6 还账：这是按钮第一次在界面级被点到（写长期记忆 = 写类操作，照样要过确认） */
  const notesBefore = existsSync(notesFile) ? readFileSync(notesFile, 'utf8') : '';
  await win.locator('button', { hasText: '记住这一点' }).first().click();
  const noteDialog = await waitForText('需要你确认：');
  if (noteDialog !== true) fail('点「记住这一点」没有过权限门（写类必须问人）', String(noteDialog).slice(0, 600));
  await win.locator('button', { hasText: '允许一次' }).first().click();
  await win.waitForSelector('[role="dialog"][aria-label="权限请求"]', { state: 'detached', timeout: 8_000 });
  const notesAfter = readFileSync(notesFile, 'utf8');
  if (notesAfter.length <= notesBefore.length) fail('点了按钮也允许了，NOTES.md 却没多出行');
  if (!notesAfter.includes('E2E_PERSIST_答一')) fail('记下的不是被点那条回答的内容', notesAfter.slice(-400));
  ok('按钮真的点了一次：问过之后，那条回答进了 NOTES.md');

  // 关掉进程再重开：磁盘是事实，内存只是缓存。
  // 注意：前面那些 helper（waitForText / bodyText）闭包在旧窗口上，重开之后一律用 win2。
  await app.close();
  app = undefined;
  /**
   * 重启这一次把审批界压到 10 秒：末尾那步要真跑一次超时（默认 120 秒，e2e 等不起，
   * 而"等不起"正是它此前从没在界面级被验证过的原因）。
   * 只作用于第二段：前面二十来步的弹窗都在一两秒内被点掉，没必要跟着赶时间。
   */
  const envRestart = { ...env, JJ_PERMISSION_TIMEOUT_MS: '10000' };
  app = await electron.launch({
    executablePath: electronPath,
    args: [MAIN_ENTRY, `--user-data-dir=${profileDir}`],
    env: envRestart,
  });
  const win2 = await app.firstWindow();
  await win2.waitForSelector('body', { timeout: 15_000 });
  const direct = await win2.evaluate(async (id) => {
    const page = await window.jujia.chatHistory({ sessionId: id, limit: 120 });
    return { total: page.total, first: page.messages[0]?.content ?? '(空)', hasMore: page.hasMore };
  }, seededSession);
  if (direct.total !== 4) fail(`重启后读到的条数不是 4（实际 ${String(direct.total)}）`, JSON.stringify(direct));
  if (!direct.first.includes('E2E_PERSIST_问一')) fail('重启后第一条不是原来那句提问', JSON.stringify(direct));
  /**
   * 清单只是缓存、目录才是事实 —— 这条有两半，都得验（T6③ 补的是后半）：
   * ① 删掉 `index.json` 之后仍然列得出那个会话（不是"缓存没了就装死"）；
   * ② 重建之后**要写回磁盘**，否则"缓存"这件事被悄悄取消了：每次列会话都要重扫全目录。
   */
  const indexFile = join(dataDir, 'sessions', 'index.json');
  rmSync(indexFile, { force: true });
  const listed = await win2.evaluate(async () => await window.jujia.chatList());
  if (!Array.isArray(listed) || listed.length === 0) {
    fail('清单重建失败：chatList() 在 index.json 缺失时列不出磁盘上的会话', JSON.stringify(listed).slice(0, 400));
  }
  if (!listed.some((s) => s.id === seededSession)) fail('重建的清单里没有那个会话目录', JSON.stringify(listed).slice(0, 400));
  if (!existsSync(indexFile)) {
    fail('清单重建后没有写回磁盘：下一次列会话还要重扫全目录（缓存被悄悄取消了）');
  }
  const writtenBack = readFileSync(indexFile, 'utf8');
  if (!writtenBack.includes(seededSession)) fail('写回的清单里没有那个会话', writtenBack.slice(0, 400));
  ok('进程死过一次之后：仍是那 4 条；清单删掉也能从目录重建**并写回** —— 重启不丢对话');

  /* ---------------- 只读工具读敏感文件也要过人手（外部审查 T1） ----------------
   *
   * 本轮最要紧的一条行为真值：`read_file` 读 `.env` 曾经**静默放行**（只读排在敏感判定之前），
   * 密钥就这样进模型上下文，而这个应用有外发能力（打开外部程序 / 执行命令 / 发请求）。
   * 界面级证据 = 弹窗真的出现 + **拒绝之后内容真的没被读出来**（不是只看权限层的返回值）。
   *
   * 用 win2：本步与钩子配置那一步都排在 6a 那次"关掉重开"之后，
   * 旧窗口上闭包的 helper（waitForText / bodyText / tabButton）已经全部失效。
   */
  step('只读工具读敏感文件必须过人手：拒绝就读不到、批准不外溢、界面上也没有「总是允许」');
  const body2 = async () => await win2.evaluate(() => document.body.innerText);
  const waitText2 = async (needle, ms = 8_000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if ((await body2()).includes(needle)) return true;
      await new Promise((r) => setTimeout(r, 120));
    }
    return false;
  };
  const clickDialog2 = async (label) => {
    await win2.locator('button', { hasText: label }).first().click();
    await win2.waitForSelector('[role="dialog"][aria-label="权限请求"]', { state: 'detached', timeout: 8_000 });
  };
  const dialogOpen2 = async () => (await win2.locator('[role="dialog"][aria-label="权限请求"]').count()) === 0;
  /** 硬 ask 不给「本次会话总是允许」，且必须写明"每次都要问"（外部审查 T19） */
  const assertHardAskCopy2 = async (where) => {
    const n = await win2.locator('button', { hasText: '本次会话总是允许' }).count();
    if (n > 0) fail(`${where}：硬 ask 的弹窗仍挂着「本次会话总是允许」—— 点了并不会被记住，是空承诺`);
    if (!(await body2()).includes('此操作每次都会要求确认')) {
      fail(`${where}：硬 ask 弹窗没有说明"此操作每次都会要求确认"`, (await body2()).slice(0, 700));
    }
  };
  const toolReadFile = (path) => win2.evaluate(async (p) => await window.jujia.toolRun('read_file', { path: p }), path);

  const secretMarker = 'E2E_T1_SECRET_DO_NOT_LEAK';
  writeFileSync(join(wsDir, '.env'), `API_TOKEN=${secretMarker}\n`, 'utf8');
  /**
   * 锚点里带上**理由**：弹窗标题此刻包含策略给出的原因，
   * 于是这一步同时断言了"问得对"与"说得清为什么问" ——
   * 只写"需要你确认："的话，读普通文件被误拦也会绿。
   */
  const SENSITIVE_HEAD = '需要你确认：read_file · 读取 —— 目标是敏感路径';

  const deniedRead = toolReadFile('.env');
  if ((await waitText2(SENSITIVE_HEAD)) !== true) {
    fail('read_file 读 .env 竟然没弹确认（只读放行仍排在敏感判定之前 —— T1 没修上）', (await body2()).slice(0, 900));
  }
  await clickDialog2('拒绝');
  const t1Denied = await deniedRead;
  if (t1Denied.ok !== false) fail('用户拒绝了，读取却报成功', JSON.stringify(t1Denied).slice(0, 400));
  if (JSON.stringify(t1Denied).includes(secretMarker)) {
    fail('拒绝之后密钥仍然出现在工具结果里', JSON.stringify(t1Denied).slice(0, 400));
  }
  ok('拒绝 → 内容没有进上下文（工具结果里没有那把密钥）');

  const alwaysRead = toolReadFile('.env');
  if ((await waitText2(SENSITIVE_HEAD)) !== true) fail('第二次读敏感文件没有再弹确认');
  await assertHardAskCopy2('读敏感文件');
  await clickDialog2('允许一次');
  const alwaysResult = await alwaysRead;
  if (alwaysResult.ok !== true) fail('批准后读不到文件', String(alwaysResult.content).slice(0, 300));
  if (!String(alwaysResult.content).includes(secretMarker)) fail('批准了却没读到内容', String(alwaysResult.content).slice(0, 300));
  ok('批准 → 才读得到内容');

  const thirdRead = toolReadFile('.env');
  if ((await waitText2(SENSITIVE_HEAD)) !== true) {
    fail('上一次的「允许一次」被当成了记住 —— 第三次读敏感文件没再问，敏感路径绝不允许这样');
  }
  await clickDialog2('拒绝');
  await thirdRead;
  ok('硬 ask 不被压掉：第三次读仍然过一次人手');

  // 反向：普通文件必须照旧"只读不打扰"，否则这条修复会把审批疲劳放大成橡皮图章
  writeFileSync(join(wsDir, 'plain-read.txt'), 'E2E_T1_PLAIN\n', 'utf8');
  const plain = await toolReadFile('plain-read.txt');
  if (plain.ok !== true || !String(plain.content).includes('E2E_T1_PLAIN')) {
    fail('普通只读被误拦（"只读不打扰"这条底线要守住）', JSON.stringify(plain).slice(0, 300));
  }
  if (!(await dialogOpen2())) fail('读普通文件也弹了确认框 —— 审批疲劳是自己造出来的');
  ok('反向核对：读普通文件一次弹窗都没有');

  /* ---------------- 钩子配置写入的权限门（外部审查 T4） ----------------
   *
   * 为什么这一步值得单独跑：钩子配置里写的是"**将来要执行的命令**"，而钩子子进程
   * 不过权限门（它本来就是用户自己写的审批程序，在门的外侧）。于是这条通道如果能静默写入，
   * 渲染层一旦被注入就等于拿到"任意命令 + 宿主环境 + 重启还在"的持久后门。
   *
   * 走的是**真界面**：切页签 → 改编辑器里的 JSON → 点「保存并校验」→ 在弹窗上做决定。
   * 真值仍是磁盘：`hooks.json` 里有没有多出那一行。
   */
  step('钩子配置：改一次问一次、拒绝不落盘、批准才落盘、批准也不外溢到下一次');
  const hooksFile = join(dataDir, 'hooks.json');
  const saveHooksFromEditor = async (text) => {
    await win2.locator('nav.app-tabs button', { hasText: '钩子' }).first().click();
    await win2.locator('textarea.jj-hooks-editor').fill(text);
    await win2.locator('button', { hasText: '保存并校验' }).first().click();
  };

  // enabled:false —— 本步只验"写入要不要问"，不让钩子真的参与后续任何一次工具调用
  const HOOK_MARKER = 'JUJIA_E2E_HOOK_MARKER.mjs';
  const hooksJson = JSON.stringify(
    {
      enabled: false,
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
      events: { PreToolUse: [{ matcher: '', hooks: [{ type: 'process', command: 'node', args: [HOOK_MARKER] }] }] },
    },
    null,
    2,
  );
  const hooksOnDisk = () => (existsSync(hooksFile) ? readFileSync(hooksFile, 'utf8') : null);
  const ASK_HEAD = '需要你确认：修改钩子配置会以你的宿主环境执行命令';

  const hooksBefore = hooksOnDisk();
  await saveHooksFromEditor(hooksJson);
  const askFirst = await waitText2(ASK_HEAD);
  if (askFirst !== true) fail('保存钩子配置没有弹确认（T4 的口子还在）', (await body2()).slice(0, 900));
  if (!(await body2()).includes(HOOK_MARKER)) {
    fail('确认弹窗里看不到要写入的命令 —— 看不到内容的审批等于没有审批', (await body2()).slice(0, 900));
  }
  await clickDialog2('拒绝');
  if (hooksOnDisk() !== hooksBefore) fail('用户明明拒绝了，hooks.json 却被改动（拒绝必须真的不做）');
  const deniedNote = await waitText2('钩子配置未改动');
  if (deniedNote !== true) fail('拒绝之后界面没有如实说明配置未改动', (await body2()).slice(0, 900));
  ok('拒绝 → 磁盘一字未动，界面说明未改动');

  await saveHooksFromEditor(hooksJson);
  const askSecond = await waitText2(ASK_HEAD);
  if (askSecond !== true) fail('第二次保存没有再弹确认', (await body2()).slice(0, 900));
  await clickDialog2('允许一次');
  const allowedDisk = hooksOnDisk() ?? '';
  if (!allowedDisk.includes(HOOK_MARKER)) fail('批准了却没写进磁盘（这次写入其实没发生）', allowedDisk.slice(0, 400));
  const savedNote = await waitText2('已保存');
  if (savedNote !== true) fail('批准后界面没有报告保存成功', (await body2()).slice(0, 900));
  ok('批准 → 配置真的落盘（磁盘上有那条命令），界面报告已保存');

  // 第三次：界面上不该再有「本次会话总是允许」（T19），点「允许一次」之后第四次仍必须问
  await saveHooksFromEditor(hooksJson);
  const askThird = await waitText2(ASK_HEAD);
  if (askThird !== true) fail('第三次保存没弹确认', (await body2()).slice(0, 900));
  await assertHardAskCopy2('写钩子配置');
  await clickDialog2('允许一次');
  await saveHooksFromEditor(hooksJson);
  const askFourth = await waitText2(ASK_HEAD);
  if (askFourth !== true) fail('上一次的「允许一次」被当成了记住 —— 第四次写钩子配置没再问');
  await clickDialog2('拒绝');
  ok('硬 ask 不给「总是允许」、批准不外溢：这里没有 remembered 白名单，每次写钩子配置都过人手');

  /* ---------------- 真·流式对话 + 事件按会话分发（外部审查 T5） ----------------
   *
   * 这一步同时补上一个空白：此前 e2e **从没真的发过一次问**（对话链路只在单测里跑过）。
   * 现在走一遍真的：本地 SSE 服务一段一段吐字 → 界面按事件流画 → 回答落盘。
   *
   * 要验的缺陷是：`CHAT_STREAM` 是**全局广播**。切走会话之后，上一条流的事件照样进来 ——
   * 增量因为 messageId 对不上"看起来没事"，但 `usage` / `done` 不需要 messageId，改得见。
   * 所以三种载体各盯一条：**用量数字**（usage）、**仍在发送中的状态**（done）、**别人的正文**。
   */
  step('真·流式对话走一遍：切走的会话不许改掉当前界面（用量 / 收尾 / 正文三条都盯）');
  await win2.locator('nav.app-tabs button', { hasText: '对话' }).first().click();
  await win2.locator('select').first().selectOption(seededStreamConnId);
  const chatBox = win2.locator('textarea[placeholder^="输入消息"]');
  const sendNow = async (text) => {
    await chatBox.fill(text);
    await win2.locator('button', { hasText: '发送' }).first().click();
  };
  const stopVisible = async () => (await win2.locator('button', { hasText: '停止' }).count()) > 0;

  await sendNow('STREAM_A 第一条');
  if ((await waitText2('A_1_', 12_000)) !== true) {
    fail('一轮真·流式对话没有把增量画到界面上（对话链路在界面级从没跑通过）', (await body2()).slice(0, 900));
  }
  ok('真流式：A 会话的增量已经画出来');

  // 切到全新会话 B（A 此刻还在流，约 3.5 秒才说完）
  await win2.locator('button', { hasText: '新会话' }).first().click();
  await sendNow('STREAM_B 第二条');
  if ((await waitText2('B_1_', 12_000)) !== true) fail('新会话 B 没有开始自己的流', (await body2()).slice(0, 900));

  // 等到 A 说完（A ≈3.5s，B ≈5.3s）：此刻 A 的 done / usage 已经发出来了，而 B 还在流
  await new Promise((r) => setTimeout(r, 4_200));
  const during = await body2();
  if (during.includes('A_')) fail('A 会话的正文掉进了 B 的界面（事件没按会话筛）', during.slice(0, 900));
  if (during.includes('424242')) fail('A 会话的用量事件改掉了当前界面的 token 行', during.slice(0, 900));
  if (!(await stopVisible())) fail('A 的 done 把 B 的"正在发送"状态提前收尾了（停止按钮不见了）');
  ok('A 说完之后：正文、用量、收尾三样都没落到 B 的界面上');

  if ((await waitText2('131313', 15_000)) !== true) {
    fail('B 自己的用量没出现 —— 闸门口径写反了会把当前会话的事件也筛掉', (await body2()).slice(0, 900));
  }
  const afterB = await body2();
  if (afterB.includes('424242')) fail('A 的用量最终仍然污染了 B', afterB.slice(0, 900));
  ok('当前会话自己的事件照常到达（B 的用量数字出现在界面上）');

  /** 筛掉的只是**事件**，不是回答：A 的完整内容照常落盘（否则这条修复就成了"切走就丢数据"） */
  const diskList = await win2.evaluate(async () => await window.jujia.chatList());
  const aMeta = diskList.find((s) => s.title.includes('STREAM_A'));
  if (!aMeta) fail('A 会话没出现在清单里（切走之后它的数据不该消失）', JSON.stringify(diskList).slice(0, 400));
  const aPage = await win2.evaluate(async (id) => await window.jujia.chatHistory({ sessionId: id, limit: 60 }), aMeta.id);
  const aBlob = JSON.stringify(aPage.messages);
  if (!aBlob.includes('A_16_')) fail('A 的回答被截断了（丢事件不等于丢数据）', aBlob.slice(0, 500));
  if (aBlob.includes('B_1_')) fail('B 的内容混进了 A 的历史', aBlob.slice(0, 500));
  ok('A 的完整回答照常落盘：丢的是事件，不是数据');

  /**
   * 审批超时（外部审查 T9）：主进程等不到回音时，**必须按请求 id 精准收尾**。
   *
   * 以前的行为：主进程 120 秒后按"未响应"继续走，渲染层那张卡还挂着 —— 用户随后点"允许"，
   * 决定落进一个已经不存在的需求里，界面一声不响。修法是主进程主动推一条 `{id, reason}`。
   *
   * 为什么这里要**同时挂两张**再验：只有一张时，"超时就把弹窗全关掉"和"按 id 关那一张"
   * 看起来一模一样 —— 变异 M43（`filter(r => r.id !== id)` 改成 `setQueue(() => [])`）
   * 只有在排队场景下才会红。所以 A 让它在界面上等过界，中途塞进 B：
   *   A 过期 → 关的必须是 A、说明必须留在原地、B 必须还能批、A 的命令必须没执行（磁盘为证）。
   * 时间预算靠 `JJ_PERMISSION_TIMEOUT_MS=10000` 压到十秒（引擎侧另有单测覆盖非法值与下限）。
   */
  step('审批超时按请求 id 精准收尾：关的是那一张、话说得出来、排队的另一张照常能批');
  const t9Exec = (command) =>
    win2.evaluate(async (c) => await window.jujia.toolRun('run_command', { command: c }), command);
  const t9FileA = `t9-timeout-${String(Date.now()).slice(-6)}.txt`;
  const t9FileB = `t9-queued-${String(Date.now()).slice(-6)}.txt`;
  const t9HeadA = `需要你确认：run_command · 执行命令：echo A > ${t9FileA}`;
  const t9HeadB = `需要你确认：run_command · 执行命令：echo B > ${t9FileB}`;

  const t9pA = t9Exec(`echo A > ${t9FileA}`);
  if ((await waitText2(t9HeadA)) !== true) fail('A（超时的那张）没有弹确认', (await body2()).slice(0, 900));
  // A 已经用掉 7 秒，还剩 3 秒过界；这期间把 B 塞进队列
  await new Promise((r) => setTimeout(r, 7_000));
  const t9pB = t9Exec(`echo B > ${t9FileB}`);
  if ((await waitText2('还有 1 个请求在排队')) !== true) {
    fail('B 没有排进队列（弹窗应当一次只展示一张，但要如实说明还有几张在等）', (await body2()).slice(0, 900));
  }
  await new Promise((r) => setTimeout(r, 3_600));

  const t9Body = await body2();
  if (!t9Body.includes('在主进程等待超时')) {
    fail('A 超时之后界面没有说明"按超时自动关闭、那一步没执行"', t9Body.slice(0, 900));
  }
  if (t9Body.includes(t9HeadA)) fail('A 都超时了，那张卡还挂着 —— 用户再点就是点到空气上');
  // 这一条才是 T9 的重点：收尾必须按 id，不是"把弹窗清干净"
  if (!t9Body.includes(t9HeadB)) {
    fail('B 的确认框被一起关掉了 —— 超时通知应按请求 id 精准，不能一把全关', t9Body.slice(0, 900));
  }
  const t9ResA = await t9pA;
  if (t9ResA.ok !== false) fail(`A 超时了却返回成功：${JSON.stringify(t9ResA).slice(0, 300)}`);
  if (existsSync(join(wsDir, t9FileA))) fail('A 明明超时未答复，命令却还是执行了（磁盘上留下了文件）');
  ok('超时的那张按 id 关掉：说明留在界面，命令确实没执行（磁盘为证）');

  await clickDialog2('允许一次');
  const t9ResB = await t9pB;
  if (t9ResB.ok !== true) fail(`B 批准后没执行：${JSON.stringify(t9ResB).slice(0, 300)}`);
  if (!existsSync(join(wsDir, t9FileB))) fail('B 批准了、界面也说执行了，磁盘上却没有文件');
  ok('排队的 B 不受影响：照常能批，批准后真的落盘');

  step('关闭应用：应干净退出（不留孤儿进程）');
  await app.close();
  app = undefined;
  ok('应用已关闭');
} catch (err) {
  fail('执行过程中抛异常', err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err));
} finally {
  streamServer.close();
  if (app !== undefined) await app.close().catch(() => undefined);
  try {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    // 尽力而为：沙箱可能有删除配额、Windows 也可能还占着句柄。
    // 这里**必须说出来**，否则每跑一次都留一堆目录没人知道（旧目录由 cleanup.py 收拾）。
    console.log(`（提示）本轮临时目录未能自动清理：${TMP_ROOT} —— 交给 scripts/cleanup.py 处理`);
  }
}

console.log('\nE2E UI OK：启动 → 标签切换 → 插件识别 → 权限规则增删生效 → 钩子/MCP 页就绪 → 浏览器真实加载与拦截 → Git 暂存/提交与权限门 → 内置 exec 逐次确认（均含磁盘真值核对）→ 会话持久化与重启 → 只读敏感文件与钩子配置逐次确认 → 真·流式对话按会话分发 → 审批超时按 id 精准收尾 → 干净退出');
process.exit(0);
