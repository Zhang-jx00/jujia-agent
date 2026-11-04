#!/usr/bin/env node
/**
 * **打包产物层（app.asar）的第三方声明与许可核验**（R73 · 排查42 收口 · 原在制品线编号 R77）。
 *
 * ## 它补的是哪一格
 *
 * `scripts/check-notices.mjs`（R70）自己的注释写着：
 * > 「④ 只查**构建产物**（`out/`），不查安装包内的 `app.asar` ⇒ **安装包那一层靠 `verify:pack` 兜底**。」
 *
 * ⇒ 那一格当时是**空的**（`verify:pack` 里没有任何一条查声明），本模块就是来填它的。
 *
 * ## 为什么非要查"打包产物"这一层
 *
 * 「许可要求**随副本保留**」只有**分发出去的那份东西**里有才算兑现，而中间隔着两层过滤：
 * · 源码里有 ⇒ **没人引用** ⇒ 打包器**树摇**掉 ⇒ 分发副本 0 命中（R70 实测过的原状）；
 * · `out/` 里有 ⇒ **打包清单**（`build.files`）漏了 ⇒ 装出去还是 0 命中。
 * ⇒ 两层都过，才叫"随副本保留"。只查 `out/` 是不够的。
 *
 * ## 它回答三个问题
 *
 * ① **素材声明**：第三方素材的声明文字（Lucide 的 ISC 声明等）在 `app.asar` 里查得到吗？
 * ② **项目声明清单**：项目自己的第三方声明清单（`THIRD_PARTY_NOTICES.md`）随包了吗？
 *    （`THIRD_PARTY_NOTICES.md` §4/§5 是**明文要求**：再分发 pdfjs 的字体与 CMap 时
 *    必须保留许可文件**并在你的材料中保留那张表** ⇒ 它不随包 = 义务没兑现。）
 * ③ **依赖许可**：随包发出去的**依赖**各自的许可声明在哪？（包内许可文件，或随包的依赖许可清单）
 *
 * ## 覆盖不到的地方（如实说明，不吹）
 *
 * · 它只认 `export const <素材>_NOTICE` 这一种登记方式（与 `check-notices.mjs` **共用同一份实现**：
 *   `scripts/notice-source.mjs`）⇒ 「新增素材却压根没写声明」它抓不到，那是**人的纪律**；
 * · 它只看**这个产物根**（`--dir` 打包出来的 `win-unpacked`）⇒ NSIS 安装器里的东西不查
 *   （安装器带的是同一份 `app.asar` 与同一批 `resources`，由 electron-builder 从同一份产物复制）；
 * · 「依赖的许可文件」只查**在不在 / 被没被列出**，不逐字校验许可正文（正文由 `license:check` 按包名核对）。
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

const require = createRequire(import.meta.url);
/**
 * `@electron/asar` 是 **electron-builder 自带的传递依赖**（electron-builder 已是本仓 devDependency）
 * ⇒ **不新增任何依赖**就能读 asar（asar 里的文件内容是**未压缩**的原文）。
 */
const asar = require('@electron/asar');

/** 依赖目录里可被认作「许可文件」的文件名（各包写法不一） */
export const LICENSE_FILE_RE = /^(license|licence|copying|notice)(\.[^/]*)?$/i;

/** asar 里可能承载声明文字的文本文件 */
const TEXT_FILE_RE = /\.(js|mjs|cjs|html|css|json|md|txt)$/i;

/** 项目自己的两份随包文档（相对产物根 `resources/`） */
export const NOTICE_DOC = 'THIRD_PARTY_NOTICES.md';
export const DEP_LICENSE_DOC = 'DEPENDENCY-LICENSES.md';

/**
 * 列出 asar 里的全部文件（**统一成正斜杠、去掉前导斜杠**）。
 * ⚠️ 这个清单是**目录 + 文件混在一起**的 ⇒ 判断"是不是包"要看有没有 `package.json`，不能看层级。
 * @param {string} archive
 * @returns {string[]}
 */
export function listAsarFiles(archive) {
  return asar
    .listPackage(archive)
    .map((p) => String(p).replace(/\\/g, '/').replace(/^\/+/, ''))
    .filter((p) => p !== '');
}

/**
 * 读 asar 里某个文件的文本。
 *
 * ⚠️ **路径分隔符**：asar 的 `listPackage` 返回**正斜杠**路径，
 * 而 `extractFile` 内部按 `path.sep` 拆路径（**Windows 上是反斜杠**）⇒ 直接把正斜杠路径喂给它
 * 会得到 `"… was not found in this archive"`（实测踩过）。
 *
 * @param {string} archive
 * @param {string} filePath asar 内路径（正斜杠）
 * @returns {string}
 */
