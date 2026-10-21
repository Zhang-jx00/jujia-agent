# 前端设计与动效方向调研清单（参考手册）

> 面向：**本地优先 Electron 桌面 AI 智能体**（React 18 + TypeScript + Electron + Vite，中文界面，已有一套设计令牌）
> 调研日期：2026-10-21
> 收录口径：每条都必须来自实际检索到的公开页面，链接为来源页；无法确证的条目标「（待核）」。

> **它在 R41 里的角色**：这不是"要照抄的设计系统"，而是**用来验证我们自己的口径方向**的参考手册。
> 本轮的做法是**先现扫本仓的真缺口**（见 `docs/DESIGN-BASELINE.md` 的 R41 小节），再用这份清单**对照**：
> 哪些做法我们已经在做、哪些是我们漏的、哪些**不适合桌面端或中文界面**。
> **收录口径**：每条都来自实际检索到的公开页面，链接为来源页；拿不准的标「（待核）」；
> **抽验**：随机抽 6 条做 HEAD 请求，全部 200（2026-10-21）。
> **它不改任何判定**：要落地的东西一律回到 `docs/DESIGN-BASELINE.md` 与机器判据（护栏）。

## 说明

- **可借鉴点**：只写「这个方案里哪个具体做法值得抄」，不写主观评价。
- **适用场景**：该做法在什么情况下适用。
- 本文件采用**分批增量落盘**：每批检索完成立即追加，网络失败跳过并标注「（待核）」。

---

### ① 设计系统与设计令牌

| 名称 | 类别 | 链接 | 可借鉴点 | 适用场景 |
| --- | --- | --- | --- | --- |
| Style Dictionary | 设计系统与设计令牌 | https://github.com/jsfix-ci/style-dictionary | 用一个 JSON 源文件 + build 配置同时产出 CSS 变量 / JS / TS / iOS / Android 多目标产物，令牌只在源文件改一次 | 需要把一份令牌编译成多种语言产物，避免手写多份同步 |
| Style Dictionary Demo（W3C DTCG） | 设计系统与设计令牌 | https://github.com/samdods/style-dictionary-demo | 直接用 DTCG 规范 JSON 作输入、用 style-dictionary 转 CSS，演示最小可用管线 | 想低成本验证「令牌→CSS 变量」这条路是否可行 |
| W3C DTCG 样例工程 | 设计系统与设计令牌 | https://github.com/mryechkin/style-dictionary-tokens | 展示 DTCG 格式令牌在 style-dictionary 中的完整用法与目录组织 | 需要参考 DTCG 令牌文件的字段写法（$value / $type） |
| W3C Design Tokens 社区组规范 | 设计系统与设计令牌 | https://designtokens.org | 规范本身定义的令牌分组/引用/别名机制，是「基础层引用语义层」的形式化依据 | 定义令牌分层与别名引用时的标准依据 |
| api3dao/design-tokens | 设计系统与设计令牌 | https://github.com/api3dao/design-tokens | Figma 提交 → CI 自动抽令牌 → 自动转 CSS 变量并二次提交，仓库只做分发不接受直接改 | 已有 Figma 源、需要设计侧改动自动落到代码时 |
| open-formulieren/design-tokens | 设计系统与设计令牌 | http://github.com/open-formulieren/design-tokens | 用 style-dictionary 合并多个令牌文件并产出 ES6 / CSS vars / SASS 等 target；明确给出「<prefix>.<component>.<modifier>.<UIState>」命名约定 | 命名层级需要统一约定、否则合并时 token 会被覆盖时 |
| Sage design-tokens | 设计系统与设计令牌 | https://github.com/Sage/design-tokens | 同一套令牌发布 CSS / SCSS / CommonJS / ES6 四种格式并附 TS 类型声明 | 需要在 CSS 与 TS 两端都能消费同一份令牌 |
| B.C. Design System design tokens | 设计系统与设计令牌 | https://www2.gov.bc.ca/gov/content/digital/design-system/foundations/design-tokens/developers | 每个令牌提供「带 BCDS 前缀」与「不带前缀」两套变量名以降低与既有样式变量撞名的风险；按 Surface / Support / Layout / Typography / Icons 分类 | 已有大量历史 CSS 变量、担心命名冲突时 |
| Open Library Design Token Guide | 设计系统与设计令牌 | https://github.com/internetarchive/openlibrary/wiki/design-tokens | 明确两层架构：Tier 1 primitives（--blue-500）与 Tier 2 semantic（--color-link: var(--blue-600)），并规定「组件里只用语义层、缺语义层就新建」 | 治理「同一颜色被写成三种写法」的漂移问题 |
| GobiRajeshKumar/Design-Tokens | 设计系统与设计令牌 | https://github.com/GobiRajeshKumar/Design-Tokens | 用 `global.json`（间距/尺寸/圆角/动效）+ 每品牌一份 json（字体 + 明暗配色）分层，tag 打版本让消费方按版本重生成 | 多品牌/多主题的令牌仓库组织方式 |
| erclx/canon 设计域 | 设计系统与设计令牌 | https://github.com/erclx/canon/blob/main/canon/context/design/overview.md | 把令牌做成模块（src/design/tokens.ts）而不是可手改的表格，由渲染器生成文档；用 design gate 阶段断言「文档与模块不漂移」 | 令牌与文档同源、需要自动防漂移时 |
| design-system skill（五层模型） | 设计系统与设计令牌 | https://github.com/rampstackco/claude-skills/blob/482c9bf74697fc1e311bd4dca5ce301f046c4b76/skills/design-system/SKILL.md | 给出 Foundations→Elements→Components→Patterns→Governance 五层与「两层令牌（base + semantic）」的落法，并列出 token explosion 等失败模式 | 给已有系统做审计、规划分层补齐顺序 |
| Figma → GitHub 令牌管线实践 | 设计系统与设计令牌 | https://dev.to/alexandersstudi/building-a-figma-to-github-token-pipeline-that-actually-works-3o0o | 描述 Figma 变更触发仓库提交、CSS 变量再生成的完整链路与踩坑 | 需要把设计侧改动自动同步进代码库时 |
| W3C 标准下的令牌文章 | 设计系统与设计令牌 | https://malakavenu.com/articles/design-tokens-w3c-2026 | 描述「Tokens Studio 推 Git → CI 里跑 Style Dictionary 4 → 输出各平台产物」的具体分工 | 规划令牌自动化流水线时的链路参考 |
| design-tokens W3C skill | 设计系统与设计令牌 | https://github.com/jhamidun/claude-code-config-pack/blob/main/plugins/design-system/skills/design-tokens-w3c/SKILL.md | 给出 CSS ↔ DTCG JSON 互转脚本与 style-dictionary config 的具体配置片段 | 需要在既有 CSS 变量与规范 JSON 之间做双向转换 |
| Style Dictionary v3.0 说明 | 设计系统与设计令牌 | https://github.com/amzn/style-dictionary/blob/a806648364c614531784d62fcb4d1a99433e3bdf/docs/version_3.md | 记录 v3 的破坏性变更清单（命名/构建行为），升级前可据此判断影响面 | 升级令牌构建工具前评估兼容性 |

### ② 排版与字体（含中文排版）

