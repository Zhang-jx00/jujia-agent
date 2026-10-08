import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ToolError } from './types';

/**
 * 路径沙箱守卫 —— 本项目的**安全核心**，所有文件工具的必经关卡。
 *
 * 为什么必须这么严：一旦模型把路径写成 `..\..\Windows\System32\x.dll` 或
 * `C:\Users\...\.ssh\id_rsa`，Agent 就有了越界写盘/读私钥的能力。
 * 这不是「输入校验」而是「权限边界」，因此：
 * 1. 逐条拒绝 Windows 特有的绕过手法（设备路径、UNC、ADS、保留名、尾随点/空格）；
 * 2. 解析结果必须落在工作区内（大小写不敏感比较，符合 Windows 语义）；
 * 3. **检查真实路径**（realpath）：防止用符号链接/junction 把工作区内的软链指向外部；
 * 4. 任何不确定的情况一律拒绝（fail closed），错误信息说明拒绝原因，便于用户理解。
 *
 * **8.3 短名不在这里管，而且原因要写清**（外部审查 T16 核实；此前这句承诺写在上面第 1 条里，
 * 属于"注释比代码强"）：短名不改变落点边界 —— `GIT~1\config` 仍然解析在工作区内，
 * 上面三条一条都拦不到它，也不需要拦。真正会被它绕开的是**敏感名清单**（纯词法正则，
 * 且实测 `realpath` 不展开短名），所以那条判定收在 `permissions/short-name.ts`，
 * 由 `sensitiveReason` 兜底成"认不出来就按敏感对待"。**在这里一律拒绝会误伤 `a~1.md`
 * 这类合法文件名**，所以刻意不做。
 */

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** 判断 target 是否位于 root 内部（含 root 自身）；Windows 下大小写不敏感 */
export function isInside(root: string, target: string): boolean {
  const rel = relative(normalizeCase(root), normalizeCase(target));
  if (rel === '') return true;
  return !rel.startsWith('..') && !isAbsolute(rel);
}

function normalizeCase(p: string): string {
  const abs = resolve(p);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

/**
 * 把用户/模型给的路径解析为工作区内的绝对路径；越界或可疑即抛 ToolError。
 *
 * @param workspaceRoot 工作区绝对路径
 * @param input 模型给出的路径（建议绝对路径；相对路径按工作区解析）
 */
export function resolveInsideWorkspace(workspaceRoot: string, input: string): string {
  const root = resolve(workspaceRoot);
  // 注意：**不要**先 trim 再检查——`input.trim()` 会把尾随空格悄悄吃掉，
  // 等于绕过下面「以空格结尾」的检测（2026-09-18 单测暴露）。
  const raw = input;

  if (raw.trim() === '') throw new ToolError('invalid_args', '路径为空');
  if (raw.includes('\0')) throw new ToolError('invalid_args', '路径包含空字符');

  // Windows 设备路径 / UNC：`\\?\C:\...`、`\\.\PHYSICALDRIVE0`、`\\server\share`
  if (/^\\\\/.test(raw)) {
    throw new ToolError('path_denied', `拒绝访问设备路径或 UNC 路径：${raw}`);
  }
  // 备用数据流（ADS）：`file.txt:evil`、`C:\work\.env:$DATA`
  //
  // 曾经的写法是"以盘符开头的路径整体跳过这条检查"，那是**真洞**（2026-09-27 外部审查 T2）：
  // 加上盘符就能把流名带进来，而敏感名清单的正则都带结尾锚点（`\.env(\.|$)`），
  // 后缀一挂就匹配不到 —— 实测：`.env:hidden` 修前判"不敏感"、修后判"敏感"（复核 034 的 E-1）。
  // 现在只放过盘符本身，**剩下的部分见冒号一律拒**。
  // （报告里"realpath 会解析回宿主文件"这一句实测不成立：不存在的流直接 ENOENT，
  //  存在的流原样返回带流名的路径。洞是真的，机理按实测写。）
  const afterDrive = raw.replace(/^[a-zA-Z]:/, '');
  if (afterDrive.includes(':')) {
    throw new ToolError('path_denied', `拒绝访问备用数据流（ADS）路径：${raw}`);
  }
  // 尾随点/空格在 Windows 会被静默剥离，是经典绕过手法（`secret.txt.` 等价 `secret.txt`）。
  // 注意：`.` 与 `..` 是路径语义符号，不参与该检查——否则 `sub/../a.txt` 这类
  // 完全落在工作区内的合法路径会被误拒（2026-09-18 单测暴露的真实误判）。
  // 越界与否最终由下面的 isInside 判定，不依赖这一条。
  const segments = raw.split(/[\\/]/).filter((s) => s !== '');
  for (const seg of segments) {
    if (seg === '.' || seg === '..') continue;
    if (/[. ]$/.test(seg)) {
      throw new ToolError('path_denied', `路径片段以点或空格结尾（可能被系统剥离）：${seg}`);
    }
    if (WINDOWS_RESERVED.test(seg)) {
      throw new ToolError('path_denied', `路径片段是 Windows 保留设备名：${seg}`);
    }
  }

  const target = isAbsolute(raw) ? resolve(raw) : resolve(join(root, raw));

  if (!isInside(root, target)) {
    throw new ToolError(
      'path_denied',
      `路径超出工作区范围：${target}（工作区：${root}）`,
    );
  }
  return target;
}

/**
 * 真实路径校验：防止通过符号链接 / junction 逃出工作区。
 *
 * 做法：从目标向上找到**第一个已存在的祖先**，对它做 realpath，
 * 再判断真实位置是否仍在工作区内。这样既能拦住「软链指向外部」，
 * 又不会因为目标文件尚未创建（write 场景）而误报。
 */
export async function assertRealPathInside(workspaceRoot: string, target: string): Promise<string> {
  const root = resolve(workspaceRoot);
  const realRoot = await safeRealpath(root);
  // 工作区根目录本身都不存在 → 无从判断边界，直接拒绝（fail closed）
  if (realRoot === null) {
    throw new ToolError('path_denied', `工作区目录不存在，拒绝执行：${root}`);
  }

  let probe = resolve(target);
  for (let i = 0; i < 64; i += 1) {
    const real = await safeRealpath(probe);
    if (real !== null) {
      if (!isInside(realRoot, real)) {
        throw new ToolError(
          'path_denied',
          `真实路径经符号链接指向工作区之外：${probe} → ${real}`,
        );
      }
      return target;
    }
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  throw new ToolError('path_denied', `无法确认路径的真实位置（拒绝执行）：${target}`);
}

async function safeRealpath(p: string): Promise<string | null> {
  try {
    return await realpath(p);
  } catch {
    return null;
  }
}

/**
 * 组合守卫：解析 + 真实路径校验（工具的入口一律走这个）。
 *
 * 参数表里**没有**"是不是写操作"这一项（外部审查 T16 核实出的死字段）：
 * 读与写的差别待遇实际发生在权限层（`ToolDefinition.kind` → `decideGate`），
 * 这里过去只吃参数不看参数 —— 留着一个填了也不生效的开关，比没有更容易误导后来人。
 */
export async function guardPath(workspaceRoot: string, input: string): Promise<string> {
  const resolved = resolveInsideWorkspace(workspaceRoot, input);
  return assertRealPathInside(workspaceRoot, resolved);
}

/** 供 UI/日志展示的友好形式（工作区内显示相对路径） */
export function displayPath(workspaceRoot: string, target: string): string {
  const rel = relative(resolve(workspaceRoot), resolve(target));
  return rel === '' ? '.' : rel.split(sep).join('/');
}
