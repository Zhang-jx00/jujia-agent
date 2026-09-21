# 怎么在自己终端里跑命令（W9b 终端依赖安装）

> 用途：本项目的沙箱**装不了原生模块**（`node-pty` 需要下载预编译二进制/必要时编译），
> 所以这一步必须由你在自己的终端里执行。**只需要跑一次。**
>
> 背景：为什么必须你跑 → 见 `knowledge/cards/016-electron-terminal-selection.md`
> （结论：官方 `node-pty` 自带 Windows 预编译，通常**不需要**装 VS Build Tools）

---

## 一、最省事的方式（推荐，Windows）

不用记路径，靠资源管理器带你到目录：

1. 打开**文件资源管理器**，地址栏输入（或粘贴）：
   ```
   D:\MiMo\ProjectOne\俱佳agent
   ```
   回车进入该目录。
2. 在**地址栏**里把上面的路径全选删掉，改成输入 `cmd`，按回车。
   → 会弹出一个命令行窗口，**而且已经在正确的目录里了**（省掉 cd）。
3. 粘贴下面这一行，按回车：

   ```
   npm i -w @jujia/desktop node-pty @xterm/xterm @xterm/addon-fit
   ```

4. 等它跑完（正常几十秒到两三分钟，取决于网速）。

---

## 二、其他打开方式（任选其一）

**PowerShell**（开始菜单搜 `PowerShell`）：
```powershell
cd D:\MiMo\ProjectOne\俱佳agent
npm i -w @jujia/desktop node-pty @xterm/xterm @xterm/addon-fit
```

**Git Bash**（你机器上装了）：
```bash
cd /d/MiMo/ProjectOne/俱佳agent
npm i -w @jujia/desktop node-pty @xterm/xterm @xterm/addon-fit
```

**VS Code 里**：打开该文件夹 → `Ctrl` + `` ` `` 打开终端 → 粘贴同样的命令。

---

## 三、怎么判断装成功了

跑完看到类似这两行就对了：

```
added N packages in Xs
```

然后**在同一个窗口**里跑这一句做实测（会真的起一个伪终端并执行 `echo`）：

```
cd apps\desktop && node -e "const p=require('node-pty');const t=p.spawn(process.env.COMSPEC||'cmd.exe',['/c','echo PTY-OK'],{cols:80,rows:24});t.onData(d=>process.stdout.write(String(d)));t.onExit(()=>process.exit(0));"
```

- 看到输出里有 **`PTY-OK`** → **真 PTY 可用**，可以告诉我开工了 ✅
- 报 `Cannot find module 'node-pty'` → 装没成功，把报错贴给我
- 报 ABI 不匹配（*compiled against a different Node.js ABI version*）→ **这是预期内的**，
  交给我处理（我会在打包/运行链路上做 `electron-rebuild`），你不用管

---

## 四、如果报错了

**直接把整段报错复制给我**（截图也行）。常见两种：

| 报错关键词 | 含义 | 怎么办 |
|-----------|------|--------|
| `node-gyp` / `MSBuild` / `cl.exe` / `gyp ERR!` | 本机没编译工具链，且预编译没下下来 | 换方案：我给你**替代包**或改用 `@lydell/node-pty`；仍不行才考虑装 VS Build Tools |
| `ETIMEDOUT` / `ECONNRESET` / `network` | 下载预编译二进制的网络不稳 | 重试一次；或开代理后重试 |
| `npm ERR! code E404` | 包名打错了 | 用上面那条原样命令 |

**不要**自己去装 Visual Studio Build Tools —— 那是几 GB，而且按选型结论**大概率不需要**。
真需要时我会明确告诉你。

---

## 五、装完之后

跟我说一句「装好了」即可。我会接着做：

1. 主进程 PTY 桥（`node-pty` + IPC 流式转发）
2. 渲染层 `xterm` 终端组件（含 `fit` 自适应）
3. **接入现有权限门**：终端属于 `exec` 类高副作用能力，**每次执行都要你确认**
4. 补测试 + 跑五件套 + 提交打标签推送

---

## 附：这条命令在做什么

| 包 | 作用 |
|----|------|
| `node-pty` | 分配**真正的伪终端**（PTY）。没有它，程序会以为"被脚本调用"，关掉颜色、隐藏交互提示、全屏 TUI 不渲染、Ctrl-C 失效 |
| `@xterm/xterm` | 终端渲染组件（VS Code 同源） |
| `@xterm/addon-fit` | 让终端随容器大小自适应行列 |
