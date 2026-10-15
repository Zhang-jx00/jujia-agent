import { PERMISSION_EXPIRED_REASONS } from '@jujia/shared-ipc';
import { describe, expect, it } from 'vitest';
import { EXPIRED_NOTICE, expiredNotice } from './expired-notice';

/**
 * 审批弹窗"这张单子已经作废"的那句话（T58 的第二条）。
 *
 * 旧写法是 `reason === 'timeout' ? A : B`：契约里躺着一个桥从不发送的 `cancelled`，
 * 而 else 分支会把它说成"窗口已关闭" —— **两个不同的事实共用一条兜底**，
 * 将来谁补上 cancelled，界面就撒一次谎（本项目反复登记的"兜底文案代替穷举"）。
 * 现在改成以契约为键的穷举表：新增成员不补文案就编译不过，这里再钉一遍运行期的对账。
 */
describe('审批作废的说法要穷举契约里的每一个原因（T58）', () => {
  it('表的键集合与契约的成员集合一字不差（两头都不许多）', () => {
    expect(Object.keys(EXPIRED_NOTICE).sort()).toEqual([...PERMISSION_EXPIRED_REASONS].sort());
  });

  it('timeout 说"等待超时、那一步没执行"，不说成窗口关闭', () => {
    const line = expiredNotice('timeout');
    expect(line).toContain('超时');
    expect(line).toContain('没有执行');
    expect(line).not.toContain('窗口已关闭');
  });

  it('window-closed 说"窗口关闭、全部作废"', () => {
    const line = expiredNotice('window-closed');
    expect(line).toContain('窗口已关闭');
    expect(line).toContain('作废');
  });

  it('两条说法不共用文案（同一个兜底盖两个事实正是本条要治的）', () => {
    expect(expiredNotice('timeout')).not.toBe(expiredNotice('window-closed'));
  });
});
