#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
修复 knowledge/sources/*.md 中的链接质量问题：
1) URL 后直接粘连中文括号注释（如 `https://x.com（说明）`）-> 插入空格，使 URL 可点击
2) 修正已核实 404 的错误路径
"""
import glob
import os
import re
import sys

# 按脚本自身位置解析仓库根，不写死本机绝对路径（开源工程底线；见 docs/HANDOVER.md §5.6 第 7 条）
from pathlib import Path  # noqa: E402

ROOT = str(Path(__file__).resolve().parent.parent / "knowledge" / "sources")

# 已用 curl 实测确认的路径修正
PATH_FIXES = [
    # openai-agents-python 用下划线，不是连字符（实测连字符版 404）
    ("openai.github.io/openai-agents-python/running-agents/",
     "openai.github.io/openai-agents-python/running_agents/"),
    # agentskills.io 无 /quickstart（实测 404），正确的是 /specification
    ("https://agentskills.io/quickstart",
     "https://agentskills.io/specification"),
]

# URL 后紧跟中文（汉字或中文标点，含全角括号）：插入空格使 URL 独立可点击。
# 说明：URL 中若真需要中文，必须百分号编码；原文中的裸中文一律是注释文字粘连。
POLLUTION_RE = re.compile(
    r"(https?://[^\s|]*?)(?=[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef])"
)


def fix_text(text: str) -> tuple[str, int, int]:
    n_space = 0
    n_path = 0

    for bad, good in PATH_FIXES:
        c = text.count(bad)
        if c:
            text = text.replace(bad, good)
            n_path += c

    def repl(m):
        nonlocal n_space
        n_space += 1
        return m.group(1) + " "

    text = POLLUTION_RE.sub(repl, text)
    return text, n_space, n_path


def main() -> int:
    files = sorted(glob.glob(os.path.join(ROOT, "S*.md")))
    if not files:
        print("未找到 S*.md", file=sys.stderr)
        return 1

    tot_space = tot_path = 0
    for fp in files:
        with open(fp, "r", encoding="utf-8") as f:
            src = f.read()
        out, a, b = fix_text(src)
        if out != src:
            with open(fp, "w", encoding="utf-8", newline="\n") as f:
                f.write(out)
        tot_space += a
        tot_path += b
        print(f"{os.path.basename(fp):24s} 补空格={a:3d}  路径修正={b:3d}")

    print(f"\n合计：补空格 {tot_space} 处，路径修正 {tot_path} 处")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