| 名称 | 类别 | 链接 | 可借鉴点 | 适用场景 |
| --- | --- | --- | --- | --- |
| Lucky.Graphics — Building a Typography Scale System | 排版与字体 | https://lucky.graphics/learn/typography-scale-system-guide | 用「模数比例 + 基准字号 → clamp() 流体字号 → 行高与行长规则 → 导出 CSS 令牌」的顺序搭字号体系 | 需要把字号阶梯固化成可维护的 CSS 变量时 |
| UI/UX Atlas — Modular Type Scale | 排版与字体 | https://www.uiuxatlas.com/lessons/typography/modular-type-scale | 提供可交互切换比例的模数比例计算器（Minor Third 等），并把层级直接映射到设计令牌 | 选定模数比例时快速对比不同比值的视觉差 |
| UXNext — How to Build a Modular Typography Scale | 排版与字体 | https://www.uxnext.com/blog/modular-typography-scale | 步骤化讲解模数比例推导，并给出导出为 CSS 变量或 Tailwind 配置的写法 | 团队需要统一按同一套数学推导字号时 |
| type-scale skill（Thrillmade） | 排版与字体 | https://lobehub.com/skills/thrillmade-agent-skills-type-scale | 预设一组比例（1.067 → 1.618）并要求所有字号从「单一比例 + 基准字号」推导 | 禁止随手写字号、需要可校验的推导规则时 |
| FontFYI — Modular Scale 术语条目 | 排版与字体 | http://fontfyi.com/glossary/modular-scale | 给出 1.25 / 1.333 / 1.618 三种常用比例的数值对照 | 查比例数值含义、做令牌评审时的依据 |
| Art of Styleframe — Type Scale Systems | 排版与字体 | https://artofstyleframe.com/blog/type-scale-systems-modular-scale | 讲产品型 UI 场景下用 1.25 Major Third 模数比例替换「拍脑袋」字号并转成令牌 | 为桌面端产品 UI 定字号阶梯时 |
| Typography System Reference | 排版与字体 | https://huggingface.co/spaces/destinyebuka/AIDA/blob/c8f8665c1c15a51c57561b778513e5e6def387ac/.agent/skills/frontend-design/typography-system.md | 强调「先学会判断再记数值」：不锁死字体名与尺寸，用模数比例 + 决策原则推导 | 需要把排版决策写成规则而非硬编码清单时 |
| EULE Institute — Types of Fonts and Typefaces | 排版与字体 | https://euleinstitute.com/en/blog/types-of-fonts-typefaces-ux | 用系统字体栈（SF Pro → Segoe UI → Roboto → Helvetica Neue）零下载即得原生观感与性能 | 桌面应用不想打包字体文件、或要跟随用户系统字重时 |
| Refactoring UI 设计系统 | 排版与字体 | https://lobehub.com/en/skills/jeremylongshore-claude-code-plugins-plus-skills-refactoring-ui | 固定一条线性/近线性间距阶梯（4/8/16/24/32/48/64）并要求「组间间距 > 组内间距」 | 治理当前样式表里 50+ 处写死字号时 |
| 贵设计 — 網頁設計字體大小怎麼抓 | 排版与字体 | https://web-design.vip/web-design-font-size.html | 以 16px 正文为基准、标题按层级 20–36px 展开、配合约 1.5 倍行高 | 需要一组可复用的中文界面字号参考值时 |
| GUI Tools — 字型排版完整指南 | 排版与字体 | https://gui.tw/zh-Hant/knowledge/typography-guide | 指出全形标点占一个中文字宽、混用全形与半形标点是常见错误，并给出字数与字符计算口径 | 中文界面里标点与数字混排的细节修正 |
| 后浪教育 — 中英文字体怎么搭配（字号字重与基线） | 排版与字体 | https://houlangxuexi.com/industry_news/207.html | 引用 GB/T 15834—2011《标点符号用法》作为中英混排时标点全角/半角的标准依据 | 需要给中文界面写排版规范并注明依据时 |
| Typotheque — CJK 排版原则 | 排版与字体 | https://www.typotheque.com/articles/typesetting-cjk-text | 系统对比拉丁与 CJK 在行高、对齐、避头尾上的差异要求 | 论证「不能照搬西文排版参数」的依据 |
| Script Walker — 繁中排版规格 | 排版与字体 | https://scriptwalker.app/blog/traditional-chinese-web-typography-spec-2026 | 给出可验收的具体数值：行高 1.75、中西混排 0.25em、标题字距 0.05em 内，并用 `text-spacing-trim`、`line-break: strict`、`word-break: normal` 落地避头尾 | 把中文排版参数写成「可验收单」时 |
| 庞果设计 — 中文网站排版怎么调 | 排版与字体 | https://www.pongo.com.tw/chinese-typography-priority | 指出常见预设行高是按拉丁字母调的、普遍低于中文建议的 1.5–1.8 倍，行高应优先于字距先调 | 中文正文行高偏挤、需要按证据排序调整项时 |
| 百度开发者中心 —《中文排版需求》十年技术演进 | 排版与字体 | https://developer.baidu.com/article/detail.html?id=3681172 | 梳理《中文排版需求》标准核心规范与 Type is Beautiful 的工程落地 | 需要引用官方标准条文支撑排版决策时 |
| 百度智能云 — 重识中文之美 | 排版与字体 | https://cloud.baidu.com/article/3981250 | 给出 `unicode-range: U+4E00-9FFF` 限定中文字形范围的做法，以及行高与字距的量化标准 | 中文字体子集化、想按字符区间分包时 |
| 墨刀 — UI 设计字体怎么选（字号、行高与中文排版） | 排版与字体 | https://modao.cc/ad/blog/ui-design-font-guide.html | 提醒数据密集界面要检查 0/O、1/l、金额小数点与负号的字形可辨识度 | 表格、金额、验证码类界面的字形体检 |
| CSDN — 思源宋体字体设计指南 | 排版与字体 | https://m.blog.csdn.net/gitblog_00960/article/details/151857326 | 给出 7 种字重到 UI 字号的映射规则（正文 14–16px 用 Regular，标题 600→700→900 递进） | 需要把「字重」也纳入字号阶梯一起治理时 |
| 后浪教育 — 段落排版（对齐、缩进与避头尾） | 排版与字体 | https://houlangxuexi.com/industry_news/127.html | 说明行首不得出现逗号句号等标点，即「避头尾」是中文排版最易忽略也最显专业的部分 | 中文对话气泡/正文排版的标点换行处理 |
| idctop — HTML5 中文字排版与字体设置 | 排版与字体 | https://idctop.com/article/359472.html | 给出 `text-wrap` 属性 + 中文行高 1.5–1.8 倍 + 移动端字体栈的组合做法 | 渲染层已用 CSS 变量时可直接抄的属性写法 |

### ③ 布局与栅格 / 间距阶梯

| 名称 | 类别 | 链接 | 可借鉴点 | 适用场景 |
| --- | --- | --- | --- | --- |
| Greenhouse Design System — Grids | 布局与栅格 | https://greenhousedl.supernova-docs.io/latest/foundations/layout/grids-ExO3hnh4 | 采用 4px baseline grid（所有间距被 4 或 2 整除），margin 与 gutter 固定取 8/16/24/40dp 且允许不等；明确「不要把每个组件都对齐到栅格」 | 桌面应用窗口尺寸可变、需要在多分辨率下保持节奏时 |
| Gutenberg — Baseline Grid & Vertical Rhythm | 布局与栅格 | https://deepwiki.com/matejlatin/Gutenberg/4.1-baseline-grid-and-vertical-rhythm | 用 `*` 统一选择器把 line-height 与 margin-bottom 一次性设成同一个 leading 值；并提供 CSS 渐变做的网格覆盖层做可视化校验 | 想要「垂直节奏」但缺少可验证手段时 |
| Nordea Design System — Spacing and layout | 布局与栅格 | https://nordea.design/?p=4095 | 8px 栅格框架 + 所有增量均为 4px 倍数，并给出 mobile/web 两套 spacing token 对照表 | 需要一张明确的间距 token 表（表驱动）时 |
| Grid and Layout Theory | 布局与栅格 | https://github.com/pantheon-org/tekhne/blob/80305510091af462688a10a515238e2f01f13870/skills/development/front-end/web-reference-sheet-generator/references/grid-and-layout-theory.md | 给出各断点的列数/gutter 对照（移动 4 列 16px、平板 8 列 24px、桌面 12 列 24–32px）并解释「12 列能整除 1/2/3/4/6/12」的成因 | 设计端与前端对齐栅格参数时 |
| Layout and Spacing Reference | 布局与栅格 | https://github.com/ratacat/claude-skills/tree/main/skills/web-interface-design/references/layout-and-spacing.md | 明确指出「baseline grid 只统一高度、和谐来自对比与重复」这一常见误解；并提出内容尺度与模块尺度两套独立阶梯 | 避免把「上了栅格就一定好看」当成结论时 |
| Spacing and Iconography Reference | 布局与栅格 | https://github.com/firstsun-dev/skills/blob/main/plugins/frontend-product-design/skills/visual-design-foundations/references/spacing-iconography.md | 8 点栅格用 `calc(var(--space-unit) * N)` 生成整条阶梯，再叠一层语义间距 token（inline/stack/inset/section/page） | 已有 4px 阶梯但缺「语义层」时 |
| 间距与节奏硬规则（Jane-xiaoer） | 布局与栅格 | https://github.com/Jane-xiaoer/claude-design-principles/blob/main/spacing-rhythm.md | 给出桌面端 hit target 最小 32×32px / 推荐 40×40px（移动端 44/48px）——桌面端不适用移动端标准 | Electron 桌面端的可点击区域尺寸标准 |
| Spacing and rhythm — hard rules（ai-maestro-webdesign） | 布局与栅格 | https://github.com/Emasoft/ai-maestro-webdesign/blob/main/skills/amw-design-principles/spacing-rhythm.md | 明确「中英混排正文一律左对齐、不要两端对齐」，理由是两种文字字宽差异会产生白河 | 中文界面正文对齐方式的硬规则 |
| Base（响应式栅格框架） | 布局与栅格 | https://stevenle.github.io/base | 12 列 flex 栅格 + 移动优先断点后缀（`-at-medium`）+ `align-space-between` 分配剩余空间 | 需要一个极轻量的栅格类而不引第三方框架时 |
| Grid System 术语条目（peasygen） | 布局与栅格 | https://peasygen.com/glossary/grid-system | 给出 `grid-template-columns: repeat(auto-fill, minmax(250px, 1fr))` 这类自适应列写法与 8px baseline 的出处说明 | 面板区卡片流的自适应列实现 |
| 中文网页布局设计（考点稿） | 布局与栅格 | http://www.kaozhigao.com/show-56233.html | 指出中文文本密度高，gutter 需比纯拉丁布局留得更大（给出移动端 gutter 下限建议） | 中文富文本面板的列间距取值 |

### ④ 动效与动画（缓动 / spring）

