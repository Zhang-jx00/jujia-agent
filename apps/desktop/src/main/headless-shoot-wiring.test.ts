/**
 * 展示页截图（R32）依赖的主进程开关，用**源锁**钉住。
 *
 * 为什么是源锁而不是跑起来测：`main/index.ts` 起不了 vitest（要 Electron 运行时），
 * 而这里要防的恰恰是"运行期把窗口弹到用户脸上"这种**只在人身上才看得见**的事 ——
 * 上一次做展示页截图（R12）是手工点的，没有任何东西保证下次还离屏。
 *
 * 三条判据各拦一种漂移：
 * ① 开关存在且**只有 smoke 与 shoot 两个来源**（将来加第三条模式要显式进来，不许顺手 `show()`）；
 * ② `show()` 的调用点**恰好一个**且受这个开关管（"在别处再补一次 show"会当场红）；
 * ③ 旧的 `if (!isSmoke) win.show()` 形状不许回来（那等于 shoot 模式白加）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const src = strip(readFileSync(new URL('./index.ts', import.meta.url), 'utf8'));
const secSrc = strip(readFileSync(new URL('./security.ts', import.meta.url), 'utf8'));
/** R60：e2e 脚本本体（它**每一次**启动应用都得带 `--e2e`，否则窗口会弹到用户桌面上） */
const e2eSrc = strip(readFileSync(new URL('../../scripts/e2e-ui.mjs', import.meta.url), 'utf8'));

describe('离屏截图模式的主进程开关（R32）', () => {
  it('无头 = smoke 或 shoot 或 e2e，三者共用同一个开关', () => {
    expect(src).toMatch(/const isShoot = process\.argv\.includes\('--shoot'\);/);
    expect(src).toMatch(/const isE2e = process\.argv\.includes\('--e2e'\);/);
    expect(src).toMatch(/const isHeadless = isSmoke \|\| isShoot \|\| isE2e;/);
  });

  /**
   * R60：e2e 的**每一次**启动都必须带 `--e2e`。
   *
   * 为什么这条要盯到**每一处**启动（而不是"脚本里有这么一处"）：
   * 这个脚本会**重启应用**好几次（改配置后重启、权限门重启…）⇒ 漏掉任何一处，
   * 那一处就会**把窗口弹到用户桌面上** ⇒ 而这条违反的后果是**抢焦点把用户正在玩的游戏顶掉**。
   *
   * 为什么要**源锁**（而不是只靠 e2e 自己的运行期自证）：运行期自证只管**第一次**启动；
   * 后面几次重启要是漏了 flag，源锁才拦得住。⇒ 两侧都要。
   */
  it('e2e 脚本的每一次启动都带 --e2e（漏一处就会在用户桌面上弹一次窗）', () => {
    const launches = [...e2eSrc.matchAll(/args:\s*\[MAIN_ENTRY[^\]]*\]/g)].map((m) => m[0]);
    expect(launches.length, '一条启动都没扫到 —— 定位器可能失效（防失焦先红）').toBeGreaterThan(0);
    const missing = launches.filter((l) => !l.includes("'--e2e'"));
    expect(missing, `这些启动没带 --e2e ⇒ 窗口会弹到用户桌面上：\n${missing.join('\n')}`).toEqual([]);
  });

  it('show() 只有一个调用点，且被这个开关管着', () => {
    expect(src.match(/win\.show\(\)/g) ?? []).toHaveLength(1);
    expect(src).toContain('if (!isHeadless) win.show();');
    // 旧形状不许回来
    expect(src).not.toContain('if (!isSmoke) win.show();');
  });

  /**
   * 这一条是**反向钉**：`offscreen` 只能由 shoot 打开。
   * 日常窗口要是被写成 `offscreen: true`，症状是"双击图标什么都没发生"——
   * 那比"截图脚本把窗口弹出来"更糟，所以它必须当场红，而不是等用户报告。
   *
   * 落点为什么在 `webPreferences` 而不是顶层：Electron 44 的类型里 `offscreen` **只在 `WebPreferences` 上**
   * （顶层写它会直接 TS2353 —— 本轮实测撞过一次），而 `webPreferences` 是本仓库的
   * **安全基线出口**（`secureWebPreferences` + `assertSecureWebPreferences`，fail closed）。
   * 所以这条开关**必须经过那个出口**，不许在 `index.ts` 里手拼一份 `webPreferences` ——
   * 手拼的那份绕过断言，正是"安全基线被顺手复制粘贴掉"的形状。
   */
  it('offscreen 走安全基线出口，且只有点名才给', () => {
    expect(src).toContain(
      "secureWebPreferences(join(__dirname, '../preload/index.js'), { offscreen: isShoot })",
    );
    // 顶层那份不许留下来（类型上编译不过，但注释/死代码也算误导）
    expect(src).not.toMatch(/^\s*offscreen:/m);
    expect(secSrc).toMatch(/offscreen\?: boolean/);
    // 只给 true 或不给：不许把 undefined 塞进 webPreferences（exactOptionalPropertyTypes 下这是编译错误，
    // 而写成 `offscreen: options.offscreen` 的人会在下一轮 typecheck 才看见——所以判据先拦住写法）
    expect(secSrc).toContain('...(options.offscreen ? { offscreen: true } : {})');
    expect(secSrc).not.toMatch(/offscreen: options\.offscreen\b/);
  });
});
