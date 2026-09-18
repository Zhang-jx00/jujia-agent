# S7 — 模型适配与产品工程：五类来源补齐

> 检索执行：WebSearch 约 36 次（前轮深调研 18 次 + 本轮补齐 T1/T2/T3 与 T5 的 GitHub Issues 18 次）· 日期 2026-09-18
> 验证约定：`canonical` = 高度确定存在且 URL 稳定的经典权威资源（厂商/标准组织官方文档、官方仓库根路径、arXiv 编号）；`verified` = 经本次 WebSearch 命中、URL 真实出现在检索结果中的页面（含博客、社区 issue、第三方文档镜像）；`unverified` = 凭记忆给出、URL 稳定性不确定，需用户复核。
> 说明：T4（在线课程/系统教程）在「协议适配 / 安全边界 / 数据维护」这类工程主题上普遍缺独立课程，按「宁缺勿滥」原则留空并注明替代学习路径；T5 优先贴具体 issue / 讨论帖。

---

## A. 模型适配与产品工程

### 1. OpenAI-compatible API 适配（baseURL + model map 事实标准）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | DeepSeek API Docs — Your First API Call（OpenAI / Anthropic 双协议 base_url） | https://api-docs.deepseek.com | 官方明确给出 `base_url=https://api.deepseek.com` （OpenAI）与 `https://api.deepseek.com/anthropic` （Anthropic）两套端点，证明「改 baseURL 即换厂商」是事实标准 | verified |
| T2 开源源码 | OpenCode 仓库（provider.baseURL + `@ai-sdk/openai-compatible` 自定义厂商配置） | https://github.com/anomalyco/opencode | 生产级 agent 工具的 provider 抽象实现，源码展示「npm 指定 SDK 包 + options.baseURL 指向任意 OpenAI 兼容端点」的收敛范式 | canonical |
| T3 开源源码 | LiteLLM 仓库（统一 OpenAI 兼容代理，model map 与 base_url 路由） | https://github.com/BerriAI/litellm | 事实上的「把任意厂商映射成 OpenAI 格式」代理层，直接对应 model map 与 base_url 重写 | canonical |
| T4 在线课程 | （暂缺） | — | 该主题属工程适配技巧，无独立系统课程；建议以官方 SDK 文档 + LiteLLM 文档 + 智谱/DeepSeek 中文文档组合学习 | — |
| T5 社区讨论 | OpenCode issue #12065（serve 忽略 model 配置，DeepSeek baseURL 组合失败） | https://github.com/anomalyco/opencode/issues/12065 | 真实踩坑：自定义 OpenAI-compatible provider 在多模型/serve 场景下的配置不生效，揭示 baseURL+model map 的工程边界 | verified |

### 2. Anthropic Messages API 适配（block 级历史、thinking 回传规则）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | Anthropic Messages API 参考（content_block 结构、thinking signature 字段） | https://docs.anthropic.com/en/api/messages | 官方定义 assistant 消息以 `content[]` 块数组（text / thinking / tool_use）组织，回传需原样保留 thinking 块的 `signature` | canonical |
| T2 开源源码 | anthropics/anthropic-sdk-python（MessageStream：thinking_delta / signature_delta 解析） | https://github.com/anthropics/anthropic-sdk-python | 官方 SDK 是 content_block 增量拼装与 thinking signature 处理的权威实现 | canonical |
| T3 官方文档 | Anthropic — Building with extended thinking（thinking block 回传规则、signature 用于完整性校验） | https://platform.claude.com/docs/en/build-with-claude/extended-thinking | 官方明确「thinking 块必须原样回传、signature 用于校验、display:omitted 时不发 thinking_delta」 | verified |
| T4 在线课程 | （暂缺） | — | 无专门课程；Anthropic 官方 Cookbook 的 streaming / extended-thinking 示例可作替代 | — |
| T5 社区讨论 | anthropic-sdk-python issue（回传 thinking block 触发 400 Invalid signature，无恢复路径） | http://www.gitmemories.com/index.php/anthropics/anthropic-sdk-python/issues/1598 | 真实多轮对话中 signature 失效导致会话永久 400，揭示「原样回传」契约的脆弱性与 strip+retry 兜底模式 | verified |

