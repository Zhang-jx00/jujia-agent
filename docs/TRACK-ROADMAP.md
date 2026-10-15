# 轨道路线图（TRACK ROADMAP）—— 唯一排期与编号规范

- **建立**：2026-09-23（轨道回归计划 1 排查发现"里程碑编号在三份文档里指不同东西"，此处定死）
- **用途**：① **里程碑编号规范**（唯一权威，其它文档一律引用）② **修复队列** ③ **开发队列** ④ 编号登记。
- **与其它文件的关系**：
  - `docs/PROGRESS.md` = **完成状态**的唯一权威；
  - `docs/TRACK-PLANS.md` = **轨道分类法与命名规则**；
  - `review/TRACK-SWEEP-N.md` = **排查记录**；
  - 本文件 = **排期与编号**。

---

## 一、里程碑编号规范（唯一权威）

**编号是连续的 M1–M23，分三段来源**，各自只在下方这一处定义，其它文档一律引用：

### 第一段：核心模块 M1–M12（定义在 `docs/PLAN.md` §4）

| 编号 | 模块 | 当前状态 |
|------|------|----------|
| M1 | 桌面壳与工程底座 | ✅ 已落地 |
| M2 | 连接与模型适配 | ✅ 已落地 |
| M3 | 聊天与流式 UI | ✅ 已落地 |
| M4 | 工具执行与权限 | ✅ **收尾完成**（2026-10-12）：权限门 + **`run_command`**（`v0.33.0-铺设8`：每次硬 ask + 工作目录守卫 + 环境脱敏 + 超时/输出上限）· **命令级前缀策略**（`v0.65.0-加固12`：`deny`/`ask` 可窄到命令行的字面前缀，含组合符不算命中、整词边界、只有声明了 `commandArg` 的执行类工具参与）· **执行审计**（工具侧 `v0.66.0-铺设11` 落盘前剔密 + 三扇非工具门 `v0.67.0-铺设12`；内置终端不入账见 T41）· **实时输出**（`v0.68.0-铺设13`：工具卡边跑边看见，尾部快照 + 双上界，半截输出不落盘）。**两项明确不做**：命令级 `allow`（停牌①，校验层直接拒）、"转后台"（T42，与用户手驱动的内置终端重复） |
| M5 | Agent Loop（agent-core） | ✅ 已落地 |
| M6 | 记忆与上下文 | 🔶 读侧装配 ✅ · 写入侧已接线（`v0.37.0`）· **会话持久化已交付（`v0.38.0-铺设6a`）**；**6b 已交付（`v0.44.0-铺设6b`：compact + 结束记要点 + 注入隔离界面）** —— M6 的"剩"里只剩多设备同步一类明确不做的项 |（`v0.37.0-铺设10`：`append_note` 工具 + 界面显式入口 + 路径守卫）**；剩"会话结束自动摘要写入"（依赖尚未存在的 compact，归铺设计划 6） |
| M7 | 扩展生态（MCP / Skills / Hooks / 定时任务） | ✅ **收口**（MCP / Skills / Hooks 早交付；**定时任务 `v0.69.0-铺设7`**：RRULE 子集自解析 · 补跑至多一次并报数 · 定时 ≠ 免审批） |
| M8 | 终端与 Git | ✅ **收口**（`v0.56.0-铺设9`：终端 + git 接线 + 逐行 patch + **`push`**）· 六→七条 `GIT_*` 通道 · `git-gate.ts` 唯一判档（只读不问 / 暂存软 ask / **提交与推送硬 ask**）· 剩余**不在 M8 的 DoD 里**：分支、stash、冲突解决（逐行 patch 已随 M19a 交付：`GIT_DIFF` 扩 `mode: patch`，e2e 第 37 步） |
| M9 | **无限画布工作流** | ✅ **四批齐、已收口**：M9a（`v0.50.0-M9a`）：图契约与纯规则（`.strict()` + 成环/重复边/悬空端点/缺配置/五条上限/键名扫描带显式豁免清单）· 纯编排层（拓扑序 / 失败与被拒都停 / 取消传播 / 步数上界）· `json-store` 同源持久化 · 主进程 runner（只经 `runTool` 与 agent-loop 的同一 provider 层，接线锁钉死）· React Flow 界面（懒加载）· `docs/LINKAGE-M9.md` 接驳契约；**B1（`v0.52.0-M9b-B1`）**：对齐辅助线与吸附（先网格后对齐、幂等）/ 命令面板 / 补齐 M9a 漏做的网格吸附与右键·双击建节点；**B2（`v0.53.0-M9b-B2`）**：局部重跑（范围 = 该节点 + 全部下游闭包、整体重置重跑、上游不动、不引入"过期"概念、复用同一 runner 方法）；**B3（`v0.54.0-扩容2`）**：条件分支（真/假两出口 + `skipped` 不传播 + 关键词判定在纯编排层；**界面补账 Handle** —— 此前"连线"在界面不可达）；**有界循环 = B3b 候选**（未排）；**子代理节点归 M14**（画布侧只留接线口占位，能力表禁宣称）；**CodeMirror（M19b 评估）触发判据**：出现真实的大文件/多文件编辑需求（有使用反馈或 perf 数据）且体积预算允许 —— 届时不重新论证，直接按 `docs/DESIGN-M19-IDE.md` §10.2 的四条验收做 |
| M10 | **内置浏览器与文档** | 🔶 **主链路 + 三档打开方式已通**：策略层 `v0.27.0` + 服务/IPC/界面/e2e `v0.31.0` + 打开方式 `v0.35.0`（外发两档每次硬 ask）；**Markdown 查看已交付 `v0.36.0-扩容3`**；**PDF 查看已交付 `v0.46.0-M19a`/`v0.47.0-M19b`**（用 `pdfjs-dist`，随 M19 与文件树一起做；cmap 与标准字体已内联进包，离线不缺字）—— **M10 到此收尾** |
| M11 | **多模态与媒体** | 🔶 **批一（对话图片输入）已交付 `v0.78.0-扩容5`**：三条入口（选择 / 拖动 / 粘贴）· 魔数准入 5MB·4 张·四格式 · 出站前剥 EXIF 等元数据（fail-closed）· 附件**不落盘**（历史写「图片未保留 ×N」）· 仅 OAI 兼容一路。**媒体生成 / 视频与"多模态门控"其余部分仍未开始**（与远程三项一起先解决表述冲突，见 `docs/HANDOVER.md` §5.8） |
| M12 | 基础设施（原子存储 / 日志 / 崩溃恢复 / 更新 / 测试） | 🔶 原子存储 ✅ · 测试 ✅ · 日志与自动更新待补 |

### 第二段：新增交付物 M13–M18（定义在 `docs/PRODUCT-GOAL.md` §2.1b）

| 编号 | 交付物 | 当前状态 |
|------|--------|----------|
| M13 | 主题与背景自定义 | ✅ **已并入 M23**（同一件事，不做两个模块） |
| M14 | 多子 agent 编排 | ⏳ 未开始（轨道扩容 4 之后） |
| M15 | 自定义权限规则表 | ✅ 已交付（按工具名 glob；**按参数 glob 刻意未做**，理由见 CHANGELOG v0.14.0） |
| M16 | 钩子事件齐备 | ✅ **七类**全部接入运行路径 |
| M17 | 长任务与断点续跑 | 🔶 **批一（任务状态机 + 崩溃恢复 + 断点续跑）已交付 `v0.79.0-铺设16`**：每轮一条任务记录（`sessions/<id>/task.json`，JsonStore 原子写）· 崩溃/强退后**读时判定**为 interrupted 并如实说"断在第几步" · 「续跑」从唯一入口继续（断点信息一次性注入系统提示），**高副作用动作重新过审批门**；**转后台不做**（T42 同批裁定）；批二边界（多任务历史 / 自动续跑 / 中途增量落盘）见 `docs/DESIGN-M17.md` §七 |
| M18 | 启动性能预算与预加载策略 | ✅ 已交付（预算与采样铁律见 `docs/PERF-BUDGET.md`） |

### 第三段：扩展架构 M19–M23（定义在 `docs/ARCH-CLOUD-IDE.md` §3）

| 编号 | 模块 | 当前状态 |
|------|------|----------|
| M19 | 轻量 IDE | 🔶 **M19a 已交付 `v0.46.0-M19a`**（文件树 / 打开 / 保存 / PDF / 逐行 diff）；**M19b 已交付 `v0.47.0-M19b`**（cmap 与标准字体**内联进包** → 离线可看中文 PDF；PDF 查看器懒加载，「文件」页签 chunk 回到 10KB）。**CodeMirror 6 评估结论：暂不引入**（等"编辑体验不足"的具体证据；若要上，验收要求已写在 `docs/DESIGN-M19-IDE.md` §10.2）|
| M20 | 远程主机接入 | ⏳ 未开始（**需先解决与"数据不出本机"的表述冲突**，见排查报告） |
| M21 | 云端 agent worker | ⏳ 未开始（同上） |
| M22 | 任务调度与路由 | ⏳ 未开始 |
| M23 | 外观系统 | ✅ 已交付（W23a/W23b） |

**已废弃的写法（全仓不得再出现）**：`M0` · `M5a` · `M5b` · `M6b` · 把阶段号 `P5` 当模块号 ·
"钩子四类"（现为七类）。
`W0–W23` 是**周次**，只表示"哪一周做的"，**不承载依赖与验收语义**。

**当前缺口（按规范编号）**：~~M9b-B3~~（**已交付** `v0.54.0-扩容2`：条件分支 + 界面 Handle 补账；
M9a/B1/B2/B3 四批齐 → **M9 收口**；有界循环 = **B3b 候选**未排，子代理归 M14）· ~~M10~~（**已收尾**：三档打开方式 / Markdown / PDF 查看全部交付）· M11 · M14 · M17 · M20–M22 · ~~M19~~（**三批已交付** `v0.46.0-M19a`/`v0.47.0-M19b`/`v0.48.0-M19c`；CodeMirror 暂不引入）· ~~M6 写入侧~~（**已交付**：`v0.37.0-铺设10` 接线 + `v0.38.0-铺设6a` 持久化 + `v0.44.0-铺设6b` 压缩与结束记要点）· M7 定时任务 ·
**M8 剩余**（分支 / stash / 冲突解决 —— **都不在 M8 的 DoD 里**，`push` 已于 `v0.56.0-铺设9` 交付） · **M4 剩余**（命令级 `allow`（属停牌①，未开口子）/ 执行审计 / 后台输出 —— 前缀 deny/ask 已于 `v0.65.0-加固12` 交付） · M12 日志与自动更新。

## 二、修复队列（轨道回归计划）

> 依据：`review/TRACK-SWEEP-1.md`。**未修完的不许标完成**；每条都有 DoD（完成判据）。

### 轨道回归计划 2（下一轮，建议顺序即下表）

| 序号 | 项 | 来源 | DoD（完成判据） |
|------|----|------|------------------|
| R-01 | **里程碑编号统一** | S5 | 全仓再无 `M5a/M5b/M6b` 等别名；PLAN §5 表结构修复；各文档归属列指向 M1–M23 ✅（本轮已做，见 §五登记） |
| R-02 | **状态权威唯一化** | S3 | `PRODUCT-GOAL` §6 与 `COVERAGE-MATRIX` 状态列**不再写状态**，改为指向 PROGRESS；过期数字全部删除 ✅（本轮已做） |
| R-03 | **给回归1 的修复补变异测试** | 复核 021 | `npm run mut` 覆盖：白名单外字段必须报错 · 会话淘汰必须挑最久未用 · 窗口关闭必须收尾；全被拦住 |
| R-04 | 死能力接线或明确降级 | M6/M7/M8（M3 类） | git 写操作、记忆写入、疲劳提示：**要么接线（含权限门），要么在文档里标为"未接线（计划）"** —— 二选一，不允许悬空 |
| R-05 | `PermissionMode` 与 `MODE_LABEL` 收敛到单一来源 | M4/M5 | 类型与文案各只有一处定义；`check:docs` 增加"同概念不得双份"的检查项 |
| R-06 | CI 门槛补齐到与声明一致 | M8 | CI 至少加 `check:docs`；smoke/e2e 若因环境跑不了，在文档里**如实写明"CI 不跑哪些"** |
| R-07 | 版本号三处一致 | M9 | `package.json` / desktop / README 头部 / CHANGELOG 最新条目四者相互对应；加一条 `check:docs` 校验 |
| R-08 | "参数 glob"表述统一 | M11 | 全文统一为"按工具名 glob（按参数 glob 刻意未做）"，PLAN/PRODUCT-GOAL 同步 |
| R-09 | PLAN §5 表与 P5 重复定义清理 | M13 | 表格列数一致；P5 只有一处定义 |
| R-10 | README 结构规整 | M14 | 去掉同名重复章节；"实现顺序"改为指向本路线图 |
| R-11 | 变异累计数口径 | M15 | 明确"按例计"并给入口径说明；README/PROGRESS/CHANGELOG 三者一致 |
| R-12 | 轻项清扫 | 轻 | `ipc.ts` 拆分为多个注册模块（≤300 行的目标）；`policy.ts` 移出 UI 文案；删占位导出 |
| R-13 | **交接验收新增的三条轻债** | 排查3（复核 025） | ① `features/permission/`（审批弹窗）与 `features/permissions/`（规则页）两个近名目录收敛为一个；② `packages/agent-core/src/commands/process.ts` 的 `killProcessTree` 补**专测**（`argv` 已有 `argv.test.ts`；`process.ts` 目前只被 exec-tool 的真实子进程用例**间接**经过，没有直接靶子）；③ 渲染层补最小单测 —— **已还，见 §三 状态行的 R-13** |

### 轨道回归计划 2 / 3 —— 进度（R-01…R-12）

| 序号 | 项 | 状态 |
|------|----|------|
| R-01 | 里程碑编号统一（M1–M23） | ✅ 回归2 |
| R-02 | 状态权威唯一化 | ✅ 回归2 |
| R-03 | 回归1 的修复补变异测试 | ✅ 回归2（变异 7/7 被拦） |
| R-04 | 死能力接线或降级 | ✅ 回归3（**降级**：删除 `MODE_LABEL`/`fatigueHint` 两个零调用方导出；**审批疲劳提示**若要做，真做在审批弹窗里 + main 侧记连续批准次数 + 补测试） |
| R-05 | `PermissionMode`/`MODE_LABEL` 收敛 | ✅ 回归3（`PERMISSION_MODES` 单一来源 + 跨包一致性锁 4 例；文案留在渲染层） |
| R-06 | CI 门槛补齐 | ✅ 回归3（CI 加 `check:docs`，并写明 CI 不跑 smoke/perf/e2e） |
| R-07 | 版本号三处一致 | ✅ 回归3（desktop → 0.25.0；加机器检查） |
| R-08 | "参数 glob"表述统一 | ✅ 回归3 |
| R-09 | PLAN §5 表与 P5 重复定义 | ✅ 回归2（随 R-01 重写） |
| R-10 | README 结构规整 | ✅ 回归3（同名章节已改；"W1→W16"改为指向本路线图） |
| R-11 | 变异累计数口径 | ✅ 回归3（README 不再写数字） |
| R-12 | 轻项清扫（`ipc.ts` 拆分 ≤300 行、`policy.ts` 移出 UI 文案） | ✅ **已完成（`v0.34.0-规整8`）**：装配根 45 行 + 11 个模块（最大 142 行），接线锁范围同步扩并加通道覆盖锁；UI 文案早随 R-04 移出；占位导出（`MODE_LABEL` / `fatigueHint`）已在回归 2 删除 |
| R-13 | 交接验收新增的三条轻债（渲染层近名目录 / `commands/process.ts` 无专测 / 渲染层零单测） | ③ **已还**（`v0.41.0-组件测试1` 起步，现为 **11 个组件文件 82 例** jsdom + 多个源码接线锁，渲染层测试文件共 23 个）· ② **部分已还**（`argv.test.ts` 自 `v0.57.0-加固4` 就在；`killProcessTree` 仍无专测 —— 旧句"`commands/` 零测试"从那一刻起就不成立，见复核 083）· ① 近名目录收敛**仍未做**（结构性改动不与修复轮混做） |

### 轨道回归计划 3（本轮之外的备选）

`utilityProcess` 迁移评估（S4 的另一半）：给出"做 / 不做 / 分几步"的明确结论与代价，**不允许继续挂着不表态**。

### 外部审查修复队列（T1…T16 · 2026-09-27 起）

> 来源：外部审查（zcode）报告，**每一条都由 WorkBuddy 逐条亲自读源码核实属实**后才登记；
> 编号沿用报告口径 `T*`（**刻意不占 `R-*`**，也刻意不开 `M*` 里程碑号 —— 见 §三 的编号冲突处置）。
> 变异编号从 **M26** 起接在既有 25 项之后。

