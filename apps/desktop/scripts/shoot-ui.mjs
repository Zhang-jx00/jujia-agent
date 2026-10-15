#!/usr/bin/env node
/* eslint-disable no-undef -- win.evaluate 的回调跑在渲染层上下文里，window/document 在那里是合法的（同 e2e-ui.mjs） */
/**
 * 展示页截图的**可复跑**路径（R32）。
 *
 * 为什么要有它：README「界面一览」那两张图是 R12 手工点的 —— 结果就是
 * ① 没人能重拍（仓里当时 `grep -rln capturePage` = 0 命中），
 * ② 图会悄悄过期（本轮开工实测：两张 PNG 的 mtime 停在 2026-10-13，即 v0.75.0 时代，
 *    而版本已经走到 v0.90.x）。"展示页与实际产物不一致"是对外撒谎的一种，
 * 而且是最容易忘的一种 —— 它不报错、不红、只是慢慢变成假的。
 *
 * 三条纪律：
 * 1. **离屏**（`--shoot` → 主窗口 `webPreferences.offscreen`），不弹到用户脸上、不抢焦点；
 * 2. **数据全隔离**：应用数据根与 Electron 配置目录都在项目内 `.tmp/shoot-<运行标识>/` 下，
 *    **不碰日常那套数据、不写 C 盘**；
 * 3. **演示工作区用一个中性路径**（默认 `D:\JujiaAgentDemo`，可用 `JUJIA_DEMO_WORKSPACE` 覆盖）——
 *    截图是要公开的，界面上显示的绝对路径不能是本机仓库路径（连用户名带出去的那种）。**拍完清场**。
 *
 * 用法：`npm run screenshots`（先构建再拍；直接 `node` 跑会 fail-fast 并说清为什么）
 * 产物：`docs/screenshots/{overview,chat,canvas,files}.png` + `manifest.json`（版本 / 提交 / 尺寸 / 怎么重拍）
 * 退出码：0 = 四张都拍到且有内容；1 = 任何一张缺失、过小、或尺寸不对（宁可不出图，也不出一张假图）
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { _electron as electron } from 'playwright-core';

const runGit = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, '..', '..', '..', 'docs', 'screenshots');

const RUN_ID = `${Date.now().toString(36)}-${process.pid}`;
/**
 * 数据根与 Electron 配置目录**也放中性路径**，不能留在仓库里：
 * 「概览」页会把数据目录原样显示出来，而截图是要公开的 ——
 * 第一版拍出来是"仓库内的 .tmp 路径"（连项目所在的目录结构一起印到 README 上）。
 * 检查器盯的是文本里的本机路径（`check:docs` 第 9/9b 条），**像素它看不见** —— 所以这一步得人来定。
 * （这条护栏本轮还反过来救了我一次：我在这段注释里**写出了那个本机路径当例子**，被第 9 条当场拦下 ——
 *  连"解释为什么不写本机路径"的注释都不该写本机路径，判据不留这个口子是对的。）
 */
const DEMO_ROOT = process.env.JUJIA_DEMO_ROOT ?? 'D:\\JujiaAgentDemoData';
const TMP_ROOT = join(DEMO_ROOT, RUN_ID);
const dataDir = join(TMP_ROOT, 'data');
const profileDir = join(TMP_ROOT, 'profile');
const demoWorkspace = process.env.JUJIA_DEMO_WORKSPACE ?? 'D:\\JujiaAgentDemo';

/** 每张图的"有内容"下限：真实界面 PNG 远大于这个数；空白/截错区域会远小于 */
const MIN_PNG_BYTES = 20_000;
const MIN_W = 1000;
const MIN_H = 600;

const done = [];
const log = (t) => console.log(t);
const ok = (t) => log(`  ✅ ${t}`);
const step = (t) => {
  done.push(t);
  log(`\n[${done.length}] ${t}`);
};
const fail = (t, detail) => {
  console.error(`\n❌ ${t}`);
  if (detail !== undefined) console.error(String(detail).slice(0, 900));
  console.error(`\n已完成步骤：\n${done.map((s) => '  - ' + s).join('\n')}`);
  process.exit(1);
};

