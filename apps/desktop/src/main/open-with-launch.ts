import { spawn } from 'node:child_process';
import { shell } from 'electron';

/**
 * 真正"把地址交给本机"的两个动作（M10 收尾）。
 *
 * 单独成文件的原因：判档与流程都在 `open-with-*` 里可测，而这两个函数**必然碰外部世界**
 * （`shell.openExternal` 与 `child_process.spawn`）。把它们隔出来，
 * 单元测试就能用假实现跑完整链路，而这里只剩"参数怎么拼"这一件事可审。
 *
 * **`shell: false` 是本文件唯一的底线**：一旦改成 true，网址就会被拼进命令行字符串，
 * 于是 `http://x && 恶意命令` 这类输入能直接执行 —— 那正是 `run_command` 工具
 * 反复声明过的注入面。这里参数只有一个、且永不经过解释器。
 */

/** 交给自选程序的参数：**只有网址这一个**，不拼命令、不加开关 */
export function buildProgramArgs(url: string): string[] {
  return [url];
}

export interface Launchers {
  openInSystemBrowser: (url: string) => Promise<void>;
  launchProgram: (exePath: string, url: string) => Promise<void>;
}

export function createRealLaunchers(): Launchers {
  return {
    openInSystemBrowser: async (url) => {
      // 网址在此之前已由 `decideNavigation` 过一次协议白名单；这里不重复判，
      // 但**也不放宽**（非 http(s) 根本走不到这一行，见 `open-with-service.ts` 的顺序）。
      // Electron 44 的签名是 `Promise<void>`：失败走 reject，所以**必须 await** ——
      // 沿用 security.ts 里那种 `void shell.openExternal()` 的写法会把失败吞成"没反应"。
      try {
        await shell.openExternal(url);
      } catch (err) {
        throw new Error(`系统没能打开这个地址：${err instanceof Error ? err.message : String(err)}`, {
          cause: err,
        });
      }
    },
    launchProgram: async (exePath, url) => {
      const child = spawn(exePath, buildProgramArgs(url), {
        shell: false,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      // 启动失败是**异步**报的（找不到文件 / 没有权限）；不监听就会变成一个静默的没反应
      await new Promise<void>((res, rej) => {
        child.once('error', (err) => rej(err));
        child.once('spawn', () => {
          child.unref(); // 外部浏览器与应用解耦：关掉应用不该把用户的浏览器一起带走
          res();
        });
      });
    },
  };
}