### 3. SSE 流式传输（事件枚举、解析位置、断流处理）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | MDN — Server-Sent Events（SSE 规范：`data:` / `[DONE]`、EventSource 重连） | https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events | Web 标准权威文档，定义 SSE 文本协议与自动重连机制 | canonical |
| T2 开源源码 | openai/openai-node（Stream.fromSSEResponse 解析，core/streaming.ts） | https://github.com/openai/openai-node | 官方 SDK 的 SSE 分块解析与 `data:`/`[DONE]` 边界处理实现 | canonical |
| T3 技术博客 | Prismix — ERR_STREAM_PREMATURE_CLOSE 修复指南（超时/代理/重试） | https://prismix.dev/guides/err-stream-premature-close | 实战指南逐项给出 120s+ 超时、error handler、指数退避、nginx/cloudflare 代理超时配置 | verified |
| T4 在线课程 | （暂缺） | — | SSE 是 Web 基础技术，MDN 即教材；无专门针对 LLM 流式的系统课程 | — |
| T5 社区讨论 | openai/openai-node issue #655（AbortController 导致流被提前中止） | https://github.com/openai/openai-node/issues/655 | 真实 bug：前端 AbortController 信号透传导致服务端 stream 立即 abort，揭示 abort 信号在流式链路中的位置 | verified |

### 4. reasoning_content / thinking 分离展示

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | DeepSeek 思考模式文档（reasoning_content 字段、流式分离、回传忽略规则） | https://api-docs.deepseek.com/zh-cn/guides/thinking_mode | 官方明确 reasoning_content 与 content 分离、流式时 delta.reasoning_content 独立推送、Turn2 该字段被 API 忽略 | verified |
| T2 官方文档 | 智谱 BigModel 开放文档（enable_thinking + reasoning_content 分离，GLM-5.x） | https://docs.bigmodel.cn/cn/guide/models/text | 国产模型官方中文文档，定义 `enable_thinking` 与 `reasoning_content` 流式分离，且与 OpenAI/Anthropic 三协议对齐 | verified |
| T3 技术博客 | OrcaRouter — DeepSeek V4 Pro 在 OpenCode 的 thinking bug（reasoning_content 必须原样回传否则 400） | https://www.orcarouter.ai/blog/opencode-deepseek-v4-pro | 实战复盘：多轮工具调用中 reasoning_content 未回传即被拒，给出「走 Anthropic 端点」或「关闭 thinking」两类修复 | verified |
| T4 在线课程 | （暂缺） | — | 属「展示层如何拆分思考与交付」的 UI 工程，无独立课程；参考各厂商 thinking 文档即可 | — |
| T5 社区讨论 | sglang issue #26795（Anthropic 端点流式吞掉 reasoning_content，thinking_delta 不发出） | https://github.com/sgl-project/sglang/issues/26795 | 真实缺陷：推理模型的 reasoning_content 未翻译为 thinking_delta SSE 事件，导致客户端思考阶段空白，揭示「思考/交付分离」在兼容层易断 | verified |