/**
 * **拍的是打包产物，不是开发态**。
 *
 * 两个理由，都是撞过的：
 * ① 开发态 `app.getVersion()` 会**回落到 Electron 的版本号**（R11 实测：概览页写着 v44.4.2），
 *    拿它拍"当前版本长什么样"是拍了一张假版本牌；
 * ② 用户装的是打包产物，展示页画的东西必须是**装出去之后**的样子（R12 的结论也是这个）。
 * 所以这里要求打包产物存在（路径见下一段注释：走自己的输出目录）。
 */
/**
 * 打包产物在**自己的输出目录**里（`release/shoot/`），不复用默认的 `release/win-unpacked`。
 *
 * 这条是本轮实测出来的，并且**修正了 R29 记下的结论**：R29 写的是"换输出目录绕不开"，
 * 本轮实测 `--config.directories.output=release/shoot` 一次成功（退出码 0）——
 * 挡住的一直是"把 `.tmp` 改名覆盖到**已存在且被进程握着**的 `win-unpacked`"这一步，
 * 全新的输出目录根本不碰它。本机此刻有 6 个 `electron.exe` 与 2 个 `crashpad_handler.exe`，
 * `Get-Process.Path` 全部取不到 ⇒ **归属不明，照旧不杀**（R29 的纪律不变）。
 */
const packDir = process.env.JUJIA_PACK_DIR ?? join('shoot', 'win-unpacked');
// `here` 是 scripts/ 目录，产物在 desktop 包根下 —— 少写一层 '..' 就会去找 scripts/release/…（本轮实测撞过）
const EXE = join(here, '..', 'release', packDir, 'JujiaAgent.exe');
if (!existsSync(EXE)) {
  console.error(
    `\n[screenshots] 找不到打包产物：${EXE}\n` +
      '  截图必须拍**装出去的那个产物**：开发态的版本号会回落到 Electron 版本（拍出来是 v44.x 这种假版本号），\n' +
      '  而且懒加载 chunk / 原生模块的形态与打包后不同。\n' +
      '  整条跑法：npm run screenshots（它会先 electron-vite build 再打进 release/shoot/）\n',
  );
  process.exit(1);
}

/* ---------------- 演示工作区（中性路径，拍完清场） ---------------- */

const DEMO_FILES = {
  'README.txt': '这是俱佳Agent 演示用的工作区，内容与任何真实项目无关。\r\n里面只有一个待办与一份周会记录。\r\n',
  'notes/todo.md': '# 本周待办\n\n- [x] 把内置终端接进执行审计\n- [ ] 给画布补一次截图重拍\n- [ ] 整理发布页正文\n',
  'docs/weekly.md': '# 周会记录\n\n议题：断点续跑、无头截图、发布前检查单。\n结论：能自动化的判据不要留在人脑里。\n',
};

function makeDemoWorkspace() {
  try {
    mkdirSync(join(demoWorkspace, 'notes'), { recursive: true });
    mkdirSync(join(demoWorkspace, 'docs'), { recursive: true });
    for (const [name, text] of Object.entries(DEMO_FILES)) {
      writeFileSync(join(demoWorkspace, name), text, 'utf8');
    }
    return true;
  } catch (err) {
    console.error(
      `\n[screenshots] 建不出演示工作区：${demoWorkspace}\n` +
        `  原因：${err instanceof Error ? err.message : String(err)}\n` +
        '  这个路径会出现在公开截图里，所以**不许回落到仓库目录**（那会把本机路径与用户名拍进图里）。\n' +
        '  换一个可写的中性路径再跑：JUJIA_DEMO_WORKSPACE=D:\\JujiaAgentDemo npm run screenshots\n',
    );
    process.exit(1);
  }
}

/* ---------------- 假模型服务：只为让对话页有一次真的流式回答 ---------------- */

/**
 * 假回答的文案：**不用 markdown 强调符号**。
 * 第一版写了 `**本地假服务**`，拍出来气泡里就是两个星号 —— 对话气泡走的是纯文本渲染
 * （注入隔离那条纪律：不信任模型输出的 HTML），所以星号会原样上屏。
 * 有星号的截图放在 README 上，读者会以为是渲染坏了，而这正是展示页最不该引起的误会。
 */
const ANSWER_LINES = [
  '这一轮回答来自一个本地假服务（127.0.0.1），',
  '为的是让截图里的对话页是真渲染出来的：气泡、代码块、工具卡都是真组件。\n',
  '重拍这些图只要一条命令：\n\nnpm run screenshots\n',
  '数据不出本机 —— 端点、工作区、会话记录都在这台机器上。',
];