export function readAsarText(archive, filePath) {
  return asar.extractFile(archive, filePath.split('/').join(sep)).toString('utf8');
}

/**
 * **asar 里的符号链接**（本仓的工作区包 `@jujia/*` 在 node_modules 里是联接 ⇒ 进 asar 后是断链）。
 * @param {string} archive
 * @returns {Set<string>} 链接条目的路径
 */
export function listAsarLinks(archive) {
  const raw = asar.getRawHeader(archive);
  const links = new Set();
  const walk = (node, prefix) => {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const path = prefix === '' ? name : `${prefix}/${name}`;
      if (entry?.link !== undefined) links.add(path);
      else if (entry?.files !== undefined) walk(entry, path);
    }
  };
  walk(raw.header, '');
  return links;
}

/**
 * 从文件列表里推出**包的根目录**。
 *
 * ⚠️ `asar.listPackage` 返回的是**目录 + 文件**混在一起的清单 ⇒ **不能**直接拿路径层级当包：
 * `node_modules/@jujia`（**作用域目录**）会被当成一个包，`node_modules/@jujia/agent-core` 才是包。
 * ⇒ 判据改成：**只有存在 `<包>/package.json` 的那一层才算一个包**。
 *
 * @param {string} filePath
 * @returns {string | null}
 */
export function packageRootOf(filePath) {
  const m = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\/package\.json$/.exec(filePath);
  return m === null ? null : m[1];
}

/**
 * **核验一个打包产物的第三方声明与许可**。
 *
 * @param {string} artifactRoot 产物根目录（`.../win-unpacked`）
 * @param {{ notices?: { name: string, text: string }[] }} [opts]
 * @returns {{
 *   ok: boolean,
 *   checks: { name: string, ok: boolean, skipped?: boolean, reason?: string, detail?: string }[],
 *   noticeHits: { name: string, hit: boolean, files: string[] }[],
 *   deps: { total: number, withLicense: number, listedInDoc: number, missing: string[] },
 *   links: string[],
 * }}
 */