| 序号 | 项 | 严重度 | 状态 |
|------|----|--------|------|
| T1 | 权限门顺序洞：只读放行排在敏感路径判定之前（`read_file` 读 `.env` 静默进上下文）；连带高危清单对只读失效 | **严重** | ✅ `v0.39.0-外审1`（变异 M26 / M31 / M32 · 单测 + 运行时用例 + e2e 第 24 步） |
| T2 | NTFS 备用数据流绕过：路径守卫对带盘符的路径整体跳过 ADS 检测 | **严重** | ✅ `v0.39.0-外审1`（与 T1 同一次改动；变异 M27） |
| T3 | 钩子子进程用整份 `process.env` 启动（含 API Key），与终端 / exec 的剔密不同源 | **严重** | ✅ `v0.39.0-外审1`（变异 M28：真子进程自己报告看到的键名清单） |
| T4 | 渲染层可直接写钩子配置，而钩子命令本身不过权限门 = 一次注入即持久后门 | **严重** | ✅ `v0.39.0-外审1`（`hooks:modify` 硬 ask；变异 M29 / M30 · e2e 第 25 步） |
| T12 | 8 个 `electron.vite.config.<时间戳>.mjs` 残留被提交进仓库 | 轻 | ✅ `v0.39.0-外审1`（`git rm --cached` + `.gitignore` + `cleanup.py` 模式，防复发） |
| T5 | 流事件跨会话污染（`ChatPanel` 不比对 `sessionId`）+ 渲染层零 ErrorBoundary | 中 | ✅ `v0.40.0-外审2`：`stream-routing.ts` 是唯一闸口 + 换会话必须 `resetView` 清场 + `ErrorBoundary` 挂在 `Suspense` **外层**。变异 M35 · e2e 第 26 步用两条并发流真跑一遍（正文 / 用量 / 收尾三条都盯，且核对 A 的完整回答照常落盘）。**边界如实**：错误边界"真出错时真显示"这一条需要组件测试环境（jsdom + testing-library），已拍板并补上（`v0.41.0-组件测试1`：5 例真渲染 —— 出卡、点名是哪一页、重试只重挂子树）|
| T6 | 6a 一致性三连（append 成功而 meta 失败会重放 / `running=false` 与 flush 之间可双写 / `index.json` 读写未串行化且丢失后永不写回）+ hydrate 失败静默回落新建会话 | 中 | ✅ `v0.40.0-外审2`：新增 `session-journal.ts` —— **先落消息就立刻记账、meta 失败不回退、同一会话串行**；清单的**读也放进临界区**（只串行化写仍然会互相抹掉，这条是被并发用例当场抓出来的，不是想出来的）；重建之后**写回**磁盘；hydrate 失败经 `ChatSendResult.warning` 走到界面 `role="alert"`。变异 M36 / M37 · e2e 第 23 步补了"写回"那一半 |
| T7 | `streamChat` 无读超时（`withTimeout` 全仓无调用方）→ 上游静默挂起 = 会话永久卡死 | 中 | ✅ `v0.40.0-外审2`：`createStreamTimeout` 给两条界限 —— **空闲 60s**（每来一块数据续命）+ **按单次调用**算的 300s 总限，并且与"用户主动停止"分成三种说法（都混成一个 `AbortError` 就等于把卡死显示成已停止）。变异 M33 / M34 · 7 例真 HTTP 用例。**报告的两处细节按实测更正**：① `withTimeout` 并非"全仓无调用方"，它挂在 `chat-service` 的**整轮**上 —— 真实缺陷是总时长把工具执行与审批等待都算进模型预算，会掐掉本来健康的长轮；② 卡死不是永久，而是等满 5 分钟后被当成"用户已停止"（**静默失败**，比永久挂起更难发现）|
| T8 | `json-store` 自愈时把旧主文件 rename 成 `.bak`，**覆盖上一次的备份** | 中 | ✅ **核实：不成立，未改一行代码**。`packages/shared/src/json-store.ts` 早于本轮就有"只在可解析时才转 `.bak`，损坏文件改名 `.corrupt-<ts>` 留证"，并且 `json-store.test.ts:78` 有用例钉着；本轮跑 6a 用例时那条隔离日志亲自在 stderr 里打出来。报告与既有实现不符 → 记为已核实项，不改代码 |
| T17 | **用量事件在 Loop 层被丢掉**：契约里的 `usage` 与界面的 token 行都早就存在，中间没人转发 → "看得到本轮花了多少 token"这件事从来没成立过 | 中 | ✅ `v0.40.0-外审2`（本轮 e2e 第 26 步第一次真跑流式时抓出；改成**整轮累计**转发，变异 M38 / M39）|
| T18 | 测试脚手架 `scriptedChat` 的 `finish` 字段声明了却没被用到（脚手架里的死参数） | 轻 | ✅ `v0.57.0-加固4`：**删掉**，并在注释里写清为什么不留 —— `ProviderEvent` 的联合里**没有 error 变体**（错误一律 throw），结束原因都能从"有没有 tool_calls"推出；留一个填了也不生效的字段，比没有更坏（下一个人会以为它能控制收尾）|
| T9 | 权限弹窗与主进程失同步（120s 超时后弹窗仍挂着）；`McpPanel` 批准计划只存组件 state | 中 | ✅ `v0.42.0-外审3`：主进程超时 / 窗口销毁**主动按请求 id** 推 `permission:expired`（新增只推通道），弹窗按 id 精准移除并留下"那一步没执行"的说明；回填返回 `false` 或抛错同样必须说出来。**明确不按"全关"实现** —— 排队中的另一个请求的选择权不该被连带抹掉（变异 M43 就是打这一刀）。默认界 120s 不变，可用 `JJ_PERMISSION_TIMEOUT_MS` 缩短（非法值与 <1000ms 回落默认）。MCP 半边：`mcp:pending-plan` 拉取通道 + `McpPanel` 进页时回读，切页签不再丢计划（不必重连 = 不再多起一个第三方进程）。变异 M41–M44 · 组件测试 6 例 + `permission-bridge` 7 例 + **e2e 第 28 步真跑超时**（A 过界、B 排队，四条真值含"A 的命令没在磁盘上留文件"）。**边界如实**：MCP 待批准计划的回读只有单测 + 源码锁，界面级没跑 —— 那需要一个真起的 MCP 子进程 |
| T10 | handoff 分支携带全部 `toolCalls` 却只回一条 tool 消息 → 上游续聊 400 | 中 | ✅ `v0.43.0-外审4`：**补齐**而不是剥离 —— handoff 那一轮给**每个** `tool_call` 各回一条 tool 消息（移交那条照旧，其余写 `[未执行] …没有运行（移交优先）`），并为同一批调用补上 `tool_start` / `tool_end` 事件，界面上看得见"这几个没跑"。判据是本文件所在模块头部的硬约束④（`assistant` 的每个 id 都要有配对回复），旧实现只回一条 = 破自己的约定。**为什么不选剥离**：剥离要改的是 `assistant` 那条消息本身，那是"模型请求了什么"的记录，删成"只问了 handoff"等于把历史改成我们希望的样子，审计与界面跟着失真；而且那两个调用**确实发生过**，不说就是静默消失。仓内成例是 `executeOne` 对 `[tool_not_found]` / `[invalid_args]` 的处理——跑不了就用一条 tool 消息讲清原因。变异 M47 · 4 例单测（含"只有一个 handoff"的反向对照与双 handoff）· 真值断言：那个没执行的 `write_file` **磁盘上没有留下文件** |
| T11 | 浏览器无 `will-download` 处理（页面可静默落盘）；HTTP 302 不触发 `will-navigate`，可跳出 origin 锁定 | 中 | ✅ `v0.43.0-外审4`（**两条都实测过才动手**，探针记录见复核 038，Electron 44.4.2 / Chromium 152）：① 跨站 302 / 301 的事件序列实测是 `did-start-navigation → will-redirect → did-redirect-navigation → did-navigate`，**`will-navigate` 一次都不响** —— 旧接线在任何一个重定向面前等于没有锁。现在两个钩子共用**同一个判档调用点**（`guardPageNavigation` 里唯一一处 `decideProgrammaticNavigation`，接线锁断言"只有一处"），链式重定向**逐跳**过判（探针两跳场景：第一跳同站放行、第二跳跨站被拦，目标站点台账里一个请求都没有）。② 不挂 `will-download` 时第三方页面的附件**不经询问直接落进系统"下载"目录**（探针里两个 20 字节 .tmp），现在一律 `item.cancel()` 并把文件名与理由显示出来。顺带修一处会被这次改动暴露的遮蔽：被我们拦下的那一跳 Electron 会跟着抛 `ERR_FAILED(-2)`，`did-fail-load` 与 `loadURL` 的 catch 都看得见它 —— 不加"这是我们拦的"一次性标记，界面上真实的那句理由会被"网页加载失败"盖掉（**新断言第一次跑就是这样红的**）。变异 M48 / M49 · e2e 第 15、16 步原地扩断言（不插新步骤，编号不动） |
| T13 | `vitest.config` 的 `passWithNoTests: true` 关掉或加"至少 N 个测试文件"断言 | 轻 | ✅ `v0.57.0-加固4`：**两项都做**，外加清掉一处实测发现的缺陷 —— 配置里原本有**两个同名 `include` 键**（后者覆盖前者，第一行从来没生效过）。① `passWithNoTests` 删掉（收 0 个文件也退出 0 = 门禁空转）；② `check:docs` 新增断言：**磁盘上每个测试文件都必须落在 include 范围内** + include 只许写一份 + `passWithNoTests: true` 不许回来（现扫配置与磁盘，不写死清单）|
| T14 | CI 补门：`license:check` 进 CI；`mut` 做成 `workflow_dispatch` 独立 workflow | 轻 | ✅ `v0.57.0-加固4`：`license:check` 进步进 CI；新建 `.github/workflows/mutation.yml`（只 `workflow_dispatch`，第一步 `git diff --exit-code` 守住"变异必须在干净基线上"）。**再加一条机器断言**（否则这次补齐还是会慢慢漂回去）：`check:docs` 扫 `.github/workflows/`，要求 workflow 里的 `npm run X` 都存在、图形类门禁（e2e/smoke/perf）**不许**出现在 ci.yml、变异必须在独立文件里且**不在** ci.yml。**如实**：YAML 只做了结构核对（脚本名、触发器、步骤存在），**没有在 GitHub Actions 上实跑过** —— 本机推不动 runner，第一次运行的结果才是它的验收 |
| T15 | `argv.ts` 的 `SHELL_METACHAR` 缺 `% ^ !` → `run_command` 经 shell 时 `%VAR%` 展开可绕过"元字符一律拒绝"的承诺 | 轻 | ✅ `v0.57.0-加固4`（**报告定位按实测更正后修**）：`run_command` **本来就不承诺禁 shell 语法** —— 它的边界写在模块头部："管道与重定向是需求不是漏洞"，管控点是**每次硬确认 + 人看过整条命令行 + 环境与目录受限**；`argv.ts` 那条"元字符一律拒绝"承诺的是 **MCP 服务端与钩子**。真正的暴露面在那两边：Windows 上 `npx` / `*.cmd` 会经 `cmd.exe /c`，参数里的 `%VAR%` 会被二次展开。修法：新增 `CMD_METACHAR = /[%^!]/`，**只在会经 cmd.exe 时判**（直 spawn 时它们是合法字面量，一律禁会误伤 `--format=%Y-%m-%d`）；判据抽成 `goesThroughCmd()` 由安全检查与 `buildArgvCommand` **共用** —— 之前它埋在构造函数内部，安全检查看不到，这正是 T15 能存在的形状。首建 `argv.test.ts` 28 例（该模块此前只有 MCP/钩子的间接覆盖）；变异 M104（元字符表清空）/ M105（`viaCmd` 写死 false = 两份判据重新分叉）|
| T19 | **审批弹窗对所有 ask 都显示「本次会话总是允许」**，但 `permissionRequestSchema` 里没有 `bypassable` —— 硬 ask（执行类 / 敏感路径 / 高危清单 / 钩子配置）上这个按钮**只兑现"这一次"**，用户却以为以后都不问了 | 中 | ✅ `v0.42.0-外审3`（批复选①）：载荷补 **必填** `bypassable`，五个判档点（`executor` / `git-service` / `open-with-service` / `terminal-service` / 钩子配置）各带自己那一刀的判定；硬 ask **不渲染**该按钮，改写明"此操作每次都会要求确认"（与 GitPanel 同一口径）。**引擎侧本来就没有洞**（`executor.ts` 只在软 ask 上记 `allow_always`），洞在承诺与兑现不一致。变异 M41（`current.bypassable && (` 去掉取反）+ M45（说明不分软硬见人就喊）· 组件测试 2 例。副作用如实记录：e2e 里四处原本"点「总是允许」再验压不掉"的步骤改成了"断言按钮不存在 + 点「允许一次」再验不外溢"，证明力更强（界面根本没给那条路） |
| T21 | `docs/DEPENDENCY-LICENSES.md` 的开头写"便于第三方审阅**我们分发了什么**"，但扫描对象是整个 `node_modules`（含 eslint / typescript / jsdom 等**只开发不随包分发**的依赖）—— 清单本身没有 dev/prod 之分 | 轻 | ✅ `v0.42.0-外审3`（批复：分两节、**条目全保留不删**）：§A 随安装包分发 / §B 仅构建期。口径最终落在 **`package-lock.json` 的 `dev` 标记**，两条弯路实测踩过并写进脚本注释 —— ① 按盘上 `dependencies` 走闭包：peer（`@testing-library/dom`）与 optional+peer（`postject`）走不到，**18 个构建期包被错判成分发**；② `npm ls --all --omit=dev`：把只被 dev 包引用的 `@img/sharp-wasm32` 也吐进 prod 树，与自己锁里的 `dev:true` 互相打脸。唯一一条手动覆盖 = `electron`（npm 惯例记 dev，二进制却随包分发），**只拉它自己、不拉它的下载器闭包**；判不准的（workspace 软链）一律留 §A。结果：**§A 14 个且全 MIT**（copyleft 关注点在这一节为 0）、§B 486。顺带修两处静默放行：copyleft 规则全部锚定行首 → 表达式中间的 `AND LGPL-3.0-or-later` 被当宽松（需声明 3 → **5**）；对象型 `license` 被 `String()` 成 `[object Object]` 落到"宽松"（现按原样序列化，字样露出来才算）。`THIRD_PARTY_NOTICES.md` 同步：三个需声明包族现在**机读确认只在 §B** |
| T22 | **切走「对话」页签再切回来，会话选择与连接选择都回到默认**：面板是懒加载 + 条件渲染（`App.tsx` 只在 `tab === 'chat'` 时挂），`connectionId` / `sessionId` 都是面板自己的 state。用户看到的是"聊到一半的话不见了"，而下一条消息会**悄悄开一个新会话**（旧会话在磁盘上完好，但没人告诉用户换了一条线）。设计 6b 的 e2e 时撞上：切到文档页验完再切回来，同一句话发到了没密钥的默认连接上 | 中 | ✅ `v0.45.0-T22`（批复七条全同意）：保持挂载（20 行 `KeepAlive`）+ 对话页稳定 key 的边界 + `onError` 补回"错误态重挂"。把这两个 id 提到 App 层（与"事件按会话分发"同源，切页签不该改判档口径），或在面板卸载前存一份；无论哪种都要配一条"切页签不丢当前会话"的 e2e | 
| T23 | **终端页**：切走页签即卸载，`TerminalPanel` 在 clean-up 里 `dispose()` 掉 xterm **并且 `terminalKill` 掉会话**（界面还把这句写成"会话在你离开此页时自动结束"）；更贵的一半在回来那一下 —— 点「启动」新起一个 PTY，而前一个会话的 id 渲染层已经叫不出来，没人能关它 | 中 | ✅ `v0.58.0-加固5`（按批复"**pty 常驻但可手工关闭**"，**没有**硬套 `KeepAlive`）：会话归属改成**工作区**，`start()` 走 `decideStart`（**接回 → 上限 → 审批 → spawn**）；新通道 `terminal:status` 让面板**先问再接**；切走期间的输出留有界尾部 + 分界说明补回，数据事件加 `seq` 才做到"不重不漏"；到上限**拒绝而不回收**。**权限语义零变化**（`kind:'exec'` / `bypassable:false` / fail-closed 原样，全文件仍只有一个审批入口），并由 M115 一次变异钉住 |
| T24 | **文档页**：切走页签即卸载，已打开的文件、滚动位置、分块进度全丢（路径也要重填） | 轻 | ✅ `v0.58.0-加固5`（正确解是"记住路径与阅读位置"，不是"保持挂载"）：模块级 `doc-view-state`（**只在内存、不落盘**）+ 恢复的是**路径**、内容**重读** + 读不到即忘掉记录且只试一次 | 
| T20 | `license-check` 按**目录名**记账，作用域包被写成尾巴（`@testing-library/react` 记成 `react`），既写错第三方清单名字，又与同名包互相吞掉 | 轻 | ✅ `v0.41.0-组件测试1`（改用 package.json 的 `name`；重跑后 500 个包、130 个作用域包按真名入列，0 硬拒绝 / 0 未声明）|
| T16 | 待核实清单（provider 四项 / git-service 词法守卫与 symlink / 终端 Map 无上限 / `CHAT_SEND` 长度 / TerminalPanel 双 PTY / MCP 重连与 `alive` 误报 / `SKILL.md` 信任级 / 分页口径差 1 / 气泡 key 跨页重复 / path-guard 注释宣称 8.3 短名但无实现 + `forWrite` 死参数） | 逐条核实后定 | ✅ **已核实**（`v0.58.0-加固5` 起、结论落 `review/TRACK-SWEEP-4.md` R5）：11 项 = 6 成立 / 2 部分成立（含两处报告说重了）/ 2 已被 R4 修掉 / 1 原文缺失改普查。成立项按严重度拆成 **T25–T34** 另排轮次，本轮只收那条**短名绕敏感判定**的真洞 + `forWrite` 死参数 |
| T25 | provider：带 `[DONE]` 的全垃圾流被判成成功（`openai-compat.ts:182–189` / `217–219` 的兜底只在无 `[DONE]` 时可达）—— 空回答 + 记成功账，**丢数据且没有说法** | 中 | ✅ **R7 已修**（`v0.64.0-加固11`）：新增 `StreamLedger`（`deltas` / `garbage` / `answered` / `usage` 四格分开）+ `assertProduced()`，**[DONE] 与断流两条收尾路径调同一个函数**；两种情况两种说法（垃圾负载 N 个 / 上游没给任何内容），工具轮与只有 usage 的轮明确放行不误伤 |
| T26 | provider：`finish_reason` 一律归并成 `stop`（`:308`，`done` 只有 4 个变体）→ `content_filter` / `length` 的**截断**与"正常写完"看起来一样 | 中 | ✅ **R7 已修**（`v0.64.0-加固11`）：`FinishReason` 分出 `length` / `content_filter`（厂商自造值仍按 stop，不替它编意思），`LoopResult` 新增独立一格 `truncated`（不塞进 `reason`：一个说"循环为什么结束"、一个说"这段文本不完整"），契约 `done.reason` 加 `content_filter`，`chat-service` 那句 `? 'stop' : 'stop'` 的假判断改成读它，界面 `done-notice.ts` 两条文案挂 `b.notice`（不挂 `b.error`） |
| T27 | provider：同帧的 usage 被 `text_delta` 提前 return 吞掉（`:318–323`）→ 整轮 token 累计偏小（`agent-loop.ts:213–216`） | 轻 | ✅ **R7 已修**（`v0.64.0-加固11`）：`mapPayload` 从「返回一个事件」改成「返回一组事件」，同帧的正文与 usage 不再二选一；累计口径仍在一处（`agent-loop` 的 `usageIn/Out`） |
| T28 | provider：没有 `index` 的 tool_calls 分片全并入 slot 0（`tool-call-accumulator.ts:37`）→ 省略 index 的兼容网关同一帧多调用会把 name/arguments 串成一个 | 中 | ✅ **R7 已修**（`v0.64.0-加固11`）：`push` 按**帧内位置**归位（恒归 slot 0 会把同帧两个调用串成一个），`ToolCallDelta.index` 类型改为可选 —— 协议必填而网关会省，类型要说实话；单调用省略 index 的行为不变 |
| T29 | git 链只做词法路径检查（`git-service.ts:205` 用 `resolveInsideWorkspace`，**没接** `assertRealPathInside`），而 `getDiffSummary` 对未跟踪条目直接 `readFile(join(cwd, path))`（`git.ts:222` / `245`）→ 工作区内的**软链会把外部文件内容读进界面** | 中 | ✅ **R6 已修**（`v0.60.0-加固7`）：新增 `readUntrackedFile()` —— **先 `lstat` 再决定读不读**，软链一律不读并记 `symbolic-link`，目录/权限受限记 `unreadable`，两种都在摘要 note 里**说出来**；顺带把"同一条目读两遍磁盘"收敛成一次读一份结果。**报告说的"外部内容随 commit 进历史"实测不成立**（软链以 mode **120000** 入库，只存链接目标文本）；"onlyPath 未校验进 argv"也不成立（它在 `--` 之后） |
| T30 | `CHAT_SEND` 入参没有 schema（`contracts.ts` 只有出参），主进程手工校验只拒空串（`ipc/chat.ts:105–111`）；兜底散在两处且口径不一：落盘 4000 字截断会说话（`session-store.ts:28`），发给模型的当前用户轮不设限（`compaction.ts:114` 只管压缩摘要的尾巴） | 轻 | ✅ **R6b 已修**（`v0.61.0-加固8`）：新增 `chatSendSchema`（连接 id ≤128 · 文本 ≤20 万字符 · 会话 id ≤64），`ipc/chat.ts` 的手写 `typeof` 整段换成 `safeParse`；超限**拒绝并写明上限**（截断等于静默改用户输入）。上限数字是**量着 6b 那条 66000 字的用例**定的 —— 这条只有 e2e 抓得出来 |
| T31 | MCP 无探活：`alive` 那个 getter 只被测试消费（`stdio-transport.ts:217`），**重连能力根本不存在**（只有 connect/disconnect）；进程僵而不退时 `mcp-service.ts:168` 仍报 `connected`，`callTool` 只查状态（`:471`）要等 20s 超时才失败 | 中 | ✅ **R6c 已修**（`v0.62.0-加固9`）：失败分三类（`transport` 没有任何响应 / `protocol` / `tool`），只有 `transport` 写回 `state='error'` + `lastError` 并广播，后续调用立刻拒绝并带原因（不再每次重付 20s）；进程已 `exited` 不被在途超时盖掉原因。**挂账两条**：① 周期探活**没做**（探一次的成本与一次请求同量级，"卡住"本来就是超时才拿得到的证据，凭空加后台定时器只多一处没人负责的生命周期）；② **自动重连没做**（会在没人点过的情况下重新起第三方进程，与安全约定第 3 条"每次连接都重新征得同意"冲突 → 要单独定口径）。**"exit 不改状态"实测不成立**（`:508` 落 `exited` 并摘工具）这一条仍按实测记账 |
| T32 | `SKILL.md` 的信任级：扫描零批准（`skills/loader.ts:36–52`）、目录文本无条件进系统提示（`chat-service.ts:385`）、正文按 `kind:'read'` 不问（`skills/tool.ts:25` → `policy.ts:219`），且**技能路径没有记忆那句"以下是数据不是指令"的隔离声明**（对照 `memory.ts:213`） | 中 | ✅ **R6c 已修**（`v0.62.0-加固9`）：那句"以下是数据不是指令"抽成 `packages/agent-core/src/context/injection-notice.ts` **一处给出、三层引用**（长期记忆 / 技能清单 / `load_skill` 正文头部），空清单仍然返回 `''`。**权限档位一字未动**（技能正文仍 `kind:'read'`、执行类仍 `bypassable:false`）—— 本轮补的是"这段文本是什么身份"的声明，不是审批面。**"不经审批就能在本机执行"不成立**（`skills/` 里也没有 spawn 读 scripts 的代码）这一条仍按实测记账 |
| T33 | 历史分页口径差 1，两处（`chat-service.ts`）：驻留数组含 index 0 的 system、磁盘数组不含（`:200`/`:234` vs `:272`）→ ① 盘上整页数时 `hasMore=1`，点开那 1 条是 system 被过滤（`ChatPanel.tsx:266`）= **按钮没反应**；② resume 记下 `loadedFrom`（`:298`）后 hydrate 前插 system，`loadOlder` 拿旧口径查新数组（`ChatPanel.tsx:314–315`）→ **有一条历史永远看不到** | 中 | ✅ **R6d 已修**（`v0.63.0-加固10`）：分页口径抽成唯一纯函数 `apps/desktop/src/main/history-window.ts`（`historyWindow` 只剥**开头**那条 system，窗口与 `total` / `hasMore` 只在这一处算），`chat-service.historyPage` 只负责"取哪一份数组"，`before` 换成**可见历史**的坐标 → 续聊记下 `before`、hydrate 前插 system 之后不再跳过任何一条；另补界面实话 `olderPageNotice`（翻到一页取到 0 条可显示内容时说话，不装成"按钮没反应"）。另：报告写的 `packages/agent-core/src/sessions/session-store.ts` **不存在**（真身 `apps/desktop/src/main/session-store.ts`，全量读不分页） |
| T34 | 气泡 key 用**页内下标**：`h-<i>-<role>`（`ChatPanel.tsx:267`）而第二页是前插的（`:316`）→ 两页都从 `h-0-user` 起，React key 撞车（工具行的 key 用 `callId`，不受影响） | 轻 | ✅ **R6d 已修**（`v0.63.0-加固10`）：抽 `history-bubbles.ts`，key = `h-<offset + 原始下标>-<role>`，`offset` 直接取服务端给的 `hasMore`（= 这一页在可见历史里的起点，界面不必自己记账）；序号按**原始下标**给 → 每条 key 必落在本页区间 `[offset, offset + 本页条数)` 内，两页区间不重叠就不可能撞车，同一页重取两次 key 一字不差（React 复用 DOM、不重挂不闪）。工具行仍用 `callId`，本轮没动 |
| T35 | `scripts/cleanup.py:174` 在**项目已干净**这条最常见的成功路径上打印 `项目已干净 ✓`，而中文 Windows 控制台默认 GBK → TTY 里当场抛 `UnicodeEncodeError`（R6d 会话内实测；机制单独复现：`print('✓')` 在 gbk stdout 下必抛，`PYTHONIOENCODING=utf-8` 下正常）· 影响：收尾工具在自己最该成功的场合红着退出，容易被当成脚本坏了 | 轻 | ⬜ 待排（R12 顺带）：结尾句去掉 `✓`，或脚本入口 `sys.stdout.reconfigure(encoding='utf-8', errors='replace')`。**别用 try/except 把编码问题吞掉** —— 那会让"工具跑成功了"与"工具没输出"两种情况长得一样 |
| T36 | **取证日志的路径在提交后就失效**（R8 加固12 实测）：本轮把 TDD 的红绿 log、变异复跑 log 写在 `.tmp/` 并记进台账；收尾 `cleanup.py --apply` 把 `.tmp` 归入**缓存目录**整只移进 `.trash/<时间戳>/.tmp/.tmp/`（30 天可反悔，**内容没丢** —— 本轮那些 log 现在就在 `.trash/20261009-192352/.tmp/.tmp/` 里，已核对）。坏处在别处：台账指着一个**已经不存在的路径**当证据，下一个人（含下一轮的我自己）按路径去找会扑空，而"有证据"这句话听起来仍然成立 | 轻 | ⬜ 待排（R12 顺带）：① 取证输出写到 cleanup 不收的位置（如 `.evidence/<轮次>/`）；② 或给 cleanup 加"保留当前轮证据目录"的白名单；③ 台账口径改成**把红绿内容抄进正文**（本轮复核 061 已照此改正），只给路径不算留证 —— 与 T35 同一个原则：**别让"看起来有证据"顶替"真的有证据"** |

