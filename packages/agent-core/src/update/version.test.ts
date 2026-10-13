import { describe, expect, it } from 'vitest';
import { compareVersions, isNewerVersion, parseVersion } from './version';

/**
 * 版本号比较的**纯规则层**（M12 批二 · R11）。
 *
 * 这是"要不要提示有新版本"的判据 —— 判错的两个方向都难看：
 * 把相同的版本说成"有新版本"是狼来了，把真新版本说成"已最新"是静默失败。
 * 所以只认**解析得动的**形状（数字段 + 可选预发布标记），解析不动一律 null —— 不猜。
 */

describe('parseVersion：只认能解析的形状', () => {
  it('带不带 v 前缀都认；1-3 段都补全成三段', () => {
    expect(parseVersion('v0.74.0')).toEqual({ segments: [0, 74, 0], prerelease: null });
    expect(parseVersion('0.74')).toEqual({ segments: [0, 74, 0], prerelease: null });
    expect(parseVersion('1')?.segments).toEqual([1, 0, 0]);
  });

  it('预发布标记保留（大小写不敏感的前缀 v 也一样剥掉）', () => {
    expect(parseVersion('V1.2.3-beta.1')?.prerelease).toBe('beta.1');
  });

  it('解析不动的返回 null（空串 / 字母 / 负数 / 空段）', () => {
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('abc')).toBeNull();
    expect(parseVersion('1.-2.3')).toBeNull();
    expect(parseVersion('1..2')).toBeNull();
  });
});

describe('compareVersions：数字段逐一比，预发布更小', () => {
  it('常规大小关系', () => {
    expect(compareVersions('0.74.0', '0.75.0')).toBeLessThan(0);
    expect(compareVersions('0.75.0', '0.74.0')).toBeGreaterThan(0);
    expect(compareVersions('v0.74.0', '0.74.0')).toBe(0);
  });

  it('"9.9.9" 比 "0.74.0" 新（按段比，不是按字符串比）', () => {
    expect(compareVersions('9.9.9', '0.74.0')).toBeGreaterThan(0);
    // 字符串比较会得出反的结论（'9' > '0' 巧合相同，但 '0.100.0' vs '0.99.0' 就会翻车）
    expect(compareVersions('0.100.0', '0.99.0')).toBeGreaterThan(0);
  });

  it('预发布比正式小：1.0.0-beta < 1.0.0（两个方向都要钉住）', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-beta')).toBeGreaterThan(0);
  });

  it('任一侧解析不动 → null（没法比就说没法比）', () => {
    expect(compareVersions('abc', '1.0.0')).toBeNull();
    expect(compareVersions('1.0.0', '')).toBeNull();
  });
});

describe('isNewerVersion：只有确实更新才 true', () => {
  it('更新的为 true；相同与更旧的为 false；解析不动也是 false', () => {
    expect(isNewerVersion('0.75.0', '0.74.0')).toBe(true);
    expect(isNewerVersion('0.74.0', '0.74.0')).toBe(false);
    expect(isNewerVersion('0.73.0', '0.74.0')).toBe(false);
    expect(isNewerVersion('abc', '0.74.0')).toBe(false);
  });
});
