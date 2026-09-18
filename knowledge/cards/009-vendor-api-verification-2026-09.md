---
topic: 厂商接口与模型核实记录（2026-09-18）
date: 2026-09-18
phase: W2 复核阶段
sources: 各家官方文档 + 端点实测（见文末 URL 与探测结果）
---

# 009 · 厂商 API 核实记录（含废弃项）

> **核实方式**：① 抓取官方文档页面；② 用无效 Key 实测各端点（HTTP 401 = 路径有效需鉴权；
> 404 = 路径错误；000 = 网络不可达）。两条证据都留档，便于日后复查。
> **复核时点**：2026-09-18。厂商迭代快，**下一次复核必须重新核实**，不要沿用本卡片。

## 一、核实结论总表

| 厂商 | base URL（核实有效） | 当前模型 | 已废弃/过时 | 工具调用 | 实测状态码 |
|------|---------------------|----------|-------------|----------|-----------|
| DeepSeek | `https://api.deepseek.com`（`/v1` 亦可） | `deepseek-flash`（V4.1-Flash）、`deepseek-v4-pro` | **`deepseek-chat`、`deepseek-reasoner` 于 2026-07-24 弃用**；`deepseek-v4-flash` 名称仍接受但模型已退役，请求由 V4.1-Flash 承接 | ✓（两个模型均支持） | `/v1/chat/completions` **401**、`/chat/completions` **401**、`/v1/models` **401** |
| 智谱 BigModel | `https://open.bigmodel.cn/api/paas/v4` | **`glm-5.3`**（旗舰）、`glm-5.3-flash(X)`、`glm-5.2/5.1/5`、`glm-4.7`（`glm-4.7-flash` 免费）、`glm-4.6` | `glm-4-plus` 已不在官方模型列表中 | ✓（OpenAI 兼容 `tools` / `tool_choice`） | `/chat/completions` **401**、`/models` **401** |
| Moonshot Kimi | 国内 `https://api.moonshot.cn/v1`；全球 `https://api.moonshot.ai/v1` | **`kimi-k2.6`**（最新）、`kimi-k2.5` | `moonshot-v1-8k` 属第一代（非当前主力） | ✓（原生 tool calling） | `/v1/chat/completions` **401**、`/v1/models` **401** |
| OpenAI | `https://api.openai.com/v1` | 官方文档站点对自动化访问返回 **403**，未取得可信 ID 列表，因此**本项目不预设其模型名** | **`gpt-4o` / `gpt-4o-mini` 已废弃**；`gpt-4.1`、`o3`、`o4-mini` 为 legacy | ✓（`v1/chat/completions` 与 `v1/responses` 均支持 function calling） | 本机网络 **000（不可达）** |
| Ollama | `http://127.0.0.1:11434`（OpenAI 兼容自动加 `/v1`） | 取决于本机 `ollama pull` 的模型；官方推荐工具调用用 `qwen3` 系列 | `qwen2.5` 一代已非推荐 | ✓（`/v1` 的 `tools` 参数可用，模型相关） | 本机未安装，未实测 |

## 二、由此确定的设计原则

**「能自动发现的就不预设，能核实到官方 ID 的才写死」**

- 预设只写 **base URL +（可确认的）模型名**；对模型迭代极快或依赖本机环境的厂商（OpenAI、Ollama）
  **留空模型名**，由「测试连通」调用 `GET {base}/models` 拉真实列表回填候选（已实测该端点在
  DeepSeek / 智谱 / Moonshot 均返回 401，即路径有效）。
- 依赖「运行时发现」而不是「文档抄写」，是本项目避免引用过时模型的**结构性**手段：
  厂商换模型时用户点一下「测试」即可，不需要改代码。

## 三、对后续阶段的影响

- **W3（工具执行与权限队列）**：五家均支持 OpenAI 兼容的 `tools` / `tool_calls`，因此工具调用层
  可以统一按 OpenAI 格式实现；但**流式下的工具调用增量**（`delta.tool_calls` 分片拼接）需要单独
  设计与测试，不能假设一次性到齐。
- **DeepSeek 新增参数**：支持 `thinking: {type: "enabled"}` 与 `reasoning_effort: "low|high|max"`；
  另有 **Anthropic 格式端点** `https://api.deepseek.com/anthropic`。这属于 provider 能力差异，
  应进 capability registry（W5），不要在 UI 里硬编码。
- **本机网络限制**：`api.openai.com` 在本环境不可达（000，与 github.com 首页被阻断同源）。
  连接测试失败时 UI 会原文回显错误，需注意区分「密钥错误（401）」与「网络不可达（000）」。

## 四、核实来源

- DeepSeek 官方文档（首页与模型/价格页）：https://api-docs.deepseek.com/
- 智谱开放文档·模型概览：https://docs.bigmodel.cn/cn/guide/start/model-overview
- Moonshot 开放平台：https://platform.moonshot.cn/ ；文档 https://platform.moonshot.cn/docs
- OpenAI 开发者文档·模型对比（自动化访问被拒 403）：https://developers.openai.com/api/docs/models/compare
- Ollama OpenAI 兼容说明（官方博客工具调用公告 + `/v1/chat/completions` 兼容端）：https://ollama.com/blog/tool-support

> 二手来源（如第三方模型聚合站）仅用于交叉印证，**未作为写死模型名的依据**。
