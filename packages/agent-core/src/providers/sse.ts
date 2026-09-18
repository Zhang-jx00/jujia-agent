/**
 * Server-Sent Events 解析器（只做「文本块 → 完整 data 负载」这一步，不碰 JSON）。
 *
 * 为什么要单独抽出来并重测：网络分块与事件边界**没有任何关系**——
 * 一个事件可能被拆到多个 chunk，一个 chunk 也可能含多个事件；
 * 中文/Emoji 还会让「按字节切」与「按字符切」不一致。
 * 这是流式对话最容易出错的地方（知识卡片 004：流式 UI 预算），必须先把边界测干净。
 */
export interface SseParser {
  /** 喂入一段文本，返回本次能确定的完整 data 负载（按出现顺序） */
  push(chunk: string): string[];
  /** 流结束时调用，吐出缓冲区里最后一个未以空行结束的事件 */
  flush(): string[];
}

export function createSseParser(): SseParser {
  let buffer = '';
  let dataLines: string[] = [];

  function takeEvent(): string | undefined {
    if (dataLines.length === 0) return undefined;
    const payload = dataLines.join('\n');
    dataLines = [];
    return payload;
  }

  function handleLine(rawLine: string, out: string[]): void {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    if (line === '') {
      // 空行 = 事件分隔
      const payload = takeEvent();
      if (payload !== undefined) out.push(payload);
      return;
    }
    if (line.startsWith(':')) return; // 注释/心跳（如 ": ping"）
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    // 其他字段（event: / id: / retry:）当前用不到，忽略但不报错
  }

  function consumeLines(final: boolean): string[] {
    const out: string[] = [];
    let index: number;
    // 统一处理 \r\n 与 \n
    while ((index = buffer.indexOf('\n')) !== -1) {
      const rawLine = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      handleLine(rawLine, out);
    }
    if (final) {
      // 关键：末尾可能只剩「一行没有换行符」的内容（服务端直接断流），
      // 必须把它当最后一行处理，否则最后一个事件会丢（2026-09-18 单测暴露）
      if (buffer !== '') {
        handleLine(buffer, out);
        buffer = '';
      }
      const payload = takeEvent();
      if (payload !== undefined) out.push(payload);
    }
    return out;
  }

  return {
    push(chunk: string): string[] {
      buffer += chunk;
      return consumeLines(false);
    },
    flush(): string[] {
      return consumeLines(true);
    },
  };
}
