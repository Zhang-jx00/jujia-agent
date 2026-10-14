import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamChat } from './openai-compat';
import type { ProviderEvent } from './types';

/**
 * T48：上游原文进界面 / 日志之前先剔密（2026-10-14 审计清零批）。
 *
 * 症状：`HTTP ${status}：${safeText(res)}` 与 `上游返回错误：${JSON.stringify(json.error)}`
 * 都是把**上游原文**拼进错误消息，而这条消息会一路走到
 * `chat-service` 的 `error` 事件 → 渲染层气泡（本仓第一条红线：密钥不进渲染层）。
 * 仓里早就有一张 `maskSecrets` 表（审计落盘用它），但 provider 这两条出口没有调它。
 *
 * 形状取自真实会发生的形态：不少网关把整条 `Authorization` 回显在 401 正文里
 * （"你给的 Bearer xxx 不被接受"），代理与自建 vLLM 的报错更常直接带上请求头。
 * 所以这不是假想敌：**一次 401 就能把密钥显示在聊天窗口里，并随对话历史落盘。**
 */

const SECRET = 'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const servers: { close: () => Promise<void> }[] = [];

async function serve(status: number, contentType: string, body: string): Promise<string> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(status, { 'Content-Type': contentType });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  servers.push({ close: () => new Promise<void>((resolve) => server.close(() => resolve())) });
  return `http://127.0.0.1:${port}/v1`;
}

async function drain(stream: AsyncGenerator<ProviderEvent>): Promise<void> {
  // 逐条读完就行，这里断言的是"抛的是什么错"，不是正文
  for await (const ev of stream) void ev;
}

async function failureOf(stream: AsyncGenerator<ProviderEvent>): Promise<string> {
  try {
    await drain(stream);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error('期望抛错，实际跑完了');
}

afterEach(async () => {
  while (servers.length) {
    const s = servers.pop();
    if (s) await s.close();
  }
});

describe('T48：错误消息里的上游原文要过剔密表', () => {
  it('401 正文回显了 Authorization → 消息里不许留原值，且要说清隐过', async () => {
    const baseUrl = await serve(
      401,
      'text/plain',
      `unauthorized: got header 'Authorization: Bearer ${SECRET}'`,
    );
    const msg = await failureOf(
      streamChat({ baseUrl, apiKey: 'bad', model: 'm', messages: [] }),
    );
    expect(msg).not.toContain(SECRET);
    expect(msg).toContain('***');
    // 状态码与"上游确实说了话"这两格不许因为剔密而丢掉
    expect(msg).toContain('401');
  });

  it('SSE data 里的 error 对象带密钥 → 同样不许留原值', async () => {
    const baseUrl = await serve(
      200,
      'text/event-stream',
      `data: ${JSON.stringify({ error: { message: 'quota', api_key: SECRET } })}\n\n`,
    );
    const msg = await failureOf(
      streamChat({ baseUrl, apiKey: 'k', model: 'm', messages: [] }),
    );
    expect(msg).not.toContain(SECRET);
  });

  it('上游 error 是超长文本 → 消息有上界（不截正文，但错误串不能无限长）', async () => {
    const baseUrl = await serve(
      200,
      'text/event-stream',
      `data: ${JSON.stringify({ error: { message: 'E'.repeat(100_000) } })}\n\n`,
    );
    const msg = await failureOf(
      streamChat({ baseUrl, apiKey: 'k', model: 'm', messages: [] }),
    );
    expect(msg.length).toBeLessThan(1_000);
  });

  it('跳过无法解析负载的那行日志也不留原文（打包后日志会落文件）', async () => {
    const seen: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      seen.push(args.map(String).join(' '));
    });
    const baseUrl = await serve(
      200,
      'text/event-stream',
      `data: 这不是JSON Bearer ${SECRET}\n\n`,
    );
    await failureOf(streamChat({ baseUrl, apiKey: 'k', model: 'm', messages: [] }));
    spy.mockRestore();
    const logged = seen.join('\n');
    expect(logged).toContain('跳过无法解析的 SSE 负载');
    expect(logged).not.toContain(SECRET);
  });
});
