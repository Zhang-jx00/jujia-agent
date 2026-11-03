import type { ReactElement } from 'react';
import { LUCIDE_NOTICE } from '../../ui/icons';

/**
 * 第三方素材与许可卡（R70 · 排查39）。
 *
 * **为什么这张卡必须存在（不是"锦上添花"）**：
 * 界面内联的图标是**从第三方抄进仓库**的 SVG 路径数据，而 Lucide 是 **ISC** 许可 ——
 * ISC 的明文要求是「**随副本保留版权声明**」。
 * ⇒ 「声明写在源码里」**不等于**「声明随副本保留了」：
 * 一段没人引用的常量会被打包器**树摇掉** ⇒ 分发副本里一个字都没有（这正是本轮修掉的原状）。
 * ⇒ 所以这份声明必须**被界面真正用上**：它一进渲染层，就**必然**在分发副本里。
 *
 * **为什么不放在设置中心**：设置中心是"改配置"的地方，许可声明是"读一次"的信息 ⇒ 放概览页。
 *
 * **口径**：这里只写**素材出处与许可**（Lucide 是素材来源，不是产品参照物）；
 * 依赖许可的完整清单在仓库根的 `THIRD_PARTY_NOTICES.md`。
 */
export function NoticesCard(): ReactElement {
  return (
    <section className="p0-card" data-notices-card>
      <h2>第三方素材与许可</h2>
      <dl className="p0-kv">
        <dt>界面内联图标</dt>
        <dd>Lucide · ISC</dd>
      </dl>
      <p className="p0-note">
        图标的 SVG 路径数据取自 Lucide（几何未改动）；ISC 要求随副本保留版权声明，声明全文如下。
      </p>
      {/* 这一行是本卡存在的理由：它把声明真正**用上** ⇒ 声明必然留在分发副本里 */}
      <p className="p0-note" data-notices-statement>
        {LUCIDE_NOTICE}
      </p>
      <p className="p0-note">
        依赖与素材的完整清单见仓库根的 <code>THIRD_PARTY_NOTICES.md</code>（源码分发时随附）。
      </p>
    </section>
  );
}
