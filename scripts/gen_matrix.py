#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 sources/S*.md 的「覆盖度自评」表逐格取值，生成 SOURCE-MATRIX.md 用的
89 行领域索引表（markdown 片段）与空缺台账。

产出文件：
  knowledge/_generated-matrix.md
"""
import glob
import os
import re
from collections import OrderedDict

ROOT = r"D:\MiMo\ProjectOne\俱佳agent\knowledge\sources"
OUT = r"D:\MiMo\ProjectOne\俱佳agent\knowledge\_generated-matrix.md"

OK_SYM = {"✅", "✓"}
PARTIAL_SYM = {"⚠️", "⚠", "△"}
MISS_SYM = {"⬜", "✗", "❌", "—"}
MISS_WORDS = ("留空", "未找到", "暂无", "缺", "无合格", "未覆盖")

HEADING_RE = re.compile(r"^#{2,4}\s*.*覆盖")
TCOL_RE = re.compile(r"T[1-5]\b")
SYM_RE = re.compile(r"(✅|✓|⚠️|⚠|△|⬜|✗|❌|—)")

CLUSTERS = OrderedDict([
    ("S1-agent-core.md", ("A", "Agent 核心机制与多代理编排", 1)),
    ("S2-extensions.md", ("C", "技能 / 钩子 / 定时 / 连接 / MCP", 19)),
    ("S3-memory.md", ("D", "记忆与上下文管理", 31)),
    ("S4-architecture.md", ("E", "系统架构与 Electron 工程", 41)),
    ("S5-performance.md", ("F", "性能 / 缓存 / 预加载 / 流畅性", 53)),
    ("S6-uiux.md", ("G", "UI / UX / 视觉 / 动效 / 组件 / 卡片", 63)),
    ("S7-model.md", ("H", "模型适配与产品工程", 75)),
    ("S8-preload-appopt.md", ("I", "预加载 / 启动 / 体积 / 内存 / 功耗", 85)),
    ("S9-canvas-workflow.md", ("J", "无限画布与工作流节点编排", 86)),
    ("S10-browser-docs.md", ("K", "内置浏览器与文档查看", 95)),
    ("S11-multimodal-video.md", ("L", "多模态能力适配与视频生成", 100)),
])


def classify(cell: str):
    if any(w in cell for w in MISS_WORDS):
        return "miss", cell
    m = SYM_RE.search(cell)
    if not m:
        return None, cell
    s = m.group(1)
    if s in OK_SYM:
        return "ok", cell
    if s in PARTIAL_SYM:
        return "partial", cell
    if s in MISS_SYM:
        return "miss", cell
    return None, cell


def parse(fp: str):
    lines = open(fp, encoding="utf-8").read().splitlines()
    start = None
    for i, ln in enumerate(lines):
        if HEADING_RE.match(ln):
            start = i
    if start is None:
        return []
    hidx = None
    for i in range(start, len(lines)):
        if lines[i].strip().startswith("|") and len(TCOL_RE.findall(lines[i])) >= 3:
            hidx = i
            break
    if hidx is None:
        return []
    hcells = [c.strip() for c in lines[hidx].strip().strip("|").split("|")]
    tcols = {}
    for ci, name in enumerate(hcells):
        m = TCOL_RE.search(name)
        if m and m.group(0) not in tcols:
            tcols[m.group(0)] = ci
    first_t = min(tcols.values())

    rows = []
    for ln in lines[hidx + 1:]:
        s = ln.strip()
        if not s.startswith("|"):
            break
        if set(s) <= set("|-: "):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        label = " ".join(c for c in cells[:first_t] if c and not c.startswith("-"))
        label = label.replace("**", "").strip()
        vals, notes = [], []
        for t in ["T1", "T2", "T3", "T4", "T5"]:
            ci = tcols.get(t)
            v, raw = (classify(cells[ci]) if ci is not None and ci < len(cells) else (None, ""))
            vals.append(v)
            notes.append(raw if v in ("miss", "partial") else "")
        if not any(vals):
            continue
        rows.append((label, vals, [n for n in notes if n]))
    return rows


def main():
    out = []
    out.append("<!-- 本文件由 scripts/gen_matrix.py 自动生成，请勿手改；改覆盖表后重跑脚本 -->\n")
    out.append("| 簇 | 领域 | S 文件 · 小节 | T1 | T2 | T3 | T4 | T5 | 缺口 |")
    out.append("|----|------|--------------|----|----|----|----|----|------|")
    gaps = []
    n = 0
    ok = part = miss = 0
    for fname, (cid, cname, base) in CLUSTERS.items():
        fp = os.path.join(ROOT, fname)
        rows = parse(fp)
        for i, (label, vals, notes) in enumerate(rows, start=1):
            n += 1
            sec = int(re.match(r"(\d+)", label).group(1)) if re.match(r"(\d+)", label) else i
            marks = []
            for v in vals:
                marks.append({"ok": "✅", "partial": "⚠️", "miss": "⬜"}.get(v, "⬜"))
            ok += sum(1 for v in vals if v == "ok")
            part += sum(1 for v in vals if v == "partial")
            miss += sum(1 for v in vals if v == "miss")
            gap = ""
            miss_t = [f"T{j + 1}" for j, v in enumerate(vals) if v == "miss"]
            part_t = [f"T{j + 1}" for j, v in enumerate(vals) if v == "partial"]
            if miss_t:
                gap = "缺 " + "/".join(miss_t)
            if part_t:
                gap += ("；" if gap else "") + "弱 " + "/".join(part_t)
            clean = re.sub(r"^[0-9]+[.\s]*", "", label).strip()
            out.append(f"| {cid} | {clean} | `{fname.replace('.md','')} §{sec}` | "
                       + " | ".join(marks) + f" | {gap} |")
            if miss_t or part_t:
                gaps.append((cid, clean, fname, sec, miss_t, part_t, " / ".join(notes)))
    out.append("")
    out.append(f"**合计：{n} 个领域 · {n*5} 格 · 完全覆盖 {ok} · 部分覆盖 {part} · 空缺 {miss}**")
    out.append(f"**填充率（✅+⚠️）= {ok+part}/{n*5} = {(ok+part)/(n*5)*100:.1f}%**")
    out.append("")
    out.append("## 缺口台账\n")
    out.append("| 簇 | 领域 | 位置 | 缺口 | 原备注 |")
    out.append("|----|------|------|------|--------|")
    for cid, clean, fname, sec, mt, pt, note in gaps:
        g = ("缺 " + "/".join(mt) if mt else "") + ("；" if mt and pt else "") + ("弱 " + "/".join(pt) if pt else "")
        out.append(f"| {cid} | {clean} | `{fname.replace('.md','')} §{sec}` | {g} | {note} |")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")
    print(f"生成完毕：{OUT}")
    print(f"领域 {n} · 格 {n*5} · 完全 {ok} · 部分 {part} · 空缺 {miss} · 填充率 {(ok+part)/(n*5)*100:.1f}%")
    print(f"缺口台账条目：{len(gaps)}")


if __name__ == "__main__":
    main()
