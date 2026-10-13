#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第二轮链接复核修复（2026-09-18，代理解锁 GitHub 后的全量复检）。

所有替换 URL 均已用 curl 逐一验证返回 200：
- reactflow.dev 文档站改版：/docs/* 旧路径 → /learn、/examples、/api-reference 新路径
- Anthropic 上下文工程指南：docs.anthropic.com 旧路径 → anthropic.com/engineering 新路径
- 三个仓库未启用 Discussions（API has_discussions=false：electron、tldraw；
  openai-agents-python / SWE-agent / langgraph 的 discussions 页 404）→ 改用 issues
- ollama 文档迁移：docs/openai.md → docs/api/openai-compatibility.mdx
- KonghaYao/peri 的 blob 深链 404 → 改指仓库根
- OpenAI rate-limits/usage-tiers 301 → 归并到 /docs/guides/rate-limits
- chauvio.com 两次核验 000（失效）→ 标注并给出官方替补，覆盖表降级为 ⚠️
- rabihnahas.com 反爬（curl 406/000）→ 标注「浏览器可开」
- S10 残留一处中文括号粘连 URL → 清理
"""
import os
import sys
from pathlib import Path

# 中文 Windows 的默认控制台是 GBK：⚠/✅ 这类符号编不出来会直接崩栈（T35 同族）。
# 不换编码（强制 UTF-8 会把中文在旧控制台里弄花），只把"编不出来的字符"降级成 ?。
try:
    sys.stdout.reconfigure(errors="replace")
except Exception:
    pass

# 按脚本自身位置解析仓库根，不写死本机绝对路径（开源工程底线；见 docs/HANDOVER.md §5.6 第 7 条）
ROOT = Path(__file__).resolve().parent.parent / "knowledge" / "sources"

FIXES = {
    "S1-agent-core.md": [
        ("https://docs.anthropic.com/en/docs/build-with-claude/context-engineering",
         "https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents"),
        ("https://github.com/openai/openai-agents-python/discussions",
         "https://github.com/openai/openai-agents-python/issues"),
        ("https://github.com/princeton-nlp/SWE-agent/discussions",
         "https://github.com/princeton-nlp/SWE-agent/issues"),
        ("https://github.com/langchain-ai/langgraph/discussions",
         "https://github.com/langchain-ai/langgraph/issues"),
    ],
    "S4-architecture.md": [
        ("https://github.com/electron/electron/discussions",
         "https://github.com/electron/electron/issues"),
    ],
    "S6-uiux.md": [
        ("https://github.com/KonghaYao/peri/blob/main/TUI-TOOLCALL.md",
         "https://github.com/KonghaYao/peri（原 TUI-TOOLCALL.md 深链 404，仓库仍在）"),
    ],
    "S7-model.md": [
        ("https://github.com/ollama/ollama/blob/main/docs/openai.md",
         "https://github.com/ollama/ollama/blob/main/docs/api/openai-compatibility.mdx"),
        ("https://platform.openai.com/docs/guides/rate-limits/usage-tiers",
         "https://platform.openai.com/docs/guides/rate-limits"),
    ],
    "S8-preload-appopt.md": [
        ("https://rabihnahas.com/vs-code-the-first-second/ （该页给出官方演讲视频源，Electron 官方 Performance 文档将其列为 Recommended Reading）",
         "https://rabihnahas.com/vs-code-the-first-second/ （站点反爬：curl 返回 406/000，浏览器可正常打开；Electron 官方 Performance 文档将其列为 Recommended Reading）"),
    ],
    "S9-canvas-workflow.md": [
        ("https://reactflow.dev/docs/api/react-flow-props/",
         "https://reactflow.dev/api-reference/react-flow"),
        ("https://reactflow.dev/docs/examples/drag-and-drop/",
         "https://reactflow.dev/examples/drag-and-drop"),
        ("https://reactflow.dev/docs/examples/interaction/prevent-cycles",
         "https://reactflow.dev/examples/interaction/prevent-cycles"),
        ("https://reactflow.dev/docs/examples/interaction/",
         "https://reactflow.dev/examples"),
        ("https://reactflow.dev/docs/guides/",
         "https://reactflow.dev/learn"),
        ("https://github.com/tldraw/tldraw/discussions",
         "https://github.com/tldraw/tldraw/issues"),
    ],
    "S10-browser-docs.md": [
        ("https://www.electronjs.org/docs/latest/tutorial/security（§14/§15）",
         "https://www.electronjs.org/docs/latest/tutorial/security （§14/§15：外部链接放行与协议白名单）"),
    ],
}

CHAVVIO_OLD = "| T5 社区讨论 | Chauvio — Electron 性能瓶颈排查实用指南（DevTools + `app.getAppMetrics()` 量化基线） | https://chauvio.com/news/989a6198949.html | 中文社区实践：用 Performance 面板看长任务、Memory 面板对比堆快照、`contentTracing` 抓关键路径，给出可操作排查流程 | verified |"
CHAVVIO_NEW = "| T5 社区讨论 | （原链 Chauvio 已失效，2026-09-18 两次核验 000；替补官方排查指南）Chrome DevTools — Performance features reference | https://developer.chrome.com/docs/devtools/performance | Performance 面板看长任务、Memory 面板对比堆快照的标准流程官方参考，覆盖原文的排查方法 | verified |"

COV_OLD = "| 1 | Measure First | ✅ | ✅ | ✅ | ✅ | ✅ |"
COV_NEW = "| 1 | Measure First | ✅ | ✅ | ✅ | ✅ | ⚠️ | T5 原链 Chauvio 已失效（000×2），改用官方 DevTools 文档替补 |"


def main() -> int:
    total = 0
    all_files = dict(FIXES)
    all_files.setdefault("S5-performance.md", [])
    for fname, pairs in all_files.items():
        fp = ROOT / fname
        t = fp.read_text(encoding="utf-8")
        changed = 0
        for old, new in pairs:
            if old in t:
                t = t.replace(old, new)
                changed += 1
        if fname == "S5-performance.md":
            if CHAVVIO_OLD in t:
                t = t.replace(CHAVVIO_OLD, CHAVVIO_NEW)
                changed += 1
            if COV_OLD in t:
                t = t.replace(COV_OLD, COV_NEW)
                changed += 1
        if changed:
            fp.write_text(t, encoding="utf-8", newline="\n")
        print(f"{fname:28s} 修复 {changed} 处")
        total += changed
    print(f"\n合计修复 {total} 处")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