| T37 | **权限规则文件读坏了会静默变成"没有规则"**（并行只读审计提出，**本轮亲自复看源码成立**）：`packages/shared/src/json-store.ts` 的 `readJsonSafe` 主→备→默认值三段都不抛，返回 `{ source: 'default', recovered: true }`；而 `apps/desktop/src/main/permission-rules-store.ts:53-56` 只取 `.data.rules`，**source / recovered 全丢** ⇒ 用户写的 `deny` 悄悄不再生效，界面显示"还没有任何规则"。与刚交付的 `argPrefix` 是同一个洞面：**规则看不见 = 规则没生效** | 严重 | ⬜ 待排（R10 与"落盘失败要说话"同批）：把 `source/recovered` 一路传到权限页 —— 损坏时明说"规则文件读不出来，已按空表运行（备份在 `<file>.bak` / `.corrupt-*`）"，**不静默回退**；配一条变异（摘掉降级提示）与一条测试 |
| T38 | **渲染进程崩溃不收尾挂起的审批**（并行只读审计提出，**本轮亲自复看成立**）：`apps/desktop/src/main/index.ts:90-92` 的 `render-process-gone` 只 `console.error`，而 `permission-bridge.ts` 头部契约明写"窗口销毁**或渲染进程崩溃** → 所有挂起请求立即以 timeout 收尾"；`cancelAll` 只接在 `window-all-closed`（`:81`）上 ⇒ 弹窗所在渲染进程崩了，工具调用仍要**空等满 120 秒**，而审计里会记成一次"超时"而不是"崩溃" —— **后果盖掉事实**（与加固9 的 MCP 状态那条同族） | 中 | ✅ 排 R8.5：`render-process-gone` 调 `cancelAll('渲染进程已退出')`，理由要说得出**是谁退的**；配测试 + 变异。理由：执行审计要能区分"用户没答"与"没人在答"，这一行不通导出的账就是错的 |
| T39 | **Releases 停在 v0.9.0，README 却把使用者导向那儿**（并行只读审计提出，**本轮亲自核 GitHub releases API 成立**）：唯一的**已发布** release 是 `v0.9.0-w9a`（2026-09-22），另有一条 draft `v0.14.4-mcpfix`；仓库版本已到 0.65.0。而 `README.md` §安装方式 A 写"（推荐给使用者）到 Releases 下载" —— 点进去拿到的是**明写"尚未包含：内置浏览器 / 无限画布 / MCP / 内置终端"**的 56 个版本之前的产物。属于"链接能点开、内容是假的"那一类 | 中 | 🔶 文档那一半本轮已改（README 加如实提示，不冒充有最新产物）。**剩下一半要人拍板**：跨机发布（上传产物 + 把 Release 从 v0.9.0 推进到当前版本）是对外分发动作，不在我这方的常规收尾权限内（提交 / 打标签 / 推送属于常规，发布产物不属于）→ **挂"等人点头"**，不自行发布 |
| T40 | **并行只读审计的其余条目（未逐条复看，先登记不先定性）**。渲染层交互群：流式中 Enter 重发 → 停止按钮失效 + 幽灵气泡（`ChatPanel.tsx:490-497 / 876-881 / 515`）· IME 组合期回车即发送 · 流式中切/新建会话无守卫（`resetView` 清 sending）· 审批队列 `slice(1)` 删错卡（`PermissionDialog.tsx:110`，catch 分支按 id）· 5 处 `try/finally` 无 catch ⇒ "点了没反应" · 翻页无在飞保护 ⇒ 同页重复 key · `TerminalPanel.tsx:295-298` kill 失败仍报"已结束" · `IdePanel.tsx:36-51,170` 读取失败显示成"没选工作区" · `CanvasPanel.tsx:135-141/326` viewport 存而不回放。主进程群：工作区提示每轮追加且永不退场（`chat-service.ts:395-401` + `model-history.ts:22-27`）· 历史恢复静默变空（`session-store.ts:230,246`）· 落盘失败只进 console（`chat-service.ts:150-163`，`:177-180` 无条件断言"已落盘"）· 画布非原子写（`canvas-store.ts:114-118`，文件头自称 json-store 同源；`:94` 把"损坏"报成"没有这张图"）· 4 处广播缺 `isDestroyed` · `security.ts:176` `void shell.openExternal` 吞失败。文档漂移 9 处（`README.md:165` · `HANDOVER.md:233/252/263/270/276` · `PROGRESS.md` §三与 §2.3 · `DESIGN-M9-CANVAS.md:3` · `DESIGN-SESSIONS.md:5`；`check:docs` 抓不到"状态句"） | 未定 | ⬜ **待逐条核实**（按 R5 核实批那套：先复看源码，再分"成立 / 部分成立 / 不成立"，结论落 `review/`）。建议拆成两轮：**修复批四（界面交互群）** 与 **主进程"落盘失败要说话"群**（后者与 R10 日志同题）；文档漂移 9 处并入 R12 收口。登记时**不写"已确认"** —— 那是别的会话读的代码，我没当场复看 |
| T41 | **内置终端不在执行审计里**（R8.6 交付时如实登记，不是漏接）：`apps/desktop/src/main/terminal-service.ts` 直接调 `permission(...)` 而**不走 `decideGate`** —— 它没有"策略判定"这一步（只有真的新起进程才当面问、`bypassable` 硬写 false），所以套不进 `auditedGateRun`：那条出口要是一份 `GateDecision`，凭空造一份就等于**伪造判定**（与"参数校验没过不进审计"同一条口径）。登记时的两个可见后果：① 用户写的 `terminal` 规则（`deny` / `allow`）**对它无效**，判定从不查规则表；② 账本里看不见"谁起过一个终端" | 中 | 🟡 **形状已定、后果②已清，后果①仍属停牌①**（`v0.87.0-接驳1`，2026-10-15）：走登记时预留的第二条路 —— 审计里**新增一类"没有策略判定的当面批准"**：`decidedBy:'person'`，配三条由 `makeRecord` 硬拦的判据（`outcome` 只能是 `ask` / 必须 `asked=true` 且真有其 `answer` / `bypassable` 必须 false，`record.test.ts` 三条红证都是当场抛错）。出口仍然只有一处（`recordGate`），终端不另写第二份 JSON；`adopt`（接回会话）与 `refuse`（超上限）**一个新进程都没起因此一笔都不记** —— 凭空记就是伪造判定。**没有动权限映射**：它仍不走 `decideGate`，规则页那句"对你无效"照旧（现改成"记了账 ≠ 管得住它"，比原来那句更准）。要真让 `deny terminal` 生效得选另一条路（走策略判定 = 改这台机器的门怎么判），**仍交所有者** |
| T42 | **"模型驱动的长任务转后台"不做**（R8.7 交付时主动切出去，不是漏做）：`run_command` 的产物是**给模型读的结果** —— 模型没拿到输出就没法继续这一轮。要"转后台"只有两条路：① 把半截输出当完整结果交给模型（**撒谎**，比不显示更坏）；② 再造一套"后台任务生命周期 + 之后取回结果"的机制 —— 而**用户手驱动的内置终端已经是那套机制**（切走不结束、回来接得回、上限、手工关闭），再造一套就是本仓反复修的那个病：同一件事两处各说各话 | 中 | ✅ **已定口径（R15 同批裁定，2026-10-13）**：**不做**；长任务的可见性与断点由 M17 批一的任务状态机承载；"跑完之后把结果交回给这一轮"的课题（任务身份 / 结果过期 / 期间用户又发一轮 / 审批算哪一次）记档于 `docs/DESIGN-M17.md` §六，将来若做必须复用同一套任务状态机 |

