#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""目录重构后的交叉引用修正：把旧的 research 布局路径改到新 knowledge 布局。

教训（2026-09-18 实测）：本脚本首次运行时把自己源码里的 PAIRS 字符串也替换了，
导致第二轮起替换表退化成恒等映射、静默失效。因此必须把脚本自身排除在处理范围外。
"""
import glob
import os

ROOT = r"D:\MiMo\ProjectOne\俱佳agent"
SELF = os.path.abspath(__file__)

# (旧, 新)。注意：不要在本文件里写出旧路径的反斜杠字面量，
# 反斜杠变体由 build_pairs() 动态生成，防止脚本自我替换。
PAIRS = [
    ("research/agent-blueprint/SOURCE-MATRIX.md", "knowledge/SOURCE-MATRIX.md"),
    ("research/agent-blueprint/findings/", "knowledge/findings/"),
    ("research/agent-blueprint/sources/", "knowledge/sources/"),
    ("research/agent-blueprint/REPORT.md", "knowledge/REPORT.md"),
    ("research/agent-blueprint/brief.md", "knowledge/BRIEF.md"),
    ("research/agent-blueprint", "knowledge"),
    ("docs/knowledge/cards/", "knowledge/cards/"),
    ("docs/knowledge/", "knowledge/"),
]


def build_pairs() -> list:
    """拼出 Windows 反斜杠变体，并按长度降序，避免短串先命中吃掉长串。"""
    out = []
    for old, new in PAIRS:
        ob = old.replace("/", "\\")
        nb = new.replace("/", "\\")
        if ob != old:
            out.append((ob, nb))
    return sorted(PAIRS + out, key=lambda p: -len(p[0]))


def main() -> int:
    targets = []
    for pat in ("**/*.md", "scripts/*.py"):
        targets += glob.glob(os.path.join(ROOT, pat), recursive=True)

    pairs = build_pairs()
    changed = []
    skipped_self = 0
    for fp in targets:
        if os.path.abspath(fp) == SELF:
            skipped_self += 1
            continue
        text = open(fp, encoding="utf-8").read()
        new_text = text
        for old, new in pairs:
            new_text = new_text.replace(old, new)
        if new_text != text:
            open(fp, "w", encoding="utf-8", newline="\n").write(new_text)
            changed.append(os.path.relpath(fp, ROOT))

    for name in sorted(changed):
        print("updated:", name)
    print(f"共修正 {len(changed)} 个文件；跳过脚本自身 {skipped_self} 个；替换表 {len(pairs)} 条")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
