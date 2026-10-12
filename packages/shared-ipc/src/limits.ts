/**
 * 轻量 IDE（M19）的**全部上限，集中在这里**（批复⑥："上限集中在常量里便于将来调"）。
 *
 * 为什么单独一个文件而不是散在各处：这些数字是"渲染层不被打爆"的边界，
 * 改一个数要能一眼看见它属于谁、为什么是这个量级。散着写就会出现
 * "树是 500、patch 是 2000、弹窗预览是 200，但没人知道它们是一套"。
 *
 * 口径与既有上限的关系：
 * - 文件读写的上限**不在**这里 —— 它们属于工具契约（`read_file` 256KB / `write_file` 2MB），
 *   已经住在 `agent-core/tools/builtin/file-tools.ts`，再抄一份就是两个真相。
 * - patch 的行数上限**不在这里**：它属于 git 读侧（`agent-core/git/git.ts` 的 `DIFF_PATCH_MAX_LINES`），
 *   渲染层拿到的 patch 早已是有界的，再存一份就是第二个真相。
 * - 所以这里只放：文件树的条目上限、审批弹窗预览上限，以及 PDF 的两条。
 */

/** 文件树单目录最多展示多少项（超出的如实标注"还有 N 项未显示"，不静默截断） */
export const TREE_MAX_ENTRIES = 500;

/** 审批弹窗里参数预览最多显示多少行（超出的如实标注"共 M 行，仅预览前 N 行"） */
export const DIALOG_PREVIEW_MAX_LINES = 200;

/** 单份 PDF 最大多少字节（超了明确拒绝，不做"尽力而为"） */
export const PDF_MAX_BYTES = 32 * 1024 * 1024;

/** PDF 最大页数（超了明确拒绝，避免解析/渲染把界面拖死） */
export const PDF_MAX_PAGES = 2000;

/**
 * 长命令实时输出的两个上界（R8.7 · M4 收尾其三）。
 *
 * 为什么是"尾部快照"而不是"增量片段"：主进程每次把**截至此刻的尾部**整段发给界面，
 * 界面只做一次替换。这样切走页签期间错过的块不会真的丢（回来还是最新那一份），
 * 也就不需要终端那套 `seq` 去重 —— 少一个机制就少一种错法。
 *
 * - `TOOL_OUTPUT_TAIL_CHARS`：单条事件的字符上限，同时也是主进程内存里的保留上限；
 * - `TOOL_OUTPUT_FLUSH_CHARS`：攒够这么多新字符才发一条（**按字节攒批，不用定时器**，
 *   理由见 `agent-core/tools/output-pump.ts`）。上限 256KB ÷ 2K ≈ 128 条，是个有限的数。
 */
export const TOOL_OUTPUT_TAIL_CHARS = 20_000;
export const TOOL_OUTPUT_FLUSH_CHARS = 2_000;
/**
 * 静默多久先把攒着的输出发一份（时间上界）。
 * 取 250ms：比一帧慢得多（界面不会被刷爆），又比"看出一条命令在不在动"的心理阈值快。
 * 没有这一条的话，只按字节攒批会让"先吐两行、然后安静半分钟"的构建命令全程空白。
 */
export const TOOL_OUTPUT_QUIET_MS = 250;

/**
 * 定时任务（M7 · R9）的上界。
 *
 * 为什么抖动是真的、不是装饰：一台机器上挂五条"每天 09:00"的任务，
 * 到点会同时起五轮模型调用；抖动把这一批摊开。它**按任务 id 派生且落盘固定**，
 * 重启后不许换点 —— 换了点就会被当成"这一次还没跑过"而重复补跑。
 *
 * 为什么 `SCHEDULE_TICK_MS` 比抖动窗口小： tick 是"多久看一眼有没有到点的"，
 * 它决定触发的最大误差；tick 30s 配抖动 120s，最坏晚 150s 起一条日程，
 * 而这些都是**可见的**（界面上的"下次"已经把抖动加进去了）。
 */
export const MAX_SCHEDULED_TASKS = 50;
export const SCHEDULE_NAME_MAX_CHARS = 40;
export const SCHEDULE_RULE_MAX_CHARS = 200;
export const SCHEDULE_PROMPT_MAX_CHARS = 4000;
export const SCHEDULE_TICK_MS = 30_000;
export const SCHEDULE_JITTER_WINDOW_MS = 120_000;