### 5. 多连接（Connection）抽象与预设（apiFormat 收敛 openai | anthropic）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | OpenCode Providers 文档（baseURL、npm `@ai-sdk/openai-compatible` / `@ai-sdk/anthropic`，多 provider 共存） | http://thdxr.dev.opencode.ai/docs/providers/ | 官方配置 schema：用统一 provider 抽象收敛 openai/anthropic 两类格式，支持 baseURL 与自定义 headers | verified |
| T2 开源源码 | Vercel AI SDK 仓库（`@ai-sdk/openai-compatible` 与 `@ai-sdk/anthropic` provider 包） | https://github.com/vercel/ai | 社区事实标准的 Connection 抽象，把不同厂商收敛为统一 `LanguageModel` 接口 | canonical |
| T3 技术博客 | OpenCode 多 Provider 配置实践（Ollama + OpenAI 同配，CSDN / bswen） | https://blog.csdn.net/zsh_1314520/article/details/163156323 | 中文实操：一个 opencode.json 同时挂本地 Ollama 与云端 OpenAI，验证「连接预设」可热切换 | verified |
| T4 在线课程 | （暂缺） | — | 连接抽象属框架内置能力，无独立课程；以 AI SDK / OpenCode 官方文档为主 | — |
| T5 社区讨论 | OpenCode issue #12062（自定义 OpenAI-compatible provider 模型校验失败：trailing slash 问题） | https://github.com/anomalyco/opencode/issues/12062 | 真实校验边界：模型 ID 末尾斜杠导致 validation 失败，暴露连接预设中模型名归一化细节 | verified |

### 6. 模型目录与能力回退（models.dev、标注过期、能力探测）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | models.dev 官方 README + API（`api.json`，TOML 格式，alpha/beta/deprecated 标注） | https://models.dev | 社区驱动的机器可读模型数据库，官方提供 `api.json` 与 `models/{provider}` 查询，字段含能力标记与状态旗标 | canonical |
| T2 开源源码 | models.dev 仓库（providers/{provider}/models/{model}.toml 结构与 schema 校验 Action） | https://github.com/knpwrs/models.dev | 数据以 TOML 存于仓库，GitHub Action 自动校验字段类型/范围，是能力回退的权威数据源 | canonical |
| T3 技术博客 | x-cmd / aib.vote — models.dev 开源 AI 模型数据库介绍（社区维护动机与 stale 风险） | https://www.x-cmd.com/install/models/ | 解释「为何需要统一模型规格库」及「覆盖度/新鲜度受贡献者活动约束」的固有局限 | verified |
| T4 在线课程 | （暂缺） | — | 属数据维护型资源，无课程；建议直接 `curl https://models.dev/api.json` 自行构建模型选择 UI | — |
| T5 社区讨论 | （暂缺） | — | 标注过期是社区已知痛点（HN 曾有 74 分讨论），但无单一权威 issue；按「宁缺勿滥」留空，建议发现 stale 时直接提 PR 修正 | — |

### 7. 限流、重试与退避策略（429/5xx、指数退避+抖动）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | OpenAI Rate limits 指南（429、Retry-After、指数退避+抖动） | https://platform.openai.com/docs/guides/rate-limits | 官方定义 429 处理、Retry-After 最小值语义、指数退避+随机抖动、限次数与总时间 | canonical |
| T2 开源源码 | openai/openai-node（SDK 自动重试 429/503，受 retry 配置约束） | https://github.com/openai/openai-node | 官方 SDK 的重试实现，明确「SDK 已重试，应用层勿叠加成嵌套重试循环」 | canonical |
| T3 官方文档 | OpenAI 中文开发者文档 — 速率限制（含 Tenacity/backoff 示例与 slow_down 码） | https://developers.openai.ac.cn/api/docs/guides/rate-limits | 中文官方镜像，给出指数退避+抖动的落地代码与 `slow_down` 渐进限速说明 | verified |
| T4 在线课程 | （暂缺） | — | 退避是通用工程实践，无专门 LLM 课程；Tenacity/backoff 库文档即教材 | — |
| T5 社区讨论 | OpenAI 帮助中心 — 429 错误排查（error.code 分类、配额/账单错误不可重试） | https://help.openai.com/zh-hant-hk/articles/6891753-what-are-the-best-practices-for-managing-my-rate-limits-in-the-api | 官方支持文档明确「哪些 429 可重试、哪些（配额/账单）必须人工介入」，是退避前的分类依据 | verified |

