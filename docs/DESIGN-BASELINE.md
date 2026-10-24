---
version: alpha
name: 俱佳Agent · 设计基调
description: 从现有令牌包（packages/ui-tokens）与两份样式表捕获的桌面端设计系统：深色单一主题、14px 正文、4px 间距阶梯、克制的动效预算。本文件是三批前端打磨（动效与微交互 · 图标系统 · 视觉统一）的判据。
colors:
  bg-layout: "#141414"
  bg-container: "#1f1f1f"
  bg-elevated: "#252525"
  bg-input: "#101010"
  text: "#f5f5f5"
  text-secondary: "#a6a6a6"
  primary: "#4c8dff"
  primary-hover: "#6ba0ff"
  success: "#5ec97a"
  warning: "#e0a52e"
  danger: "#ff7875"
  border: "rgba(255, 255, 255, 0.14)"
  border-strong: "rgba(255, 255, 255, 0.28)"
  scrim: "rgba(0, 0, 0, 0.55)"
typography:
  caption:
    fontFamily: "'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0px
  small:
    fontFamily: "'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0px
  body:
    fontFamily: "'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0px
  base:
    fontFamily: "'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0px
  title:
    fontFamily: "'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0px
  heading:
    fontFamily: "'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: 0px
  code-md:
    fontFamily: "Consolas, 'Cascadia Mono', monospace"
    fontSize: 12.5px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0px
  icon-md:
    fontFamily: "'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: 20px
    fontWeight: 400
    lineHeight: 1
    letterSpacing: 0px
  micro:
    fontFamily: "'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: 10px
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: 0px
rounded:
  none: 0px
  sm: 4px
  md: 6px
  lg: 8px
  pill: 999px
spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
components:
  app-tab:
    backgroundColor: "{colors.bg-container}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.small}"
    rounded: "{rounded.lg}"
    padding: "6px 14px"
    height: 30px
  app-tab-active:
    backgroundColor: "{colors.primary-wash}"
    textColor: "{colors.text}"
    typography: "{typography.small}"
    rounded: "{rounded.lg}"
    height: 30px
  button:
    backgroundColor: "{colors.bg-container}"
    textColor: "{colors.text}"
    typography: "{typography.small}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
  button-quiet:
    backgroundColor: "{colors.bg-container}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.small}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.bg-input}"
    typography: "{typography.small}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
  tool-card:
    backgroundColor: "{colors.bg-container}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
  drawer:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "12px 14px"
  card:
    backgroundColor: "{colors.bg-container}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "12px 14px"
  code-block:
    backgroundColor: "{colors.bg-input}"
    textColor: "{colors.text}"
    typography: "{typography.code-md}"
    rounded: "{rounded.sm}"
    padding: "8px 8px"
  skeleton:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.small}"
    rounded: "{rounded.md}"
---

# 俱佳Agent · 设计基调

## Overview

这是**从现有实现捕获**的一版设计系统，不是新发明：令牌的权威出处是
`packages/ui-tokens/src/tokens.ts`（W6 建立，颜色对比度按 WCAG AA 校验过），
CSS 侧镜像在 `apps/desktop/src/renderer/src/styles/motion.css` 的 `:root`；
组件形状取自 `styles.css` 与真实组件（`features/**`）。

产品气质：**深色单主题的桌面工作台**——信息密度偏高（13–14px 正文、4px 间距阶梯）、
装饰极少、颜色只用于**状态**（成功/警告/危险/主操作）而不是气氛。

置信度标注：`confirmed` = 令牌包或重复使用的组件原语；`likely` = 界面里反复出现但未文档化；
`tentative` = 只观察到一次。

## Colors

`confirmed`：全部来自令牌包。使用纪律（写在令牌文件头部）：

- **渲染层不允许出现硬编码颜色**，一律走 `--c-*`；
- 语义色只表达状态：`{colors.success}` 完成 / `{colors.warning}` 需要注意 /
  `{colors.danger}` 失败·拒绝 / `{colors.primary}` 主操作与焦点环；
- 表面分四层：`{colors.bg-layout}`（窗口底）< `{colors.bg-container}`（卡片）<
  `{colors.bg-elevated}`（Drawer/气泡）与 `{colors.bg-input}`（输入与代码块，刻意比 layout 还深）。

## Typography

`confirmed`：六档 UI 字级 + 一档等宽（`{typography.code-md}`，代码与命令一律等宽）。
正文 `{typography.base}` 14px / 行高 1.6；密集表格与小字用 `{typography.body}` 13px。
**不引入新字族**：`'Segoe UI'` + `'Microsoft YaHei'` 是 Windows 上中文不塌陷的稳妥组合。

**R41 补的一条（现扫出来的）**：**"字号"里混着三种别的角色**，不拆开就永远统一不了 ——
`{typography.icon-md}` 20px 是**状态图标字形**（`.jj-state-icon`）、
`{typography.code-md}` 12.5px 是**等宽代码区**（`.jj-hooks-editor`，半像素是给行高对齐的）、
`{typography.micro}` 10px 是**微型标记**（`.jj-canvas-port-tag`）。
⇒ 这三个**单开令牌**（CSS 侧 `--icon-md` / `--fs-code` / `--fs-micro`），
**不进字号阶梯**；字号阶梯只剩那六档。

## Layout

`confirmed`：4px 基准的 7 档间距（`{spacing.xxs}`…`{spacing.xxl}`）。
外壳 = **左栏（160px，分组导航）+ 主区（窄顶栏 + 可滚动主体）**（R66 把入口从顶栏搬进左栏）；
设置中心**占主区**（左导航 220px + 右侧内容，R67）⇒ 设置页与主界面是**同一块地的两种摆法**，不是第三层。
面板内容统一 `padding: {spacing.lg}` 起，
卡片间距 `{spacing.md}`。列表项与按钮用 `{spacing.xs}` 内边距、`{spacing.sm}` 之间距。

## Elevation & Depth