| 名称 | 类别 | 链接 | 可借鉴点 | 适用场景 |
| --- | --- | --- | --- | --- |
| gre/bezier-easing | 动效与动画 | https://github.com/gre/bezier-easing | 用二分搜索 + 牛顿迭代 + 采样三条启发式快速求解贝塞尔曲线，语义与 CSS `transition-timing-function` 完全一致，x 超出 [0,1] 时钳制 | 渲染层用纯 CSS 曲线，但需要在 JS 侧复刻同一条曲线时 |
| bezier-easing-editor | 动效与动画 | https://github.com/gre/bezier-easing-editor/ | 提供拖拽控制点即可生成对应 `cubic-bezier(...)` 的可视化编辑器 | 设计侧调曲线、避免手写四个控制点出错时 |
| GitHub topic: easing | 动效与动画 | https://github.com/topics/easing?l=typescript&o=desc&s=forks | 汇总 easing 主题下的 38 个仓库，可作选型索引（下表其余各条的直接链接均由此页取得，并已逐条用 GitHub API 核实） | 需要横向比较现成缓动方案时 |
| robertpenner/fast-bezier-easing | 动效与动画 | https://github.com/robertpenner/fast-bezier-easing | 用解析解法（analytical solution）替代迭代搜索，API 与 bezier-easing 相同但性能更高（GitHub API 核实：MIT 许可，2026-07 建仓，topics 含 performance） | 需要在高频动画中逐帧求曲线时 |
| okikio/spring-easing | 动效与动画 | https://github.com/okikio/spring-easing | 独立的 spring 缓动包，可与 gsap / animejs / framer-motion / motion-one / WAAPI 混用，不绑定任何动画引擎；**并能用 CSS `linear()` 缓动函数复现 spring**（需 Chrome/Edge 113+、Firefox 112+，Safari 暂不支持） | 想要 spring 手感但不想引入整套动效库时 |
| tweenjs/tween.js | 动效与动画 | https://github.com/tweenjs/tween.js | 经典时间轴 tween 引擎，内置 Robert Penner 缓动方程集；仓库自带**中文用户指南** `docs/user_guide_zh-CN.md` | 需要时间轴式编排（脚本化）时 |
| creasty/animation-essential | 动效与动画 | https://github.com/creasty/animation-essential | 极小体积的动画库，同时提供 spring 与 tween 两种模型（GitHub API 核实：topics 含 spring / tween / bezier / interpolation） | 想要小体积、零框架耦合的动画内核时 |
| chfoidl/animus | 动效与动画 | https://github.com/chfoidl/animus | TypeScript 写的轻量动画与缓动库，带视差支持（GitHub API 核实：MIT 许可，topics 含 parallax） | 需要轻量自研动效内核时的参考实现 |
| gvaste/easing-lab | 动效与动画 | https://github.com/topics/easing?l=typescript&o=desc&s=forks | 把 CSS、GSAP、Motion、Anime.js、Three.js 的缓动放进同一个可视化工作台对比 —— **（待核）**：其直接地址 `github.com/gvaste/easing-lab` 经 GitHub API 查询返回 **404**，仓库可能已改名或删除 | 评审时需要横向比较不同引擎的同一条曲线时 |
| CSS `linear()` 缓动函数（Linear Easing Generator） | 动效与动画 | https://linear-easing-generator.netlify.app/ | 用 CSS `linear()` 缓动函数把采样出的关键帧直接写进样式表，从而**在纯 CSS 里复现 spring 手感**（okikio/spring-easing 的 `CSSSpringEasing` 即用此法）；要求 Chrome/Edge 113+、Firefox 112+，Safari 暂不支持 | 想加 spring 手感但不加任何 JS 依赖时——本仓 Electron 44.4.2 自带的 Chromium 满足版本条件 |
| Material Design — Easing and duration | 动效与动画 | https://material.io/styles/motion/easing-and-duration | 官方同时保留 easing/duration 体系并标注「Expressive 更新已改用 spring 物理系统，产品应迁移」——说明旧曲线体系是稳定的回退方案 | 想要一套被广泛验证过的曲线命名与时长档位时 |
| Material Design 1 — Duration & easing | 动效与动画 | https://m1.material.io/motion/duration-easing.html | 经典四条曲线（standard / deceleration / acceleration / sharp）与按场景分的时长表 | 需要 2015–2020 经典方案（不是新库）时的权威出处 |
| Material Design 3 — Easing and duration tokens | 动效与动画 | https://m3.material.io/styles/motion/easing-and-duration/tokens-specs | 把曲线与时长做成可查的 token 规格表 | 需要把曲线值固化成设计令牌时 |
| Motion Principles（MD3 emphasized 曲线） | 动效与动画 | https://www.claudepluginhub.com/skills/intense-visions-harness-claude/design-motion-principles | 给出 MD3 emphasized 的具体数值：减速 `cubic-bezier(0.2, 0.0, 0, 1.0)`、加速 `cubic-bezier(0.3, 0.0, 0.8, 0.15)`，并规定「元素在静止位置之间移动」才用 emphasized | 想用 MD3 曲线但不想抄整套 Material 体系时 |
| motion-design skill（属性选择表） | 动效与动画 | https://mdskill.dev/LottieFiles/motion-design-skill/motion-design | 用「效果目标 → 主属性/次属性」表格选属性：入场/离场用 position + opacity + scale，强调用 scale，背景装饰用 transform | 缺少「该动哪个属性」的判断依据时 |
| react-spring（pmndrs） | 动效与动画 | https://github.com/pmndrs/react-spring | 动画循环跑在 React 渲染周期之外（共享 FrameLoop），弹簧值通过 ref 直接写 DOM，不触发重渲染；提供 mass / tension / friction 与 default/gentle/stiff/slow 预设 | 需要手势、拖拽等可打断交互时 |
| react-spring 官方文档 | 动效与动画 | https://www.react-spring.dev/ | 官方文档站，给出 `useSpring` / `useSprings` / `useTrail` / `useTransition` / `useChain` 五个 hook 的分工 | 落地 spring 动效时的 API 依据 |
| React Spring（Awesome React 条目） | 动效与动画 | https://awesome-react.dev/library/react-spring | 明确列出该库的代价：API 面大、复杂时间轴编排比 Framer Motion 冗长、v8→v9 文档割裂；并指出标准 UI 过渡（模态/下拉/页面淡入）用它是「overkill」 | 决定「要不要为这个项目引一个动效库」时的取舍依据 |
| React Spring Playground（Mintlify Wiki） | 动效与动画 | https://mintlify.wiki/Aduwoayooluwa/animations/libraries/react-spring | 给出 tension/friction 的手感对照（300/10 很跳、100/40 平稳）以及 `useChain`/`useTrail` 的编排写法 | 需要具体参数取值做弹簧手感试验时 |
| Spring physics 核心原理 | 动效与动画 | https://app.studyraid.com/en/read/11439/358410/core-principles-of-spring-physics-in-animations | 给出阻尼谐振子方程、mass/tension/friction 三个参数的物理含义，以及用 `restVelocity` / `restDelta` 判断动画静止 | 需要把 spring 参数写进设计规范供非工程角色理解时 |
| React Spring with physics-based animations | 动效与动画 | https://fullstack.ist/post/react-spring-with-physics-based-animations | 说明可以用 gravity / friction / stiffness / damping 叠加出重力、阻力、弹性等附加力 | 需要「松手回弹」「落位沉降」这类具体手感的实现线索时 |
| Motion Design（Craftwork skill） | 动效与动画 | https://craftwork.design/skills/motion-design | 给出可直接抄的时长档：hover <100ms、press <150ms、release/settle 200–300ms、error shake 300–400ms（2–3 次振荡） | 需要一张明确的交互态时长表时 |

### ⑤ 交互动效规范

| 名称 | 类别 | 链接 | 可借鉴点 | 适用场景 |
| --- | --- | --- | --- | --- |
| Functional UI animation in 2026 — 上线前清单 | 交互动效规范 | https://adamarant.com/en/blog/functional-ui-animation-in-2026-the-checklist-before-it-ships | 一页式 7 要 7 不要：时长限定 100–500ms、只动 opacity 与 transform、在根节点处理 `prefers-reduced-motion` | 需要一份能直接贴进 code review 的动效门禁清单时 |
| Colorado DCS — Motion & Interaction | 交互动效规范 | https://dcs.colorado.gov/motion-interaction | 政府无障碍口径：模态「按需加入、不加多余动效（不要弹跳/弹性）」；滚动触发动效标为 Non-Essential ⇒ 省略或禁用 | 需要一套「不必要动效就砍掉」的判定依据时 |
| Art of Styleframe — Micro-Interactions in UI | 交互动效规范 | https://artofstyleframe.com/blog/micro-interactions-ui-when-to-animate | 按场景给出常见动效的时长区间与「读起来是有意为之」的曲线选择 | 给具体界面挑动效时长时 |
| Fisher Agency — Microinteraction 全维度说明 | 交互动效规范 | https://www.fisherdesignandadvertising.com/microinteraction/ | 指出人眼把 100ms 以内的延迟感知为「瞬时」，并按触发/反馈/性能/缓动分块说明 | 需要「即时反馈」阈值的依据时 |
| Stellae — Animation Principles for UI | 交互动效规范 | https://www.stellae.design/en/learn/animation-principles-ui | 把 UI 动画的目的拆成「让界面有生命、有响应、够直觉」三层，逐条讲何时该用 | 团队对动效无共识、需要先立原则时 |
| UXMagic — UI Micro-Interactions for SaaS | 交互动效规范 | https://uxmagic.ai/es/blog/ui-micro-interactions-saas-guide | 明确「焦点指示器绝不能被动画淡出或延迟」——鼠标用户觉得好看的动画会让键盘用户迷失 | 桌面端键盘可达性优先的应用（AI 智能体常是重键盘用户） |
| Simplewoody — Microinteraction Timing Guide | 交互动效规范 | https://simplewoody.com/en/design/microinteraction-animation-timing-guide.html | 以「用户动作」为轴组织时长表（按下、模态打开、页面切换各一档） | 需要按动作类型而非按元素类型查时长时 |
| Linearity — Animation and Motion Design 完整指南 | 交互动效规范 | https://www.linearity.io/guide/animation-motion-design/ | 核心原则「动效服务于沟通而非审美」，每段动效必须有功能理由：指示状态变化、引导注意、表达元素关系 | 抑制「为了动而动」时 |
| claudefordesigners — animation skill | 交互动效规范 | https://claudefordesigners.com/skills/animation | 把「时机 / 缓动 / 动效」写成可直接落进项目的默认配置文件，并显式处理 reduced-motion | 需要把动效默认值变成可提交到仓库的文件时 |
| Girard Media — Brand Motion Design | 交互动效规范 | https://girardmedia.com/blog/brand-motion-design-animation-guidelines | 把「动效即品牌识别」当作可系统化的一层（character / personality / consistency） | 需要为产品定一套统一「运动性格」时 |
| ToolsMonk — CSS Animation and Micro-Interactions | 交互动效规范 | https://toolsmonk.com/blog/css-animation-micro-interactions-guide | 用媒体查询把动画降级为「只改变状态、不产生位移」，并列出应避免的自动播放动画类型 | 纯 CSS 实现动效且要带降级时 |
| 中培伟业 — 微交互设计怎么提升产品体验 | 交互动效规范 | https://m.zpedu.com/it/gjrz/40396.html | 把微交互定义为「用户与产品之间最小单位的对话」，用按钮按下反馈/消息发送动画/加载态举例 | 给团队讲清「什么算微交互」时 |
| Albritton Analytics — Motion Design Principles | 交互动效规范 | https://www.albrittonanalytics.com/brand/motion-principles | 主张「每个动画都服务于目的：引导注意力、提供反馈」 | 需要一句话的动效价值观时 |
| Material Design 3 設計規範（狀態層） | 交互动效规范 | https://github.com/Heyairu/Monogatari-Assistant-FE/blob/main/MATERIAL_DESIGN_3_GUIDELINES.md | 规定状态层是叠在元件底色上的反馈，不能把整个元件或文字设成该透明度，且多种状态透明度不能任意相加 | 交互态（hover/pressed/disabled）视觉实现时 |

### ⑥ 无障碍与动效降级

