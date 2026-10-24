import type { ReactElement, ReactNode } from 'react';

/**
 * 设置项的**一行一条**（R67）。
 *
 * 形态：**左边标题 + 一句说明，右边控件**（参考桌面工具的设置页通行做法）。
 * 为什么不是"标签在上、控件在下"的表单：表单是给"填参数"的，设置是给"调开关"的 ——
 * 一行一条能让人**一眼扫过去**，看到"哪一格在管什么"，而不是在一堆标签里找控件。
 *
 * 两条纪律：
 * 1. **说明不许省**：只有标题没有说明的那一格，用户看不出"改了会怎样" ⇒ 说明是**必填**（`hint` 可省但那时标题要自解释）；
 * 2. **控件宽度不许顶满**：控件在右侧，标题与说明占左侧 ⇒ 控件**天生**有一个上限宽度 ⇒ 不会拖成一条长空行。
 */
export interface SettingRowProps {
  /** 行标题（左边的字） */
  title: string;
  /** 一句说明（标题下方的小字） */
  hint?: string;
  /** 右侧控件 */
  children: ReactNode;
  /** 标题绑定的控件 id（点标题能聚焦控件）—— 只有控件是**原生表单元素**时才给 */
  htmlFor?: string;
  /** 整行铺开（控件放到标题下面）—— 给"样式包"这种多控件的行用 */
  wide?: boolean;
}

export function SettingRow({
  title,
  hint,
  children,
  htmlFor,
  wide = false,
}: SettingRowProps): ReactElement {
  return (
    <div className={wide ? 'jj-set-row jj-set-row-wide' : 'jj-set-row'}>
      <div className="jj-set-row-text">
        {htmlFor === undefined ? (
          <span className="jj-set-row-title">{title}</span>
        ) : (
          <label className="jj-set-row-title" htmlFor={htmlFor}>
            {title}
          </label>
        )}
        {hint === undefined ? null : <span className="jj-set-row-hint">{hint}</span>}
      </div>
      <div className="jj-set-row-control">{children}</div>
    </div>
  );
}
