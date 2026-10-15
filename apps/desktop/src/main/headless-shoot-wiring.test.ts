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

describe('离屏截图模式的主进程开关（R32）', () => {
  it('无头 = smoke 或 shoot，二者共用同一个开关', () => {
    expect(src).toMatch(/const isShoot = process\.argv\.includes\('--shoot'\);/);
    expect(src).toMatch(/const isHeadless = isSmoke \|\| isShoot;/);
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
