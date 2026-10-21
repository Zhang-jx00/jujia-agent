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
外壳 = 顶栏（页签）+ 可滚动主体；面板内容统一 `padding: {spacing.lg}` 起，
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

- `{components.app-tab}` / `{components.app-tab-active}`：顶栏页签。**现状缺口**：无过渡，
  悬停与选中是瞬时的 → 本轮补 `--motion-duration-fast` 的颜色/边框过渡。
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
> 调研稿（196 条外部参考）见 `docs/RESEARCH-UI-DESIGN.md` —— 它用来**对照方向**，不照抄。

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
