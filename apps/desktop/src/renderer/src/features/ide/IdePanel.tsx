import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { TREE_MAX_ENTRIES } from '@jujia/shared-ipc';
import { isPdfPath, isTruncatedRead, parseListing, shouldRefuseSave, TREE_QUERY_LIMIT, type Listing } from './ide-parse';
import { PdfView } from './PdfView';

/**
 * 轻量 IDE（M19a）：文件树 + 打开/编辑/保存 + PDF 入口。
 *
 * 权限映射（报备 §二，批复逐条同意）—— 这张表就是这个组件的行为契约：
 * - 展开目录 / 打开文件 → `TOOL_RUN` 的 `list_dir` / `read_file`（**读：不问**，路径守卫在工具里）
 * - **保存** → `TOOL_RUN` 的 `write_file`（**写：软 ask**，与模型调工具同一扇门、同一个弹窗）
 * - 打开 PDF → `pdf:open`（只读、过守卫、**只回渲染层**，不进模型上下文）
 * 组件里**没有任何一处**绕过工具自己写盘 —— 那是这个界面唯一不能破的规矩。
 *
 * 覆盖保护（报备 §四 1）：打开时记下盘上那份内容，保存前重读一次比对；
 * 不一致就拒绝，并给出两条出路（重新打开 / 另存为），不让用户卡在原地。
 */
