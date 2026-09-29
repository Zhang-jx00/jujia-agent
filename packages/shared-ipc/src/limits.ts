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
