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

/* ------------------------------ 媒体生成（M11 剩余 · R51 · S1 · 文生图） ------------------------------ */

/**
 * 一次生成的张数上限（界面这一侧能选的最大值）。
 *
 * 与 `CHAT_IMAGE_MAX_PER_MESSAGE` 同一个纪律：这里是一份**给渲染层用的界线副本**，
 * 真判据在主进程（`MEDIA_IMAGE_MAX_COUNT`）—— 两处各守一侧，值必须一致。
 */
export const MEDIA_IMAGE_MAX_COUNT = 4;

/**
 * 单张产物的字节上限（**回程**字节 —— 不是入站那一道门；入站那道在 R14）。
 * 真判据是 `agent-core` 的 `IMAGE_MAX_BYTES`（5MB），这里是同值副本。
 */
export const MEDIA_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** 提示词长度上限（字符）—— 界面据此禁"超长还发" */
export const MEDIA_IMAGE_PROMPT_MAX_CHARS = 2000;

/**
 * 产物尺寸（S1 固定一档）。
 *
 * 刻意**不开放**尺寸选择：`1024x1024` 是 OAI 兼容那一族唯一全都认的尺寸，
 * 放开选尺寸就等于让用户能选出"这家的服务商不认"的组合 ⇒ 失败原因会变得没法解释。
 */
export const MEDIA_IMAGE_DEFAULT_SIZE = '1024x1024';

/**
 * 单次生成的**时长上限**（毫秒）—— 报备稿 §五-3 的三样上限之一（张数 / 时长 / 大小）。
 *
 * 真判据在 `agent-core` 的 `IMAGE_GEN_TIMEOUT_MS`；这里是一份**给渲染层看的界线副本**
 * （界面要**事先**把"最多等这么久"告诉用户），两处各守一侧，值必须一致。
 */
export const MEDIA_IMAGE_TIMEOUT_MS = 120_000;

/**
 * 文生图请求（渲染层 → 主进程）。
 *
 * **这里没有 apiKey**：密钥只在主进程从连接记录里取（SECURITY.md 铁律：渲染层拿不到明文）。
 * **这里也没有落盘目录**：落点由主进程定（本应用数据目录），渲染层没有发言权。
 * 请求里只有三样：走哪条连接、提示词、要几张。
 */
export const mediaImageGenerateRequestSchema = z
  .object({
    connectionId: z.string().min(1).max(64),
    prompt: z.string().min(1).max(MEDIA_IMAGE_PROMPT_MAX_CHARS),
    count: z.number().int().min(1).max(MEDIA_IMAGE_MAX_COUNT).default(1),
  })
  .strict();
export type MediaImageGenerateRequest = z.infer<typeof mediaImageGenerateRequestSchema>;

/** 一件产物：落在哪、多大、是什么类型、当时那句提示词 */
export const mediaImageArtifactSchema = z
  .object({
    /** 绝对路径（在本应用数据目录里） */
    path: z.string().min(1),
    /** 字节数（原始字节，不是 base64 长度） */
    sizeBytes: z.number().int().nonnegative(),
    /** 类型（**按魔数认出来的**，不是按扩展名） */
    mimeType: imageMimeSchema,
    /** 提示词回显（截断过；不存到盘上的元数据里） */
    prompt: z.string(),
  })
  .strict();
export type MediaImageArtifactView = z.infer<typeof mediaImageArtifactSchema>;

/**
 * 失败原因分类 —— 界面要"各有各的一句话"（报备稿 §五-2），所以先有分类再有人话。
 *
 * - `unsupported`：**这个连接不支持生成**（端点不存在 / 被服务商拒了）
 * - `url_only`：服务商只给图片**链接** ⇒ 本应用不去下载它（避免把请求引到任意地址）
 * - `too_large`：回程字节超过 5MB 上限
 * - `not_image`：回程字节的魔数认不出是图片
 * - `bad_response`：返回结构不是 OAI 兼容的生成响应
 * - `no_connection`：连接不存在 / 没有可用密钥
 * - `write_failed`：产物落盘失败
 */
export const mediaImageFailReasonSchema = z.enum([
  'unsupported',
  'url_only',
  'too_large',
  'not_image',
  'bad_response',
  'http_error',
  'network_error',
  'timeout',
  'no_connection',
  'write_failed',
]);
export type MediaImageFailReason = z.infer<typeof mediaImageFailReasonSchema>;

/** 文生图回执：成功给产物清单，失败给一句人话 + 分类（**不许静默失败、不许假装成功**） */
export const mediaImageGenerateResultSchema = z
  .object({
    ok: z.boolean(),
    artifacts: z.array(mediaImageArtifactSchema),
    /** 失败分类；**成功时为 null** */
    reason: mediaImageFailReasonSchema.nullable(),
    /** 人话（成功时是空串） */
    error: z.string(),
  })
  .strict();
export type MediaImageGenerateResultView = z.infer<typeof mediaImageGenerateResultSchema>;
