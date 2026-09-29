import { TREE_MAX_ENTRIES } from '@jujia/shared-ipc';

/**
 * 轻量 IDE 的**纯判断层**（M19 报备 §六）。
 *
 * 为什么单独成模块：这几条判断全是"错了会静默出事"的类型 ——
 * 把目录截断标注当成一个文件名、把被截断的内容当成完整内容去保存、
 * 覆盖别人刚写进去的改动 …… 它们必须能被单测与变异钉住，
 * 而不是只活在一个没人测得到的组件里。
 */

export interface TreeEntry {
  name: string;
  isDir: boolean;
}

export interface Listing {
  entries: TreeEntry[];
  /** 被截断时的如实说明（原文来自工具，不另写一句） */
  note: string | null;
}

/**
 * 解析 `list_dir` 的文本输出。
 * 工具那边定的形状是：目录带尾斜杠、每行一项、截断时最后多一行「（共 N 项，只显示了前 M 项）」。
 * 认不出来就当成文件名（宁可多显示一个怪名字，也不要悄悄吞掉某一项）。
 */
export function parseListing(text: string): Listing {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const note = lines.find((l) => l.startsWith('（共')) ?? null;
  const entries = lines
    // 全角括号开头的行都是**工具在说话**（「（空目录）」/「（共 N 项…）」），不是条目
    .filter((l) => !l.startsWith('（'))
    .map((l) => (l.endsWith('/') ? { name: l.slice(0, -1), isDir: true } : { name: l, isDir: false }));
  return { entries, note };
}

/** 文件树要传的条目上限：多要一条，好让工具自己决定"是不是真的被截断了" */
export const TREE_QUERY_LIMIT = TREE_MAX_ENTRIES;

/** `read_file` 的截断标注（工具写进正文的那一句），识别它就知道"这份内容不完整" */
const TRUNCATION_MARK = '[已截断：文件共';

export function isTruncatedRead(content: string): boolean {
  return content.includes(TRUNCATION_MARK);
}

export function isPdfPath(path: string): boolean {
  return path.toLowerCase().endsWith('.pdf');
}

/**
 * 保存前的覆盖保护：打开时那份内容与**此刻盘上的**内容不一致，就拒绝保存。
 *
 * 为什么用"内容相等"而不是报备里写的 `size+mtime`：整文件覆盖语义下真正要防的是
 * "把别人的改动盖掉"，而内容比对是这件事的**强信号**（mtime 会被 touch 之类误报，
 * 内容是事实）。代价是保存前多读一次文件 —— 本地盘、上限 256KB，值得。
 */
export function shouldRefuseSave(opened: string, current: string): boolean {
  return opened !== current;
}