`confirmed`：三档阴影（`--shadow-card` 0 1px 2px / `--shadow-popover` 0 6px 20px /
`--shadow-dialog` 0 12px 40px）+ 一档遮罩 `{colors.scrim}`。
**深度靠层级顺序表达，不靠更多阴影档位**：卡片不投阴影，浮层才投。

## Shapes

`confirmed`：4 / 6 / 8 / pill 四档圆角。按钮与工具卡 6px（`{rounded.md}`）、
卡片与页签 8px（`{rounded.lg}`）、代码块 4px（`{rounded.sm}`）、状态胶囊用 pill。

## Motion

`confirmed`：令牌包里的动效预算（数字来自 2026-09-20 联网核实，见 `knowledge/cards/014`）：

| 用途 | 令牌 | 值 |
|---|---|---|
| 微交互（按压/hover 反馈） | `--motion-duration-instant` | 100ms |
| 常规状态过渡（展开、淡入） | `--motion-duration-fast` | 160ms |
| 较大面板（卡片扩展、抽屉） | `--motion-duration-normal` | 240ms |
| 大范围布局变化（上限） | `--motion-duration-slow` | 320ms |
| 入场 / 离场 / 屏内移动 | `--motion-ease-out` / `-ease-in` / `-ease-in-out` | 见 motion.css |
| 列表错峰 | `--motion-stagger-step` | 40ms（同屏最多 3 级） |

**铁律（motion.css 头部，7 条）**：只动 `transform`/`opacity` 优先；功能动效 ≤ 1s；
`will-change` 节制；同屏同时动画 ≤ 2–3 个；动画前已有最终尺寸（避免 CLS）；
`prefers-reduced-motion` 必须降级（已全局实现）；不得出现 >3 次/秒 的闪烁。

### 展开 / 收起（本基调对它的硬要求）

这是本项目**唯一允许的大范围布局变化**，规则如下：

1. 容器高度必须**连续过渡到内容的真实高度**（从当前高度出发，不是跳到目标再消失）；
2. 箭头/指示图标**用同一个元素旋转 180°**（`transform: rotate`），不许"换一个字符"；
3. 内容**不得突然出现**（展开途中不许先渲染成整块再淡入）、**不得造成布局跳动**
   （容器与相邻元素在过渡期间不许跳变）；
4. 实现首选 `grid-template-rows: 0fr → 1fr` + `overflow: hidden` 的容器
   （Electron 44 = Chromium 152 原生支持该过渡，且目标高度就是内容真实高度，
   无需 JS 量高）；不用 `max-height` 猜一个数——那是"看起来对了"的近似；
5. 时长用 `--motion-duration-fast`（160ms），入场缓动 `--motion-ease-out`；
   收起同样要过渡（不许只做展开不做收起）。

**调研依据（2026-10-12）**：`grid-template-rows` 的 `0fr ↔ 1fr` 是 Chromium 系能原生插值的
唯一网格轨道过渡（其它轨道属性如 `grid-template-columns` 被静默忽略），配 `overflow: hidden`
即得到"目标 = 内容真实高度"的连续过渡；另一条路是 MDN 记录的
`interpolate-size: allow-keywords` + `height: 0 → auto`（同样要求单端是 `<length-percentage>`），
**本项目不选它**：它标注为 experimental / not Baseline，且 `height` 过渡不含 padding——
带内边距的容器要额外处理，反而更容易做出"跳一下"。选第一条的另一好处是内容始终挂载，
不重挂载就不会闪。

### 按压与悬停

- 可点击元素按压：`transform: scale(0.97)`，`--motion-duration-instant`（已有
  `.jj-pressable`；本轮要求**统一接入**到页签、按钮、工具卡 L0、树节点）；
- 悬停：只变 `border-color` / `background-color` / `color`，时长 `--motion-duration-fast`；
- 焦点：全站 `:focus-visible` 统一 2px `{colors.primary}` 轮廓（已有全局规则）。

## Components

- `{components.app-tab}` / `{components.app-tab-active}`：**左栏入口**（R66 起；原先是顶栏页签）。
  **现状缺口**：无过渡，悬停与选中是瞬时的 → 本轮补 `--motion-duration-fast` 的颜色/边框过渡。
  **R66/R67 补的一条**：**选中态必须显式压过 `:hover`**（`.app-tab:hover` 的特异性 (0,2,0) 高于
  `.app-tab-active` 的 (0,1,0)）⇒ 否则鼠标停在选中项上时它会退回淡底、**看起来没选中**（实测字与底 1.09:1）。
- `{components.button}`（`.jj-btn`）、`{components.button-quiet}`、`{components.button-primary}`
  （`button.w2-btn-primary`）：三档按钮。静音档用于次要动作，主档只出现在每个面板的
  "主操作"位置，危险动作有独立档位（`.w2-btn-danger`）。
- `{components.tool-card}`（`.jj-tool`，L0–L2 三级信息密度）：L0 一行；L1 点开显示参数与结果；
  L2 用 `{components.drawer}` + `{colors.scrim}` 遮罩看完整输出。**现状缺口**：
  L1 的展开是瞬时高度（代码注释里明确写着"不做高度动画"）→ 本轮按上面的展开规则改。
- `{components.card}`（`.p0-card`）、`.w2-panel`：面板容器。
- `{components.code-block}`（`.jj-pre`）：命令、参数、输出的统一呈现。
- `{components.skeleton}`（`.jj-skeleton`）：懒加载面板占位。
- 状态文案三态：`.p0-ok`（成功）/ `.p0-warn`（需要注意）/ `.p0-err`（失败），
  与 `{colors.success}` / `{colors.warning}` / `{colors.danger}` 一一对应；
  **"不完整"不许写成"失败"**（T26 的口径，颜色与图标都要跟着分家）。

## Do's and Don'ts

**Do**
- 颜色、时长、圆角、间距一律走令牌；新组件先找 `{components.*}` 里有没有可复用的。
- 展开用 `grid-template-rows 0fr→1fr` + `overflow: hidden`；箭头同元素 `rotate(180deg)`。
- 按压反馈用 `.jj-pressable`（100ms、scale 0.97）。
- 图标用**内联开源 SVG**（见 Known Gaps ③），线宽与尺寸统一，随文字颜色（`currentColor`）。