function startFakeModel() {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += String(c)));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      void (async () => {
        for (const line of ANSWER_LINES) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: line } }] })}\n\n`);
          await new Promise((r) => setTimeout(r, 90));
        }
        res.write(`data: ${JSON.stringify({ usage: { prompt_tokens: 812, completion_tokens: 96 } })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      })();
    });
  });
  server.listen(0, '127.0.0.1');
  return server;
}

/* ---------------- 种子配置 / 连接 / 画布图 ---------------- */

const envOf = (extra) => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.JUJIA_DATA_BASE_DIR = dataDir;
  return { ...env, ...extra };
};

function seedConfig() {
  mkdirSync(dataDir, { recursive: true });
  /**
   * 字段名以**应用真正读的那份**为准（第一次跑栽在这里：写了 `workspaceRoot`，
   * 而 config 里那格叫 `workspace` —— 于是画布的工具节点拿到 `__no_workspace__`，
   * 报"工作区目录不存在"，画布那张图拍出来是失败态）。
   * 形状直接照 `e2e-ui.mjs` 里那份种子（它跑在真应用上，是被验证过的）。
   */
  writeFileSync(
    join(dataDir, 'config.json'),
    JSON.stringify(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        data: {
          theme: 'dark',
          workspace: demoWorkspace,
          appearance: { packId: 'default-dark', pack: null },
        },
      },
      null,
      2,
    ),
    'utf8',
  );
}

