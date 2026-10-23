/**
 * **重拍展示页截图的跑法**：按运行 id 用一只**全新的输出目录**打包 → 拍 → 收尾删自己这只。
 *
 * ## 为什么不能继续用固定的 `release/shoot/`
 *
 * R62 实测：那只目录里的 `app.asar` 被一个**看不见归属的进程**握着
 * （两个 `crashpad_handler.exe`，`Path` 取不到 ⇒ 按本仓规矩**不杀归属不明的进程**）
 * ⇒ electron-builder 想覆盖它时 **`EBUSY: resource busy or locked`**
 * ⇒ **重拍根本跑不起来**（R32 立的"一条命令重拍四张"从此哑火）。
 *
 * ⇒ 这正是 **T67/T69 记过的形状**：「**换目录还必须换输出参数**」——
 * 而 `npm run screenshots` **一直没换**（一直写死 `--config.directories.output=release/shoot`）
 * ⇒ 本轮一并修掉：**每次用一只按运行 id 命名的新目录** ⇒ 旧目录的句柄**挡不住本轮**。
 *
 * ## 为什么不在 finally 里"顺手删掉旧的 `release/shoot`"
 *
 * ① 它**删不掉**（句柄还在）⇒ 删失败要**如实说**，不能装作清了；
 * ② 更重要的是：**归属不明的进程照旧不杀** ⇒ 那一格只能**记下来**，
 * 等占用一放开，由下一轮（或 `cleanup.py`）收走。
 *
 * ## 出口
 *
 * 退出码由子进程决定；**收尾一定跑**（`finally`）—— 这一点是 T66 记过的：
 * `process.exit` 不跑 `finally` ⇒ 应用会留在后台握着句柄 ⇒ 下一轮又撞同一堵墙。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const releaseDir = join(here, '..', 'release');

/** 按运行 id 命名（与 `verify-pack.mjs` 同一套形状）⇒ 每轮都是新目录 ⇒ 不与旧句柄相撞 */
const RUN_ID = `${Date.now().toString(36)}-${process.pid}`;
const PACK_OUT = `shoot-${RUN_ID}`;
const packDir = join(releaseDir, PACK_OUT);
const exe = join(packDir, 'win-unpacked', 'JujiaAgent.exe');

const builderEntry = join(repoRoot, 'node_modules', 'electron-builder', 'cli.js');
if (!existsSync(builderEntry)) {
  console.error(`❌ 找不到 electron-builder：${builderEntry}（先 npm i）`);
  process.exit(1);
}

let exitCode = 0;
try {
  console.log(`[重拍] 打包到一只新目录：release/${PACK_OUT}（不碰旧目录 ⇒ 旧句柄挡不住本轮）`);
  execFileSync(
    process.execPath,
    [builderEntry, '--win', '--dir', `--config.directories.output=release/${PACK_OUT}`],
    { cwd: join(here, '..'), stdio: 'inherit' },
  );
  if (!existsSync(exe)) {
    console.error(`❌ electron-builder 退出码 0，但产物不在 ${exe} —— 输出目录参数没生效？`);
    exitCode = 1;
  } else {
    console.log('[重拍] 产物就位 ⇒ 开始离屏拍图（--shoot：不弹窗口、不抢焦点）');
    execFileSync(process.execPath, [join(here, 'shoot-ui.mjs')], {
      cwd: join(here, '..'),
      stdio: 'inherit',
      // **输出参数必须跟着换**（T67/T69 的老话）⇒ 告诉 shoot-ui 去哪儿找产物
      env: { ...process.env, JUJIA_PACK_DIR: join(PACK_OUT, 'win-unpacked') },
    });
  }
} catch (err) {
  console.error(`❌ 重拍失败：${err instanceof Error ? err.message : String(err)}`);
  exitCode = 1;
} finally {
  // 收尾一定跑（T66：exit 不跑 finally ⇒ 应用留在后台握着句柄 ⇒ 下一轮又撞同一堵墙）
  /**
   * 删一只目录并**如实回答删没删掉**。
   * ⇒ 为什么单独抽成函数：两处（自己的产物 / 旧的固定目录）要的是**同一件事、同一套话术**，
   * 而"先给个初值再在 try 里覆盖"那种写法会被 lint 判成 `no-useless-assignment`
   * （那个初值从没被读过）⇒ 直接返回布尔值。
   */
  const removeDir = (dir) => {
    try {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      return !existsSync(dir);
    } catch {
      return false;
    }
  };
  const removed = removeDir(packDir);
  console.log(
    removed
      ? `[收尾] 本轮产物目录已删除：release/${PACK_OUT}/`
      : `[收尾] ⚠️ 本轮产物目录**没能删掉**：release/${PACK_OUT}/（有进程握着；归属不明照旧不杀 ⇒ 交给 cleanup.py）`,
  );
  const old = join(releaseDir, 'shoot');
  if (existsSync(old)) {
    const oldRemoved = removeDir(old);
    console.log(
      oldRemoved
        ? '[收尾] 旧的固定目录 release/shoot/ 也删掉了'
        : '[收尾] ⚠️ 旧的固定目录 release/shoot/ **删不掉**（句柄仍在；归属不明照旧不杀）⇒ **不是「已清」**',
    );
  }
}

process.exit(exitCode);