**Don't**
- 不许硬编码颜色、时长、圆角（令牌文件头部明令禁止）。
- 不许用"换字符"表示展开状态（`›`/`⌄` 这种）。
- 不许对 `width/height/top/left/margin/padding` 做过渡（掉帧主因，motion.css 铁律 1）；
  展开的例外按上面第 4 条走容器轨道，不是给"任意属性"开绿灯。
- 不许用 emoji 当功能图标（📁/📄/✎ 这类），也不许新增与主题无关的 emoji。
- 不许在动画期间改变内容结构（重挂载列表 = 跳动）。

## Responsive Behavior

`tentative`：桌面单窗口应用，无移动端；主体在窄窗口下靠 `overflow: auto` 与
`min-height: 0` 保底。面板内部尽量用弹性布局，**不新增固定像素宽度**。

## Known Gaps

① ✅ **已修（R18 / `v0.71.0-优化5`）**：`ToolCard` 的 L1 展开改成 `.jj-collapse` 的
   `grid-template-rows 0fr↔1fr`（目标就是内容真实高度），内容始终挂载、收起态 `inert` + `aria-hidden`；
   代码注释里那句"不做高度动画"已删掉并换成新口径。
② 状态与折叠指示仍用字符（`◌ ✓ ✗ ⟳ ✎ ⚠`）与 emoji（`📁 📄`）—— R19 换成内联开源图标集
   （已核实：**Lucide，ISC 许可，1600+ SVG**；内联路径 + 文件头保留许可声明，零运行时依赖）。
   **折叠箭头已在 R18 先行改成"同元素旋转 180°"**（字符待 R19 换成 SVG）。
③ ✅ **已修（R18）**：按压反馈统一接入 `.app-tab` / `button.jj-btn` / `button.w2-btn*` / `.jj-tool-l0`
   （100ms、`scale(0.97)`），页签的悬停与选中也有了颜色过渡。
④ 本文件自 2026-10-12 起生效；此后界面改动应先改这里再改代码
   （改动方式：先加"待裁决"条目，落地后把置信度改成 `confirmed`）。
⑤ ✅ **已修（R41）**：**主样式表写死字号 53 处**全部改成令牌（**逐条证明值相等 ⇒ 渲染不变**），
   另新增三个"不是排版档位"的独立令牌（`--icon-md` / `--fs-code` / `--fs-micro`），
   并立**护栏第 33 条**钉住（写死 px = 红）。
⑥ ✅ **已修（R42）**：**主样式表 23 处写死颜色**全部换成令牌（**13 类等价替换 + 3 处刻意的视觉修正**：
   旧蓝 `rgba(47,111,235,·)` → 令牌主色 `#4c8dff` 派生）—— **同一个"主色"从此只有一个值**；
   另新增 10 个派生色令牌（都从既有令牌派生），并立**护栏第 34 条**钉住
   （写死颜色 = 红 **+ 整条阴影令牌不许被拼坏** + `var()` 兜底不许是颜色）。

## R41（UI 重构批 · 第一轮）：把「基线 vs 代码」的差距量出来

> **前提先否证**：题面是"重构 UI / 建设计系统"，**现扫推翻了这个前提** ——
> 令牌层（`packages/ui-tokens/src/tokens.ts` + 渲染层 `styles/motion.css`）**早就存在且完整**，
> 动效基线（W6 · 八条铁律）**也在**，配色对比度**默认与高对比上下文全部 AA 达标**。
> ⇒ 本轮**不是"从零建"**，而是**"把已有的那套真正接上主样式表"**。
> 那份调研稿（175 条外部参考）**已移出公开树**（R65 · T85 ⇒ 研究底稿只留私有目录）⇒ 私有副本在 `.workbuddy/research/RESEARCH-UI-DESIGN.md`；**它的结论已经内化进本文与令牌 / 动效基线** —— 仓里留下的是"我们为什么这样做"。

### 现扫数字（2026-10-21，判据形态可复现）

| 项 | 数字 | 判定 |
|---|---|---|
| 令牌层完整性 | 颜色 14 + 间距 7 + 字号 6 + 圆角 4 + 阴影 3 + 动效 4 档时长 + 3 条曲线 | ✅ **不是缺口** |
| 配色对比度（默认暗色） | 正文 15.12 / 次级 6.77 / 主色 5.15 / 成功 7.94 / 警告 7.53 / 危险 6.43 | ✅ 全部 AA |
| 配色对比度（`prefers-contrast: more`） | 次级提到 9.85，其余同上 | ✅ 全部 AA |
| 主样式表 `styles.css` 写死字号 | **53 处 / 9 个取值** | ❌ **缺口 ①（R41 已修）** |
| 主样式表写死颜色 | **23 处**（含 `rgb(47,111,235)` 这个**与令牌不同的旧蓝**） | ❌ **缺口 ②（未修，见下）** |
| 动效覆盖 | 按压/悬停过渡统一接在 **6 个可点家族**（R18 做的） | ✅ 不是缺口（**但覆盖面要继续扩**） |
| 焦点环 | 探针初判"16 个可点家族只覆盖 2 个" ⇒ **逐条核实后 14 个是探针误判**（都是 `<button>`，已被 `button:focus-visible` 覆盖）；**真缺口只有 `summary` 一类** | ✅ R41 已补（`a` / `summary` 两条） |

### R41 落地的两刀

1. **缺口 ①（字号）已修**：53 处写死 `font-size: Npx` 全部换成令牌，**且逐条证明值相等**
   （12px ↔ `--fs-small`、13px ↔ `--fs-body`、…、20px ↔ `--icon-md`）⇒ **渲染不变**；
   另把 5 处冗余兜底 `var(--fs-caption, 12px)` 收成 `var(--fs-caption)`。
   **新护栏第 33 条**钉住它（写死 px = 红），**注入自检第 42 处**。