| 名称 | 类别 | 链接 | 可借鉴点 | 适用场景 |
| --- | --- | --- | --- | --- |
| BOIA — CSS Prefers-Reduced-Motion 指南 | 无障碍与动效降级 | https://www.boia.org/blog/what-to-know-about-the-css-prefers-reduced-motion-feature | 明确「reduced motion 不等于不要动画」：把缩放/旋转/波浪换成淡入、溶解、颜色变化，仍能表达状态变化且不触发前庭不适；并强调每个动画都要有对应的媒体查询 | 已有降级块、想从「全关」升级成「换成不产生位移的等价反馈」时 |
| Accessibility Tips — Reduced motion and animations | 无障碍与动效降级 | https://accessibilitytips.netlify.app/reduced-motion-and-animations | 降级时长写 0.01ms 而非 0s，保证 `animationend`/`transitionend` 仍会触发，依赖这两个事件的 JS 才不会坏；并给出安全/有害/危险三档动画分类与 loading spinner 降级为静态进度条的写法 | 降级块会打断 JS 动画流程时 |
| prefers-reduced-motion.com | 无障碍与动效降级 | https://prefers-reduced-motion.com | 给出通用覆盖片段与各系统开关路径（Win10 显示动画 / macOS 减弱动态效果 / Android 移除动画），并指出可用 Chrome DevTools 的「Emulate CSS media feature」直接模拟 | 需要一条命令就能在本地复现降级态时 |
| MDN — prefers-reduced-motion 媒体特性 | 无障碍与动效降级 | https://developer.cdn.mozilla.net/pt-PT/docs/Web/CSS/@media/prefers-reduced-motion | 给出 `no-preference` / `reduce` 的语义定义与「2020 年 1 月起广泛可用」的基线结论；示例把缩放动画换成溶解动画而非删除 | 写规范文档时引用「浏览器支持到什么程度」的权威依据 |
| Reduced Motion Accessibility 实现规范 | 无障碍与动效降级 | https://github.com/catlog22/Claude-Code-Workflow/blob/main/.claude/skills/team-motion-design/specs/reduced-motion.md | 规定「全局覆盖兜底 + 逐组件覆盖优先」的顺序，并列出允许项（<0.15s 淡入淡出、颜色过渡、必要状态指示）与禁止项（视差、弹簧回弹、无限循环、缩放动画） | 要写进本仓动效规范文档的「允许/禁止」清单时 |
| Salivity — CSS prefers-reduced-motion and Accessibility Guide | 无障碍与动效降级 | https://salivity.github.io/css/article/css-prefers-reduced-motion-and-accessibility-guide | 引用 WCAG 2.1 SC 2.3.3 原文并给出「用 outline 替代 hover 位移做替代视觉提示」的降级写法 | 需要一个「保留功能但不产生位移」的具体替代方案时 |
| WP Accessibility — Image animation and accessibility | 无障碍与动效降级 | https://wpaccessibility.org/docs/topics/code/images/image-animation/ | 给出硬指标：自动动画不超过 5 秒、每秒闪烁不超过 3 次；并列出 2.2.2（A）、2.3.1（A）、2.3.2（AAA）、2.3.3（AAA）各自管什么 | 需要把动画相关 WCAG 条目一次性讲清时 |
| Automatic CSS — Reduce Motion 文档 | 无障碍与动效降级 | https://docs.automaticcss.com/accessibility/reduce-motion | 工具级「Reduce Motion」开关默认开启，并明确「把它关掉技术上会让站点不合规」——降级能力应视为构建工具的默认行为 | 想把降级做成工具默认开关而不是每次手写时 |
| Accessibility for Developers — 允许禁用动效 | 无障碍与动效降级 | https://accessibilityfordevelopers.com/allow-disable-of-motion-animation | 摘录 WCAG 2.2.2 全文，并指出「加载/预载阶段的动画可视为 essential」——AI 智能体的流式输出指示器正好属于这一类 | 给「流式输出/加载指示器能不能动」找规范依据时 |
| BOIA — UI Motion and Accessibility 设计建议 | 无障碍与动效降级 | https://www.boia.org/blog/ui-motion-and-accessibility-tips-for-designers | 从设计侧说明用动效解释「元素怎么工作」是可接受的，前提是无障碍上做等价替代 | 需要向设计侧解释动效与无障碍不冲突时 |
| thewcag.com — 2.3.3 Animation from Interactions | 无障碍与动效降级 | https://www.thewcag.com/criteria/2.3.3 | 一句话口径：用户可以关闭由交互触发的动效动画 | 评审时快速引用条目编号时 |
| accessibility.build — WCAG 2.3.3 | 无障碍与动效降级 | https://accessibility.build/wcag/2-3-3 | 用「滚动 → 视差层/缩放英雄图/元素飞入」这一具体反例说明该条为什么存在 | 需要拿真实反例说服人时 |
| motionspec.dev — 2.3.3 不是 A 级失败 | 无障碍与动效降级 | https://motionspec.dev/blog/wcag-2-3-3-animation-from-interactions | 指出 2.3.3 属 Level AAA，2.2.2 才是 Level A——做合规优先级排序时的直接依据 | 排「先修哪条无障碍问题」的优先级时 |
| Knowbility — 探索 WCAG 2.1 之 2.3.3 | 无障碍与动效降级 | https://knowbility.org/blog/2018/wcag21-233animations | 2018 年的经典长文解读，说明该条如何限制「意料之外的动态」，并结合认知无障碍谈 | 需要 2015–2023 经典论述（而非新工具）时 |
| TestParty — 如何满足 WCAG 2.3.3 | 无障碍与动效降级 | https://testparty.ai/blog/wcag-animation-interactions-guide | 讲清「essential animation 例外」的判定与 `prefers-reduced-motion` 的落地方式 | 需要判断某个动效算不算 essential 时 |
| AccessiTech — WCAG Guideline 2.3.3 详解 | 无障碍与动效降级 | https://www.accessi.tech/wcag/WCAG-Guideline-2-3-3-Animation-from-Interactions-Explained | 从「Operable 原则」解释动效必须可被用户控制 | 需要无障碍原则层面的论证时 |

### ⑦ 前端动效性能（FLIP / 合成器 / 掉帧）

| 名称 | 类别 | 链接 | 可借鉴点 | 适用场景 |
| --- | --- | --- | --- | --- |
| Lucky.Graphics — Web Animation Performance 60fps Guide | 动效性能 | http://lucky.graphics/learn/web-animation-performance-guide | 把「浏览器渲染管线 → 合成器独占属性（transform/opacity）→ will-change → FLIP → DevTools 测量」串成一条完整排查链 | 需要一套可复用的动效性能排查流程时 |
| Peasy — 浏览器到底做了什么 | 动效性能 | https://peasytools.com/guides/css-animation-performance-browser-guide | 明确 CSS 变更要走 Style → Layout → Paint → Composite 四步，并指出只动 transform/opacity 可跳过前三步 | 向团队解释「为什么不能动 width/height」时 |
| React Perf — FLIP Animations | 动效性能 | https://reactperf.dev/articles/flip-animations | 直接给 CSS transition 打在 top/left/width/height 上是「D 级：每帧全量 layout」的判断，并指出列表重排、卡片展开、路由切换都属布局变化 | React 项目里评估「这个过渡要不要改写法」时 |
| vocab.design — FLIP (First Last Invert Play) | 动效性能 | https://vocab.design/flip-animation | 定义 FLIP 四步：量首末位置 → 反演差值成 transform → 播放，从而让布局变化也走合成器 | 引入 FLIP 概念的最小说明材料 |
| Julian Burr — FLIP animation technique | 动效性能 | https://www.julianburr.de/til/flip-animation-technique | 讲清 FLIP 相比逐帧 JS 更新位置的优势，及其对动画性能的改善 | 需要一份 FLIP 的原理性解释（而非 API 教程）时 |
| DeepWiki — vue-animated-list 的 FLIP 实现 | 动效性能 | https://deepwiki.com/vuejs/vue-animated-list/3.2-flip-animation-technique | 展示 FLIP 在真实列表插件中的落地方式（读源码级） | 想读一份可对照的实现时 |
| Thomas Wilburn — FLIP for smooth animations | 动效性能 | https://thomaswilburn.github.io/viz-book/perf-flip.html | 把传统两条路线（JS 逐帧更新位置 / CSS transition）对比，说明 FLIP 如何用一次测量换来整段动画的合成器执行 | 需要向非前端解释 FLIP 价值时 |
| fedev — 使用 FLIP 提高 Web 动画性能 | 动效性能 | https://fedev.cn/animation/high-performance-animations.html | 转录并保留了 2015 年前后那篇经典 FLIP 讲解的要点 | 需要经典方案（2015–2018）的原始论述时 |
| Position Is Everything — FLIP 技术 | 动效性能 | https://www.positioniseverything.net?p=717430/ | 指出 width/height/top/left/margin 会让浏览器每帧重算布局，FLIP 则避开这条路径 | 写性能优化说明时的直接引用 |
| JavaScript in Plain English — 用 FLIP 创建动画 | 动效性能 | https://javascript.plainenglish.io/flip-an-elegant-yet-simple-to-use-front-end-animation-mindset-e20af6ad5c69 | 强调 FLIP 是「优雅而简单的前端动画思路」，给出可照抄的最小实现 | 自己实现一份轻量 FLIP 工具时 |
| James Ross Jr. — 不杀性能的 Web 动画 | 动效性能 | https://www.jamesrossjr.com/blog/web-animation-performance | 解释掉帧（jank）成因与 layout thrashing，并给出避免办法 | 需要把「掉帧」讲成可诊断的现象时 |
| Spell UI — 60fps 平滑动效指南 | 动效性能 | https://spell.sh/blog/web-animation-performance | 覆盖 GPU 合成属性、will-change、requestAnimationFrame 与避免 layout thrashing 四件事 | 写动效性能规范时的检查清单来源 |
| Greeto Studio — 无卡顿的 Web 动效 | 动效性能 | https://greeto.me/blog/motion-without-jank | 一句话原则：只动 transform 和 opacity，绝不动布局属性，并尊重 prefers-reduced-motion | 需要一句可写进门禁的硬规则时 |
| iart-ai — 60fps animation skill | 动效性能 | https://github.com/iart-ai/web-animation-skills/blob/HEAD/skills/60fps-animation/SKILL.md | 把「不要动画触发重排/重绘的属性」写成 skill 文件，并解释浏览器分阶段渲染是根因 | 需要一份能落进仓库的 60fps 自检文件时 |
| CSSAwwwards — CSS 性能优化 15 法 | 动效性能 | https://cssawwwards.com/blog/css-performance-optimization-guide-2025 | 强调 will-change 要「动画开始前少量使用」而不是常驻，并要求尊重 prefers-reduced-motion | 处理 will-change 滥用导致显存上涨时 |
| CheatCoders — CSS 动画性能优化 | 动效性能 | https://cheatcoders.net/css-animations-transitions-performance-optimized | 对比「同一动画在 60fps 与幻灯片般卡顿之间的差别只取决于动了哪些属性」 | 团队对性能原因理解不统一时的科普材料 |
| 2POINT Agency — 网站动画完整指南 | 动效性能 | https://www.2pointagency.com/guides/website-animation-the-complete-guide-to-motion-performance-and-ux-in-2026 | 把 `prefers-reduced-motion` 处理定为「基线要求而非高级增强」 | 给动效工作定优先级时 |
| OpenDoor Digital — Web 动画最佳实践 | 动效性能 | https://opendoordigital.dev/blog/web-animation-best-practices | 把「不牺牲性能与无障碍」作为动效设计的硬约束并列 | 需要一份动效自查清单时 |

