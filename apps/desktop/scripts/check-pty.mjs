/**
 * 检查 PTY 依赖是否就绪（给用户自己跑的自检）。
 * 用法：npm run check:pty
 *
 * 退出码：0 = 可用；1 = 未安装或行为异常（都会打印可读原因，不抛栈）。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let pty;
try {
  pty = require('node-pty');
} catch (err) {
  const msg = err && err.message ? err.message : String(err);
  console.error('[x] node-pty 未就绪：' + msg);
  console.error('    -> 先跑一次：npm run setup:terminal');
  process.exit(1);
}

console.log('[v] node-pty 已加载，导出：' + Object.keys(pty).join(', '));

const shell = process.env.COMSPEC || 'cmd.exe';
let proc;
try {
  proc = pty.spawn(shell, ['/c', 'echo PTY-OK'], { cols: 80, rows: 24 });
} catch (err) {
  const msg = err && err.message ? err.message : String(err);
  console.error('[x] 伪终端启动失败：' + msg);
  console.error('    -> 把这段输出贴给开发者');
  process.exit(1);
}

let out = '';
proc.onData((d) => {
  out += String(d);
});
proc.onExit(({ exitCode }) => {
  const ok = out.includes('PTY-OK');
  console.log((ok ? '[v]' : '[x]') + ' 伪终端实测：退出码 ' + exitCode + '，输出含 PTY-OK = ' + ok);
  console.log(ok ? '    -> 真 PTY 可用，可以开工做内置终端了' : '    -> PTY 行为异常，把这段输出贴给开发者');
  process.exit(ok ? 0 : 1);
});
setTimeout(() => {
  console.error('[x] 超时：伪终端 8 秒内没有退出（行为异常）');
  process.exit(1);
}, 8000);
