# S11 — 多模态能力适配与视频生成：五类来源补齐

> 检索日期：2026-09-18（注：OpenAI Sora 2 / Videos API 已于官方文档公告将于 **2026-09-24 永久关停**，距离检索日仅 6 天，相关来源均按「即将弃用」标注）。
> 验证状态图例：**canonical** = 权威一手来源（官方文档 / 论文 / 官方仓库）；**verified** = 本调研期间已直接抓取确认存活；**unverified** = 经 WebSearch 确认页面/仓库存在但本次未直接抓取（多为 Cloudflare 拦截或仅索引级确认）。
> 国产厂商覆盖：智谱、可灵、通义万相、海螺(MiniMax)、即梦(字节)、B站生态 均已在下列小节或其补充说明中给出官方/开源来源（见各节「补充说明」）。

---

## 100. 视频生成 API 抽象与任务模型

核心问题：把「文生视频 / 图生视频」在各厂商（OpenAI、Veo、可灵、即梦、通义万相、海螺、智谱、Runway、Pika）形态各异的接口，抽象成统一的「提交任务 → 轮询/Webhook → 取回产物」异步任务模型。

| 类型 | 标题 | URL | 权威性说明 | 验证状态 |
|------|------|-----|-----------|----------|
| T1 官方文档 | 智谱《视频生成异步》API 参考（POST `/paas/v4/videos/generations`，cogvideox-3，支持文生/图生视频、size/fps/duration/with_audio） | https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E8%A7%86%E9%A2%91%E7%94%9F%E6%88%90%E5%BC%82%E6%AD%A5 | 国产厂商一手官方异步视频接口文档，结构清晰，最适合作为「任务模型」抽象样板 | canonical·verified |
| T2 开源仓库 | openai-node `resources/videos`（`videos.d.ts`/`videos.mjs`，展示 video generation + poll 的任务式 API 封装，含 `@deprecated` 关停标注） | https://app.unpkg.com/openai@7.8.0/files/resources/videos.d.ts | 官方 SDK 对视频任务的代码级抽象，可直接对照「提交→轮询」实现 | canonical·unverified |
| T3 论文/技术报告 | OpenAI《Video Generation Models as World Simulators》（Sora 技术报告） | https://openai.com/index/video-generation-models-as-world-simulators/ | 一手技术报告，奠定「视频生成=世界模拟、长时序扩散」的任务语义 | canonical·unverified |
| T4 在线教程 | ReelMind《Sora 2 API Preview Guide: generate / extend / batch》 | https://reelmind.ai/blogs/sora-2-api-preview-guide-how-to-generate-extend-and-batch-ai-videos-with-openai | 实操向教程，演示异步视频任务的生成/续帧/批量工作流 | unverified |
| T5 技术社区 | openai/openai-node#1778（视频输入 feature request，讨论异步视频任务能力边界） | https://github.com/openai/openai-node/issues/1778 | 真实 GitHub Issue，反映 SDK 层对视频任务能力的社区诉求 | unverified |

**补充说明**：其余厂商官方「任务模型」文档（用于抽象对照）——OpenAI `platform.openai.com/docs/guides/video-generation`（异步 `POST /videos` → `GET /videos/{id}` → `GET /videos/{id}/content`，**2026-09-24 弃用**）；Google Veo `docs.cloud.google.cn/gemini-enterprise-agent-platform/models/video/generate-videos-from-text`；可灵 `klingai.com/document-api/api/video/3-0-omni/image-to-video`；字节即梦 `docs.byteplus.com/de/docs/ModelArk/1520757`（POST `/api/v3/contents/generations/tasks`）；Runway `docs.runwayml.com`、Pika `dev.pika.art/models/pika/pika-2.5/image-to-video`。统一抽象建议：各方均遵循 `submit(task) → taskId / poll(taskId) → artifactUrl` 三态，差异仅在参数（时长/分辨率/帧率/是否带音轨）与回调（轮询 vs webhook）。

---

## 101. 模型能力声明与能力探测（capability gating）

工程链路（务必讲清）：**能力声明（厂商/SDK 显式声明某模型支持哪些能力）→ UI 禁用/降级（前端按声明隐藏或置灰不支持的入口，避免「点了才报错」）→ 探测失败兜底（运行时探测或调用失败时，graceful degradation 降级到静态/缓存/只读，而非崩溃）**。

