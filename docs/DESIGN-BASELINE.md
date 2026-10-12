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
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
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
    backgroundColor: "rgba(47, 111, 235, 0.16)"
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

① `ToolCard` 的 L1 展开目前**明确不做高度动画**（实现注释与本节冲突）—— 本轮 R18 修；
② 状态与折叠指示用的是字符（`◌ ✓ ✗ › ⌄ ⟳ ✎ ⚠`）与 emoji（`📁 📄`）—— 本轮 R19 换成内联开源图标集
   （已核实：**Lucide，ISC 许可，1600+ SVG**；内联路径 + 文件头保留许可声明，零运行时依赖）；
③ `.app-tab` 无过渡；`.jj-pressable` 只有 6 个文件在用 —— R18 统一接入；
④ 本文件是**首版**，捕获自 2026-10-12 的实现；此后界面改动应先改这里再改代码
   （改动方式：先加"待裁决"条目，落地后把置信度改成 `confirmed`）。
