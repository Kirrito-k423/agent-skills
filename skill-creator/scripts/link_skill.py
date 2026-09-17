#!/usr/bin/env python3
"""通过符号链接将 Git 管理的 Skill 安装到全局 Skill 目录。"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


class ChineseArgumentParser(argparse.ArgumentParser):
    """输出中文帮助信息和常见参数错误。"""

    def format_usage(self) -> str:
        return super().format_usage().replace("usage: ", "用法：", 1)

    def format_help(self) -> str:
        return super().format_help().replace("usage: ", "用法：", 1)

    def error(self, message: str) -> None:
        replacements = (
            ("the following arguments are required:", "缺少必需参数："),
            ("unrecognized arguments:", "无法识别的参数："),
            ("expected one argument", "需要一个值"),
            ("argument ", "参数 "),
        )
        for source, target in replacements:
            message = message.replace(source, target)
        self.print_usage(sys.stderr)
        self.exit(2, f"{self.prog}: 错误：{message}\n")


def git_root(path: Path) -> Path:
    result = subprocess.run(
        ["git", "-C", str(path), "rev-parse", "--show-toplevel"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or "不在 Git 工作树内"
        raise ValueError(f"{path}: {detail}")
    return Path(result.stdout.strip()).resolve()


def default_global_dir() -> Path:
    codex_home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
    return codex_home.expanduser().resolve() / "skills"


def parse_args() -> argparse.Namespace:
    parser = ChineseArgumentParser(
        add_help=False,
        description=(
            "将 Git 管理的 Skill 目录链接到全局 Codex Skill 目录，"
            "且不替换真实文件或目录。"
        )
    )
    parser._positionals.title = "位置参数"
    parser._optionals.title = "选项"
    parser.add_argument(
        "-h",
        "--help",
        action="help",
        help="显示此帮助信息并退出",
    )
    parser.add_argument("source", type=Path, help="Skill 的规范源目录")
    parser.add_argument(
        "--name",
        help="全局链接名；默认使用源目录的 basename",
    )
    parser.add_argument(
        "--global-dir",
        type=Path,
        default=default_global_dir(),
        help="全局 Skill 目录",
    )
    parser.add_argument(
        "--replace-symlink",
        action="store_true",
        help="替换指向其他位置的现有符号链接",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = args.source.expanduser().resolve()

    if not source.is_dir():
        print(f"错误：源目录不存在：{source}", file=sys.stderr)
        return 2
    if not (source / "SKILL.md").is_file():
        print(f"错误：源目录中未找到 SKILL.md：{source}", file=sys.stderr)
        return 2

    try:
        root = git_root(source)
    except ValueError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2

    try:
        source.relative_to(root)
    except ValueError:
        print(
            f"错误：源目录 {source} 位于解析后的 Git 根目录 {root} 之外",
            file=sys.stderr,
        )
        return 2

    name = args.name or source.name
    if not name or "/" in name or name in {".", ".."}:
        print(f"错误：无效的全局 Skill 名称：{name!r}", file=sys.stderr)
        return 2

    global_dir = args.global_dir.expanduser().resolve()
    global_dir.mkdir(parents=True, exist_ok=True)
    destination = global_dir / name

    if destination.is_symlink():
        current = destination.resolve(strict=False)
        if current == source:
            print(f"成功：链接已存在：{destination} -> {source}")
            return 0
        if not args.replace_symlink:
            print(
                "错误：目标是指向其他位置的符号链接："
                f"{destination} -> {os.readlink(destination)}",
                file=sys.stderr,
            )
            print("检查后使用 --replace-symlink 重新运行。", file=sys.stderr)
            return 3
        destination.unlink()
    elif destination.exists():
        print(
            f"错误：拒绝替换真实文件或目录：{destination}",
            file=sys.stderr,
        )
        return 3

    destination.symlink_to(source, target_is_directory=True)

    if not destination.is_symlink() or destination.resolve() != source:
        print(f"错误：符号链接验证失败：{destination}", file=sys.stderr)
        return 4

    print(f"成功：已链接 {destination} -> {source}")
    print(f"成功：源目录由 Git 工作树 {root} 管理")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