### 4.1 R27 审计清零批：2026-10-09 审计的收尾（九条已修 + 十条登记）

**这批的口径**（用户 2026-10-14 的要求就是"修了 / 登记了"二选一，不许留"大概修过了"）：
10-09 那份只读审计的 A 群（主进程 7 条）与 B 群（渲染层 8 条）**逐条对当前树复看**，
另有 10-09 没跑完的 E 段（`packages/**` 核心包）本轮补做，产出的新条一并登记。
下表 **状态列写"已修"的，都有本轮当场跑出的红绿证据**（先写测试看它红、再改代码看它绿），
写"待排 / 停牌"的一条都没动过代码。

| 号 | 条目（含本轮复看到的当前锚点） | 严重 | 状态 · 处置 |
|----|--------------------------------|------|-------------|
| T40 | （上行）**2026-10-09 审计的 A/B 群** | — | ✅ **本轮清零（2026-10-14，`v0.86.0-加固18`）**：A 群 7 条 **6 条早已修**（工作区提示改一次性重拼 / 历史恢复分"读不出"与"空"并上界面 / 落盘失败上界面 / 权限规则 health 上横幅 / 崩溃调 `cancelAll` / 画布走原子写），1 条本轮修（A7c 入站契约）；B 群 8 条 **6 条早已修**（回车重入 / IME / 切会话 / 审批按 id / 翻页在飞 / 两处谎报），2 条本轮收尾（B5 拒绝兜底、B8 视口依赖）。**逐条复看记录在 `review/REVIEW-LOG.md` 复核 084**，不在这里复述 |
| T43 | `TOOL_RUN` 入参没有契约：`apps/desktop/src/main/ipc/tools.ts` 手写 `typeof toolName !== 'string'`，`args` 以 `unknown` 直进 `runTool`（工具名无上限、`args` 给成数组时报的是 provider 侧 zod 原文 —— 同一种错两处不同说法）。T30 给 `CHAT_SEND` 补过入站契约，**这条是同形漏网** | 中 | ✅ **本轮修**（`v0.86.0`）：新增 `packages/shared-ipc/src/contracts-tool.ts` 的 `toolRunSchema`（名称 1–128 + `args` 必须是扁平对象、可省略），handler 改 `safeParse`；"缺少工具名"那句文案一字不改。测试 `tool-run.test.ts` 6 例 + 两条源锁；`contracts.ts` 因顶到 `max-lines` 800 被 lint 当场拦住 ⇒ **拆文件而不是放宽阈值** |
| T44 | 推送缺 `isDestroyed` 守卫的**第二条**：`ipc/schedule.ts` 的 `SCHEDULE_EVENT` 用 `getWindow?.()?.webContents.send(...)`，没有守卫。而 T40 那条锁**写死了四个文件名**（terminal / browser / context / canvas），所以新文件带着缺陷进来而锁照旧全绿 —— 与本文件开头批评过的"写死清单"同形，这次漏的是判据 | 中 | ✅ **本轮修**（`v0.86.0`）：守卫补齐，并把那条锁换成**现扫全部 `ipc/*.ts` + 装配根 + 审批桥**（7 个 send 点全覆盖，绝对下限"至少扫到 7 个"防清单静默清空）。红证：换锁的那一刻只红在 `schedule.ts:58` 一处 |
| T45 | 渲染层"点了没反应"的**剩余一半**：`try/finally` 没有 `catch` 的位置本轮复看为 **18 处**（`CanvasPanel` 4 / `IdePanel` 3 / `ChatPanel` 3 / `BrowserPanel` 2 / `use-compact` 2 / `WorkspaceCard` 2 / `use-task-card`、`ConnectionsPanel` 各 1）。审计点名的四条里三条（读历史 / 翻页 / 停止）R22–R25 已补 catch 并写进 hint，**剩下这些是 IPC promise 被拒时只复位 busy 标志** | 中 | ✅ **本轮修的是"这一类"而不是这 18 处**（`v0.86.0`）：新增 `ui/failure-notice.tsx` —— `unhandledrejection` → 右下角一条 `role="alert"` 的告警（同条计次不刷屏、最多三张且**挤旧留新**、可关、`install` 返回 cleanup）。逐点补 catch 治不了"下一处新写的漏网"，兜底治的是类。**如实**：18 处仍未逐个补 catch（它们现在**可见**，但话术是通用的"有一步失败了，但没有地方接住它"），逐点补排在 R28 之后按需做 |
| T46 | 画布视口"存而不回放"的**另一半**：R23 修好了回放（`setViewport`），但 `graph` 这个 `useMemo` 仍读 `viewportRef.current` 而依赖数组没有视口 —— `onMoveEnd` 只写 ref ⇒ **只平移不编辑就保存，落盘的是上一次编辑时的视口** | 轻 | ✅ **本轮修**（`v0.86.0`）：视口从 ref 换成状态，memo 依赖跟着带上；顺带把这条立成**零容忍的类锁** `memo-ref.test.ts`（扫渲染层 42 个源文件，`useMemo` 表达式里不许出现 `xxxRef.current` —— 回调读 ref 是当下值、memo 读 ref 必然过期，两者不同判据）。实扫全仓命中 9 处、其中 memo 形态**只有这一处**，所以不需要豁免清单。`react-hooks/exhaustive-deps` 那条 ESLint 规则本身**拦不住这个形状**，而装插件属停牌②（新依赖）→ 用扫源码代替 |
| T47 | "落盘失败只进 console"**没全清**：R25 只把**活动轮次**那次接上了 `done.notice`，模块级函数里还有六处只写 console —— 轮末元信息 / 历史写失败 / 任务记录 / 起轮补写 / 摘要读不出来 / 记忆装配与 SessionStart 钩子。**打包后的 Electron 里 console 不进任何文件**，这六处等于"没人知道" | 中 | ✅ **本轮修**（`v0.86.0`）：收到一个 `fail(scope, msg, err)` 出口（console + 结构化日志两写），装配根 `index.ts` 调 `setPersistLogger(logger)` 接上 M12 那套日志；`void flushSession(doomed)` 丢掉返回值的那条路，现在由 `flushSession` 内部把失败落到日志文件。锁的形态是**计数**（`chat-service` 里 `console.warn` 只许剩 2 处：`fail` 自己 + 淘汰那条信息行）—— 新增一处"顺手 console 一下"会当场红。**覆盖面如实**：这是源锁，不是运行期真值（`chat-service` import electron、vitest 里起不来）；"日志真能落文件 / 按级别过滤 / 落盘前剔密"由 `logger.test.ts` 与 `log-store.test.ts` 各自守住 |
| T48 | **上游原文进界面之前没剔密**（本轮复看成立，且是**能当场演示**的那类）：`providers/openai-compat.ts` 的 `HTTP ${status}：${safeText(res)}`、`上游返回错误：${JSON.stringify(json.error)}`、以及跳过坏负载那行 `console.warn` 都是**上游原文**，一路走到渲染层气泡与对话历史。不少网关把整条 `Authorization` 回显在 401 正文里 ⇒ **一次鉴权失败就能把密钥显示在聊天窗口里并落盘**。仓里那张 `maskSecrets` 表只用在审计落盘，provider 一条都没调 | **严重** | ✅ **本轮修**（`v0.86.0`）：新增 `presentable(raw, cap)` —— **先剔密再截断**（先截会把 `Bearer xxxx` 切成半截、正则认不出来反而漏出去），剔了几处写进消息（静默替换等于"这条看起来是原文"）；两处错误消息与那行日志都过它。同时补上 `maskSecrets` 的**盲区**：`KV_SECRET_RE` 键名与值之间只允许 `[=:]?\s*`，而 JSON 里隔着两个引号（`"api_key":"sk-..."`）—— **整条形同不存在**，审计与 provider 两侧都漏；新增 `JSON_SECRET_RE`（值仍取 12 字符以上，别把 `"author":"Jane Doe"` 洗成星号）。红证原文：`expected 'HTTP 401：unauthorized: got header \'Authorization: Bearer sk-proj-…\'' not to contain 'sk-proj-ABC…'` |
| T49 | **PreToolUse 钩子改写参数后不再过权限门**（核心包审计线提出，**本轮亲自复看成立**）：`tools/executor.ts` 在钩子之前算一次 `decideGate`，钩子返回 `updatedInput` 后**只重过 `tool.parse`**，`gate` / `alwaysAllowed` 全用旧判定。两个可见后果：① `read_file notes.md`（只读放行）被改成 `read_file .env` → **没有任何判定发生**就读走了（T1 把敏感检查提到"任何 allow 之前"正是为拦这个）；② `write_file normal.txt`（软 ask，被"本次总是允许"压掉）改成 `write_file .env`（硬 ask 不可压）→ `alwaysAllowed` 用的是改写前的 `bypassable`，**等于替用户签了一张他没见过的单** | **严重** | ✅ **本轮修**（`v0.86.0`）：判定式抽成 `judge()`（**同一套输入**用两遍，不抄第二份清单），改写成功后重判 —— 变 deny 直接拒、`sink.gate` 换成新判定（审计账本里那条与真实执行的参数从此同一份）、`alwaysAllowed` 按**新** `bypassable` 重算。红绿三条：敏感路径改写必问 ✓ / 软 ask 压不掉硬 ask ✓ / **反向对照**"改写后仍是普通路径不许多问一次" ✓（防把重判做成逢改必问）。**口径说明**：这不是改已批准的权限语义，是把"每一次高副作用动作都过门"那条**已批准的**语义补回被绕过的口子；权限映射表、模式含义、高危清单一字未动 |
| T50 | `git diff` **正文读失败被折成"没有关键行"**：`git/git.ts` 里 `const raw = rawRes.ok ? rawRes.stdout : ''`，返回仍是 `ok:true` —— 触发条件是真实的（`git()` 默认 `maxBuffer` 4MB，大改动溢出时 execFile 丢弃 stdout）。界面上"这次改动没有关键行"与"关键行读不出来"**长得分毫不差**，与审计里 B7 那一族同形 | 中 | ✅ **本轮修的是"要说出来"那一半**（`v0.86.0`）：`rawError` 单独留住，写进 `note`（"改动正文读不出来（原因）：关键行一栏为空，行数仍按统计计"），与旁边那条"不读的内容必须说出来，只把行数写成 0 会让人以为新文件是空的"同一口径。**没选的那条路要说清**：让整体 `ok:false` 更严格，但会把"统计还是好的"那半也扔掉（用户本来能看见改了哪些文件）。红证用**真实溢出**（写 150k 行撑爆 4MB），不是假设那条分支会失败；反向对照：小改动不许出现这句话 |
| T51 | **钩子的 `diagnostics` 全线没人接**（核心包审计线提出，**R27 复看了消费侧**）：`hooks/types.ts` 头部明写"这件事必须可见（diagnostics + UI）"，`runner.ts` 也认真产"超时已被终止 —— **本次钩子没有生效**""启动失败""matcher 不是合法正则，已跳过该组"三种诊断；但 `agent-loop.ts`（UserPromptSubmit / Stop）、`executor.ts`（PreToolUse / PermissionRequest / Post）、`chat-service.ts`（SessionStart）**全部只读 blocked / updatedInput / permissionDecision / additionalContext**，diagnostics 就地丢弃。后果是具体的：一个 PreToolUse 拒绝钩子的二进制被卸载 ⇒ `blocked:false` ⇒ 工具照常执行，而**没人知道那把关掉的安全钩子没跑** | **严重** | ✅ **本轮修**（`v0.87.0-接驳1`）：**出口两处、措辞一处** —— 新增 `hooks/notice.ts` 定义"怎么说"（`[钩子诊断]` + 条数上界 5 + 超出说"还有几条没念出来"），① 工具级：`executor.ts` 把 `hooks.run` **包一层**收进 sink（五处调用点逐点写迟早漏一处，与审计的 `finally` 同一条纪律），在 `runTool` 那**一道**返回处接进 `outcome.content` ⇒ 模型与工具卡读同一份话，七八条提前返回的分支自动覆盖；② 回合级：`LoopResult.hookDiagnostics`（**必填**，加新出口不填就编译不过）→ `chat-service` 与 SessionStart 那份合流，并进 **R25 已有的那一格** `done.notice`（同一语义："这一轮能继续，但有件事该知道"），不新开第二条"怎么说失败"。**没选的路**：另发一类 `IPC` 事件 / 再挂一个告警组件 —— 第二个出口早晚与第一个说法不一致。**测试**：`notice` 5 例（含反向对照：没诊断不许冒空标记）· `executor` 5 例（超时不阻断也要说 / 拦下时诊断不丢 / **用户拒绝那条提前返回** / Post 两格各归各 / 反向对照）· `agent-loop` 4 例 · `chat-honesty-wiring` 3 条源锁（含"每轮新建、不许挂模块级"防跨轮漂）· **e2e 第 64 步**：真启用一个每次 `exit 3` 的 PreToolUse 钩子 → 概览页点 `list_dir` → 界面必须出现"钩子诊断 + 不视为拒绝"，**再停用钩子必须消失**（反向对照，防提示疲劳把这句话磨成背景纹）。**与 T47 是同一个病的另一半**：落盘失败进了日志，钩子没跑这次上了界面 |
| T52 | **命令前缀规则可被一次改写绕过**：`permissions/rules.ts` 的 `commandPrefixMatches` 依赖 `commands/argv.ts` 的 `SHELL_METACHAR = /\|&;<>\`$\|\r\|\n/`（**不含引号、反斜杠、括号、路径分隔符**），命中判断是字面 `startsWith`。于是 `deny git push` 挡不住 `git.exe push --force`、`"git" push`、`C:\Program Files\Git\cmd\git.exe push`；含 `&&` 的组合命令**整条规则作废**（少命中回落到硬 ask 的前提，在用户写过 `run_command` 的工具名 allow 规则时不成立 —— `checkRuleInput` 明确允许不带前缀的 allow） | **严重** | 🟡 **界面那句本轮补了，实质修法仍停牌①**（`v0.87.0-接驳1`）：规则页匹配语法那一格下面新增一格 `p0-warn`，把三个**具体形态**写出来（`git.exe push` / `"git" push` / `C:\...\git.exe push` 都拦不住），并说清两件事：组合符那条是"规则不生效但**还是会问你**"，真正会漏的只有"同一条命令换个写法"；收紧到逐词比对会改动既有规则的范围（**收紧侧保守、放行侧就是放行**），所以这条还没定。判据落在**渲染出来的文本**上（组件测试 15 例里两条），藏在注释里等于没说。**没动判定**：`commandPrefixMatches` 一行未改 —— 改的是"用户写下的承诺到底管多大范围"（已批准的安全语义），需所有者拍上面两问 |
| T53 | **MCP 工具的服务端自述直接换到免审**：`mcp/mcp.ts` 的 `inferToolKind` 见 `readOnlyHint === true` 就返回 `kind:'read'`（注解自相矛盾 / 未声明都取更严的一侧，这两条做得对），而 `policy.ts` 见 `read` 就 `allow`；同时 `pathOf()` 只认 `args['path']` 这一个键 —— MCP 的参数是任意 JSON 原样透传，第三方 `fs_read` 用 `file_path` / `target` 之类的键名就**永远碰不到敏感路径表**。合起来：**外部服务声明一句"我这只读"，就能拿任意参数读任意路径且不问人** | **严重** | 🟡 **批准界面本轮说出口了，实质修法仍停牌①**（`v0.87.0-接驳1`）：这句话进的是 `consent.ts` 的 `warnings`（`code:'read-only-self-reported'`），不是另写一处 JSX —— **措辞只有一处定义**，批准弹窗本来就渲染这一栏（`McpPanel` 零改动），单测也问得到（`consent.test.ts` 4 例：有只读才出现、计数说的是这一个服务的只读工具数、**只有这一件事时也要标成需要先看风险**、反向对照"一个只读都没有就不许冒这条噪声"）。说的是三件事实：这一档**是它自己声明的**、走到这一档**不再问你**就直接执行、参数是任意 JSON 所以本机叫不出名字的路径读得到。**没动判定**：`inferToolKind` 与 `policy.ts` 一行未改。"第三方声明算不算数"是这台机器的**信任边界**（四类停牌第一项），要所有者定：① 外部工具一律 `ask`（不看 `readOnlyHint`）；② 给 MCP 档案加 `pathArg` / `commandArg` 声明，由门来读。核对结论如实：**`MCP_STATE_CHANGED` 那一格没有夸大**（它只报连接状态与工具数），漂的是批准界面对"只读"二字的含义，不是通道。**规整17（R29）补运行期证据**：`mcp-selfdeclared-readonly.test.ts`自造**真子进程**服务端（无网络、进默认套件，`tools/call` 是真 `readFileSync`），四种键名/注解组合各测一次 ——`path` 命中敏感表**会问** / 同一文件换 `file_path` **不问就读回来** / 无自述一律 `exec` 照问（反向对照，证明洞是"自述 + 陌生键名"的**组合**而不是"外部工具没人管"）。**这三条是现状锁**：修法落地后第二条会红，那是故意的摩擦，逼改的人回来读注释并确认那是停牌①的决定。配套变异 **M296/M297** |
| T54 | **命令失败在机器可读字段里不存在**：`tools/builtin/exec-tool.ts` 注释就写着"命令**跑完了**就算工具成功"，`ok:true` 不带退出码；`evidence` 只有路径 / 时长 / 是否截断。人看得见的输出里有"退出码 128"，但按 `ok` 判的下游会当成功 —— `canvas-runner.ts` 的节点状态就是 `ok: res.outcome.ok`（**画布里一条失败的 `git push` 显示成 ok**） | 中 | ⬜ 待排：`evidence.exitCode` / `evidence.timedOut` 两个字段 + 画布节点与任务步骤跟着用；模型侧仍拿原文（那条口径不动）。**这条不改判定，只补记账字段**，所以不需要停牌 |
| T55 | **上游干净地断流被说成"答完了"**：`openai-compat.ts` 里 `let finishReason: FinishReason = 'stop'` 是**初始值**，全文件没有任何"真的收到过 finish_reason"的标记（grep `finishSeen` 为零）；没有 `[DONE]` 而流干净结束时 `yield { type:'done', reason: finishReason }` → 代理 `proxy_read_timeout` 那种 `res.end()` 半截断流会被报成完整回答，T26 那套 `length` / `content_filter` 区分全程不触发。**既有测试还 bless 了这个形状**（`openai-compat.test.ts` 那条"无 [DONE] 直接断流"只断 `toMatchObject({type:'done'})`） | **严重** | ⬜ 待排（**要先定兼容口径，所以不在本轮做**）：正确修法要新增"没收到结束标记"这一态并在界面说出来 —— 但有些自建端点**确实从不发 finish_reason、只发 [DONE]**，把它一律判成截断会把这批厂商打回不可用。要拍的是"缺结束标记"按截断处理还是按可疑处理（带提示）。属于**判断口径**，不该我在清零轮里顺手定 |
| T56 | **工具调用参数从未开始就结束 → 当成合法零参调用**：`providers/tool-call-accumulator.ts` 见 `slot.args` 为空就 `parsed = {}`（注释：无参工具合法），而 provider 侧 `wantsTools` 只是**额外**触发、不是门。网关发了 `{"name":"write_file","arguments":""}` 之后断流 ⇒ `parseError` 为 null ⇒ `{}` 交给 `run_tool`，`[invalid_args]` 那条守卫不触发 ⇒ **用户看见"工具执行成功"，而参数从未被传过来**。未闭合的半截 JSON 那条**已经**处理了（`tool-call-accumulator.test.ts` 有），漏的是"压根没开始" | 中 | ⬜ 待排：把"流是怎么结束的"传给 `finish()`，未收到 arguments 分片的槽位标 `parseError='流在参数开始前结束'`。与 T55 是**同一个决定的一体两面**（结束标记的可信度），建议同批拍 |
| T57 | 三条低危登记：① `openai-compat.ts` 的 `finally` 只做 `releaseLock()` + `clock.dispose()`，**三条早退路径都不 `reader.cancel()`**（上游连接留在池里直到它自己关）；② 网络原因链在分类时走到底（`nameChain` / `codeChain` 沿 `cause` 四层）但**消息里被丢掉** —— `errText` 只取 `err.message`，undici 给的是 `TypeError: fetch failed`，真原因（`ECONNREFUSED` / `CERT_HAS_EXPIRED` / `SocketError`）在 `cause` 里 ⇒ 用户看到"连接失败：fetch failed"；③ 全仓**没有 `child-process-gone` 处理器**（`render-process-gone` 有，T38 修的） | 轻 | ⬜ 待排（③与②可并入 R28）：① 加 `await reader.cancel().catch()`；② 把 `cause` 的 code 拼进 `network_error` 文案并设 `err.cause`；③ 子进程退场要不要收尾 —— **注意这条与"utilityProcess 迁移评估"是同一题**（今天工具与钩子都在主进程/子 shell 里，没有 utilityProcess），迁移与否不是缺陷、是架构决定，登记为**评估项**不动代码 |
| T58 | **契约里有、运行期永不产生的分支**：`contracts.ts` 的 `done.reason` 声明了 `'tool_calls'`，主进程六处 emit 只发 stop/length/content_filter/aborted/error（**从未发 tool_calls**），而渲染层 `ChatPanel.tsx` 有消费它活分支 —— 一条界面读得到、上游不发的枚举成员。同形第二条：`permissionExpired.reason` 声明了 `'cancelled'`，桥里只发 `'timeout'` 与 `'window-closed'`，弹窗那侧的 else 分支会把 cancelled（若将来补上）说成"窗口已关闭" | 轻 | ✅ **本轮清**（`v0.87.0-接驳1`）：删成员**并换成穷举表**（不是只删字面量 —— 那样下一轮还会漂回来）。① `DONE_END_REASONS` / `PERMISSION_EXPIRED_REASONS` 抽成契约里的常量 + 推出类型，主进程 `resolved` 从"手抄一份字面量联合"改成取自 `DoneEndReason`（**抄出来的那份多了一个 `tool_calls`**，这就是本条的成因）；② `done-notice.ts` 从两条 `if` 改成 `Record<DoneEndReason, string|null>`、新增 `expired-notice.ts` 同理 ⇒ **契约新增成员而不补文案 = 编译不过**（本轮要的"机器盯住"就是这个）；③ `ChatPanel` 那条死分支删除并留一段"这里曾读过一条上游从不发的值"的说明。**为什么 `tool_calls` 不该在这一层**：provider 层确实产它（`openai-compat.ts:192/219`），但它止步于 Agent Loop（循环自己执行工具并继续），永远不会是"这一轮的结束原因" —— 词汇漏穿了层。**测试**：契约 4 例（收不了 `tool_calls`/`cancelled`、留下的成员照样收）+ 表键集合==契约成员集合 2 例 + 穷举表兜底不崩 + 源锁 3 条（死写法绝迹，**判据看剥掉注释后的源码** —— 我自己那句解释注释里就写着 `tool_calls`，第一版锁当场被它骗红）。顺带保住 R27 那句核对结论：`IPC` 92 键、8 条主进程→渲染层通道都有 `send()` 点，**漂的是枚举不是通道** |
| T59 | **审批请求的形状没有一致性锁**（E 段提出，R27 复看成立为"风险"而非"缺陷"）：今天五处 `PermissionRequest` 构造点（工具执行器 / git 服务 / 打开方式 / 终端 / 扩展）与 preload 的 `safeParse` **字段是对得上的**（我逐处看过），但 `PERMISSION_MODES` 有 `policy-consistency.test.ts` 那种"新增值必须改两处"的锁，`PermissionRequest` **没有** —— 将来给请求加一个必填字段 ⇒ preload 校验失败把请求丢掉 ⇒ 审批桥空等 120 秒后 timeout（**症状是"点了没反应"，事实是契约漂移**） | 中 | ✅ **本轮立**（`v0.87.0-接驳1`）：两道。**编译期**：`permission-request-consistency.test.ts` 用类型判据钉"引擎那份必须过契约"+ "keyof 双向相等"（对照 `policy-consistency` 那个样子；**为什么不判反方向**：`z.unknown()` 让 `args` 在推断里变可选，反方向天生红，而红的原因不是缺陷 —— 渲染层拿到解析后的 payload 只用于显示、不会喂回引擎；留一条恒红的锁比没锁更坏，它会教人无视红灯）。**运行期**：桥在**发送之前**用同一张 schema 判一次，过不了就**当场按 `timeout` 收尾**（fail closed：一步都不执行，与"没有可用窗口"同一档）+ 告警说清"不合契约、未推给界面"，而不是把没人认的东西推出去再让 preload 悄悄丢掉 ⇒ 症状从"点了没反应"变成一句能读的话。**测试**：5 例含时限判据（`LONG_MS=60s` 下必须 <2s 返回）与**反向对照**（合契约的那份照旧挂着等回音、`pendingCount()===1`、能正常 settle）。踩到的自己的坑：harness 里 `send` 记录写成模块级共享 → 上一用例那笔"没出门"的请求算进下一用例的计数，第一版就红在这里 |
| T60 | **`maskSecrets` 在"没有空格的长文本"上是 O(n²)**（**本轮自己撞出来的**，不是 10-09 那条账）：`KV_SECRET_RE` 的键名段写作 `[A-Za-z0-9_.-]*(?:TOKEN|…)[A-Za-z0-9_.-]*` —— 两半**无上界星号**让引擎在每个起点把整段长串重切一遍才承认"这里没有密钥词"。计时探针实测：**1 万字符 91ms / 5 万 2217ms / 20 万 34575ms**。此前从没暴露，因为唯一的调用方（审计落盘）先把命令截到 400 字；**T48 把上游 HTTP 正文接进来之后**，CI 里那条"错误消息要有上界"的用例 **30 秒超时**（本地 8 秒勉强跑完，看不出来）。后果比慢更糟：一条 2MB 的上游报错就能把主进程钉死，而**卡住且不说话**正是本仓头号禁区的另一副面孔 | **严重** | ✅ **本轮修**（`v0.86.0` 追加提交）：两半星号**有界 64**（键名不可能更长；超出本就不是凭据字段）+ 两趟按键名判词的替换前加一次 `SECRET_KEY_WORD_RE.test(out)` 的**线性预检**（整段没有密钥词必然零命中）。实测 20 万字符从 34808ms 降到 **44ms**（只留界不预检）／整文件用例跑完 **6ms**。锁判的是**耗时**（`redact.test.ts` 新增一条 <300ms 的时限断言，红证 `剔密 20 万字符用了 37781ms`），变异 **M276** 把星号退回无界形状必须被它拦下。**同一条口径今后适用**：任何把不可信长度喂进正则的新调用点，都要配一条时限锁 —— 复杂度只在真输入上才现形 |
| T61 | **`check:docs` 第 9 条（禁写死本机路径）会假绿**（**规整17 开源预演复跑抓到的，是门禁自己的洞**）：`mcp-real-server.test.ts` 里一直躺着一处 `const WORKSPACE = 'D:\\MiMo\\ProjectOne'`，而这条检查每轮都报 ✅。两处原因叠加：① 旧判据把源码里的 `\` 换成 `/` 再比 —— 可源码里是**转义形态**（两个反斜杠），换完变成 `D://MiMo//…`，与运行时算出的 `D:/MiMo/…` **对不上**；② needle 只有"仓库根"那一串，而它写的是仓库根的**上级目录**，字面量匹配天生够不着。**后果不是难看而是可用性**：别人 clone 下来把 `JUJIA_NET_TEST=1` 打开，那一条就指向一个不存在的目录 | 中（门禁判据 · 影响"新克隆就能跑"） | ✅ **本轮修**（`v0.88.0-规整17`）：判据改成**比较前把所有分隔符摘掉**（`\` 与 `/` 都不参与判断 ⇒ 任意转义形态归一到同一串）+ **三层 needle**（仓库根 / 仓库根上级 / 用户主目录，全部运行时算出，脚本自身仍不落任何本机字面量）。**靶面**：注入自检补两条（转义形态的仓库根 / 上级目录），判据若退回旧归一化写法当堂红 —— 计数 **24 → 26 处**。那处写死的路径改由**本文件位置反推**仓库根（`resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')`）。**同族教训**（写进 `docs/TEST-POLICY.md` §七·附二"检查器自己也会假绿"）：**判据的归一化方式必须与真实写法一致**，否则它锁的是自己想象中的源码；而"扫哪些串"（needle 覆盖几层）与"怎么归一"同样是要害 —— 这一条两处都错了才让一处违规隐身数轮 |
| T62 | **注入自检中止时会把注入留在工作树里**（**本轮做红证实验时当场撞出来**，不是 10-09 那本账）：`verify-docs-check.mjs` 的 `fail()` 原来是 `console.error` + `process.exit(1)` —— 而 `process.exit` **不会跑 `await` 之后的 `finally`** ⇒ 某条用例没拦住而中止时，那一轮刚注入的文件**不回滚**。本轮实测：旧判据 + 新用例（转义形态）跑出"没有被拦住"，中止之后 `packages/shared/src/json-store.ts` 里那行注入的本机路径**还在**。后果不只是脏：下一次 `check:docs` 会报一条**看起来像文档漂移**的真红（"代码与配置里有本机绝对路径 · json-store.ts"），人按台账去找漂移，找到的是自家脚本的残留 —— **检查工具的失败路径本身静默改动了被测仓库**，与"失败要说得出为什么、改了要能看见"正面冲突 | 中（门禁工具自身 · 会误导下一次排查） | ✅ **本轮修**（`v0.88.0-规整17`）：`fail()` 改成抛 `SelftestAbort` 哨兵异常，注入循环外层 `try/catch` 收场 —— **每一次注入的 `finally` 一定先把原文写回**，异常才往外传；中止之后**再跑一次检查器**，据实打印"注入没有留在工作树里（还原成功）"或"还原后仍失败，请对照 `git diff` 手工清理"，退出码仍为 1。注入开始前与全部还原之后的那几处失败（基线不绿 / 哨兵名被占 / README 步数与脚本不一致 / CHANGELOG 锚点找不到 / 还原后仍红）改用新的 `die()` 直接退出 —— 那些时刻工作树本来就是干净的，**不需要**那套还原。**红绿配对**：红 = 把一条用例的 `expect` 临时改成一个绝不可能出现的检查名 ⇒ 中止；`git diff --numstat packages/shared/src/json-store.ts` **空**、`git status` 干净、打印为"还原成功"；绿 = 改回后 **26 处注入全拦、退出码 0**，两个脚本各自 `cmp` 与备份逐字节相同。 **判据没变、只补失败路径** —— 这条不新增护栏，但让第 9/9b 那些护栏的红证可信 |
| T63 | **变异靶面的锚点会随合法交付漂移，而漂移只有收口轮才看得见**（**规整17 全量跑抓到的，297 条里 6 条命中 0 次**）：M46 的文案在接驳1 被 T58 从弹窗三元挪进穷举表、M181 那句被 T41 按事实改写、M261 的三元被 T51 换成"多段拼接"、M148/M163/M256 是同一处改动多缩进一层。⇒ 六条变异在过去若干轮里报的是"注入失败"，**不是"拦住了"**：它根本没注入。根因不在某一次改动，而在**跑序** —— 交付轮只校准本轮新增的子集，旧靶面没人复扫，漂移要等到收口轮那次全量跑才现形 | 中（门禁自证失效；被"291 全拦"这类数字掩盖时比没跑更危险） | ✅ **本轮修**（`v0.88.0-规整17`）：给 `scripts/mutation-check.mjs` 加**锚点全量预检** —— 跑任何一次变异之前先把全部 `find` 在各自文件里数一遍，**命中数不等于 1 就当场列名、退出码 2、一条都不注入**（半跑的状态最难查）。红证用真材料：拿修锚**之前**那版（`git show HEAD:review/mutations.json`）的三条跑预检 ⇒ 原样列名 M46 / M148 / M181 并以 2 退出；绿 = 297 条"锚点预检通过"。**这条把"记得跑全量"变成"任何一次运行都先过闸门"**（§七 那条老规矩的第三次应用：写进禁忌表的规矩不当机器判据就会复发）。**顺带当场抓到一条真逃逸**：M261 重新对准后**未被拦住** —— `chat-honesty-wiring` 那组锁住的是"句子在不在 / 契约有没有这一格 / 渲染层读不读"，**中间那一环"emit 时到底传没传"无人认领** ⇒ 把 `notice:` 换成 `null` 全套照样绿。按"逃逸只补测试、不放宽判据"补了一条**第三环接线锁**（done 那一次 emit 的 notice 必须引用 `noticeParts`，红证：注入后当堂失败、还原后 10 例全过），修后子集 **6/6 全拦** |