| 类型 | 标题 | URL | 权威性说明 | 验证状态 |
|------|------|-----|-----------|----------|
| T1 官方文档 | 可灵《能力地图 Capability Map – Video》（厂商显式能力声明：模型/分辨率/时长/功能矩阵） | https://klingai.com/document-api/guides/capability-map/video | 国产厂商一手「能力声明」文档，是 capability gating 的数据源范本 | canonical·unverified |
| T2 开源仓库 | Unleash/unleash（开源 Feature Flag 平台，支持按环境/用户动态启用或禁用功能，是「UI 禁用/降级」控制面） | https://github.com/unleash/unleash | 最流行的开源能力开关方案，可直接驱动「能力不满足则置灰入口」 | canonical·unverified |
| T3 权威工程博客 | Codelit《Graceful Degradation Patterns》（feature flags 作为降级控制面、fallback 谱系、read-only 模式） | https://codelit.io/blog/graceful-degradation-patterns | 系统阐述「探测失败兜底」的降级模式与分类 | unverified |
| T4 系统教程 | Dev.to Alex Casalboni《Graceful Degradation in Practice》（FeatureOps / 运行时降级实操） | https://dev.to/alexcasalboni/graceful-degradation-in-practice-how-featureops-builds-real-resilience-1p4i | 实践经验型教程，覆盖 kill-switch / fallback 落地 | unverified |
| T5 技术社区 | mercari/production-readiness-checklist《Graceful Degradation》（含「API not ready, try later」StackOverflow 讨论引用） | https://github.com/mercari/production-readiness-checklist/blob/master/docs/concepts/graceful-degradation.md | 社区维护的生产就绪 checklist，引用具体 SO 讨论，贴合「兜底契约」 | unverified |

**链路落地建议**：① 在配置模型时，读取厂商能力声明（如可灵 Capability Map、各 SDK 的 `@deprecated`/`supportedFeatures` 标注）写入本地 `capabilityManifest`；② 渲染视频入口前先查 manifest，能力缺失则 `disabled`+tooltip「当前模型不支持视频生成」；③ 运行时首次调用前做一次轻量探测（capability probe / ping），失败则按 graceful-degradation 进入兜底：隐藏视频面板 → 提示「请在设置中配置支持视频的模型」→ 不抛出未捕获异常。

---

## 102. 媒体资产管理

核心问题：视频产物落盘策略、缩略图生成、内置安全播放器、存储配额、Windows 中文路径与编码（GBK/UTF-8）。

| 类型 | 标题 | URL | 权威性说明 | 验证状态 |
|------|------|-----|-----------|----------|
| T1 官方文档 | Electron 官方《protocol.registerSchemesAsPrivileged》+《Security》教程（自定义 scheme 安全加载本地资源，避免 `file://` 风险） | https://www.electronjs.org/docs/latest/api/protocol#protocolregisterschemesasprivilegedcustomschemes | 一手官方文档，是本地媒体安全落盘/播放的基座 | canonical·unverified |
| T2 开源仓库 | @dimensional-innovations/electron-asset-loader（把远程资源预下载到本地 `userData`，经自定义 scheme 提供） | https://yarnpkg.com/en/package/@dimensional-innovations/electron-asset-loader | 开源，解决「产物落盘 + 本地安全访问」的可复用模式 | canonical·unverified |
| T3 架构/工程文档 | DeepWiki《Media Processing Pipeline》（某开源图片/视频管理项目的 import→分析→缩略图→去重→存储管线） | https://deepwiki.com/xingBaGan/image-management/2.5-media-processing-pipeline | 真实项目的媒体处理架构文档，覆盖时长提取/缩略图/哈希去重 | unverified |
| T4 系统教程 | Dev.to bme《Building a Secure Local Video Player in Electron》（自定义协议 + 安全 preload + 缩略图生成 + CSP） | https://dev.to/bme/building-a-secure-local-video-player-in-electron-3ki9 | 端到端系统教程，含缩略图与本地播放实现 | unverified |
| T5 技术社区 | CSDN《vue+electron 实现图片视频本地缓存》（`userData` 缓存目录、`webRequest` 落盘、Windows 反斜杠路径处理） | https://blog.csdn.net/airdark_long/article/details/126509209 | 社区实战博客，覆盖中文 Windows 路径与本地缓存坑 | unverified |

