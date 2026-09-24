import { join } from 'node:path';
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { isTrustedSenderUrl } from '../security';

/** 统一的通道注册函数：具体 handler 只写业务，不各自操心发送方校验 */
export type HandleRegistrar = (
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: never[]) => unknown,
) => void;

/**
 * **全进程唯一的 IPC 入口：先校验发送方是应用自己的渲染层**，再交给具体处理函数。
 *
 * 为什么放在统一入口而不是逐个通道里写：通道清单以 `@jujia/shared-ipc` 的 `channels.ts` 为准，
 * 逐个通道写校验，新增一个就会漏一个；挂在入口上，新通道**默认就是受保护的**（安全默认值）。
 * 拿不到来源 URL 时**拒绝**（fail closed），而不是放行。
 *
 * 说明：渲染层的导航与新窗口早已被安全基线挡住，所以这不是"已经能被利用"的漏洞，
 * 而是纵深防御 —— 将来一旦引入第二个 webContents（内置浏览器、扩展页），
 * 没有这道校验就等于给它开全套 IPC。
 *
 * R-12 拆分时特意把它单独成文件：**全仓只允许这一处 `ipcMain.handle(`**，
 * 由 `ipc-wiring.test.ts` 跨全部 ipc 文件锁死。散落多处就等于放弃了"新通道默认受保护"。
 */
export function createTrustedHandle(): HandleRegistrar {
  return (channel, fn) => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const senderUrl = event.senderFrame?.url ?? '';
      const trusted = isTrustedSenderUrl(
        senderUrl,
        process.env['ELECTRON_RENDERER_URL'],
        join(__dirname, '../renderer'),
      );
      if (!trusted) {
        throw new Error(
          `[security] 拒绝来自不受信任发送方的 IPC 调用（${channel}）：${
            senderUrl === '' ? '(来源未知)' : senderUrl
          }`,
        );
      }
      return fn(event, ...(args as never[]));
    });
  };
}