**顺序（批复① 定调 · 批复④⑤ 排到本轮）**：P1 优先于 6b，因为 6b（压缩 + 摘要）建在 6a 的会话数据机制上，
而 6a 有一致性三连没修 —— 在地基上盖功能会放大问题。已交付：**T5+T6+T7（`v0.40.0-外审2`）**、
**T9 / T19 / T21（`v0.42.0-外审3`）**、**T10 / T11（`v0.43.0-外审4`）**；T8 经核实不成立（见上表）。
**P1 已走完 → 6b（`v0.44.0-铺设6b`）→ T22（`v0.45.0-T22`）→ M19 三批（`v0.46.0-M19a` / `v0.47.0-M19b` / `v0.48.0-M19c`）→ 规整9（`v0.49.0-规整9`）→ **M9a（`v0.50.0-M9a`）** 均已交付**。
新变异编号已用到 **M119**（M9a 批次 M71–M85 + B1 批次 M86–M88 + CSS 锁 M89 + B2 批次 M90–M92 + B3 批次 M93–M99 + M8 push 批次 M100–M103 + 加固4 批次 M104–M105 + **修复批二 M106–M119**），**下一轮从 M120 起**。
并行队列更新：P2 里 **T16 状态是"未核实"**（R5 处理）；**T23 / T24 已交付**（`v0.58.0-加固5`，R4）。