function seedConnection(port) {
  const now = new Date().toISOString();
  writeFileSync(
    join(dataDir, 'connections.json'),
    JSON.stringify(
      {
        version: 1,
        updatedAt: now,
        data: {
          connections: [
            {
              id: 'shoot-demo-1',
              name: '演示模型（本地假服务）',
              baseUrl: `http://127.0.0.1:${String(port)}/v1`,
              apiFormat: 'openai-compatible',
              model: 'demo-model',
              // 这条**要真的发问**，所以给一个非 null 的密钥：scheme 'plain' 是真实存在的落盘形态，
              // 值是假的 —— 本地假服务不看 Authorization，密钥也绝不离开这台机器
              secret: { scheme: 'plain', value: 'shoot-local-only' },
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
      },
      null,
      2,
    ),
    'utf8',
  );
}

/**
 * 画布图走**应用自己的信封形状** `{ version, updatedAt, data }`。
 * （R31 的教训：`verify:pack` 第一次真跑就是因为夹具少写了信封层，
 *  报出来的红指向"打包产物坏了"，真相是夹具不像真的 —— 同一件事不在两个脚本里各犯一次。）
 */
function seedCanvas() {
  const dir = join(dataDir, 'canvas');
  mkdirSync(dir, { recursive: true });
  const graph = {
    version: 1,
    connectionId: 'shoot-demo-1',
    nodes: [
      { id: 'a', kind: 'tool', x: 60, y: 80, config: { toolName: 'list_dir', argsText: '{"path":"."}' } },
      {
        id: 'b',
        kind: 'tool',
        x: 420,
        y: 80,
        config: { toolName: 'read_file', argsText: '{"path":"notes/todo.md"}' },
      },
    ],
    edges: [{ id: 'e1', from: 'a', to: 'b' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  writeFileSync(
    join(dir, 'shoot-demo-chain.json'),
    JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), data: graph }, null, 2),
    'utf8',
  );
}

/* ---------------- 像素体检：不解码，只读 PNG 头 ---------------- */

function pngSize(file) {
  const buf = readFileSync(file);
  // PNG: 8 字节签名 + IHDR(长度4 + 类型4 + 宽4 + 高4)
  if (buf.length < 24 || buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bytes: buf.length };
}

/* ---------------- 主流程 ---------------- */

const server = startFakeModel();
await new Promise((r) => server.once('listening', r));
const port = server.address().port;

let app;
try {
  step('准备隔离目录与演示工作区（中性路径，拍完清场）');
  /**
   * **在任何写入之前**取工作区的干净程度，并且**排除 `docs/screenshots/`**（本脚本自己的产物）。
   *
   * 为什么要改这一手（复核 089 自己抓自己）：第一版把这件事写在最后一步，于是"重拍一次"这件事
   * 本身就把四张已提交的 PNG 改成未提交状态 ⇒ `dirtyAtCapture` **永远是 true** ——
   * 一个恒真的字段等于没有字段，还会让人以为"每次重拍都不干净"，把真信号磨成背景噪声。
   * 取"进产物之前"的状态才是这里真正要说的：**打包用的那份代码是不是那一次提交**。
   */
  const repoRootForGit = join(here, '..', '..', '..');
  const dirtyRes = await runGit(
    'git',
    ['status', '--porcelain', '--untracked-files=no', '--', '.', ':(exclude)docs/screenshots'],
    { cwd: repoRootForGit },
  );
  const dirtyAtStart = dirtyRes.stdout.trim() !== '';
  const dirtyFiles = dirtyRes.stdout
    .trim()
    .split('\n')
    .filter((l) => l !== '')
    .slice(0, 6)
    .map((l) => l.slice(0, 60))
    .join(' | ');
  ok(`拍前工作区：${dirtyAtStart ? `有未提交改动 —— ${dirtyFiles}` : '干净（产物将记 dirtyAtCapture:false）'}`);
  mkdirSync(profileDir, { recursive: true });
  if (!makeDemoWorkspace()) fail('演示工作区没建起来');
  seedConfig();
  seedConnection(port);
  seedCanvas();
  ok(`数据根 ${dataDir} · 演示工作区 ${demoWorkspace}`);

  step('离屏启动**打包版**（--shoot：窗口不进屏幕，像素照样画）');
  app = await electron.launch({
    executablePath: EXE,
    args: [`--user-data-dir=${profileDir}`, '--shoot'],
    env: envOf({}),
  });
  const win = await app.firstWindow();
  await win.waitForSelector('nav.app-tabs', { timeout: 30_000 });
  ok('渲染层已就绪（标签栏出现）');

  /**
   * **开工先验种子有没有生效**：第一次跑是画布那步才报"工作区目录不存在"，
   * 而真因在更早的 config 种子上（字段名写错），症状与病灶隔了两步。
   * 这一句把诊断拉回它该在的地方 —— 也是"断言别抢跑"的反面用法：**先确认前提，再去测结论**。
   */
  const wsSeen = await win.evaluate(async () => {
    const got = await window.jujia.configGet();
    return String(got?.config?.workspace ?? '');
  });
  if (wsSeen !== demoWorkspace) {
    fail(
      `种下去的工作区没生效：读到 "${wsSeen}"，应为 "${demoWorkspace}"` +
        '（config 里那格叫 workspace，不叫 workspaceRoot —— 种错字段的话画布会以 __no_workspace__ 跑）',
    );
  }
  ok(`工作区种子已生效：${wsSeen}`);

  const tab = (label) => win.locator('nav.app-tabs button', { hasText: label }).first();
  const waitText = async (needle, ms = 20_000) => {
    try {
      await win.waitForFunction((n) => document.body.innerText.includes(n), needle, { timeout: ms });
      return true;
    } catch {
      return false;
    }
  };
  const shot = async (file, tabName, anchor, miss) => {
    await tab(tabName).click();
    if ((await waitText(anchor)) !== true) fail(`「${tabName}」页没等到锚点文本：${anchor}`, miss);
    const path = join(OUT_DIR, file);
    await win.screenshot({ path });
    const s = pngSize(path);
    if (s === null) fail(`${file} 不是合法 PNG`);
    if (s.bytes < MIN_PNG_BYTES) fail(`${file} 只有 ${String(s.bytes)} 字节，低于下限 ${String(MIN_PNG_BYTES)}`);
    if (s.w < MIN_W || s.h < MIN_H) fail(`${file} 尺寸 ${String(s.w)}×${String(s.h)}，低于 ${String(MIN_W)}×${String(MIN_H)}`);
    ok(`${file} · ${String(s.w)}×${String(s.h)} · ${(String(Math.round(s.bytes / 1024)))}KB`);
    return s;
  };

  step('拍「概览」页');
  const overview = await shot(
    'overview.png',
    '概览',
    '工作区',
    await win.evaluate(() => document.body.innerText.slice(0, 400)),
  );

  step('拍「对话」页（先真的发一轮，让回答是流式跑出来的而不是摆拍）');
  await tab('对话').click();
  /**
   * 等的是**输入框这个元素**，不是 `innerText` 里的"输入消息" ——
   * placeholder 不进 innerText，第一次跑就栽在这里（等了 20 秒判"没挂上输入框"，
   * 而界面其实是好的）。凡是"等一个只有属性没有文本的东西"，都得用选择器而不是文本轮询。
   */
  try {
    await win.locator('textarea[placeholder^="输入消息"]').waitFor({ timeout: 20_000 });
  } catch {
    fail('对话页没挂上输入框（选择器等不到）', await win.evaluate(() => document.body.innerText.slice(0, 600)));
  }
  await win.locator('select').first().selectOption('shoot-demo-1');
  await win.locator('textarea[placeholder^="输入消息"]').fill('给我看一下这个界面是怎么渲染的');
  await win.locator('button', { hasText: '发送' }).first().click();
  if ((await waitText('数据不出本机', 30_000)) !== true) {
    fail('假服务的回答没到界面上（那这张图拍的是空会话，等于白拍）', await win.evaluate(() => document.body.innerText.slice(0, 600)));
  }
  /**
   * **等到正文 ≠ 流已收尾**。第一版拍完回头看图，发现「停止」按钮还挂着、气泡末尾带着光标 ——
   * 那是"正在说"的一帧，而 README 的图注写的是"一次真流式回答**之后**"（对外声称与像素不符，
   * 属于本轮立这条护栏最想防的那类事）。所以等发送态真的结束再拍：
   * 判据取 `.w2-chat` 里那颗「发送」按钮的 `disabled`（流式期间它是禁用的，`ChatPanel` 里写的是
   * `disabled={pendingBusy || sending}`），**限定在对话面板内** —— 别的页签是 KeepAlive 挂着的隐藏面板，
   * 全页扫 `hasText:'停止'` 会被它们骗住。等不到就 fail-fast：宁可不出图，也不出一张与图注不符的图。
   */
  const sendBtn = win.locator('.w2-chat button', { hasText: '发送' }).first();
  const closed = async () => !(await sendBtn.isDisabled());
  const closeDeadline = Date.now() + 20_000;
  while (Date.now() < closeDeadline && !(await closed())) {
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!(await closed())) {
    fail('回答的流没收尾（「发送」仍是禁用态），这张图拍的是"正在说"而不是"说完"，与图注不符');
  }
  const chat = await shot('chat.png', '对话', '数据不出本机', '回答文本与收尾都在拍前验过，此处不应失败');

  step('拍「画布」页（先真的跑一遍两节点链，让节点状态是真值）');
  await tab('画布').click();
  if ((await waitText('运行这张图')) !== true) fail('画布页没渲染出来');
  await win.locator('button[data-graph-id="shoot-demo-chain"]').first().click({ timeout: 20_000 });
  if ((await waitText('已打开 shoot-demo-chain')) !== true) {
    fail('从盘上打开那张两节点图失败（信封形状不对？路径不对？）', await win.evaluate(() => document.body.innerText.slice(0, 600)));
  }
  await win.locator('button', { hasText: '运行这张图' }).first().click();
  if ((await waitText('跑完了', 40_000)) !== true) {
    fail('画布没跑完（节点状态会是空的，这张图就没有说服力）', await win.evaluate(() => document.body.innerText.slice(-800)));
  }
  const canvas = await shot('canvas.png', '画布', '跑完了', '同上');

  step('拍「文件」页（工作区树展开，显示的是演示工作区）');
  await tab('文件').click();
  /**
   * 锚点取**根级那份 README.txt**，不取 `notes/todo.md` 里的文件名 ——
   * 文件树默认只展开一层，`todo.md` 在 `notes/` 里没展开就看不见（第一次跑正是这样误判成
   * "懒加载没取到"）。判据要落在**这一步真的会产生变化的东西**上，不然红的是脚本自己。
   */
  if ((await waitText('README.txt')) !== true) {
    fail('文件树里看不到演示文件（工作区没设上？懒加载 chunk 没取到？）', await win.evaluate(() => document.body.innerText.slice(0, 600)));
  }
  /**
   * 再点开一份文件：只拍"树 + 一片空白右栏"的截图没有信息量（第一版就是这样）。
   *
   * 但**锚点不能查 `innerText`**：文本编辑器是 `<textarea>`，它的值不在 innerText 里 ——
   * 第一次跑就在这里误判成"右栏没正文"，而截图里明明开着 README.txt（保存 / 另存为 都在）。
   * 所以正文这件事要**读那个控件的值**，可见的编辑器外壳才用文本锚点等。
   */
  await win.locator('text=README.txt').first().click();
  if ((await waitText('另存为', 15_000)) !== true) {
    fail('点开 README.txt 之后编辑器没打开（没有"另存为"那排控件）', await win.evaluate(() => document.body.innerText.slice(0, 800)));
  }
  const editorHasText = async () =>
    win.evaluate((needle) => {
      // 扫**所有** textarea 而不是取第一个：切页签不丢状态意味着对话页那个输入框可能仍挂着，
      // 只取第一个就会拿"输入框是空的"误判成"编辑器是空的"
      const nodes = Array.from(document.querySelectorAll('textarea'));
      return nodes.some((ta) => ta.value.includes(needle));
    }, '演示用的工作区');
  let editorOk = false;
  for (let i = 0; i < 40; i += 1) {
    if (await editorHasText()) {
      editorOk = true;
      break;
    }
    await win.waitForTimeout(150);
  }
  if (!editorOk) {
    fail(
      '编辑器打开了但值是空的（文件内容没读进来 —— 那这张图拍的是"打不开文件"）',
      await win.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('textarea'));
        return nodes.length === 0
          ? '页面上没有 textarea 控件'
          : nodes.map((ta, i) => `#${String(i)} 长度 ${String(ta.value.length)}`).join(' · ');
      }),
    );
  }
  const files = await shot('files.png', '文件', '另存为', '上一条刚验过编辑器有正文，这里不应失败');

  step('写清单 manifest.json（版本 / 提交 / 尺寸 / 怎么重拍）');
  const version = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version;
  const head = (await runGit('git', ['rev-parse', '--short', 'HEAD'])).stdout.trim();
  /**
   * `dirty` 是这张清单的诚实性所在：`commit` 只说"基于哪一笔"，而打包产物里可能混着**未提交**的改动 ——
   * 第一版就是这样（图里已经带上本轮新加的离屏开关，而 manifest 记的提交里还没有它）。
   * 与其让读者以为图与那次提交一一对应，不如把"当时工作区不干净"直接写进清单。
   * 值取**拍之前**那次（并排除本脚本自己的产物 `docs/screenshots/`），理由见上面那段注释。
   */
  const dirty = dirtyAtStart;
  writeFileSync(
    join(OUT_DIR, 'manifest.json'),
    JSON.stringify(
      {
        version,
        commit: head,
        dirtyAtCapture: dirty,
        capturedAt: new Date().toISOString(),
        howToReshoot: 'npm run screenshots（离屏，不弹窗口；演示工作区拍完清场）',
        demoWorkspace,
        viewport: { window: '1280x840' },
        shots: [
          { file: 'overview.png', tab: '概览', ...overview },
          { file: 'chat.png', tab: '对话（一次真流式回答之后）', ...chat },
          { file: 'canvas.png', tab: '画布（两节点链跑完之后）', ...canvas },
          { file: 'files.png', tab: '文件（工作区树展开）', ...files },
        ],
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  ok(`manifest 记的是 v${version} @ ${head}`);

  step('干净退出并清场');
  await app.close();
  app = undefined;
  rmSync(TMP_ROOT, { recursive: true, force: true });
  if (process.env.JUJIA_KEEP_DEMO !== '1') rmSync(demoWorkspace, { recursive: true, force: true });
  ok(`临时目录已清；演示工作区${process.env.JUJIA_KEEP_DEMO === '1' ? '按 JUJIA_KEEP_DEMO=1 保留' : '已删除'}`);

  console.log('\nSCREENSHOTS OK：四张图都有内容、尺寸达标，清单与版本对齐');
  process.exit(0);
} catch (err) {
  fail(`执行中抛异常：${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? err.stack : undefined);
} finally {
  if (app !== undefined) await app.close().catch(() => undefined);
  server.close();
  try {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    log(`（提示）本轮临时目录未能自动清理：${TMP_ROOT} —— 交给 scripts/cleanup.py`);
  }
}
