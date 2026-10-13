/**
 * 文档页的查看状态（T24：记住"上次打开的是哪个文件、看到第几段、滚到哪"）。
 *
 * 为什么必须是模块级：页签切走时 `DocPanel` 会被**卸载**（`App.tsx` 只给对话页包了
 * `KeepAlive`），组件里的 `useState` 跟着一起没了 —— 能活过卸载的只有这个模块。
 *
 * 为什么只放内存、不落盘：这轮要解决的是"这次运行里别让我重填路径、别从第一段重看"。
 * 把阅读位置写进配置文件是另一个语义（跨运行、可被同步、需要迁移与清理），
 * 与 T22 报备 §五 里"不做：把 sessionId 写进配置文件"是同一条取舍。
 *
 * 三条规则都是有意为之，不是顺手写的：
 * 1. **没有路径就没有可恢复的东西** —— 只记下滚动位置是没有意义的（恢复到一个没打开的文件上）；
 * 2. **换文件时旧的阅读位置不带走** —— 否则新打开一个短文件会一上来就"已显示前 480 / 12 段"；
 * 3. **数值一律收敛到非负整数** —— 恢复出来的 `scrollTop` 若是 NaN，浏览器会把它当 0，
 *    但 `shown` 是 NaN 会让"继续加载"按钮永远不出现（`blocks.length > NaN` 恒为 false），
 *    那是"看起来文档变短了"的静默错误。
 */

interface DocViewState {
  /** 相对工作区根的路径（与 `read_file` 的入参同口径） */
  path: string;
  /** 已挂载的段落数（`MarkdownView` 的 `shown`） */
  shown: number;
  /** 阅读容器里的滚动偏移（像素） */
  scrollTop: number;
}

let view: DocViewState | null = null;

/** 只接受有限非负数，其余一律收成 0（见文件头第 3 条） */
const nonNegative = (v: number | undefined): number | null => {
  if (v === undefined) return null;
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
};

/** 合并式记录：只传变化的字段，其余沿用上一次的值 */
export function rememberDocView(patch: {
  path?: string;
  shown?: number;
  scrollTop?: number;
}): void {
  const nextPath = patch.path ?? view?.path ?? '';
  if (nextPath === '') {
    view = null;
    return;
  }
  const sameFile = view !== null && view.path === nextPath;
  const prev = sameFile ? view : null;
  view = {
    path: nextPath,
    shown: nonNegative(patch.shown) ?? prev?.shown ?? 0,
    scrollTop: nonNegative(patch.scrollTop) ?? prev?.scrollTop ?? 0,
  };
}

/** 读出当前记录（**返回副本**：调用方改它不该影响这里） */
export function currentDocView(): DocViewState | null {
  return view === null ? null : { ...view };
}

/** 忘掉记录。打开失败时**必须**调用 —— 否则下次挂载又会撞同一个坏路径 */
export function clearDocView(): void {
  view = null;
}