2. **缺口 ②（颜色）本轮不修**：那 23 处里混着**要判断该用哪个**的
   （同一个"主色"有两个值：令牌 `#4c8dff` vs 样式表里的 `rgb(47,111,235)`）——
   换过去是**一次有意的视觉修正**，**不许混在"等价替换"这一刀里**。⇒ 排期见 Known Gaps ⑤。

### 两条新口径（R41）

- **字号只许走令牌**（`--fs-*` / `--icon-*`）或相对量（`inherit` / `em` / `rem` / `%`）——
  **不许写死 px**。理由：写死的字号就是"下一处漂移"，而**漂移在渲染结果里看不出来**
  （本轮那 53 处的字号全是 `12/13/11` 这种"看起来差不多"的值，混进去就没法再统一）。
- **焦点环不立"覆盖率"判据**（R41 的教训）：本轮为算覆盖率写了两版探针，
  **两版都判错**（第一版把 `button:focus-visible` 漏算，第二版把"容器里有 onClick"
  当成自绘可点元素，报出 90 处假阳性）⇒ **判据本身不可靠的指标不能立成锁**
  （恒绿的锁比没有锁更坏）。这条**改为"人核一次 + 补上真缺口"**（`summary` / `a` 已补）。

## R42（UI 重构批 · 第二轮）：写死颜色那一刀 + 动效覆盖扩面 + 清理

### 一、颜色那一刀（21 处声明 / 16 类 → **0 处写死**）

| 处理 | 数量 | 说明 |
|---|---|---|
| **等价替换**（值与令牌完全相同 ⇒ 渲染不变） | 13 类 | `#ff7875`→`--c-danger` · `#101010`→`--c-bg-input` · `#141414`→`--c-bg-layout` · `#1f1f1f`→`--c-bg-container` · `rgba(0,0,0,.55)`→`--c-scrim` · `rgba(0,0,0,.5)`→`--shadow-dialog` · `#fff`→`--c-text-strong`（新）· `#ff9c9c`→`--c-danger-strong`（新）· `rgba(207,34,46,.5)`→`--c-danger-border`（新）· `rgba(255,255,255,.08/.05)`→`--c-overlay-weak/faint`（新）· `rgb(0 0 0 / 35%)`→`--shadow-soft`（新）· `#2a2f36`→`--c-border-muted`（新） |
| **刻意的视觉修正**（这一次就是要改的那三处） | 3 处 | 旧蓝 `rgba(47,111,235, .16/.18/.65)` → **令牌主色 `#4c8dff` 派生**（`--c-primary-wash` / `--c-primary-wash-strong` / `--c-primary-outline`）—— 旧蓝是 R25 时期留下的**另一个"主色"**，与令牌并存 ⇒ 同一个品牌色有两个值。**这一刀是"归一"，不是"顺手改"** ⇒ 基线 YAML 里 `app-tab-active` 记的那条旧蓝也一并订正 |

**新增 10 个派生色令牌**（都从既有令牌派生，**不新增"气氛色"**）：
`--c-primary-wash` / `--c-primary-wash-strong` / `--c-primary-outline` / `--c-danger-strong` /
`--c-danger-border` / `--c-text-strong` / `--c-overlay-weak` / `--c-overlay-faint` /
`--c-border-muted` / `--shadow-soft`。

**新护栏第 34 条**（写死颜色 = 红 **+ 整条值令牌不许被拼坏** **+ `var()` 兜底不许是颜色**），
**能红校准两路都红**（写死 hex / 把 `--shadow-dialog` 拼进偏移量后面）—— 后者尤其重要：
**它是无效声明，渲染上看不出来**（`box-shadow` 整条失效只是少一层阴影）。

### 二、动效覆盖扩面：**按家族列清单是错的路**

现扫 16 个 `cursor: pointer` 家族，**9 个没被按压/悬停块提到**：`.w2-attach-remove` ·
`.jj-pack` · `.jj-git-link` · `.jj-palette-item` · `.jj-canvas-menu button` ·
`.jj-failure-notice__close`（**全是 `<button>`**）与两处 `<summary>`。
⇒ 补完这 9 个只会**再漏下一个** ⇒ 改成**原生可点标签一律有反馈**（`button` / `summary`），
自绘的可点元素仍用**具名选择器**（`.app-tab` / `.jj-tool-l0`）。
（`.w2-chip` / `.jj-perm-mode` / `.jj-perm-rule-main` / `.jj-mcp-tools label` 是**标签**，
包着 `input` / `radio` —— 焦点与反馈在**里面的原生控件**上，标签自己不该缩放。）

### 三、清理（这一轮真删了什么 · 有据可查）

- **`.trash/`：119 个批次 / 1672.9 MB → 0**。
  ① 脚本新增 `--purge-trash-all`（**与 `--purge-trash` 互斥**：前者只删超期，后者全删）；
  ② **顺带修掉脚本的一个真 bug**：回收站里躺着 e2e 工作区，里面的 `.git/objects/**`
  是 **git 故意设成只读**的对象文件 ⇒ `shutil.rmtree` 撞上就 `PermissionError` 中止
  （第一轮因此只删掉 41 个批次、剩下 78 个没动）⇒ 改成**先摘只读位再删**；
  ③ **脚本顺序的一个发现**：它是"**先搬后清**" ⇒ 跑一次会把新搬进去的东西留下 ⇒ **要跑第二遍**才彻底空。
- **工作区根的残留**：URL 编码残片（`%E4%BF%B1%E4%BD%B3agent/`，288 字节的半截文件）**已删**；
  **T69② 那只 110KB 探针 asar 删不掉** —— 被进程占用（`WinError 32`）且**占用者不可见**
  （无 electron 进程、工作区内无进程）⇒ 按本仓规矩**不杀归属不明的进程** ⇒ **留待所有者处置**。

### 四、下一步（R43 的第一件事）：**渲染契约**

**静态判据到头了**：本轮已经证明两件"看不见"的事 —— 写死颜色看不见；
**整条阴影令牌被拼坏也看不见**（`box-shadow` 整条失效只是少一层阴影）⇒ 必须在**真窗口里量**。

