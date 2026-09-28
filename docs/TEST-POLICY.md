# 测试与临时文件策略（不占系统盘）

用户的硬要求：**测试与临时文件优先落在非 C 盘**；确实必须用 C 盘时，测试完成后要彻底清除
**只由本项目产生的**文件，且**绝不改动任何与本项目无关的文件**。

这份文档说明这条要求是怎么落到代码里的 —— 靠的是**默认行为**，而不是"每次都记得设环境变量"。

---

## 一、测试数据落在哪

| 场景 | 数据根（应用自己的数据） | Electron 配置/缓存 | 说明 |
|------|--------------------------|---------------------|------|
| `npm run smoke` | `<仓库>/.tmp/smoke/data` | `<仓库>/.tmp/smoke/profile` | 启动器自动隔离 |
| `npm run perf` | `<仓库>/.tmp/perf/data` | `<仓库>/.tmp/perf/profile` | 同上 |
| `npm run e2e` | `<仓库>/.tmp/e2e/data` | `<仓库>/.tmp/e2e/profile` | 跑完整体清掉 |
| `npm test` / `vitest` | `<系统临时目录>` 下的 `jujia-*` | 不涉及 | 本机该目录在 D 盘（`D:\Temp`） |
| `npm run app` / `npm run dev` | Electron 默认位置（`%APPDATA%`，即 C 盘） | 同左 | **这是你日常使用**，不是测试；想换位置见下 |

两处都要挪才叫真隔离：

- `JUJIA_DATA_BASE_DIR` —— 应用**自己的**数据根（配置、连接、权限规则、技能、钩子、MCP 配置…）；
- `--user-data-dir` —— **Electron** 的配置与缓存（Windows 上默认在 `%APPDATA%`，也就是 C 盘）。

启动器 `apps/desktop/scripts/run-electron.mjs` 在 `--smoke` / `--perf` 时会**自动**设置这两项；
调用方已显式设置则尊重调用方的选择。

## 二、`.tmp/` 的定位

- 已在 `.gitignore` 中（不会入库）；
- 已在 `scripts/cleanup.py` 的清理范围内（`--apply` 时移入项目内 `.trash/`，保留 30 天可反悔）；
- 仍留在磁盘上时可以随手删 —— 里面只有测试产生的数据。

## 三、日常使用也想换到别的盘

```bash
# cmd
set JUJIA_DATA_BASE_DIR=D:\JuJiaData
npm run app
```

```powershell
# PowerShell
$env:JUJIA_DATA_BASE_DIR = "D:\JuJiaData"
npm run app
```

## 四、打包（`npm run dist`）会用到 C 盘缓存

`electron-builder` 与 Electron 的二进制缓存默认在 C 盘
（`%LOCALAPPDATA%\electron-builder`、`%LOCALAPPDATA%\electron`）。想挪走：

```bash
set ELECTRON_BUILDER_CACHE=D:\dev-caches\electron-builder
set ELECTRON_CACHE=D:\dev-caches\electron
npm run dist
```

> 本项目**没有**把这两个变量写死进脚本：它们只是缓存，写死会让别的机器上的路径失效。
> 需要打包时按上面设一次即可（我会在打包前设好）。

## 五、C 盘上还剩下什么（2026-09-22 清理后的现状）

| 位置 | 内容 | 是否保留 |
|------|------|----------|
| `%APPDATA%\JujiaAgent` | Electron 配置 + 应用数据 | **已清除**；只在你运行 `npm run app` / `dev` 时才会重新生成 |
| `%APPDATA%\jujia-agent` | 旧凭据目录（已迁到 D 盘） | **已清除** |
| `%LOCALAPPDATA%\electron-builder` | 打包缓存（77MB） | **已清除**，下次 `npm run dist` 会重新下载 |
| `%LOCALAPPDATA%\electron` | Electron 二进制缓存（空） | **已清除** |

