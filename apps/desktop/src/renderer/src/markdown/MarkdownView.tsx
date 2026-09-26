import type { ReactElement } from 'react';
import { isSafeLink, type Block, type Inline } from './parse';

/**
 * Markdown 结构 → React 元素（M10 收尾 · 文档查看）。
 *
 * 一条硬规矩：**这里永远不出现 `dangerouslySetInnerHTML`**。
 * 产物是元素树，文本走 React 自己的转义，所以"忘记转义"这件事在结构上不存在。
 * 由 `docs-wiring.test.ts` 锁住（把这条改成 innerHTML 会当场红），不是靠人记得。
 *
 * 链接不在这里直接 `window.open`：点开外部地址与浏览器面板那一档是**同一个动作**，
 * 所以走同一条 `onOpenLink` 回调（由页签转给主进程 `browser:open-with`，照样过硬 ask）。
 * 非 http/https 的链接只展示文本，不产生任何可点元素。
 */

export interface MarkdownViewProps {
  blocks: ReadonlyArray<Block>;
  /** 已显示的块数（分块挂载是"长文档不卡"的手段，不是装饰） */
  shown: number;
  onOpenLink: (href: string) => void;
}

function renderInline(
  nodes: ReadonlyArray<Inline>,
  key: string,
  onOpenLink: (href: string) => void,
): ReactElement {
  return (
    <>
      {nodes.map((node, index) => {
        const at = `${key}-${String(index)}`;
        switch (node.k) {
          case 'text':
            return <span key={at}>{node.v}</span>;
          case 'code':
            return <code key={at}>{node.v}</code>;
          case 'strong':
            return <strong key={at}>{renderInline(node.v, at, onOpenLink)}</strong>;
          case 'em':
            return <em key={at}>{renderInline(node.v, at, onOpenLink)}</em>;
          case 'strike':
            return <s key={at}>{renderInline(node.v, at, onOpenLink)}</s>;
          case 'image':
            // 不加载远程图片：看一篇本地文档不该顺带把访问记录交给第三方
            return (
              <span key={at} className="jj-md-img" title={node.href}>
                {`图片（未加载远程内容）：${node.alt === '' ? node.href : node.alt}`}
              </span>
            );
          case 'link': {
            const label = renderInline(node.v, at, onOpenLink);
            if (!isSafeLink(node.href)) {
              return (
                <span key={at} className="jj-md-blocked-link" title={node.href}>
                  {label}
                  <span className="jj-md-note">（非 http/https，不提供跳转）</span>
                </span>
              );
            }
            return (
              <a
                key={at}
                href={node.href}
                onClick={(event) => {
                  // 拦掉默认导航：渲染层导航离开应用自身是被主窗口策略禁止的，
                  // 而且这一步的真实语义是"把地址交给外部程序"，必须走审批而不是悄悄跳
                  event.preventDefault();
                  onOpenLinkSafe(node.href, onOpenLink);
                }}
              >
                {label}
              </a>
            );
          }
          default:
            return <span key={at}>{''}</span>;
        }
      })}
    </>
  );
}

function onOpenLinkSafe(href: string, onOpenLink: (href: string) => void): void {
  if (!isSafeLink(href)) return;
  onOpenLink(href);
}

export function MarkdownView({ blocks, shown, onOpenLink }: MarkdownViewProps): ReactElement {
  const visible = blocks.slice(0, shown);

  return (
    <div className="jj-md">
      {visible.map((block, index) => {
        const at = `b-${String(index)}`;
        switch (block.k) {
          case 'heading': {
            const Tag = (`h${String(Math.min(block.level + 1, 6))}` as unknown) as 'h2';
            return <Tag key={at} className="jj-md-h">{renderInline(block.v, at, onOpenLink)}</Tag>;
          }
          case 'paragraph':
            return <p key={at}>{renderInline(block.v, at, onOpenLink)}</p>;
          case 'code':
            return (
              <pre key={at} className="jj-md-pre">
                <code>{block.text}</code>
                {block.lang !== null && <span className="jj-md-lang">{block.lang}</span>}
              </pre>
            );
          case 'list': {
            const items = block.items.map((item, i) => (
              <li key={`li-${at}-${String(i)}`}>{renderInline(item, `${at}-${String(i)}`, onOpenLink)}</li>
            ));
            return block.ordered ? <ol key={at}>{items}</ol> : <ul key={at}>{items}</ul>;
          }
          case 'quote':
            return <blockquote key={at}>{renderInline(block.v, at, onOpenLink)}</blockquote>;
          case 'divider':
            return <hr key={at} className="jj-md-hr" />;
          case 'table':
            return (
              <table key={at} className="jj-md-table">
                <thead>
                  <tr>
                    {block.header.map((cell, i) => (
                      <th key={`th-${at}-${String(i)}`}>{renderInline(cell, `${at}-h-${String(i)}`, onOpenLink)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, r) => (
                    <tr key={`tr-${at}-${String(r)}`}>
                      {row.map((cell, c) => (
                        <td key={`td-${at}-${String(r)}-${String(c)}`}>
                          {renderInline(cell, `${at}-r${String(r)}-${String(c)}`, onOpenLink)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          case 'html':
            // 原文照抄：这一条是"HTML 不解释"的可见证据（界面上能看到那行标签本身）
            return <p key={at} className="jj-md-raw">{block.text}</p>;
          case 'frontmatter':
            return (
              <p key={at} className="jj-md-note">
                {`已折叠文件头部的 ${String(block.lines)} 行元信息（front matter）`}
              </p>
            );
          default:
            return <span key={at}>{''}</span>;
        }
      })}
    </div>
  );
}