**规格（留给 R43 直接施工）**：e2e 新增一步，在**真窗口**里量六件事 ——
① 顶栏高度 > 0 且与令牌一致 ② 主标题字号取自 `--fs-*` ③ 命中区 ≥ 32×32
④ **按下按钮时 `transform` 真的变了**（按压反馈生效；这一条替掉 R41 那条"不敢立的覆盖率判据"）
⑤ 焦点环真的出现 ⑥ `prefers-reduced-motion` 生效（时长被压）。
**理由**：静态检查看不出"类名撞车"和"元素被压成 0 高"，只有**量真实渲染结果**才抓得住。

## R46（排查14 · T72 收口）：e2e「等完再做」那一族的**逐条判定**

> 这一节回答一个很小但很实的问题：**e2e 里那些"等一下再做"的地方，哪些真的在赌"上一个动作已经落到盘上"？**
> 答案不是"看着像的那些"，而是**逐处量出来的** —— 每一条都给出"依赖 / 不依赖持久态"的**依据**，
> 依据一律指到**具体那一行代码在等什么**（等的是回执、等的是计时器、等的是渲染、还是等的是轮询里的条件成立）。
> **"无害"不是一个结论，是一句"因为……所以……"**（交接文档 §11.5：不许拿"看着像"当判据）。

### 一、现扫口径（本轮现扫，不沿用上一轮的数字）

- **扫描对象**：`apps/desktop/scripts/e2e-ui.mjs`（主对象）· `apps/desktop/scripts/shoot-ui.mjs` ·
  `apps/desktop/scripts/verify-pack.mjs`（**另两个 UI 驱动脚本也扫了** ⇒ 它们**没有族成员**：
  命中的 6 处全在轮询 / 有界退避 / 假服务端里）。
- **族的定义**（三条件同时满足才算一处）：
  ① 等的方式是**固定等待**（`waitForTimeout(<字面量>)` / `setTimeout(fn, <字面量>)`）**或弹窗消失等待**（`state: 'detached'`）；
  ② 这一处**不在**轮询循环体、不在"等状态"的辅助函数体、不在假服务端、不在页面内 `evaluate` 里；
  ③ 它**之后紧跟**的是「读真值」或「下一个动作」。
- **现扫结果**：**21 处**（固定等待 12 + 弹窗消失 9）。
  **与 R39 记的「19 处」差 2 处** —— 差在**边界**（本轮把两处"渲染量测"与两处"负向观察窗"也计入族），
  而 **R39 那把尺子的探针没有留在仓库里**（`.tmp/` 随清理收走、`.evidence/` 里也没有）⇒ 无法逐条对照。
  ⇒ **以现扫的 21 处为准**（上一轮报的数也可能不是真的 —— 同一个坑本仓吃过一次：报"14 处"实为 27 处）。

### 二、逐条判定（21 处）

