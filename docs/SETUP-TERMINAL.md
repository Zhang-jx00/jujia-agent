# 内置终端的依赖安装与自检

内置终端靠 **`node-pty`** 分配真正的伪终端（PTY）。它是原生模块，所以单独说明一份。

**结论先行**：官方 `node-pty` 自带 Windows 预编译二进制，且它是 **N-API 模块（ABI 稳定，
预编译产物跨 Node / Electron 通用）** —— 因此**不需要 `electron-rebuild`**，
打包配置里 `build.npmRebuild` 已设为 `false`。
选型过程与实测依据见 [`knowledge/cards/016-electron-terminal-selection.md`](../knowledge/cards/016-electron-terminal-selection.md)。

---

## 一、通常情况：不需要额外步骤

`npm install` 会按 `apps/desktop/package.json` 装好 `node-pty`、`@xterm/xterm`、`@xterm/addon-fit`
（三者都已显式声明）。装完直接自检：

```bash
npm run check:pty
```

它会真的起一个伪终端执行 `echo`（8 秒超时）：

- 退出码 **0**、输出里有 `PTY-OK` → 真 PTY 可用；
- 退出码 **1** → 按它打印的原因处理，见 §三。

## 二、依赖缺失时补装

```bash
npm run setup:terminal
```

等价于 `npm i -w @jujia/desktop node-pty @xterm/xterm @xterm/addon-fit` ——
装进 workspace。**不要全局 `npm install -g`**（本项目的运行时约定是包进 workspace）。

## 三、常见报错

| 报错关键词 | 含义 | 怎么办 |
|-----------|------|--------|
| `Cannot find module 'node-pty'` | 依赖没装上 | 跑 `npm run setup:terminal`，再跑 `npm run check:pty` |
| `ETIMEDOUT` / `ECONNRESET` / network | 下载预编译二进制的网络不稳 | 重试一次；必要时配代理或换 npm 镜像（见 `docs/PLAN.md` §2.3） |
| `node-gyp` / `MSBuild` / `cl.exe` / `gyp ERR!` | 预编译没下下来，npm 转去源码编译，而本机缺 C++ 工具链 | 先当网络问题重试；仍失败看下面「关于源码编译」 |
| `npm ERR! code E404` | 包名打错了 | 用 §二 那条原样命令 |
| *compiled against a different Node.js ABI version* | ABI 不匹配 | **本项目不该出现**（node-pty 是 N-API）。真出现了，请把完整输出连同 `node -v` 与 Electron 版本一起提 issue |

**关于源码编译**：`npmRebuild` 已关，正常流程不会触发源码编译。
如果你手动开启 rebuild 又撞上 `MSB8040`，那是本机 Visual Studio 缺 **Spectre 缓解库** 组件 ——
按上面的结论，**正确做法是不要 rebuild**，而不是去装几个 GB 的构建工具。

## 四、终端在应用里的边界

与依赖无关，但常被一起问，所以写在这里（实现见 `packages/agent-core/src/terminal/terminal.ts`
与 `apps/desktop/src/main/terminal-service.ts`；安全承诺见 [`SECURITY.md`](../SECURITY.md)）：

- 内置终端归 **`exec` 类**，**每次新建会话都要你确认**；权限桥不可用时 **fail-closed（一律拒绝）**；
- 只能开在**当前选定的工作区**内；
- 子进程环境**剔除敏感变量**（名字里含 `KEY` / `TOKEN` / `SECRET` / `PASSWORD` / `PASSWD` / `CREDENTIAL` / `AUTH` 的一律不给）；
  代理变量**保留**（否则终端里没法联网），但会脱掉 URL 里内嵌的用户名口令；
- shell 取 `ComSpec`；取不到时回退到 `%SystemRoot%\System32\cmd.exe` 的**绝对路径**
  （再退 `C:\Windows\System32\cmd.exe`），**不用裸 `cmd.exe`**，避免 PATH 劫持。

> 说明：模型**没有**自主执行命令的内置工具。命令执行只有两条路 ——
> 你自己在内置终端里敲，以及你逐个批准的 MCP 工具。

## 附：这三个包各自做什么

| 包 | 作用 |
|----|------|
| `node-pty` | 分配**真正的伪终端**。没有它，程序会以为"被脚本调用"：关掉颜色、隐藏交互提示、全屏 TUI 不渲染、Ctrl-C 失效 |
| `@xterm/xterm` | 终端渲染组件 |
| `@xterm/addon-fit` | 让终端随容器大小自适应行列 |
