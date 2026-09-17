#!/usr/bin/env python3
"""检查方案 B 内层 HTML 是否满足独立预览的最低契约。"""

from __future__ import annotations

import argparse
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse


class PreviewParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.html_lang = ""
        self.has_charset = False
        self.has_viewport = False
        self.has_main = False
        self.title_parts: list[str] = []
        self.in_title = False
        self.links: list[tuple[str, str, int]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.lower(): (value or "") for key, value in attrs}
        if tag == "html":
            self.html_lang = values.get("lang", "").strip()
        elif tag == "meta":
            if values.get("charset", "").lower().replace("-", "") == "utf8":
                self.has_charset = True
            if values.get("name", "").lower() == "viewport" and "width=device-width" in values.get("content", "").lower():
                self.has_viewport = True
        elif tag == "main":
            self.has_main = True
        elif tag == "title":
            self.in_title = True

        for attribute in ("src", "href"):
            value = values.get(attribute, "").strip()
            if value:
                self.links.append((attribute, value, self.getpos()[0]))

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self.in_title = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_parts.append(data)


def validate(path: Path, allow_remote: bool) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    text = path.read_text(encoding="utf-8")
    parser = PreviewParser()
    parser.feed(text)

    if not re.search(r"<!doctype\s+html\s*>", text, re.IGNORECASE):
        errors.append("缺少 <!doctype html>。")
    if not parser.html_lang:
        errors.append("<html> 缺少 lang 属性。")
    if not parser.has_charset:
        errors.append("缺少 UTF-8 charset 声明。")
    if not parser.has_viewport:
        errors.append("缺少 width=device-width 的 viewport 声明。")
    if not "".join(parser.title_parts).strip():
        errors.append("<title> 不能为空。")
    if not parser.has_main:
        errors.append("缺少 <main> 主内容区域。")
    if "@media" not in text:
        warnings.append("没有发现响应式 @media 规则，请人工确认移动端布局。")

    forbidden_patterns = {
        r"\bwindow\.parent\b": "不得访问 window.parent。",
        r"\bwindow\.top\b": "不得访问 window.top。",
        r"\bwindow\.opener\b": "不得访问 window.opener。",
        r"target\s*=\s*['\"]?_top": "不得使用 target=_top 跳出预览框。",
        r"navigator\.serviceWorker": "独立预览页不得注册 Service Worker。",
    }
    for pattern, message in forbidden_patterns.items():
        if re.search(pattern, text, re.IGNORECASE):
            errors.append(message)

    for attribute, value, line in parser.links:
        parsed = urlparse(value)
        if parsed.scheme in {"http", "https"} or value.startswith("//"):
            message = f"第 {line} 行存在远程资源：{attribute}={value}"
            if allow_remote:
                warnings.append(message)
            else:
                errors.append(message + "。默认页面必须自包含；确需联网时使用 --allow-remote。")
        elif value.startswith("/"):
            errors.append(f"第 {line} 行使用站点绝对路径：{attribute}={value}。下载后将无法稳定解析。")
        elif parsed.scheme and parsed.scheme not in {"data", "mailto", "tel"}:
            errors.append(f"第 {line} 行使用不允许的 URL scheme：{attribute}={value}")

    return errors, warnings


def main() -> int:
    argument_parser = argparse.ArgumentParser(description="验证方案 B 使用的独立 HTML 正文页。")
    argument_parser.add_argument("html_file", type=Path, help="要验证的 .preview.html 文件")
    argument_parser.add_argument("--allow-remote", action="store_true", help="允许远程资源，但仍输出离线风险警告")
    args = argument_parser.parse_args()

    path = args.html_file.resolve()
    if not path.is_file():
        print(f"错误：文件不存在：{path}", file=sys.stderr)
        return 2
    if path.suffix.lower() != ".html":
        print(f"错误：目标不是 .html 文件：{path}", file=sys.stderr)
        return 2

    try:
        errors, warnings = validate(path, args.allow_remote)
    except UnicodeDecodeError:
        print("错误：文件不是有效的 UTF-8 文本。", file=sys.stderr)
        return 2

    for warning in warnings:
        print(f"警告：{warning}")
    for error in errors:
        print(f"错误：{error}", file=sys.stderr)

    if errors:
        print(f"验证失败：{len(errors)} 个错误，{len(warnings)} 个警告。", file=sys.stderr)
        return 1
    print(f"验证通过：{path}（{len(warnings)} 个警告）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