| # | 位置（行号 · 原文） | 等完之后做的事 / 它在等什么 | 判定依据 | 结论 |
|---|---|---|---|---|
| 1 | L1186 下载被拦后 `waitForTimeout(1_500)` | 拍系统「下载」目录，比对前后快照 | 等的是**观察窗**：给"万一没拦住的下载"落地的时间；后面判的是**负向**结论（有没有多出文件），不依赖"拦下"落到任何持久态（那件事的证据是界面那句「已拦下」，已用 `waitForText` 等过） | 无害（负向观察窗） |
| 2 | L2034 等 A 会话说完 `setTimeout(4_200)` | 读 B 会话的界面文本 | 等的是**假服务端 16 段流的时间预算**（16 × 220ms ≈ 3.5s）；后面读的是界面文本，不落盘。**这一处没有可等的回执** —— A 的事件被按会话筛掉了，界面上根本看不到"A 说完"；要条件等待只能等盘上，那会破坏"事件不落到 B 的界面"这条被测语义 ⇒ 属**产品侧改动**，本轮不动 | 无害，但**无回执可等** |
| 3 | L2087 等 A 的审批超时 `setTimeout(7_000)` | 塞进第二个请求 B | 等的是**审批超时那个计时器**（`JJ_PERMISSION_TIMEOUT_MS=10000`，A 已用掉 7s）；而"等 A 的过期说明"另有一段**有界轮询**（最多 8s）⇒ 早到晚到都自愈 | 无害（等的是计时器，状态等待另有有界轮询兜底） |
| 4 | L2462 切走 2s 再切回（流式中） | 切回后读界面 | 等的是**流推进**；切回来之后 `waitText3('A_16_', 15_000)` 才取真值 ⇒ 2s 早到晚到都不改结论 | 无害（状态等待由后面的有界轮询承担） |
| 5 | L2586 PDF 打开后 `setTimeout(800)` | 关掉出站监听，判出站数 | 与第 1 条同形：**负向观察窗**；判的是"出站数为 0"，不依赖任何持久态 | 无害（负向观察窗） |
| 6 | L3174 切走 4s（子进程 2.5s 定时器） | 切回后读界面 | 等的是**子进程自己的钟**；"输出发生在看不见的那一页"没法用条件等待表达（脚本注释里写明了）；切回来之后 `waitText3('R4_LATE', 12_000)` 取真值 | 无害（有意为之的定时等待） |
| 7 | **L3577 停用之后 `waitForTimeout(400)`** | **读盘上那本 `tasks.json`** | 读的是**磁盘真值**，而写盘由主进程 `setEnabled()` → `await writeAll(...)` 完成 ⇒ 400ms 是**赌**的；机器一忙就读到旧账 ⇒ **依赖持久态却没有等它** | **真隐患 · 本轮修**（见下） |
| 8 | L4106 翻页完成后 `waitForTimeout(300)` | 判「再读」按钮已消失 | 判的是**界面态**（按钮还在不在 DOM 里），不读盘 ⇒ 风险方向是**偶发红**（按钮没来得及消失），不是抢跑。彻底消掉它要产品侧给一句"已翻到底"的回执 ⇒ 属**产品侧改动** | 无害（界面态） |
| 9 | L4138 点 × 之后 `waitForTimeout(250)` | 判那条告警已消失 | 同上（界面态的负向断言） | 无害（界面态） |
| 10 | L4219 停用钩子后 `waitForTimeout(1_200)` | 判「钩子诊断」那一格不在 | 同上（界面态）；也是"给负向结论一个观察窗"，窗口给短了会偶发红 | 无害（界面态） |
| 11 | L4485 缩到 940px 后 `waitForTimeout(900)` | 量页签高度 | 等的是**渲染跟上**（窗口尺寸变了，布局要重排）；量的是**排版结果**，不依赖持久态 | 无害（渲染量测） |
| 12 | L4501 还原窗口后 `waitForTimeout(400)` | （后面不再读任何东西） | 等渲染还原；断言用的是缩窗前就量到的快照 ⇒ 严格说它后面没有"读真值"，列进来是为了口径完整 | 无害（渲染量测） |
| 13 | L1308 git 提交那一步 `state: 'detached'` | 读 git log | 消失之后**先等界面回执**（`waitForText('e2e：接上了 git')`）**再**读盘 ⇒ 区间里有"等状态的 await" | 合法（护栏第 32 条的形状） |
| 14 | L1403 exec 批准那处 `state: 'detached'` | 读盘看命令有没有执行 | 读盘之前有 `await first;` —— 等的是**那次操作自己的 promise**（命令跑完），比"弹窗消失"晚 | 合法（护栏第 32 条的形状 a） |
| 15 | L1458 拒绝外发之后 `state: 'detached'` | 读内存里的请求台账 `hits` | 台账是**本轮假服务端记在内存里**的，不落盘 ⇒ 不依赖持久态 | 无害（读的是内存台账） |
| 16 | L1481 允许外发之后 `state: 'detached'` | 收尾 | 后面**先**有 `waitHit(firstUrl)`（有界轮询，等"本机程序真的来取过一次"）⇒ 状态等待已经做了 | 合法 |
| 17 | L1491 拒绝第二个地址之后 `state: 'detached'` | 读内存里的请求台账 `hits` | 同第 15 条 | 无害（读的是内存台账） |
| 18 | L1669 非法输入那一步 `state: 'detached'` | 读工具返回值 `tooLong.ok` | 这一处的**目的就是"确认没弹窗"**（前提条件），不是"等弹窗消失之后去读真值"；读的是**调用本身的返回值**，与弹窗无关 | 不属本族 |
| 19 | L1705 长期记忆那一步 `state: 'detached'` | 读 `NOTES.md` | R39 已改成**先等界面回执「已写入长期记忆」再读盘** ⇒ 已经是 T71 修好的形状 | 合法（R39 已交付） |
| 20 | L3110 git push 批准那一步 `state: 'detached'` | 读远端提交数 | 消失之后**先等** `waitText3('已推送到', 25_000)` **再**读远端 ⇒ 区间里有"等状态的 await"（脚本注释写明"弹窗在决定送出去那一刻就关了，不等 push 跑完"） | 合法 |
| 21 | L3478 实时输出那一步 `state: 'detached'` | 读工具卡上那一格 | 后面是**有界轮询**（等 `EARLY` 尾行出现）⇒ 状态等待由轮询承担 | 合法 |

**归类合计**：真隐患 **1**（第 7 条）· 合法 **6**（13 · 14 · 16 · 19 · 20 · 21）·
无害 **13**（1 · 2 · 3 · 4 · 5 · 6 · 8 · 9 · 10 · 11 · 12 · 15 · 17）· 不属本族 **1**（18）。

### 三、第 7 条的改法与依据（本轮唯一的代码改动）

- **改前**：`点「停用」` → `await win3.waitForTimeout(400)` → **读盘上那本 `tasks.json`**。
- **改后**：`点「停用」` → **等界面上那句回执**「定时任务「E2E 定时补跑」已停用（账还在）」→ 再读盘。
- **为什么等它就够（因果链逐段可核）**：
  `schedule-store.ts` 的 `setEnabled()` → `await writeAll(...)`（**落盘完成**）
  → `ipc/schedule.ts` 的 `simple()` → `await store().list()`（**从盘上重读一遍**清单）
  → IPC 返回 `{ok:true, tasks}`（里面就是刚写完的那份）
  → `SchedulePanel.tsx` 的 `toggle()` → `handleMutationResult()` → `setNotice('…已停用（账还在）')` ← **等的就是这句**。
  ⇒ **这句回执出现时，盘上早已是新账** —— 它比那 400ms 睡得更晚，也比它更准。
- **为什么不用行上的那颗「已停用（账还在）」小标签当信号**：那颗标签与回执**文字相同**，
  但它由 `reload()` 之后重画的清单带出来（晚于回执）⇒ 用整句回执更准，且**只有回执这一句带任务名**，
  不会与别的任务、别的动作混淆。
- **断言一条没删、也没放宽**：下面两条读盘断言（`enabled === false` · 水位线不再往前走）**一字未动**；
  换掉的只是"凭什么认为写完了" —— 从"睡够 400ms 就算"换成"等它自己的回执"。
  超时上限 10s（与本文件其它回执等待同一档），**不是把 400ms 放宽成 10s 的断言**，是换一个判据。

### 四、这一族留给下一轮的**两条边界**（不假装全覆盖）

- **护栏第 32 条的覆盖面照实**：它只盯「清除 / 允许一次 / 记住这一点」三类按钮（R39 实测放宽会误报）。
  本轮修的第 7 条**不在**那三类里 ⇒ 这条护栏**管不到**它。
  **将来若要把「停用」也纳入**，得先按"能红校准"把判据改出来（否则就是一条恒绿的锁）。
- **三处"没有可等的回执"**（第 2 · 8 · 10 条）：要彻底消掉它们，得**先在产品侧做出那句回执**
  （例如"已翻到底"、"已停用钩子"），那是**产品侧改动**，不在 e2e 里硬凑。
  **本轮刻意不动** —— 在 e2e 里硬凑一个假信号，只会把假绿当真绿。