---

## 三、开发队列（按轨道）

| 轨道 | 编号 | 内容 | 里程碑 | DoD |
|------|------|------|--------|-----|
| **扩容** | 1 | **内置浏览器**（WebContentsView + 三档打开方式 + 安全钩子） | M10 | 能开网页、能读页面文本给模型；导航/new-window 全被基线约束 |
| **扩容** | 2 | **无限画布**（节点/连线/DAG 校验/执行/持久化） | M9 | 画一个 3 节点流程并整体执行；图能存能读 —— **M9a 已交付 `v0.50.0-M9a`**（3 节点链跑完与逐节点回写 = e2e 第 40 步；成环开跑前被拒 = 第 41 步；工具节点过审批门 = 第 42 步）；**B1 已交付 `v0.52.0-M9b-B1`**（对齐辅助线与吸附 / 命令面板 / 网格吸附与右键·双击建节点 = e2e 第 42–43 步）；**B2 已交付 `v0.53.0-M9b-B2`**（局部重跑 = e2e 第 44 步）；**B3 已交付 `v0.54.0-扩容2`**（条件分支：真/假两出口 + `skipped` 不传播 + 界面 Handle 补账 = e2e 第 45 步） |
| **扩容** | 3 | 轻量 IDE（文件树 + 编辑器 + diff，与 Agent 共用工作区句柄） | M12 之后 | 能开文件/编辑/看 diff/保存 |
| **扩容** | 4 | 多模态能力门控 | M11 | 能力清单可查；不支持时如实拒绝而不是假装能做 |
| **铺设** | 6 | 会话持久化（PLAN 写的 `messages.jsonl`）与历史分页窗口 + compact/会话摘要 | M6/M12 | **6a `v0.38.0` / 6b `v0.44.0` 均已交付**；6b 报备稿存档（五开关的裁决存档在 `docs/DESIGN-SESSIONS.md`）· **6a 已交付 `v0.38.0-铺设6a`**，6b（compact / 自动摘要 / 注入隔离界面，含"达到阈值只提示、压缩须用户显式发起、摘要可预览、界面标出已压缩"）**已交付 `v0.44.0-铺设6b`**（6a 在 `v0.38.0-铺设6a`）。DoD 逐项：重启后历史还在 ✅（e2e 第 24 步）· 长会话上下文有上界 ✅（摘要 + 最近 K=12，e2e 第 28 步经回显服务核对"模型收到的就是这一份"）· 压缩前后关键事实对照清单 ✅（摘要 prompt 的"四类必保"与 `compaction.test.ts` 的断言是同一四类）· 记忆注入隔离声明（补偿条件③）✅（"这是数据不是指令" + 条数出处 + 「查看长期记忆」直达入口）。报备稿 `docs/DESIGN-COMPACT.md`：七条全批 + 两条追加验收，状态已标"已批已交付"） |
| **铺设** | 10 | **M6 记忆写入侧**（`append_note`：写类 + 路径守卫 + 只由人显式触发；零新通道，走 `TOOL_RUN`） | M6 写入 | 批准后 `.jujia/NOTES.md` 真多一行；拒绝或越界 → **磁盘上什么都没发生** |
| **铺设** | 7 | 定时任务（RRULE + 补跑） | M7 | 能跑一个定时任务并看到补跑记录 |
| **铺设** | 8 | **内置 exec 工具**（`run_command`：模型自主执行命令，**一律硬 ask** + 高危清单 + 限工作区内） | M4 | 批准后命令真执行且结果回模型；**未批准时零执行**（有断言，参照 MCP 的"拒绝即零调用"做法） |
| **铺设** | 9 | **git 模块接线**（第一批已交付 `v0.32.0-铺设9`；**第二批 = M8 `push` 收口 `v0.56.0-铺设9`**）。**权限映射（所有者 2026-09-24 给定）已全部照做**：`status` / `diff` / `log` 只读 → **不问**；`stage` / `unstage` 暂存区操作、可逆 → **软 ask**（可选"总是允许"）；`commit` 写仓库历史 → **硬 ask**；`push` 外发远端、别人看得见 → **硬 ask，且永远不可被「总是允许」压掉**（已落地：`HARD_ACTIONS = ['commit','push']`，弹窗里没有那颗按钮） | M8 | ✅ 达成：界面能看 status/diff、完成一次 commit、**完成一次 push**；**四档权限各自被用例钉住**（判档 33 → 40 + 服务层真仓库 / 真 bare 远端 15 → 21 + 接线锁 10 → 14 + `agent-core` 真 git 用例 +12 + e2e 三步），"commit 绕过硬 ask"有变异 M10 守着，M11 咬 acceptEdits 降级、M12 咬"deny 却照样执行"，**M100 咬"push 被降成软 ask"、M101 咬"推送拿只读档位过门"、M102 咬"远端名形状校验失守"、M103 咬"外发文案被换成中性一句"** |
| **拓展** | 5 | 插件贡献的命令执行（`commands/` 目前只识别） | M7 | 装插件后能用它的命令 |
| **加固** | 2 | MCP：per-server `timeoutMs`/`enabled` + **工具描述漂移基线** | M7 | 描述变了要重新确认；单服务端可禁用 |
| **加固** | 3 | 工具结果裁剪、历史有界 | M6 | 长会话内存与上下文都有硬上限 |
| **优化** | 3 | 首屏 chunk 拆分（652KB → 目标 <400KB）· 长会话 fps 实测 | M3 | 实测数据与预算对齐 |
| **规整** | 6 | 十条轨道的编号登记与记录格式落地检查 | — | `check:docs` 能校验 CHANGELOG 标题带轨道号 |
| **接驳** | 1 | 画布 ↔ 编码引擎的对接方式（节点如何调工具） | M9/M5 | 写出对接契约文档并在画布落地时实现 —— **已交付 `docs/LINKAGE-M9.md`（`v0.50.0-M9a`）**：五条批复要点 + 两条追加逐条对照落地与证据 |
| **接驳** | 2 | 浏览器 ↔ 对话的对接（页面内容如何进上下文） | M10/M5 | 同上 |

---

## 四、执行顺序建议（依赖与风险）

1. **先修文档地基**（R-01/R-02）—— 编号与状态不唯一，后面所有排期都不可信。
2. **再补证据与收敛**（R-03/R-04/R-05/R-06）—— 让"已完成"有机器可查的凭据。
3. **然后做第一批加法**（扩容 1 内置浏览器 / 铺设 6 会话持久化）—— 此时文档与门禁都可信，加功能才不会又漂。
4. **接驳文档在动工前写**（接驳 1/2）—— 避免"各做各的，最后接不上"。

**为什么把"扩容"排在"铺设(6) 会话持久化"之前？** 现状会话仅内存（重启即丢），
这是**用户可感知的缺口**，且 M10 浏览器是下一个明确里程碑；持久化涉及数据布局决策（PLAN 已声明 `messages.jsonl`），
适合与 M12 基础设施一起做，不宜边赶功能边改数据格式。

---

## 五、编号登记表（避免复用）

| 轨道 | 已用编号 | 说明 |
|------|----------|------|
| 轨道回归计划 | 1 · 2 · 3 · 4 | 1 = 全项目审查 + 第一轮大修复（`v0.24.0-hg1`；原写"回归1"是任务写法、标签从未用过该名，更正见归档）· 2 = 编号统一 + 状态唯一化 + 变补贴齐（`v0.25.0-回归2`）· 3 = R-04…R-11 收敛 + .md 清理与整合（`v0.26.0-回归3`）· **4 = 接手方交接验收触发的能力边界与数字口径修正（`v0.30.0-回归4`）** |
| 轨道排查计划 | 1 · 2 · 3 | 1 = `review/TRACK-SWEEP-1.md`（两路独立审查 + 抽查核实）· 2 = 交接文档三遍复查（`v0.29.0-排查2`）· **3 = 接手方（QoderCN）交接验收核查，产出为 `review/REVIEW-LOG.md` 的复核 025** |
| 轨道加固计划 | 1 – 4 | 1 = 硬/软 ask · IPC 发送方校验 · `file:` 收紧 · 终端剔敏（`v0.22.0`）· **4 = 修复批一：测试与 CI 的"少跑了但全绿"三类洞（T13/T14）+ argv 的 cmd 元字符（T15）+ 脚手架死参数（T18）**（`v0.57.0-加固4`）· **2 与 3 已登记未动工**（MCP per-server 开关与描述漂移基线 / 工具结果裁剪与历史有界），编号留给它们，本轮**不抢号** |
| 轨道拓展计划 | 1–4 | 规则表 · 钩子 · 技能/插件 · 外观 |
| 轨道铺设计划 | **已开号到 17** | 1–5 已交付（骨架 → 权限 → 记忆 → 终端 → MCP）· **6 已交付（会话持久化：6a `v0.38.0-铺设6a` / 6b `v0.44.0-铺设6b`）** · **7 已交付（定时任务，`v0.69.0-铺设7`）** · **8 已交付（内置 exec 工具，`v0.33.0-铺设8`）** · **9 已交付（git 模块接线，`v0.32.0-铺设9`）** · **10 已交付（M6 记忆写入侧，`v0.37.0-铺设10`）** · 11–13 为 M4 收尾三批 · **14 = M12 批一 结构化日志（`v0.74.0`）· 15 = M12 批二 检查更新（`v0.75.0`）· 16 = M17 批一 断点续跑（`v0.79.0`）· 17 = M14 批一 文书轮（`v0.80.0`，不做实现）**。**编号勘误**：本节总览曾把 6 号写成"记忆写入侧"，与 §三 表里的"6 = 会话持久化"冲突 → 记忆写入侧改用新号 10，6 号含义不变 |
| 轨道规整计划 | 1–11 | 前端规整 · 打包 · 文档检查 · 测试不写系统盘 · 启动路径 · **.md 清理与整合（随 `v0.26.0`）** · **交接文档（`v0.28.0-规整7`）** · **8 = R-12 `ipc.ts` 拆分（`v0.34.0-规整8`）** · **9 = 打包产物验证 `verify:pack`（`v0.49.0-规整9`）** · **10 = 轨道纪律补账：CHANGELOG 标题受控词表 + 本表回填（`v0.51.0-规整10`）** · **11 = 归轨纪律落地：§2.1 代码文件归轨索引 + `check:docs` 三条护栏 + 打标签强制动作（`v0.55.0-规整11`）** |
| 轨道优化计划 | 1–2 | W7 性能 · 零人工测试基建（e2e） |
| 轨道升级计划 | 1 | 打包发布链路 |
| 轨道扩容计划 | 1 · 2 · 3 · 4 | 1 = **内置浏览器（M10）**（全交付：策略 `v0.27.0` / 服务与界面 `v0.31.0` / 三档打开方式 `v0.35.0` / Markdown `v0.36.0` / PDF 随 M19a·M19b 交付 `v0.46.0`·`v0.47.0`）· **2 = 无限画布（M9a `v0.50.0-M9a` + B1 `v0.52.0-M9b-B1` + B2 `v0.53.0-M9b-B2` + B3 `v0.54.0-扩容2` 四批齐、M9 收口）** —— M9a 的契约 / 编排 / 持久化 / 执行 / 界面、B1 的对齐 / 命令面板、B2 的局部重跑、B3 的条件分支全部记在本号下（CHANGELOG 的轨道段同此）· **3 = 轻量 IDE（M19a/b/c 三批已交付 `v0.46.0`–`v0.48.0`）** · 4 = 多模态能力门控（未开始）。**两条硬约束（所有者原话）**：① "系统默认浏览器 / 自选 exe"属**本机外发动作 → 必须过权限门**（硬 ask，或至少首次确认后记住；网页内容**绝不能触发**）；② 文档查看器加载第三方文件，**沿用浏览器基线：视图无 preload + 导航过策略层**。**防复用注记**：版本后缀里的「-扩容N」是该轨道的**发布流水**、不等于本表编号（`v0.35.0-扩容2` 其实是浏览器第 3 步，不是第 2 项）—— 历史后缀一字不改；**新规自 `v0.51.0` 起**：CHANGELOG 标题的轨道段写**本表编号**（形如「扩容2 · M9b」），由 `check:docs` 机器盯 |
| 轨道接驳计划 | 1 | 1 = **画布 ↔ 编码引擎**：交付 `docs/LINKAGE-M9.md` 并随画布落地（`v0.50.0-M9a`；**§六 子代理接线口占位已于 R16 细化**）· 2（浏览器 ↔ 对话进上下文）**未开号** |
| 修复队列（T 号） | T1–T24（详见 §二） | **不占轨道流水号**：跨轨道的缺陷修复流水，按发现批次推进（外审四轮 `v0.39`–`v0.43` · T22 `v0.45.0-T22` · T13–T18 `v0.57.0-加固4` · T23/T24 `v0.58.0-加固5`）。两套编号**互不替代**：任务号回答"哪一批"，轨道号回答"哪类工作" |

---

## 六、十轮连续闭环计划（2026-10-07 起；开发 / 复核 / 台账 / 门禁 / 发布由同一方闭环）

**只有四类情况停下来找外部决策**：① 改已批的安全语义或权限映射 ② 新增依赖
③ 与 M14 / M19 的归属冲突 ④ 范围超出预期、拆不动。其余自行裁量；**攒 2–3 轮一起简报**；
里程碑轮做完整收口（全量变异 + 慢档四项 + 标签 + 台账写明"按标签回退拿到的是什么"）。