清理前已把内容备份到 `D:\MiMo\ProjectOne\.workbuddy\backup-cdrive-2026-09-22\`
（`JuJiaData` 的四个文件 + 旧凭据），确认可读后才删的。
> ⚠️ 这一行本身就是一个**本机 checkout 路径留在 .md 里**的例子：`check:docs` 的第 9 条只扫代码与配置、
> **不扫 .md**（台账要引用路径作证据），所以抓不到它。开源前若要清，改写成"仓库同级目录下的备份位置"即可。

## 六、界面级安全断言的四条硬规矩（`v0.31.0-扩容1` 起，都是踩出来的）

| # | 规矩 | 为什么（出处） |
|---|------|----------------|
| 1 | **安全类断言必须问"真值"，不能只看界面文案** | 复核 026 的 **G-8**：把 `will-navigate` 里的 `event.preventDefault()` **整行删掉**（拦截彻底消失）之后，e2e 17 步**照样全绿** —— 因为断言看的是"已打开 …/jump"这类**我们自己写上去的文案**，它跟"有没有真拦住"无关。改法：直接问被测对象的实际状态（例如经读正文通道取回 guest 真实的 `origin` 与正文） |
| 2 | **每条新安全断言都要做一次红/绿实验**：把守卫改坏 → 断言**必须红** → 还原 → **必须绿**。三步都留输出才算写完 | 一条不会红的断言等于没有断言。红/绿必须在**已提交的干净基线**上做，还原用 `git checkout -- <file>`（此时文件已提交，不会丢未提交的工作）—— 与 §操作禁忌 里那条变异禁忌同源 |
| 3 | **`waitForText` 的锚点必须在"这一步之前不存在"** | 复核 026 的 **G-2**：`file://` 那步等"已拒绝"，而上一步跨站拦截的理由末尾就叫"…，已拒绝" → 等待**秒过**、快照拿到旧状态，误报成"拒绝理由没写协议"。等错误/拒绝提示时尤其要检查这一点。另 **G-1**：锚点取自 `<input placeholder>` 的话 `innerText` **永远读不到** |
| 4 | **要证明"地址真的被交给了外部程序"，就让一个真程序去取一次，用本地站点的请求台账作真值** | `v0.35.0-扩容2` 的 e2e 第 20 步：外发交付只看弹窗文案不算数。把 Windows 自带的命令行 HTTP 客户端**当作"自选浏览器"**（交给它的参数只有一个网址），它必然真的回来取一次，于是"允许 → 台账里有这一条 / 拒绝或未选程序 → 台账里没有"成了硬证据。代价：该步依赖这个客户端存在，缺了就**明确报错说明原因**，不做静默跳过（"跳过但仍报全绿"是最坏的一种绿） |
| 5 | **改完主进程必须重新构建再跑 e2e**（`npm run e2e` 自带构建；`node scripts/e2e-ui.mjs` **不带**） | 铺设6b 实测踩过：修完 `will-quit` 直接跑裸脚本，连着三轮"没修好"，差点把结论写成"这修法也不生效"。e2e 跑的是 `out/` 里的**上一次构建**，与源码无关（复核 039 的 R-8） |
| 6 | **退出路径上的异步写入不会被等待**：断言"退出时写了什么"必须用真实关闭路径（`window.close()`），并在断言前想清楚事件顺序 | 同上：`before-quit` 里"发射后不管"的 tmp→fsync→rename **一次都没落到盘上**（探针 `PROBE_MODE=plain` 与 `delay` 两个对照组实测）。Playwright 的 `app.close()` 连事件序列都不产生，用它测会红得没道理（复核 039 的 R-1） |

### 附一：一条与断言直接相关的 Chromium 环境事实（**必记**）

**Chromium 会把 `http://localhost:PORT` 重写回 `127.0.0.1`** —— 实测：用 `localhost` 做"第二个站点"时，
即使网页真的跳过去了，`webContents.getURL()` 的 origin 仍显示成 `127.0.0.1:同一端口`，
"有没有越站"从 origin 上**根本看不出来**。
所以浏览器跨站用例的跳转目标必须是**同主机不同端口**（起两个本地服务），
内容层面的标记（页面正文里的 marker）才是可靠的判据。
