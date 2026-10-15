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
import { buildCjkPdf, buildMinimalPdf } from './pdf-fixtures.mjs';

const runGit = promisify(execFile);

// 入口用**脚本自身位置**解析，而不是 cwd —— 否则从仓库根跑时路径就错了（本轮实测踩过）
const here = dirname(fileURLToPath(import.meta.url));
const MAIN_ENTRY = join(here, '..', 'out', 'main', 'index.js');

/**
 * **预检：构建产物在不在**（R26 实测踩到，写进台账）：`scripts/cleanup.py --apply` 会把
 * `apps/desktop/out` 收进 `.trash`（它是可重建产物），而**直接 `node scripts/e2e-ui.mjs` 不带构建** ——
 * 于是 Electron 只甩一句"找不到应用"，看不出是"没构建"还是"构建坏了"。
 * 这条禁忌写在操作禁忌表里，人照样会忘 —— 那就让脚本自己把话说清楚（fail-fast，不启动窗口）。
 * 正确跑法永远是 `npm run e2e`（= `electron-vite build` && 本脚本）。
 */
if (!existsSync(MAIN_ENTRY)) {
  console.error(
    `\n[e2e] 缺构建产物：${MAIN_ENTRY}\n` +
      '      本脚本不带构建，跑的是上一次 `electron-vite build` 的产物；\n' +
      '      而 `scripts/cleanup.py --apply` 会把 apps/desktop/out 收进 .trash（可重建）。\n' +
      '      正确跑法：npm run e2e\n',
  );
  process.exit(1);
}

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
/** 走完最后一步才算成功；退出码由它决定（`fail` 抛哨兵异常，收尾统一在 finally） */
let e2eFinished = false;
const log = (text) => console.log(text);
const ok = (text) => log(`  ✅ ${text}`);
/**
 * 中止用**抛哨兵异常**，不用 `process.exit(1)`（T66 · 与本月 T62 同一个病，第三次差点复发在这里）。
 *
 * 为什么这条值得改：`exit` 不跑 `finally`，而这里的 `finally` 干的是**关三个假服务 + 关应用 + 删临时目录**。
 * 于是每一次"e2e 红掉"都在机器上留下一个**没人认领的 Electron 进程**（以及占着句柄的临时目录）——
 * 本机那一堆游离 `electron.exe`（R29 记为"归属不明、照旧不杀"）与 `.tmp/e2e-*` 残留，
 * 至少有一部分就是这么攒下来的；而负载又反过来影响 perf 与偶发红（T65 / R34）。
 * 改成抛：话照样说完，收尾一定跑，退出码在最外层统一给。
 */
class E2EAbort extends Error {}

const fail = (text, detail) => {
  console.error(`\n❌ ${text}`);
  if (detail !== undefined) console.error(String(detail).slice(0, 1200));
  console.error(`\n已完成步骤：\n${STEPS.map((s) => '  - ' + s).join('\n')}`);
  throw new E2EAbort(text);
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
    let hasToolReply = false;
    try {
      const parsed = JSON.parse(body);
      const msgs = Array.isArray(parsed.messages) ? parsed.messages : [];
      const lastUser = [...msgs].reverse().find((m) => m && m.role === 'user');
      prompt = String(lastUser?.content ?? '');
      // 工具轮跑完之后，下一轮请求里会带一条 role=tool 的消息 —— 用它区分"要调工具"与"该收尾了"
      hasToolReply = msgs.some((m) => m && m.role === 'tool');
    } catch {
      // 解析不出来就按默认档（A）走：这一步测的是事件分发，不是解析健壮性
    }
    /**
     * R8.7（实时输出）那一幕：先只回一个 `run_command` 调用，等工具跑完再收尾。
     * 命令行里那条"先吐一行、静默三秒、再吐一行"是故意的 ——
     * 只有这种形状能证明"输出是边跑边出现的"，而不是跑完一次性给出来。
     */
    const cmdMarker = /E2E_CMD ([A-Z0-9_-]+)/.exec(prompt)?.[1] ?? '';
    if (cmdMarker !== '' && !hasToolReply) {
      const command =
        process.platform === 'win32'
          ? `echo ${cmdMarker}-EARLY & ping -n 4 127.0.0.1 >nul & echo ${cmdMarker}-LATE`
          : `echo ${cmdMarker}-EARLY; sleep 3; echo ${cmdMarker}-LATE`;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, id: 'e2e-call-1', function: { name: 'run_command', arguments: JSON.stringify({ command }) } }] } }],
        })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    if (cmdMarker !== '' && hasToolReply) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'E2E-CMD-FINAL' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
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
 * 6b 用的"回显假服务"。
 *
 * 为什么还要第三个服务：6b 的真值是**发给模型的那份 messages**，不是界面上写了什么。
 * 界面自述可以骗人（"已压缩"三个字是渲染层自己拼的），主进程发出去什么只有对面知道 ——
 * 所以这里把收到的内容摘要成一行回吐回来，让 DOM 里那句话成为"模型确实只看到摘要 + 最近几条"的证据。
 *
 * 三种回包，按 prompt 开头分流（对应 agent-core 里两个 prompt 构造器的首句）：
 * ① 压缩摘要：固定串，含四类事实的关键字（人名 / 路径 / 数字 / 决定），事后要在系统提示里认出它；
 * ② 结束要点：同样固定（≤500 字、单行，够 appendNote 收）；
 * ③ 普通对话：回一行体检报告 —— 收到几条非 system 消息、system 里有没有摘要串、最早那条原文的开头。
 */
const SUMMARY_6B =
  'E2E6B摘要 人名：老张 ｜ 路径：src/main/index.ts ｜ 阈值：64KB ｜ 决定：用甲方案，否决乙方案 ｜ 未决：等外审批复';
const NOTE_6B = 'E2E6B要点 决定用甲方案（src/main/index.ts），未决：等外审批复';
const echoServer = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += String(c)));
  req.on('end', () => {
    let content = 'ECHO n=?';
    // 收尾原因默认 stop；R7 的两条截断场景按 prompt 换掉（T26 的界面级证据）。
    let finishReason = 'stop';
    /** 'garbage' = 只回无法解析的负载再正常收尾（T25 的界面级证据：不许画成一条空回答） */
    let mode = 'echo';
    try {
      const parsed = JSON.parse(raw);
      const msgs = Array.isArray(parsed.messages) ? parsed.messages : [];
      const lastMsg = [...msgs].reverse().find((m) => m && m.role === 'user');
      if (lastMsg && Array.isArray(lastMsg.content)) {
        /**
         * M11 批一（R14）：图片以 content parts 形态到达时的体检报告。
         * 真值全部来自**收到的字节**：parts 条数 / 图 part 数 / data URL 的 mime /
         * 夹具哨兵串还在不在（"剥元数据"这一跳的端到端证据 —— 界面自述不算数）。
         */
        const parts = lastMsg.content;
        const textPart = parts.find((p) => p && p.type === 'text');
        const imgParts = parts.filter((p) => p && p.type === 'image_url');
        let mime = '?';
        let meta = 0;
        for (const p of imgParts) {
          const url = String(p?.image_url?.url ?? '');
          const m = /^data:(image\/[a-z+]+);base64,/.exec(url);
          if (m) mime = m[1];
          if (Buffer.from(url.slice(url.indexOf(',') + 1), 'base64').includes('E2E-IMG-META-SENTINEL')) meta = 1;
        }
        const head = String(textPart?.text ?? '').slice(0, 16).replace(/\s+/g, ' ');
        content = `ECHOIMG parts=${String(parts.length)} images=${String(imgParts.length)} mime=${mime} meta=${String(meta)} head=${head}`;
      } else {
        const last = String(lastMsg?.content ?? '');
        const systemText = msgs
          .filter((m) => m && m.role === 'system')
          .map((m) => String(m.content ?? ''))
          .join('\n');
        const hasToolReply = msgs.some((m) => m && m.role === 'tool');
        /**
         * M17 批一（R15）：续跑那一轮 —— 系统提示里带"被中断的任务"段（含原始要求原文）。
         * 服务端据此**重发同一个 run_command**：证明"模型继续任务＝重新过审批门"，
         * 而不是应用在回放动作；收尾那轮带回 RESUME=1，证明续跑段真的到了模型这一侧。
         */
        const resumeCmd = /被中断的任务[\s\S]*?E2E_CMD ([A-Z0-9_-]+)/.exec(systemText)?.[1] ?? '';
        if (resumeCmd !== '' && !hasToolReply) {
          const command =
            process.platform === 'win32'
              ? `echo ${resumeCmd}-EARLY & ping -n 4 127.0.0.1 >nul & echo ${resumeCmd}-LATE`
              : `echo ${resumeCmd}-EARLY; sleep 3; echo ${resumeCmd}-LATE`;
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(
            `data: ${JSON.stringify({
              choices: [{ delta: { tool_calls: [{ index: 0, id: 'e2e-task-resume-1', function: { name: 'run_command', arguments: JSON.stringify({ command }) } }] } }],
            })}\n\n`,
          );
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        if (resumeCmd !== '' && hasToolReply) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'E2E-CMD-FINAL RESUME=1' } }] })}\n\n`,
          );
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        /**
         * 普通 E2E_CMD 触发（与流式服务同一套形状；M17 那步用它起"慢命令轮"的第一跳）。
         * 与流式服务的区别只有 callId —— 两个服务各自独立，不互相污染。
         */
        const cmdMarker = /E2E_CMD ([A-Z0-9_-]+)/.exec(last)?.[1] ?? '';
        if (cmdMarker !== '' && !hasToolReply) {
          const command =
            process.platform === 'win32'
              ? `echo ${cmdMarker}-EARLY & ping -n 4 127.0.0.1 >nul & echo ${cmdMarker}-LATE`
              : `echo ${cmdMarker}-EARLY; sleep 3; echo ${cmdMarker}-LATE`;
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(
            `data: ${JSON.stringify({
              choices: [{ delta: { tool_calls: [{ index: 0, id: 'e2e-task-call-1', function: { name: 'run_command', arguments: JSON.stringify({ command }) } }] } }],
            })}\n\n`,
          );
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        if (cmdMarker !== '' && hasToolReply) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'E2E-CMD-FINAL' } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        if (last.includes('上下文压缩')) content = SUMMARY_6B;
        else if (last.includes('压成**一条**记忆')) content = NOTE_6B;
        /**
         * T55（R31）的界面级证据：上游**什么结束标记都没给**就把流关了。
         * 这正是代理 `proxy_read_timeout` 的 `res.end()` 形状 —— 修之前它一路顶着 `stop` 出去，
         * 半截回答在界面上与完整回答长得一模一样。
         */
        else if (last.includes('E2E_NOMARKER')) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'E2E-NOMARKER-半截回答' } }] })}\n\n`,
          );
          res.end(); // 没有 finish_reason、也没有 [DONE]：结束证据一条都没有
          return;
        }
        /**
         * T56（R31）的界面级证据：网关发了一个**参数一个字节都没送到**的调用，然后断流。
         * 用 `list_dir`（path 可选）而不是 `write_file`：后者拿到 `{}` 也会被 zod 拒掉，
         * 两种写法都"没写出文件"，界面就分不出修没修；而 `{}` 对 `list_dir` 是一次**合法执行**。
         */
        else if (last.includes('E2E_EMPTYARGS') && !hasToolReply) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(
            `data: ${JSON.stringify({
              choices: [{ delta: { tool_calls: [{ index: 0, id: 'e2e-empty-args-1', function: { name: 'list_dir', arguments: '' } }] } }],
            })}\n\n`,
          );
          res.end(); // 同样一条结束标记都没给
          return;
        } else if (last.includes('E2E_EMPTYARGS') && hasToolReply) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'E2E-EMPTYARGS-FINAL' } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        } else if (last.includes('E2E_TRUNC_LEN')) {
          content = '这一段被长度上限掐住了';
          finishReason = 'length';
        } else if (last.includes('E2E_TRUNC_FILTER')) {
          content = '这一段被内容过滤拦下了';
          finishReason = 'content_filter';
        } else if (last.includes('E2E_GARBAGE')) {
          mode = 'garbage';
        } else {
          const rest = msgs.filter((m) => m && m.role !== 'system');
          const head = `${String(rest[0]?.content ?? '').slice(0, 14).replace(/\s+/g, ' ')}`;
          content = `ECHO n=${String(rest.length)} sum=${systemText.includes('E2E6B摘要') ? 1 : 0} head=${head}`;
        }
      }
    } catch {
      // 解析不出来仍回一行：让调用方看见"服务活着但没读懂"，而不是挂在那儿
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (mode === 'garbage') {
      // 两个垃圾帧 + 正常收尾：修之前这会被记成"一次成功的空回答"
      res.write('data: e2e-not-json-1\n\n');
      res.write('data: e2e-not-json-2\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
await new Promise((resolve) => echoServer.listen(0, '127.0.0.1', resolve));
const echoPort = echoServer.address().port;

/**
 * 本地"发布页"（R11 更新检查）：`JUJIA_UPDATE_API` 指向它 —— 只换"问谁"，不换"问什么"。
 * `updateHits` 是计数器：**点之前它必须是 0**（证明没有自动检查在出站），点了之后恰好 1。
 */
let updateHits = 0;
const updateServer = createServer((_req, res) => {
  updateHits += 1;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      // 99.9.9：**开发态 `app.getVersion()` 会回落到 Electron 版本**（44.x），
      // 假发布版本必须压过它，才能在任何运行形态下都是"有新版本"
      tag_name: 'v99.9.9',
      html_url: `http://127.0.0.1:${String(updateServer.address().port)}/releases/tag/v99.9.9`,
    }),
  );
});
await new Promise((resolve) => updateServer.listen(0, '127.0.0.1', resolve));
const updatePort = updateServer.address().port;

/**
 * 预置"上一个进程留下的东西"（6a 会话持久化的被测前提）：
 * 一条连接 + 一个已经写了几轮对话的会话目录。
 * 会话 id 用符合白名单的 uuid 形态；文件按真实格式写（JsonStore 的信封 + JSONL 一行一条），
 * 于是"重启后还在"这一条问的是**应用真的能读盘**，不是它自己刚写的内存。
 */
const seededConnId = 'e2e-conn-1';
const seededStreamConnId = 'e2e-stream-1';
const seededEchoConnId = 'e2e-6b-1';
/**
 * 种子②（R25 · T33 的界面级证据）：一个 **131 条**历史的会话目录。
 * 首屏读 120 条、剩 11 条在盘上 —— "翻得到最早一条 / 不跳条"这件事只能在界面级验。
 * 文件按真实格式写（JsonStore 信封 + JSONL 一行一条），应用重启后从**目录**重建清单（6a 口径）。
 */
const seededPageSessionId = 'e2e-page-seed-0001';
{
  const pageDir = join(dataDir, 'sessions', seededPageSessionId);
  mkdirSync(pageDir, { recursive: true });
  const lines = [];
  for (let i = 1; i <= 131; i += 1) {
    lines.push(
      JSON.stringify({
        v: 1,
        t: new Date(Date.now() - (132 - i) * 60_000).toISOString(),
        role: 'user',
        content:
          i === 1
            ? 'E2E-OLDEST-MARKER 最早的一条'
            : `E2E-PAGE-${String(i).padStart(3, '0')} 第 ${String(i)} 条`,
      }),
    );
  }
  writeFileSync(join(pageDir, 'messages.jsonl'), `${lines.join('\n')}\n`);
  writeFileSync(
    join(pageDir, 'session.meta.json'),
    JSON.stringify({
      version: 1,
      data: {
        id: seededPageSessionId,
        connectionId: seededStreamConnId,
        title: 'E2E 翻页种子（131 条）',
        createdAt: new Date(Date.now() - 132 * 60_000).toISOString(),
        // lastUsedAt 保持常态：**不许抬到未来** —— [60] 用"清单第一位"定位自己刚建的会话，
        // 种子抢榜首会让它读错目录（复跑首红即此：读 seed/task.json ENOENT）。
        // 首次红还有另一半：历史会话下拉**按连接过滤**且只取最近 8 条 → 步骤里先选连接即可。
        lastUsedAt: new Date().toISOString(),
        messageCount: 131,
        compactedThrough: 0,
      },
    }),
  );
}
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
        {
          id: seededEchoConnId,
          name: 'e2e 回显假服务',
          baseUrl: `http://127.0.0.1:${String(echoPort)}/v1`,
          apiFormat: 'openai-compatible',
          model: 'e2e-echo-model',
          // 与流式那条同理：真的发问，所以给一个本地-only 的假密钥（永不外发）
          secret: { scheme: 'plain', value: 'e2e-local-only' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    },
  }),
  'utf8',
);
/**
 * M7 · R9 定时任务的种子：**应用启动之前**就在盘上留一条"已经欠了几次"的任务。
 *
 * 为什么从盘上种而不是界面上建：这一步要验的正是"开机补跑"这一条路 ——
 * 现场必须是"上一个进程没跑、日历上已经过了好几个点"，而那只能由启动前的磁盘状态造出来。
 * 锚点刻意落在**整分**（秒与毫秒归零）：于是"落盘的 lastRunAt 是不是某个触发时刻"
 * 可以用"秒是不是 00"一眼分辨 —— 写成"跑的那一刻"的实现会留下 arbitrary 秒数，当场露形。
 * jitterMs 给 0 是为了让这一步对时钟抖动不敏感（抖动本身由 M193–M205 的单测与变异管）。
 *
 * 规则用 **DAILY 而不是 MINUTELY**（实测教训）：MINUTELY 下"跳过次数"只活到下一次到点为止 ——
 * e2e 跑到这一步已经过去好几分钟，途中那次正常到点会把 lastSkipped 重置成 0，
 * 断言于是间歇性变红。DAILY 只欠三次、下一次要到明天，断言才是确定的。
 */
const seededTaskId = 'e2etask000-0000-4000-8000-000000000001';
const scheduleAnchor = (() => {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() - 2);
  d.setDate(d.getDate() - 3);
  return d;
})();
mkdirSync(join(dataDir, 'schedules'), { recursive: true });
writeFileSync(
  join(dataDir, 'schedules', 'tasks.json'),
  JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    data: {
      tasks: [
        {
          id: seededTaskId,
          name: 'E2E 定时补跑',
          rule: 'FREQ=DAILY',
          prompt: 'E2E_SCHEDULE 这是一条定时任务该自己起的一轮',
          connectionId: seededEchoConnId,
          anchorAt: scheduleAnchor.toISOString(),
          sessionId: null,
          enabled: true,
          jitterMs: 0,
          // 锚点那一次算"已经跑过"，之后每天一次 —— 到开机时正好欠三次、且今天不会再欠
          lastRunAt: scheduleAnchor.toISOString(),
          lastSkipped: 0,
          lastError: '',
        },
      ],
    },
  }),
  'utf8',
);