**补充说明（B站生态覆盖）**：B站必剪(必剪创作)的语音转字幕能力有开源复用——`github.com/SocialSisterYi/bcut-asr` 与 `github.com/Forgot-Dream/STS-Bcut`（必剪 API 开源实现），可用于视频产物的字幕后处理，属于「媒体资产管理」的国产生态环节。Windows 中文路径注意：ffmpeg/ffprobe 子进程在 GBK 代码页下易乱码，需 `chcp 65001` 或显式传 UTF-8 参数并校验返回（相关 ENOENT 问题见 103/105 区 SO#38361996）。

---

## 103. 异步长任务 UX

核心问题：长视频生成（数十秒~数分钟）的进度反馈、可取消、失败重试、断点续跑、后台任务面板。

| 类型 | 标题 | URL | 权威性说明 | 验证状态 |
|------|------|-----|-----------|----------|
| T1 官方文档 | Electron 官方《Progress Bars》教程（`BrowserWindow.setProgressBar`，determinate/indeterminate，任务栏进度） | https://www.electronjs.org/docs/latest/tutorial/progress-bar | 一手官方文档，任务栏进度条基座 | canonical·unverified |
| T2 开源仓库 | @spaceagetv/electron-progress-window（TypeScript 进度窗，支持 indeterminate、暂停/恢复、取消，事件驱动） | https://www.npmjs.com/package/@spaceagetv/electron-progress-window | 开源，直接提供「可暂停/可取消的长任务进度面板」实现 | canonical·unverified |
| T3 架构/工程文档 | DeepWiki triplex《Utilities – progress-bar》（`AbortSignal` 取消支持、indeterminate 平滑动画、主进程 IPC 集成） | https://deepwiki.com/pmndrs/triplex/8-utilities | 真实项目的进度条工程实现，含取消信号设计 | unverified |
| T4 系统教程 | （未找到专门面向「异步长任务 UX」的独立系统教程） | — | Electron 官方 Progress Bars + @spaceagetv/electron-progress-window 的 README 已覆盖「进度/取消」可操作实践；但「后台任务面板 + 断点续跑」的成体系教程缺位，建议以官方文档 + 开源库组合落地 | 无合格来源（留空） |
| T5 技术社区 | Stack Overflow#38361996（ffmpeg 在 Electron asar 中 `ENOENT`：子进程调用媒体工具的常见失败点，长任务需规避） | https://stackoverflow.com/questions/38361996 | 高票 SO，指向媒体长任务中「外部进程路径/打包」这一典型坑 | unverified |

**UX 落地建议**：任务提交即写入本地任务队列（持久化 taskId + 状态），UI 用 `electron-progress-window` 展示多任务进度条；超长任务走 indeterminate 并允许 `AbortSignal` 取消；进程退出后重启可据队列「断点续跑」未完成任务；asar 内调用 ffmpeg/ffprobe 须 `asarUnpack`/`extraResources`，避免 SO#38361996 的 ENOENT。

---

## 104. 多模态模型能力矩阵与供应商差异（2025–2026）

核心问题：Sora / Veo / 可灵 / 即梦 / 通义万相 / 海螺 / Runway / Pika 的能力边界、计费、限流、开源替代（Wan / HunyuanVideo / CogVideoX）的差异矩阵。

