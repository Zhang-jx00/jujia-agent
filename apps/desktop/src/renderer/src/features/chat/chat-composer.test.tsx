// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatComposer } from './ChatComposer';

afterEach(cleanup);

/**
 * 输入区回车语义（T40 · 加固15）：组合输入不发送、流式中不重发、Shift+Enter 换行。
 * 这三个判据此前都不存在 —— 拼音候选期回车发半成品、流式中回车重入 send()
 * （幽灵气泡 + 停止按钮失效），都是从这个缺口进来的。
 */
function mount(over: { sending?: boolean } = {}): { onSend: ReturnType<typeof vi.fn> } {
  const onSend = vi.fn();
  render(
    <ChatComposer
      input="你好"
      attached={[]}
      attachBusy={false}
      attachHint={null}
      connectionName="测试连接"
      sending={over.sending ?? false}
      hasConnection
      onInput={() => undefined}
      onPickImages={() => undefined}
      onFiles={() => undefined}
      onRemoveImage={() => undefined}
      onSend={onSend}
      onStop={() => undefined}
    />,
  );
  return { onSend };
}

describe('输入区：回车语义（T40）', () => {
  it('IME 组合期（isComposing / 229）回车不发送 —— 拼音选字不是发送键', () => {
    const { onSend } = mount();
    const box = screen.getByPlaceholderText(/输入消息/);
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('流式中回车不重发（与发送按钮 disabled 同一口径）', () => {
    const { onSend } = mount({ sending: true });
    fireEvent.keyDown(screen.getByPlaceholderText(/输入消息/), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('普通回车照常发送；Shift+Enter 不发送（换行）', () => {
    const { onSend } = mount();
    const box = screen.getByPlaceholderText(/输入消息/);
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
