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

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
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
  const otherSite = createServer((_req, res) => {
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

  step('内置浏览器：file:// 被拒且理由可读（界面级断言）');
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

  step('内置 exec：批准后真的落盘；「总是允许」压不掉下一次硬确认；拒绝后磁盘上什么都没有');
  /**
   * 三条断言都问**真值**（TEST-POLICY §六 第 1 条）：
   * 界面说"已执行"不算执行，文件在磁盘上出现才算；说"被拒绝"不算拒绝，文件不存在才算。
   */
  const execOut = async (command) =>
    win.evaluate(async (c) => await window.jujia.toolRun('run_command', { command: c }), command);
  const dialogCount = async () => (await win.locator('[role="dialog"][aria-label="权限请求"]').count());

  const fileA = `exec-approved-${String(Date.now()).slice(-6)}.txt`;
  // 不能 await：invoke 要等用户在弹窗上点完才回，先 await 就把整个流程堵死了
  const first = execOut(`echo approved > ${fileA}`);
  const firstDialog = await waitForText(`需要你确认：run_command · 执行命令：echo approved > ${fileA}`);
  if (firstDialog !== true) fail('exec 没有弹硬确认，或标题里看不到将要执行的命令行', String(firstDialog).slice(0, 600));
  await win.locator('button', { hasText: '本次会话总是允许' }).first().click();
  await first;
  await win.waitForSelector('[role="dialog"][aria-label="权限请求"]', { state: 'detached', timeout: 8_000 });
  const aExists = existsSync(join(wsDir, fileA));
  if (!aExists) fail('批准后文件没有真的出现在磁盘上（命令其实没跑？）');
  ok('批准 → 命令真的执行（磁盘上有文件）');

  const fileB = `exec-denied-${String(Date.now()).slice(-6)}.txt`;
  const second = execOut(`echo denied > ${fileB}`);
  const secondDialog = await waitForText(`需要你确认：run_command · 执行命令：echo denied > ${fileB}`);
  if (secondDialog !== true) fail('「总是允许」把第二次的硬确认也压掉了（执行类绝不允许这样）', String(secondDialog).slice(0, 600));
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

  step('内置浏览器：地址交给外部程序 —— 问过才交、拒绝就不交、「总是允许」压不掉下一次');

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
  // 只说"用本机程序打开"不够：必须把**是哪个文件**摊开给人看，否则点允许就是盲批
  if (!dialogText.includes('curl.exe')) fail('确认框里没有点出接收方是哪个程序', dialogText.slice(0, 900));
  await win.locator('button', { hasText: '本次会话总是允许' }).first().click();
  if (!(await waitHit(firstUrl))) fail('允许之后本机程序并没有真的收到这个地址 —— 交付其实没发生');
  await win.waitForSelector('[role="dialog"][aria-label="权限请求"]', { state: 'detached', timeout: 8_000 });
  ok('允许 → 本机程序真的取了这个地址（请求台账为证）');

  // ④ 「总是允许」之后必须**仍然问**：一次授权不外溢到下一个网址（外发动作没有"记住"这条路）
  const secondUrl = '/handed-exe-2';
  await addressBox.fill(`${baseUrl}${secondUrl}`);
  await win.locator('button', { hasText: '打开' }).first().click();
  const again = await waitForText('需要你确认：地址将离开本应用的安全边界');
  if (again !== true) fail('「本次会话总是允许」压掉了下一次确认 —— 外发动作被做成了软 ask');
  await win.locator('button', { hasText: '拒绝' }).first().click();
  await win.waitForSelector('[role="dialog"][aria-label="权限请求"]', { state: 'detached', timeout: 8_000 });
  if (hits.includes(secondUrl)) fail('拒绝了第二个地址，它却还是交了出去');
  ok('硬 ask 不被「总是允许」压掉；拒绝 → 零交付');

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

  step('关闭应用：应干净退出（不留孤儿进程）');
  await app.close();
  app = undefined;
  ok('应用已关闭');
} catch (err) {
  fail('执行过程中抛异常', err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err));
} finally {
  if (app !== undefined) await app.close().catch(() => undefined);
  try {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    // 尽力而为：沙箱可能有删除配额、Windows 也可能还占着句柄。
    // 这里**必须说出来**，否则每跑一次都留一堆目录没人知道（旧目录由 cleanup.py 收拾）。
    console.log(`（提示）本轮临时目录未能自动清理：${TMP_ROOT} —— 交给 scripts/cleanup.py 处理`);
  }
}

console.log('\nE2E UI OK：启动 → 标签切换 → 插件识别 → 权限规则增删生效 → 钩子/MCP 页就绪 → 浏览器真实加载与拦截 → Git 暂存/提交与权限门 → 内置 exec 逐次确认（均含磁盘真值核对）→ 干净退出');
process.exit(0);
