import { z } from 'zod';

/**
 * 多模态输入的 IPC 契约（M11 批一 · R14，报备 `docs/DESIGN-MULTIMODAL.md` 四条已批）。
 *
 * 两条形状上的纪律：
 * - 图片载荷只有两种形态、各管一条路：**发送**给 base64（`chatImageInputSchema`，
 *   跨进程传的是准备后的字节），**准入**给原始字节（`chatImageBytesSchema`，
 *   结构化克隆原样送达，渲染层不用自己编码）；
 * - 上限在这里再写一道（真窗口是 `agent-core` 的常量）—— 契约是**界线**，
 *   越线的载荷在边界就被拒，不指望下游每一站都记得拦。
 */

/** 单张 base64 字符上限：5MB 原始字节的 base64 ≈ 6.99MB，取 8M 留余量（真判据在字节层） */
const MAX_BASE64_CHARS = 8_000_000;

/**
 * 一条消息最多几张图。这里一份是**给渲染层用的界线副本**（界面要据此禁"再添加"）；
 * 主进程侧的真判据在 `agent-core` 的 `IMAGE_MAX_PER_MESSAGE` —— 两处各守一侧，值必须一致。
 */
export const CHAT_IMAGE_MAX_PER_MESSAGE = 4;

export const chatImageInputSchema = z
  .object({
    name: z.string().min(1).max(200),
    dataBase64: z.string().min(1).max(MAX_BASE64_CHARS),
  })
  .strict();
export type ChatImageInput = z.infer<typeof chatImageInputSchema>;

/**
 * 拖动/粘贴那条路的入参：**原始字节**（`z.instanceof(Uint8Array)` 在三个 realm 里都成立：
 * 渲染层 → contextBridge → preload → IPC → main，结构化克隆每站都还原成该侧的真 Uint8Array）。
 * 字节上限这里只是"挡大得离谱的载荷"；5MB 的真判据在 `prepareImage`，不在这里代替它。
 */
export const chatImageBytesSchema = z
  .object({
    name: z.string().min(1).max(200),
    bytes: z.instanceof(Uint8Array).refine((b) => b.byteLength <= MAX_BASE64_CHARS, {
      message: '图片字节超过上限',
    }),
  })
  .strict();
export type ChatImageBytes = z.infer<typeof chatImageBytesSchema>;

export const imageMimeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export type ImageMimeView = z.infer<typeof imageMimeSchema>;

/** 准入之后（校验过、元数据剥过）的图片：**这是渲染层能拿到的最完整形态** */
export const preparedImageViewSchema = z
  .object({
    name: z.string(),
    mimeType: imageMimeSchema,
    /** 剥完元数据的字节（预览与发送都用它 —— 界面拿不到未剥的原始字节） */
    dataBase64: z.string(),
    /** 原始字节数（展示"多大一张"用原始值） */
    sizeBytes: z.number().int().nonnegative(),
    /** 是否真的剥掉了东西（gif 这类没有可剥容器 → false，如实说） */
    stripped: z.boolean(),
  })
  .strict();
export type PreparedImageView = z.infer<typeof preparedImageViewSchema>;

export const imageIntakeResultSchema = z
  .object({
    images: z.array(preparedImageViewSchema).max(4),
    /** 每一条都是"哪张图 + 为什么没进来"（超量、过大、认不出、剥不干净……） */
    problems: z.array(z.string()),
  })
  .strict();
export type ImageIntakeResultView = z.infer<typeof imageIntakeResultSchema>;

/** 选择器那条路的结果：取消是**正常路径**，单列一格（不是 problem） */
export const chatPickImagesResultSchema = imageIntakeResultSchema
  .extend({ cancelled: z.boolean() })
  .strict();
export type ChatPickImagesResult = z.infer<typeof chatPickImagesResultSchema>;
