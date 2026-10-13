import { app, dialog } from 'electron';
import { z } from 'zod';
import {
  IPC,
  chatHistoryQuerySchema,
  chatImageBytesSchema,
  chatPickImagesResultSchema,
  imageIntakeResultSchema,
  chatSendResultSchema,
  chatSendSchema,
  compactApplySchema,
  connectionInputSchema,
  pendingPreviewSchema,
  pendingResolveSchema,
  testResultSchema,
  type ChatSendResult,
  type CompactApplyResult,
  type CompactPreviewResult,
  type ConnectionView,
  type PendingPreviewResult,
  type PendingResolveResult,
  type TestResult,
} from '@jujia/shared-ipc';
import { listModels } from '@jujia/agent-core';
import {
  createConnection,
  deleteConnection,
  listConnectionViews,
  resolveConnection,
  updateConnection,
} from '../connections-store';
import {
  compactPreview,
  compactApply,
  compactStatus,
  historyPage,
  listSessions,
  markAllResidentEnded,
  markSessionEnded,
  pendingNotePreview,
  pendingNoteResolve,
  pendingNotesList,
  stopMessage,
} from '../chat-service';
import { prepareByteImages, readImageFiles } from '../image-intake';
import { getWorkspaceInfo } from '../workspace';
import type { IpcContext } from './context';

/**
 * 连接管理与对话的通道。
 *
 * **起一轮对话的汇聚点不在这里** —— 它在 `ipc/turn-trigger.ts` 的 `startTurn`（M7 · R9 抽出去的）。
 * 理由：模式、用户规则、高危清单、钩子运行器、共享注册表、技能清单、审计出口这一串参数，
 * 少传一项的表现不是报错而是"界面看起来一切正常、引擎在裸奔"（W10g 之前的死代码状态）；
 * 而定时任务到点也要起一轮，两处各写一份清单就一定会漂。这里只负责通道与入参契约。
 */
