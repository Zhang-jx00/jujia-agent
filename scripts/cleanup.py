#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""俱佳Agent · 任务收尾清理脚本（用户约定：每次执行完任务都要清理临时文件与陈旧记录）。

设计原则（安全第一）：
1. 只处理「俱佳agent」项目目录，绝不触碰系统目录与任何个人目录；
2. 默认 dry-run：只报告将清理什么，不删任何东西；
3. 真正清理（--apply）时，文件先移入项目内回收站 `.trash/`（带时间戳），绝不直接删除；
4. `.trash/` 中超过 30 天的条目在 --apply 时才真正删除；
5. 任何删除失败立即停止并报告，不做静默跳过。

用法：
    python scripts/cleanup.py             # 预览（默认）
    python scripts/cleanup.py --apply     # 实际清理（移入 .trash/）
    python scripts/cleanup.py --apply --purge-trash   # 额外真删 .trash 里超期条目
"""
# 让 `str | None` 这类注解在 Python 3.8 上也能跑（PEP 563：注解不在运行时求值）。
# 为什么需要：本项目的收尾清理是**用户固定约定**，不能只在某一个 Python 版本上可用；
# 实测 PATH 上的 python 是 3.8.3，缺这一行会在 import 阶段就 TypeError 崩掉。
from __future__ import annotations

import argparse
import os
import shutil
import sys
import time
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
TRASH = PROJECT / ".trash"
TRASH_KEEP_DAYS = 30

# ① 临时 / 中间产物（按文件名模式）
TEMP_PATTERNS = [
    "_generated-*.md",   # 生成 SOURCE-MATRIX 前的中间片段
    "*.tmp",
    "*.temp",
    "~*",
    "*.bak",
    "*.corrupt-*",       # json-store 隔离的损坏文件（保留 30 天可回溯）
    "*.swp",
    # electron-vite 每次构建留下的临时配置副本（文件名里带毫秒时间戳）。
    # 曾经有 8 份被误提交进仓库（外部审查 T12）—— 这里补上模式，跑一次就收进 .trash
    "electron.vite.config.*.mjs",
    ".DS_Store",
    "Thumbs.db",
    "desktop.ini",
]
# ② 可整目录删除的产物（含可重建的构建输出）
TEMP_DIRS = [
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    "node_modules/.cache",
    "apps/desktop/out",      # electron-vite 构建产物（npm run build 可重建）
    "coverage",
    ".vitest",
    ".tmp",                  # 测试/临时数据的统一落点（不写 C 盘，见 docs/TEST-POLICY.md）
]
# ③ 明确的旧版记录（改名/重构后遗留）
LEGACY_HINTS = [
    "research",           # 旧知识目录（已迁至 knowledge/）
    "docs/knowledge",     # 旧卡片目录（已迁至 knowledge/cards/）
]

SKIP_DIR_NAMES = {".git", ".workbuddy", "node_modules", ".trash"}


def iter_project_files():
    for root, dirs, files in os.walk(PROJECT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIR_NAMES]
        for name in files:
            yield Path(root) / name


def match_pattern(p: Path, patterns) -> str | None:
    for pat in patterns:
        if p.match(pat):
            return pat
    return None


def collect() -> tuple[list, list, list]:
    temp_files, empty_files, stale_dirs = [], [], []
    for p in iter_project_files():
        pat = match_pattern(p, TEMP_PATTERNS)
        if pat:
            temp_files.append((p, pat))
            continue
        try:
            if p.is_file() and p.stat().st_size == 0:
                empty_files.append(p)
        except OSError:
            pass
    for d in TEMP_DIRS:
        full = PROJECT / d
        if full.is_dir():
            stale_dirs.append(full)
    return temp_files, empty_files, stale_dirs


def collect_legacy() -> list:
    """已重构迁走的旧目录（仅当仍存在时才报告）。"""
    out = []
    for rel in LEGACY_HINTS:
        p = PROJECT / rel
        if p.exists() and p.is_dir():
            has_files = any(p.rglob("*"))
            if not has_files:
                out.append(p)  # 只清空目录，有内容的一律人工确认
    return out


def purge_old_trash(apply: bool) -> int:
    if not TRASH.is_dir():
        return 0
    now = time.time()
    n = 0
    for item in sorted(TRASH.iterdir()):
        try:
            age_days = (now - item.stat().st_mtime) / 86400
        except OSError:
            continue
        if age_days > TRASH_KEEP_DAYS:
            print(f"  回收站超期（{age_days:.0f} 天）：{item.relative_to(PROJECT)}")
            if apply:
                shutil.rmtree(item, ignore_errors=False) if item.is_dir() else item.unlink()
                n += 1
    return n


def move_to_trash(p: Path, stamp: str) -> Path:
    rel = p.relative_to(PROJECT)
    dest = TRASH / stamp / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(p), str(dest))
    return dest


def main() -> int:
    ap = argparse.ArgumentParser(description="俱佳Agent 任务收尾清理")
    ap.add_argument("--apply", action="store_true", help="实际执行（默认仅预览）")
    ap.add_argument("--purge-trash", action="store_true", help="同时真删 .trash 中超期条目")
    args = ap.parse_args()

    temp_files, empty_files, stale_dirs = collect()
    legacy = collect_legacy()
    plan: list[Path] = [p for p, _ in temp_files] + empty_files + stale_dirs + legacy

    print("=" * 62)
    print(f"俱佳Agent 清理预检 · 项目根：{PROJECT}")
    print("=" * 62)
    print(f"① 临时/中间产物        {len(temp_files)} 个文件")
    print(f"② 空文件（0 字节）      {len(empty_files)} 个")
    print(f"③ 缓存目录              {len(stale_dirs)} 个")
    print(f"④ 旧版遗留（仅空目录）  {len(legacy)} 个")
    print("-" * 62)
    for p, pat in temp_files:
        print(f"  [临时·{pat}] {p.relative_to(PROJECT)}")
    for p in empty_files:
        print(f"  [空文件] {p.relative_to(PROJECT)}")
    for p in stale_dirs:
        print(f"  [缓存目录] {p.relative_to(PROJECT)}")
    for p in legacy:
        print(f"  [旧版遗留·空目录] {p.relative_to(PROJECT)}")

    n_purged = 0
    if args.purge_trash and TRASH.is_dir():
        print("-" * 62)
        print(f"回收站超期检查（>{TRASH_KEEP_DAYS} 天）：")
        n_purged = purge_old_trash(args.apply)

    if not plan and not n_purged:
        print("\n没有需要清理的内容，项目已干净 ✓")
        return 0

    if not args.apply:
        print(f"\n[预览模式] 共 {len(plan)} 项待清理。确认无误后执行：")
        print("    python scripts/cleanup.py --apply")
        return 0

    stamp = time.strftime("%Y%m%d-%H%M%S")
    moved, failed = 0, []
    for p in plan:
        try:
            if p.is_dir():
                shutil.move(str(p), str(TRASH / stamp / p.relative_to(PROJECT)))
            else:
                move_to_trash(p, stamp)
            moved += 1
        except Exception as e:  # 任何失败立即停止，不静默跳过
            failed.append((p, e))
            print(f"!! 清理失败，已中止：{p} -> {e}", file=sys.stderr)
            break

    print(f"\n[完成] 已移入 .trash/{stamp}/：{moved} 项；失败中止：{len(failed)} 项")
    if failed:
        return 1
    print("提示：.trash/ 内文件保留 30 天可反悔；执行 --apply --purge-trash 可真删超期条目。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
