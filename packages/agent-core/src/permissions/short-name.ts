/**
 * Windows 8.3 短名形态判定（外部审查 T16 核实出来的敏感识别旁路）。
 *
 * 三条实测事实（本机 NTFS，探针跑在 `.tmp` 里）：
 * 1. `.git` → `GIT~1`、`.env` → `ENV~1`、`.npmrc` → `NPMRC~1`、`credentials` → `CREDEN~1` 都能打开同一个对象；
 * 2. `realpathSync` **原样返回短名、不展开成长名** —— 所以"检查真实路径"那一步挡不住它；
 * 3. 敏感清单（`policy.ts` 的 `SENSITIVE_PATH_PATTERNS`）是**纯词法正则**。
 *
 * 合起来的后果：把 `.git/config` 写成 `GIT~1/config` 就能让清单失配，从而"不问就读"敏感文件。
 * 这与已修的 T1（判定顺序洞）、T2（ADS 后缀洞）同族 —— 都是"换个写法让敏感清单认不出来"。
 *
 * **为什么这里只负责"认出来"，不负责"拒绝"**：短名不破坏工作区边界（`isInside` 与 realpath
 * 对短名同样成立），在路径守卫里一律拒绝会把 `a~1.md` 这类合法文件名一起打死。
 * 该说的交给敏感判定：**这个名字我认不出来，按敏感对待、要人确认**（fail closed，但不是 deny）。
 */

/**
 * 8.3 形状：根名 1–8 个字符（不含点与波浪号）+ `~` + 1–3 位序号 + 可选的 1–3 字符扩展名。
 * 范围收紧的理由是**别误伤**：超过这些长度的 `xxx~1.yyy` 不可能是系统生成的短名。
 */
const EIGHT_DOT_3 = /^[^~.]{1,8}~\d{1,3}(\.[^~.]{1,3})?$/;

/**
 * 返回路径里**第一个**看起来是 8.3 短名的片段；没有则 `null`。
 * 盘符、UNC 前缀与普通片段都不参与（只按路径分段逐个看形状）。
 *
 * 以点开头的长名（`.env` / `.git`）天然不会被认成短名：`EIGHT_DOT_3` 的根名字符类
 * 就排除了点，所以不需要再额外写一条"以点开头跳过"的判据 —— 加了是一条永远不生效的守卫。
 */
export function eightDot3Segment(target: string): string | null {
  for (const segment of target.split(/[\\/]/)) {
    if (segment === '' || segment === '.' || segment === '..') continue;
    if (EIGHT_DOT_3.test(segment)) return segment;
  }
  return null;
}