export function registerChatIpc(ctx: IpcContext): void {
  const { handle, fetchImpl, startTurn } = ctx;

  /* ------------------------------ 连接管理 ------------------------------ */

  handle(IPC.CONNECTION_LIST, async (): Promise<ConnectionView[]> => {
    return listConnectionViews();
  });

  handle(IPC.CONNECTION_CREATE, async (_e, input: unknown): Promise<ConnectionView> => {
    return createConnection(connectionInputSchema.parse(input));
  });

  handle(IPC.CONNECTION_UPDATE, async (_e, payload: unknown): Promise<ConnectionView> => {
    const { id, patch } = (payload ?? {}) as { id?: unknown; patch?: unknown };
    if (typeof id !== 'string' || id === '') throw new Error('缺少连接 id');
    return updateConnection(id, patch);
  });

  handle(IPC.CONNECTION_DELETE, async (_e, id: unknown): Promise<boolean> => {
    if (typeof id !== 'string' || id === '') throw new Error('缺少连接 id');
    return deleteConnection(id);
  });

  handle(IPC.CONNECTION_TEST, async (_e, id: unknown): Promise<TestResult> => {
    if (typeof id !== 'string' || id === '') throw new Error('缺少连接 id');
    const started = Date.now();
    try {
      const { record, apiKey } = await resolveConnection(id);
      const models = await listModels(
        { baseUrl: record.baseUrl, apiKey, signal: AbortSignal.timeout(20_000) },
        { fetcher: fetchImpl },
      );
      return testResultSchema.parse({
        ok: true,
        message: `连通成功，可用模型 ${models.length} 个`,
        models,
        latencyMs: Date.now() - started,
      });
    } catch (err) {
      return testResultSchema.parse({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        models: [],
        latencyMs: Date.now() - started,
      });
    }
  });

  /* -------------------------------- 对话 -------------------------------- */

  handle(IPC.CHAT_SEND, async (_e, payload: unknown): Promise<ChatSendResult> => {
    // 入参契约在 shared-ipc（T30）：上限与文案都在那一处，主进程只把失败理由照原样抛出。
    // 以前是这里手写 `typeof`，三个字段都没有长度上限 —— 检查散在调用点就会漏。
    const parsed = chatSendSchema.safeParse(payload ?? {});
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? '对话参数不合法');
    // "消息不能为空"由契约的 refine 判定（全空白也算空；**带图时文字可以为空** —— 纯图消息合法）
    const { connectionId, text, sessionId, images } = parsed.data;

    // 起一轮的全部汇聚点（策略、注册表、钩子、审计、技能清单）在 `startTurn` 里，只有那一处；
    // 定时任务到点走的是同一个函数 —— 抄两份参数清单早晚漏一项。
    const result = await startTurn({
      connectionId,
      text,
      ...(typeof sessionId === 'string' && sessionId !== '' ? { sessionId } : {}),
      ...(images !== undefined && images.length > 0 ? { images } : {}),
    });
    return chatSendResultSchema.parse({ ...result, accepted: true, warning: result.warning });
  });

  handle(IPC.CHAT_STOP, async (_e, sessionId: unknown): Promise<boolean> => {
    if (typeof sessionId !== 'string' || sessionId === '') return false;
    return stopMessage(sessionId);
  });

  /* ------------------------- 多模态输入（M11 批一 · R14） ------------------------- */

  /**
   * 选图片：原生对话框 → 主进程 stat/读取/剥元数据 → 返回**已准入**的图。
   * 取消是正常路径（`cancelled=true`，不塞进 problems）；逐张给结果。
   */
  handle(IPC.CHAT_PICK_IMAGES, async () => {
    const win = ctx.deps.getWindow?.();
    if (win === undefined) {
      return chatPickImagesResultSchema.parse({ cancelled: true, images: [], problems: [] });
    }
    const picked = await dialog.showOpenDialog(win, {
      title: '选择图片（会随请求发给当前连接的服务商）',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      return chatPickImagesResultSchema.parse({ cancelled: true, images: [], problems: [] });
    }
    const result = await readImageFiles(picked.filePaths);
    return chatPickImagesResultSchema.parse({ cancelled: false, ...result });
  });

  /** 拖动/粘贴：渲染层给**原始字节**，走**同一个准入内核**（不比选择器少一道） */
  handle(IPC.CHAT_IMAGES_PREPARE, async (_e, payload: unknown) => {
    const parsed = z.array(chatImageBytesSchema).max(8).safeParse(payload ?? []);
    if (!parsed.success) {
      return imageIntakeResultSchema.parse({
        images: [],
        problems: ['图片载荷不符合契约（一张都没有加入）'],
      });
    }
    return imageIntakeResultSchema.parse(prepareByteImages(parsed.data));
  });

  /** 会话清单（磁盘事实）：界面用它列出可继续的历史会话，与内存驻留与否无关 */
  handle(IPC.CHAT_LIST, async () => listSessions());

  /**
   * 分页读历史。**盘上是事实，内存只是缓存**：会话没驻留也读得出来，
   * 所以"重启后还能继续"这件事在 IPC 层就是可达的，不靠运气等 GC 之前的余温。
   */
  handle(IPC.CHAT_HISTORY, async (_e, payload: unknown) => {
    const parsed = chatHistoryQuerySchema.safeParse(payload);
    if (!parsed.success) return { messages: [], total: 0, hasMore: 0 };
    const { sessionId, ...page } = parsed.data;
    return historyPage(sessionId, page);
  });

  /* ---------------- 6b：压缩与「结束记要点」（详见 chat-service 末尾那一段） ---------------- */

  /** 只回答"该不该问用户一句"；主进程没有任何因阈值自动压缩的路径 */
  handle(IPC.CHAT_COMPACT_STATUS, async (_e, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || sessionId === '') return null;
    return compactStatus(sessionId);
  });

  /** 生成摘要给人看 —— 这一步**什么都不写** */
  handle(IPC.CHAT_COMPACT_PREVIEW, async (_e, sessionId: unknown): Promise<CompactPreviewResult> => {
    if (typeof sessionId !== 'string' || sessionId === '') {
      return { ok: false, summary: '', truncated: false, willCover: 0, error: '缺少会话标识' };
    }
    const r = await compactPreview(sessionId);
    return r.ok === true
      ? { ok: true, summary: r.summary, truncated: r.truncated, willCover: r.willCover, error: '' }
      : { ok: false, summary: '', truncated: false, willCover: 0, error: r.error };
  });

  /** 用户在预览上点了「就按这版存」才会到这里 */
  handle(IPC.CHAT_COMPACT_APPLY, async (_e, payload: unknown): Promise<CompactApplyResult> => {
    const parsed = compactApplySchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, compactedThrough: 0, error: '请求形态不合法，未做任何改动' };
    }
    const r = await compactApply(parsed.data.sessionId, parsed.data.summary);
    return {
      ok: r.ok,
      compactedThrough: r.compactedThrough,
      error: r.error ?? '',
    };
  });

  /** 显式结束会话：只记一笔待办，**不调模型、不写长期记忆** */
  handle(IPC.CHAT_END, async (_e, sessionId: unknown): Promise<PendingResolveResult> => {
    if (typeof sessionId !== 'string' || sessionId === '') {
      return { ok: false, error: '缺少会话标识' };
    }
    const r = await markSessionEnded(sessionId);
    return { ok: r.ok, error: r.error ?? '' };
  });

  handle(IPC.CHAT_PENDING_LIST, async () => pendingNotesList());

  /**
   * 退出时给"有内容、还没记过要点"的驻留会话留账（报备 §四 / 批复④）。
   *
   * **为什么挂在 `will-quit` 而不是 `before-quit`，是探针量出来的**
   * （`.tmp/probe-quit3.mjs`：`window-all-closed → before-quit → will-quit → quit`）：
   * 原先在 `before-quit` 里"发射后不管"地异步写，`quit` 紧接着就把进程带走了 ——
   * 那次 tmp→fsync→rename 的写入**一次都没落到盘上**（探针对照组实测），
   * 于是"下次启动补问"这件事静默地永远不会发生。e2e 第 30 步第一次跑就是这样红的。
   *
   * 所以这里 `preventDefault()` 停一下，等写完（或等满预算）再强制退出。
   * 预算必须有上界：**宁可丢这笔账，也不能让应用关不掉**；丢了要说出来，不许静默。
   */
  let ledgerFlushStarted = false;
  app.on('will-quit', (event) => {
    if (ledgerFlushStarted) return;
    ledgerFlushStarted = true;
    event.preventDefault();
    const settled = markAllResidentEnded().then(
      () => 'done' as const,
      (err: unknown) => {
        console.warn('[chat] 退出留账失败（下次启动不会有补问提示）：', err);
        return 'error' as const;
      },
    );
    const budget = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), 1_000);
    });
    void Promise.race([settled, budget]).then((outcome) => {
      if (outcome === 'timeout') {
        console.warn('[chat] 退出留账没在 1 秒内写完，放弃等待：下次启动不会有补问提示');
      }
      app.exit(0);
    });
  });

  /** 补问时的预览：同样不落盘；连接由主进程按会话记录决定，渲染层不传 */
  handle(IPC.CHAT_PENDING_PREVIEW, async (_e, payload: unknown): Promise<PendingPreviewResult> => {
    const parsed = pendingPreviewSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, text: '', error: '请求形态不合法，未做任何改动' };
    const r = await pendingNotePreview(parsed.data.sessionId);
    return r.ok === true ? { ok: true, text: r.text, error: '' } : { ok: false, text: '', error: r.error };
  });

  /**
   * 唯一能把要点写进长期记忆的那一下。
   * 工作区根目录**由这里现取**而不是信渲染层传来的值 —— 渲染层报一个路径过来就写一个路径，
   * 等于把"记忆写到哪儿"交给网页级的输入决定（与自选程序路径只能走对话框是同一条原则）。
   */
  handle(IPC.CHAT_PENDING_RESOLVE, async (_e, payload: unknown): Promise<PendingResolveResult> => {
    const parsed = pendingResolveSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, error: '请求形态不合法，未做任何改动' };
    if (parsed.data.workspaceRoot !== null) {
      return { ok: false, error: '请求里带了工作区路径：这一路由主进程决定，渲染层不传' };
    }
    const info = await getWorkspaceInfo();
    const root = info.root && info.valid ? info.root : null;
    const r = await pendingNoteResolve({
      sessionId: parsed.data.sessionId,
      action: parsed.data.action,
      text: parsed.data.text,
      workspaceRoot: root,
    });
    return { ok: r.ok, error: r.error ?? '' };
  });
}