## R66（UI 重构批 · 第四轮）：主界面两栏化 —— 入口从顶栏搬进左栏

> **前提先否证**：题面是"多修主界面 UI"，但现扫推翻了"要重新发明一套设计"的默认预期 ——
> 令牌层、动效基线、配色对比度（R41–R43 立的）**都还在且完整**；
> 真正缺的是**布局**：当时的外壳是「**顶栏 16 个横向页签 + 单页主体**」——
> 没有左栏、没有落地屏、输入区不分区 ⇒ 这轮动的全是**结构**，不是配色。

### 布局基线（两栏）

| 区域 | 处置 | 依据（判据量的是渲染结果，不是 CSS 里的数） |
|---|---|---|
| 左栏（导航） | **160px 定死**（`flex: 0 0 160px`） | 入口 16 个 + 3 组标题；窄窗（940px）下不许塌（≥140px），且**不许随窗口抖**（宽窄两档差 ≤1px） |
| 主区 | `flex: 1` + `min-width: 0` | 窄窗下必须还剩 **≥600px**（不许被左栏挤没） |
| 顶栏 | 只留「**当前页 + 连接数**」 | "入口"属于侧边；"现在在看哪一页"才是顶栏的活 |

**为什么左栏要定死宽度**：宽度一旦跟着内容变，界面就会"忽然宽了/窄了" ——
那是**没人重新决策过**就发生的布局漂移 ⇒ 判据锁「宽窗与窄窗的左栏宽度差 ≤1px」。

### 分组导航

- 入口的**清单 / 标签 / 归属分组**是**同一件事的三个侧面** ⇒ 收进 `renderer/src/nav.ts` **一份**
  （`Tab` / `TAB_LABEL` / `NAV_GROUPS`）。拆两份就会「加了入口忘了分组」——
  那种漏**界面上看不出来**（只是少一个入口）⇒ 由 `nav-wiring.test.ts` 盯
  （判据直接 `import` 这份，不另抄一份清单）。
- 分组按**每天用它的频率**排，不按功能分类学：前两组是"干活要用的"，第三组是"偶尔调一次的"。

### 选中态：实心主色 + 反色字（不是淡底）

- **实测**：淡底（`--c-primary-wash`）与常态底（`--c-bg-container`）在这个深色调色板里只有 **1.1–1.3:1**
  ⇒ **界面上等于没高亮**（代码里"高亮"俱全，肉眼看不见）。
- **改法**：选中项 = **实心 `--primary` 底 + `--primary-ink` 字**
  ⇒ 选中项 vs 栏底 ≈ **5.0:1**（非文本对比度下限 3:1）、字 vs 底 ≈ **5.8:1**（AA 4.5）。
- **形态锁钉的是声明名**（`background: var(--primary)` / `color: var(--primary-ink)` 各一条）——
  第一版只判「块里出现过 `--primary`」**被变异证伪**：把 `background` 换成 `transparent` 之后
  `border-color: var(--primary)` 仍在 ⇒ 照绿 ⇒ **锁是假的** ⇒ 改成按声明名钉才拦住。

### 落地屏（空态不是落地屏）

- `.jj-state`（四态里的空态）回答的是「**怎么用**」；落地屏回答的是「**现在能做什么**」⇒ 另立一类。
- 展示字号**单开一档** `--fs-display`（28px）：18px 在落地屏上**不像入口，像页内小标题**；
  而它**不是正文的下一档**（正文阶梯仍是那六档）⇒ 混进正文阶梯会把正文密度拖慢。
- 快捷入口**点了只填进输入框，不自动发送** —— 自动发送等于替用户按下「开始改文件」的按钮。

### 输入区的分区

- 顶部一行：**当前连的是谁**（"这句话会发给谁"是发出去之前最该确认的一件事 ⇒ 离发送键要近）。
- 底部动作行：**左＝往里放东西 / 右＝把它发出去**。
- ⚠️ **没有改共享的 `.w2-actions`**（那个类全仓 20 多处）⇒ 另起只给输入区用的布局类。

### 一处连带修（列下限）

主区让出 160px ⇒ 外观页那 5 个字段（`T84` 定的同排）在最小窗口（940px）下会掉成 4+1
⇒ `.jj-grid` 列下限 160 → **120px**（**同一个共享类**，覆盖面不变）⇒ 仍然五个同排。
（R67：外观页改成**一行一条** ⇒ 这类表单网格**没人用了** ⇒ `.jj-grid` 与 `.jj-field-wide` 两条规则**一并删掉**
—— 留着就是死样式，下一个人会以为还有人在用。）

### 判据的换法（不是"改判据让它绿"）

R45 那条「顶栏页签换行」量的**对象已经不存在**（入口搬进左栏 ⇒ 竖排 ⇒ `rowCount` 恒为 1）
⇒ **恒绿的锁比没锁更坏** ⇒ 换成**同一类排版事实的新形态**：
左栏不塌 · 主区不被挤没 · 导航项不折行 · 标题不折行 · 左栏必须能纵向滚且不出横向滚动条 ·
导航只有一列 · 左栏宽度不许随窗口抖 · 选中态对比度**实量**（真窗口里的计算色）。

## R67（UI 重构批 · 第五轮）：设置中心 —— 整页覆盖 + 左导航分组 + 设置项一行一条

> **前提先否证**：题面是"把设置页也按参考做"，但现扫先量了**差距**：
> 本仓当时根本没有"设置中心"这个形态 —— 外观 / 权限 / 钩子 / 插件 / MCP 是**五个平级的左栏入口**
> （R66 之后左栏 16 项，其中 5 项是"配一次就不再看"的东西）⇒ **左栏越列越长、设置越埋越深**。
> ⇒ 这轮不是"改设置页的样子"，是**把设置从左栏里搬出来，单独成页**。

### 布局基线（三段式）

