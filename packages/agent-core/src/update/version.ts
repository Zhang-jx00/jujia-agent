/**
 * 版本号比较（M12 批二 · R11）。
 *
 * "要不要提示有新版本"的全部判断都在这一个文件里 —— 判错的两个方向都难看：
 * 把相同版本说成"有新版本"是狼来了，把真新版本说成"已最新"是静默失败。
 *
 * 只认解析得动的形状（1–3 段数字 + 可选 `-预发布` 标记，可带 `v` 前缀）；
 * 解析不动一律 `null` —— **不猜**。预发布按 semver 的口径比正式小（`1.0.0-beta < 1.0.0`），
 * 预发布之间的先后不比（没有一条真实的消费路径需要它，少一个机制少一种错法）。
 */

export interface VersionParts {
  /** 补全成三段的数字段 */
  segments: [number, number, number];
  /** `-` 之后那一段（没有则为 null） */
  prerelease: string | null;
}

const SHAPE_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/i;

export function parseVersion(text: string): VersionParts | null {
  const m = SHAPE_RE.exec(text.trim());
  if (m === null) return null;
  const [, major, minor, patch, prerelease] = m;
  return {
    segments: [Number(major ?? 'NaN'), Number(minor ?? '0'), Number(patch ?? '0')],
    prerelease: prerelease ?? null,
  };
}

/** a 比 b：负 = a 旧，0 = 相同，正 = a 新；任一侧解析不动 → null（没法比就说没法比） */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null || pb === null) return null;
  for (let i = 0; i < 3; i += 1) {
    const x = pa.segments[i] ?? 0;
    const y = pb.segments[i] ?? 0;
    if (x !== y) return x - y;
  }
  // 数字段相同：正式 > 预发布；两个预发布视为相同（不比预发布内部次序）
  if (pa.prerelease === null && pb.prerelease !== null) return 1;
  if (pa.prerelease !== null && pb.prerelease === null) return -1;
  return 0;
}

/** 候选比当前确实更新才 true；解析不动也是 false（拿不准就不提示） */
export function isNewerVersion(candidate: string, current: string): boolean {
  return (compareVersions(candidate, current) ?? 0) > 0;
}