| 轮 | 任务 | 里程碑收口 |
|----|------|-----------|
| R1 | **B3 控制流 · 条件分支节点**（真/假两出口 + 关键词判定 + 未选分支 `skipped`；执行仍只经 `runTool`/`streamChat`） | ✅ M9b 收口（**已完成** 2026-10-07） |
| R1.5 | **规整11 · 归轨纪律落地**（治理方 2026-10-08 要求在 R2 之前插入的一笔：§2.1 归轨索引 + 三条护栏；**零产品源码改动**，快档五项 + 注入自检，不占慢档） | — （**已完成** 2026-10-08，`v0.55.0-规整11`） |
| R2 | **M8 `push`**（硬 ask 且不可被「总是允许」压掉；一条通道 + 一行档位 + 一条测试 + 一条变异） | ✅ M8 push 收口（**已完成** 2026-10-08，`v0.56.0-铺设9`） |
| R3 | **修复批一（轻四件）**：T13 · T14（CI 补 `license:check` + `mut` 独立 workflow）· T15（元字符表 `% ^ !`）· T18 | — （**已完成** 2026-10-08，`v0.57.0-加固4`） |
| R4 | **修复批二**：T23（终端页 → pty 常驻可手工关闭）· T24（文档页 → 记住路径与阅读位置） | — （**已完成** 2026-10-08，`v0.58.0-加固5`） |
| R5 | **T16 核实批**：11 项逐条读源码核实（成立即修 / 不成立写清，结论落 `review/TRACK-SWEEP-4.md`）；顺带处理两条时序挂账 —— e2e 第 17 步偶发红（首跑红重跑绿、根因未定）与 git 撞 `index.lock` 时**可见地等**而不是静默重试。**先取证再动手**（报告已有三处失实的前科）；"TerminalPanel 双 PTY"一条已被 R4 消掉，本轮只复核不复做 | — |
| R6 | **修复批三**（T16 核实成立的六项，一次收干净）：T29 git 链读越界（接 realpath）· T30 `CHAT_SEND` 入参加 schema 与上限 · T31 MCP 状态诚实化（僵死要说出来，别等 20s 超时）· T32 技能目录/正文补"这是数据不是指令"的隔离声明 · T33 历史分页口径收敛到一处（差 1 两处）· T34 气泡 key 带偏移 | 🔶 **拆成四轮收**：T29 = R6（`v0.60.0-加固7`）· T30 = R6b（`v0.61.0-加固8`）·**T31 + T32 = R6c（`v0.62.0-加固9`，2026-10-09）**· T33 + T34 → R6d。切分口径是"一处状态机一次验收面"，代价是轮次变多 —— 这条决定本身要能被质疑，所以每轮都写在台账里 |
| R7 | **provider 批**（T16 普查所得四条 + 一条附带）：T25 空流被判成功 · T26 `finish_reason` 归并掩盖截断 · T27 同帧 usage 被吞 · T28 无 `index` 的 tool_calls 串调用 · 附带 `TextDecoder` 末次冲刷 | ✅ **R7 已交付**（`v0.64.0-加固11`，2026-10-09）：四条全部修好并各带变异；**附带那条经实测不成立**（尾部半个字符组不出字，末次 `decode()` 只会补出 U+FFFD），按实测写成一条锁而不是改代码 —— 报告失实累计七处 |
| R8 | **M4 收尾 · 其一**：命令级**前缀**规则（只做 `deny`/`ask`）· 工具自己声明 `commandArg`（`run_command`）· 前缀进存储与界面 · 跨包契约一致性锁 · e2e 第 51 步。**停牌①口径落地**：命令级 `allow`（"以后不再问这一段命令"）**不开这个口子**，并在 `checkRuleInput` 落盘前**直接拒**（不是"没实现"，是"拒绝保存"），界面选 allow 时那一格根本不渲染 | — （**已完成** 2026-10-09，`v0.65.0-加固12`；顺带查实并修掉一个真缺陷：`note` 用 `.nullable()` 而存储里"没填"是 `undefined` → 一条不带备注的规则让**整条列表 IPC 抛错**、权限页永久打不开） |
| R8.5 | **M4 收尾 · 其二（上）**：执行审计 —— 判定事实出口（`runTool` 外层 `finally`，结构上不漏分支）· **落盘前剔密**（键名 + 长度 + 指纹；正文与令牌进不去）· 按天 JSONL（上限计数 / 写失败可数 / 末行残缺不作废整本）· 权限页"执行审计（今天）"卡 + 另存为导出（已存在拒绝覆盖）· 顺带修 T38 | — （**已完成** 2026-10-09，`v0.66.0-铺设11`） |
| R8.6 | **M4 收尾 · 其二（下）**：把 **git 提交与推送 / 打开外部程序 / 改钩子配置** 三个非工具门接进同一本审计 （现在这本账**不是全账**，界面上已这么写）。**为什么单独一轮**：三门的判定与答复各自长在 service 里，接线点与验收面都不同；塞进上一轮会让"哪些动作有账可查"这句话说不清 | ✅ **R8.6 已交付**（2026-10-10，`v0.67.0-铺设12`）：出口仍是**一处**（新增 `audit-gate.ts`，判定标在 `finally` 记、`executed` 由返回值推出）；外发地址与钩子命令留**可读形态**（走同一张剔密表 + 400 字上限），git 提交信息刻意不留（属正文）；界面那句「尚未接入」已删除并换成真实的那一格 —— **内置终端不走 `decideGate`、每次当面问，没有"判定"可记**，登记为 T41 |
| R8.7 | **M4 收尾 · 其三**：后台 / 流式输出 —— 长命令不占死界面（沿用终端 pty 那套"切走不结束、回来接得回"的存活口径；**不新造第二套会话生命周期**） | ✅ **R8.7 已交付**（2026-10-12，`v0.68.0-铺设13`）：**流式输出已做**（工具卡上边跑边看见尾部快照，带 callId 分线、大小与静默期双上界、半截输出不落盘不喂模型）；**"转后台"刻意不做** → 登记 **T42**：`run_command` 的产物是给模型读的结果，转后台要么把半截当完整（撒谎）要么再造一套任务生命周期，而用户手驱动的内置终端已经是那套机制；与 R15（M17 断点续跑）同批定口径 |
| R9 | **M7 定时任务**：RRULE 子集（按日 / 按周 / 按间隔 + 具体时刻，**自己解析、零新依赖**）· 错过的补跑口径（至多补一次并说明跳过了几次）· **定时不等于免审批**：到点触发照走同一扇权限门。写盘时序沿用已验证的那套 | ✅ **M7 收口**（`v0.69.0-铺设7`：到点走同一扇门 · 水位线写"被补的那一次" · 起轮入口唯一化 `turn-trigger.ts`） |
| R10 | **M12 批一 · 结构化日志**：分级 / 落盘 / 轮转 / **敏感字段剔除**（沿用 `SENSITIVE_ENV_RE` 那套判据口径，**剔除必须发生在落盘之前**并有变异盯着）· 界面可读 · 明确"日志不出本机"。零新依赖 | ✅ **已交付**（2026-10-13，`v0.74.0-铺设14`）：构造即剔密（唯一构造入口 · 键名像密钥连长度都不写）· 按天 JSONL + 当日上限 + 轮转（删了谁列名）· 启动 / 渲染崩溃 / 启动失败三类写入（失败**等写完再退**）· 概览页可读（`docs/DESIGN-LOGGING.md`）· 复核 070 |
| R11 | **M12 批二 · 自动更新**：先出**评估 + 无依赖最小形态**（只提示"有新版本"并把发布说明指给人看，**不自动下载执行**）；若结论是"必须新增依赖" → **停牌②来问**，不自行装。含 `verify:pack` 补跑 | ✅ **M12 收口**（2026-10-13，`v0.75.0-铺设15`）：评估结论 = 自动下载执行属**停牌②刻意不开**；无依赖最小形态"查一次 · 说一句 · 指条路"（点一次发一次 · 四种结局四种话 · **"查不到"绝不显示成"已最新"**）· `verify:pack` 欠账同轮还清 · 复核 071 |
| R12 | **全仓收口回归**：慢档四项全绿（smoke / perf 规范采样 / verify:pack / 全量变异）· **开源前置清单预演**（对外表述、隐私边界、凭据不在仓、许可证清单、忽略规则、贡献指南缺什么）· CI 首次实跑结果回填（R3 留的如实项：YAML 只做过结构核对）· 给 M11/M14/M17 排期建议 | ✅ **全仓收口**（2026-10-13，`v0.76.0-规整14`）：慢档四项全绿（smoke · perf 规范采样 **436~534ms×3** · verify:pack · 全量变异 **227/227**）· 开源预演全清单（416 文件 × 6 类哨兵 **0 真凭据**）· T35 清掉 · 展示页截图（**打包产物实拍**）· M11/M14/M17 排期建议 · 复核 072 |
| R13 | **M9 补完 · B3b 有界循环**：循环节点 + 终止条件 + **步数与时间双上界**（上界与"到界怎么说话"必须各有变异）· 与已交付的 `skipped` / `alive` 传播口径对齐（循环体里的跳过怎么算）· 界面把"第几轮"标在节点上。编排层仍然只经 `runTool` / `streamChat`（接线锁） | ✅ **M9 真正收尾**（2026-10-13，`v0.77.0-扩容4`）：**循环不是环**（单节点有界轮次，保住成环校验/拓扑序/局部重跑/分支活路四套不变量）· 终止词 + 轮数(≤10) + 时间(180s) 三闸 · **到界=失败并说明白** · 执行器零特判 · 界面"第几轮"上卡片 · e2e 两张图（命中即停 / 到界说明白）· 复核 073 |
| R14 | **M11 批一 · 多模态输入最小形态**：图片附件（类型 / 单张大小 / 张数三条上限都在读盘前判）→ provider 的 content parts · 界面选择与预览。**开工前先报备**：图片字节随请求离开本机是"多模态"这件事的定义，与现有"数据默认不出本机"的表述**正面冲突** → 属停牌①，拿到批复才动；落盘的原图不许出工作区 | ✅ **已交付**（2026-10-13，`v0.78.0-扩容5`）：批复四条落进 `docs/DESIGN-MULTIMODAL.md`（表述采用 · 附件不落盘 · 5MB/4 张/四格式 · 剥元数据）· 准入内核纯层（魔数判定 + 上限 + 剥元数据 fail-closed）· 选择/拖动/粘贴三条入口同一内核（拖动给**原始字节**，渲染层不自己编码）· only-outbound content parts（内存与磁盘保持纯文本）· 落盘只有一行 `imageCount`（重启后「图片未保留 ×N」）· e2e 服务端从收到的字节里验 parts 与"哨兵已剥" · 复核 074 |
| R15 | **M17 批一 · 长任务与断点续跑**：任务状态机（进行中 / 被打断 / 可续）+ 崩溃恢复，**复用 `json-store` 与 `will-quit` 那套已验证的写盘时序**（不与 M6 会话持久化分叉、不另起一套存储）· 恢复时如实说"上次断在第几步"，不假装无缝。**硬约束**：续跑不得绕过权限门重放高副作用动作 —— 重放到那一步就重新问 | ✅ **已交付**（2026-10-13，`v0.79.0-铺设16`）：任务记录 `sessions/<id>/task.json`（JsonStore 原子写；起轮也补写一次会话元信息——否则崩溃的轮次在清单里"不存在"）· **读时判定**（还是 running = 被崩溃/强退带走 → interrupted）· 卡片如实说"断在第几步"（含中断时正在运行的工具与原始要求）· 续跑走 `startTurn` **唯一入口** + 断点段一次性注入系统提示 · **硬约束以 e2e 正面证据收口**（续跑时审批弹窗再次出现）· **T42 同批裁定：转后台不做** · 顺带修 `list()` 从 `.bak` 恢复不写回主文件的潜伏缺陷（e2e 第 [23] 步放大成必现）· 复核 075 |
| R16 | **M14 批一 · 边界备忘与接线口**（**本轮不做实现**）：① M14 与画布子代理节点、与 M19 编辑归属怎么分 —— 这是停牌③的既有冲突点，归口确认之后实现才动；② `docs/LINKAGE-M9.md` 占位接线的契约细化；③ 给 M20–M22 那份"数据不出本机"的表述冲突出一份决策备忘。能力表禁宣称未做的事 | ✅ **R16 已交付**（2026-10-14，`v0.80.0-铺设17`，**文书轮、零源码改动**）：① M14 归口两处写成候选口径清单（`docs/DESIGN-M14.md`，5 问各带推荐值，拍板随全量交接）；② `LINKAGE-M9.md` §六 细化成九条接口约束（执行入口 / 计费上界 / 权限不继承白名单 / 取消 / 摘要产物 / 审计 / 打包）；③ M20–M22 决策备忘单独成文（`docs/DECISION-REMOTE.md`：选项 A–C + 先决清单）；④ **顺带**：HANDOVER §5.8/§5.9 恢复（规整9 删标题留引用所致）· SECURITY 出站表两处过时行改准（更新检查 / 内置浏览器）· README 隐私条 4 同步改准。复核 077 |

**R12 给出的 M11 / M14 / M17 排期建议（2026-10-13 · R12 收口轮产出）**：

- **M14 的"文书那一半"可以提前、不占整轮**：冲突点只有两处（子代理归谁、M19 编辑归属），
  体量是一份短备忘 + 一次归口确认 —— 建议在 R13 之后**先插入一次轻量确认**（不等 R16），
  因为 M17 的状态机会落在这次确认的口径上（R16 保留原定义：只做备忘与接线口，不做实现）；
- **M11（R14）的报备材料现在就齐**：照 `docs/DESIGN-UPDATE.md` 的写法，把
  "图片字节随请求离开本机"与现有表述的冲突、三条上限（类型 / 单张大小 / 张数）、
  落盘边界（原图不许出工作区）**一次问清**；拿到批复前不动任何实现；
- **M17（R15）与 T42 同批**（既有结论不变）：转后台与断点恢复共用同一套任务状态机口径；
  实现时注意 R9 已经留下的接线：**起轮入口唯一**（`ipc/turn-trigger.ts`），恢复重放必须
  从那里进、并且**重放到高副作用动作时要重新问**（硬约束，不是可选项）。
| R17 | **前端批一 · 设计调研与设计基调**（轨道：**优化** — 体验打磨那一半）：调用前端设计技能 + 多渠道检索（设计 token / 动效规范 / 信息密度 / 同类桌面 Agent 界面对照），产出一份**可执行的设计基调**（颜色 · 间距 · 圆角 · 阴影 · 时长 · 缓动）作为后续逐页打磨的判据。**零新依赖**：CSS / Web Animations 优先 | — |
| R18 | **前端批二 · 动效与微交互落地**：按钮与清单的按压/悬停微反馈（轻微缩放）· 展开区按**真实内容高度**连续过渡（禁止突然出现与布局跳动，箭头旋转 180°）· 页签与列表切换的衔接 · 骨架/空态一致性 · 尊重 `prefers-reduced-motion`。每条动效都要有"不跳动"的机器断言或截图对照 | — |
| R19 | **前端批三 · 开源图标系统与视觉统一**：内联开源图标集（ISC/MIT，零运行时依赖；要引 npm 包 → 停牌②）替换字符图标与不合题 emoji · 统一尺寸/线宽/对齐 · 样式接线锁覆盖新类名 | — |
| R20 | **收尾批 · 清理与展示**：死代码/冗余/无用文件盘点与清理（留档 · 走 cleanup 纪律）· 文档补全 · GitHub 展示页整理（README 结构、截图、能力与边界表、隐私与许可证表述）。**跨机发布（上传产物 / 发 Release）不自行做**，需 owner 点头 | — |

**R6 / R7 是 R5 核实批直接产出的插入轮**（原 R6–R14 顺延为 R8–R16）：T16 一次核出十条成立项，
混进 M4 收口那轮会让验收面失控，所以按"同一批病一次收干净"切开。
**R5–R16 适用同一套收口动作**（与下面"每轮固定动作"一致，不另列）。新变异从 **M120** 起（至 R16 累计 **M1–M250**；下一个新靶面 **M251** 起）。
**简报节奏**：R7（T16 成立项全部收完）之后一次、R12（全仓收口）之后一次，R16 之后不论进度做一次全量交接。

**每轮固定动作**：两遍复核入账（`review/REVIEW-LOG.md`，编号自 **050** 起连续；第二遍固定含量 = ≥1 变异 + ≥1 异常路径实验）·
快档五项全绿（退出码为准，禁管道）· 中文提交 · 推送 + `ls-remote` 核对 · CHANGELOG（§32 轨道格式）· `cleanup.py --apply`。

**范围切分（R1 决定，理由写清）**：B3 只做**条件分支**；**有界循环**切给 **B3b** 候选 ——
它要处理"子图重复执行与主拓扑线的关系"，与 B2 重跑有语义重叠，混进退风险（同当年 M9a→M9b 的切法）。
**十轮之外**（需排期或决策）：M20–M22（先解定位冲突 —— **R16 已出决策备忘** `docs/DECISION-REMOTE.md`：选项 A–C + 先决清单，**待拍板**）· 开源切公开与 PAT 轮换（所有者侧）·
CodeMirror（M19 已评估为"暂不引入"，触发判据见 §一）。
**M11 / M14 / M17 已进十轮**（R12 / R14 / R13），不再属于"十轮之外"。

---

### 6.2 遗留清理滚动计划（R22–R31 已排 → **R30–R39 新排十轮**，2026-10-14 起 · 十轮收官后的续批）

