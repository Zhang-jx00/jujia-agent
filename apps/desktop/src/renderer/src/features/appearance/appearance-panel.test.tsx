// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BUILTIN_PACKS, type ThemePack } from '@jujia/ui-tokens';
import { AppearancePanel } from './AppearancePanel';

/**
 * R58 · T79：**导入侧的主色闸门 + 界面上的主色说明**。
 *
 * 为什么这两件事必须有测试：
 * ① 闸门是**唯一**挡住"深主色 ⇒ 按钮看不见"的地方 ——
 *    `validateThemePack` 只查格式（`#RRGGBB`），**不查这个色好不好看**（它管着启动时加载已存的包，
 *    在那里硬拒绝会把用户已存的包静默退回默认包 ⇒ 闸门只能放在导入侧）。
 * ② 界面上的那句说明是"用户选了却用不上"的那一半 ——
 *    闸门只管**新导入**的；**已经存下来**的坏主色照旧加载（不动加载语义），
 *    那时唯一的去处就是界面上那句提醒。
 *
 * 断言落在**渲染出来的文本**上（这句话的作用是让用户看见，藏在注释里等于没说）。
 */

afterEach(cleanup);

function mount(pack: ThemePack): { onSave: ReturnType<typeof vi.fn> } {
  const onSave = vi.fn();
  render(<AppearancePanel pack={pack} onSave={onSave} />);
  return { onSave };
}

function importPack(pack: unknown): void {
  const ta = document.querySelector('.jj-import textarea');
  if (ta === null) throw new Error('外观页没有导入用的 textarea');
  fireEvent.change(ta, { target: { value: JSON.stringify(pack) } });
  fireEvent.click(screen.getByText('校验并应用'));
}

const BAD_PRIMARY_PACK = {
  id: 'too-dark',
  name: '太深的主色',
  version: 1,
  dialog: { bubbleShape: 'rounded', density: 'comfortable' },
  background: { kind: 'solid', color: '#141414' },
  primary: '#1a2b3c',
};

const GRAY_BAND_PACK = {
  id: 'gray-band',
  name: '灰带主色',
  version: 1,
  dialog: { bubbleShape: 'rounded', density: 'comfortable' },
  background: { kind: 'solid', color: '#141414' },
  primary: '#787878',
};

const GOOD_PACK = {
  id: 'good',
  name: '好主色',
  version: 1,
  dialog: { bubbleShape: 'rounded', density: 'comfortable' },
  background: { kind: 'solid', color: '#141414' },
  primary: '#6ba0ff',
};

describe('外观页 · 主色闸门（R58 · T79）', () => {
  it('主色太深 ⇒ 导入被拒，并给出**带实测数字**的可读理由', () => {
    mount(BUILTIN_PACKS[0]!);
    importPack(BAD_PRIMARY_PACK);
    const err = screen.getByText(/样式包被拒绝/);
    // 理由必须说清**哪一项不过、差多少**，不是"请检查你的颜色"
    expect(err.textContent).toContain('焦点环');
    expect(err.textContent).toMatch(/对比只有\s*\d/);
    // 而且**没有被应用**（主色说明块还停在原来的主色）
    expect(screen.getByText(/主色 #4c8dff/)).toBeTruthy();
  });

  it('灰带主色（两种字色都到不了 4.5:1）⇒ 导入被拒', () => {
    mount(BUILTIN_PACKS[0]!);
    importPack(GRAY_BAND_PACK);
    const err = screen.getByText(/样式包被拒绝/);
    expect(err.textContent).toContain('4.5');
    expect(screen.getByText(/主色 #4c8dff/)).toBeTruthy();
  });

  it('主色可用 ⇒ 导入成功，主色说明块显示**新**主色与实测对比度', () => {
    mount(BUILTIN_PACKS[0]!);
    importPack(GOOD_PACK);
    expect(screen.queryByText(/样式包被拒绝/)).toBeNull();
    expect(screen.getByText(/主色 #6ba0ff/)).toBeTruthy();
    // 达标时也要给实测数字（只在不达标时才说话 ⇒ 平时没人知道主色能配）
    const note = document.querySelector('[data-primary-note="true"]');
    expect(note).not.toBeNull();
    expect(note?.getAttribute('data-primary-ok')).toBe('true');
    expect(note?.textContent).toMatch(/AA 4\.5/);
  });
});

describe('外观页 · 主色说明块（R58 · T79）', () => {
  it('包不带主色 ⇒ 不显示主色说明（主按钮沿用默认主色，不必多解释）', () => {
    const { id: _id, ...rest } = BUILTIN_PACKS[0]!;
    mount({ ...rest, id: 'no-primary', primary: undefined } as ThemePack);
    expect(document.querySelector('[data-primary-note="true"]')).toBeNull();
  });

  it('已存的坏主色（加载进来的，不是新导入的）⇒ 界面要**说出是谁带来的、差多少**', () => {
    mount({ ...BUILTIN_PACKS[0]!, primary: '#1a2b3c' });
    const note = document.querySelector('[data-primary-note="true"]');
    expect(note, '坏主色却没有一句说明（用户只会以为应用配色怪）').not.toBeNull();
    expect(note?.getAttribute('data-primary-ok')).toBe('false');
    expect(note?.textContent).toContain('焦点环');
    // 不达标时要给**建议色**（还要能一键改用）
    expect(note?.textContent).toMatch(/建议色|改用/);
  });
});
