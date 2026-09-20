---
topic: 2026 动效与流畅性：可执行的铁律与反模式
date: 2026-09-20
phase: W6
sources: 见文末（2026-09-20 联网核实）
---

# 014 · 动效铁律：为什么「加了动效反而更卡」

> 核实时间 **2026-09-20**。以下规则已落进 `styles/motion.css` 与 `packages/ui-tokens`，
> 不是"参考建议"，是本项目的**代码约定**。

## 一、性能铁律

1. **只动 `transform` 与 `opacity`。**
   这两个属性由合成器线程处理，不触发样式计算/布局/重绘。
   动 `width`/`height`/`top`/`left`/`margin`/`padding`/`border`/`font-size` 会触发布局重算 ——
   实测：复杂过渡可把单帧绘制从 5ms 推到 30ms，直接冲破 60fps 的 16.7ms 预算。
2. **`will-change` 要节制。** 现代浏览器会自动提升图层；满页声明只会白耗显存。
3. **避免布局抖动**：不要"读一个写一个"。批量读 → 批量写；高频事件（scroll/resize）用 rAF 合并、防抖节流。
4. **入场动画不要改变元素的盒模型**——这是 CLS（累积布局偏移）的隐蔽来源。动画前先给最终尺寸。

## 二、时长与缓动

| 场景 | 时长 |
|------|------|
| 微交互（按压、hover 反馈） | 100–200ms |
| 状态过渡（展开、淡入） | 200–500ms（本项目取 160–320ms） |
| 页面转场 | 300–500ms |
| **功能动效硬上限** | **1s（超过用户会感到"卡"）** |

缓动：**入场 `ease-out`**（快起慢停）、**离场 `ease-in`**、**屏内移动 `ease-in-out`**、
**`linear` 只用于持续型**（进度条、旋转加载器）。

## 三、动效要有"目的"（5 类模式）

transition（转场）· supplement（补充说明）· feedback（反馈）· demonstration（演示）· decoration（装饰）。
**装饰性动效最容易被滥用**——没有目的就删掉。反模式清单：
- 为了动而动；**多个元素同时动画**（视觉混乱）；
- 超过 300ms 的"精致"动效（被读成延迟）；
- 无限循环动画不给暂停控制。

## 四、可访问性（强制，非可选）

- **必须实现 `prefers-reduced-motion`**：WCAG 2.1 **SC 2.2.2**（可暂停/停止/隐藏）与 **SC 2.3.3**
  （交互动效可关闭）。约 **10% 用户**受过度动效困扰，**18% 用户**开启了辅助功能偏好。
- 降级策略：**降低或替换非必要动效，而不是"全删"**。本项目的做法是
  ——把所有时长压到 0.01ms（保留状态变化的可见结果），并把**位移类动效改为纯淡入**
  （避免前庭不适）。这与"直接删掉动画"有本质区别：用户仍能看到展开/切换的结果。
- **绝不允许闪烁 >3 次/秒**（可诱发癫痫）——这是红线，不是偏好。
- 另有两个容易被忽略的偏好：`prefers-reduced-transparency`（毛玻璃要退回不透明）、
  `prefers-contrast: more`（加强边框与次要文字）。

## 五、滚动驱动动画：2026 年仍要写降级

CSS `animation-timeline: scroll()/view()` 很好用，但**仍未达 Baseline**（跨浏览器支持不全）。
正确做法是**渐进增强**：默认交付"最终可读状态"，再用 `@supports (animation-timeline: view())`
叠加动效。**页面绝不能依赖动效才可读**。

## 六、选型优先级（2026）

1. **CSS 动画优先**（简单交互、hover、淡入、两态切换）——浏览器已高度优化，且原生支持 reduced-motion；
2. **Lottie**（复杂品牌动效）：注意体积（单文件 <50KB）且**必须懒加载**；
3. **Rive**（有状态/可交互动效）；
4. **GSAP 等 JS 库**：仅在 CSS 表达不了时用，且要为首屏让路（等 LCP 之后再加载）。

## 来源（2026-09-20 检索）

- 动效最佳实践（GPU 属性、布局抖动、`will-change`、reduced-motion、反模式）：
  https://smoothui.dev/docs/guides/animation-best-practices
- UI 动效与性能预算（16.7ms、绘制代价、2026 选型层级、WCAG 2.2）：
  https://softwareeggs.com/how-ui-animation-improves-user-experience-in-apps-and-software
- 动效审查清单（时长/缓动表、五类模式、性能与无障碍扫描）：
  https://lobehub.com/skills/zlstas-skills-animation-at-work
- 2026 网站动效实践（CSS 优先、CLS 与入场动画、`prefers-reduced-motion` 四行实现）：
  https://logoswebdesigns.com/blog/website-animation-best-practices-2026
- 掉帧原理与分步优化（改属性 → will-change → 高频事件合并）：
  https://www.renrendaima.com/wap/article/2727.html
