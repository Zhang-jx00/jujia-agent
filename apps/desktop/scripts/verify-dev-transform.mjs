#!/usr/bin/env node
/**
 * 渲染层 dev 管线的无头验证（复核 011 引入）。
 *
 * 为什么需要它：2026-09-21 发现「构建全绿、dev 黑屏」——
 * `@vitejs/plugin-react@6` 绑定 vite 8（rolldown），而 electron-vite 5 只支持到 vite 7，
 * dev 模式下 react-refresh 插件崩溃（Missing field `moduleType`）。
 * 打包构建不经过 react-refresh，所以 smoke/perf 全绿也发现不了。
 *
 * 这个脚本做的事：**用真实配置起一个 dev server，真的请求一次渲染层模块**，
 * 断言 react 插件确实完成了转换 —— 把「dev 能不能用」变成一条可自动验证的断言，
 * 而不是"构建绿就当它好"。
 *
 * 用法：node apps/desktop/scripts/verify-dev-transform.mjs   （在仓库根或 apps/desktop 下均可）
 * 退出码：0 = 通过；1 = 失败。
 */

import { createServer, loadConfigFromFile } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, '..');
const configFile = resolve(desktopRoot, 'electron.vite.config.ts');

const fail = (message) => {
  console.error(`DEV-TRANSFORM FAIL: ${message}`);
  process.exit(1);
};

// 1) 读取**真实**的 electron.vite.config.ts —— 验证的必须是它，而不是一份复制品
const loaded = await loadConfigFromFile(
  { command: 'serve', mode: 'development', isSsrBuild: false, isPreview: false },
  configFile,
  desktopRoot,
).catch((err) => fail(`读取 electron.vite.config.ts 失败：${err.message}`));

if (!loaded) fail('未取到配置');
const rendererConfig = loaded.config?.renderer;
if (!rendererConfig) fail('配置里没有 renderer 段');

// 2) 用 renderer 段起 dev server（挂随机端口，不与真实 dev 冲突）
const server = await createServer({
  ...rendererConfig,
  root: resolve(desktopRoot, 'src/renderer'),
  logLevel: 'silent',
  server: { strictPort: false },
}).catch((err) => fail(`启动 dev server 失败：${err.message}`));

try {
  await server.listen();
  const base = server.resolvedUrls?.local?.[0];
  if (!base) fail('dev server 未返回地址');

  const problems = [];

  // 3) 入口 HTML 必须可访问
  const html = await globalThis.fetch(base).then((r) => r.text()).catch((e) => `__ERR__${e.message}`);
  if (html.startsWith('__ERR__') || !/id="root"/.test(html)) {
    problems.push(`index.html 不可用或内容异常（前 80 字符：${html.slice(0, 80)}）`);
  }

  // 4) 关键断言：React 插件真的转换了组件模块
  //    注意两条**容易误判**的路（第一版探针就栽在这里）：
  //    - esbuild 的 automatic JSX 也会产生 jsx-runtime 引入 → 不能用"有没有 jsx-runtime"判断插件在不在；
  //    - dev 模式对未知路径会走 SPA 回退返回 200 的 HTML → 不能只看状态码。
  //    所以用**只有 react 插件才会注入的特征**：组件模块里的 `$RefreshReg$`，
  //    以及 /@react-refresh 必须返回 **JavaScript**（而不是回退 HTML）。
  const app = await globalThis.fetch(new URL('src/App.tsx', base)).then(async (r) => ({
    status: r.status,
    text: await r.text(),
  }));
  if (app.status !== 200) {
    problems.push(`src/App.tsx 请求失败（HTTP ${app.status}）：${app.text.slice(0, 160)}`);
  } else {
    if (/Missing field/.test(app.text)) problems.push('出现了当年的 moduleType 错误');
    if (!/\$RefreshReg\$/.test(app.text)) {
      problems.push(
        'App.tsx 里没有 react-refresh 注入的 $RefreshReg$ —— react 插件没有真正生效' +
          '（esbuild 自动 JSX 也会转 JSX，别用这个判断）',
      );
    }
  }

  // 5) react-refresh 运行时端点：必须是 JS，且不是 SPA 回退的 HTML
  //    （正文里没有稳定的标记串，所以只断言 content-type 与"非 HTML"；
  //     真正的强断言在上面 App.tsx 的 $RefreshReg$）
  const refresh = await globalThis.fetch(new URL('@react-refresh', base)).catch(() => null);
  const refreshType = refresh?.headers?.get('content-type') ?? '';
  const refreshBody = refresh ? await refresh.text() : '';
  if (!refresh || !refresh.ok || !/javascript/i.test(refreshType) || /^\s*</.test(refreshBody)) {
    problems.push(
      `react-refresh 运行时不可用（status=${refresh?.status} type=${refreshType}）` +
        ' —— 可能被 SPA 回退的 HTML 骗过去了',
    );
  }

  // 6) 别名必须可用（渲染层只允许引用无 node 依赖的纯逻辑模块 —— 见 electron.vite.config.ts 注释）
  const aliased = await globalThis.fetch(new URL('@jujia/shared/stream-batcher', base)).then(async (r) => ({
    status: r.status,
    text: await r.text(),
  }));
  if (aliased.status !== 200) {
    problems.push(`别名 @jujia/shared/stream-batcher 解析失败（HTTP ${aliased.status}）`);
  }

  if (problems.length > 0) {
    console.error('DEV-TRANSFORM FAIL：');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  console.log(
    'DEV-TRANSFORM OK: dev 管线可用 —— index.html ✓ · App.tsx 有 react-refresh 注入 ✓ · ' +
      '/@react-refresh 为 JS ✓ · 别名解析 ✓ （配置取自 electron.vite.config.ts）',
  );
  process.exit(0);
} finally {
  await server.close().catch(() => undefined);
}
