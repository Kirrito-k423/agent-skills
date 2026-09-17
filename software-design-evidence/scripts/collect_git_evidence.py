#!/usr/bin/env python3
"""只读收集 Git commit 元数据、路径和增删行，输出 JSON 证据底稿。"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


def run_git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or "未知 Git 错误"
        raise RuntimeError(message)
    return result.stdout


def verify_repo(repo: Path) -> Path:
    if not repo.exists():
        raise ValueError(f"仓库路径不存在：{repo}")
    root = run_git(repo, "rev-parse", "--show-toplevel").strip()
    return Path(root)


def verify_commit(repo: Path, revision: str) -> str:
    return run_git(repo, "rev-parse", "--verify", f"{revision}^{{commit}}").strip()


def range_commits(repo: Path, revision_range: str) -> list[str]:
    if ".." not in revision_range:
        raise ValueError(f"commit range 必须包含 '..'：{revision_range}")
    return [line for line in run_git(repo, "rev-list", "--reverse", revision_range).splitlines() if line]


def parse_name_status(text: str) -> list[dict[str, str]]:
    files: list[dict[str, str]] = []
    for line in text.splitlines():
        if not line:
            continue
        parts = line.split("\t")
        status = parts[0]
        if status.startswith(("R", "C")) and len(parts) >= 3:
            files.append({"status": status, "old_path": parts[1], "path": parts[2]})
        elif len(parts) >= 2:
            files.append({"status": status, "path": parts[1]})
    return files


def parse_numstat(text: str) -> dict[str, dict[str, int | None]]:
    stats: dict[str, dict[str, int | None]] = {}
    for line in text.splitlines():
        parts = line.split("\t", 2)
        if len(parts) != 3:
            continue
        additions, deletions, path = parts
        stats[path] = {
            "additions": int(additions) if additions.isdigit() else None,
            "deletions": int(deletions) if deletions.isdigit() else None,
        }
    return stats


def collect_commit(repo: Path, commit: str, paths: list[str]) -> dict[str, object]:
    separator = "\x1f"
    fmt = separator.join(
        ["%H", "%h", "%P", "%an", "%ae", "%aI", "%cn", "%ce", "%cI", "%s", "%b"]
    )
    metadata = run_git(repo, "show", "-s", f"--format={fmt}", commit).rstrip("\n").split(separator)
    if len(metadata) != 11:
        raise RuntimeError(f"无法解析 commit 元数据：{commit}")

    path_args = ["--", *paths] if paths else []
    name_status = run_git(repo, "diff-tree", "--root", "--no-commit-id", "-r", "-M", "--name-status", commit, *path_args)
    numstat = run_git(repo, "diff-tree", "--root", "--no-commit-id", "-r", "-M", "--numstat", commit, *path_args)
    files = parse_name_status(name_status)
    stats = parse_numstat(numstat)
    for item in files:
        path = item["path"]
        item.update(stats.get(path, {"additions": None, "deletions": None}))

    return {
        "hash": metadata[0],
        "short_hash": metadata[1],
        "parents": metadata[2].split() if metadata[2] else [],
        "author": {"name": metadata[3], "email": metadata[4], "date": metadata[5]},
        "committer": {"name": metadata[6], "email": metadata[7], "date": metadata[8]},
        "subject": metadata[9],
        "body": metadata[10].strip(),
        "files": files,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="只读收集 Git commit 证据，输出 JSON。")
    parser.add_argument("--repo", required=True, help="Git 仓库路径。")
    parser.add_argument("--commit", action="append", default=[], help="单个 commit/ref，可重复。")
    parser.add_argument("--range", dest="ranges", action="append", default=[], help="commit range，可重复，例如 A..B。")
    parser.add_argument("--path", action="append", default=[], help="只收集指定路径，可重复。")
    parser.add_argument("--output", help="可选 JSON 输出路径；省略时写到标准输出。")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        repo = verify_repo(Path(args.repo).expanduser().resolve())
        revisions: list[str] = []
        for revision in args.commit:
            revisions.append(verify_commit(repo, revision))
        for revision_range in args.ranges:
            revisions.extend(range_commits(repo, revision_range))
        revisions = list(dict.fromkeys(revisions))
        if not revisions:
            raise ValueError("至少提供一个 --commit 或 --range。")

        payload = {
            "schema_version": 1,
            "repository": str(repo),
            "head": run_git(repo, "rev-parse", "HEAD").strip(),
            "requested_commits": args.commit,
            "requested_ranges": args.ranges,
            "path_filters": args.path,
            "commits": [collect_commit(repo, revision, args.path) for revision in revisions],
            "evidence_boundary": "本文件只记录 Git 可验证事实，不证明需求来源、决策动机、个人主导程度或运行效果。",
        }
        rendered = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            output = Path(args.output).expanduser().resolve()
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(rendered, encoding="utf-8")
        else:
            sys.stdout.write(rendered)
        return 0
    except (RuntimeError, ValueError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
