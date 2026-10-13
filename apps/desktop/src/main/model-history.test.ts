import { describe, expect, it } from 'vitest';
import {
  buildContentParts,
  buildModelHistory,
  mergeTurnResult,
  withContentParts,
  type ModelMessage,
} from './model-history';

/**
 * "收窄发给模型的窗口"与"保留完整历史"这两件事必须分开（6b · 报备 §一/§二）。
 *
 * 为什么单独成模块并逐条测：`chat-service` 在 vitest 里加载不了（依赖 electron），
 * 而这里错的代价很高 ——
 * ① 如果把压缩实现成"把内存历史剪短"，`session-journal` 那套"按条数追加"的坐标当场错位，
 *    下一次落盘要么重复写、要么把新消息算成负的差值；
 * ② 如果把摘要当成一条 user 消息塞进去，模型会以为**用户说了那句话**。
 * 所以这两条都写成断言，而不是注释里的一句"注意"。
 */

const msg = (role: ModelMessage['role'], content: string): ModelMessage => ({ role, content });

const full = (): ModelMessage[] => [
  msg('system', '你是俱佳Agent'),
  ...Array.from({ length: 8 }, (_, i) =>
    i % 2 === 0 ? msg('user', `问${String(i / 2)}`) : msg('assistant', `答${String((i - 1) / 2)}`),
  ),
];

describe('buildModelHistory：只窄化"发给模型的那一份"', () => {
  it('system 一条都不能少、也不能被换成摘要（摘要归 assembleSystemPrompt 管）', () => {
    const out = buildModelHistory(full(), 4);
    expect(out.filter((m) => m.role === 'system')).toHaveLength(1);
    expect(out[0]?.content).toBe('你是俱佳Agent');
    expect(out.some((m) => m.role === 'user' && m.content.includes('摘要'))).toBe(false);
  });

  it('水印之前非 system 消息一条都不发给模型，之后的照常发', () => {
    const out = buildModelHistory(full(), 4);
    const contents = out.filter((m) => m.role !== 'system').map((m) => m.content);
    expect(contents).toEqual(['问2', '答2', '问3', '答3']);
  });

  it('没有摘要段时（未压缩）除裁剪外不改动内容', () => {
    const src = full();
    const out = buildModelHistory(src, 0);
    expect(out.filter((m) => m.role !== 'system').map((m) => m.content)).toEqual(
      src.filter((m) => m.role !== 'system').map((m) => m.content),
    );
    expect(out[0]?.content).toBe('你是俱佳Agent');
  });

  it('水印推到末尾（全部已压缩）时只留 system，不再发任何原文', () => {
    const out = buildModelHistory(full(), 8);
    expect(out.map((m) => m.role)).toEqual(['system']);
  });

  it('最近窗口有上限：水印为 0 时也不会把整段历史灌给模型', () => {
    const many: ModelMessage[] = [msg('system', 'base')];
    for (let i = 0; i < 40; i += 1) many.push(msg('user', `第${String(i)}条`));
    const out = buildModelHistory(many, 0);
    expect(out.filter((m) => m.role !== 'system')).toHaveLength(12); // RECENT_TAIL_K
    expect(out[out.length - 1]?.content).toBe('第39条');
  });
});

describe('mergeTurnResult：一轮结束后仍然持有完整历史', () => {
  it('只把本轮新增的接回完整历史，被压缩的旧消息一条不少', () => {
    const src = full();
    const outbound = buildModelHistory(src, 4);
    // 模型这一轮又说了两句（loop 会把它收到的数组原样加长返回）
    const result = [...outbound, msg('assistant', '新的回答'), msg('tool', '工具结果')];
    const merged = mergeTurnResult(src, outbound, result);
    expect(merged.filter((m) => m.role !== 'system')).toHaveLength(10); // 8 原有 + 2 新增
    expect(merged.map((m) => m.content)).toContain('问0'); // 被压缩掉的那条仍在内存/盘上
    expect(merged[merged.length - 1]?.content).toBe('工具结果');
  });

  it('loop 一个字节都没加时，历史保持原样（不重复、不丢）', () => {
    const src = full();
    const outbound = buildModelHistory(src, 0);
    expect(mergeTurnResult(src, outbound, outbound)).toHaveLength(src.length);
  });

  it('反例守卫：真把内存历史剪成 outbound 会丢消息 —— 这条就是防止那样写', () => {
    const src = full();
    const outbound = buildModelHistory(src, 4);
    expect(outbound.length).toBeLessThan(src.length);
    const result = [...outbound, msg('assistant', '新')];
    const merged = mergeTurnResult(src, outbound, result);
    expect(merged.length).toBeGreaterThan(result.length);
  });
});

/**
 * M11 批一（R14）：图片只升级**出站副本**。
 *
 * 为什么这两条是安全边界而不是格式细节：内存与磁盘里的消息必须保持纯文本
 * （图片字节不落盘、也不在内存里留第二份），而"升级成 parts"只能发生在
 * 交给 provider 的那一份上 —— 写错方向（改原数组）就等于把字节复制进了会话记录。
 */
describe('buildContentParts / withContentParts：图片只升级出站副本', () => {
  const img = { mimeType: 'image/png', dataBase64: 'aGVsbG8=' };

  it('文字 + 图 → [text, image_url]，data URL 用真 mime 与 base64 拼', () => {
    expect(buildContentParts('看这张', [img])).toEqual([
      { type: 'text', text: '看这张' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
    ]);
  });

  it('文字全空白 → 不发空 text part（有些服务端不收空文本块；纯图消息合法）', () => {
    expect(buildContentParts('   ', [img])).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
    ]);
  });

  it('没有图 → 空数组（调用方据此原样返回，不给纯文字消息平白换形态）', () => {
    expect(buildContentParts('普通消息', [])).toEqual([]);
  });

  it('withContentParts 只改最后一条 user，且发的是副本 —— 原数组一个元素都不动', () => {
    const messages: ModelMessage[] = [
      msg('system', 'base'),
      msg('user', '第一句'),
      msg('assistant', '答'),
      msg('user', '第二句'),
    ];
    const parts = buildContentParts('第二句', [img]);
    const out = withContentParts(messages, parts);
    expect(out[3]?.contentParts).toEqual(parts);
    // 更早的那条 user 不许被升级：图早就不在本机了，升级等于凭空重放
    expect(out[1]?.contentParts).toBeUndefined();
    // 原数组（= 内存/磁盘那一份）保持纯文本、且非同一引用
    expect(messages[3]).toEqual({ role: 'user', content: '第二句' });
    expect(out).not.toBe(messages);
    expect(out[3]).not.toBe(messages[3]);
  });

  it('空 parts → 原数组原样返回（没图的那一轮不留任何痕迹）', () => {
    const messages: ModelMessage[] = [msg('user', '嗨')];
    expect(withContentParts(messages, [])).toBe(messages);
  });

  it('边界：没有 user 消息时原样返回，不假造一条来挂 parts', () => {
    const messages: ModelMessage[] = [msg('system', 'base')];
    expect(withContentParts(messages, buildContentParts('x', [img]))).toBe(messages);
  });
});