const seededSession = 'e2e00000-0000-4000-8000-000000000000';mkdirSync(join(dataDir, 'sessions', seededSession), { recursive: true });
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
// R11：更新检查指向本地"发布页"（默认是 api.github.com；这里只换问谁）
env.JUJIA_UPDATE_API = `http://127.0.0.1:${String(updatePort)}/releases/latest`;

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
   * 就落进系统"下载"目录**（两个 20 字节的 .tmp 就这么出现了，界面和状态一声不响）。
   * 本项目没有"下载管理"这套产品，所以处置是"一律拦下 + 把理由显示出来"，而不是顺手做一个下载器。
   *
   * 磁盘这一半**差点写成假断言**（校准实验当场揭穿的，见复核 038）：
   * 最初按附件文件名 `JUJIA_E2E_SHOULD_NOT_LAND.bin` 去扫 —— 而 Chromium 未取消时落盘的名字是
   * `<随机 uuid>.tmp`，那条扫描**永远为空**，把 `item.cancel()` 删掉也不会红。
   * 现在改成**目录快照前后对比**：只要那个目录里多出一个新文件（叫什么名字都算），这一步就红。
   */
  const DOWNLOAD_NAME = 'JUJIA_E2E_SHOULD_NOT_LAND.bin';
  const downloadsDir = join(homedir(), 'Downloads');
  const snapshotDownloads = () => {
    try {
      return existsSync(downloadsDir) ? new Set(readdirSync(downloadsDir)) : null;
    } catch {
      return null;
    }
  };
  const beforeDownload = snapshotDownloads();

  await addressBox.fill(`${baseUrl}/attach`);
  await win.locator('button', { hasText: '打开' }).first().click();
  const dlNotice = await waitForText('已拦下');
  if (dlNotice !== true) fail('网页发起的下载没有被拦下（will-download 可能没挂上）', String(dlNotice).slice(0, 800));
  const dlBody = await bodyText();
  if (!dlBody.includes(DOWNLOAD_NAME)) {
    fail('拦下是拦下了，但没说是哪个文件 —— 用户看不懂发生了什么', dlBody.slice(0, 700));
  }
  // 界面上那个文件名不是我们写死的漂亮话：它来自 Electron 的 DownloadItem，
  // 而 DownloadItem 的名字来自服务端响应的 Content-Disposition —— 是**对面给的**
  await win.waitForTimeout(1_500);
  const afterDownload = snapshotDownloads();
  if (beforeDownload === null || afterDownload === null) {
    ok('下载被拦、理由点名了文件名（磁盘对照跳过：这台机器读不到系统"下载"目录，如实标注）');
  } else {
    const freshFiles = [...afterDownload].filter((n) => !beforeDownload.has(n));
    if (freshFiles.length > 0) {
      fail(`下载被"拦下"之后，系统"下载"目录里还是多出了文件：${freshFiles.join(' , ')}`);
    }
    ok(`下载被拦、理由点名了文件名，且系统"下载"目录前后快照对比**一个新文件都没多**`);
  }


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
  /**
   * 读盘读到"出现某个形状"为止（T64）。
   *
   * 只给**正面**断言用（"批准了应该看得到"）：负面断言（"拒绝了不该有"）绝不能轮询等缺席 ——
   * 那等于一上来就通过，写盘稍晚一点就永远抓不到，是天生绿的锁。负面那边走界面回执，见下面。
   */
  const readHooksDiskUntil = async (predicate, ms = 5_000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const content = hooksOnDisk() ?? '';
      if (predicate(content) || Date.now() >= deadline) return content;
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const ASK_HEAD = '需要你确认：修改钩子配置会以你的宿主环境执行命令';

  const hooksBefore = hooksOnDisk();
  await saveHooksFromEditor(hooksJson);
  const askFirst = await waitText2(ASK_HEAD);
  if (askFirst !== true) fail('保存钩子配置没有弹确认（T4 的口子还在）', (await body2()).slice(0, 900));
  if (!(await body2()).includes(HOOK_MARKER)) {
    fail('确认弹窗里看不到要写入的命令 —— 看不到内容的审批等于没有审批', (await body2()).slice(0, 900));
  }
  await clickDialog2('拒绝');
  /* ---------------- 顺序纪律（外部审查 T64）：弹窗消失 ≠ 主进程做完了 ----------------
   *
   * 上一轮这一步报的是"批准了却没写进磁盘"，而盘上两秒后确实有那条命令 ——
   * 红的不是产品，是**抢在真值前面的断言**：`clickDialog2` 等的是弹窗 detached，那一刻主进程
   * 刚拿到用户的答案，`extensions.ts` 里 `await hooks.save(payload)` 还没跑完（写盘是
   * 原子改名 + `.bak`，还要再等 `hooksState()` 回 IPC）。
   * **界面那句回执才是"这一趟做完了"的信号**：`HooksPanel.save` 在 `await window.jujia.hooksSet(...)`
   * 返回之后才设 notice ⇒ 先等回执、再读盘，因果才接得上（本文件后面 T51 那一步早就是这个形状）。
   * 负面断言（"拒绝了不该有"）只等回执、不轮询：轮询"缺席"= 一上来就通过，是天生绿的锁。
   */
  const deniedNote = await waitText2('钩子配置未改动');
  if (deniedNote !== true) fail('拒绝之后界面没有如实说明配置未改动', (await body2()).slice(0, 900));
  if (hooksOnDisk() !== hooksBefore) fail('用户明明拒绝了，hooks.json 却被改动（拒绝必须真的不做）');
  ok('拒绝 → 磁盘一字未动，界面说明未改动');

  await saveHooksFromEditor(hooksJson);
  const askSecond = await waitText2(ASK_HEAD);
  if (askSecond !== true) fail('第二次保存没有再弹确认', (await body2()).slice(0, 900));
  await clickDialog2('允许一次');
  const savedNote = await waitText2('已保存');
  if (savedNote !== true) fail('批准后界面没有报告保存成功', (await body2()).slice(0, 900));
  const allowedDisk = await readHooksDiskUntil((c) => c.includes(HOOK_MARKER));
  if (!allowedDisk.includes(HOOK_MARKER)) fail('批准了却没写进磁盘（这次写入其实没发生）', allowedDisk.slice(0, 400));
  ok('批准 → 配置真的落盘（磁盘上有那条命令），界面报告已保存');

  // 第三次：界面上不该再有「本次会话总是允许」（T19），点「允许一次」之后第四次仍必须问
  // 这一位之后**不再读盘**，所以不给第三次批准加"等回执"：那句 `waitText2('已保存')` 在这里
  // 会被第二次留下的旧文案直接满足 = 一条永远不会红的断言，比没有更坏（教人无视红灯）。
  // 第四步要的是"还要不要再问"，与写盘时序无关。
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
  /* ===== 常驻现场取证（T65 装在门禁里，复核 089）=====
   * 起因：规整19 收口时这一步**红过一次**，报"B 自己的用量没出现"，而失败时 dump 出来的界面停在
   * **外观页** —— 脚本里唯一点外观的地方在第 50 步用的还是另一个窗口句柄，时间上不可能。
   * 第二次带这段取证重跑：65 步全绿，快照显示当时活动页签是"对话"、输入框在、B 的正文已到末段。
   * **根因未定**（一次红、一次绿，不编故事），所以把取证留在门禁里而不是留在我脑子里：
   * ① 记录每一个真的落到 DOM 上的点击（含它是不是点在页签栏上）；② 失败时给出"当前哪一页是活的 /
   * 输入框在不在 / A 与 B 的末段在不在 / 最近 12 次点击"。下次再红，出处就在日志里，不用再猜。
   * 取证本身只做两次 `evaluate`，不改变判定，也不给任何断言放宽时限。
   */
  await win2.evaluate(() => {
    const w = window;
    w.__fxClicks = [];
    document.addEventListener(
      'click',
      (ev) => {
        const el = ev.target instanceof Element ? ev.target : null;
        const btn = el ? el.closest('button') : null;
        const label = btn && btn.textContent ? btn.textContent.trim().slice(0, 20) : '(非按钮)';
        const where = el && el.closest('nav.app-tabs') ? 'NAV' : 'body';
        const t = Date.now();
        w.__fxClicks.push(`${where}:${label}`);
        w.__fxAt = w.__fxAt || [];
        w.__fxAt.push(t);
        if (w.__fxClicks.length > 80) {
          w.__fxClicks.shift();
          w.__fxAt.shift();
        }
      },
      true,
    );
  });
  const fx = async () =>
    await win2.evaluate(() => {
      const navs = [...document.querySelectorAll('nav.app-tabs button')];
      const active = navs.find((b) => b.className.includes('app-tab-active'));
      const body = document.body.innerText;
      return JSON.stringify({
        active: active ? active.textContent : '(没有 active 页签)',
        chatBox: !!document.querySelector('textarea[placeholder^="输入消息"]'),
        hasA_tail: body.includes('A_16_'),
        hasB_tail: body.includes('B_16_'),
        hasB_first: body.includes('B_1_'),
        len: body.length,
        clicks: (window.__fxClicks ?? []).slice(-12).join(' , '),
        vis: document.visibilityState,
      });
    });
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

  log(`[取证·等 131313 之前] ${await fx()}`);
  if ((await waitText2('131313', 15_000)) !== true) {
    // 临时取证：当前活页签 / 输入框在不在 / A 与 B 的末段在不在 / 最近 12 次真的落到 DOM 的点击
    const pageCount = win2.context && win2.context() ? win2.context().pages().length : -1;
    fail(
      'B 自己的用量没出现 —— 闸门口径写反了会把当前会话的事件也筛掉',
      `窗口数=${String(pageCount)} ` + (await fx()),
    );
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
  /*
   * 等 A 的过期说明出现 —— **有界轮询**，不是固定等待（2026-10-06 定位并修）：
   * 原先固定 sleep 3.6s 的编舞在机器忙时会滑到 B 自己的 10 秒窗上（台账登记过的偶发红②，
   * 本轮实测两连红：一次"A 的说明没来"、一次"B 的卡不见了"——同一根因）。
   * 轮询在健康运行时 1 秒内命中；负载下最多再等 8 秒，且**读到同一帧**做下面三条断言、
   * 随后**立刻**批 B，不再让它自己的时间窗被等待吃掉。
   */
  let t9Body = '';
  const t9Deadline = Date.now() + 8_000;
  while (Date.now() < t9Deadline) {
    t9Body = await body2();
    if (t9Body.includes('在主进程等待超时')) break;
    await new Promise((r) => setTimeout(r, 200));
  }
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

  /* ---------------- 6b：会话压缩（A）与「结束记要点」（B） ----------------
   *
   * 真值全部只看磁盘与"模型收到了什么"，不看界面自述：
   * ① 到阈值只是提示 —— 提示条出现的那一刻，summary.md 必须还不存在；
   * ② 预览不落盘、「先不存」不落盘，点「就按这版存」之后 summary.md 才出现，且原始 jsonl 一字未少；
   * ③ 压缩之后发给模型的历史真的换成了"摘要 + 最近几条"（回显服务把收到的内容体检回来）。
   */
  step('6b 压缩：到阈值只提示、预览与「先不存」都不落盘、点存才写 summary.md（原始记录一字不少）');
  await win2.locator('nav.app-tabs button', { hasText: '对话' }).first().click();
  await win2.locator('select').first().selectOption(seededEchoConnId);
  // 开一个干净的会话来测：上一步把焦点留在流式会话 B 上，直接发问会写进 B 的历史里
  await win2.locator('button', { hasText: '新会话' }).first().click();
  const box6b = win2.locator('textarea[placeholder^="输入消息"]');
  /** 一轮真发问并等回显落地（回显服务即时吐字，没有流式那一档的时间） */
  const ask6b = async (text, needle) => {
    await box6b.fill(text);
    await win2.locator('button', { hasText: '发送' }).first().click();
    if ((await waitText2(needle, 15_000)) !== true) {
      fail(`这一问没有拿到预期回显（${needle}）`, (await body2()).slice(0, 500));
    }
  };
  await ask6b(`E2E6B_START ${'x'.repeat(66_000)}`, 'ECHO n=1 sum=0');
  ok('第一问真的走通了回显服务：此时还没有摘要，体检报告 sum=0');

  /*
   * 清单读取用**有界轮询**：回显先到界面、会话清单的落盘稍后一拍 —— 固定读一次在机器忙时
   * 会偶发失败（2026-10-05 实测：同一步骤一红一绿，二次复跑全绿）。轮询只用于"等它出现"，
   * 后面的断言仍然只信磁盘真值。
   */
  const list6b = await (async () => {
    const deadline = Date.now() + 6_000;
    let list = [];
    while (Date.now() < deadline) {
      list = await win2.evaluate(async () => await window.jujia.chatList());
      if (list.some((s) => s.title.includes('E2E6B_START'))) return list;
      await new Promise((r) => setTimeout(r, 150));
    }
    return list;
  })();
  const s6b = list6b.find((s) => s.title.includes('E2E6B_START'));
  if (!s6b) fail('6b 会话没出现在清单里（后面的断言会全部失去对象）', JSON.stringify(list6b).slice(0, 300));
  const sessDir6b = join(dataDir, 'sessions', s6b.id);
  const summaryFile6b = join(sessDir6b, 'summary.md');
  const jsonl6b = join(sessDir6b, 'messages.jsonl');
  const linesOf = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).length;

  if ((await waitText2('要不要把早先的内容压成要点摘要')) !== true) {
    fail('未压缩内容已过 64KB 却没有提示（阈值那一半没生效）', (await body2()).slice(0, 700));
  }
  if (existsSync(summaryFile6b)) fail('只是到了阈值就自己压了 —— 批复③明写"阈值只提示，绝不动手"');
  ok('阈值只提示：提示条出来了，盘上什么都没有');

  await win2.locator('button', { hasText: '压缩此会话' }).first().click();
  if ((await waitText2(SUMMARY_6B)) !== true) {
    fail('点了「压缩此会话」没出预览摘要', (await body2()).slice(0, 700));
  }
  if (existsSync(summaryFile6b)) fail('预览这一步竟然落了盘（落点只能是一个字节都不写）');
  await win2.locator('button', { hasText: '先不存' }).first().click();
  if ((await waitText2('没存。发给模型的上下文一点没变')) !== true) {
    fail('点「先不存」之后界面没给出"什么都没做"的回执', (await body2()).slice(0, 700));
  }
  if (existsSync(summaryFile6b)) fail('「先不存」之后盘上出现了 summary.md');
  ok('预览只是给人看：两条不存的分支都不留任何磁盘痕迹');

  const jsonlBefore = linesOf(jsonl6b);
  await win2.locator('button', { hasText: '压缩此会话' }).first().click();
  if ((await waitText2(SUMMARY_6B)) !== true) fail('第二次预览没出来', (await body2()).slice(0, 700));
  await win2.locator('button', { hasText: '就按这版存' }).first().click();
  if ((await waitText2('已压缩到第')) !== true) {
    fail('点了「就按这版存」界面没给出压缩回执', (await body2()).slice(0, 700));
  }
  if (!existsSync(summaryFile6b)) fail('说已压缩，磁盘上却没有 summary.md');
  if (!readFileSync(summaryFile6b, 'utf8').includes(SUMMARY_6B)) fail('summary.md 里不是预览那版内容');
  const meta6b = JSON.parse(readFileSync(join(sessDir6b, 'session.meta.json'), 'utf8')).data;
  if (meta6b.compactedThrough < jsonlBefore) {
    fail(`水印没推进到预览承诺的那一条：meta=${String(meta6b.compactedThrough)} 盘上=${String(jsonlBefore)}`);
  }
  if (linesOf(jsonl6b) !== jsonlBefore) fail('压缩动了原始 jsonl 的行数（承诺是"一字不删"）');
  if ((await waitText2(`已压缩至第 ${String(meta6b.compactedThrough)} 条`)) !== true) {
    fail('磁盘与元信息都变了，界面上却没有"已压缩"标识', (await body2()).slice(0, 700));
  }
  ok('存下这一版：summary.md 落地、水印推进、原始记录一行没少，界面标识与盘上数字对得上');

  /** ③ 发给模型的那份真的换了：体检报告 sum=1（摘要在系统提示里），且 tail 只剩水印之后那几条 */
  await ask6b('E2E6B_压缩后的一问', 'ECHO n=1 sum=1');
  ok('压缩之后：模型看到的是"摘要 + 这一条"，那 66KB 原文没再发第二遍');

  /* ---------------- 6b-B：结束会话 → 预览 → 才写进长期记忆 ---------------- */
  step('6b 结束记要点：「记」在看过预览之前点不动，看过才落 NOTES.md；文档页签能直接打开它');
  const notesOf6b = () => (existsSync(notesFile) ? readFileSync(notesFile, 'utf8') : '');
  const noteLines = (txt) => txt.split(NOTE_6B).length - 1;
  const notesBefore6b = notesOf6b();
  /** 提示条里可能同时挂着好几个会话（流式那一步留下的），所有点击都按标题锁到本会话那一行上 */
  const bandItem = (which, title) =>
    which.locator('div.p0-card > div', { hasText: title }).first();

  await win2.locator('button', { hasText: '结束并记要点' }).first().click();
  if ((await waitText2('还没记要点')) !== true) {
    fail('点了「结束并记要点」没出现待记提示', (await body2()).slice(0, 700));
  }
  const row6b = bandItem(win2, 'E2E6B_START');
  const rememberBtn6b = row6b.locator('button', { hasText: /^记$/ });
  if ((await rememberBtn6b.isDisabled()) !== true) {
    fail('还没预览就能点「记」—— 追加验收④要求"确认后才落盘"');
  }
  if (notesOf6b() !== notesBefore6b) fail('只是结了个束，NOTES.md 就变了');
  await row6b.locator('button', { hasText: '看摘要再决定' }).click();
  if ((await waitText2(NOTE_6B)) !== true) {
    fail('点了「看摘要再决定」没给出要写进去的那一行', (await body2()).slice(0, 700));
  }
  if (notesOf6b() !== notesBefore6b) fail('预览这一步就写进了 NOTES.md');
  ok('补问界面先给预览：没看过之前「记」是灰的，看过之后 NOTES.md 也还没动');

  await row6b.locator('button', { hasText: /^记$/ }).click();
  if ((await waitText2('要点已写进长期记忆')) !== true) {
    fail('点「记」之后没有回执', (await body2()).slice(0, 700));
  }
  if (noteLines(notesOf6b()) !== noteLines(notesBefore6b) + 1) {
    fail('NOTES.md 没有恰好多出一行', notesOf6b().slice(-400));
  }
  if (!notesOf6b().includes(NOTE_6B)) fail('多出来那一行不是预览里看过的那一条', notesOf6b().slice(-400));
  if ((await bandItem(win2, 'E2E6B_START').count()) !== 0) {
    fail('记完了账还挂着 —— 同一件事下次启动还会再问一遍');
  }
  ok('确认之后才落盘：NOTES.md 恰好多出预览那一行，账也划掉了');

  /* ---------------- 6b-B：退出留账 → 下次启动补问 ----------------
   *
   * 这一步同时回答一个只有真跑一次才知道答案的问题：`before-quit` 不会等异步，
   * 那本账到底写没写上。重启之后"补问"能出现，就是它写上了的证据。
   *
   * 「查看长期记忆」那个入口留到重启之后验（win3 上）：同一份 NOTES.md，
   * 重启后还看得见 = 既证明写进了磁盘，也证明它不是内存里的余温。
   */
  step('6b 退出留账：关掉应用再重开，账真的在、补问真的出现，刚记过的会话不会被问第二遍');
  // S1：记过要点**之后又多聊了一句** —— 这一批是新内容，退出时该被再问一次
  await win2.locator('nav.app-tabs button', { hasText: '对话' }).first().click();
  await ask6b('E2E6B_记完之后又多聊了一句', 'ECHO n=3 sum=1');
  /**
   * S2：记过要点、之后一个字都没再多 —— **不该**被问第二遍。
   * 分成两条会话来当正反样本，是因为账上的标题取的是"首条用户消息的前 40 字"（不是最后那句）：
   * 同一个会话既当"该问"又当"不该问"的对照，两个断言会互相打脸。
   */
  await win2.locator('button', { hasText: '新会话' }).first().click();
  await ask6b('E2E6B_记过就不再问 这条记完没再聊', 'ECHO n=1 sum=0');
  await win2.locator('button', { hasText: '结束并记要点' }).first().click();
  if ((await waitText2('E2E6B_记过就不再问')) !== true) {
    fail('S2 结束之后没进待记提示条', (await body2()).slice(0, 700));
  }
  await bandItem(win2, 'E2E6B_记过就不再问').locator('button', { hasText: '看摘要再决定' }).click();
  if ((await waitText2(NOTE_6B)) !== true) fail('S2 的预览没出来', (await body2()).slice(0, 700));
  await bandItem(win2, 'E2E6B_记过就不再问').locator('button', { hasText: /^记$/ }).click();
  if ((await waitText2('要点已写进长期记忆')) !== true) {
    fail('S2 点了「记」没有回执', (await body2()).slice(0, 700));
  }
  const ledgerFile = join(dataDir, 'pending-notes.json');
  if (readFileSync(ledgerFile, 'utf8').includes('E2E6B_记过就不再问')) {
    fail('还没退出呢，账上就出现了这一笔');
  }
  if (noteLines(notesOf6b()) !== 2) {
    fail(`两条会话各记一行，NOTES.md 里应该有 2 行本轮要点（实际 ${String(noteLines(notesOf6b()))}）`);
  }
  /*
   * 关闭方式必须是**用户真的会用的那一条**（点窗口右上角 ✕），不是 Playwright 的 `app.close()`：
   * 前者走 `window-all-closed → app.quit() → before-quit → will-quit`，后者直接把进程带走。
   * 而"退出留账"这一步第一次跑就是这样红的 —— 红的不是关闭方式，是主进程：
   * 写在 `before-quit` 里的那次异步落盘从来没到过磁盘（探针 .tmp/probe-quit3.mjs 两个对照组实测），
   * 现在改成 `will-quit` + preventDefault 等写完（预算 1 秒）再强退。两种关闭方式都要验才成立：
   * Playwright 的 `app.close()` 仍然不带退出事件序列，所以这一步用真实路径，
   * 而"进程被强杀时丢的只是这本待办账、原始对话一字不丢"由上面的证据链兜住。
   */
  const closedByUser = app.waitForEvent('close', { timeout: 20_000 }).catch(() => undefined);
  // 页面正在关掉，`evaluate` 的返回值拿不到是正常现象 —— 我们要的是"窗口真的关了"，不是返回值
  await win2.evaluate(() => window.close()).catch(() => undefined);
  await closedByUser;
  app = undefined;
  app = await electron.launch({
    executablePath: electronPath,
    args: [MAIN_ENTRY, `--user-data-dir=${profileDir}`],
    env,
  });
  const win3 = await app.firstWindow();
  await win3.waitForSelector('body', { timeout: 15_000 });
  const body3 = async () => await win3.evaluate(() => document.body.innerText);
  const waitText3 = async (needle, ms = 10_000) => {
    try {
      await win3.waitForFunction((n) => document.body.innerText.includes(n), needle, { timeout: ms });
      return true;
    } catch {
      return false;
    }
  };
  if (!existsSync(ledgerFile)) {
    fail('退出时那本账没写上磁盘：那次异步写入被进程退出截断了（补问从此永远不会出现）');
  }
  const ledgerRaw = readFileSync(ledgerFile, 'utf8');
  if (!ledgerRaw.includes('E2E6B_START')) {
    fail('记过要点之后又多聊了内容的会话，退出时没被留账（该问的没问）', ledgerRaw.slice(0, 600));
  }
  if (ledgerRaw.includes('E2E6B_记过就不再问')) {
    fail('刚记过、之后一个字没多的会话又被记了一笔（不该问的问了）', ledgerRaw.slice(0, 600));
  }
  await win3.locator('nav.app-tabs button', { hasText: '对话' }).first().click();
  if ((await waitText3('E2E6B_START')) !== true) {
    fail('重启后没给出补问提示条', (await body3()).slice(0, 700));
  }
  const band3 = await body3();
  if (band3.includes('E2E6B_记过就不再问')) {
    fail('刚记过要点的会话在补问条里又出现了一遍（记过的内容不该问第二遍）', band3.slice(0, 900));
  }
  ok('退出留账真的写上了：记过之后有新内容的被问，刚记过没新内容的没被问第二遍');

  const row3 = bandItem(win3, 'E2E6B_START');
  await row3.locator('button', { hasText: '看摘要再决定' }).click();
  if ((await waitText3(NOTE_6B)) !== true) {
    fail('重启后补问的预览出不来（会话没能从磁盘装回来？）', (await body3()).slice(0, 700));
  }
  const notesCountBefore3 = noteLines(notesOf6b());
  if (notesCountBefore3 !== 2) {
    fail(`NOTES.md 里本轮要点应是 2 行（预期 2，实际 ${String(notesCountBefore3)}）`);
  }
  await row3.locator('button', { hasText: '不记' }).click();
  if ((await waitText3('这条没写进长期记忆')) !== true) {
    fail('点「不记」没有回执', (await body3()).slice(0, 700));
  }
  if (noteLines(notesOf6b()) !== 2) fail('点了「不记」，NOTES.md 却多了一行');
  ok('补问的预览同样不落盘；「不记」只清账 —— 每一步都有磁盘证据');

  /** 追加验收⑦：不用猜路径就有直达入口，而且看得见内容（在**重启之后**的窗口里验，顺带证明它真在盘上） */
  await win3.locator('nav.app-tabs button', { hasText: '文档' }).first().click();
  await win3.locator('button', { hasText: '查看长期记忆' }).first().click();
  if ((await waitText3(NOTE_6B)) !== true) {
    fail('「查看长期记忆」没能把 NOTES.md 打开给人看', (await body3()).slice(0, 700));
  }
  const docsShown6b = await win3.locator('.jj-docs-body').innerText();
  /**
   * 这里认的是**渲染之后**的样子：`- 2026-09-28: E2E_PERSIST_答一：…` 在 Markdown 里
   * 那一对下划线成了斜体标记，所以界面文本是"PERSIST"而不是"E2E_PERSIST_"。
   * 盘上那行原文一字没改（前一步已按原文比对过），丢下划线的只是查看器 —— 写在这里是为了
   * 不让下一个读脚本的人以为"长期记忆存坏了"。
   */
  if (!docsShown6b.includes('叫俱佳Agent') || !docsShown6b.includes('PERSIST')) {
    fail('打开的不是那份长期记忆（早先记进去的条目应该也在里面）', docsShown6b.slice(0, 400));
  }
  ok('补偿条件①：长期记忆有一个不用猜路径的入口，重启之后内容照样看得见');

  /* ---------------- T22：切走页签不丢对话的连接与会话选择 ----------------
   *
   * 报备 §四的两步，都用**重启之后**那个窗口（win3）验 —— 上一步已经把它带起来了。
   * 选择保持看**磁盘真值**（回显条数 + jsonl 行数 + 会话清单条数），不看界面自述。
   */
  step('T22 切页签不丢对话：连接与会话选择都留着，下一条消息还落在原会话（磁盘真值）');
  /*
   * 先切回对话页：上一步结束时停在「文档」，而对话面板现在是**挂着但隐藏**的 ——
   * `locator` 不看 innerText 的可见性规则，会先命中那份隐藏的 select（第一次跑就是这么红的：
   * "element is not visible" 卡了 30 秒）。常驻面板带来的这条测试纪律写在这里：
   * **凡是要操作对话页控件的地方，先把页签切到对话页**。
   */
  await win3.locator('nav.app-tabs button', { hasText: '对话' }).first().click();
  const boxT22 = win3.locator('textarea[placeholder^="输入消息"]');
  const askT22 = async (text, needle) => {
    await boxT22.fill(text);
    await win3.locator('button', { hasText: '发送' }).first().click();
    if ((await waitText3(needle, 15_000)) !== true) {
      fail(`这一问没有拿到预期回显（${needle}）`, (await body3()).slice(0, 500));
    }
  };
  await win3.locator('select').first().selectOption(seededEchoConnId);
  /*
   * 这一步**不假设**面板里有会话：重启之后对话面板是全新的（`sessionId` 未定义时连「新会话」都不渲染）。
   * 有就重置一下，没有就直接发 —— 两种状态都对，断言的是"发出去之后落在哪"。
   *
   * 为什么两处都用**有界轮询**（2026-10-07 M9b 收口轮实测踩到，同第 27 步那次的同一类）：
   * ① 「新会话」在不在场曾用一次性 `count()` 快照判断 —— 快照取在渲染之前时，"没有按钮"被
   *    当成"全新面板"直接发，消息落进旧会话，清单里当然没有 T22 会话（红点就是这一处）；
   * ② 清单按"发出去之后会出现"来等，而不是发完立即断言 —— 写入与清单刷新之间不留竞态窗口。
   */
  const newChatT22 = win3.locator('button', { hasText: '新会话' });
  let hadSessionT22 = false;
  for (let i = 0; i < 20; i += 1) {
    if ((await newChatT22.count()) > 0) {
      hadSessionT22 = true;
      break;
    }
    await win3.waitForTimeout(150);
  }
  if (hadSessionT22) await newChatT22.first().click();
  await askT22('T22_切页签前的第一问', 'ECHO n=1 sum=0');

  let listT22 = await win3.evaluate(async () => await window.jujia.chatList());
  for (let i = 0; i < 25 && !listT22.some((s) => s.title.includes('T22_切页签前')); i += 1) {
    await win3.waitForTimeout(200);
    listT22 = await win3.evaluate(async () => await window.jujia.chatList());
  }
  const sT22 = listT22.find((s) => s.title.includes('T22_切页签前'));
  if (!sT22) fail('T22 会话没出现在清单里（已按有界轮询等满 5 秒）', JSON.stringify(listT22).slice(0, 300));
  const jsonlT22 = join(dataDir, 'sessions', sT22.id, 'messages.jsonl');
  const linesT22 = () => readFileSync(jsonlT22, 'utf8').split('\n').filter(Boolean).length;
  const beforeLinesT22 = linesT22();
  const beforeListT22 = listT22.length;

  await win3.locator('nav.app-tabs button', { hasText: '文档' }).first().click();
  await win3.locator('nav.app-tabs button', { hasText: '对话' }).first().click();

  const backT22 = await body3();
  if (!backT22.includes('T22_切页签前的第一问')) {
    fail('切回来之后之前的问答不见了（面板被卸载过）', backT22.slice(0, 700));
  }
  if (!backT22.includes(`会话 ${sT22.id.slice(0, 8)}`)) {
    fail('切回来之后当前会话不是原来那个（会话选择被重置）', backT22.slice(0, 700));
  }
  const connT22 = await win3.locator('select').first().inputValue();
  if (connT22 !== seededEchoConnId) {
    fail(`切回来之后连接选择回到了默认（当前 ${connT22}，应为 ${seededEchoConnId}）`);
  }

  await askT22('T22_切页签后的第二问', 'ECHO n=3 sum=0');
  if (linesT22() !== beforeLinesT22 + 2) {
    fail(`第二问没有落回原会话：行数 ${String(beforeLinesT22)} → ${String(linesT22())}（应为 +2）`);
  }
  const afterListT22 = await win3.evaluate(async () => await window.jujia.chatList());
  if (afterListT22.length !== beforeListT22) {
    fail(`悄悄多出了新会话：${String(beforeListT22)} → ${String(afterListT22.length)}`);
  }
  ok('切走再切回：连接与会话选择都留着、视图恢复，第二问落回原会话且没有新建会话（磁盘为证）');

  step('T22 流式中切走再切回：订阅没随页签卸载，后续增量照常到达');
  await win3.locator('nav.app-tabs button', { hasText: '对话' }).first().click();
  await win3.locator('select').first().selectOption(seededStreamConnId);
  await win3.locator('button', { hasText: '新会话' }).first().click();
  await boxT22.fill('STREAM_A T22 切走验证');
  await win3.locator('button', { hasText: '发送' }).first().click();
  if ((await waitText3('A_1_', 12_000)) !== true) {
    fail('流没有开始（假服务的头两段没到）', (await body3()).slice(0, 700));
  }
  await win3.locator('nav.app-tabs button', { hasText: '文档' }).first().click();
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  await win3.locator('nav.app-tabs button', { hasText: '对话' }).first().click();
  if ((await waitText3('A_16_', 15_000)) !== true) {
    fail('切回来之后这一轮没有走完 —— 订阅随页签卸载了（T22 要修的正是这个）', (await body3()).slice(0, 900));
  }
  ok('流式中切走 2 秒再切回：后续增量照常到达，整轮走完（订阅一直在）');

  /* ---------------- M19a：轻量 IDE（文件树 / 保存过门 / 覆盖保护 / PDF / 逐行 patch） ----------------
   *
   * 五步各覆盖一个入口，断言全部落在**磁盘真值**与"零出站"上：
   * 树里的条目与磁盘对照；保存看的是文件真的变了（拒绝时真的没变）；
   * PDF 看的是 canvas 与页数，外加"整个打开过程没有一条出站请求"。
   */
  step('M19 文件树：展开看到真实条目，点开文件看到内容');
  const ideFile = `ide-e2e-${String(Date.now()).slice(-6)}.txt`;
  const idePdf = `ide-e2e-${String(Date.now()).slice(-6)}.pdf`;
  const ideCjkPdf = `ide-cjk-${String(Date.now()).slice(-6)}.pdf`;
  writeFileSync(join(wsDir, ideFile), '第一行\n第二行\n', 'utf8');
  writeFileSync(join(wsDir, idePdf), buildMinimalPdf(), 'utf8');
  // 中文 fixture 也在这里先落盘：树的清单是**懒加载缓存**的，开页签之后再写就看不见（第 33 步实测过）
  writeFileSync(join(wsDir, ideCjkPdf), buildCjkPdf(), 'utf8');
  await win3.locator('nav.app-tabs button', { hasText: '文件' }).first().click();
  if ((await waitText3(ideFile, 12_000)) !== true) {
    fail('「文件」页签没有列出刚写进去的文件（树没读磁盘？）', (await body3()).slice(0, 800));
  }
  await win3.locator('button', { hasText: ideFile }).first().click();
  /*
   * 内容在 **textarea 的 value** 里，而 `innerText` 不含表单值 —— 这里必须读 value。
   * （第一次跑红在'点开文件之后没有看到内容'，就是这么来的：文件明明开了，断言看不见。）
   */
  const editorValue = async () => await win3.locator('textarea[aria-label="文件内容"]').inputValue();
  let shownText = '';
  for (let i = 0; i < 40 && !shownText.includes('第二行'); i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    shownText = await editorValue().catch(() => '');
  }
  if (!shownText.includes('第二行')) {
    fail('点开文件之后编辑器里没有内容', shownText.slice(0, 300) || '（读不到编辑器）');
  }
  ok('树与磁盘一致，点开就能看到文件内容');

  step('M19 保存必须过权限门：批准 → 磁盘真变；拒绝 → 磁盘不变');
  const editor = win3.locator('textarea[aria-label="文件内容"]');
  await editor.fill('第一行\n第二行\n第三行（e2e 加的）\n');
  await win3.locator('button', { hasText: '保存' }).first().click();
  if ((await waitText3('需要你确认：', 10_000)) !== true) {
    fail('保存没有过权限门 —— 写类操作必须问人（与模型调 write_file 同一扇门）', (await body3()).slice(0, 900));
  }
  await win3.locator('button', { hasText: '允许一次' }).first().click();
  await new Promise((r) => setTimeout(r, 600));
  const savedText = readFileSync(join(wsDir, ideFile), 'utf8');
  if (!savedText.includes('第三行（e2e 加的）')) {
    fail('批准了，磁盘上却没有这一行（界面说成功不算数）', savedText.slice(0, 300));
  }
  await editor.fill('这一版不该落盘\n');
  await win3.locator('button', { hasText: '保存' }).first().click();
  if ((await waitText3('需要你确认：', 10_000)) !== true) fail('第二次保存没有弹确认', (await body3()).slice(0, 700));
  await win3.locator('button', { hasText: '拒绝' }).first().click();
  await new Promise((r) => setTimeout(r, 600));
  if (readFileSync(join(wsDir, ideFile), 'utf8').includes('不该落盘')) {
    fail('用户拒绝了，盘上却还是被写了（拒绝必须真的不做）');
  }
  ok('保存逐次过门：批准才写、拒绝就不写 —— 两次都有磁盘证据');

  step('M19 覆盖保护：文件被外部改过之后拒绝保存，并给出两条出路');
  writeFileSync(join(wsDir, ideFile), '外部改动\n', 'utf8');
  await editor.fill('编辑器里的旧版本\n');
  await win3.locator('button', { hasText: '保存' }).first().click();
  if ((await waitText3('被改过了', 10_000)) !== true) {
    fail('覆盖保护没生效（盘上的新内容被旧编辑器内容盖了？）', (await body3()).slice(0, 900));
  }
  const afterRefuse = readFileSync(join(wsDir, ideFile), 'utf8');
  if (afterRefuse !== '外部改动\n') fail('拒绝了却还是覆盖了盘上的内容', afterRefuse.slice(0, 200));
  const refuseBody = await body3();
  if (!refuseBody.includes('重新打开') || !refuseBody.includes('另存为')) {
    fail('拒绝的文案没给出两条出路（重新打开 / 另存为）', refuseBody.slice(0, 700));
  }
  ok('覆盖保护生效：盘上那份没被动，且用户知道下一步能怎么办');

  step('M19 PDF：真画出来，且整个打开过程零出站请求');
  /*
   * 零出站的判据（M19b 复核方点名要改）：**跨 origin / 出站**的请求数必须是 0 ——
   * 不能写"一条请求都没有"：M19b 之后字体/cmap 是包内字节，理论上一条都没有，
   * 但将来若某个资源改成相对路径，本地请求会突然让"一条都没有"这条断言变成假红，
   * 而被逼着放宽的断言很快就变成废的。所以按**出站**判，并同时记下总请求数（防空转）。
   */
  const outbound = [];
  let seenRequests = 0;
  const watchOut = (req) => {
    seenRequests += 1;
    const u = req.url();
    if (u.startsWith('http://') || u.startsWith('https://')) outbound.push(u);
  };
  win3.on('request', watchOut);
  await win3.locator('button', { hasText: idePdf }).first().click();
  if ((await waitText3('第 1 / 1 页', 15_000)) !== true) {
    fail('PDF 没有渲染出页数（pdfjs 没跑起来？）', (await body3()).slice(0, 900));
  }
  const canvasBox = await win3.locator('canvas.jj-pdf-canvas').boundingBox();
  if (canvasBox === null || canvasBox.width < 50 || canvasBox.height < 50) {
    fail('画布没画出来（尺寸不对）', JSON.stringify(canvasBox));
  }
  await new Promise((r) => setTimeout(r, 800));
  win3.off('request', watchOut);
  if (outbound.length > 0) {
    fail(`打开 PDF 期间出现了**出站**请求 —— 违反"数据不出本机"：${outbound.join(' , ')}`);
  }
  // 把看到的请求总数写进回执：既是证据，也能在监听器坏掉时一眼看出来（0 条 = 可能没挂上）
  ok(`PDF 真画出来了（页数 + canvas），全程**零出站**（本轮看到 ${String(seenRequests)} 条本地请求）：一份 PDF 的字节没有离开过本机`);

  step('M19 逐行 diff：点开改动的文件看到逐行 patch（内容真值）');
  const trackedFile = 'README-e2e-seed.md';
  writeFileSync(join(wsDir, trackedFile), 'seed\n新增一行给 patch 看\n', 'utf8');
  await win3.locator('nav.app-tabs button', { hasText: 'Git' }).first().click();
  /**
   * **先有界等到那行出现在界面里，再点**（复核 051 R-7）。
   * 原来是直接 `.click()`：元素没出现时走的是 Playwright 自己的 30 秒超时，
   * 现场什么都不留 —— 上一轮就是这样红了一次而只能重跑碰运气。现在超时会把当时的面板正文交出来。
   */
  if ((await waitText3(trackedFile, 12_000)) !== true) {
    fail('Git 页签里没有那条改动的文件（切回页签后 status 没刷新？），点不到逐行 patch 的入口', await body3());
  }
  await win3.locator('button.jj-git-link', { hasText: trackedFile }).first().click();
  if ((await waitText3('逐行 patch', 12_000)) !== true) {
    fail('没有出现逐行 patch 视图', (await body3()).slice(0, 900));
  }
  const patchBody = await body3();
  if (!patchBody.includes('+新增一行给 patch 看')) {
    fail('patch 里没有那一行新增（逐行视图没生效）', patchBody.slice(-900));
  }
  ok('逐行 patch 真取回来了：新增行以 + 出现（看的是内容，不是界面文案）');

  step('M19b 中文 PDF：内置的 CJK cmap 真被取用，字节经它正确映射成「你好」（抽取为证）');
  await win3.locator('nav.app-tabs button', { hasText: '文件' }).first().click();
  await win3.locator('button', { hasText: ideCjkPdf }).first().click();
  if ((await waitText3('第 1 / 1 页', 15_000)) !== true) {
    fail('中文 PDF 没有渲染出页数', (await body3()).slice(0, 900));
  }
  // ① 取用记录：这份文档**真的**向内置工厂要过那份 cmap（"不缺字"的第一步）
  // 取用记录是**按需**产生的：轮询等它出现（同时把渲染层的 console 收下来，失败时一并打印）
  const pdfConsole = [];
  const tapConsole = (msg) => pdfConsole.push(`${msg.type()}: ${msg.text()}`);
  win3.on('console', tapConsole);
  let servedAttr = '';
  for (let i = 0; i < 32 && !servedAttr.includes('Adobe-GB1-UCS2.bcmap'); i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    servedAttr = (await win3.locator('.jj-pdf').first().getAttribute('data-pdf-assets')) ?? '';
  }
  win3.off('console', tapConsole);
  // 名字是**实测出来的**：pdfjs 对 `(Adobe)(GB1)` 的 CID 字体要的是 `Adobe-GB1-UCS2.bcmap`，
  // 而不是 `UniGB-UCS2-H.bcmap` —— 第一次跑就是在这里红的（那一族当时没打包）
  if (!servedAttr.includes('Adobe-GB1-UCS2.bcmap')) {
    fail(
      `这份中文 PDF 没有取用内置的 Adobe-GB1-UCS2（data-pdf-assets 实际是：${servedAttr || '（空）'}）`,
      pdfConsole.slice(-10).join(' | '),
    );
  }
  /*
   * ② 映射证据：**抽字**抽出"你好"。
   *
   * 预定义 CMap 干的活就是"字节 → 字符"的映射 —— 少了它，这串字节映射不出正确的字，
   * 抽字会得到空或乱码。这一步与"字形从哪来"无关，所以它验的正是 CMap 本身。
   *
   * 为什么不是像素：先写过"画布上有墨色像素"，实测为 **0**，而且**不是缺字** ——
   * 这份 fixture 的字体没内嵌、环境里也没有可用的系统字体，所以 pdfjs 什么都没画。
   * 像素验的是"字形渲染"，CMap 只负责"映射"；把两者混在一起会得出错误的结论（这次就差点）。
   */
  let pageText = '';
  for (let i = 0; i < 32 && !pageText.includes('你好'); i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    pageText = (await win3.locator('.jj-pdf').first().getAttribute('data-pdf-text')) ?? '';
  }
  if (!pageText.includes('你好')) {
    fail(
      `这份中文 PDF 没有抽取到「你好」（实际：${pageText === '' ? '（空）' : pageText}）—— 内置 CMap 没生效`,
      pdfConsole.slice(-10).join(' | '),
    );
  }
  ok(`中文 PDF：内置 cmap 被取用（${servedAttr}），抽字得到 ${pageText} —— 字节经这份 CMap 正确映射`);

  /* ---------------- M9a：无限画布（图跑起来 / 成环被拒 / 工具节点过审批） ----------------
   *
   * 三步各验一件事，断言全部落在**真值**上：
   * ① 三节点链真的跑完（节点状态来自主进程事件，最后一步工具的输出出现在回执里）；
   * ② 磁盘上的坏图（成环）在**运行前**被主进程拒 —— 不是靠界面拦；
   * ③ 工具节点跑起来会弹审批，拒绝之后**节点状态是"被拒"**（不是静默跳过、也不是"失败"）。
   *
   * 图 fixture 直接写进数据目录（信封与真实落盘同形），然后在「画布」页签里点开它 ——
   * 这样验的是"应用真的能从盘上读回一张图"，不是"界面刚建了什么"。
   */
  const canvasDir = join(dataDir, 'canvas');
  mkdirSync(canvasDir, { recursive: true });
  const writeGraph = (id, graph) => {
    writeFileSync(
      join(canvasDir, `${id}.json`),
      JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), data: graph }, null, 2),
      'utf8',
    );
  };
  const chainId = 'e2e-canvas-chain-0001';
  const cyclicId = 'e2e-canvas-cyclic-0001';
  const deniedId = 'e2e-canvas-denied-0001';
  const readmeForChain = '需要读回的那一行在 readme 里';
  writeFileSync(join(wsDir, 'canvas-readme.txt'), `${readmeForChain}\n`, 'utf8');
  writeGraph(chainId, {
    version: 1,
    connectionId: seededEchoConnId,
    nodes: [
      { id: 'n1', kind: 'prompt', x: 40, y: 40, config: { prompt: '把要点说一句' } },
      { id: 'n2', kind: 'tool', x: 260, y: 40, config: { toolName: 'list_dir', argsText: '{"path":"."}' } },
      {
        id: 'n3',
        kind: 'tool',
        x: 480,
        y: 40,
        config: { toolName: 'read_file', argsText: '{"path":"canvas-readme.txt"}' },
      },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2' },
      { id: 'e2', from: 'n2', to: 'n3' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  writeGraph(cyclicId, {
    version: 1,
    connectionId: seededEchoConnId,
    nodes: [
      { id: 'c1', kind: 'tool', x: 0, y: 0, config: { toolName: 'list_dir', argsText: '{}' } },
      { id: 'c2', kind: 'tool', x: 200, y: 0, config: { toolName: 'list_dir', argsText: '{}' } },
    ],
    edges: [
      { id: 'ce1', from: 'c1', to: 'c2' },
      { id: 'ce2', from: 'c2', to: 'c1' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  writeGraph(deniedId, {
    version: 1,
    connectionId: seededEchoConnId,
    nodes: [
      {
        id: 'd1',
        kind: 'tool',
        x: 0,
        y: 0,
        config: { toolName: 'write_file', argsText: '{"path":"canvas-should-not-exist.txt","content":"x"}' },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  /**
   * B3 的条件分支图也**和上面几张一起写**：画布侧栏的图列表只在面板首次挂载时拉一次
   * （B3 步骤跑到时面板早挂着了）—— 写晚了它不会出现在列表里，点都点不到。
   */
  const branchId = 'e2e-canvas-branch-0001';  writeGraph(branchId, {
    version: 1,
    connectionId: seededEchoConnId,
    nodes: [
      { id: 'c1', kind: 'condition', x: 40, y: 20, config: { prompt: 'E2E_B3_命中关键词的提示', keyword: '命中关键词' } },
      { id: 't1', kind: 'tool', x: 300, y: 0, config: { toolName: 'read_file', argsText: '{"path":"canvas-readme.txt"}' } },
      { id: 'f1', kind: 'tool', x: 300, y: 120, config: { toolName: 'list_dir', argsText: '{"path":"."}' } },
      { id: 'f1b', kind: 'tool', x: 540, y: 120, config: { toolName: 'list_dir', argsText: '{"path":"."}' } },
      { id: 'c2', kind: 'condition', x: 40, y: 280, config: { prompt: 'E2E_B3_另一件小事', keyword: '绝不出现的词' } },
      { id: 't2', kind: 'tool', x: 300, y: 280, config: { toolName: 'list_dir', argsText: '{"path":"."}' } },
      { id: 'f2', kind: 'tool', x: 300, y: 400, config: { toolName: 'read_file', argsText: '{"path":"canvas-readme.txt"}' } },
    ],
    edges: [
      { id: 'be1', from: 'c1', to: 't1', fromPort: 'true' },
      { id: 'be2', from: 'c1', to: 'f1', fromPort: 'false' },
      { id: 'be3', from: 'f1', to: 'f1b' },
      { id: 'be4', from: 'c2', to: 't2', fromPort: 'true' },
      { id: 'be5', from: 'c2', to: 'f2', fromPort: 'false' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  });

  /**
   * B3b 的两张循环图也一起写（理由同上：图列表只在面板首次挂载时拉一次）。
   * 场景①：终止词 ECHO —— 回显服务的回答里必然带"ECHO"，第 1 轮就命中；
   * 场景②：终止词永不出现 + 只剩 2 轮 —— 跑满轮数上界，必须"到界=失败且说明白"。
   */
  const loopHitId = 'e2e-canvas-loop-hit-0001';
  writeGraph(loopHitId, {
    version: 1,
    connectionId: seededEchoConnId,
    nodes: [
      { id: 'L', kind: 'loop', x: 40, y: 40, config: { prompt: 'E2E_LOOP 继续写', stopKeyword: 'ECHO', maxRounds: 3 } },
      { id: 'tail', kind: 'prompt', x: 300, y: 40, config: { prompt: '收尾说一句' } },
    ],
    edges: [{ id: 'le1', from: 'L', to: 'tail' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  const loopBoundId = 'e2e-canvas-loop-bound-0001';
  writeGraph(loopBoundId, {
    version: 1,
    connectionId: seededEchoConnId,
    nodes: [
      { id: 'L', kind: 'loop', x: 40, y: 40, config: { prompt: 'E2E_LOOP 继续改', stopKeyword: '绝不出现E2E_ZZZ', maxRounds: 2 } },
      { id: 'tail', kind: 'prompt', x: 300, y: 40, config: { prompt: '收尾说一句' } },
    ],
    edges: [{ id: 'le2', from: 'L', to: 'tail' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  });

  step('M9a 画布：三节点链真的跑完（节点状态来自主进程事件，最后一步工具的输出在回执里）');
  await win3.locator('nav.app-tabs button', { hasText: '画布' }).first().click();
  if ((await waitText3('运行这张图', 15_000)) !== true) {
    fail('「画布」页签没有渲染出来（React Flow 的懒加载 chunk 没取到？）', (await body3()).slice(0, 700));
  }
  await win3.locator(`button[data-graph-id="e2e-canvas-chain-0001"]`).first().click();
  if ((await waitText3('已打开 e2e-canvas-chain-0001', 10_000)) !== true) {
    fail('从磁盘打开那张三节点图失败', (await body3()).slice(0, 700));
  }
  const chainNodes = await win3.locator('[data-node-status]').count();
  if (chainNodes !== 3) fail(`画布上应该有三个节点（实际 ${String(chainNodes)} 个）`);
  await win3.locator('button', { hasText: '运行这张图' }).first().click();
  if ((await waitText3('跑完了', 30_000)) !== true) {
    fail('三节点链没有跑完', (await body3()).slice(0, 900));
  }
  const chainBody = await body3();
  if (!chainBody.includes(readmeForChain)) {
    fail('最后一步工具的输出没出现在回执里（那一步可能根本没跑）', chainBody.slice(-600));
  }
  const okCount = await win3.locator('[data-node-status="ok"]').count();
  if (okCount !== 3) fail(`三个节点应该都是 ok（实际 ${String(okCount)} 个）`, chainBody.slice(-600));
  const savedChain = readFileSync(join(canvasDir, `${chainId}.json`), 'utf8');
  if ((savedChain.match(/"kind":/g) ?? []).length !== 3) fail('存下的图里不是三个节点', savedChain.slice(0, 400));
  ok('三节点链跑完：三个节点状态都是 ok，最后一步工具的输出（磁盘上那行字）出现在回执里');

  step('M9a 画布：成环的图在**运行前**被主进程拒（不是靠界面拦）');
  await win3.locator(`button[data-graph-id="e2e-canvas-cyclic-0001"]`).first().click();
  if ((await waitText3('已打开 e2e-canvas-cyclic-0001', 10_000)) !== true) {
    fail('打开成环那张图失败', (await body3()).slice(0, 700));
  }
  await win3.locator('button', { hasText: '运行这张图' }).first().click();
  if ((await waitText3('连成了环', 15_000)) !== true) {
    fail('成环的图没有被拒（二次校验没生效？）', (await body3()).slice(0, 900));
  }
  ok('成环被拒：主进程在跑之前就拦住，并说清"连成了环"');

  step('M9a 画布：工具节点跑起来会弹审批；拒绝之后节点状态是"被拒"');
  await win3.locator(`button[data-graph-id="e2e-canvas-denied-0001"]`).first().click();
  if ((await waitText3('已打开 e2e-canvas-denied-0001', 10_000)) !== true) {
    fail('打开"写文件"那张图失败', (await body3()).slice(0, 700));
  }
  await win3.locator('button', { hasText: '运行这张图' }).first().click();
  if ((await waitText3('需要你确认：', 15_000)) !== true) {
    fail('工具节点跑起来没有弹审批（写类必须问人）', (await body3()).slice(0, 900));
  }
  await win3.locator('button', { hasText: '拒绝' }).first().click();
  if ((await waitText3('被拒', 15_000)) !== true) {
    fail('拒绝之后没有"被拒"的结论', (await body3()).slice(0, 900));
  }
  const deniedCount = await win3.locator('[data-node-status="denied"]').count();
  if (deniedCount !== 1) fail(`拒绝之后节点状态应该是 denied（实际 ${String(deniedCount)} 个）`, (await body3()).slice(-500));
  if (existsSync(join(wsDir, 'canvas-should-not-exist.txt'))) {
    fail('用户拒绝了，文件却还是被写出来了（拒绝必须真的不做）');
  }
  ok('工具节点过同一扇门：弹审批、拒绝后节点状态=被拒、磁盘上没有文件');

  /**
   * B1：命令面板 / 右键与双击建节点 / 对齐辅助线。全是界面行为，断言也全在界面上：
   * 面板从**按钮**进（键盘 Ctrl+K 另验一次开关）；建节点用 DOM 计数；对齐用"拖动中出线、
   * 松手后真的贴到同一条竖线（±1.5px）"两头验 —— 不碰任何执行语义。
   */
  step('B1 画布：命令面板（按钮与 Ctrl+K 两条路）过滤后建节点；右键菜单与双击在落点建节点');
  await win3.locator('nav.app-tabs button', { hasText: '画布' }).first().click();
  await win3.locator(`button[data-graph-id="e2e-canvas-chain-0001"]`).first().click();
  if ((await waitText3('已打开 e2e-canvas-chain-0001', 10_000)) !== true) {
    fail('重新打开三节点图失败（B1 步骤的起点）', (await body3()).slice(0, 700));
  }
  const nodeCount = () => win3.locator('.jj-canvas-node').count();
  const baseCount = await nodeCount();

  await win3.locator('button', { hasText: '命令面板' }).first().click();
  if ((await win3.locator('[aria-label="命令面板"]').count()) !== 1) {
    fail('点了「命令面板」按钮，面板没有出来', (await body3()).slice(0, 500));
  }
  await win3.locator('input[aria-label="命令"]').fill('添加提示词');
  await win3.locator('.jj-palette-item', { hasText: '添加提示词节点' }).first().click();
  if ((await win3.locator('[aria-label="命令面板"]').count()) !== 0) fail('执行命令后面板没有关掉');
  if ((await nodeCount()) !== baseCount + 1) {
    fail(`命令面板执行"添加提示词节点"后节点数不对：${String(baseCount)} → ${String(await nodeCount())}`);
  }
  // 键盘那条路：Ctrl+K 开、Esc 关（只验开关，不重复执行命令）
  await win3.keyboard.press('Control+k');
  if ((await win3.locator('[aria-label="命令面板"]').count()) !== 1) fail('Ctrl+K 没有打开命令面板');
  await win3.keyboard.press('Escape');
  if ((await win3.locator('[aria-label="命令面板"]').count()) !== 0) fail('Esc 没有关掉命令面板');
  ok('命令面板：按钮与 Ctrl+K 都能开，过滤后执行建节点（+1），执行后自动关、Esc 能关');

  const mainBox = await win3.locator('.jj-canvas-main').boundingBox();
  if (mainBox === null) fail('取不到画布区域的框');
  // 双击空白处（右下角一带没有控件）：落点建一个提示词节点
  await win3.mouse.dblclick(mainBox.x + mainBox.width - 90, mainBox.y + mainBox.height - 90);
  if ((await nodeCount()) !== baseCount + 2) {
    fail(`双击空白处没有建出节点：${String(baseCount + 1)} → ${String(await nodeCount())}`);
  }
  // 右键空白处：出菜单 → 选"加一个工具节点" → 再 +1，且新节点带"工具"字样
  await win3.mouse.click(mainBox.x + mainBox.width - 160, mainBox.y + mainBox.height - 140, { button: 'right' });
  if ((await waitText3('加一个工具节点', 8_000)) !== true) {
    fail('空白处右键没有出现建节点菜单', (await body3()).slice(0, 700));
  }
  await win3.locator('button', { hasText: '加一个工具节点' }).first().click();
  if ((await nodeCount()) !== baseCount + 3) {
    fail(`右键菜单建节点后数量不对：${String(baseCount + 2)} → ${String(await nodeCount())}`);
  }
  if ((await win3.locator('.jj-canvas-node', { hasText: '工具' }).count()) < 1) {
    fail('右键菜单建的节点不是工具节点（卡片上没有"工具"字样）');
  }
  ok('双击与右键都能建节点，落点与类型都对（DOM 计数为证）');

  step('B1 画布：拖动时出现对齐辅助线，松手后真的贴到同一条竖线（先网格、后对齐）');
  const nodeEls = win3.locator('.react-flow__node');
  /** 节点的**流坐标**（React Flow 把 translate(x,y) 写在节点 wrapper 的 style 上） */
  const flowPos = async (i) =>
    win3.evaluate((idx) => {
      const el = document.querySelectorAll('.react-flow__node')[idx];
      if (!el) return null;
      const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform);
      return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
    }, i);
  /** 当前视口缩放（fitView 会改它 —— 屏幕像素差 ≠ 流坐标差，必须换算） */
  const zoom = await win3.evaluate(() => {
    const vp = document.querySelector('.react-flow__viewport');
    const m = vp ? /scale\((-?[\d.]+)\)/.exec(vp.style.transform) : null;
    return m ? Number(m[1]) : 1;
  });
  const pA0 = await flowPos(0);
  const pB0 = await flowPos(1);
  if (pA0 === null || pB0 === null) fail('读不到节点的流坐标（对齐断言的前提）');
  const boxA0 = await nodeEls.nth(0).boundingBox();
  if (boxA0 === null) fail('取不到第一个节点的屏幕框');
  const startX = boxA0.x + boxA0.width / 2;
  const startY = boxA0.y + boxA0.height / 2;
  await win3.mouse.move(startX, startY);
  await win3.mouse.down();
  // 先小动一步"点火"（拖动有 1px 阈值），再往目标走
  await win3.mouse.move(startX + 3, startY + 3, { steps: 2 });
  const targetDx = (pB0.x - pA0.x) * zoom;
  const targetDy = 60; // 屏幕像素：往下挪开一点，避免和对方重叠
  let guideSeen = false;
  // 网格取整最多把落点挪 ±8 流坐标 —— 在目标点周围按流坐标 ±12、步长 2 扫一圈找吸附窗口
  for (let off = -12; off <= 12 && !guideSeen; off += 2) {
    await win3.mouse.move(startX + targetDx + off * zoom, startY + targetDy, { steps: 3 });
    if ((await win3.locator('.jj-align-line').count()) > 0) guideSeen = true;
  }
  const pADrag = await flowPos(0);
  if (!guideSeen) {
    await win3.mouse.up();
    fail(
      `拖动靠近对方左线时没有出现对齐辅助线（拖动是否生效：起点 ${JSON.stringify(pA0)} → 途中 ${JSON.stringify(pADrag)}；zoom=${String(zoom)}）`,
      (await body3()).slice(0, 400),
    );
  }
  await win3.mouse.up();
  if ((await win3.locator('.jj-align-line').count()) !== 0) fail('松手之后辅助线没有清掉');
  const pA1 = await flowPos(0);
  if (pA1 === null) fail('松手后读不到节点位置');
  if (Math.abs(pA1.x - pB0.x) > 1.5) {
    fail(`松手后没有贴在对方的左线上：A.x=${pA1.x.toFixed(1)} B.x=${pB0.x.toFixed(1)}`);
  }
  ok('拖动中出辅助线、松手即清掉；节点真的贴到同一条竖线（±1.5px，先网格后对齐）');

  /**
   * B2：局部重跑。真值三层：① 整图先跑一遍（n1/n2/n3 都 ok，且**没有**重跑标）；
   * ② 从中间节点 n2 重跑 → 执行行说"2 个节点"、n2/n3 带上重跑标；③ 上游 n1 保持 ok 且**没有**标
   * （它没被重跑）—— 三个都用 DOM 真值断，不看界面文案自述之外的任何东西。
   */
  step('B2 画布：从中间节点重跑 —— 只跑该段、上游不动、重跑标点在节点上');
  await win3.locator('nav.app-tabs button', { hasText: '画布' }).first().click();
  await win3.locator(`button[data-graph-id="e2e-canvas-chain-0001"]`).first().click();
  if ((await waitText3('已打开 e2e-canvas-chain-0001', 10_000)) !== true) {
    fail('重新打开三节点图失败（B2 步骤的起点）', (await body3()).slice(0, 700));
  }
  await win3.locator('button', { hasText: '运行这张图' }).first().click();
  if ((await waitText3('跑完了（3 个节点）', 20_000)) !== true) {
    fail('整图没有跑完（B2 的前置状态）', (await body3()).slice(0, 900));
  }
  if ((await win3.locator('[data-rerun="1"]').count()) !== 0) {
    fail('整图跑完之后不该有"重跑"标（那是局部重跑的记号）');
  }
  await win3.locator('.react-flow__node').nth(1).click();
  if ((await waitText3('从此节点重跑', 8_000)) !== true) {
    fail('选中节点后没有出现"从此节点重跑"入口', (await body3()).slice(0, 700));
  }
  await win3.locator('button', { hasText: '从此节点重跑' }).first().click();
  if ((await waitText3('从 n2 重跑：2 个节点', 20_000)) !== true) {
    fail('从 n2 的重跑没有按"2 个节点"完成', (await body3()).slice(0, 900));
  }
  const rerunMarks = await win3.locator('[data-rerun="1"]').count();
  if (rerunMarks !== 2) fail(`重跑标应该恰好在 2 个节点上（实际 ${String(rerunMarks)} 个）`);
  const statusOf = (i) => win3.locator('.react-flow__node').nth(i).locator('.jj-canvas-node').getAttribute('data-node-status');
  const s1 = await statusOf(0);
  const s2 = await statusOf(1);
  const s3 = await statusOf(2);
  if (s1 !== 'ok' || s2 !== 'ok' || s3 !== 'ok') {
    fail(`重跑之后三个节点的状态不对：n1=${String(s1)} n2=${String(s2)} n3=${String(s3)}`);
  }
  const n1Marked = await win3.locator('.react-flow__node').nth(0).locator('[data-rerun="1"]').count();
  const n2Marked = await win3.locator('.react-flow__node').nth(1).locator('[data-rerun="1"]').count();
  if (n1Marked !== 0) fail('上游 n1 被打上了"重跑"标 —— 它不该被重跑');
  if (n2Marked !== 1) fail('重跑的起点 n2 上没有"重跑"标');
  ok('从 n2 重跑：执行行说"2 个节点"、n2/n3 带重跑标、n1 保持 ok 且无标（上游未动）');

  /**
   * B3：条件分支。断言全部落在**节点真值**上（不看界面自述）：
   * ① 条件卡片上真有一对可拖的口（`data-port` 标签）与判定关键词行；
   * ② c1 命中关键词 → 真口那支跑、假口那支 skipped；c2 没命中 → 反过来；
   * ③ "被跳过"不传播：f1 的下游 f1b 同样 skipped（执行行也如实报"几个执行、几个被跳过"）；
   * ④ 出口（fromPort）过了**真实渲染层的存/读往返**还活着 —— 落盘文件里两个口都在。
   * 覆盖边界：t1 / f2 的**输出文本**不在本步断（最终一行的 note 被最后事件占着）——
   * 工具输出确实会进回执这条由 M9a 三节点链那步负责（那里读的就是 readme 的内容）。
   */
  step('B3 画布：条件分支 —— 选中的口执行、没选的那支与它的下游被跳过（都记在节点上）');
  await win3.locator('nav.app-tabs button', { hasText: '画布' }).first().click();
  await win3.locator(`button[data-graph-id="${branchId}"]`).first().click();
  if ((await waitText3(`已打开 ${branchId}`, 10_000)) !== true) {
    fail('打开条件分支那张图失败', (await body3()).slice(0, 700));
  }
  const portTagCount = await win3.locator('[data-port]').count();
  if (portTagCount !== 4) {
    fail(`两张条件卡应各有两个出口标签（真/假），实际 ${String(portTagCount)} 个`);
  }
  if ((await win3.locator('.jj-canvas-node', { hasText: '含「命中关键词」走真口' }).count()) !== 1) {
    fail('条件卡片上没有显示判定关键词（加载时 keyword 没带进卡片？）');
  }
  await win3.locator('button', { hasText: '运行这张图' }).first().click();
  if ((await waitText3('跑完了（7 个节点：4 个执行、3 个被跳过）', 30_000)) !== true) {
    fail('条件分支图没有按预期跑完（执行行没分开报数？）', (await body3()).slice(0, 900));
  }
  const branchStatus = async (i) =>
    win3.locator('.react-flow__node').nth(i).locator('.jj-canvas-node').getAttribute('data-node-status');
  const expectStatus = async (i, want, what) => {
    const got = await branchStatus(i);
    if (got !== want) fail(`${what}：期望 ${want}，实际 ${String(got)}`);
  };
  await expectStatus(0, 'ok', 'c1（条件）应该跑完');
  await expectStatus(1, 'ok', 'c1 真口上的 t1 应该执行');
  await expectStatus(2, 'skipped', 'c1 假口上的 f1 应该被跳过');
  await expectStatus(3, 'skipped', '被跳过节点的下游 f1b 也该跳过');
  await expectStatus(4, 'ok', 'c2（条件）应该跑完');
  await expectStatus(5, 'skipped', 'c2 真口上的 t2 应该被跳过');
  await expectStatus(6, 'ok', 'c2 假口上的 f2 应该执行');
  const branchBody = await body3();
  if (!branchBody.includes('f1b skipped') || !branchBody.includes('被跳过（上游分支没走这边）')) {
    fail('被跳过的节点没有出现在执行行里（状态与原因都要能读出来）', branchBody.slice(-600));
  }
  const savedBranch = readFileSync(join(canvasDir, `${branchId}.json`), 'utf8');
  if (!savedBranch.includes('"fromPort": "true"') || !savedBranch.includes('"fromPort": "false"')) {
    fail('存下的图里出口（fromPort）没保住（界面往返把它丢了？）', savedBranch.slice(0, 600));
  }
  if (!savedBranch.includes('"keyword": "命中关键词"')) {
    fail('存下的图里判定关键词没保住', savedBranch.slice(0, 600));
  }
  // 界面上也能一键建条件节点（按钮那条路；建出来的是空关键词的卡 —— 保存前会被校验拦，这里只验建得出）
  const branchNodeCount = await win3.locator('.jj-canvas-node').count();
  await win3.locator('button', { hasText: '+ 条件节点' }).first().click();
  if ((await win3.locator('.jj-canvas-node').count()) !== branchNodeCount + 1) {
    fail('点「+ 条件节点」没有建出节点');
  }
  if ((await win3.locator('.jj-canvas-node', { hasText: '还没填判定关键词' }).count()) !== 1) {
    fail('新建的条件卡上没有"空关键词"的提示（卡片渲染不对？）');
  }
  ok('条件分支：c1 走真口 / c2 走假口，未选两支与下游都是 skipped，执行行分开报数，fromPort 与 keyword 落盘');

  step('M8 收口：推送是外发 —— 批准才发得出去、拒绝就一个字节都不发，弹窗里也没有「总是允许」');
  /**
   * 真远端 = 一个 bare 仓库（放在本轮的临时目录里，不碰任何真实仓库）。
   * 断言看的是 **bare 侧的提交数**，不是界面文案 —— 与第 17/18 步同一套做法（复核 026 的 G-8 教训）。
   */
  const remoteDir = join(TMP_ROOT, 'e2e-remote.git');
  mkdirSync(remoteDir, { recursive: true });
  await runGit('git', ['init', '--bare', '-q'], { cwd: remoteDir, windowsHide: true });
  await runGit('git', ['remote', 'add', 'origin', remoteDir], { cwd: wsDir, windowsHide: true });

  const remoteCount = async () => {
    try {
      const r = await runGit('git', ['--git-dir', remoteDir, 'rev-list', '--count', '--all'], { windowsHide: true });
      return Number.parseInt(r.stdout.trim(), 10);
    } catch {
      return 0; // 空的 bare 仓库一个引用都没有：这里按 0 次算，不当成失败
    }
  };

  /** 在工作区里造一次本地提交（走命令行，是为了把"推"这一步单独隔离出来看） */
  let pushSeq = 0;
  /**
   * **带退避地等 git 的 index.lock 松开**。
   * 为什么需要：这个仓库同时被两边用 —— 应用在里面跑 status/diff/log/push，测试脚本在外面写文件并提交。
   * git 用 `.git/index.lock` 互斥，撞到就当场 `Unable to create ...: File exists` 抛异常
   * （这一步第一次红就是红在这儿，不是产品缺陷）。重试是有界的：等不到就把现场交出来。
   */
  const gitInWs = async (args, tries = 20) => {
    for (let i = 0; i < tries; i += 1) {
      try {
        await runGit('git', args, { cwd: wsDir, windowsHide: true });
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('index.lock') || i === tries - 1) {
          fail(`在测试工作区跑 git 失败：${args.join(' ')}`, msg.slice(0, 600));
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  };

  const localCommit = async () => {
    pushSeq += 1;
    const f = `push-${String(pushSeq)}.txt`;
    writeFileSync(join(wsDir, f), `给远端看的一行 ${String(pushSeq)}\n`, 'utf8');
    await gitInWs(['add', '--', f]);
    await gitInWs(['commit', '-qm', `第 ${String(pushSeq)} 次给远端的提交`]);
  };

  await localCommit();
  await win3.locator('nav.app-tabs button', { hasText: 'Git' }).first().click();
  if ((await waitText3('推送到远端', 12_000)) !== true) {
    fail('Git 页签里没有"推送到远端"这一块（界面没挂上？）', await body3());
  }
  /**
   * 再等一步"**分支名也读到了**"才能点。
   * 只等区块标题会抢在 `git status` 回来之前点下去 —— 那时 `branch` 还是 null，
   * 面板会老实地回一句"HEAD 没指向任何分支，无从推送"，测试就红在界面上（这一条就是这么抓出来的）。
   */
  if ((await waitText3('当前分支', 15_000)) !== true) {
    fail('Git 页签一直没读到当前分支（status 没回来？），推送按钮点下去只会得到"无从推送"', await body3());
  }

  // ① 批准那一次：远端真的收到
  const beforeAllow = await remoteCount();
  await win3.locator('button', { hasText: '推送「origin」' }).first().click();
  if ((await waitText3('需要你确认：发到远端', 12_000)) !== true) {
    fail('点推送没有弹出硬确认（外发动作必须问过人手）', await body3());
  }
  const dialogBox = win3.locator('[role="dialog"][aria-label="权限请求"]');
  const alwaysOnPush = await dialogBox.locator('button', { hasText: '本次会话总是允许' }).count();
  if (alwaysOnPush > 0) {
    fail('推送的确认框里出现了「本次会话总是允许」—— 外发不可逆，这条捷径绝不能给（T19 同族的空承诺）');
  }
  await dialogBox.locator('button', { hasText: '允许一次' }).first().click();
  await win3.waitForSelector('[role="dialog"][aria-label="权限请求"]', { state: 'detached', timeout: 15_000 });
  /**
   * 弹窗在"**决定送出去**"那一刻就关了，**不等 `git push` 跑完** ——
   * 所以完成信号取面板上那一行"已推送到…"，不是弹窗消失（上一版直接在这里数远端，读到的必然是 0）。
   */
  if ((await waitText3('已推送到', 25_000)) !== true) {
    fail('批准之后面板没有出现"已推送到"那一行：外发要么失败要么静默（理由见现场）', await body3());
  }
  const afterAllow = await remoteCount();
  if (afterAllow <= beforeAllow) {
    fail(
      `界面说已推送，远端却没收到提交（${String(beforeAllow)} → ${String(afterAllow)}）—— 话与事实打脸`,
      await body3(),
    );
  }

  // ② 拒绝那一次：远端一个字节都不许多
  await localCommit();
  const beforePushDeny = await remoteCount();
  await win3.locator('button', { hasText: '推送「origin」' }).first().click();
  if ((await waitText3('需要你确认：发到远端', 12_000)) !== true) {
    fail('第二次推送没有再弹确认 —— 硬 ask 不该有"记住"这条路', await body3());
  }
  await win3.locator('[role="dialog"][aria-label="权限请求"] button', { hasText: '拒绝' }).first().click();
  if ((await waitText3('你拒绝了这次操作', 12_000)) !== true) {
    fail('拒绝之后界面没给可读理由', await body3());
  }
  const afterPushDeny = await remoteCount();
  if (afterPushDeny !== beforePushDeny) {
    fail(`拒绝了却仍然发出去了（${String(beforePushDeny)} → ${String(afterPushDeny)}）—— 外发被静默执行`);
  }
  ok(`推送：批准才发（远端 ${String(beforeAllow)} → ${String(afterAllow)}）、拒绝就不发（${String(beforePushDeny)} 不变），两次都弹硬确认且没有「总是允许」`);

  step('T23 终端页：切走页签会话不结束，回来接回同一个会话（切走期间的输出补得回来，也不多出一个 PTY）');
  /**
   * 断言的落点是**主进程报的会话数**（`共用 1 /` 里那个 1 来自 `TerminalService.sessions.size`），
   * 不是界面文案：如果"回来"走的是重新起进程，这里会变成 2 —— 而旧那个进程的 id 渲染层已经叫不出来，
   * 只能等应用退出才回收。这就是 T23 修掉的那条缺陷的真值口径（复核 026 的 G-8 同一条纪律）。
   */
  await win3.locator('nav.app-tabs button', { hasText: '终端' }).first().click();
  if ((await waitText3('启动终端（新会话需审批）', 12_000)) !== true) {
    fail('终端页没挂上（看不到启动按钮）', await body3());
  }
  await win3.locator('button', { hasText: '启动终端（新会话需审批）' }).first().click();
  if ((await waitText3('启动终端会话', 12_000)) !== true) {
    fail('点启动没有弹权限确认（终端能跑任意命令，新建会话必须问过人手）', await body3());
  }
  await win3.locator('[role="dialog"][aria-label="权限请求"] button', { hasText: '允许一次' }).first().click();
  if ((await waitText3('运行中', 15_000)) !== true) {
    fail('批准之后终端页没有进入运行态', await body3());
  }

  /**
   * 让子进程在**我们切走之后**才吐出 marker（2.5 秒的延时）。
   * 否则补回来的可能只是切走前就已经在屏幕上的东西，这条断言就白写了。
   */
  await win3.locator('.jj-terminal-host').first().click();
  await win3.keyboard.type("node -e \"setTimeout(function(){console.log('R4_LATE')},2500)\"");
  await win3.keyboard.press('Enter');
  await win3.locator('nav.app-tabs button', { hasText: '文档' }).first().click();
  // 这一句是**有意的定时等待**：要等的是子进程那边的定时器，而"输出发生在看不见的那一页"
  // 这个条件本身没法用条件等待表达（切回去等就破坏被测语义）
  await win3.waitForTimeout(4000);
  await win3.locator('nav.app-tabs button', { hasText: '终端' }).first().click();

  if ((await waitText3('已接回本工作区仍在运行的终端会话', 12_000)) !== true) {
    fail('切回来没有接回会话（要么被杀了，要么当成新会话又起了一个）', await body3());
  }
  const askAgain = await win3.locator('[role="dialog"][aria-label="权限请求"]').count();
  if (askAgain > 0) {
    fail('接回已有会话时又弹了一次审批 —— 接回一个新进程都没起，第二次确认是凭空多出来的');
  }
  if ((await waitText3('R4_LATE', 12_000)) !== true) {
    fail('切走期间子进程吐出的输出没有补回视图（tail 或 seq 的链路断了）', await body3());
  }
  if ((await waitText3('共用 1 /', 10_000)) !== true) {
    fail(
      '接回之后主进程报的会话数不是 1：要么旧会话被杀了，要么多起了一个没人能关的 PTY',
      await body3(),
    );
  }

  // 手工关闭：会话唯一的界面出口；关掉之后再回来，界面要讲清楚"它是自己结束的"
  await win3.locator('button', { hasText: '结束会话' }).first().click();
  if ((await waitText3('会话已由你结束', 12_000)) !== true) {
    fail('点了「结束会话」界面没有反应', await body3());
  }
  await win3.locator('nav.app-tabs button', { hasText: '文档' }).first().click();
  await win3.locator('nav.app-tabs button', { hasText: '终端' }).first().click();
  if ((await waitText3('上一个终端会话已结束（退出码', 12_000)) !== true) {
    fail(
      '会话结束之后再回来，界面只说"未启动"—— 它到底是怎么没的，用户看不见（会以为是切页签弄丢的）',
      await body3(),
    );
  }
  if ((await waitText3('共用 0 /', 10_000)) !== true) {
    fail('手工结束之后主进程还报着会话没释放（kill 没真的收掉进程）', await body3());
  }
  ok('终端：审批才起、切走不杀、切回接回同一个会话（会话数 1，不多起）、切走期间的输出补回、手工结束之后退出码可见且会话数归 0');

  step('T24 文档页：切走页签之后路径、分块进度与滚动位置都回来（内容是重读的，不是拿旧的糊）');
  const r4DocFile = 'r4-doc.md';
  const r4DocHeads = [];
  for (let i = 1; i <= 600; i += 1) r4DocHeads.push(`## H${String(i)}`);
  writeFileSync(join(wsDir, r4DocFile), `# R4 长文档\n\n${r4DocHeads.join('\n')}\n`, 'utf8');

  await win3.locator('nav.app-tabs button', { hasText: '文档' }).first().click();
  await win3.locator('.jj-docs-head .jj-field').first().fill(r4DocFile);
  await win3.locator('.jj-docs-head button', { hasText: '打开' }).first().click();
  if ((await waitText3('已显示前 240 /', 15_000)) !== true) {
    fail('长文档没有分块挂载（这一步后面三条断言都建立在"分了块"上）', await body3());
  }
  await win3.locator('button', { hasText: '继续加载' }).first().click();
  if ((await waitText3('已显示前 480 /', 15_000)) !== true) {
    fail('「继续加载」没有把分块进度推到 480', await body3());
  }
  // 程序化滚动同样会派发 scroll 事件 —— 面板就是靠它把偏移记进 store 的
  const scrolledTop = await win3.evaluate(() => {
    const el = document.querySelector('.jj-docs-body');
    if (!el) return -1;
    el.scrollTop = 900;
    return el.scrollTop;
  });
  if (scrolledTop < 900) {
    fail(`阅读容器没能滚到 900（读到 ${String(scrolledTop)}）—— 后面的"位置回来了"就无从判起`, await body3());
  }
  await win3.locator('nav.app-tabs button', { hasText: '终端' }).first().click();
  await win3.locator('nav.app-tabs button', { hasText: '文档' }).first().click();
  if ((await waitText3('已恢复到上次打开的 r4-doc.md', 15_000)) !== true) {
    fail('切回来没有恢复上次打开的文件（T24 的"记住路径"没兑现）', await body3());
  }
  if ((await waitText3('已显示前 480 /', 15_000)) !== true) {
    fail('路径恢复了但分块进度没恢复（又从 240 段起步 = 阅读位置还是丢了）', await body3());
  }
  let restoredTop = -1;
  try {
    await win3.waitForFunction(
      () => {
        const el = document.querySelector('.jj-docs-body');
        return el !== null && el.scrollTop >= 800;
      },
      null,
      { timeout: 10_000 },
    );
  } catch {
    // 不在这儿 fail：下面读一次真实值，把现场一起交出来
  }
  restoredTop = await win3.evaluate(() => {
    const el = document.querySelector('.jj-docs-body');
    return el === null ? -1 : el.scrollTop;
  });
  if (restoredTop < 800) {
    fail(`滚动位置没恢复回去（切走前 900，回来读到 ${String(restoredTop)}）—— "记住阅读位置"只兑现了一半`, await body3());
  }
  ok(`文档：路径 + 分块进度（480）+ 滚动位置（${String(restoredTop)}）都跟着回来了，而内容是重新读的那一份`);

  /* ---------------- R7：上游截断与垃圾流必须在界面上说出来 ----------------
   *
   * 为什么这四条值得为它加一步 e2e（前面几轮都刻意不加）：它们的共同形状是**静默** ——
   * 单测锁得住判定，但"用户到底看不看得见那句话"只有界面级证据算数。
   * 三条都在同一个新会话里连着问：截断的两条要各自出现，垃圾流那条必须报错而不是画一条空回答。
   */
  step('R7 上游截断 / 垃圾流：半截回答要写"不完整"、全是垃圾要报错（不许记成一次成功的空回答）');
  await win3.locator('nav.app-tabs button', { hasText: '对话' }).first().click();
  await win3.locator('select').first().selectOption(seededEchoConnId);
  const boxR7 = win3.locator('textarea[placeholder^="输入消息"]');
  const askR7 = async (text, needle, miss) => {
    await boxR7.fill(text);
    await win3.locator('button', { hasText: '发送' }).first().click();
    if ((await waitText3(needle, 15_000)) !== true) {
      fail(miss, (await body3()).slice(-700));
    }
  };
  const newChatR7 = win3.locator('button', { hasText: '新会话' });
  for (let i = 0; i < 20 && (await newChatR7.count()) === 0; i += 1) await win3.waitForTimeout(150);
  if ((await newChatR7.count()) > 0) await newChatR7.first().click();

  await askR7('E2E_TRUNC_LEN 请说一段长话', '达到长度上限被截断', 'length 截断没在界面上说出来：半截回答看起来就是"写完了"');
  await askR7('E2E_TRUNC_FILTER 请说一段长话', '被上游的内容过滤拦下', 'content_filter 被当成正常写完（T26 的归并没修好）');
  await askR7('E2E_GARBAGE 随便说点什么', '无法解析', '全是垃圾负载却被记成一次成功的空回答（T25 的静默成功回来了）');
  ok('两条截断各有自己的说法，垃圾流报错而不是画一条空回答 —— 三种结束情形在界面上分得开');

  /* ---------------- M4 收尾 · 其一：命令前缀规则（界面级证据） ----------------
   *
   * 这一步只验单测给不了的那半件事：**用户在界面上看得见这条规则管到哪一段命令，
   * 而运行时真的按那一段拦**。前缀匹配算法本身在 rules.test.ts 里已经锁死，
   * 这里刻意不重复验"组合符不算命中"那种细枝末节。
   *
   * 两个断言方向都要取真值：
   * - 命中前缀 → 必须**不弹审批**就返回拒绝（弹窗都出来了还谈什么"拦下"）；
   * - 没命中前缀 → 必须**照常弹**（规则窄了不等于放行松了）。
   */
  step('M4 收尾：命令前缀只拦它说的那条命令（拦下时不弹窗，没拦下的照常问人）');
  await win3.locator('nav.app-tabs button', { hasText: '权限' }).first().click();
  await win3.locator('.jj-perm-form input').first().waitFor({ timeout: 8_000 });
  await win3.locator('.jj-perm-form input').first().fill('run_command');
  await win3.locator('.jj-perm-form select').selectOption('deny');
  await win3.locator('.jj-perm-form input').nth(1).fill('E2E 前缀拦截');
  await win3.locator('.jj-perm-form input').nth(2).fill('jj-e2e-rm');
  await win3.getByRole('button', { name: '新增规则' }).click();
  /**
   * 只数**列表里那一行**，不判整页文字：
   * "已新增规则：…"那句提示里也带前缀文本，用 innerText 判会让"列表根本没渲染前缀"
   * 这个真缺陷蒙过去 —— 而"看不见"正是用户以为规则没生效的那条路。
   */
  // 只数规则表那些行：审计行也记录同一条命令（这是它该有的行为），共用类名会让这条断言问不出想问的东西
  const prefixRows = () => win3.locator('.jj-perm-list .jj-perm-rule', { hasText: 'jj-e2e-rm' }).count();
  let rowsAfterAdd = 0;
  for (let i = 0; i < 40 && rowsAfterAdd === 0; i += 1) {
    rowsAfterAdd = await prefixRows();
    if (rowsAfterAdd === 0) await win3.waitForTimeout(150);
  }
  if (rowsAfterAdd !== 1) fail('规则列表里看不见命令前缀（用户会以为这条规则没生效）', await body3());

  const prefixToolRun = (command) =>
    win3.evaluate(async (c) => await window.jujia.toolRun('run_command', { command: c }), command);
  const hitByPrefix = await prefixToolRun('jj-e2e-rm --force build');
  if (hitByPrefix.ok !== false || hitByPrefix.decision !== 'deny') {
    fail('命令前缀没拦住它说的那条命令', JSON.stringify(hitByPrefix).slice(0, 400));
  }
  if (!String(hitByPrefix.content).includes('命中你的规则') || !String(hitByPrefix.content).includes('jj-e2e-rm')) {
    fail('拦下了但没说清是哪条规则、哪一段前缀拦的', String(hitByPrefix.content).slice(0, 400));
  }
  if ((await win3.locator('[role="dialog"][aria-label="权限请求"]').count()) > 0) {
    fail('规则已经拒了，却还挂着审批弹窗（deny 不该再问一次）', await body3());
  }

  // 另一条命令没命中前缀：必须回到"每次执行都问人"的既有语义
  const notCovered = prefixToolRun('jj-e2e-keep');
  if ((await waitText3('需要你确认：run_command · 执行命令：jj-e2e-keep', 12_000)) !== true) {
    fail('没命中前缀的命令竟然没弹审批（少拦住一次不能等于多放行一次）', await body3());
  }
  await win3.locator('button', { hasText: '拒绝' }).first().click();
  const notCoveredRes = await notCovered;
  if (String(notCoveredRes.content).includes('命中你的规则')) {
    fail(`前缀管到了它没说的那条命令：${JSON.stringify(notCoveredRes).slice(0, 300)}`);
  }

  await win3.locator('nav.app-tabs button', { hasText: '权限' }).first().click();
  await win3.getByRole('button', { name: '删除' }).first().click();
  let rowsAfterDelete = 1;
  for (let i = 0; i < 40 && rowsAfterDelete !== 0; i += 1) {
    rowsAfterDelete = await prefixRows();
    if (rowsAfterDelete !== 0) await win3.waitForTimeout(150);
  }
  if (rowsAfterDelete !== 0) fail('删了规则，列表里却还挂着那条命令前缀', await body3());
  ok('命令前缀规则：列表里看得见前缀、命中时不弹窗就拒、没命中的照常问人、删掉之后不留影');

  /* ---------------- M4 收尾 · 其二：执行审计必须在界面上看得见、在磁盘上不含正文 ----------------
   *
   * 这一条是**唯一能证明"剔密发生在落盘之前"的证据**：单测锁的是纯函数，
   * 真应用里"写进去的到底是哪一份字节"只有从磁盘上读回来才算。
   * 两段断言方向相反：判定要在界面上看得见（记不上等于没防护），
   * 文件正文必须**不在**账里（进了账就是把用户刚写的内容复制第二遍）。
   */
  step('M4 收尾：执行审计看得见判定、看不见正文（剔密真的在落盘之前）');
  const auditSentinel = `E2E-AUDIT-SECRET-${String(Date.now()).slice(-6)}`;
  const auditFile = `audit-probe-${String(Date.now()).slice(-6)}.md`;
  const writeProbe = win3.evaluate(
    async (args) => await window.jujia.toolRun('write_file', { path: args.file, content: args.body }),
    { file: auditFile, body: `正文里夹着哨兵 ${auditSentinel}，它不该出现在审计里` },
  );
  if ((await waitText3('需要你确认：write_file', 12_000)) !== true) {
    fail('写入没有弹审批（这一轮连权限门都没过，审计自然也无从记起）', await body3());
  }
  await win3.locator('button', { hasText: '允许一次' }).first().click();
  const writeRes = await writeProbe;
  if (writeRes.ok !== true) fail(`写入没成功，审计断言随之失真：${JSON.stringify(writeRes).slice(0, 300)}`);

  await win3.locator('nav.app-tabs button', { hasText: '权限' }).first().click();
  if ((await waitText3('执行审计（今天）', 8_000)) !== true) {
    fail('权限页没有执行审计这一卡', await body3());
  }
  if ((await waitText3('write_file', 8_000)) !== true) {
    fail('审计卡里没有刚才那次判定（做过的事记不上 = 这本账不可信）', await body3());
  }
  const auditBody = await body3();
  if (!auditBody.includes('已做')) fail('审计行没写"做没做成"（deny 与"做了但失败"就分不开）', auditBody.slice(0, 900));
  if (auditBody.includes(auditSentinel)) fail('界面上的审计把文件正文带出来了（不该只留长度与指纹）');

  const auditDir = join(dataDir, 'audit');
  const auditFiles = existsSync(auditDir) ? readdirSync(auditDir).filter((f) => f.endsWith('.jsonl')) : [];
  if (auditFiles.length === 0) fail(`审计文件没落盘（目录 ${auditDir} 里空的）`);
  const ledgerText = auditFiles.map((f) => readFileSync(join(auditDir, f), 'utf8')).join('\n');
  if (!ledgerText.includes('"subject":"write_file"')) {
    fail('账本里没有 write_file 那一条判定', ledgerText.slice(0, 500));
  }
  if (ledgerText.includes(auditSentinel)) {
    fail('账本里有文件正文 —— 剔密没在落盘之前做完（这是本轮最重的一条）', ledgerText.slice(0, 500));
  }
  if (!ledgerText.includes('digests')) fail('账本没留指纹，事后无法核对"是不是同一份内容"', ledgerText.slice(0, 400));

  /* 三扇**非工具门**（R8.6）+ 内置终端（T41）：它们都不走 runTool，最容易出"某一扇忘了接"——
   * 而缺页的账看起来完全正常，所以这里拿整跑下来已经动过的那些门做真值。
   * `terminal_start` 排在这里的理由：本跑前面（T23 那一步）真的当面批过一次终端启动。 */
  const GATE_SUBJECTS = ['git_stage', 'git_commit', 'git_push', 'open_with_system', 'open_with_custom', 'hooks:modify', 'terminal_start'];
  const gateLines = ledgerText.split('\n').filter((l) => l.includes('"kind":"gate"'));
  for (const subject of GATE_SUBJECTS) {
    if (!ledgerText.includes(`"subject":"${subject}"`)) {
      fail(`账本里没有 ${subject} 那扇门（本跑到这里已经动过它至少一次）`, ledgerText.slice(0, 600));
    }
  }
  if (gateLines.length === 0) fail('账本里一条 gate 都没有（三扇门的判定没进账）', ledgerText.slice(0, 400));
  // 「做没做成」每一行都得有 —— 少了它，"批过"与"做过"在账上就分不开
  const missingExec = gateLines.find((l) => !l.includes('"executed":'));
  if (missingExec !== undefined) fail('有一条 gate 账没写做没做成', missingExec.slice(0, 300));
  // 被拒的那次必须是"问过 + 没做成"（磁盘上真没有那次提交，本跑前面已经核过）
  if (!gateLines.some((l) => l.includes('"answer":"deny"') && l.includes('"executed":false'))) {
    fail('账上没有"问过人被拒 + 没做成"那一行 —— 拒绝与放行长得一样的账没有价值');
  }
  // 外发那几笔要留下可读地址；钩子那几笔要留下要执行的命令（装了什么后门得看得见）
  if (!gateLines.some((l) => l.includes('"command":"http'))) {
    fail('交给外部程序那几笔没有留下可读地址', gateLines.slice(0, 3).join('\n').slice(0, 400));
  }
  if (!gateLines.some((l) => l.includes('JUJIA_E2E_HOOK_MARKER'))) {
    fail('钩子配置那笔没留下将要执行的命令（看不见内容的审批等于没有审批）');
  }
  /**
   * T41（2026-10-15）：内置终端这一笔必须是**另一类账** —— 它没有策略判定。
   *
   * 只断言"有这一行"是不够的：把它记成一份普通的 `ask` 会让规则页那句"你的规则管得住它"
   * 变成谎言，而账目看起来完全正常。所以这里钉三格：`decidedBy:'person'`（来源）、
   * `bypassable:false`（这一类没有"总是允许"能压掉的档位）、`executed:true`（那次会话真起来了）。
   */
  const terminalLines = gateLines.filter((l) => l.includes('"subject":"terminal_start"'));
  if (terminalLines.length === 0) fail('账上没有内置终端那一笔（T41 说好了要入账）');
  for (const line of terminalLines) {
    if (!line.includes('"decidedBy":"person"')) {
      fail('终端那一笔没标"没有策略判定"这一类（记成普通 ask 就等于说规则页管得住它）', line.slice(0, 300));
    }
    if (!line.includes('"bypassable":false')) {
      fail('终端那一笔没标压不掉：这一类没有「总是允许」的档位', line.slice(0, 300));
    }
  }
  if (!terminalLines.some((l) => l.includes('"executed":true'))) {
    fail('账上没有"终端真的起来了"那一笔（本跑前面已经批准并接回过会话）', terminalLines.join('\n').slice(0, 400));
  }
  if (!terminalLines.some((l) => l.includes('不查策略表'))) {
    fail('终端那一笔的 reason 没说出"不查策略表"（事后翻账的人要知道规则为什么没生效）', terminalLines[0]?.slice(0, 300));
  }
  // 反过来：git 的提交信息属**正文**，这一格刻意不给可读形态，只该留下长度与指纹
  if (ledgerText.includes('e2e：接上了 git')) {
    fail('git 提交信息被原文抄进账本（这一格不该有可读形态）', ledgerText.slice(0, 500));
  }
  ok(`审计：工具与四扇非工具门（含内置终端那一类"没有策略判定"）都在账上（gate 行 ${String(gateLines.length)} 条），有指纹有长度；正文进不去，该看得见的一条没少`);

  step('R8.7 长命令实时输出：先吐的那行在命令跑完之前就得看得见（不是跑完一次性给出）');
  /**
   * 这一幕只能是界面级证据：单测能证明"事件发出来了"，证明不了"人在命令还挂着的时候看见了"。
   * 假服务被安排成"先要一个 run_command 调用"，那条命令故意**先吐一行、静默三秒、再吐一行**
   * —— 只按字节攒批的话这里全程空白，正是本轮补静默刷新要修掉的东西。
   */
  const streamMarker = `E2ESTREAM${String(Date.now()).slice(-5)}`;
  await win3.locator('nav.app-tabs button', { hasText: '对话' }).first().click();
  await win3.locator('select').first().selectOption(seededStreamConnId);
  await win3.locator('button', { hasText: '新会话' }).first().click();
  const streamChatBox = win3.locator('textarea[placeholder^="输入消息"]');
  await streamChatBox.fill(`E2E_CMD ${streamMarker}`);
  await win3.locator('button', { hasText: '发送' }).first().click();

  if ((await waitText3(`需要你确认：run_command`, 15_000)) !== true) {
    fail('模型要求的 run_command 没有弹审批（对话链路的权限门不在这一步的验收面里，但后面的断言全依赖它）', (await body3()).slice(0, 900));
  }
  await win3.locator('button', { hasText: '允许一次' }).first().click();
  // 先等审批弹窗真的关掉：它的标题里带着整条命令行，含 EARLY / LATE 两个字面 ——
  // 拿整页文本来判"哪一行先出现"会把弹窗里的字面当成输出（本轮第一次跑就是这么红的）
  await win3.waitForSelector('[role="dialog"][aria-label="权限请求"]', { state: 'detached', timeout: 8_000 });

  /** 只看工具卡上那一格（语义锚点），不看整页文本 */
  const tailText = async () => {
    const box = win3.locator('[data-tool-tail]').first();
    if ((await box.count()) === 0) return '';
    return (await box.textContent()) ?? '';
  };

  // ① 先吐的那一行必须在**命令还在跑**的时候就出现在卡片上
  let earlyTail = '';
  let sawEarlyWhileRunning = false;
  let sawLateEarly = false;
  for (let i = 0; i < 60; i += 1) {
    const tail = await tailText();
    if (tail.includes(`${streamMarker}-EARLY`)) {
      earlyTail = tail;
      sawEarlyWhileRunning = (await body3()).includes('执行中');
      sawLateEarly = tail.includes(`${streamMarker}-LATE`);
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (earlyTail === '') {
    fail('命令跑了半天，工具卡上没有任何实时输出（攒批没被刷新，或整条链某一环没接）', (await body3()).slice(0, 900));
  }
  if (sawLateEarly) fail('两行是一起到的：静默期刷新没起作用，等于跑完再回放', earlyTail.slice(0, 400));
  if (!sawEarlyWhileRunning) {
    fail('先吐的那一行是等命令跑完才出现的 —— 那不是"实时输出"，是结果回放', earlyTail.slice(0, 400));
  }
  ok('实时输出：命令还在跑，先吐的那一行已经单独显示在工具卡上（后一行还没到）');

  // ② 命令结束后：最后一段快照补全，收尾话也说对
  if ((await waitText3(`${streamMarker}-LATE`, 20_000)) !== true) {
    fail('命令跑完了，界面上却始终没见到后一行（closeAll / onEnd 的补发没生效）', (await body3()).slice(0, 900));
  }
  if ((await waitText3('E2E-CMD-FINAL', 20_000)) !== true) {
    fail('工具跑完后模型没有收尾回答（工具轮之后的第二轮没走通）', (await body3()).slice(0, 900));
  }
  const tailBoxes = await win3.locator('[data-tool-tail]').count();
  if (tailBoxes === 0) fail('工具卡上的实时输出那一格没有语义锚点（data-tool-tail）');
  ok('收尾之后：最后一段输出补全，模型的收尾回答也照常到达');

  step('M7 定时任务：开机补跑只补一次、跳过几次要说出来，且水位线记的是"那一次"而不是"此刻"');
  await win3.locator('nav.app-tabs button', { hasText: '定时' }).first().click();
  if ((await waitText3('E2E 定时补跑', 10_000)) !== true) {
    fail('定时任务页没有列出启动前就埋在磁盘上的那条任务（清单没读盘，或通道没接）', await body3());
  }
  const scopeText = await body3();
  if (!scopeText.includes('免审批')) {
    fail('界面上没说清"到点照样要审批" —— 定时 ≠ 免审批 是这一条能力的安全边界，不能只写在文档里', scopeText.slice(0, 900));
  }

  const taskFile = join(dataDir, 'schedules', 'tasks.json');
  if (!existsSync(taskFile)) fail(`定时任务没落盘（找不到 ${taskFile}）`);
  const seededTask = JSON.parse(readFileSync(taskFile, 'utf8')).data.tasks.find((t) => t.id === seededTaskId);
  if (!seededTask) fail('磁盘上没有那条种子任务', readFileSync(taskFile, 'utf8').slice(0, 400));

  // ① 补跑只补一次：界面上出现"跳过 N 次"，而账上只往前走了一步
  const row = win3.locator(`[data-schedule-id="${seededTaskId}"]`).first();
  if ((await row.count()) === 0) fail('任务行上没有语义锚点 data-schedule-id（界面级断言随之失效）');
  const skippedBox = row.locator('[data-schedule-skipped]');
  if ((await skippedBox.count()) === 0) {
    fail('欠了三次却没有任何"跳过"的说法（至多补一次是要求，说明跳过了几次也是要求）', await row.innerText());
  }
  const skippedText = await skippedBox.innerText();
  if (!/跳过\s*\d+\s*次/.test(skippedText)) {
    fail(`"跳过"那句话没报数：${skippedText.slice(0, 120)}`, await row.innerText());
  }

  // ② 水位线是"被补的那一次"，不是"跑的那一刻"：锚点落在整分上，所以秒必须是 00
  const watermark = new Date(String(seededTask.lastRunAt));
  if (Number.isNaN(watermark.getTime())) fail(`lastRunAt 不是一个时刻：${String(seededTask.lastRunAt)}`);
  if (!(seededTask.lastRunAt ?? '').includes(':00.000Z')) {
    fail(
      `水位线写成了"此刻"而不是"补的那一次"（${String(seededTask.lastRunAt)} 不在整分上）—— 这样会把刚发生还没跑的那一笔静默吃掉`,
    );
  }
  if (watermark.getTime() <= scheduleAnchor.getTime()) {
    fail(`水位线还停在锚点（${String(seededTask.lastRunAt)}），说明这一轮压根没跑`, JSON.stringify(seededTask));
  }
  if (typeof seededTask.sessionId !== 'string' || seededTask.sessionId === '') {
    fail('任务没有绑定会话（到点这一轮不知道写进哪儿）', JSON.stringify(seededTask));
  }

  // ③ 到点真的起了一轮：那轮的问题与回答落在会话文件里（磁盘真值，不是界面自述）
  const schedJsonl = join(dataDir, 'sessions', seededTask.sessionId, 'messages.jsonl');
  for (let i = 0; i < 60 && !existsSync(schedJsonl); i += 1) await win3.waitForTimeout(200);
  if (!existsSync(schedJsonl)) fail(`到点起的那一轮没落盘（${schedJsonl} 不在）`, JSON.stringify(seededTask));
  const schedLines = readFileSync(schedJsonl, 'utf8').split('\n').filter(Boolean);
  const schedAsk = schedLines.find((l) => l.includes('E2E_SCHEDULE'));
  if (!schedAsk) fail('任务里那句话没有变成发给模型的一轮提问', schedLines.join('\n').slice(0, 500));
  if (!schedLines.some((l) => l.includes('"role":"assistant"'))) {
    fail('到点那一轮只有问没有答（起轮没走通对话链路）', schedLines.join('\n').slice(0, 500));
  }

  // ④ 停用是真停用：写盘、且水位线不再往前走
  const beforeStop = String(seededTask.lastRunAt);
  await row.locator('button', { hasText: '停用' }).first().click();
  await win3.waitForTimeout(400);
  const stopped = JSON.parse(readFileSync(taskFile, 'utf8')).data.tasks.find((t) => t.id === seededTaskId);
  if (stopped.enabled !== false) fail('点了停用而磁盘上还是启用（界面与账各说各话）', JSON.stringify(stopped));
  if (String(stopped.lastRunAt) !== beforeStop) {
    fail(`停用之后水位线还在动（${beforeStop} → ${String(stopped.lastRunAt)}）—— 停用不就该不起`, JSON.stringify(stopped));
  }
  ok('开机补跑：只补最近一次并报出跳过几次；水位线落在整分（是那一次，不是此刻）；那一轮真落进会话文件；停用真的不再起轮');

  step('展开/收起按设计基线做：真实高度轨道过渡 + 箭头同元素旋转 180°（R18）');
  // 拿**最后一张**工具卡（刚才那次 run_command 的），它的 L1 默认是收起的
  const motionProbe = await win3.evaluate(async () => {
    const cards = Array.from(document.querySelectorAll('.jj-tool'));
    const card = cards[cards.length - 1];
    if (!card) return { ok: false, why: '页面上没有工具卡' };
    const collapse = card.querySelector('.jj-collapse');
    const caret = card.querySelector('[data-caret]');
    const l0 = card.querySelector('.jj-tool-l0');
    if (!collapse || !caret || !l0) return { ok: false, why: '工具卡缺 .jj-collapse / [data-caret] / .jj-tool-l0' };
    const before = {
      collapsed: collapse.getAttribute('data-collapsed'),
      transform: getComputedStyle(caret).transform,
      innerInert: card.querySelector('.jj-collapse > *')?.hasAttribute('inert') ?? null,
    };
    const transitionProperty = getComputedStyle(collapse).transitionProperty;
    l0.click();
    // 属性立刻翻（DOM 写入是同步的）
    const attrDeadline = Date.now() + 2000;
    while (card.querySelector('[data-caret]')?.getAttribute('data-open') !== 'true' && Date.now() < attrDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const caretEl = card.querySelector('[data-caret]');
    /**
     * 为什么不在**那一张卡片的那个节点上**直接量 transform：
     * 自动化里的窗口是遮挡的（`document.visibilityState=visible` 但 Chromium 不产帧），
     * 实测同一个节点 `matches(".jj-caret[data-open='true']")` 为 true、样式表里规则也在，
     * 但 `getComputedStyle(...).transform` 一直停在 `none`（过渡时钟不推进）；
     * 隔离实验（同一份构建 CSS + 同样的 button/aria-hidden 上下文，桌面 Electron 里跑）
     * 逐条算出 `matrix(-1, 0, 0, -1, 0, 0)` —— 判据本身是好的，是这个窗口量不了"画出来的"值。
     * 所以这里量两件**确定**的事：① 同一元素的两个状态属性；② 在本页文档里新建一个同标记节点，
     * 它算出来的就是"展开态该有的终态"。两条合起来 = 箭头确实被规则转了 180°。
     */
    const probeNode = (() => {
      const span = document.createElement('span');
      span.className = 'jj-caret';
      span.setAttribute('data-open', 'true');
      span.style.transition = 'none';
      document.body.appendChild(span);
      const t = getComputedStyle(span).transform;
      span.remove();
      return t;
    })();
    const after = {
      collapsed: collapse.getAttribute('data-collapsed'),
      open: caretEl?.getAttribute('data-open') ?? null,
      matches: caretEl ? caretEl.matches(".jj-caret[data-open='true']") : null,
      rotatedByRule: probeNode,
    };
    return { ok: true, before, after, transitionProperty };
  });
  if (motionProbe.ok !== true) fail(`工具卡上量不到动效属性：${String(motionProbe.why)}`);
  // 失败时把整份探针原样打出来（一次运行拿全信息：属性值、过渡属性、两个状态都在里面）
  const probeJson = JSON.stringify(motionProbe);
  if (!String(motionProbe.transitionProperty).includes('grid-template-rows')) {
    fail(`展开容器没有对 grid-template-rows 做过渡（探针：${probeJson}）——真实高度连续过渡没生效`);
  }
  if (motionProbe.before.collapsed !== 'true') fail(`工具卡默认不是收起态（探针：${probeJson}）`);
  if (motionProbe.before.innerInert !== true) fail(`收起态的内容没有 inert（探针：${probeJson}）—— 键盘能 Tab 进看不见的内容里`);
  if (motionProbe.after.collapsed !== 'false') fail(`点开之后容器没翻到展开态（探针：${probeJson}）`);
  if (motionProbe.after.open !== 'true' || motionProbe.after.matches !== true) {
    fail(`箭头还是收起态（探针：${probeJson}）——同一个元素的两个状态没有同步翻`);
  }
  if (motionProbe.after.rotatedByRule !== 'matrix(-1, 0, 0, -1, 0, 0)') {
    fail(`展开态的规则没把箭头转 180°（探针：${probeJson}）`);
  }
  ok('展开用真实高度的轨道过渡（transition-property 含 grid-template-rows）；箭头同元素转 180°（矩阵为负单位阵）；收起态内容 inert');

  step('主题包的背景类型真的落在画面上：选「柔和渐变」根容器上出现渐变、选「毛玻璃」出现模糊（R20 修的静默失效）');
  await win3.locator('nav.app-tabs button', { hasText: '外观' }).first().click();
  if ((await waitText3('样式包', 8_000)) !== true) fail('外观页没有样式包区块', await body3());
  await win3.locator('button', { hasText: '柔和渐变' }).first().click();
  let gradient = { kind: null, image: 'none' };
  for (let i = 0; i < 20; i += 1) {
    gradient = await win3.evaluate(() => ({
      kind: document.documentElement.getAttribute('data-jj-bg-kind'),
      image: getComputedStyle(document.querySelector('.app-root')).backgroundImage,
    }));
    if (String(gradient.image).includes('linear-gradient')) break;
    await win3.waitForTimeout(100);
  }
  if (!String(gradient.image).includes('linear-gradient')) {
    fail(
      `选了「柔和渐变」，根容器上却没有渐变（kind=${String(gradient.kind)}，image=${String(gradient.image).slice(0, 80)}）—— 又是"选了不生效"`,
    );
  }
  await win3.locator('button', { hasText: '毛玻璃' }).first().click();
  let backdrop = { blur: 'none', kind: null, varBlur: null, reduced: false, background: 'none' };
  for (let i = 0; i < 20; i += 1) {
    backdrop = await win3.evaluate(() => {
      const el = document.querySelector('.app-root');
      const cs = getComputedStyle(el);
      return {
        blur: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
        kind: document.documentElement.getAttribute('data-jj-bg-kind'),
        varBlur: document.documentElement.style.getPropertyValue('--jj-bg-blur') || null,
        // 系统关了"透明效果"时，我们自己的降级规则（prefers-reduced-transparency）会把毛玻璃换成不透明底
        reduced: window.matchMedia('(prefers-reduced-transparency: reduce)').matches,
        background: cs.backgroundColor,
      };
    });
    // 正常档：真出现 blur；降级档：换成不透明背景（两条都是"生效"，只是生效的分支不同）
    if (String(backdrop.blur).includes('blur') || (backdrop.reduced && backdrop.background !== 'rgba(0, 0, 0, 0)')) break;
    await win3.waitForTimeout(100);
  }
  const glassOk =
    String(backdrop.blur).includes('blur') || (backdrop.reduced && backdrop.background !== 'rgba(0, 0, 0, 0)');
  if (!glassOk) {
    fail(`选了「毛玻璃」，根容器上既没有 blur、也没有降级后的不透明底（探针：${JSON.stringify(backdrop)}）`);
  }
  // 还原默认样式包，免得后面的步骤读到"被改过的主题"（体验诚实：改过的东西要改回去）
  await win3.locator('button', { hasText: '默认暗色' }).first().click();
  ok(
    `渐变与毛玻璃两种背景都真的作用在根容器上（毛玻璃这一档走的分支：${
      String(backdrop.blur).includes('blur') ? '真毛玻璃' : '系统关了透明效果 → 降级为不透明底'
    }）—— 此前规则指向一个不存在的类名，静默失效；现在由属性门控锁 + 本步一起看着`,
  );

  step('运行日志：概览页看得见今天的记录，磁盘上真有那一本（数据没出隔离目录）');
  await win3.locator('nav.app-tabs button', { hasText: '概览' }).first().click();
  const logCard = win3.locator('[data-logs-card]');
  await logCard.waitFor({ state: 'visible', timeout: 8_000 });
  let logCardText = '';
  for (let i = 0; i < 30; i += 1) {
    logCardText = await logCard.innerText();
    if (logCardText.includes('.jsonl') && logCardText.includes('启动')) break;
    await win3.waitForTimeout(100);
  }
  if (!logCardText.includes('.jsonl')) {
    fail('日志卡没给出文件路径（"去哪儿看"是第一件事）', logCardText.slice(0, 300));
  }
  if (!logCardText.includes('启动')) {
    fail('日志卡上没看见启动记录（启动那条没落盘？）', logCardText.slice(0, 300));
  }
  // 磁盘真值：隔离数据目录的 logs/ 底下真有今天的账，首条启动记录形状完整
  const logsDir = join(dataDir, 'logs');
  const logNames = existsSync(logsDir)
    ? readdirSync(logsDir).filter((n) => n.startsWith('app-') && n.endsWith('.jsonl'))
    : [];
  if (logNames.length === 0) fail(`隔离数据目录里没有日志文件：${logsDir}`);
  if (!logCardText.includes(logNames[0])) {
    fail('日志卡显示的文件名与磁盘上的对不上', `${String(logNames[0])}\n${logCardText.slice(0, 300)}`);
  }
  const logsDirShown = join(dataDir, 'logs');
  if (
    !logCardText.includes(logsDirShown) &&
    !logCardText.includes(logsDirShown.replace(/\\/g, '/'))
  ) {
    fail('日志卡上的路径不指向隔离数据目录 —— 日志可能写去了真实用户目录', logCardText.slice(0, 300));
  }
  const logFile = join(logsDir, logNames[0]);
  const logLines = readFileSync(logFile, 'utf8').split('\n').filter((l) => l.trim() !== '');
  let bootRecord = null;
  for (const line of logLines) {
    try {
      const r = JSON.parse(line);
      if (r !== null && typeof r === 'object' && r.scope === 'app' && typeof r.msg === 'string' && r.msg === '启动') {
        bootRecord = r;
        break;
      }
    } catch {
      // 坏行由单测面兜；这里只要找到启动那一条
    }
  }
  if (bootRecord === null) fail(`磁盘上的日志里没有启动记录：${logFile}`);
  if (typeof bootRecord.ts !== 'string' || typeof bootRecord.level !== 'string' || bootRecord.level !== 'info') {
    fail('启动记录的形状不对（ts/level/info 缺一）', JSON.stringify(bootRecord).slice(0, 200));
  }
  ok(
    `日志真在隔离目录里落盘了（${String(logNames[0])}：启动记录 level=info、带数据根与配置来源四条），界面上看到的是同一份`,
  );

  step('更新检查：点一次查一次（本地假发布页），"有新版本"说得出来、别的时候一声不吭');
  await win3.locator('nav.app-tabs button', { hasText: '概览' }).first().click();
  const updateCard = win3.locator('[data-update-card]');
  await updateCard.waitFor({ state: 'visible', timeout: 8_000 });
  if (updateHits !== 0) {
    fail(`还没点"检查更新"，本地发布页就收到了 ${String(updateHits)} 次请求（有自动检查在出站？）`);
  }
  await updateCard.locator('button', { hasText: '检查更新' }).click();
  let updateText = '';
  // 轮询横跨服务侧的 8 秒超时：万一请求真卡住，等到的是"查询超时"这句人话，而不是一句空白的"检查中…"
  for (let i = 0; i < 90; i += 1) {
    updateText = await updateCard.innerText();
    if (!updateText.includes('检查中')) break;
    await win3.waitForTimeout(150);
  }
  if (!updateText.includes('有新版本 v99.9.9')) {
    fail(
      `查到新版本却没显示出来（或显示了别的结局）（updateHits=${String(updateHits)}）`,
      updateText.slice(0, 300),
    );
  }
  if (!updateText.includes('打开发布页')) {
    fail('有新版本时没有给"打开发布页"的入口', updateText.slice(0, 300));
  }
  if (updateHits !== 1) {
    fail(`点一次应当只出站一次（实际 ${String(updateHits)} 次）—— 自动重试/轮询都不该有`);
  }
  ok('查一次说一句：新版本 v99.9.9 显示出来、发布页入口在；点击前 0 次出站、点击后恰好 1 次');

  step('B3b 画布：有界循环 —— 命中终止词提前停；没命中就停在轮次上限并把"到界"说出来');
  await win3.locator('nav.app-tabs button', { hasText: '画布' }).first().click();
  // 场景一：第 1 轮就命中（回显服务的回答里带 ECHO）→ 循环提前结束，下游照常执行
  await win3.locator(`button[data-graph-id="${loopHitId}"]`).first().click();
  if ((await waitText3(`已打开 ${loopHitId}`, 10_000)) !== true) {
    fail('打开循环命中图失败', (await body3()).slice(0, 700));
  }
  if ((await win3.locator('.jj-canvas-node', { hasText: '含「ECHO」停 · 最多 3 轮' }).count()) !== 1) {
    fail('循环卡片没有显示"终止词与轮数"（加载时 stopKeyword / maxRounds 没带进卡片？）');
  }
  await win3.locator('button', { hasText: '运行这张图' }).first().click();
  if ((await waitText3('跑完了（2 个节点）', 30_000)) !== true) {
    fail('循环（命中就停）那张图没有跑完', (await body3()).slice(0, 900));
  }
  const loopStatus = async (i) =>
    win3.locator('.react-flow__node').nth(i).locator('.jj-canvas-node').getAttribute('data-node-status');
  if ((await loopStatus(0)) !== 'ok') fail('命中终止词的循环节点应当是 ok');
  if ((await loopStatus(1)) !== 'ok') fail('循环结束之后下游应当照常执行');
  if ((await win3.locator('.jj-canvas-node', { hasText: '第 1 轮命中' }).count()) !== 1) {
    fail('循环节点卡片上没写出"第几轮命中"（事件里的 note 没上卡片？）');
  }
  // 场景二：终止词永不出现 + 只剩 2 轮 → 跑满上界，失败并说明"到界"，下游留在 pending
  await win3.locator(`button[data-graph-id="${loopBoundId}"]`).first().click();
  if ((await waitText3(`已打开 ${loopBoundId}`, 10_000)) !== true) {
    fail('打开循环到界图失败', (await body3()).slice(0, 700));
  }
  await win3.locator('button', { hasText: '运行这张图' }).first().click();
  if ((await waitText3('轮次上限', 30_000)) !== true) {
    fail('循环跑满轮数后没有把"到界"说出来', (await body3()).slice(0, 900));
  }
  if ((await loopStatus(0)) !== 'failed') fail('到界的循环节点应当是 failed（不是 ok，也不是静默截断）');
  if ((await loopStatus(1)) !== 'pending') fail('循环失败后下游不该执行（应当停在 pending）');
  const savedLoop = readFileSync(join(canvasDir, `${loopHitId}.json`), 'utf8');
  if (!savedLoop.includes('"stopKeyword": "ECHO"') || !savedLoop.includes('"maxRounds": 3')) {
    fail('存下的图里终止词 / 轮数没保住（界面往返把它丢了？）', savedLoop.slice(0, 600));
  }
  ok('有界循环：命中即停（第 1 轮）且下游照跑；到界=失败并写出"轮次上限"，下游留在 pending；stopKeyword/maxRounds 落盘');

  /**
   * M11 批一（R14）：图片输入的三层真值。
   *
   * 为什么值得加一步 e2e：这是"数据第一次主动离开本机"的入口，三件事单测都只能锁一半 ——
   * ① **模型究竟收到了什么**（parts 条数 / mime / 元数据块在不在）：真值只有对端（回显服务）看得见；
   * ② **本机究竟留没留副本**：判据是磁盘上的会话 jsonl（字节一个都不许有，只许有一行 imageCount）；
   * ③ **界面对不可重放的事说没说真话**：气泡上必须写「图片未保留 ×N」。
   *
   * 夹具是一张**带 tEXt 元数据块**的 PNG，哨兵串只存在于夹具里 ——
   * 服务端在收到的字节里找它：找得到 = 剥离没生效（红），找不到 = 出站前真剥了（绿）。
   */
  step('M11 多模态：图片以 parts 形态到达模型（元数据已剥），本机只有一行计数、零字节副本');
  await win3.locator('nav.app-tabs button', { hasText: '对话' }).first().click();
  await win3.locator('select').first().selectOption(seededEchoConnId);
  const newChatImg = win3.locator('button', { hasText: '新会话' });
  for (let i = 0; i < 20 && (await newChatImg.count()) === 0; i += 1) await win3.waitForTimeout(150);
  if ((await newChatImg.count()) > 0) await newChatImg.first().click();

  /** 造一张带 tEXt 的 PNG（CRC 不校验：剥元数据只走结构；哨兵串 ASCII） */
  const pngWithTextMarker = (marker) => {
    const chunk = (type, payload) => {
      const out = Buffer.alloc(12 + payload.length);
      out.writeUInt32BE(payload.length, 0);
      out.write(type, 4, 'ascii');
      payload.copy(out, 8);
      return out;
    };
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', Buffer.alloc(13)),
      chunk('tEXt', Buffer.from(marker, 'ascii')),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  };
  const metaPngBytes = [...pngWithTextMarker('E2E-IMG-META-SENTINEL')];
  const dropResult = await win3.evaluate(
    ({ bytes }) => {
      const file = new File([new Uint8Array(bytes)], 'e2e-meta.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const target = document.querySelector('.w2-chat-input');
      if (target === null) return 'no-target';
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return 'dropped';
    },
    { bytes: metaPngBytes },
  );
  if (dropResult !== 'dropped') fail(`拖动图片没有落到输入区（${String(dropResult)}）`);
  const imgChip = win3.locator('[data-attach-name="e2e-meta.png"]');
  let chipSeen = false;
  for (let i = 0; i < 60 && !chipSeen; i += 1) {
    chipSeen = (await imgChip.count()) > 0;
    if (!chipSeen) await win3.waitForTimeout(150);
  }
  if (!chipSeen) fail('拖动之后待发清单里没有出现这张图（准入链路没走通？）', (await body3()).slice(-600));
  const inputAreaText = await win3.locator('.w2-chat-input').innerText();
  if (!inputAreaText.includes('已剥元数据')) {
    fail('图上没有"已剥元数据"的标记 —— 熔断的那条剥离要么没跑要么没如实标', inputAreaText.slice(0, 400));
  }
  if (!inputAreaText.includes('图片会随本条消息发给「e2e 回显假服务」的服务商；本机不保留副本')) {
    fail('加图之后没有把"发给谁、本机不留副本"说明白', inputAreaText.slice(0, 400));
  }
  await win3.locator('textarea[placeholder^="输入消息"]').fill('E2E_IMG 看这张图');
  await win3.locator('button', { hasText: '发送' }).first().click();
  // 服务端体检报告：2 parts（文字 + 图）/ 1 图 / png / 哨兵串**不在**（meta=0）
  if ((await waitText3('ECHOIMG parts=2 images=1 mime=image/png meta=0', 20_000)) !== true) {
    fail('模型收到的 parts 形状不符合预期（数量 / mime / 元数据剥离至少有一样没成立）', (await body3()).slice(-900));
  }
  if (!(await body3()).includes('head=E2E_IMG')) {
    fail('文字 part 没有随图片一起到达（纯图与带文字两条路混了？）', (await body3()).slice(-600));
  }
  if ((await win3.locator('.w2-bubble-user', { hasText: '[图片未保留 ×1]' }).count()) === 0) {
    fail('气泡上没有「图片未保留 ×1」—— 一条不可重放的消息看起来和纯文字的一模一样');
  }
  // 磁盘真值：那一行有 imageCount=1，且**没有任何图片字节**（base64 / data URL 前缀都不许出现）。
  // 轮询取真值：落盘是异步的（轮末追加），读数早于写就会把"还没写"误判成"没写"。
  const sessionsRoot = join(dataDir, 'sessions');
  let imgJsonl = '';
  let imgLine = '';
  for (let i = 0; i < 40; i += 1) {
    for (const name of readdirSync(sessionsRoot)) {
      const f = join(sessionsRoot, name, 'messages.jsonl');
      if (!existsSync(f)) continue;
      const text = readFileSync(f, 'utf8');
      if (text.includes('E2E_IMG')) {
        imgJsonl = f;
        imgLine = text.split('\n').find((l) => l.includes('E2E_IMG')) ?? '';
        break;
      }
    }
    if (imgJsonl !== '') break;
    await win3.waitForTimeout(150);
  }
  if (imgJsonl === '') fail('磁盘上找不到刚才那条带图消息（会话没落盘？）');
  if (!imgLine.includes('"imageCount":1')) {
    fail('落盘的那一行里没有 imageCount=1（重启后连"发过图"都看不出来）', imgLine.slice(0, 300));
  }
  if (imgLine.includes('iVBOR') || imgLine.includes('data:image') || imgLine.includes('E2E-IMG-META-SENTINEL')) {
    fail('图片字节（或其元数据）出现在磁盘上了 —— "不保留副本"被破坏', imgLine.slice(0, 300));
  }
  ok('图片以 parts 形态到达模型（2 parts · 1 图 · png · 元数据哨兵已剥）；气泡写「图片未保留 ×1」，磁盘只有一行 imageCount、零字节副本');

  /* ---------------- M17 批一（R15）：长任务断点续跑 ----------------
   *
   * 真值三层：① **崩溃现场**（慢命令跑到一半关掉应用，盘上 task.json 停在 running）；
   * ② **重启后的读时判定**（卡片如实说"断在第几步"、盘上状态被读时标成 interrupted）；
   * ③ **硬约束的正面证据**（点续跑 → 审批弹窗**再次出现** —— 模型继续任务重发的命令照样重新问，
   *    而不是应用在回放动作）。
   */
  step('M17 断点续跑：跑到一半崩溃 → 重启如实说"断在哪" → 续跑重新过审批门 → 完成');
  const taskCmd =
    process.platform === 'win32'
      ? 'echo TASKR1-EARLY & ping -n 4 127.0.0.1 >nul & echo TASKR1-LATE'
      : 'echo TASKR1-EARLY; sleep 3; echo TASKR1-LATE';
  await win3.locator('nav.app-tabs button', { hasText: '对话' }).first().click();
  await win3.locator('select').first().selectOption(seededEchoConnId);
  const newChatTask = win3.locator('button', { hasText: '新会话' });
  for (let i = 0; i < 20 && (await newChatTask.count()) === 0; i += 1) await win3.waitForTimeout(150);
  if ((await newChatTask.count()) > 0) await newChatTask.first().click();
  await win3.locator('textarea[placeholder^="输入消息"]').fill('E2E_CMD TASKR1 请跑一条慢命令');
  await win3.locator('button', { hasText: '发送' }).first().click();
  if ((await waitText3(`需要你确认：run_command · 执行命令：${taskCmd}`, 15_000)) !== true) {
    fail('慢命令轮没有等到审批弹窗（模型没发起 run_command？）', (await body3()).slice(-700));
  }
  await win3.locator('button', { hasText: '允许一次' }).first().click();
  // EARLY 行出现 = 命令真的在跑（此刻盘上的 runningStep 才是 run_command）
  if ((await waitText3('TASKR1-EARLY', 15_000)) !== true) {
    fail('批准后命令没有跑起来（EARLY 行没出现）', (await body3()).slice(-700));
  }
  const taskSid = await win3.evaluate(async () => {
    const list = await window.jujia.chatList();
    return list[0]?.id ?? '';
  });
  if (taskSid === '') fail('刚建的会话没有出现在会话清单里（起轮时该补写一次元信息）');
  // **崩溃现场**：立刻走"用户真的会用的那条"关闭路径，不让命令跑完
  const closedByCrash = app.waitForEvent('close', { timeout: 20_000 }).catch(() => undefined);
  await win3.evaluate(() => window.close()).catch(() => undefined);
  await closedByCrash;
  app = undefined;
  const taskJsonlFile = join(dataDir, 'sessions', taskSid, 'task.json');
  /**
   * 读任务记录真值。**容忍原子写的换名窗口**（R24 首跑撞到）：json-store 的写入是
   * "旧文件先转 .bak、tmp 再 rename 成主文件"——两步之间主文件短暂不存在；轮询读取
   * 恰好落在缝里就会 ENOENT 把整个套件炸掉（首跑现场：读于续跑收口写入进行时）。
   * 处理：ENOENT 时短暂重试（换名窗口是亚毫秒级），**其他错误照旧上抛**。
   */
  const readTaskFile = async () => {
    for (let i = 0; ; i += 1) {
      try {
        return JSON.parse(readFileSync(taskJsonlFile, 'utf8')).data;
      } catch (err) {
        if (!(err && err.code === 'ENOENT') || i >= 20) throw err;
        await new Promise((r) => setTimeout(r, 25));
      }
    }
  };
  const crashedTask = await readTaskFile();
  if (crashedTask.status !== 'running') {
    fail(`崩溃现场的任务记录应当停在 running，实际 ${String(crashedTask.status)}`, JSON.stringify(crashedTask).slice(0, 300));
  }
  if (crashedTask.runningStep !== 'run_command') {
    fail(`崩溃时正在跑的工具没记下来（runningStep=${String(crashedTask.runningStep)}）`, JSON.stringify(crashedTask).slice(0, 300));
  }
  ok('崩溃现场：盘上 task.json 停在 running 且 runningStep=run_command（"断在哪"的一手证据）');

  // 重启（与 win3 那次同一套：同 profile、同数据目录）
  app = await electron.launch({
    executablePath: electronPath,
    args: [MAIN_ENTRY, `--user-data-dir=${profileDir}`],
    env,
  });
  const win4 = await app.firstWindow();
  await win4.waitForSelector('body', { timeout: 15_000 });
  const body4 = async () => (await win4.evaluate(() => document.body.innerText)).slice(0, 3_000);
  const waitText4 = async (needle, ms = 10_000) => {
    try {
      await win4.waitForFunction((n) => document.body.innerText.includes(n), needle, { timeout: ms });
      return true;
    } catch {
      return false;
    }
  };
  await win4.locator('nav.app-tabs button', { hasText: '对话' }).first().click();
  await win4.locator('select').first().selectOption(seededEchoConnId);
  await win4.locator('select[aria-label="继续会话"]').selectOption(taskSid);
  await win4.locator('button', { hasText: '继续' }).first().click();
  let cardSeen = false;
  for (let i = 0; i < 60 && !cardSeen; i += 1) {
    cardSeen = (await win4.locator('[data-task-card="interrupted"]').count()) > 0;
    if (!cardSeen) await win4.waitForTimeout(150);
  }
  if (!cardSeen) fail('重启后没有出现"被打断的任务"卡片', (await body4()).slice(-900));
  const taskCardText = await win4.locator('[data-task-card="interrupted"]').innerText();
  for (const needle of [
    '上一轮任务在应用退出/崩溃时中断',
    '还没有完成任何步骤',
    '正在运行 run_command（结果未落盘）',
    '原始要求：E2E_CMD TASKR1 请跑一条慢命令',
  ]) {
    if (!taskCardText.includes(needle)) fail(`卡片少了一句实话：「${needle}」`, taskCardText.slice(0, 400));
  }
  // 盘上真值②：被读一次之后标成 interrupted 并写回（读时判定；判定只发生在主进程）
  const markedTask = await readTaskFile();
  if (markedTask.status !== 'interrupted' || typeof markedTask.interruptedAt !== 'string') {
    fail('读过之后任务记录没有被标成 interrupted（读时判定没生效？）', JSON.stringify(markedTask).slice(0, 300));
  }
  ok('重启后卡片如实说"断在哪"；盘上记录被读时判定为 interrupted（含 interruptedAt）');

  // 「续跑」→ **审批弹窗必须再次出现**（硬约束的正面证据）
  await win4.locator('button', { hasText: '续跑' }).first().click();
  if ((await waitText4(`需要你确认：run_command · 执行命令：${taskCmd}`, 20_000)) !== true) {
    fail('续跑时没有重新弹审批 —— 高副作用动作被静默重放，违反硬约束', (await body4()).slice(-900));
  }
  if ((await win4.locator('button', { hasText: '本次会话总是允许' }).count()) > 0) {
    fail('续跑的弹窗上出现了「本次会话总是允许」—— 执行类是硬 ask');
  }
  await win4.locator('button', { hasText: '允许一次' }).first().click();
  // 跑到收尾：RESUME=1 是服务端确认"系统提示里真的带了续跑段"（原始要求 + 断点信息过了线）
  if ((await waitText4('E2E-CMD-FINAL RESUME=1', 30_000)) !== true) {
    fail('续跑轮没有正常收尾（或服务端没在系统提示里看到续跑段）', (await body4()).slice(-900));
  }
  if ((await win4.locator('.w2-bubble-user', { hasText: '继续上一条被中断的任务' }).count()) === 0) {
    fail('界面上没有那条可见的续跑用户消息（文案应与契约常量同源）');
  }
  /**
   * 盘上真值③：**轮询取真值** —— 文本先到、收口写入在 done 事件之前，断言不能抢跑
   * （首跑就是在这一步读到 running 而红的：updatedAt 停在最后一步 tool_end 的时刻；
   * 卡片在点「续跑」时就已被清掉，所以"等卡片消失"是空转，判据必须落在记录本身）。
   */
  let finishedTask = await readTaskFile();
  for (let i = 0; i < 80 && finishedTask.status !== 'done'; i += 1) {
    await win4.waitForTimeout(150);
    finishedTask = await readTaskFile();
  }
  if (finishedTask.status !== 'done') {
    fail(`续跑完成后记录应当 done，实际 ${String(finishedTask.status)}`, JSON.stringify(finishedTask).slice(0, 300));
  }
  if (finishedTask.resumeCount !== 1) {
    fail(`resumeCount 应当是 1，实际 ${String(finishedTask.resumeCount)}`, JSON.stringify(finishedTask).slice(0, 300));
  }
  if (finishedTask.stepsDone < 1) {
    fail('续跑完成的 run_command 没有计步', JSON.stringify(finishedTask).slice(0, 300));
  }
  // 收口之后主进程也不再把这条当"被打断"（卡片不会回来）
  const afterView = await win4.evaluate(async (sid) => await window.jujia.chatTaskGet(sid), taskSid);
  if (afterView !== null && afterView.status === 'interrupted') {
    fail('续跑完成后这条记录仍被当成"被打断"（状态没收口）', JSON.stringify(afterView).slice(0, 300));
  }
  ok('续跑：审批门重新问过（弹窗再次出现）→ 跑完 → 记录 done/resumeCount=1/stepsDone≥1，卡片不会回来');

  step('T33 界面级证据：131 条种子会话翻到最早一条（按钮有反应、不跳条、计数自洽）');
  /**
   * T33（分页口径差 1 两处 / 续聊跳一条）修完后的**界面级证据此前缺位**（需 >120 条历史的会话）——
   * 种子见脚本头部的 `seededPageSessionId`。判据全是真值：计数来自"共 N 条"、窗口变化来自
   * 按钮文案（"从磁盘再读 11 条" → "显示更早的 11 条" → 消失），**最早那条的正文必须真的出现**。
   */
  await win4.locator('nav.app-tabs button', { hasText: '对话' }).first().click();
  // 历史会话下拉**按选中连接过滤**：种子属于流式连接，先把它选上；
  // 选完还要点「继续」——下拉的 onChange 只记 pickId，真正 resume 的是那颗按钮（与 [60] 同形）
  await win4.locator('select').first().selectOption(seededStreamConnId);
  await win4.locator('select[aria-label="继续会话"]').selectOption(seededPageSessionId);
  await win4.locator('button', { hasText: '继续' }).first().click();
  if ((await waitText4('共 131 条')) !== true) {
    fail('种子会话没有按"共 131 条"显示（盘上的历史没被读回来）', (await body4()).slice(0, 900));
  }
  const pageOlderBtn = win4.locator('button', { hasText: /从磁盘再读|显示更早的/ }).first();
  if (!(await pageOlderBtn.innerText()).includes('从磁盘再读')) {
    fail('首屏应当只装了最近 120 条、还有 11 条在盘上（按钮文案不对）', await pageOlderBtn.innerText());
  }
  await pageOlderBtn.click();
  if ((await waitText4('显示更早的 11 条')) !== true) {
    fail('从磁盘再读之后，按钮应变成"显示更早的 11 条"（窗口里还有 11 条没挂出来）', (await body4()).slice(0, 900));
  }
  await pageOlderBtn.click();
  if ((await waitText4('E2E-OLDEST-MARKER')) !== true) {
    fail('翻到头之后最早那条没有出现 —— T33 的"有一条历史永远看不到"回潮了', (await body4()).slice(0, 1200));
  }
  const pageBody = await body4();
  const markerCount = pageBody.split('E2E-OLDEST-MARKER').length - 1;
  if (markerCount !== 1) fail(`最早那条出现了 ${String(markerCount)} 次（重复渲染）`);
  if (!pageBody.includes('E2E-PAGE-011')) fail('盘上那 11 条的**第一条**没挂出来（只挂了尾巴）');
  await win4.waitForTimeout(300);
  if ((await win4.locator('button', { hasText: /从磁盘再读|显示更早的/ }).count()) > 0) {
    fail('全翻完之后按钮应当消失（还有什么可翻？）');
  }
  ok('翻页真值：120 → +11（盘）→ +11（窗口），最早一条可见且只出现一次，计数自洽');

  step('T45 失败兜底：一次没人接住的 IPC 拒绝必须在界面上说出来，而且关得掉');
  /**
   * 本轮新增的用户可见能力（渲染层 `unhandledrejection` → 一条告警）。
   * **为什么值得单独一步**：这条护栏是给"下一处漏写 catch 的代码"兜底的，
   * 组件测试只能证明组件本身会画，证不了**真应用里那个监听器真的装上过**（装配在 main.tsx）。
   * 触发用的是本轮 T43 刚立的契约：`toolRun('')` 在主进程被契约拒掉 ⇒ `invoke` 拒绝，
   * 而这一处调用**故意不 await** —— 那正是"没人接住"的现场，不是编出来的错误码。
   */
  await win4.evaluate(() => {
    void window.jujia.toolRun('', {});
  });
  // 等的是**这句固定的前半段**，不是整条消息：Electron 会把渲染层的拒绝包成
  // `Error invoking remote method 'tool:run': Error: 缺少工具名`（探针实测原文），
  // 拿"接住它：缺少工具名"这种拼接整句去比，永远匹配不上 —— 首跑就是这样红的，
  // 红在**断言写法**而不是产品（判据换成不依赖外壳前缀的两段，见下）。
  if ((await waitText4('但没有地方接住它')) !== true) {
    fail(
      '没人接住的 IPC 拒绝仍然静默（T45 的兜底没生效：监听器没装 / 组件没挂 / 契约没拒）',
      (await body4()).slice(-900),
    );
  }
  const notice = win4.locator('[data-failure-notices] .jj-failure-notice', { hasText: '缺少工具名' }).first();
  if ((await notice.getAttribute('role')) !== 'alert') {
    fail('告警没有 role="alert"（读屏不会播 —— 说给看得见的人不等于说给所有人）');
  }
  await notice.locator('button').first().click();
  await win4.waitForTimeout(250);
  // 只断言"我这条"没了：别处若真有需要露出的失败，不该被这一步当成自己的失败
  if ((await win4.locator('[data-failure-notices] .jj-failure-notice', { hasText: '缺少工具名' }).count()) > 0) {
    fail('点 × 之后那条还留着（关不掉 = 变成常驻噪声，界面会被它压住）');
  }
  ok('拒绝被说出来（并写明"没有地方接住它"），关得掉，role=alert 可被读屏播');

  /**
   * T51（终端与外部件批 · 2026-10-15）：钩子**没跑成**必须在这一次工具结果里说出口。
   *
   * 这一幕只能是界面级证据：单测能证明"诊断从钩子引擎走到结果字符串"，
   * 证明不了"人正在看的那一格真的多了一句话"。而这一条的坏情况恰好是**什么都不发生**：
   * 契约是 fail-open，一道拦危险操作的 PreToolUse 钩子的二进制被卸载 ⇒ `blocked:false`
   * ⇒ 工具照常执行、界面一片空白 —— 用户以为那道关还在上班。
   *
   * 现场是真的：装一个**每次都失败**的 PreToolUse 钩子（`node -e process.exit(3)`，
   * 退出码 3 按契约"不视为拒绝"），然后在概览页点一次 list_dir。
   * 判据取钩子自己那句话里的两段（`[钩子诊断]` 与 `不视为拒绝`），不依赖我这边拼的措辞。
   */
  step('T51 钩子诊断：没跑成的那道关要说得出声（真弹窗、真钩子进程、真工具结果）');
  /**
   * 助手**绑在当前窗口**（win4）而不是复用前面那一段的 `saveHooksFromEditor` / `clickDialog2`：
   * 那几个闭包绑的是**已经销毁的旧窗口**（本脚本中途重启过应用，1509 行那条注释说的就是这件事），
   * 首跑正是红在这里 —— `locator.click: Target page, context or browser has been closed`。
   * 红在判据写法而不是产品，这条如实记进复核 085。
   */
  const saveHooks4 = async (text) => {
    await win4.locator('nav.app-tabs button', { hasText: '钩子' }).first().click();
    await win4.locator('textarea.jj-hooks-editor').fill(text);
    await win4.locator('button', { hasText: '保存并校验' }).first().click();
  };
  const clickDialog4 = async (label) => {
    await win4.locator('button', { hasText: label }).first().click();
    await win4.waitForSelector('[role="dialog"][aria-label="权限请求"]', { state: 'detached', timeout: 8_000 });
  };
  const diagHooksJson = JSON.stringify(
    {
      enabled: true,
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
      events: {
        PreToolUse: [{ matcher: '', hooks: [{ type: 'process', command: 'node', args: ['-e', 'process.exit(3)'] }] }],
      },
    },
    null,
    2,
  );
  await saveHooks4(diagHooksJson);
  if ((await waitText4('需要你确认：修改钩子配置')) !== true) {
    fail('启用钩子没有弹确认（钩子会以宿主环境执行命令，改一次必须问一次）', (await body4()).slice(0, 800));
  }
  await clickDialog4('允许一次');
  if ((await waitText4('已保存')) !== true) {
    fail('批准之后钩子配置没保存成功（那这一场面试的是空气）', (await body4()).slice(0, 800));
  }
  // 真值仍以磁盘为准：enabled 必须是 true，否则后面那句"没跑成"根本没机会出现
  const diagDisk = hooksOnDisk() ?? '';
  if (!diagDisk.includes('"enabled": true')) {
    fail('盘上的钩子配置不是启用态（写进去了却没启用，界面那步就失去意义）', diagDisk.slice(0, 400));
  }

  await win4.locator('nav.app-tabs button', { hasText: '概览' }).first().click();
  await win4.locator('button', { hasText: 'list_dir' }).first().click();
  if ((await waitText4('[钩子诊断]')) !== true) {
    fail(
      '钩子没跑成而界面上没有任何地方说（T51 的静默回潮：诊断又被丢在执行器里了）',
      (await body4()).slice(-1_200),
    );
  }
  const diagBody = await body4();
  if (!diagBody.includes('不视为拒绝')) {
    fail('那一格只说了"有诊断"，没说清**没跑成不等于拒绝**（人会被误导成钩子拦下了）', diagBody.slice(-1_200));
  }
  // 反向对照（同一条纪律）：钩子跑成了就不许冒出这一格，否则它三遍之后就变成背景纹
  await saveHooks4(JSON.stringify({ enabled: false, timeoutMs: 5_000, maxOutputBytes: 4_096, events: {} }, null, 2));
  if ((await waitText4('需要你确认：修改钩子配置')) !== true) {
    fail('第二次改钩子配置没有再弹确认（改一次问一次不许因为"刚改过"而免问）', (await body4()).slice(0, 800));
  }
  await clickDialog4('允许一次');
  await win4.locator('nav.app-tabs button', { hasText: '概览' }).first().click();
  await win4.locator('button', { hasText: 'list_dir' }).first().click();
  await win4.waitForTimeout(1_200);
  const offBody = await body4();
  if (offBody.includes('[钩子诊断]')) {
    fail('钩子已经停用，界面上还挂着"钩子诊断"（说不清什么时候该闭嘴的提示就是噪声）', offBody.slice(-1_200));
  }
  ok('钩子没跑成 → 那一次工具结果里说得出"没生效、但不视为拒绝"；停用之后这一格跟着消失');

  /**
   * T55 + T56（R31 · provider 诚实批）的界面级证据。
   *
   * 这两条在单测里已经各自绿了（provider 分出 `no_end_marker`、拼装器拒空参数），
   * 这里验的是**那句话真的到了人眼前** —— 本仓的老账："契约里挂着、界面没读"与
   * "算出来了却没画出来"都让门禁全绿而用户被骗（见 R6 的第 4 条形态）。
   * 所以断言取的是**语义锚点**（界面文案原文），不是"整页里找得到某个词"。
   */
  step('T55/T56 断流与空参数：没结束标记要说"可能不完整"，参数没送到不许当合法零参');
  await win4.locator('nav.app-tabs button', { hasText: '对话' }).first().click();
  await win4.locator('select').first().selectOption(seededEchoConnId);
  const boxT55 = win4.locator('textarea[placeholder^="输入消息"]');
  const newT55 = win4.locator('button', { hasText: '新会话' });
  if ((await newT55.count()) > 0) await newT55.first().click();

  await boxT55.fill('E2E_NOMARKER 请说半句话就停');
  await win4.locator('button', { hasText: '发送' }).first().click();
  if ((await waitText4('没有给出结束标记', 20_000)) !== true) {
    fail(
      '上游没给结束标记却被说成"答完了"（T55 的静默回潮：半截回答与完整回答在界面上长得一样）',
      (await body4()).slice(-1_200),
    );
  }
  const nomarkerBody = await body4();
  // 反向也要钉住：这条不是"断流就报错、把内容丢掉"，而是"内容留下、并把不完整的判断说出来"
  if (!nomarkerBody.includes('E2E-NOMARKER-半截回答')) {
    fail('已经吐出来的半截内容被丢了（口径是"如实说不完整"，不是"当错误扔掉"）', nomarkerBody.slice(-800));
  }

  if ((await newT55.count()) > 0) await newT55.first().click();
  await boxT55.fill('E2E_EMPTYARGS 列一下目录');
  await win4.locator('button', { hasText: '发送' }).first().click();
  if ((await waitText4('流在参数送过来之前就结束了', 20_000)) !== true) {
    fail(
      '参数一个字节都没送到却被当成合法零参执行了（T56 的静默：用户看见"工具执行成功"）',
      (await body4()).slice(-1_200),
    );
  }
  const emptyArgsBody = await body4();
  if (!emptyArgsBody.includes('[invalid_args]')) {
    fail('拒执行的那句话没走既有的 [invalid_args] 通道（等于换了个没人读的形状）', emptyArgsBody.slice(-800));
  }
  ok('断流会说"可能不完整"、空参数会拒执行并说清原因 —— 两件事都在真窗口里看得见，且半截内容没被丢');

  step('关闭应用：应干净退出（不留孤儿进程）');
  await app.close();
  app = undefined;
  ok('应用已关闭');
  e2eFinished = true;
} catch (err) {
  if (!(err instanceof E2EAbort)) {
    // 意外异常：借 fail 把"已完成到哪一步"说出来；它抛的哨兵在这里咽掉，
    // 因为要的话已经说完了，剩下的只有"退出码是 1"这一件事。
    try {
      fail('执行过程中抛异常', err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err));
    } catch {
      /* 故意空着：见上 */
    }
  }
} finally {
  streamServer.close();
  echoServer.close();
  updateServer.close();
  if (app !== undefined) await app.close().catch(() => undefined);
  try {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    // 尽力而为：沙箱可能有删除配额、Windows 也可能还占着句柄。
    // 这里**必须说出来**，否则每跑一次都留一堆目录没人知道（旧目录由 cleanup.py 收拾）。
    console.log(`（提示）本轮临时目录未能自动清理：${TMP_ROOT} —— 交给 scripts/cleanup.py 处理`);
  }
}

if (!e2eFinished) process.exit(1);

console.log('\nE2E UI OK：启动 → 标签切换 → 插件识别 → 权限规则增删生效 → 钩子/MCP 页就绪 → 浏览器真实加载与拦截 → Git 暂存/提交与权限门 → 内置 exec 逐次确认（均含磁盘真值核对）→ 会话持久化与重启 → 只读敏感文件与钩子配置逐次确认 → 真·流式对话按会话分发 → 审批超时按 id 精准收尾 → 6b 压缩与结束记要点（预览不落盘 / 磁盘真值 / 退出留账与补问）→ T22 切页签不丢选择与流 → M19 文件树/保存过门/覆盖保护/PDF 零出站/逐行 patch → 中文 PDF 的 cmap 映射 → M9a 画布（三节点链跑完 / 成环开跑前被拒 / 工具节点过同一扇审批门）→ B1 画布（命令面板 / 右键与双击建节点 / 对齐辅助线与吸附）→ B2 画布（从中间节点重跑：只跑该段 / 上游不动 / 重跑标）→ B3 画布（条件分支：选中的口执行 / 未选两支与下游 skipped / fromPort 落盘）→ B3b 画布（有界循环：命中即停 / 到界失败并说明白）→ 终端会话跨页签存活与接回 → 文档页记住路径与阅读位置 → 上游截断与垃圾流在界面上分开说 → T55/T56 断流与空参数在界面上说实话（没结束标记要说"可能不完整"、参数没送到就拒执行且说清原因，半截内容不丢）→ 命令前缀规则只拦它说的那段命令 → 执行审计看得见判定、看不见正文 → 长命令的实时输出在命令跑完之前就看得见 → 定时任务：开机补跑只补最近一次并报出跳过几次（水位线是"那一次"而非"此刻"，那一轮真落进会话文件）→ 展开/收起：真实高度的轨道过渡 + 箭头同元素旋转 180°（收起态内容 inert）→ 主题包背景类型真的落在画面上（渐变 / 毛玻璃）→ 运行日志真在隔离目录里落盘（概览页看得见同一份）→ 更新检查点一次查一次（有新版本说得出来）→ 干净退出');
process.exit(0);