### ⑧ 课程与系统化教程

| 名称 | 类别 | 链接 | 可借鉴点 | 适用场景 |
| --- | --- | --- | --- | --- |
| CoddyKit — What Are Design Systems? | 课程与系统化教程 | https://www.coddykit.com/courses/design_systems/what-are-design-systems-2538455 | 开篇就把 design system 与 style guide、component library 三者区分开，避免团队把「组件库」当成「设计系统」 | 给团队做概念对齐、划清职责边界时 |
| Cursa — Design Systems for Beginners | 课程与系统化教程 | https://cursa.app/en/free-course/design-systems-for-beginners-build-document-and-scale-ui-libraries-fcje | 一门 1 小时 42 分的免费课，路径是 Figma 库 → 文档 → 规模化，不从零讲概念 | 需要一条能在一小时内走完的入门路径时 |
| UiPedia — Free Courses | 课程与系统化教程 | https://www.uipedia.design/resources/category/free_courses/free-ux-courses-master-user-experience-design-online | 汇总免费 UX/UI 课程，其中点名一个专门做 design systems 的免费站点（HeyDesign Systems） | 需要集中列一批免费学习入口时 |
| MOOC List — UI 标签页 | 课程与系统化教程 | https://www.mooc-list.com/tags/ui | 收录 Coursera / Scrimba 的 UI Design Fundamentals 等平台课，并按平台与主题分类 | 想按平台检索结构化课程时 |
| course.careers — 真正值得上的免费设计课 | 课程与系统化教程 | http://course.careers/blog/website-design-courses-online-free | 指出多数标榜免费的网页设计课只是 90 分钟 YouTube 搬运或付费证书的引流预览 | 帮团队筛掉注水课程时 |
| SkillBake — 值得花时间的免费 UI/UX 课 | 课程与系统化教程 | https://skillbake.com/blog/free-ui-ux-courses-worth-your-time-in-2026 | 把研究→线框→原型→作品集串成一条连贯序列，解决「免费资源东一块西一块」的问题 | 给人推荐系统化学习路径时 |
| Website Builder — 9 个免费 UIUX 资源 | 课程与系统化教程 | https://websitebuilder.com.tw?p=5568/ | 按「已有设计基础、想补哪块」分流推荐，其中用户研究方向给到 University of Michigan 的 UX Research and Design 专项（6 门课） | 按短板给团队成员分派学习路径时 |
| Great Learning — 免费 UI 设计课程 | 课程与系统化教程 | https://mygreatlearning.com/ui-design/free-courses | 免费课里带 Design Thinking 等方法论课程，弥补纯工具类课程的缺环 | 需要补设计方法论而非软件操作时 |
| LearnTube — Front end Design Patterns | 课程与系统化教程 | https://learntube.ai/learn/course/front-end-design-patterns | 用 12 个模块讲可扩展 UI 的结构化方式，明确从「混乱代码」切入 | 需要一套结构化前端设计模式清单时 |
| HacksNation — 免费网页设计与开发资源合集 | 课程与系统化教程 | https://hacksnation.com/d/39359-fresh-free-web-design-and-development-resources-august-2025 | 按月维护免费工具、构建器、课程与趋势合集 | 需要定期刷新可用资源清单时 |
| Flavor365 — 从哪找免费软件设计课 | 课程与系统化教程 | https://eathealthy365.com/where-to-find-a-free-software-design-course | 对零基础者的建议是「先懂原理再学工具」，并指出结构化学习路径比零散资源重要 | 给新手排学习顺序时 |

### ⑨ 视觉风格与美学方向

| 名称 | 类别 | 链接 | 可借鉴点 | 适用场景 |
| --- | --- | --- | --- | --- |
| Nielsen Norman Group — Glassmorphism: Definition and Best Practices | 视觉风格 | https://www.nngroup.com/articles/glassmorphism/ | 指出半透明组件最显著的问题是无障碍约束（文字压在模糊背景上对比度不可控） | 想在桌面端用玻璃态时先看约束条件 |
| ui.glass — Glassmorphism design skill for AI agents | 视觉风格 | http://ui.glass | 给出可直接落地的玻璃态规格（模糊半径、边框、阴影、密度模式），并针对「对话/通知/实时内容在屏幕上必须可读」单独定密度 | 聊天类 AI 界面想用玻璃层时的参数来源 |
| Axess Lab — Glassmorphism Meets Accessibility | 视觉风格 | https://axesslab.com?p=5111/ | 指出玻璃态常配的视差与分层过渡会让前庭敏感人群眩晕，且模糊本身也是一层合成开销 | 评估玻璃态 + 动效组合的风险时 |
| MoldStud — 可访问的玻璃态设计要点 | 视觉风格 | https://moldstud.com/articles/p-top-tips-for-accessible-glassmorphic-design-practices | 聚焦「如何保证足够对比度」并给出用户测试与可扩展性建议 | 玻璃态落地时的对比度检查清单 |
| Heptiq — Designing with Glassmorphism | 视觉风格 | https://www.heptiq.com/blog/css-glassmorphism | 明确指出玻璃态最严重的问题是卡片内文字的对比度，需要用不透明层补 | 玻璃卡片内放正文的实现手法 |
| EULE Institute — Glassmorphism UI 实践 | 视觉风格 | https://euleinstitute.com/en/blog/glassmorphism | 提醒 blur 是 GPU 密集操作，在低端设备或低电量状态下会卡顿耗电 | 决定是否在低配场景启用背景模糊时 |
| Inspo AI — What Is Glassmorphism and How to Use It | 视觉风格 | https://www.inspoai.io/blogs/glassmorphism-ui-design | 把玻璃态拆成四个需要精确控制的属性（`backdrop-filter: blur()` 等）分别给值 | 写实现规范、避免凭感觉调模糊时 |
| Timothy Graf — Glassmorphism vs Neumorphism 高端 UI 指南 | 视觉风格 | https://timgraf.com/ui/glassmorphism-vs-neumorphism-high-end-ui-guide-2026 | 指出扁平设计之后出现的「可供性缺失」（分不清哪里可点），物理隐喻是一种补救 | 解释「为什么又要用质感」这一决策背景时 |
| webbb.ai — Glassmorphism 设计解析 | 视觉风格 | https://www.webbb.ai/blog/glassmorphism-the-coolest-ui-trend-right-now | 用「模糊背景自动弱化背景、把前景内容变成焦点」解释玻璃态的视觉作用机制 | 写视觉方案说明时 |
| Interaction Design Foundation — Neumorphism | 视觉风格 | https://www.interaction-design.org/literature/topics/neumorphism | 指出新拟态依赖细微视觉线索，对低视力与色盲用户识别困难，无障碍挑战显著 | 判断某个界面能否用新拟态时的直接依据 |
| EULE Institute — Neumorphism in UI Design | 视觉风格 | https://euleinstitute.com/en/blog/neumorphism | 同时说明新拟态的无障碍缺陷与它真正可用的具体场景 | 需要给出「用/不用」的决策口径时 |
| Design Studio — What Is Neumorphism UI | 视觉风格 | https://www.design-studio.io/blog/neumorphism-ui-design | 讲清其「柔和微妙、与亮色扁平风格形成对比」的视觉特征与实现限制 | 需要理解新拟态的技术构成时 |
| HashBuilds — What is Neumorphic Design? | 视觉风格 | https://www.hashbuilds.com/patterns/what-is-neumorphic-design | 定义为「同色背景上用内外阴影造出微凸/微凹」，并指出它需要精确的阴影控制与低对比配色 | 评估实现成本时 |
| Synclovis — 为何真实设计系统里少见 Morphism | 视觉风格 | https://www.synclovis.com/blog/why-dont-we-see-morphism-in-real-world-ui-design-systems/ | 把玻璃态/新拟态/拟物化并置，指出视觉上新颖不等于能进入生产设计系统 | 需要给「为什么我们不追这个风格」找依据时 |
| Wings — Neumorphic Design 优劣与实践 | 视觉风格 | https://wings.design?p=50381/ | 给出可用的场景清单（音乐播放器控件、智能设备面板、状态仪表、单任务应用），并指出界面复杂度一上升收益就消失 | 帮产品经理判断某功能能否局部用新拟态时 |

### ⑨ 视觉风格与美学方向（续：编辑式 / 野兽派）

