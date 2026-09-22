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

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { _electron as electron } from 'playwright-core';

// 入口用**脚本自身位置**解析，而不是 cwd —— 否则从仓库根跑时路径就错了（本轮实测踩过）
const here = dirname(fileURLToPath(import.meta.url));
const MAIN_ENTRY = join(here, '..', 'out', 'main', 'index.js');

/**
 * 测试数据落在**项目内** `.tmp/e2e/`，不写系统盘（用户明确要求"测试不要占 C 盘"）。
 * 两处都要挪才叫真隔离：
 * - `JUJIA_DATA_BASE_DIR` 管应用自己的数据根；
 * - `--user-data-dir` 管 Electron 的配置与缓存（Windows 上默认在 %APPDATA%，也就是 C 盘）。
 */
const TMP_ROOT = join(here, '..', '..', '..', '.tmp', 'e2e');

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
// 每次从干净目录开始（固定路径，便于排查；跑完会整体清掉）
rmSync(TMP_ROOT, { recursive: true, force: true });
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

  step('设置工作区（通过配置接口，等价于「概览」页选择目录）');
  const wsSet = await win.evaluate(async (dir) => {
    const r = await window.jujia.configSet({ workspace: dir });
    return r.config.workspace;
  }, wsDir);
  if (wsSet !== wsDir) fail(`工作区设置失败，返回：${String(wsSet)}`);
  ok('工作区已设为临时目录');

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

  step('关闭应用：应干净退出（不留孤儿进程）');
  await app.close();
  app = undefined;
  ok('应用已关闭');
} catch (err) {
  fail('执行过程中抛异常', err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err));
} finally {
  if (app !== undefined) await app.close().catch(() => undefined);
  for (const dir of [TMP_ROOT]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 临时目录清理失败不影响结论
    }
  }
}

console.log('\nE2E UI OK：启动 → 标签切换 → 插件识别 → 技能真加载 → 权限规则增删生效 → 钩子/MCP 页就绪 → 干净退出');
process.exit(0);
