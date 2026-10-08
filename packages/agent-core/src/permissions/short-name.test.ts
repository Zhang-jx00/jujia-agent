import { describe, expect, it } from 'vitest';
import { eightDot3Segment } from './short-name';

/**
 * 8.3 短名形态判定（外部审查 T16 核实出来的真洞，机理是实测的）：
 *
 * 实测（`.tmp` 里的探针，本机 NTFS）：
 * - `.env` → `ENV~1`、`.git` → `GIT~1`、`.npmrc` → `NPMRC~1`、`credentials` → `CREDEN~1` 都确实存在；
 * - `realpathSync('...\\SENSIT~1.TXT')` **原样返回短名，不展开成长名**；
 * - 而敏感路径判定（`policy.ts` 的 `SENSITIVE_PATH_PATTERNS`）是**纯词法正则**。
 * 三条合起来 = 模型把 `.git/config` 写成 `GIT~1/config` 就能**不触发硬 ask** 地读到敏感文件。
 * 这与已修的 T1（顺序洞）/ T2（ADS 后缀）同族，是"敏感清单被换个写法绕掉"的第三条。
 *
 * 为什么不在路径守卫里直接拒绝短名：短名**不破坏工作区边界**（`isInside` 照样成立），
 * 而在守卫里拒会把 `a~1.md` 这类合法文件名一起打死。边界交给守卫，"这个名字我认不出来"
 * 交给敏感判定 —— 与 T2 那条"清单没命中但带流名 → 归到要问的一侧"是同一条推理。
 */

describe('eightDot3Segment', () => {
  it('认得出真实敏感名的短形式', () => {
    expect(eightDot3Segment('GIT~1/config')).toBe('GIT~1');
    expect(eightDot3Segment('ENV~1')).toBe('ENV~1');
    expect(eightDot3Segment('NPMRC~1/.env')).toBe('NPMRC~1');
    expect(eightDot3Segment('CREDEN~1')).toBe('CREDEN~1');
  });

  it('大小写不敏感（NTFS 的短名本来就是大小写不敏感的）', () => {
    expect(eightDot3Segment('git~1/config')).toBe('git~1');
  });

  it('反斜杠与正斜杠都算（Windows 上两种都能打开同一个文件）', () => {
    expect(eightDot3Segment('D:\\ws\\GIT~1\\config')).toBe('GIT~1');
  });

  it('长名与普通名一律放过（不误伤日常路径）', () => {
    for (const p of ['.git/config', 'src/main.ts', 'notes.md', 'my~file.txt', 'a~b/c', '']) {
      expect(eightDot3Segment(p), p).toBeNull();
    }
  });

  it('不符合 8.3 形状的一律放过：根名超过 8 字符、波浪号后超过 3 位数字、扩展名过长', () => {
    // 这三条边界的存在理由：宁可放过，也不要把"看起来像但不可能是短名"的合法文件名打死
    expect(eightDot3Segment('abcdefghi~1.txt')).toBeNull(); // 9 字符根名
    expect(eightDot3Segment('abc~1234.txt')).toBeNull(); // 4 位序号
    expect(eightDot3Segment('abc~1.abcdefghi')).toBeNull(); // 扩展名 9 字符
  });

  it('带点但整体仍是 8.3 形状的算短名（`README~1.MD` 这种）', () => {
    expect(eightDot3Segment('README~1.MD')).toBe('README~1.MD');
  });

  it('空字符与纯点目录不参与（交给守卫那层去拒）', () => {
    expect(eightDot3Segment('.')).toBeNull();
    expect(eightDot3Segment('..')).toBeNull();
    expect(eightDot3Segment('~/a')).toBeNull();
  });
});
