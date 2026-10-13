#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
逐格解析 knowledge/sources/S*.md 的「覆盖度自评」表，
统计 T1–T5 五类来源的填充情况。

设计要点：
- 定位「覆盖…」标题之后的表格，避免误抓正文里的来源清单表。
- 单元格含「留空 / 未找到 / 暂无」等字样一律记为缺失，
  避免 ⚠️ 同时被用作「部分覆盖」与「宣告留空」两种含义时统计失真。
- 以表格逐格为准，不采信正文里的口头汇总数字。
"""
# 让 `str | None` 这类注解在 Python 3.8 上也能跑（PEP 563：注解不在运行时求值）。
# 为什么需要：约定要求"统计一律用脚本"，脚本就不能只在某一个 Python 版本上可用；
# 实测 PATH 上的 python 是 3.8.3，缺这一行会在定义函数时就 TypeError 崩掉。
from __future__ import annotations

import glob
import os
import re
import sys
from collections import Counter
from pathlib import Path

# 中文 Windows 的默认控制台是 GBK：✅/❌ 这类符号编不出来会直接崩栈（T35 同族）。
# 不换编码（强制 UTF-8 会把中文在旧控制台里弄花），只把"编不出来的字符"降级成 ?。
try:
    sys.stdout.reconfigure(errors="replace")
except Exception:
    pass

# **按脚本自身位置解析仓库根**，不写死本机绝对路径 —— 这是对外开源的工程底线
# （别人 clone 下来要能直接跑），也是 `docs/HANDOVER.md` §5.6 第 7 条对脚本的要求。
ROOT = str(Path(__file__).resolve().parent.parent / "knowledge" / "sources")

# Windows 控制台默认 GBK，打印 ✅ / ⚠️ 会 UnicodeEncodeError 直接崩掉。
# 本项目**只支持 Windows**，而"统计一律用脚本"是用户固定约定 ——
# 所以脚本必须在目标平台的默认控制台上跑得完，不能要求先设 PYTHONIOENCODING。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OK_SYM = {"✅", "✓"}
PARTIAL_SYM = {"⚠️", "⚠", "△"}
MISS_SYM = {"⬜", "✗", "❌", "—"}
MISS_WORDS = ("留空", "未找到", "暂无", "缺", "无合格", "未覆盖")

HEADING_RE = re.compile(r"^#{2,4}\s*.*覆盖")
TCOL_RE = re.compile(r"T[1-5]\b")
SYM_RE = re.compile(r"(✅|✓|⚠️|⚠|△|⬜|✗|❌|—)")


def classify(cell: str) -> str | None:
    if any(w in cell for w in MISS_WORDS):
        return "miss"
    m = SYM_RE.search(cell)
    if not m:
        return None
    s = m.group(1)
    if s in OK_SYM:
        return "ok"
    if s in PARTIAL_SYM:
        return "partial"
    if s in MISS_SYM:
        return "miss"
    return None


def parse_file(fp: str):
    lines = open(fp, encoding="utf-8").read().splitlines()

    start = None
    for i, ln in enumerate(lines):
        if HEADING_RE.match(ln):
            start = i
    if start is None:
        return None, None

    header_idx = None
    for i in range(start, len(lines)):
        ln = lines[i]
        if ln.strip().startswith("|") and len(TCOL_RE.findall(ln)) >= 3:
            header_idx = i
            break
    if header_idx is None:
        return None, None

    header_cells = [c.strip() for c in lines[header_idx].strip().strip("|").split("|")]
    tcols = {}
    for ci, name in enumerate(header_cells):
        m = TCOL_RE.search(name)
        if m and m.group(0) not in tcols:
            tcols[m.group(0)] = ci
    if len(tcols) < 3:
        return None, None

    counts = Counter()
    domains = 0
    for ln in lines[header_idx + 1:]:
        s = ln.strip()
        if not s.startswith("|"):
            break
        if set(s) <= set("|-: "):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        vals = []
        for t in sorted(tcols):
            ci = tcols[t]
            vals.append(classify(cells[ci]) if ci < len(cells) else None)
        if not any(vals):
            continue
        domains += 1
        for v in vals:
            counts[v if v else "unknown"] += 1
    return domains, counts


def main() -> int:
    files = sorted(glob.glob(os.path.join(ROOT, "S*.md")))
    tot = Counter()
    tot_domains = 0
    rows = []
    for fp in files:
        d, c = parse_file(fp)
        name = os.path.basename(fp)
        if d is None:
            print(f"{name:26s}  解析失败")
            continue
        cells = c["ok"] + c["partial"] + c["miss"] + c["unknown"]
        rows.append((name, d, c["ok"], c["partial"], c["miss"], c["unknown"], cells))
        tot.update(c)
        tot_domains += d

    print(f"{'文件':26s}{'领域':>5s}{'填满':>6s}{'部分':>6s}{'空缺':>6s}{'未识别':>7s}{'总格':>7s}")
    print("-" * 66)
    for name, d, o, p, m, u, cells in rows:
        print(f"{name:26s}{d:5d}{o:6d}{p:6d}{m:6d}{u:7d}{cells:7d}")
    total = tot["ok"] + tot["partial"] + tot["miss"] + tot["unknown"]
    print("-" * 66)
    print(f"{'合计':26s}{tot_domains:5d}{tot['ok']:6d}{tot['partial']:6d}"
          f"{tot['miss']:6d}{tot['unknown']:7d}{total:7d}")

    if total:
        print(f"\n领域总数            = {tot_domains}")
        print(f"应覆盖格数 5×领域    = {tot_domains * 5}")
        print(f"实际统计格数        = {total}")
        print(f"完全覆盖 ✅         = {tot['ok']} ({tot['ok'] / total * 100:.1f}%)")
        print(f"部分覆盖 ⚠️/△       = {tot['partial']} ({tot['partial'] / total * 100:.1f}%)")
        print(f"空缺 ⬜             = {tot['miss']} ({tot['miss'] / total * 100:.1f}%)")
        filled = tot["ok"] + tot["partial"]
        print(f"填充率(✅+⚠️)       = {filled}/{total} = {filled / total * 100:.1f}%")
    if tot["unknown"]:
        print(f"\n注意：{tot['unknown']} 格符号未识别，需人工复核")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
