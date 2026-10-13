/**
 * 界面崩掉时给用户看的那张卡的**内容**（纯函数，能被单测问倒）。
 *
 * 为什么把文案抽成纯函数：错误边界本身是个 React class，它的行为要真渲染才有意义，
 * 而本项目的测试环境是 node（没有 jsdom / testing-library —— 加那两个是**新的依赖决定**，
 * 需要所有者拍板，不该由一次缺陷修复顺手做掉）。
 * 所以这里把"能纯测的部分"（说什么、说给谁听）拿进来测，
 * "边界真的挂在路由外面"由 `error-boundary-wiring.test.ts` 的接线锁钉住。
 */
interface FailureView {
  heading: string;
  /** 原始错误文本（截断：完整值在开发者控制台，界面上不该被一屏堆栈占满） */
  detail: string;
  hint: string;
}

/** 界面上展示的错误文本上限：再长就该去控制台看，而不是把弹窗撑破 */
export const FAILURE_DETAIL_MAX_CHARS = 400;

export function failureView(area: string, err: unknown): FailureView {
  const raw = err instanceof Error ? (err.stack ?? err.message) : String(err);
  const detail =
    raw.length > FAILURE_DETAIL_MAX_CHARS ? `${raw.slice(0, FAILURE_DETAIL_MAX_CHARS)}…（完整堆栈见开发者控制台）` : raw;
  return {
    // 必须说清是**哪一页**坏了：只写"出错了"，用户会以为整个应用废了，
    // 而实际情况通常只是那一个懒加载的 chunk 没取到
    heading: `「${area}」这一页没能显示出来`,
    detail,
    hint: '其它页签仍可使用。点「重试」只重画这一页；如果反复失败，请重启应用（多见于刚更新过之后）。',
  };
}