export function auditPackLicenses(artifactRoot, opts = {}) {
  const notices = opts.notices ?? [];
  const checks = [];
  const report = (name, ok, detail) => checks.push({ name, ok, detail });

  const asarPath = join(artifactRoot, 'resources', 'app.asar');
  const resourcesDir = join(artifactRoot, 'resources');
  if (!existsSync(asarPath)) {
    report('产物里有 app.asar（量不到就红，不许当通过）', false, `找不到：${asarPath}`);
    return { ok: false, checks, noticeHits: [], deps: { total: 0, withLicense: 0, listedInDoc: 0, missing: [] }, links: [] };
  }

  const files = listAsarFiles(asarPath);
  const links = listAsarLinks(asarPath);

  /* --- ① 素材声明文字：查得到吗（逐个声明找它落在哪个文件里） --- */
  const noticeHits = [];
  const textFiles = files.filter((f) => TEXT_FILE_RE.test(f) && !links.has(f));
  for (const n of notices) {
    const hitFiles = [];
    for (const f of textFiles) {
      let content;
      try {
        content = readAsarText(asarPath, f);
      } catch {
        continue;
      }
      if (content.includes(n.text)) hitFiles.push(f);
    }
    noticeHits.push({ name: n.name, hit: hitFiles.length > 0, files: hitFiles });
  }
  if (notices.length === 0) {
    report(
      '素材声明文字在 app.asar 里查得到（查得到才叫「随副本保留」）',
      false,
      '源码里一条 `*_NOTICE` 常量都没发现 ⇒ 要么素材声明被删了/改名了（**定位器失效**），要么这份源码根本还没登记声明 ⇒ ' +
        '此时"产物里查不到"是**必然**的，不许当通过',
    );
  } else {
    const missing = noticeHits.filter((n) => !n.hit);
    report(
      '素材声明文字在 app.asar 里查得到（查得到才叫「随副本保留」）',
      missing.length === 0,
      missing.length === 0
        ? noticeHits.map((n) => `${n.name} ⇒ ${n.files.join('、')}`).join('；')
        : missing.map((n) => `${n.name} 在 ${String(textFiles.length)} 个文本文件里 0 命中`).join('；'),
    );
  }

  /* --- ② 项目自己的两份声明文档随包了吗 --- */
  const docText = (name) => {
    for (const p of [join(resourcesDir, name), join(artifactRoot, name)]) {
      if (existsSync(p)) {
        try {
          return readFileSync(p, 'utf8');
        } catch {
          return '';
        }
      }
    }
    return null;
  };
  const noticesDoc = docText(NOTICE_DOC);
  report(
    `项目自己的第三方声明清单（${NOTICE_DOC}）随包了吗（它的 §4/§5 明文要求随分发保留署名与许可）`,
    noticesDoc !== null,
    noticesDoc === null
      ? `产物里没有 ${NOTICE_DOC} ⇒ 装出去的副本里没有这份清单（字体/CMap/node-pty 的署名与许可义务就落在这里）`
      : `随包（${String(noticesDoc.length)} 字符）`,
  );

  /* --- ③ 随包依赖各自的许可声明 --- */
  const pkgRoots = new Set();
  for (const f of files) {
    const root = packageRootOf(f);
    if (root !== null && !links.has(root)) pkgRoots.add(root);
  }
  const depLicenseDoc = docText(DEP_LICENSE_DOC) ?? noticesDoc ?? '';
  const missing = [];
  let withOwnLicense = 0;
  let listedInDoc = 0;
  for (const root of [...pkgRoots].sort()) {
    const pkgName = root.slice(root.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const hasOwn = files.some((f) => {
      if (!f.startsWith(`${root}/`)) return false;
      const rest = f.slice(root.length + 1);
      if (rest.includes('/')) return false; // 只认包根那一层
      return LICENSE_FILE_RE.test(rest);
    });
    if (hasOwn) {
      withOwnLicense += 1;
      continue;
    }
    // 没有包内许可文件 ⇒ 必须在随包的依赖许可清单里被列出（按包名查）
    if (depLicenseDoc.includes(pkgName)) {
      listedInDoc += 1;
      continue;
    }
    missing.push(pkgName);
  }
  report(
    '随包发出去的依赖都带着自己的许可声明（包内 LICENSE/LICENCE/COPYING/NOTICE，或被随包的依赖许可清单列出）',
    missing.length === 0,
    missing.length === 0
      ? `${String(pkgRoots.size)} 个依赖：${String(withOwnLicense)} 个自带许可文件，${String(listedInDoc)} 个由随包清单覆盖`
      : `${String(missing.length)}/${String(pkgRoots.size)} 个依赖既没有包内许可文件、也没被随包清单列出：${missing.join('、')}`,
  );

  /* --- 附：asar 里的断链（工作区包在 node_modules 里是联接 ⇒ 进 asar 后指向 asar 之外） --- */
  if (links.size > 0) {
    log(
      `  ℹ️ asar 里有 ${String(links.size)} 个符号链接条目（指向 asar 之外，装出去后是断链；` +
        `它们对应的代码已被打进 out/main，故不影响运行）：${[...links].slice(0, 6).join('、')}`,
    );
  }

  const ok = checks.every((c) => c.ok === true);
  return {
    ok,
    checks,
    noticeHits,
    deps: { total: pkgRoots.size, withLicense: withOwnLicense, listedInDoc, missing },
    links: [...links],
  };
}

/** 小工具：模块内部打日志（CLI 模式下也要出得来） */
function log(text) {
  console.log(text);
}

/**
 * 命令行用法（单独核一份已存在的产物）：
 *   node scripts/license-in-asar.mjs <app.asar 的路径或产物根> [仓库根]
 */
const isMain = (() => {
  try {
    return process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  const [, , target, repoArg] = process.argv;
  if (!target) {
    console.error('用法：node scripts/license-in-asar.mjs <app.asar 的路径 或 产物根 win-unpacked> [仓库根]');
    process.exit(2);
  }
  /** 传进来的是 asar 就退到它的产物根；传的是产物根就直接用 */
  const artifactRoot = target.endsWith('.asar') ? dirname(dirname(target)) : target;
  const repoRoot = repoArg ?? process.cwd();
  const { noticeConstantsOfRepo } = await import('../../../scripts/notice-source.mjs');
  const notices = noticeConstantsOfRepo(repoRoot).map((n) => ({ name: n.name, text: n.text }));
  const result = auditPackLicenses(artifactRoot, { notices });
  for (const c of result.checks) {
    console.log(
      c.skipped === true
        ? `➖ ${c.name}（本次不适用：${c.reason ?? ''}）`
        : `${c.ok ? '✅' : '❌'} ${c.name}${c.detail === undefined ? '' : `\n     ${c.detail}`}`,
    );
  }
  console.log(
    result.ok
      ? `\n打包产物第三方声明核验通过（${String(result.checks.length)} 条）`
      : `\n打包产物第三方声明核验**失败**：${String(result.checks.filter((c) => !c.ok).length)} 条不通过`,
  );
  process.exit(result.ok ? 0 : 1);
}
