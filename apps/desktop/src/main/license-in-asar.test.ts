import { describe, expect, it, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * **打包产物层的第三方声明核验**（R73 · 排查42 收口 · 原在制品线编号 R77）。
 *
 * ## 这条锁守什么
 *
 * 「许可要求**随副本保留**」只有**分发出去的那份东西**里有才算兑现，而中间隔着两层过滤：
 * 源码里没人引用 ⇒ 打包器树摇掉；`out/` 里有但打包清单漏了 ⇒ 装出去还是 0 命中。
 * ⇒ 判据必须落在 **`app.asar` 那一层**（`apps/desktop/scripts/license-in-asar.mjs`），
 *   并且由 `verify:pack` 在真实产物上跑一次。
 *
 * ## 为什么本文件是"注入证红"而不是"再写一遍断言"
 *
 * R70 留下的教训：一条锁的**标题写着「ISC 要求随副本保留」**，实际只断言了「模块里有这个字符串」
 * ⇒ 判据宣称的覆盖面 ≠ 它实际测到的覆盖面 ⇒ 它绿了很久，而它声称守的那件事一直是假的。
 * ⇒ 所以这里**不满足于"判据是绿的"**：必须证明**把产物里那段文字真的去掉之后，它会红**。
 *
 * ## 口径
 *
 * 判据模块是 `.mjs`，本仓 tsconfig 没开 `allowJs` ⇒ 照 `lock-probe.test.ts` 的既有做法，
 * **以子进程方式**调用（不另写一份 .d.ts，也不在 TS 里引 .mjs）。
 */
const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');
const MODULE_URL = pathToFileURL(join(repoRoot, 'apps/desktop/scripts/license-in-asar.mjs')).href;

/** 一段假的素材声明（形状与 Lucide 的 ISC 声明一致：一行 ASCII 文本） */
const NOTICE_TEXT =
  'Icons from Lucide (https://lucide.dev), ISC License. Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT), and other contributors.';

interface AuditCheck {
  name: string;
  ok: boolean;
  detail?: string;
}
interface AuditResult {
  ok: boolean;
  checks: AuditCheck[];
  deps: { total: number; withLicense: number; listedInDoc: number; missing: string[] };
}

/** 跑一段 node 代码，返回 stdout（失败就把 stderr 抛出来，别让人对着空输出猜） */
function runNode(code: string): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: repoRoot });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += String(d);
    });
    child.stderr.on('data', (d) => {
      err += String(d);
    });
    child.on('error', fail);
    child.on('close', (code) => {
      if (code !== 0) {
        fail(new Error(`子进程退出码 ${String(code)}：${err}`));
        return;
      }
      done(out);
    });
  });
}

/** 对一份产物根跑一次审计 */
async function audit(artifactRoot: string): Promise<AuditResult> {
  const out = await runNode(
    `import { auditPackLicenses } from ${JSON.stringify(MODULE_URL)};` +
      `const r = auditPackLicenses(${JSON.stringify(artifactRoot)}, ` +
      `{ notices: [{ name: 'LUCIDE_NOTICE', text: ${JSON.stringify(NOTICE_TEXT)} }] });` +
      `process.stdout.write(JSON.stringify(r));`,
  );
  return JSON.parse(out) as AuditResult;
}

const created: string[] = [];

/**
 * 造一份"产物根"：`win-unpacked/resources/app.asar` + 两份随包声明清单。
 * @param root 临时目录
 * @param opts.noticeInBundle 渲染层 bundle 里放不放那段声明
 * @param opts.listBareDep 依赖清单里列不列那个"没有许可文件"的包
 */
async function buildArtifact(
  root: string,
  opts: { noticeInBundle: boolean; listBareDep: boolean },
): Promise<string> {
  const stage = join(root, 'stage');
  await mkdir(join(stage, 'out/renderer/assets'), { recursive: true });
  await mkdir(join(stage, 'node_modules/foo'), { recursive: true });
  await mkdir(join(stage, 'node_modules/bare'), { recursive: true });
  await writeFile(join(stage, 'package.json'), '{"name":"jujia","version":"0.0.0"}', 'utf8');
  const bundle = opts.noticeInBundle ? `const notice = ${JSON.stringify(NOTICE_TEXT)};\n` : 'const notice = "";\n';
  await writeFile(join(stage, 'out/renderer/assets/index-abc.js'), bundle, 'utf8');
  await writeFile(join(stage, 'node_modules/foo/package.json'), '{"name":"foo","version":"1.0.0"}', 'utf8');
  await writeFile(join(stage, 'node_modules/foo/LICENSE'), 'MIT License\n', 'utf8');
  // bare 这个包**故意没有**许可文件（模拟上游就没带）
  await writeFile(join(stage, 'node_modules/bare/package.json'), '{"name":"bare","version":"1.0.0"}', 'utf8');

  const artifactRoot = join(root, 'win-unpacked');
  const asarPath = join(artifactRoot, 'resources/app.asar');
  await mkdir(dirname(asarPath), { recursive: true });
  await runNode(
    `import { createRequire } from 'node:module';` +
      `const require = createRequire(${JSON.stringify(join(repoRoot, 'package.json'))});` +
      `const { createPackage } = require('@electron/asar');` +
      // ⚠️ createPackage 是**异步**的 ⇒ 不 await 的话子进程会先退出、asar 根本没生成（实测踩过）
      `await createPackage(${JSON.stringify(stage)}, ${JSON.stringify(asarPath)});`,
  );
  await writeFile(join(artifactRoot, 'resources/THIRD_PARTY_NOTICES.md'), '# 第三方素材与许可声明\n', 'utf8');
  await writeFile(
    join(artifactRoot, 'resources/DEPENDENCY-LICENSES.md'),
    opts.listBareDep ? '- foo@1.0.0\n- bare@1.0.0\n' : '- foo@1.0.0\n',
    'utf8',
  );
  return artifactRoot;
}