> 由来：R16 收官后按"继续完成剩余任务 / 历史遗留 / bug，直到可交付"扫全队列 ——
> **R21（加固14 批一：静默五处退场）已完成** · **R22–R26 已交付**（`v0.81.0-加固15` / `v0.82.0-加固16` / `v0.83.0-规整15` / `v0.84.0-加固17` / `v0.85.0-规整16`）· **R27 = 本轮**（`v0.86.0-加固18`，审计清零批）；本表自 R22 起排**十条**，来源 = 10-09 深度审计余项（T40 批二 / T37 界面一半 / C 群）+ 挂账队列（T33证据 / T36 / e2e 两处偶发 / index.lock）+ 工具类（check:docs 机械化）。
> 固定动作与 §六 相同（两遍复核入账 · 门禁全绿 · 中文提交 · 推送 + `ls-remote` · CHANGELOG · `cleanup.py --apply`）；
> **新变异从 M263 起**（台账里这句原写"从 M254 起"，是 R24 之前的旧值 —— 累计数以 `review/mutations.json` 现读为准，本轮为该 262 条）。

| 轮 | 任务 | 停牌点 / 备注 |
|----|------|-----------|
| R22 | **修复批四 · 界面交互群（T40 渲染层 8 条）**：流式中 Enter 重发与停止按钮失效（sending 守卫 + 幽灵气泡）· IME 组合期（`isComposing`/229）发半成品 · 流式中切/新建会话无守卫 · 审批队列 `slice(1)` 竞态（统一按 id）· 5 处 `try/finally` 无 catch「点了没反应」· 翻页无在飞保护（同页重复 key）· `TerminalPanel` kill 谎报 · 文件面板读取失败谎报「没选工作区」· `CanvasPanel` viewport 存而不回放 | **✅ 已交付 `v0.81.0-加固15`** |
| R23 | **存储诚实批**：画布非原子写（改用 `atomicWriteJson`）+「损坏 ≠ 没有这张图」措辞 · **T37 界面一半**（`health` → 契约 / IPC / preload / 权限页 + 组件测试 + 变异）· **按会话的流中状态**（T40-② 正确修法：切回该会话可续见/可停 —— R22 硬拦方案被 e2e [26] 当堂否决）· T36 证据目录（`cleanup` 白名单或 `.evidence/`） | T37 属"规则可见性"，不动权限语义 · **✅ 已交付 `v0.82.0-加固16`** |
| R24 | **门禁机械化批**：check:docs「吃标题」护栏（`## [v` 段落完整性或纯插入零删除类断言）· 「慢档字样」失败信息机械化 · git 撞 `index.lock`「**可见地等**」（服务层，非静默重试） | **✅ 已交付 `v0.83.0-规整15`** |
| R25 | **证据与偶发批**：T33 界面级 e2e 证据步（种子 >120 条历史会话）· e2e 第 [20]⑤ 清除→打开**时序竞态**根因（上一批撞到）· e2e 第 17 步偶发红根因（同套取证：连跑 + 现场 dump）· **落盘失败上界面**（审计 A 残余：`flushSession` 失败目前只进 console —— 给"消息没写进去"一个用户可见的交代） | 加步骤只能插"关闭应用"之前 · **✅ 本轮交付 `v0.84.0-加固17`** |
| R26 | **文档一致批**：audit D 文档漂移 9 处逐条复核收口 · 「状态句」漂移能否机器盯的评估与最小断言 · **CHANGELOG 标题时间戳防"未来时间"的机械化评估**（R25 审计已校正 6 处；口径 = 撰写真实时刻）· **PROGRESS §三/章头计数陈旧复核**（自 R5 未维护，最新交付仍写 R2） | **✅ 本轮交付 `v0.85.0-规整16`**：9 处逐条核实（1 处早前已修 / 8 处改口 / 另抓 2 处同形）· 复述与滚动叙述全部指针化 · `check:docs` 16 → **20 条** · 注入自检 19 → **24 处** · 评估见 `docs/TEST-POLICY.md` §七 |
| R27 | **审计清零批**：10-09 审计 A/B/C 群全部条目「修了 / 登记了」二选一清零 · E 段未返回的 `packages/**` 线补一次只读复查 | ✅ **已交付**（2026-10-14，`v0.86.0-加固18`）：A/B 群 15 条逐条复看（6+6 早已修、T43/T44/T45/T46/T47/T48/T49/T50 本轮修或收尾）、E 段补做产出 T48–T59 十二条登记（详见 §4.1）；**两条停牌①（T52 前缀匹配收紧 / T53 MCP 自述只读即放行）交所有者**，一条口径待定（T55 缺结束标记算不算截断） |
| R28 | **终端与外部件批**：T41 内置终端审计记录形状定案（**只定形状**；若需动权限映射 → **停牌①先报备**）· 打包版终端 / 第三方 MCP 两项人工欠账给出自动化替代或如实降级表述 · **本轮新增**：T51 钩子 diagnostics 接进界面（与 T47 同题的另一半）· T52 那句"前缀可能被改写形态绕过"补进规则页覆盖范围 · T53 的 MCP 覆盖范围说法核对 · T58 枚举死分支清理 · T59 审批请求字段一致性锁 | **停牌①可能** |
| R28 | （上行）**终端与外部件批：把"在产却没被接"的四条线接上** | ✅ **已交付**（2026-10-15，`v0.87.0-接驳1`）：T51 诊断出口两处 / 措辞一处（工具结果 + `done.notice`，e2e 第 63 步双向判据）· T41 新增一类账 `decidedBy:'person'`（三条硬判据由 `makeRecord` 拦；**权限映射未动**）· T52 / T53 界面两句具体说法（**不改判定**，实质修法仍停牌①）· T58 死枚举两条清掉并换成穷举表 · T59 编译期类型判据 + 运行期"发送前判形状"。**本轮没做完的要说出来**：那两项人工欠账（打包版终端 / 第三方 MCP）**没有动** —— 它们要的是"打包产物里跑一遍"与"接一个真的第三方服务"，与本轮的四个代码改动不同轴，**整项挪到 R29**（与 verify:pack 补画布步骤同批处置：要么给出自动化，要么把"只能人工"写进清单而不是留在排期里当装饰）。观察项 **e2e 第 [47] 步 `Page crashed` 本轮两跑均未复现**，仍按"定不死就记账"保留，不写成已修 |
| R29 | **全仓收口回归**：慢档四项全绿（smoke · perf 规范采样 · verify:pack · **全量变异 295**）· 开源预演复跑 · **verify:pack 补画布步骤**（`LINKAGE-M9.md` §五 的登记欠账：画布新依赖/新通道"打包后仍成立"）· **从 R28 整项挪来的两项人工欠账**：打包版内置终端（node-pty 在 asar  unpacked 里到底起不起得来）· 真的第三方 MCP 服务（`readOnlyHint` 那条自述在真实服务端长什么样）—— 处置口径二选一：给出自动化，或把"只能人工"写进 `docs/CHECKLIST.md` 的手工清单，**不许留在排期里当装饰** | — |
| R29 | （上行）**全仓收口回归** | ✅ **收口完成**（2026-10-15，`v0.88.0-规整17`）：慢档四项 **三项实跑 + 一项如实"未能运行"** —— smoke ✅ · perf 首帧**空闲连续 3 次 541 / 542 / 613ms** · **`verify:pack` 未能运行**（`win-unpacked.tmp` 目录句柄被握、rename EPERM，**换目录绕不开**；3 个 `crashpad_handler` 归属读不到 ⇒ **不杀归属不明的进程**；脚本已加 fail-fast 预检，台账只记"未能运行 + 原因"）· 全量变异**首跑抓出的是靶面自己的账**（`被拦住 291 / 未被拦住 0 / 注入失败 6 / 无法运行 0`，登记 **T63**：六条锚点被 R25–R28 的合法改动搬走或改写 ⇒ 它们报的从来不是"拦住"而是"没注入"；已加**锚点全量预检**当闸门（命中≠1 当场列名、退出码 2、一条都不注入），六条重新对准；修锚时又抓到 M261 **真逃逸** ⇒ 补"第三环接线锁"（done 那次 emit 的 notice 必须引用 `noticeParts`），子集复校 **6/6 全拦**；**全量复跑（基线 `d88dc29`）`被拦住 297 / 未被拦住 0 / 注入失败 0 / 无法运行 0`**，还原后 108 个受影响测试文件全绿、`git status` 零输出 —— 291→297 那 6 格就是修准的六条）。`verify:pack` **三步 → 五步**（画布 + 打包版终端各一步，都只走不依赖外部服务的路径）· **T53 有运行期证据**（自造真子进程服务端四条用例 = **现状锁**，修好后第二条会红 = 故意的摩擦；实质修法仍停牌①）· **开源预演复跑抓到门禁自己**（登记 **T61**：第 9 条对转义形态与上级目录两种写法失明 ⇒ 判据重写 + 注入自检 24 → **26**）· **手工清单立项**（`docs/CHECKLIST.md` §3.5 五项，各写明自动化那半边在哪、剩下为什么进不了门禁、**不计入门禁全绿**）· 顺带清掉 §3.2 那行陈旧的 T41。哨兵扫描 **457 文件 × 7 类 ⇒ 真凭据 0**（20 条命中全是测试靶子，**刻意不做自动豁免**）· 复核 086 |
| R30 | **规整 18 · 预发布准备 + 两条"本轮撞出来"的门禁判据**：① `check:docs` 加**在库文本文件行尾 LF** 现扫（T62 的机器化；探针实测 444 个在库文本文件 0 命中 ⇒ 判据从零命中起步，**不加豁免清单**）；② 加 **Markdown 表格行自封闭**（以 `|` 开头的行必须以 `|` 收尾，跳过围栏与归档）——**先合并现存 5 处断行**（PROGRESS 的加固12 行 + 规整17 的 ⚠️ 行 / ROADMAP 的 T53 行 + R6 行 / WORK-PROTOCOL 的安全内核行），内容一字不改只接掉换行；③ **Release 文案草案 + 切公开检查单演练**（走 PROGRESS §二·五 那份清单逐项核，产出一份"切公开前还差什么"的可执行清单）；④ 顺手核掉 `docs/CHECKLIST.md` §3.2 里两行疑似陈旧账（T33 界面级证据、`index.lock` 可见地等 —— 两条都在 R24/R25 交付过，要按现树改口而不是照抄）。**不做跨机发布、不上传产物、不改仓库可见性** | **发布 = owner 点头**；两条新判据各配一条注入用例（不做红绿配对就不算立） |
| R30 | （上行）**发布准备与两条新护栏** | ✅ **已交付**（2026-10-15，`v0.89.0-规整18`）：① **`check:docs` 20 → 22 条** —— 第 21 条"在库文本文件行尾必须 LF"（按字节判；R29 那次整份 .md 转 CRLF 而 `git diff --numstat` 报的是干净的 `15/0`，"核对 diff 行数"救不了这一种）、第 22 条"Markdown 表格行必须自封闭"（立闸前把现存 **6 处断行**合并回单行：内容一字不改只接掉换行，合并后现扫 0 命中；判据刻意不取"列数一致" —— 误报三次的判据最后都是被人删掉）；两条各配**注入用例**（26 → 28 处），红绿都跑过且被注入文件 `git diff` 为空；② **`docs/RELEASE-PREP.md` 新建**（挂进 README 文档索引）：现扫发布页真实现状（已发布只有 `v0.9.0-w9a`，落后约 80 个 minor；另有 1 个草稿挂在 `untagged-…` 上，发出去回不去）+ **旧页含已被证伪的陈述**（"内置终端未实现"、"229 例"）⇒ 结论是整段替换不是改标题 · v0.89.0 文案草案（数字取本轮门禁真值、"已知边界"直引 T52/T53 口径、**不写下载链接与哈希**）· 切公开检查单逐项演练，**一项如实未做**：全新克隆整机演练、CI 已取到真值（三笔 `completed / success`：run 38695434754 / 38699247385 / 38701241400，末笔为本轮主体提交） · 发布动作清单四条全标 owner；③ **十轮新排期 R30–R39 落表**（R31 provider 诚实批是插轮、原 R31 全量交接顺延为 R39，理由写在表下）；④ 零产品运行时源码改动、零新依赖、**零新靶面**（变异仍 297）· 复核 087 |
| R31 | **provider 诚实批（原 R30b 插轮）**：§4.1 四条 ⬜ 待排一次收干净 —— **T54** 命令失败的机器可读字段（`evidence.exitCode` / `evidence.timedOut`，画布节点与任务步骤跟着用；模型侧仍拿原文，那条口径不动）· **T55** 上游干净断流被说成"答完了"（`finishReason` 初值是 `'stop'`、全文没人写"没收到结束标记"这一态）：**兼容口径由我这一轮定并写进台账**（有些自建端点从不发 `finish_reason`，一律判截断会把这批厂商打回不可用 ⇒ 采"新增一态 + 只在能判定时才说"），它不动安全语义、不属四类停牌 · **T56** 参数从未开始就结束却当合法零参（把"流怎么结束的"传给 `finish()`，空槽位标 `parseError`）· **T57** 三条低危（`reader.cancel()`、`cause.code` 进文案 + `errorName`、第三条按登记原文） | 新判断一律配红证；**不碰权限映射** |
| R32 | **展示页可复跑化**：`docs/screenshots/` 两张 mtime 停在 2026-10-13（v0.75.0 时代），而**仓里没有任何截图脚本**（现扫 0 命中）⇒ 写一个离屏（`show: false` + `capturePage`）取证脚本，拍当轮产物的概览/对话/新页面（终端入账、钩子诊断、断点续跑卡片、循环节点），README 图注带上"哪个版本、怎么重拍"；顺带把 `verify:pack` 的补跑结果按实际状态入账（跑得动就绿、跑不动仍记"未能运行 + 原因"） | 截图必须**亲眼看**（R12 两次返工都是看图才发现） |
| R33 | **零专测补齐**：`killProcessTree` 确无专测（PROGRESS §2.3 现记）+ 其他"只在别处间接覆盖"的关键路径盘点后逐条决定补什么；**不为覆盖率补装饰测试，只补"断言能红"的** | 每条新锁先拿去量 HEAD 旧实现 |
| R34 | **e2e 第 [17] 步偶发根因专项**：R4 撞到、R5 未复现、R25 归到 `index.lock` 由产品侧有界等待吸收，但至今**没抓到当堂现场**；本轮用"多跑 + 当堂 dump `index.lock` 是否存在与 git 子进程时序"取证，**定不死就照实记账**，不编原因 | 观察项：R27/R28 的 [47] `Page crashed` 同类处置 |
| R35 | **清理与残留治理**：把"自造产物副本"（本轮 `release/r29` 那类）纳入 `cleanup.py` 清单；盘一遍 `.trash/` 与 `apps/desktop/release/` 的实际占用并如实报告；孤儿文档 / 死文档复扫（现扫口径，不写死清单） | 删除一律走 `cleanup.py`；本轮我自己用 `rm` 清过一次，已入账，这条是把它变规矩 |
| R36 | **T31 剩下的那半：探活与重连的口径**：`alive` getter 仍只被测试消费；**自动重连会在没人点过的情况下重新起一个第三方进程**，与安全约定"每次连接都重新征得同意"正面冲突 ⇒ 先出**口径文书**（做/不做/怎么做才不破约束），拍板前不动实现 | 属"要么不写要么先定口径"那一类，不自行放行 |
| R37 | **结构性候选评估**：`ChatPanel.tsx` 等大文件（R20 登记为候选、不在清理轮拆）本轮做一次**只评估不动刀**的拆分方案（切哪个口子、代价、回归面），产出可执行的下一刀；**`max-lines` 阈值不抬** | 拆文件历史上都是"触顶就切"，主动切要有收益证据 |
| R38 | **M11 剩余（媒体生成）评估批**：按 R14 的报备流程走一次"先问清再动手"——零新依赖能做到什么程度、要装依赖就**停牌②先报备**；结论写进 `docs/DECISION-*`，不做半吊子实现 | **要装依赖 → 停牌②** |
| R39 | **全量交接轮**（原 §6.2 的 R31 顺延到这一格）：全仓文档 + 记忆 + 交接简报（含 M14 归口 5 问、M20–M22 选项、两条停牌①、外部条件现况与"切公开还差什么"的最终清单） | 切公开 / 凭据轮换 = owner |

> **R30–R39 这一排的排法说明**（免得后人以为是随手加的）：
> ① **R31 是插进来的**（用户 2026-10-15 点名"再排十轮"，我按"核出多条成立项就插轮重排编号"的既有规矩
> 把 §4.1 四条待排的 provider 诚实批插成独立一轮），**原 R31「全量交接」顺延为 R39**，内容不变、位置后移；
> ② R32–R38 的每一格都有**本轮或前几轮现扫到的证据**（不是想象出来的待办），能在 CI/门禁里落判据的都写了判据形态；
> ③ 停牌点集中在三处：**R36（自动重连与安全约定冲突）· R38（要装依赖）· R39（切公开/凭据）** ——
> 撞到就停下来说明，不自行越过；`verify:pack` 的实跑仍受本机句柄影响，跑到就补、跑不到就照实记。

**简报节奏**：每轮收口一次；**R39 做全量交接**（原表里的 R31 顺延，见上方排法说明）。
