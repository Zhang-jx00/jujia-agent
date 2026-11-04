#!/usr/bin/env node
/**
 * **第三方声明常量的发现**（R73 · 排查42 收口 · 原在制品线编号 R77）。
 *
 * ## 为什么要抽出来（而不是各写各的）
 *
 * 「声明在不在分发副本里」这件事要判两处：**构建产物**（`out/`）与**打包产物**（`app.asar`）。
 * 两处都必须回答同一个问题：**这次该保留的声明，一共是哪些、分别是什么字**。
 * ⇒ 如果两处各自写一套发现规则（各自的正则、各自的字面量还原），那就是**两份实现**，
 *   而两份实现会长出**两个答案** ⇒ 某天加了新常量，A 处查到了、B 处没查到 ⇒
 *   B 处的门禁**假绿**（这正是本仓「同一事实两处手抄必然漂」那条纪律在代码层的形状）。
 * ⇒ 所以发现规则只写一份，本模块即那一份。
 *
 * ## 发现的形状
 *
 * 源码里形如 `export const <素材>_NOTICE = '…'` 的常量。
 * · 为什么是 `export const`：它必须是**模块级导出**才可能被别的模块引用（能被引用 ⇒ 能被打包器保留）；
 * · 为什么只认这一种登记方式：这是本仓当前唯一的登记口径（`THIRD_PARTY_NOTICES.md` 末尾那两步也是它）。
 *   ⇒ **覆盖不到的地方如实说明**（别吹）：新增了素材却压根没写声明 ⇒ 本模块查不出来，
 *   那是**人的纪律**，不是机器能兜住的。
 *
 * @typedef {{ name: string, text: string, file: string }} NoticeConstant
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** 声明常量的命名约定：`<素材>_NOTICE` */
export const NOTICE_NAME_RE = /^[A-Za-z0-9_]*_NOTICE$/;

/** `export const X_NOTICE = <字面量>;` —— 字面量限单引号 / 双引号 / 无插值模板串 */
const NOTICE_RE =
  /export\s+const\s+([A-Za-z0-9_]*_NOTICE)\s*=\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)\s*;/g;

/**
 * **剥掉注释再匹配** —— 否则注释里写一句 `export const X_NOTICE = '…'` 就能把门禁骗绿。
 * （与本仓其它判据同一套做法：匹配前先剥注释。）
 */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * 把源码里的字符串字面量还原成运行时的值。
 * @returns {string | null} 插值模板串之类判据处理不了的 ⇒ 返 `null`（如实放行，交给人工）
 */
export function extractLiteral(literal) {
  const quote = literal[0];
  const body = literal.slice(1, -1);
  if (quote === '`') {
    if (body.includes('${')) return null;
    return body;
  }
  if (quote === '"') {
    try {
      return JSON.parse(literal);
    } catch {
      return null;
    }
  }
  return body.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

/**
 * 递归收集目录下的源码文件（**跳过测试文件** —— 只被测试引用的常量进不了分发副本）。
 * @param {string} dir
 * @param {string[]} [out]
 * @returns {string[]}
 */
export function collectSourceFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) {
      if (name.name === 'node_modules') continue;
      collectSourceFiles(full, out);
    } else if (/\.tsx?$/.test(name.name) && !/\.test\.tsx?$/.test(name.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * **发现全部声明常量**（本仓唯一一份发现规则）。
 * @param {string} srcRoot 源码根目录
 * @returns {NoticeConstant[]}
 */
export function collectNoticeConstants(srcRoot) {
  const found = [];
  for (const file of collectSourceFiles(srcRoot)) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(NOTICE_RE)) {
      const value = extractLiteral(m[2]);
      if (value === null) continue;
      found.push({ name: m[1], text: value, file });
    }
  }
  return found;
}

/**
 * 便捷入口：按仓库根解析出源码根，并返回发现结果（带相对路径，便于打印）。
 * @param {string} repoRoot
 * @returns {NoticeConstant[]}
 */
export function noticeConstantsOfRepo(repoRoot) {
  const srcRoot = join(repoRoot, 'apps', 'desktop', 'src');
  return collectNoticeConstants(srcRoot).map((n) => ({
    ...n,
    file: relative(repoRoot, n.file).replace(/\\/g, '/'),
  }));
}