| 名称 | 类别 | 链接 | 可借鉴点 | 适用场景 |
| --- | --- | --- | --- | --- |
| 人民网 — 浅谈报纸版面设计的基本原理（2015） | 视觉风格 | http://media.people.com.cn/BIG5/n/2015/0515/c192374-27007539.html | 指出比例失调版面就难有美感，色彩主要来自图片与背景对比 | 需要 2015 年前后的经典编辑设计论述时 |
| 人民网 — 版面比例三原则（2015） | 视觉风格 | http://media.people.com.cn/BIG5/n/2015/0512/c395997-26987386.html | 给出三条硬要求：标题字大小要适当、栏的长短要适当、围框的形状/大小/多少要适当 | 写版式检查清单时 |
| Editorial Web Design Style（Enlighten Media） | 视觉风格 | https://design-styles.enlighten-media.net/pages/editorial | 把编辑式概括为「报纸栏式的复兴：聪明的留白 + 谨慎的字级层次 + 让文字自己承担重量」 | 需要一句话定义编辑式风格时 |
| Better Design Space — Editorial Design 原则 | 视觉风格 | https://betterdesignspace.blogspot.com/2025/06/editorial-design-principles-for.html | 把编辑设计的适用对象明确为杂志、书籍与数字出版物三类，目标是让内容易读 | 界定「什么时候该用编辑式排版」时 |
| Typography Master — Editorial Typography | 视觉风格 | https://www.typographymaster.com/guide/editorial-typography | 列出编辑式排版的具体构件：栅格、栏、引言、图片说明、脚注，以及「持续阅读的节奏」 | 搭一套阅读型详情页/长文视图时 |
| Developers Heaven — 高级排版与编辑设计系统清单 | 视觉风格 | https://developers-heaven.net/blog/the-definitive-checklist-for-advanced-typography-and-editorial-design-systems/ | 一份逐项打勾的排版检查清单，适合直接改成门禁 | 需要把排版规范转成可执行检查项时 |
| Chris Lemke — The Quiet Power of Editorial Design | 视觉风格 | https://chrislemke.github.io/website_designs/examples/Editorial_Magazine_Layout.html | 以杂志跨页实例讲「非对称栅格 + 有分量的标题排版」如何建立权威感而不喧哗 | 想看编辑式排版具体成品参照时 |
| London Read — Editorial Design Trends 2025 | 视觉风格 | https://www.londonread.com/editorial-design-trends-to-boost-content-engagement-in-2025/ | 把编辑式设计定位为影响阅读行为的策略工具，而不只是审美选择 | 给「为什么值得做」找依据时 |
| Dynadot — 页面排版最佳实践 | 视觉风格 | https://content.dynadot.com/article/128 | 强调好排版决定读者多快读懂与信任，字体选择同时定调性 | 需要向非设计角色解释排版价值时 |
| Stellae — Web Brutalism 反设计运动 | 视觉风格 | https://www.stellae.design/en/learn/web-brutalism-design | 讲清野兽派的设计哲学（拥抱未完成的原始状态）以及它何时比精致更适合项目 | 评估要不要在某个子页面用反设计语言时 |
| FridayNight Wiki — Brutalism 风格条目 | 视觉风格 | https://fridaynight.wiki/web-design-styles/07-brutalism | 给出核心原则：暴露结构（外露栅格、系统字体、默认表单控件） | 想低成本做出「有性格」的开发者面板时 |
| Designlab — 野兽派网站 5 个设计收获 | 视觉风格 | https://designlab.com/blog/brutalist-websites-5-things-designers-learn-brutalism/ | 指出野兽派与早期 web 的原始功能性天然同源 | 需要论证「反设计≠反可用」时 |
| StringLabs Creative — 野兽派原则、示例与优劣 | 视觉风格 | https://stringlabscreative.com/brutalist-web-design | 明确「不是每个网站都需要动效和渐变」，有些场景用户只想要原始、功能、直接 | 给「要不要加动效」提供另一种答案时 |
| Webflow — 野兽派网站 11 个案例 | 视觉风格 | https://webflow.com/blog/10-brutalist-websites | 用具体站点（如用红色时间线切分历史章节）说明野兽派如何承载信息组织 | 找可参考的成品案例时 |
| Blake Crosley — 野兽派与美 | 视觉风格 | https://blakecrosley.com/blog/beauty-brutalism-design | 指出模糊头部有功能目的：表明内容在导航下方滚动，头部是常驻层 | 需要给「毛玻璃」一个功能性理由时 |
| Greyson Enterprises — Embracing Brutalism | 视觉风格 | https://www.greysonenterprises.com/blog/embracing-brutalism-in-web-design-a-guide-to-unconventional-aesthetics | 对比「极简精致界面」这一主流与野兽派的原始未加工路径 | 写风格提案的背景段时 |
| Obriy Design — 野兽派 5 个创意案例 | 视觉风格 | https://obriy.design/post/web-brutalism-key-features-and-5-creative-examples | 用 Balenciaga 站点说明野兽派如何让视线只落在商品本身 | 给品牌/产品页的风格建议时 |

### ⑩ UI 框架 / 组件库 / 工具链

| 名称 | 类别 | 链接 | 可借鉴点 | 适用场景 |
| --- | --- | --- | --- | --- |
| Security Boulevard — What Is shadcn/ui | UI 框架与工具链 | https://securityboulevard.com/2026/06/what-is-shadcn-ui-a-developers-guide/ | 核心机制：组件是「复制进你自己代码库」而不是「作为依赖安装」，底层用 Radix/Base UI 的可访问原语 + Tailwind 样式 | 本仓「不能随便加依赖」时，这套「源码进仓」模式可直接借鉴 |
| Shadcn Space — Radix UI vs Base UI | UI 框架与工具链 | https://shadcnspace.com/blog/radix-ui-vs-base-ui | 把 Radix 定位为无样式的可访问性原语库：行为/无障碍由它兜底，样式完全交给使用方 | 只需要键盘与 ARIA 行为、不想被视觉绑死时 |
| aicoolies — Radix UI 档案 | UI 框架与工具链 | https://aicoolies.com/tools/radix-ui | 记录 Radix UI 的定位为「无样式、可访问的 React 组件原语，用于构建设计系统」，许可证为开源 | 快速核对一个组件库的定位与授权时 |
| GitHub topic: radix-ui | UI 框架与工具链 | https://github.locker/topics/radix-ui | 按 star 汇总 Radix 生态的 15 个仓库（radix-ui 本体、openscreen、chatbot 等） | 查 Radix 生态有哪些周边项目时 |
| xcodx — 2026 最佳 React UI 组件库 | UI 框架与工具链 | https://xcodx.io/blog/libraries/best-react-ui-component-libraries | 把候选按「无头原语 vs 带样式套件」两类分组，并标注各自适合谁 | 选型时先分清「要原语还是要成品」时 |
| Spell UI — 15 个 React 动画库对比 | UI 框架与工具链 | https://spell.sh/blog/best-react-animation-libraries | 按 Motion（原 Framer Motion）、React Spring、GSAP 等逐个对比 | 需要一份动效库横评时 |
| xcodx — 2026 最佳 Web 动画库 | UI 框架与工具链 | https://xcodx.io/blog/libraries/best-web-animation-libraries | 把原生 CSS/WAAPI 也列为一项，并专门给出「什么时候干脆不要库」的判断 | 判断是否需要引第三方动效库时 |
| PkgPulse — Framer Motion vs Motion One vs AutoAnimate 2026 | UI 框架与工具链 | https://www.pkgpulse.com/guides/framer-motion-vs-motion-one-vs-autoanimate-2026 | 按 bundle 体积、DX、WAAPI 性能、布局动画四项做对比 | 「不能随便加依赖」时做体积决策时 |
| Timace — Best Web Animation Libraries 2026 | UI 框架与工具链 | https://www.timace.io/best/best-animation-libraries | 给出按场景的默认选择：复杂时间轴/滚动触发用 GSAP，已在 React 中用 Motion 或 React Spring | 快速拿到一个默认推荐时 |
| Motion 官方文档 — Animatable values | UI 框架与工具链 | https://motion.dev/docs/react-animation | 官方列出可动属性范围与写法，hover / 滚动触发 / 复杂序列都从这里开始 | 已经在用 Motion 时查具体属性支持 |
| Syncfusion — React 动画库性能取舍 | UI 框架与工具链 | https://www.syncfusion.com/blogs/post/react-animation-libraries-comparison | 给出 Lottie/JSON 动画的体积代价与适用场景（引导页、空状态、营销插图） | 考虑用 Lottie 表达智能体状态时 |
| DeepWiki — awesome-react 之动效与图形 | UI 框架与工具链 | https://deepwiki.com/enaqx/awesome-react/2.13-animations-and-graphics | 整理 awesome-react 收录的动效与图形库清单 | 需要一份可遍历的库列表时 |
| RetroUI — 2026 八个 React 动画库 | UI 框架与工具链 | https://retroui.dev/blog/top-8-react-animation-libraries | 逐个列出「优点 / 缺点 / 适用场景」，缺点栏明确写生态小、文档不全等 | 需要带缺点的选型信息时 |
| Kickstart UI — 动效资源索引 | UI 框架与工具链 | https://kickstartui.com/explore/animations | 汇总可用的动效资源与工具并分类 | 找动效参考实现时 |

## 最相关的 15 条

> 取舍依据：本仓已有 `packages/ui-tokens/src/tokens.ts`（颜色 / 4px 间距阶梯 / 六档字号 / 圆角 / 阴影 / 动效时长与曲线）与 `styles/motion.css`（同套 CSS 变量 + 动效工具类 + `prefers-reduced-motion` / `prefers-contrast` / `prefers-reduced-transparency` 三个降级块）。
> **实测现状**（本轮现扫，非引用旧数字）：`styles.css` 有 **52 处写死 `font-size`**、**13 处十六进制色 + 10 处 `rgb()/rgba()` = 23 处写死颜色**、**5 处 transition/animation/@keyframes**；整个 `apps/desktop/src/renderer/src` 只有 **17 处 transition/animation/@keyframes，分布在 3 个文件**。
> 因此下面的排序偏向：**令牌落地与治理 → 字号阶梯与中文排版 → 无障碍 → 动效性能 → 零依赖可用的做法**。

### 一、令牌落地与治理

1. **Style Dictionary** — https://github.com/jsfix-ci/style-dictionary
   用一份 JSON 源 + build 配置同时产出 CSS 变量 / JS / TS 等目标。**我们该怎么用**：不必一步到位替换现有 `tokens.ts`——可以先把 `tokens.ts` 作为唯一真相源，由它在构建期生成 `motion.css` 里那套 `--c-* / --fs-* / --motion-*` 变量（现在这两处是手工同步的，改一处忘另一处是必然的漂移源）。生成物入库、源文件不改行为，先让「一处改、两处生效」这件事成立，再谈换工具。