| 类型 | 标题 | URL | 权威性说明 | 验证状态 |
|------|------|-----|-----------|----------|
| T1 官方文档 | 阿里通义万相《Wan3 视频生成指南 + API 参考》（国产厂商能力/参数/限制一手说明） | https://help.aliyun.com/zh/model-studio/wan3-video-generation-guide | 国产厂商官方视频能力文档，列出时长/分辨率/参数上限 | canonical·unverified |
| T2 开源仓库 | Wan-Video/Wan2.2（开源视频生成模型，可作为自托管能力基线对照商业 API） | https://github.com/Wan-Video/Wan2.2 | 官方开源仓库，能力矩阵中「开源 vs 商业」对照项 | canonical·unverified |
| T3 论文/技术报告 | THUDM《CogVideoX: Text-to-Video Diffusion Models with An Expert Transformer》(ICLR 2025, arXiv:2408.06072) | https://arxiv.org/abs/2408.06072 | 一手论文，国产开源视频模型能力基准（已直接抓取确认） | canonical·verified |
| T4 系统教程 | 博客园《国产视频生成模型横评/对比》（多厂商参数、效果、可用性对比教程） | https://www.cnblogs.com/geo-ai-1688/p/22675368 | 中文横评教程，便于快速建立能力矩阵 | unverified |
| T5 技术社区 | 澎湃新闻《Sora vs 可灵》能力差异讨论（社区向的供应商差距解读） | https://m.thepaper.cn/newsDetail_forward_32149069 | 媒体/社区讨论，反映真实用户侧的能力认知差异 | unverified |

**补充说明（国产厂商全覆盖）**：
- **智谱**：见 100-T1（视频生成异步 API，verified）。
- **可灵**：见 101-T1（Capability Map 能力声明）。
- **通义万相**：见 104-T1（Wan3 指南）。
- **海螺(MiniMax)**：`platform.minimax.io/docs/guides/video-generation`（视频生成官方指南，canonical·unverified）。
- **即梦(字节 Seedance)**：`docs.byteplus.com/de/docs/ModelArk/1520757`（ModelArk 视频生成任务 API，canonical·unverified）。
- **B站生态**：见 102 补充说明（bcut-asr / STS-Bcut 必剪开源）。
- 开源对照论文另含 Wan `arxiv.org/abs/2503.20314`、HunyuanVideo `arxiv.org/abs/2412.03603`；社区差异讨论另见 `vllm-project/vllm#32685`（开源推理对视频模型能力的支持进展）。

---

## 覆盖度自评

| 领域 / 来源类型 | T1 官方文档 | T2 开源仓库 | T3 论文/报告/架构 | T4 系统教程 | T5 技术社区 | 该领域是否齐 5 条 |
|----------------|-----------|-----------|-----------------|-----------|-----------|--------------|
| 100 视频生成 API 抽象与任务模型 | ✅智谱(verified) | ✅openai-node | ✅Sora 报告 | ✅ReelMind | ✅openai-node#1778 | 是（5/5） |
| 101 模型能力声明与能力探测 | ✅可灵 Capability Map | ✅Unleash | ✅Codelit | ✅Dev.to 实践 | ✅mercari checklist | 是（5/5） |
| 102 媒体资产管理 | ✅Electron protocol | ✅electron-asset-loader | ✅DeepWiki 管线 | ✅Dev.to 本地播放器 | ✅CSDN 本地缓存 | 是（5/5） |
| 103 异步长任务 UX | ✅Electron 进度条 | ✅electron-progress-window | ✅DeepWiki triplex | ⚠️未找到独立系统教程（留空） | ✅SO#38361996 | 否（4/5，T4 空） |
| 104 多模态能力矩阵与供应商差异 | ✅通义万相 | ✅Wan2.2 | ✅CogVideoX(verified) | ✅博客园横评 | ✅澎湃 Sora vs 可灵 | 是（5/5） |

**总体覆盖**：25 格中 **24 格**有真实检索来源，仅 **103-T4** 留空（无专门「异步长任务 UX」系统教程，已如实标注并给出替代落地组合）。

**国产厂商覆盖核对**：智谱(100-T1 verified)、可灵(101-T1)、通义万相(104-T1)、海螺(104 补充)、即梦(104 补充)、B站(bcut-asr/STS-Bcut，102 补充) —— 六项全覆盖。

**验证状态分布**：canonical·verified = 2（智谱文档、CogVideoX 论文，均直接抓取）；canonical·unverified = 多数官方文档/官方仓库（经检索确认存在但未直接抓取，主因 Cloudflare 拦截或仅索引级确认）；unverified = 社区/博客/教程类（检索确认存活）。

**关键风险标注**：OpenAI Sora 2 / Videos API 将于 **2026-09-24 弃用**（检索日 2026-09-18，仅余 6 天），依赖该接口的能力需引导用户转向可灵/即梦/通义万相/海螺等仍可用的国产或 Veo 等替代，并在 capability gating 层据此动态禁用。
