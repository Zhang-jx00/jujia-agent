import { IPC, mediaImageGenerateRequestSchema, mediaImageGenerateResultSchema } from '@jujia/shared-ipc';
import { generateImageForConnection } from '../media/image-gen-service';
import type { IpcContext } from './context';

/**
 * 媒体生成 · 文生图（M11 剩余 · R51 · S1）的 IPC 通道。
 *
 * 这一层**只做两件事**：把载荷过一遍契约、把服务的回执过一遍契约。
 * 业务全在 `media/image-gen-service.ts` 里 —— 通道层不写业务，是为了"同一份逻辑能被
 * 单测直接打到"（服务层测试不经过 IPC，也就不必起 Electron）。
 *
 * **密钥不在这条链路上**：渲染层只传「连接 id + 提示词 + 张数」，
 * 密钥由服务层在主进程里从连接记录取（SECURITY.md 铁律）。
 *
 * **不进权限门、不进执行审计**（生成不是工具调用，报备稿 §五-7）：这一层刻意没有
 * 调 `ctx.permission` / `ctx.audit` —— 将来谁要加回来，得先想清楚那句报备。
 */
export function registerMediaIpc(ctx: IpcContext): void {
  const { handle } = ctx;

  handle(IPC.MEDIA_IMAGE_GENERATE, async (_e, payload: unknown) => {
    const parsed = mediaImageGenerateRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return mediaImageGenerateResultSchema.parse({
        ok: false,
        artifacts: [],
        reason: 'bad_response',
        error: '请求形状不合法（提示词不能为空、连接必须选一个）',
      });
    }
    const outcome = await generateImageForConnection(parsed.data);
    return mediaImageGenerateResultSchema.parse({
      ok: outcome.ok,
      artifacts: outcome.artifacts,
      reason: outcome.reason,
      error: outcome.error,
    });
  });
}
