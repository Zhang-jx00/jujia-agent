import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

/**
 * 页签级"保持挂载"容器（T22 报备 §二，批复①同意）。
 *
 * 为什么需要它：面板是"懒加载 + 条件渲染"，切页签 = 卸载。而对话页的**流订阅就在面板自己身上**，
 * 卸载即退订 —— 切走之后那一轮的增量没有任何监听者，而那一轮**还没落盘**（落盘在轮结束时），
 * 于是切回来看到的是"回答没了"，下一条消息还会悄悄开一个新会话。
 * 保持挂载是唯一能兑现"接回现有流"的做法（其余方案都要先解决"事件不重放"）。
 *
 * 三条语义，一条都不能少（每条都有对应的组件测试与变异）：
 * 1. **首次激活前不挂载** —— 保住懒加载，首屏 chunk 与启动时间线不受影响；
 * 2. **激活过一次就一直挂着** —— 本地 state 与订阅都还在；
 * 3. **非激活时带 `hidden`** —— 看不见，但没被卸载。
 *
 * `height: 100%` 是给对话页那种"面板自己撑满、内层滚动"的布局留的：
 * 多包一层 div 会让子元素的 `height:100%` 失去参照（父级高度成了 auto），
 * 于是内层滚动条会失效、整页跟着滚 —— 这不是猜测，是这一层包装唯一的布局副作用。
 */
export function KeepAlive({ active, children }: { active: boolean; children: ReactNode }): ReactElement | null {
  const [everActive, setEverActive] = useState(active);
  // 渲染期派生 state 是 React 认可的写法（"props 变了就调一下 state"），比 effect 少一帧闪烁
  if (active && !everActive) setEverActive(true);
  if (!everActive) return null;
  return (
    <div hidden={!active} style={{ height: '100%' }}>
      {children}
    </div>
  );
}