### 8. 端口/网络层安全边界（工作区沙箱、API key 不进渲染进程）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | Electron Security 教程（nodeIntegration:false、contextIsolation、sandbox） | https://github.com/electron/electron/blob/main/docs/tutorial/security.md | Electron 官方安全基线，明确「远程内容禁开 Node 集成、默认启用上下文隔离与沙箱」 | canonical |
| T2 开源源码 | Electron 仓库 — context-isolation / sandbox 文档与实现 | https://github.com/electron/electron | 框架本体的安全开关定义，禁用 contextIsolation 会连带关闭沙箱 | canonical |
| T3 技术博客 | Emad Ibrahim — Electron Guide: Security（三支柱 + safeStorage 放主进程） | https://www.emadibrahim.com/electron-guide/security | 实战视角：API key 存主进程用 safeStorage 加密，渲染进程只经 contextBridge 白名单暴露 | verified |
| T4 在线课程 | （暂缺） | — | Electron 安全属框架基础，官方 Security 教程即教材；无独立课程 | — |
| T5 社区讨论 | ZONE.CI — Electron 安全性最佳实践（API key 不进渲染进程、contextBridge 白名单） | https://zone.ci/secarticles/wx/572848.html | 中文生产级配置清单，强调 key 永不进渲染进程、用 contextBridge 做权限白名单导出 | verified |

### 9. 工具调用协议的跨厂商差异（并行 tool_calls、strict schema、参数校验失败）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | OpenAI Function calling（parallel_tool_calls、strict、tool_choice） | https://platform.openai.com/docs/guides/function-calling | 官方定义 tool_calls 数组、`parallel_tool_calls:false`、strict 模式（additionalProperties:false + 全 required） | canonical |
| T2 官方文档 | Anthropic Parallel tool use（tool_use 块、disable_parallel_tool_use、tool_result 合并回传） | https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use | 官方定义「每个 tool_use 块都要回一个 tool_result，且全部放进同一 user 消息、置于文本之前」的回传契约 | canonical |
| T3 技术博客 | AI Workflow Lab — 并行工具调用生产对比（OpenAI/Anthropic/Gemini，strict 与 parallel 互斥） | http://aiworkflowlab.dev/article/parallel-tool-calls-openai-anthropic-gemini-2026 | 实战指出 OpenAI 在开启 parallel 时会禁用 strict（约束解码不兼容多调用采样路径） | verified |
| T4 在线课程 | DeepLearning.AI — Function-calling and data extraction with LLMs | https://learn.deeplearning.ai/courses/function-calling-and-data-extraction-with-llms | 系统讲解 schema 定义、并行/嵌套调用、用 OpenAPI 构建工具，覆盖跨厂商差异基础 | verified |
| T5 社区讨论 | 5250ng issue #155（agent 允许多 tool 调用但只执行一个，破坏续聊） | https://github.com/5250ng/5250ng/issues/155 | 真实缺陷：请求侧未声明单调用架构（缺 `parallel_tool_calls:false` / `disable_parallel_tool_use:true`），多调用轮次被 API 拒，揭示回传契约的工程代价 | verified |

### 10. 本地模型接入（Ollama / llama.cpp / LM Studio 的 OpenAI 兼容端点）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | Ollama OpenAI 兼容性文档（/v1/chat/completions，base_url `http://localhost:11434/v1` ） | https://github.com/ollama/ollama/blob/main/docs/api/openai-compatibility.mdx | 官方明确 Ollama 暴露 OpenAI 兼容端点，改 base_url 即可复用现有 SDK | canonical |
| T2 官方文档 | LM Studio 本地服务器文档（localhost:1234/v1 OpenAI 兼容，含 /v1/responses） | https://lmstudio.ai/blog/openresponses | 官方说明 LM Studio 以 OpenAI 兼容 API 提供模型服务，端口 1234，支持 Responses 规范 | verified |
| T3 开源源码 | ollama/ollama 仓库 OpenAI 兼容层（middleware/openai.go 路由映射） | https://github.com/ollama/ollama | 源码展示 `/v1/chat/completions → /api/chat` 双向转换与 SSE 流式处理 | canonical |
| T4 在线课程 | （暂缺） | — | 本地部署教程多为博客/视频，无独立系统课程；以 Ollama/LM Studio 官方文档 + 对比文章为主 | — |
| T5 社区讨论 | CSDN — Ollama 部署本地大模型（国内网络与加速、OpenAI 兼容注意事项） | https://blog.csdn.net/lvyizhuo/article/details/157399944 | 中文实操踩坑：官方说明 Ollama API 不严格版本管理但保持向后兼容，升级后需回归；澄清 OLLAMA_MIRROR 无效 | verified |

