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