| 区域 | 形态 | 依据 |
|---|---|---|
| 左栏 | 保留、**11 项**（工作区 / 连接与工具两组）+ 底部**齿轮** | 设置类入口全部搬走 ⇒ 左栏只留"天天用的" |
| 设置中心左导航 | **220px**，3 组（偏好 / 规则与安全 / 扩展） | 分组口径与左栏**不同**：左栏按"用得多不多"排，设置按"**是什么东西**"排 |
| 设置中心正文 | 一条设置项 = **一行**：标题 + 一句说明 + 右侧控件 | 见下面「一行一条」 |

### 为什么设置中心**占主区**而不是**盖住整窗**

参考界面里两种都有：有的把整窗换成设置页（左导航 + 正文），有的保留一条窄图标条 + 设置导航。
⇒ 本仓取**占主区**：左栏**保持可见** ⇒ 用户在设置与应用之间来回切**不用先关窗口**，
而且**点左栏的任一入口会自动收起设置中心**（点入口 = "我要去那一页" ⇒ 设置页就该让位）。

### 设置项：为什么是**一行一条**

- **表单网格**（标签在上、控件在下、并排 4–5 个）是给"填参数"的；**设置**是给"调开关"的。
- 一行一条能让人**一眼扫过去**看到"哪一格在管什么"，而不是在一堆标签里找控件。
- ⇒ 三条纪律：① **说明不许省**（只有标题 = 用户看不出改了会怎样）
  ② **控件在右、标题在左**（控件顶满整行 = 又退回表单了）
  ③ 控件**天生**有宽度上限（不会拖成一条长空行）。

### 判据的换法（不是"改判据让它绿"）

- R64 那条「外观页那 5 个字段不许掉成 4+1」量的是**表单网格**的排版事实；
  改成一行一条后，那 5 个字段**不再并排** ⇒ "5 个字段排成几行"**不再存在**
  ⇒ 旧判据量的对象没了（而且它会**失焦**：网格类不存在 ⇒ 量到 0 行 ⇒ 恒绿）。
- ⇒ 换成**新形态的同一条纪律**：每一项**独占一行** · 控件在标题右侧 · 每项都有说明 · 控件命中区 ≥32×32。
- ⇒ 另立**接线锁**：五个设置类面板**只在设置中心里被挂载**（`App.tsx` 不许再直接 import 它们）
  ⇒ 防的是"同一个目的地出现**第二处门**"（改完设置回左栏发现还是旧的那页 ⇒ 以为没生效）。


## R68（UI 重构批 · 第六轮）：左栏瘦身 —— 只留工作区类，其余进「启动器」

> **前提先否证**：题面是"不要把所有东西都丢在左边的侧边栏"，但现扫先量了**差距**：
> R67 之后左栏是 **11 项**（工作区 7 / 连接与工具 4）⇒ 11 项里**有一半是"配一次就不再看"的东西**
> ⇒ 左栏越列越长、真正天天用的那几项被挤到下面 ⇒ 而且**设置中心盖整窗之后，
> 左栏是界面上唯一的导航面** ⇒ 它的长度直接决定"找东西要滚多远"。

### 布局基线

| 区域 | 形态 | 依据 |
|---|---|---|
| 左栏导航 | **1 组 7 项**（工作区：概览 / 对话 / 文件 / 文档 / Git / 画布 / 终端） | 分组口径 = **用得多不多**：工作区类留侧栏，低频的去别处 |
| 左栏底部 | **齿轮**（设置中心） | R67 立下：**同一个目的地只有一处门** |
| 左栏顶部 | **「搜索功能」按钮**（启动器的**鼠标入口**） | 见下面「启动器必须有鼠标入口」 |
| 启动器 | 一个模态：搜索框 + 按组排的清单（工作区 / 工具 / 设置） | 瞬时去某处 ⇒ 用完即走，不该占常驻的地方 |

### 移出侧栏 ≠ 藏起来（这条是本轮的**硬底线**）

本仓 **T83** 那条教训：「横向滚动把入口藏在右边 ⇒ 用户不知道还有 ⇒ **更糟**」。
⇒ 把入口从左栏移走，就必须**同时**给它们一条**一处搜得到**的路 —— 本轮是**启动器**。

- ⇒ 命令清单**由导航真源生成**（`nav.ts` → `features/launcher/commands.ts`）
  ⇒ **不存在两份清单**（R63 那次"同两份队列被数出两个数"的同款坑）。
- ⇒ 判据：每个入口**恰好**出现在「左栏分组 ∪ 仅启动器项」里（一个不许漏、一个不许重）。

### 启动器**必须有鼠标入口**（不是只有快捷键）

低频入口离开左栏之后**只剩启动器一条路** ⇒ 启动器若**只有 Ctrl/Cmd+Shift+P**，
对不用键盘的人就是**藏起来** ⇒ 正是 T83 那条教训的另一种形状。
⇒ 左栏顶上给一个**看得见、点得到**的按钮（形状锁：`min-height: 32px` + 显式 `line-height`）。

- 快捷键用 **Ctrl/Cmd+Shift+P**（同类 IDE 的命令面板惯例）——
  **不用 Ctrl+K**：画布的命令面板已经占着它（节点命令，与这个不是一回事）⇒ 两个面板撞键。

### 设置中心：**盖住整窗**（R67 的"占主区"改掉了）

R67 取的是「设置中心占主区、左栏保持可见」⇒ 结果是**界面上同时有两根左栏**
（应用那根 160px + 设置中心自己那根 220px）⇒ 那正是所有者那句抱怨的另一半。
⇒ R68 改成**盖住整窗**：整个**外壳**（左栏 + 主区）一起被藏起来
⇒ 任何时候**只剩一根左栏**。
⚠️ 正文**只是被藏，不许卸载**（T22 报备 §二「对话页常驻」：会话、连接选择、**在飞的流**都留着）。

### 判据的搬法（覆盖没丢）

- R66 那条「左栏**至少两个分组**」——左栏瘦到 1 组之后，"分组这件事"搬到了**启动器**
  （工作区 / 工具 / 设置）⇒ 那条判据**跟着搬家**，不是被删掉
  ⇒ **真正在分的那份清单**现在被盯住。