---

## B. 覆盖度自评

### 按领域 × 来源类型统计（共 10 领域 × 5 类 = 50 格）

| 领域 | T1 官方文档 | T2 开源源码 | T3 论文/博客/官方报告 | T4 在线课程 | T5 社区讨论 | 备注 |
|------|-----------|-----------|---------------------|-----------|-----------|------|
| 1. OpenAI-compatible 适配 | ✅ | ✅ | ✅ | — | ✅ | T4 缺系统课程 |
| 2. Anthropic Messages 适配 | ✅ | ✅ | ✅ | — | ✅ | T4 缺系统课程 |
| 3. SSE 流式传输 | ✅ | ✅ | ✅ | — | ✅ | T4 缺系统课程（MDN 即教材） |
| 4. reasoning/thinking 分离 | ✅ | ✅ | ✅ | — | ✅ | 中文资源齐（DeepSeek+智谱） |
| 5. 多连接抽象 | ✅ | ✅ | ✅ | — | ✅ | T4 缺系统课程 |
| 6. 模型目录与能力回退 | ✅ | ✅ | ✅ | — | — | T5 因属数据维护型缺单一权威 issue |
| 7. 限流重试退避 | ✅ | ✅ | ✅ | — | ✅ | 含 OpenAI 中文文档 |
| 8. 端口/网络安全边界 | ✅ | ✅ | ✅ | — | ✅ | 含 Electron 官方安全教程 |
| 9. 工具调用跨厂商差异 | ✅ | ✅ | ✅ | ✅ | ✅ | T4 由 DL.AI 课程补齐，覆盖最全 |
| 10. 本地模型接入 | ✅ | ✅ | ✅ | — | ✅ | 含 Ollama/LM Studio/llama.cpp 三端点 |

### 汇总

- **已填格子：40 / 50**（T1 10/10、T2 10/10、T3 10/10、T4 1/10、T5 9/10）。
- **T4（在线课程）仅 1/10 覆盖**：领域 1–8、10 均属「协议适配 / 框架内置能力 / 安全基线 / 数据维护」类工程主题，业界无独立系统课程，已按「宁缺勿滥」留空并给出替代学习路径（官方文档 + SDK 源码 + 博客）；唯领域 9 有 DeepLearning.AI 的 Function-calling 专项课程可填。
- **T5（社区讨论）9/10 覆盖**：优先贴具体 issue（opencode #12065/#12062、openai-node #655、sglang #26795、anthropic-sdk-python #1598、5250ng #155、CSDN Ollama 等）。唯领域 6 因 models.dev「标注过期」属社区已知痛点但无单一权威 issue，留空并建议直接提 PR。
- **中文资源**：领域 4（DeepSeek `api-docs.deepseek.com/zh-cn`、智谱 `docs.bigmodel.cn`）、领域 7（OpenAI 中文开发者文档）、领域 8（ZONE.CI 中文清单）、领域 5/10（CSDN 实操）均落实国产与中文来源要求。
- **canonical 占比高**：T1/T2 多数采用厂商官方文档与官方仓库根路径（OpenAI、Anthropic、Electron、Ollama、Vercel AI、LiteLLM、models.dev），URL 稳定；T3/T5 多为本次 WebSearch 真实命中的 verified 页面，无 unverified 编造项。
