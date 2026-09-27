import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { failureView } from './error-fallback';

/**
 * 渲染层错误边界（外部审查 T5 的第二半）。
 *
 * 为什么必须有：所有面板都是 `lazy()` 进来的，而 React 遇到**没有被边界接住的**渲染异常
 * 会把整棵子树卸载 —— 表现就是**整屏白掉**，用户连"切到别的页签"都做不到。
 * 一个 chunk 没取到，不该让本机所有已就绪的功能一起消失。
 *
 * 用法上的两个讲究（都写在调用侧）：
 * - 挂在 `Suspense` **外面**：懒加载 chunk 取不到时抛的错要能被这里接住（放里面接不到）；
 * - 以当前页签为 `key`：换页签即重挂，坏掉的页面自然获得一次干净的重来机会，
 *   也保证卡上的"哪一页坏了"永远说的是用户此刻看到的那一页。
 */
interface Props {
  area: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(err: Error): State {
    return { error: err };
  }

  override componentDidCatch(err: Error, info: ErrorInfo): void {
    // 界面上是给人看的截断版，控制台留全量：少了这一份，线上问题就只能靠猜
    console.error(`[ui]「${this.props.area}」渲染失败：`, err, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error !== null) {
      const view = failureView(this.props.area, error);
      return (
        <section className="w2-panel" role="alert">
          <div className="p0-card">
            <h2>{view.heading}</h2>
            <pre className="p0-err" style={{ whiteSpace: 'pre-wrap' }}>
              {view.detail}
            </pre>
            <p className="p0-subtitle">{view.hint}</p>
            <div className="w2-actions">
              <button type="button" className="w2-btn-primary" onClick={this.reset}>
                重试
              </button>
            </div>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}