2. **Open Library Design Token Guide** — https://github.com/internetarchive/openlibrary/wiki/design-tokens
   两层架构：`--blue-500`（primitive）与 `--color-link: var(--blue-600)`（semantic），并规定「组件里只用语义层；缺语义层就新建，而不是退回去用 primitive 或硬编码」。**我们该怎么用**：当前 `tokens.ts` 的 `color` 其实已经是语义层（`bgLayout` / `textSecondary` / `primary`），缺的是 primitive 层——那 52 处写死字号、23 处写死颜色正是「语义层没覆盖到，于是绕过去写死」的直接后果。**先补 primitive 层、再把写死值逐个换成语义层引用**，比一次性重写 52 处字号安全得多。另外该文已验证「CSS 自定义属性会穿透 Shadow DOM 继承」，这对我们未来用 Web Components 承载组件是利好结论。

3. **rampstackco design-system skill（五层模型 + 失败模式）** — https://github.com/rampstackco/claude-skills/blob/482c9bf74697fc1e311bd4dca5ce301f046c4b76/skills/design-system/SKILL.md
   给出 Foundations→Elements→Components→Patterns→Governance 五层，并明确列出失败模式，其中两条对我们正中要害：「**Token explosion**——为 10 个颜色定义了 200 个颜色令牌，纪律是多数产品需要的令牌比现有的少」和「**没有治理的系统在原设计师离开后就崩**」。**我们该怎么用**：现阶段只做 Foundations 一层是合理的（四层以上的组件/模式治理在单人项目里是纯开销），但要立一条硬规则——**新增令牌必须走「先证明现有令牌不够用」**，否则 52 处写死值会换成另一种形式继续扩散。

### 二、字号阶梯与中文排版

4. **Refactoring UI 设计系统** — https://lobehub.com/en/skills/jeremylongshore-claude-code-plugins-plus-skills-refactoring-ui
   固定一条线性/近线性间距阶梯（4 / 8 / 16 / 24 / 32 / 48 / 64px），并要求「组间间距 > 组内间距」。**我们该怎么用**：`tokens.ts` 现有六档字号（11/12/13/14/15/18px）是**步进 1px 的密集阶梯**，适合数据密集型桌面界面；但 52 处写死字号里大概率混着 10/16/20/24px 这类阶梯外的值。建议**保留现有六档**（它们已经服务了密集型布局），另立一份**阶梯外的例外白名单**，逐条记录「为什么这个字号不在六档里」，而不是让 52 处写死值静默存在。

5. **Script Walker — 繁中排版规格** — https://scriptwalker.app/blog/traditional-chinese-web-typography-spec-2026
   给出可验收的具体数值：行高 1.75、中西混排 0.25em、标题字距 0.05em 以内，并用 `text-spacing-trim` 处理连续标点空白、`line-break: strict` + `word-break: normal` 实现避头尾。**我们该怎么用**：这四个值非常适合直接进 `tokens.ts`——加一组「中文排版令牌」（如 `--fs-body: 13px` 配 `--lh-body: 1.75`），避免每个组件自己写 `line-height: 1.6`。`text-spacing-trim` 与 `line-break: strict` 是**纯 CSS 声明、零依赖**，属于本仓可以直接照抄的改动。

6. **庞果设计 — 中文网站排版怎么调** — https://www.pongo.com.tw/chinese-typography-priority
   指出常见预设行高是按拉丁字母调的、普遍低于中文建议的 1.5–1.8 倍，并给出优先级：**行高比字距更该先处理**。**我们该怎么用**：我们已经有 `--fs-*` 令牌但**没有行高令牌**——这正是「有字号纪律、没行高纪律」的典型缺口。补一组 `--lh-*` 令牌的成本远低于补字号，而且中文正文行高偏挤是**可感知**的问题，收益直接。

7. **百度智能云 — 重识中文之美** — https://cloud.baidu.com/article/3981250
   给出 `unicode-range: U+4E00-9FFF` 限定中文字形范围的做法，以及行高与字距的量化标准。**我们该怎么用**：这是**零依赖但有工程量**的一条——若将来要自托管中文字体（不引 Google Fonts / jsDelivr，符合国内可访问性），用 `unicode-range` 把中文字形切出来单独成包、拉丁字形用小包，能把字体体积从 MB 级降到可控范围。**当前不紧急，但做主题包分发前必须先定这条路**，否则临时塞一个全量中文字体进 Electron 包体是必然的。

### 三、无障碍

8. **Accessibility Tips — Reduced motion and animations** — https://accessibilitytips.netlify.app/reduced-motion-and-animations
   三个具体做法：① 降级时长写 `0.01ms` 而非 `0s`，保证 `animationend`/`transitionend` 仍触发，依赖这两个事件的 JS 才不会坏；② 渐进增强写法——默认无动画，只在 `prefers-reduced-motion: no-preference` 下才加 transition，让动效成为增强而非默认；③ 给出安全/有害/危险三档动画分类。**我们该怎么用**：`motion.css` 现有的降级块已经用了 `0.01ms`（写法正确），但**第 ② 条正是本仓动效「几乎没铺开」的深层原因**——如果动效默认就是有条件的，那么在 52 处写死字号的存量代码里，加动效就必须同时处理降级，成本反而抬高。**先把动效做成「默认有、`no-preference` 保留」的结构，再铺动效**，比铺完再补降级便宜。

9. **Colorado DCS — Motion & Interaction** — https://dcs.colorado.gov/motion-interaction
   给出 essential / non-essential 动效分类表（加载指示、表单校验反馈、错误与成功、按钮按压反馈 = essential；粒子效果、视差、背景动画、无限循环 = non-essential 应省略），并明确「**动画总对比度变化保持在 30% 以内**」。**我们该怎么用**：这份表可以直接变成 `motion.css` 里的**工具类白名单**——`.jj-enter` / `.jj-fade` / `.jj-spin` / `.jj-shimmer` 是 essential（保留、只降时长），而任何视差、粒子、无限循环类动效直接不写进本仓。**30% 对比度变化这条对我们尤其相关**：深色主题下若做「卡片悬浮提亮」的动效，必须控制亮度跳变幅度，否则会打到这条线上。

10. **UXMagic — UI Micro-Interactions for SaaS** — https://uxmagic.ai/es/blog/ui-micro-interactions-saas-guide
    明确「**焦点指示器绝不能被动画淡出或延迟**——一个鼠标用户觉得没问题的动画，键盘用户可能真的会迷失方向」。**我们该怎么用**：我们已有 `prefers-contrast: more` 的边框加强块，但**没有针对 `:focus-visible` 的动效约束**。AI 智能体是重键盘交互的场景（命令面板、快捷键、流式输出），**焦点环的显示时机与过渡不能走 `.jj-transition` 那条通用类**——通用类里声明的 `opacity` 过渡正好会淡出焦点环。加一条明确禁令：`*:focus-visible` 不参与 opacity/transform 过渡。

11. **Accessibility for Developers — 允许禁用动效** — https://accessibilityfordevelopers.com/allow-disable-of-motion-animation
    摘录 WCAG 2.2.2 全文，并指出「**加载/预载阶段的动画可视为 essential**（若交互在该阶段对所有用户都无法进行，且不指示进度会让用户以为卡死）」。**我们该怎么用**：这条直接关系到 AI 智能体的**流式输出指示器**——它天然是「自动开始、超过 5 秒、与其他内容并行」的内容，字面上会踩 2.2.2。有了这条依据，我们可以在规范里把它显式登记为 essential 并给出理由，而不是让审查时反复讨论。**把「essential 动效清单」写进 `motion.css` 的注释或设计文档**，是零成本的可审计做法。

### 四、动效性能

12. **Peasy — CSS Animation Performance: What the Browser Actually Does** — https://peasytools.com/guides/css-animation-performance-browser-guide
    明确 CSS 变更要走 **Style → Layout → Paint → Composite** 四步，只动 `transform`/`opacity` 可跳过前三步。**我们该怎么用**：`motion.css` 头部的铁律第 1 条已经写对了这件事（只动 transform/opacity），但**`motion.css` 里的 `.jj-collapse` 过渡的是 `grid-template-rows`**——那属于会触发 Layout 的属性，只是因为 `0fr→1fr` 的目标值由内容自身决定才没出现跳动。这是一个**「规则说只动合成属性、实现里却动了布局属性」的例外**，应该显式登记为「已知例外 + 理由」，否则门禁一旦按规则自动扫描就会把它当违规项。

13. **iart-ai — Performant Web Animation（60fps skill）** — https://github.com/iart-ai/web-animation-skills/blob/HEAD/skills/60fps-animation/SKILL.md
    把「不要动画触发重排/重绘的属性」写成可落进仓库的 skill 文件，并解释浏览器分阶段渲染是根因。**我们该怎么用**：这正是本仓需要的**可执行门禁**形态——把规则从注释变成脚本：扫描 `styles.css` / `motion.css` / 组件内联样式里出现在 `transition` / `animation` 里的属性名，白名单只放 `transform` / `opacity` / `border-color` / `background-color` / `box-shadow`，其余报红。**这与我们已有的 `check:docs` 门禁形态一致，是可以直接复制的做法**——「守则写在注释里」和「守则被脚本检查」之间的差别，就是本仓动效纪律能不能长期活下来的差别。

### 五、零依赖可用的做法

14. **Craftwork — Motion Design** — https://craftwork.design/skills/motion-design
    给出可直接抄的交互态时长档：**hover < 100ms、press < 150ms、release/settle 200–300ms、error shake 300–400ms（2–3 次振荡）**，并按方向区分：入场用减速（快起慢停）、离场用加速。**我们该怎么用**：`tokens.ts` 的 `motion` 已有四档时长（100/160/240/320ms）与四条曲线，**结构上完全够用**——缺的是「哪个交互态对应哪一档」的映射表。把上面这张表直接落成 `motion.css` 里的一组工具类契约（如 `.jj-hover` = `--motion-duration-instant` + `--motion-ease-out`），开发者就不需要每次都回忆「hover 该用多少毫秒」。