export function IdePanel(): ReactElement {
  const [root, setRoot] = useState<string | null>(null);
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [content, setContent] = useState('');
  /** 打开时盘上的那份内容 —— 覆盖保护的基准（保存前与"此刻盘上"比对） */
  const [openedContent, setOpenedContent] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [pdf, setPdf] = useState<{ path: string; bytes: Uint8Array } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [saveAsPath, setSaveAsPath] = useState('');

  useEffect(() => {
    let alive = true;
    void window.jujia
      .workspaceGet()
      .then((info: { root: string | null }) => {
        if (!alive) return;
        setRoot(info.root);
        if (info.root !== null) void loadDir('.');
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // 只在挂载时问一次：工作区改了要用户切页签回来（与文档页同一口径）。
    // 本仓没有配 react-hooks 的 lint 插件，所以这里不写 disable 指令（写了会报"规则不存在"）
  }, []);

  const loadDir = useCallback(async (rel: string): Promise<void> => {
    const res = await window.jujia.toolRun('list_dir', { path: rel, maxEntries: TREE_QUERY_LIMIT });
    if (!res.ok) {
      setMsg({ kind: 'err', text: res.content });
      return;
    }
    setListings((prev) => ({ ...prev, [rel]: parseListing(res.content) }));
  }, []);

  async function toggleDir(rel: string): Promise<void> {
    if (listings[rel] !== undefined) {
      setListings((prev) => {
        const next = { ...prev };
        delete next[rel];
        return next;
      });
      return;
    }
    await loadDir(rel);
  }

  async function openFile(rel: string): Promise<void> {
    setMsg(null);
    setBusy(true);
    try {
      if (isPdfPath(rel)) {
        const r = await window.jujia.pdfOpen(rel);
        if (!r.ok) {
          setPdf(null);
          setMsg({ kind: 'err', text: r.error });
          return;
        }
        setPdf(r.bytes === null ? null : { path: rel, bytes: r.bytes });
        setOpen(rel);
        setReadOnly(true);
        setContent('');
        setOpenedContent('');
        return;
      }

      const r = await window.jujia.toolRun('read_file', { path: rel });
      if (!r.ok) {
        setMsg({ kind: 'err', text: r.content });
        return;
      }
      setPdf(null);
      setOpen(rel);
      setContent(r.content);
      setOpenedContent(r.content);
      // 被截断的内容**不许保存**：拿半份内容整文件盖回去 = 把后半段删了
      const truncated = isTruncatedRead(r.content);
      setReadOnly(truncated);
      if (truncated) {
        setMsg({ kind: 'err', text: '这份文件超过了单次读取上限，只读显示（避免用半份内容覆盖整份文件）。' });
      }
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    if (open === null || readOnly) return;
    setBusy(true);
    setMsg(null);
    try {
      // 覆盖保护：先看此刻盘上是哪一版（读不问，不需要权限）
      const fresh = await window.jujia.toolRun('read_file', { path: open });
      if (!fresh.ok) {
        setMsg({ kind: 'err', text: `保存前读不回这份文件：${fresh.content}` });
        return;
      }
      if (shouldRefuseSave(openedContent, fresh.content)) {
        setMsg({
          kind: 'err',
          text: '这份文件在你编辑期间被改过了 —— 没有覆盖它。可以「重新打开」看最新内容，或「另存为」到别的路径。',
        });
        return;
      }
      const w = await window.jujia.toolRun('write_file', { path: open, content });
      if (!w.ok) {
        setMsg({ kind: 'err', text: w.content });
        return;
      }
      setOpenedContent(content);
      setMsg({ kind: 'ok', text: w.content });
    } finally {
      setBusy(false);
    }
  }

  async function saveAs(): Promise<void> {
    const target = saveAsPath.trim();
    if (open === null || target === '') return;
    setBusy(true);
    setMsg(null);
    try {
      const w = await window.jujia.toolRun('write_file', { path: target, content });
      if (!w.ok) {
        setMsg({ kind: 'err', text: w.content });
        return;
      }
      // 另存成功之后就把这份新文件当成当前文件（继续编辑不会又写回旧路径）
      setOpen(target);
      setOpenedContent(content);
      setReadOnly(false);
      setSaveAsPath('');
      setMsg({ kind: 'ok', text: w.content });
    } finally {
      setBusy(false);
    }
  }

  const dirty = open !== null && !readOnly && content !== openedContent;

  return (
    <div className="jj-ide">
      <div className="jj-ide-tree" aria-label="文件树">
        <p className="p0-subtitle">{root === null ? '还没选择工作区（去「概览」页选）' : `工作区：${root}`}</p>
        {root !== null && <TreeNode rel="." depth={0} listings={listings} onToggle={toggleDir} onOpen={openFile} />}
      </div>

      <div className="jj-ide-main">
        {open === null && <p className="p0-subtitle">左边点一个文件：文本可编辑，PDF 直接在页面里看。</p>}
        {open !== null && pdf !== null && <PdfView path={pdf.path} bytes={pdf.bytes} />}
        {open !== null && pdf === null && (
          <>
            <div className="jj-ide-bar">
              <span className="p0-subtitle" title={open}>
                {open}
              </span>
              {dirty && <span className="w2-chip">未保存</span>}
              {readOnly && <span className="w2-chip">只读</span>}
              <button type="button" className="w2-btn" disabled={busy || readOnly} onClick={() => void save()}>
                保存
              </button>
              <button type="button" className="w2-btn" disabled={busy} onClick={() => void openFile(open)}>
                重新打开
              </button>
            </div>
            <textarea
              aria-label="文件内容"
              className="jj-ide-editor"
              spellCheck={false}
              value={content}
              readOnly={readOnly}
              onChange={(e) => setContent(e.target.value)}
            />
            <div className="jj-ide-bar">
              <input
                aria-label="另存为路径"
                placeholder="另存为…（工作区内的相对路径）"
                value={saveAsPath}
                onChange={(e) => setSaveAsPath(e.target.value)}
              />
              <button
                type="button"
                className="w2-btn"
                disabled={busy || saveAsPath.trim() === ''}
                onClick={() => void saveAs()}
              >
                另存为
              </button>
            </div>
          </>
        )}
        {msg !== null && (
          <p className={msg.kind === 'ok' ? 'jj-ok' : 'p0-err'} role={msg.kind === 'ok' ? 'status' : 'alert'}>
            {msg.text}
          </p>
        )}
        <p className="p0-subtitle">
          {`保存要过确认弹窗（与模型改文件同一扇门）；单目录最多显示 ${String(TREE_MAX_ENTRIES)} 项，超出会如实标注。`}
        </p>
      </div>
    </div>
  );
}

/** 递归的树节点：展开状态 = `listings` 里有没有这一层（没有就是收起） */
function TreeNode({
  rel,
  depth,
  listings,
  onToggle,
  onOpen,
}: {
  rel: string;
  depth: number;
  listings: Record<string, Listing>;
  onToggle: (rel: string) => Promise<void>;
  onOpen: (rel: string) => Promise<void>;
}): ReactElement {
  const listing = listings[rel];
  if (listing === undefined) {
    return (
      <button type="button" className="jj-btn jj-btn-quiet" onClick={() => void onToggle(rel)}>
        {rel === '.' ? '展开工作区' : `展开 ${rel}`}
      </button>
    );
  }
  return (
    <div style={{ marginLeft: depth === 0 ? 0 : 12 }}>
      {listing.entries.map((e) => {
        const childRel = rel === '.' ? e.name : `${rel}/${e.name}`;
        return (
          <div key={childRel}>
            <button
              type="button"
              className="jj-btn jj-btn-quiet jj-ide-entry"
              title={childRel}
              onClick={() => void (e.isDir ? onToggle(childRel) : onOpen(childRel))}
            >
              {`${e.isDir ? '📁' : '📄'} ${e.name}`}
            </button>
            {e.isDir && listings[childRel] !== undefined && (
              <TreeNode rel={childRel} depth={depth + 1} listings={listings} onToggle={onToggle} onOpen={onOpen} />
            )}
          </div>
        );
      })}
      {/* 截断标注原文显示（工具说什么就显示什么，不另写一句） */}
      {listing.note !== null && <p className="p0-warn">{listing.note}</p>}
    </div>
  );
}