/** 造一个临时目录（放仓库的 .tmp 下，与本仓其它用例同一口径） */
async function tempRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(repoRoot, '.tmp', prefix));
  created.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of created.splice(0, created.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('打包产物层的第三方声明核验（R73）', () => {
  it('产物齐全时三条判据全绿（随包声明在 bundle 里、清单随包、依赖许可有交代）', async () => {
    const root = await tempRoot('license-in-asar-');
    const artifactRoot = await buildArtifact(root, { noticeInBundle: true, listBareDep: true });
    const result = await audit(artifactRoot);
    expect(result.checks.map((c) => c.name)).toHaveLength(3);
    expect(result.ok).toBe(true);
    expect(result.checks.every((c) => c.ok)).toBe(true);
  });

  it('把产物里那段文字去掉 ⇒ 必须红（这条是本轮要求的注入证红）', async () => {
    const root = await tempRoot('license-in-asar-mut-');
    const artifactRoot = await buildArtifact(root, { noticeInBundle: true, listBareDep: true });
    const asarPath = join(artifactRoot, 'resources/app.asar');

    // **真的动产物**：把 asar 字节流里那段声明逐字节换成等长的占位符（结构不变，仍是合法 asar）
    const before = await readFile(asarPath);
    const needle = Buffer.from(NOTICE_TEXT, 'utf8');
    const filler = Buffer.from('X'.repeat(NOTICE_TEXT.length), 'utf8');
    const idx = before.indexOf(needle);
    expect(idx).toBeGreaterThan(-1); // 先确认那段文字本来就在产物里（否则这个变异是空转）
    const after = Buffer.from(before);
    needle.copy(after, idx);
    filler.copy(after, idx);
    expect(after.equals(before)).toBe(false);
    expect(after.includes(needle)).toBe(false);
    await writeFile(asarPath, after);

    const result = await audit(artifactRoot);
    expect(result.ok).toBe(false);
    const failed = result.checks.filter((c) => !c.ok);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.name).toContain('素材声明文字');
  });

  it('随包的第三方声明清单被删掉 ⇒ 必须红（装出去的副本里那份清单没了）', async () => {
    const root = await tempRoot('license-in-asar-doc-');
    const artifactRoot = await buildArtifact(root, { noticeInBundle: true, listBareDep: true });
    await rm(join(artifactRoot, 'resources/THIRD_PARTY_NOTICES.md'), { force: true });
    const result = await audit(artifactRoot);
    expect(result.ok).toBe(false);
    const failed = result.checks.filter((c) => !c.ok);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.name).toContain('THIRD_PARTY_NOTICES.md');
  });

  it('某个依赖既没有包内许可文件、也没被随包清单列出 ⇒ 必须红', async () => {
    const root = await tempRoot('license-in-asar-dep-');
    const artifactRoot = await buildArtifact(root, { noticeInBundle: true, listBareDep: false });
    const result = await audit(artifactRoot);
    expect(result.ok).toBe(false);
    expect(result.deps.missing).toContain('bare');
    const failed = result.checks.filter((c) => !c.ok);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.name).toContain('依赖');
  });

  it('源码里一条声明都没有 ⇒ 必须红（定位器失效不许当通过）', async () => {
    const root = await tempRoot('license-in-asar-none-');
    const artifactRoot = await buildArtifact(root, { noticeInBundle: false, listBareDep: true });
    const out = await runNode(
      `import { auditPackLicenses } from ${JSON.stringify(MODULE_URL)};` +
        `const r = auditPackLicenses(${JSON.stringify(artifactRoot)}, { notices: [] });` +
        `process.stdout.write(JSON.stringify(r));`,
    );
    const result = JSON.parse(out) as AuditResult;
    expect(result.ok).toBe(false);
    expect(result.checks[0]?.ok).toBe(false);
  });
});
