// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ConnectionView, MediaImageGenerateResultView } from '@jujia/shared-ipc';
import { MediaGenPanel } from './MediaGenPanel';

afterEach(cleanup);

/**
 * 文生图面板（M11 剩余 · R51 · S1）· **界面层**的真值。
 *
 * 断言的是口径 6 点名的**三句话**，因为它们是"用户按下按钮之前必须知道的事"：
 * ① **成本上限**（一次几张 / 每张多大 / 单张多少 MB）；
 * ② **能力差异**：「这个连接不支持生成」—— 不是所有服务商都有这个端点，
 *    这时候要**说清楚**，不静默失败、不假装成功；
 * ③ **本机保留副本**（刻意**不是**"没人存你的提示词"—— 那是另一条边界）。
 *
 * 顺带把回执钉住：产物**路径 / 大小 / 类型**三样都要在渲染出的文本里。
 */

const connections: ConnectionView[] = [
  {
    id: 'c1',
    name: '测试连接',
    baseUrl: 'http://127.0.0.1:9/v1',
    apiFormat: 'openai-compatible',
    model: 'e2e-image-model',
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-21T00:00:00.000Z',
    hasApiKey: true,
    apiKeyHint: 'sk-…c3f9',
  },
];

/** 装一个假的 `window.jujia`（只放本面板用到的那一个方法） */
function stubBridge(result: MediaImageGenerateResultView): ReturnType<typeof vi.fn> {
  const generate = vi.fn().mockResolvedValue(result);
  (window as unknown as { jujia: unknown }).jujia = { mediaImageGenerate: generate };
  return generate;
}

/** 填提示词并点「生成」 */
async function submit(prompt: string): Promise<void> {
  fireEvent.change(screen.getByLabelText('提示词'), { target: { value: prompt } });
  fireEvent.click(screen.getByRole('button', { name: '生成' }));
}

describe('文生图面板：界面必须说清的三句话（R51 S1）', () => {
  it('① 成本上限：一次几张 / 每张多大 / 单张多少 MB，都写在界面上', () => {
    stubBridge({ ok: true, artifacts: [], reason: null, error: '' });
    render(<MediaGenPanel connections={connections} />);

    const text = document.body.textContent ?? '';
    expect(text).toContain('成本上限');
    expect(text).toContain('一次最多 4 张');
    expect(text).toContain('1024×1024');
    expect(text).toContain('5MB');
  });

  it('② 能力差异：这个连接不支持生成 —— 说得出这句话，不静默失败', async () => {
    stubBridge({
      ok: false,
      artifacts: [],
      reason: 'unsupported',
      error: '这个连接不支持生成（服务商没有图片生成端点，HTTP 404）',
    });
    render(<MediaGenPanel connections={connections} />);

    await submit('一只猫');

    await waitFor(() => {
      expect(document.body.textContent ?? '').toContain('这个连接不支持生成');
    });
    // 上游的细节也在（不是一句"失败了"）
    expect(document.body.textContent ?? '').toContain('HTTP 404');
  });

  it('③ 本机保留副本：说"本机保留副本"，且**不**说"没人存你的提示词"', () => {
    stubBridge({ ok: true, artifacts: [], reason: null, error: '' });
    render(<MediaGenPanel connections={connections} />);

    const text = document.body.textContent ?? '';
    expect(text).toContain('本机保留副本');
    expect(text).not.toContain('没人存你的提示词');
  });
});

describe('文生图面板：回执与失败（R51 S1）', () => {
  it('成功：产物路径 / 大小 / 类型都在界面上', async () => {
    stubBridge({
      ok: true,
      artifacts: [
        { path: 'D:/data/generated-images/gen-1.png', sizeBytes: 2048, mimeType: 'image/png', prompt: '一只猫' },
      ],
      reason: null,
      error: '',
    });
    render(<MediaGenPanel connections={connections} />);

    await submit('一只猫');

    await waitFor(() => {
      expect(document.body.textContent ?? '').toContain('gen-1.png');
    });
    const text = document.body.textContent ?? '';
    expect(text).toContain('image/png');
    expect(text).toContain('2KB');
    expect(text).toContain('D:/data/generated-images/gen-1.png');
  });

  it('失败：显示的是"为什么不行"，不是"生成成功"', async () => {
    stubBridge({
      ok: false,
      artifacts: [],
      reason: 'url_only',
      error: '这个连接只返回图片链接，不返回图片数据 —— 本应用不会去下载链接指向的内容',
    });
    render(<MediaGenPanel connections={connections} />);

    await submit('一只猫');

    await waitFor(() => {
      expect(document.body.textContent ?? '').toContain('只返回图片链接');
    });
    expect(document.body.textContent ?? '').not.toContain('生成结果');
  });

  it('渲染层只送「连接 id + 提示词 + 张数」，**不送 apiKey**', async () => {
    const generate = stubBridge({ ok: true, artifacts: [], reason: null, error: '' });
    render(<MediaGenPanel connections={connections} />);

    await submit('一只猫');

    await waitFor(() => {
      expect(generate).toHaveBeenCalledTimes(1);
    });
    const arg = generate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg['connectionId']).toBe('c1');
    expect(arg['prompt']).toBe('一只猫');
    expect(arg['count']).toBe(1);
    expect(Object.keys(arg)).not.toContain('apiKey');
  });
});