15. **vocab.design — FLIP (First Last Invert Play)** — https://vocab.design/flip-animation
    定义 FLIP 四步：量首末位置 → 反演差值成 transform → 播放，从而让**布局变化也走合成器**。**我们该怎么用**：这是本仓做「列表重排 / 卡片展开 / 面板切换」这类**必然引起布局变化**的动效时，唯一不需要引第三方库的路子——**用一次测量 + 一个 transform 过渡**替代「过渡 width/height/top」。注意配合第 12 条：`.jj-collapse` 用的 `grid-template-rows` 过渡正是这类「布局变化动效」的现行做法，FLIP 给了它一个更符合铁律的替代方案；两者不必同时改，但**新做的布局动效应默认走 FLIP**。

---

## 调研过程中发现的坑

> 只列**在检索结果里看到明确依据**的注意事项；每条附来源。

1. **不能把西文的行高默认值直接用在中文上** —— 常见预设行高是按拉丁字母调的，普遍低于中文建议的 1.5–1.8 倍；行高是中文排版**优先处理**的第一件事，字距在其后。（庞果设计 https://www.pongo.com.tw/chinese-typography-priority ；Script Walker 给 1.75 https://scriptwalker.app/blog/traditional-chinese-web-typography-spec-2026 ；Typotheque 指出 CJK 在行高/对齐/避头尾上有独立要求 https://www.typotheque.com/articles/typesetting-cjk-text）

2. **中英混排正文不能两端对齐** —— 两种文字字宽差异会产生「白河」（ugly gaps），正确做法是一律左对齐。（Spacing and rhythm — hard rules https://github.com/Emasoft/ai-maestro-webdesign/blob/main/skills/amw-design-principles/spacing-rhythm.md）

3. **降级写 `0s` 会打断依赖 `animationend`/`transitionend` 的 JS** —— 必须写 `0.01ms`。（Accessibility Tips https://accessibilitytips.netlify.app/reduced-motion-and-animations）

4. **「reduced-motion = 不要动画」是错的** —— 缩放/旋转/波浪应换成淡入、溶解、颜色变化；加载指示、表单校验、按压反馈属 essential，应「降速」而非「省略」。（BOIA https://www.boia.org/blog/what-to-know-about-the-css-prefers-reduced-motion-feature ；Colorado DCS https://dcs.colorado.gov/motion-interaction）

5. **`prefers-reduced-motion` 是操作系统设置，不是浏览器设置** —— 且用户可能不知道该开关在哪；因此规范同时要求提供**页面内的暂停/停止控制**（WCAG 2.2.2）。（Automatic CSS https://docs.automaticcss.com/accessibility/reduce-motion ；BOIA 同上）

6. **动画超过 500ms 就要给用户控制（暂停）** —— 这是政府无障碍口径里写死的分界；复杂动画的上限参考值约 800ms。（Colorado DCS https://dcs.colorado.gov/motion-interaction）

7. **WCAG 2.3.3 是 Level AAA，不是 Level A** —— 真正卡合规底线的是 2.2.2（Level A）与 2.3.1（每秒闪烁不超过 3 次，Level A）。排优先级时别把 2.3.3 当硬门槛。（motionspec.dev https://motionspec.dev/blog/wcag-2-3-3-animation-from-interactions ；WP Accessibility https://wpaccessibility.org/docs/topics/code/images/image-animation/）

8. **玻璃态/背景模糊是 GPU 密集操作** —— 在低端设备或低电量状态下会卡顿耗电；且半透明组件的**文字对比度不可控**，是玻璃态最显著的无障碍约束。**新拟态（neumorphism）同理**：依赖细微视觉线索，对低视力与色盲用户识别困难。（EULE Institute 玻璃态 https://euleinstitute.com/en/blog/glassmorphism ；NN Group https://www.nngroup.com/articles/glassmorphism/ ；Interaction Design Foundation 新拟态 https://www.interaction-design.org/literature/topics/neumorphism）

9. **Material Design 自己已经从「缓动 + 时长」体系迁到 spring 物理体系** —— 官方页面明确标注「Expressive 更新中组件与动效已改用 spring，产品应迁移」。**所以「曲线体系过时了」是个常见误判**：曲线体系仍是稳定回退方案，但选型时要意识到规范正在分裂成两派。（material.io https://material.io/styles/motion/easing-and-duration）

10. **弹簧动画与现有「时长 + 曲线」令牌制式不兼容** —— 弹簧**没有固定时长**，无法直接映射进现有 `--motion-duration-*`；而且据 awesome-react 的评测，react-spring 编排复杂时间轴比 Framer Motion 冗长，对标准 UI 过渡（模态/下拉/淡入）属于 overkill。**但「零依赖做 spring」并非不可能**：CSS `linear()` 缓动函数可以把采样出的关键帧直接写进样式表（okikio/spring-easing 的 `CSSSpringEasing` 即此法），Chrome/Edge 113+ / Firefox 112+ 可用、Safari 暂不支持——**本仓 Electron 44.4.2 自带的 Chromium 满足版本条件**，所以 spring 手感是可以「零 JS 依赖」落地的。（react-spring https://github.com/pmndrs/react-spring ；Awesome React 条目 https://awesome-react.dev/library/react-spring ；spring-easing https://github.com/okikio/spring-easing）

11. **`will-change` 滥用会耗显存** —— 应在动画开始前少量使用而非常驻。（CSSAwwwards https://cssawwwards.com/blog/css-performance-optimization-guide-2025 ；motion.css 自身铁律第 4 条也已写明）

12. **CSS transition 打在 `top/left/width/height` 上是「每帧全量 layout」** —— 这是 FLIP 存在的全部理由；同理 `grid-template-rows` 过渡也属布局属性，虽然 `0fr→1fr` 的目标值由内容自身决定因而不跳动。（React Perf https://reactperf.dev/articles/flip-animations ；Peasy https://peasytools.com/guides/css-animation-performance-browser-guide）

13. **桌面端的可点击区域标准不是 44×44px** —— 移动端最小 44×44 / 推荐 48×48，**桌面端最小 32×32 / 推荐 40×40**（密集工具栏可到 24×24）。直接照搬移动端标准会让桌面界面显得松散。（间距与节奏硬规则 https://github.com/Jane-xiaoer/claude-design-principles/blob/main/spacing-rhythm.md ）

14. **「上了 baseline grid 就一定好看」是个误解** —— baseline grid **只统一高度维度**，和谐来自对比、重复与数值间的和的关系；且纯 baseline grid 在 CSS 里难以维持，实际做法是退化成以基准单位（8px）为源的间距阶梯。（Layout and Spacing Reference https://github.com/ratacat/claude-skills/tree/main/skills/web-interface-design/references/layout-and-spacing.md ；Grid and Layout Theory https://github.com/pantheon-org/tekhne/blob/80305510091af462688a10a515238e2f01f13870/skills/development/front-end/web-reference-sheet-generator/references/grid-and-layout-theory.md ）

15. **style-dictionary 合并令牌时存在「同名覆盖」的坑** —— 若 `of.color.fg` 路径下同时存在 `value` 与 `muted` 子键，合并后的对象在该路径上看到 `value` 键，**结果只会输出 `--of-color-fg`**。文中给出的规避方式是遵循 `<prefix>.<component>.<modifier>.<UIState>.<CSSProperty>` 的结构，或把同层键写成 `fg-muted`。（open-formulieren/design-tokens http://github.com/open-formulieren/design-tokens ）

16. **shadcn/ui 的关键机制是「源码进仓」而不是「装依赖」** —— 组件复制进你自己的代码库，底层用 Radix/Base UI 的可访问原语。这与本仓「不能随便加依赖」的约束天然吻合：值得借鉴的是**模式**（行为可访问性兜底 + 样式完全自持），而不是整套 Tailwind 前提。（Security Boulevard https://securityboulevard.com/2026/06/what-is-shadcn-ui-a-developers-guide/ ；Shadcn Space https://shadcnspace.com/blog/radix-ui-vs-base-ui ）

17. **动效库的选型要连 bundle 体积一起看** —— Framer Motion / Motion One / AutoAnimate 的对比文章把「bundle size、DX、WAAPI 性能、布局动画」四项并列，并专门给出「什么时候干脆不要用库」的判断；也有评测直接指出 anime.js「没有 React 集成也没有 spring 模型」。（PkgPulse https://www.pkgpulse.com/guides/framer-motion-vs-motion-one-vs-autoanimate-2026 ；xcodx https://xcodx.io/blog/libraries/best-web-animation-libraries ；TokRepo 对 react-spring 的对比 https://tokrepo.com/en/workflows/react-spring-physics-based-animation-library-react-a1770a36 ）

18. **中文界面的 gutter 要比纯拉丁布局留得更大** —— 中文文本密度高，列间距过小会导致文本粘连。（考点稿 http://www.kaozhigao.com/show-56233.html ）

19. **玻璃态在通信类产品上要特别控制可读性** —— 面向 AI 智能体的玻璃态方案明确指出，对话、通知与实时内容在玻璃背景上必须保持可读，并为此单独定义了密度模式。（ui.glass http://ui.glass ）

20. **`animation-timeline: scroll()` 目前只有 Chromium 系支持** —— 视差/滚动驱动动效应按渐进增强处理，Safari 与 Firefox 需要静态回退。（Accessibility Tips https://accessibilitytips.netlify.app/reduced-motion-and-animations ）

---

## 附录：本轮检索的口径与局限

- 全部条目均来自本轮 `web_search` / `web_fetch` 实际返回的结果页。**全文仅 1 条标了「（待核）」**（`gvaste/easing-lab`）——其名称来自 GitHub topic 页，但直接地址经 `api.github.com/repos/gvaste/easing-lab` 查询返回 **404**，仓库可能已改名或删除。除此之外，所有条目的名称与链接都在同一结果页中直接可见。
- 其中 6 条 GitHub 仓库链接已额外用 `api.github.com/repos/<owner>/<repo>` **逐一核实了存在性、许可证与描述**（`robertpenner/fast-bezier-easing`、`creasty/animation-essential`、`chfoidl/animus`、`okikio/spring-easing`、`tweenjs/tween.js`），其余仓库类条目的名称取自检索结果页中显示的仓库标题。
- 本轮**未覆盖**的方向（检索词未命中有价值结果，未硬凑）：中文 webfont 授权与分发细则、Electron 特有的 `webContents` 动画/窗口过渡 API、Chromium 合成器在 Electron 中的具体差异——这三条建议作为下一轮专项。

