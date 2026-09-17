#!/usr/bin/env python3
"""把固定 Git 比较范围拆成逐项审查数据，并生成三栏 HTML。"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
from pathlib import Path
import re
import shlex
import subprocess
import sys
from typing import Any


SCHEMA_VERSION = 1
CORRECTNESS = {"合理", "需修改", "应删除"}
MINIMALITY = {"必需", "支撑", "疑似越界", "应删除"}
SCOPE = {"最小", "可收敛", "明显过大"}
VALIDATION_LEVEL = {"未验证", "静态检查", "编译", "单元测试", "集成测试", "真实环境端到端"}
PLACEHOLDERS = {"", "待填写", "待复查", "TODO", "TBD", "无说明"}
META_PREFIXES = (
    "old mode ", "new mode ", "new file mode ", "deleted file mode ",
    "similarity index ", "dissimilarity index ", "rename from ", "rename to ",
    "copy from ", "copy to ", "Binary files ", "GIT binary patch",
)
HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$")


class ReviewError(RuntimeError):
    """表示输入、diff 或审查数据不满足生成条件。"""


def run_git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args], text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if result.returncode:
        message = result.stderr.strip() or result.stdout.strip()
        raise ReviewError(f"Git 命令失败：{message}")
    return result.stdout


def read_blob_lines(repo: Path, revision: str, file_name: str) -> list[str]:
    """读取固定提交中的文本文件；缺失或二进制文件不提供展开上下文。"""
    result = subprocess.run(
        ["git", "-C", str(repo), "show", f"{revision}:{file_name}"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if result.returncode or b"\0" in result.stdout:
        return []
    return result.stdout.decode("utf-8", errors="replace").splitlines()


def changed_path_pairs(repo: Path, base_sha: str, head_sha: str) -> dict[str, tuple[str, str]]:
    """返回以新路径为键的 base/head 路径，兼容 rename 与 copy。"""
    raw = run_git(
        repo, "-c", "core.quotePath=false", "diff", "--name-status", "-z",
        "--find-renames", f"{base_sha}...{head_sha}", "--",
    ).split("\0")
    pairs: dict[str, tuple[str, str]] = {}
    index = 0
    while index < len(raw) and raw[index]:
        status = raw[index]
        if status.startswith(("R", "C")):
            if index + 2 >= len(raw):
                break
            old_name, new_name = raw[index + 1], raw[index + 2]
            pairs[new_name] = (old_name, new_name)
            index += 3
        else:
            if index + 1 >= len(raw):
                break
            file_name = raw[index + 1]
            pairs[file_name] = (file_name, file_name)
            index += 2
    return pairs


def collect_source_context(data: dict[str, Any]) -> dict[str, dict[str, list[str]]]:
    """每个变更文件只嵌入一次 base/head 源码，供浏览器按需展开。"""
    comparison = data["comparison"]
    repo = Path(comparison["repo"])
    pairs = changed_path_pairs(repo, comparison["base_sha"], comparison["head_sha"])
    sources = {"old": {}, "new": {}}
    for file_name in data["stats"]["by_file"]:
        old_name, new_name = pairs.get(file_name, (file_name, file_name))
        sources["old"][file_name] = read_blob_lines(repo, comparison["base_sha"], old_name)
        sources["new"][file_name] = read_blob_lines(repo, comparison["head_sha"], new_name)
    return sources


def resolve_commit(repo: Path, revision: str) -> str:
    value = run_git(repo, "rev-parse", "--verify", f"{revision}^{{commit}}").strip()
    if not re.fullmatch(r"[0-9a-fA-F]{40,64}", value):
        raise ReviewError(f"无法把 {revision!r} 解析为提交 SHA")
    return value.lower()


def segment_id(file_name: str, hunk: str, changed: list[dict[str, Any]]) -> str:
    stable = json.dumps([file_name, hunk, changed], ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(stable.encode()).hexdigest()[:16]


def line_record(kind: str, number: int | None, text: str) -> dict[str, Any]:
    return {"kind": kind, "number": number, "text": text}


def make_review_fields() -> dict[str, Any]:
    return {
        "reviewed": False,
        "requirement_link": "待填写",
        "old_title": "待填写",
        "old_explanation": "待填写",
        "evidence": ["待填写"],
        "new_title": "待填写",
        "new_explanation": "待填写",
        "correctness": "待复查",
        "correctness_reason": "待填写",
        "minimality": "待复查",
        "minimality_reason": "待填写",
        "risks": [],
        "validation": [],
    }


def split_hunk(file_name: str, header: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    changed_indices = [index for index, row in enumerate(rows) if row["kind"] in {"add", "del"}]
    if not changed_indices:
        return []
    runs: list[tuple[int, int]] = []
    start = previous = changed_indices[0]
    for index in changed_indices[1:]:
        if index != previous + 1:
            runs.append((start, previous))
            start = index
        previous = index
    runs.append((start, previous))

    output = []
    for start, end in runs:
        window = rows[max(0, start - 3): min(len(rows), end + 4)]
        changed = [
            {"kind": row["kind"], "number": row["number"], "text": row["text"]}
            for row in rows[start:end + 1]
        ]
        old_lines, new_lines = [], []
        for row in window:
            if row["kind"] != "add":
                old_row = dict(row)
                old_row["number"] = row.get("old_number", row.get("number"))
                old_lines.append(old_row)
            if row["kind"] != "del":
                new_row = dict(row)
                new_row["number"] = row.get("new_number", row.get("number"))
                new_lines.append(new_row)
        item = {
            "id": segment_id(file_name, header, changed),
            "file": file_name,
            "hunk": header,
            "old_lines": old_lines,
            "new_lines": new_lines,
            "added": sum(row["kind"] == "add" for row in changed),
            "deleted": sum(row["kind"] == "del" for row in changed),
        }
        item.update(make_review_fields())
        output.append(item)
    return output


def parse_diff(patch: str) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    file_name = ""
    fallback_file = ""
    metadata: list[str] = []
    hunk_header = ""
    hunk_rows: list[dict[str, Any]] = []
    old_number = new_number = 0

    def flush_hunk() -> None:
        nonlocal hunk_rows
        if hunk_rows:
            segments.extend(split_hunk(file_name or fallback_file, hunk_header, hunk_rows))
        hunk_rows = []

    def flush_metadata() -> None:
        nonlocal metadata
        meaningful = [line for line in metadata if line.startswith(META_PREFIXES)]
        if meaningful:
            changed = [{"kind": "meta", "number": None, "text": line} for line in meaningful]
            old_lines = [line_record("del", None, line) for line in meaningful
                         if line.startswith(("old mode ", "deleted file mode ", "rename from ", "copy from "))]
            new_lines = [line_record("add", None, line) for line in meaningful
                         if line not in {item["text"] for item in old_lines}]
            if not old_lines:
                old_lines = [line_record("context", None, "此处原先没有对应的文件级变更")]
            if not new_lines:
                new_lines = [line_record("context", None, "此处修改删除了原有文件级状态")]
            item = {
                "id": segment_id(file_name or fallback_file, "文件级变更", changed),
                "file": file_name or fallback_file,
                "hunk": "文件级变更",
                "old_lines": old_lines,
                "new_lines": new_lines,
                "added": 0,
                "deleted": 0,
            }
            item.update(make_review_fields())
            segments.append(item)
        metadata = []

    for raw in patch.splitlines():
        if raw.startswith("diff --git "):
            flush_hunk()
            flush_metadata()
            try:
                parts = shlex.split(raw[len("diff --git "):])
                fallback_file = parts[1][2:] if len(parts) >= 2 and parts[1].startswith("b/") else parts[-1]
            except (ValueError, IndexError):
                fallback_file = raw
            file_name = fallback_file
            metadata = []
            hunk_header = ""
            continue
        match = HUNK_RE.match(raw)
        if match:
            flush_hunk()
            flush_metadata()
            old_number, new_number = int(match.group(1)), int(match.group(3))
            hunk_header = raw
            continue
        if hunk_header:
            if raw.startswith("\\ No newline at end of file"):
                continue
            prefix = raw[:1]
            text = raw[1:] if prefix in {" ", "+", "-"} else raw
            if prefix == " ":
                hunk_rows.append(line_record("context", old_number, text) | {"new_number": new_number})
                hunk_rows[-1]["old_number"] = old_number
                old_number += 1
                new_number += 1
            elif prefix == "-":
                hunk_rows.append(line_record("del", old_number, text))
                old_number += 1
            elif prefix == "+":
                hunk_rows.append(line_record("add", new_number, text))
                new_number += 1
            continue
        if raw.startswith("+++ "):
            candidate = raw[4:].split("\t", 1)[0]
            if candidate != "/dev/null":
                file_name = candidate[2:] if candidate.startswith("b/") else candidate
        metadata.append(raw)

    flush_hunk()
    flush_metadata()
    return segments


def collect(repo: Path, base: str, head: str, max_diff_bytes: int) -> dict[str, Any]:
    repo = repo.resolve()
    if not (repo / ".git").exists() and not run_git(repo, "rev-parse", "--git-dir").strip():
        raise ReviewError(f"不是 Git 工作树：{repo}")
    base_sha, head_sha = resolve_commit(repo, base), resolve_commit(repo, head)
    patch = run_git(repo, "-c", "core.quotePath=false", "diff", "--find-renames", "--no-ext-diff",
                    "--no-color", "--unified=3", f"{base_sha}...{head_sha}", "--")
    if len(patch.encode()) > max_diff_bytes:
        raise ReviewError(f"diff 超过 {max_diff_bytes} 字节；请先拆分 PR，不得静默截断")
    segments = parse_diff(patch)
    if not segments:
        raise ReviewError("固定比较范围没有可审查的变更")
    files: dict[str, dict[str, int]] = {}
    for item in segments:
        stat = files.setdefault(item["file"], {"added": 0, "deleted": 0, "segments": 0})
        stat["added"] += item["added"]
        stat["deleted"] += item["deleted"]
        stat["segments"] += 1
    return {
        "schema_version": SCHEMA_VERSION,
        "comparison": {"repo": str(repo), "base_sha": base_sha, "head_sha": head_sha},
        "stats": {
            "files": len(files), "added": sum(v["added"] for v in files.values()),
            "deleted": sum(v["deleted"] for v in files.values()), "segments": len(segments),
            "by_file": files,
        },
        "review": {
            "title": "待填写", "pr_url": "", "requirement": "待填写", "non_goals": [],
            "summary": "待填写", "scope_verdict": "待复查", "scope_reason": "待填写",
            "validation_level": "未验证", "recommended_actions": ["待填写"],
        },
        "segments": segments,
    }


def require_text(value: Any, location: str) -> str:
    if not isinstance(value, str) or value.strip() in PLACEHOLDERS:
        raise ReviewError(f"{location} 尚未填写")
    return value.strip()


def require_string_list(value: Any, location: str, *, nonempty: bool = False) -> list[str]:
    if not isinstance(value, list) or (nonempty and not value):
        raise ReviewError(f"{location} 必须是{'非空' if nonempty else ''}字符串数组")
    result = []
    for index, item in enumerate(value):
        result.append(require_text(item, f"{location}[{index}]"))
    return result


def merge_and_validate(fresh: dict[str, Any], supplied: dict[str, Any]) -> dict[str, Any]:
    if supplied.get("schema_version") != SCHEMA_VERSION:
        raise ReviewError("审查 JSON 版本不匹配")
    if supplied.get("comparison", {}).get("base_sha") != fresh["comparison"]["base_sha"] or \
       supplied.get("comparison", {}).get("head_sha") != fresh["comparison"]["head_sha"]:
        raise ReviewError("审查 JSON 的 base/head 已漂移")
    supplied_segments = supplied.get("segments")
    if not isinstance(supplied_segments, list):
        raise ReviewError("segments 必须是数组")
    by_id = {item.get("id"): item for item in supplied_segments}
    fresh_ids = {item["id"] for item in fresh["segments"]}
    if set(by_id) != fresh_ids or len(by_id) != len(supplied_segments):
        missing, extra = fresh_ids - set(by_id), set(by_id) - fresh_ids
        raise ReviewError(f"审查单元与当前 diff 不一致；缺少 {sorted(missing)}，多出 {sorted(extra)}")

    review = supplied.get("review", {})
    for field in ("title", "requirement", "summary", "scope_reason"):
        review[field] = require_text(review.get(field), f"review.{field}")
    if review.get("scope_verdict") not in SCOPE:
        raise ReviewError("review.scope_verdict 不是允许值")
    if review.get("validation_level") not in VALIDATION_LEVEL:
        raise ReviewError("review.validation_level 不是允许值")
    review["non_goals"] = require_string_list(review.get("non_goals", []), "review.non_goals")
    review["recommended_actions"] = require_string_list(
        review.get("recommended_actions", []), "review.recommended_actions")
    review["pr_url"] = str(review.get("pr_url", "")).strip()
    fresh["review"] = review

    for item in fresh["segments"]:
        source = by_id[item["id"]]
        if source.get("reviewed") is not True:
            raise ReviewError(f"segments[{item['id']}].reviewed 尚未确认")
        for field in ("requirement_link", "old_title", "old_explanation", "new_title",
                      "new_explanation", "correctness_reason", "minimality_reason"):
            item[field] = require_text(source.get(field), f"segments[{item['id']}].{field}")
        if source.get("correctness") not in CORRECTNESS:
            raise ReviewError(f"segments[{item['id']}].correctness 不是允许值")
        if source.get("minimality") not in MINIMALITY:
            raise ReviewError(f"segments[{item['id']}].minimality 不是允许值")
        item["correctness"], item["minimality"] = source["correctness"], source["minimality"]
        item["reviewed"] = True
        item["evidence"] = require_string_list(source.get("evidence"), f"segments[{item['id']}].evidence", nonempty=True)
        item["risks"] = require_string_list(source.get("risks", []), f"segments[{item['id']}].risks")
        item["validation"] = require_string_list(source.get("validation", []), f"segments[{item['id']}].validation")
        if item["correctness"] == "应删除" and item["minimality"] != "应删除":
            raise ReviewError(f"segments[{item['id']}] 正确性判为应删除时，最小性也必须判应删除")
    if review["scope_verdict"] == "最小" and any(
        item["minimality"] in {"疑似越界", "应删除"} for item in fresh["segments"]
    ):
        raise ReviewError("存在越界或应删除单元，总体范围不能判为最小")
    return fresh


def render_list(values: list[str], empty: str) -> str:
    if not values:
        return f'<p class="muted">{html.escape(empty)}</p>'
    return "<ul>" + "".join(f"<li>{html.escape(value)}</li>" for value in values) + "</ul>"


def render_code(
    lines: list[dict[str, Any]], side: str, file_name: str, source_lines: list[str]
) -> str:
    rows = []
    for line in lines:
        kind = line["kind"]
        marker = "−" if kind == "del" else "+" if kind == "add" else " "
        number = "" if line.get("number") is None else str(line["number"])
        rows.append(
            f'<div class="code-line {kind}"><span class="ln">{number}</span>'
            f'<span class="mark">{marker}</span><code>{html.escape(line["text"])}</code></div>'
        )
    label = "修改前" if side == "old" else "修改后"
    numbers = [line["number"] for line in lines if line.get("number") is not None]
    start = min(numbers) if numbers else 0
    end = max(numbers) if numbers else 0
    total = len(source_lines)
    before = start - 1 if start else 0
    after = max(0, total - end) if end else 0

    def gap(direction: str, remaining: int) -> str:
        if remaining <= 0:
            return ""
        direction_label = "上方" if direction == "up" else "下方"
        amount = min(20, remaining)
        return (
            f'<div class="context-gap {direction}"><button type="button" class="context-expander" '
            f'data-direction="{direction}">展开{direction_label} {amount} 行'
            f'<span>（剩余 {remaining}）</span></button></div>'
        )

    return (
        f'<section class="code-side" data-source-side="{side}" '
        f'data-file="{html.escape(file_name, quote=True)}" data-start="{start}" data-end="{end}" '
        f'data-initial-start="{start}" data-initial-end="{end}" data-total="{total}">'
        f'<h4><span>{label}</span><button type="button" class="collapse-context hidden">收起上下文</button></h4>'
        f'<div class="code-scroll">{gap("up", before)}<div class="context-lines before-lines"></div>'
        f'<div class="diff-lines">{"".join(rows)}</div><div class="context-lines after-lines"></div>'
        f'{gap("down", after)}</div></section>'
    )


def badge(value: str) -> str:
    css = {"合理": "good", "必需": "good", "支撑": "support", "需修改": "warn",
           "疑似越界": "warn", "应删除": "bad"}.get(value, "support")
    return f'<span class="badge {css}">{html.escape(value)}</span>'


def render_html(data: dict[str, Any]) -> str:
    review, stats = data["review"], data["stats"]
    source_context = data.get("source_context", {"old": {}, "new": {}})
    cards = []
    for index, item in enumerate(data["segments"], 1):
        search_parts = [str(item.get(key, "")) for key in (
            "file", "requirement_link", "old_title", "old_explanation", "new_title",
            "new_explanation", "correctness_reason", "minimality_reason")]
        search_parts.extend(
            str(value) for key in ("evidence", "risks", "validation")
            for value in item.get(key, [])
        )
        search = " ".join(search_parts)
        cards.append(f'''
<article class="change-card" id="change-{item['id']}" data-correctness="{html.escape(item['correctness'])}"
 data-minimality="{html.escape(item['minimality'])}" data-file="{html.escape(item['file'], quote=True)}"
 data-search="{html.escape(search.lower(), quote=True)}">
  <header class="change-head"><span>审查单元 {index:03d}</span><code>{html.escape(item['file'])}</code>
    <span class="delta">+{item['added']} −{item['deleted']}</span>{badge(item['correctness'])}{badge(item['minimality'])}</header>
  <div class="three-columns">
    <section class="explain old-explain"><p class="eyebrow">原实现与修改理由</p><h3>{html.escape(item['old_title'])}</h3>
      <p>{html.escape(item['old_explanation'])}</p><h4>需求关系</h4><p>{html.escape(item['requirement_link'])}</p>
      <h4>证据</h4>{render_list(item['evidence'], '没有填写证据')}</section>
    <section class="diff-column"><p class="hunk">{html.escape(item['hunk'])}</p>
      <div class="code-compare">{render_code(item['old_lines'], 'old', item['file'], source_context['old'].get(item['file'], []))}{render_code(item['new_lines'], 'new', item['file'], source_context['new'].get(item['file'], []))}</div></section>
    <section class="explain new-explain"><p class="eyebrow">新实现与复查结论</p><h3>{html.escape(item['new_title'])}</h3>
      <p>{html.escape(item['new_explanation'])}</p><h4>正确性 {badge(item['correctness'])}</h4><p>{html.escape(item['correctness_reason'])}</p>
      <h4>最小性 {badge(item['minimality'])}</h4><p>{html.escape(item['minimality_reason'])}</p>
      <h4>剩余风险</h4>{render_list(item['risks'], '未识别到额外风险')}
      <h4>验证</h4>{render_list(item['validation'], '尚无针对性验证')}</section>
  </div>
</article>''')

    ledger_rows = []
    for file_name, stat in stats["by_file"].items():
        affected = [item for item in data["segments"] if item["file"] == file_name]
        alerts = sum(item["correctness"] != "合理" or item["minimality"] in {"疑似越界", "应删除"}
                     for item in affected)
        ledger_rows.append(f"<tr><td><code>{html.escape(file_name)}</code></td><td>+{stat['added']}</td>"
                           f"<td>−{stat['deleted']}</td><td>{stat['segments']}</td><td>{alerts}</td></tr>")
    file_options = "".join(f'<option value="{html.escape(name, quote=True)}">{html.escape(name)}</option>'
                           for name in stats["by_file"])
    comparison = data["comparison"]
    pr_link = ""
    if review["pr_url"].startswith(("https://", "http://")):
        safe_url = html.escape(review["pr_url"], quote=True)
        pr_link = f'<a href="{safe_url}" target="_blank" rel="noreferrer">打开原 PR</a>'
    wide_signal = stats["files"] > 8 or stats["added"] + stats["deleted"] > 500
    signal = '<span class="scope-signal">大范围修改信号</span>' if wide_signal else ''
    source_json = json.dumps(source_context, ensure_ascii=False, separators=(",", ":"))
    # 源码是不可信输入；阻止 </script> 等文本提前结束内联脚本。
    source_json = (source_json.replace("&", "\\u0026").replace("<", "\\u003c")
                   .replace(">", "\\u003e").replace("\u2028", "\\u2028")
                   .replace("\u2029", "\\u2029"))
    document = f'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(review['title'])} · PR 三栏审查</title><style>
:root{{--bg:#f5f6f3;--card:#fff;--text:#1c2b2d;--muted:#637071;--line:#d7dfdc;--old:#fff0ee;--old-line:#f7d7d2;--new:#eaf8ee;--new-line:#ccebd5;--accent:#0d5054;--amber:#8b5b12;--red:#a23c32;--blue:#315d87}}
*{{box-sizing:border-box}}html{{scroll-behavior:smooth}}body{{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;line-height:1.6}}
.page{{width:100%;max-width:none;margin:0;padding:0 clamp(8px,1vw,20px)}}.hero{{padding:28px 0 18px;border-bottom:1px solid var(--line)}}h1{{font-size:30px;margin:0 0 8px}}h2,h3,h4{{line-height:1.3}}h3{{font-size:18px;margin:4px 0 10px}}h4{{font-size:13px;margin:18px 0 5px;color:var(--muted)}}p{{margin:7px 0;white-space:pre-wrap}}code{{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}}.subtitle,.muted{{color:var(--muted)}}
.facts{{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:10px;margin:20px 0}}.fact,.summary-card{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}}.fact b{{font-size:20px;display:block}}.summary{{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:12px;margin-bottom:18px}}.summary-card h2{{font-size:15px;margin:0 0 6px}}.summary-card.scope{{border-top:4px solid var(--amber)}}
.toolbar{{position:sticky;top:0;z-index:5;display:flex;gap:8px;align-items:center;padding:10px 0;background:rgba(245,246,243,.96);backdrop-filter:blur(8px)}}input,select,button{{font:inherit;border:1px solid var(--line);background:white;border-radius:7px;padding:8px 10px}}input{{flex:1;min-width:180px}}button.active{{background:var(--accent);color:white}}.scope-signal{{color:var(--red);font-weight:700;margin-left:8px}}
.hidden{{display:none!important}}.change-card{{background:var(--card);border:1px solid var(--line);border-radius:11px;margin:0 0 16px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.03)}}.change-head{{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--line);font-size:13px}}.change-head code{{color:var(--blue);font-weight:650}}.delta{{margin-left:auto}}.badge{{display:inline-block;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:700}}.badge.good{{background:#dff3e5;color:#24643a}}.badge.support{{background:#e8f0f7;color:#315d87}}.badge.warn{{background:#fff0cf;color:#7a5112}}.badge.bad{{background:#fae1de;color:#97382f}}
.three-columns{{display:grid;grid-template-columns:minmax(240px,20fr) minmax(760px,60fr) minmax(240px,20fr)}}.explain{{padding:16px;min-width:0}}.old-explain{{background:#fffdfa;border-right:1px solid var(--line)}}.new-explain{{background:#fbfefc;border-left:1px solid var(--line)}}.eyebrow{{font-size:11px;letter-spacing:.08em;color:var(--muted);font-weight:750}}ul{{padding-left:20px;margin:5px 0}}.diff-column{{min-width:0;background:#fbfcfc}}.hunk{{margin:0;padding:7px 12px;background:#eef2f5;color:#66717b;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;overflow:auto;white-space:pre}}.code-compare{{display:grid;grid-template-columns:1fr 1fr;min-width:0}}.code-side{{min-width:0}}.code-side+ .code-side{{border-left:1px solid var(--line)}}.code-side h4{{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:0;padding:7px 10px;background:#f4f6f7}}.code-scroll{{overflow:auto;padding:0}}.diff-lines,.context-lines{{min-width:max-content}}.code-line{{display:grid;grid-template-columns:45px 18px max-content;min-width:100%;min-height:23px;font:12px/23px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre}}.code-line .ln{{color:#8a9495;text-align:right;padding-right:9px;user-select:none}}.code-line .mark{{text-align:center;user-select:none}}.code-line code{{padding-right:12px}}.code-line.del{{background:var(--old)}}.code-line.add{{background:var(--new)}}.code-line.del .mark{{color:var(--red)}}.code-line.add .mark{{color:#277044}}.code-line.expanded-context{{background:#f8faf9;color:#4f5e5f}}.context-gap{{position:sticky;left:0;width:100%;min-width:220px;background:#eef3f1;border-block:1px solid #dbe4e0;text-align:center}}.context-expander,.collapse-context{{border:0;border-radius:0;background:transparent;color:var(--accent);padding:5px 10px;font:600 12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;cursor:pointer}}.context-expander{{width:100%}}.context-expander:hover,.collapse-context:hover{{background:#dfeae6}}.context-expander span{{color:var(--muted);font-weight:400;margin-left:4px}}.collapse-context{{padding:2px 6px;border-radius:4px}}
.ledger{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:28px 0 50px;overflow:auto}}table{{border-collapse:collapse;width:100%}}th,td{{text-align:left;padding:8px;border-bottom:1px solid var(--line);font-size:13px}}a{{color:var(--accent)}}
@media(max-width:1250px){{.three-columns{{grid-template-columns:1fr}}.old-explain,.new-explain{{border:0;border-bottom:1px solid var(--line)}}.summary{{grid-template-columns:1fr}}.facts{{grid-template-columns:repeat(2,1fr)}}}}
@media(max-width:700px){{.page{{padding:0 8px}}.facts{{grid-template-columns:1fr 1fr}}.code-compare{{grid-template-columns:1fr}}.code-side+ .code-side{{border-left:0;border-top:1px solid var(--line)}}}}
</style></head><body><main class="page">
<header class="hero"><h1>{html.escape(review['title'])}</h1><p class="subtitle">{html.escape(review['summary'])}</p>{pr_link}
<div class="facts"><div class="fact"><b>{stats['files']}</b>文件</div><div class="fact"><b>+{stats['added']} −{stats['deleted']}</b>代码行</div><div class="fact"><b>{stats['segments']}</b>审查单元</div><div class="fact"><b>{html.escape(review['validation_level'])}</b>验证等级</div></div>
<div class="summary"><section class="summary-card"><h2>用户要求</h2><p>{html.escape(review['requirement'])}</p></section>
<section class="summary-card scope"><h2>范围结论：{html.escape(review['scope_verdict'])}{signal}</h2><p>{html.escape(review['scope_reason'])}</p></section>
<section class="summary-card"><h2>建议动作</h2>{render_list(review['recommended_actions'], '无需额外动作')}</section></div>
<p class="muted"><code>base {comparison['base_sha'][:12]}</code> → <code>head {comparison['head_sha'][:12]}</code> · {html.escape(comparison['repo'])}</p></header>
<nav class="toolbar"><input id="search" type="search" placeholder="搜索文件、需求、解释或结论"><select id="file"><option value="">全部文件</option>{file_options}</select>
<button class="active" data-filter="all">全部</button><button data-filter="问题">需关注</button><button data-filter="应删除">应删除</button></nav>
<section id="changes">{''.join(cards)}</section>
<section class="ledger"><h2>覆盖账本</h2><p>所有连续增删块均已生成稳定 ID，并在构建时与当前固定 diff 重新核对。</p>
<table><thead><tr><th>文件</th><th>新增</th><th>删除</th><th>单元</th><th>异常结论</th></tr></thead><tbody>{''.join(ledger_rows)}</tbody></table></section>
</main><script>
const sourceContext={source_json};
const CONTEXT_BATCH=20;
const cards=[...document.querySelectorAll('.change-card')],search=document.querySelector('#search'),file=document.querySelector('#file');let filter='all';
function apply(){{const q=search.value.trim().toLowerCase(),f=file.value;cards.forEach(c=>{{const text=c.dataset.search,matchQ=!q||text.includes(q),matchF=!f||c.dataset.file===f;let matchStatus=true;if(filter==='问题')matchStatus=c.dataset.correctness!=='合理'||['疑似越界','应删除'].includes(c.dataset.minimality);if(filter==='应删除')matchStatus=c.dataset.correctness==='应删除'||c.dataset.minimality==='应删除';c.classList.toggle('hidden',!(matchQ&&matchF&&matchStatus));}})}}
search.addEventListener('input',apply);file.addEventListener('change',apply);document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));apply();}}));
function contextRow(number,text){{
  const row=document.createElement('div');row.className='code-line context expanded-context';
  const line=document.createElement('span');line.className='ln';line.textContent=String(number);
  const mark=document.createElement('span');mark.className='mark';mark.textContent=' ';
  const code=document.createElement('code');code.textContent=text;
  row.append(line,mark,code);return row;
}}
function updateContextControls(side){{
  const start=Number(side.dataset.start),end=Number(side.dataset.end),total=Number(side.dataset.total);
  side.querySelectorAll('.context-expander').forEach(button=>{{
    const up=button.dataset.direction==='up';
    const remaining=up?start-1:Math.max(0,total-end);
    const amount=Math.min(CONTEXT_BATCH,remaining);
    button.classList.toggle('hidden',remaining<=0);
    button.parentElement.classList.toggle('hidden',remaining<=0);
    button.textContent=remaining<=0?'':('展开'+(up?'上方 ':'下方 ')+amount+' 行（剩余 '+remaining+'）');
  }});
  side.querySelector('.collapse-context').classList.toggle('hidden',!side.querySelector('.expanded-context'));
}}
function expandContext(button){{
  const side=button.closest('.code-side'),direction=button.dataset.direction;
  const lines=((sourceContext[side.dataset.sourceSide]||{{}})[side.dataset.file]||[]);
  let start=Number(side.dataset.start),end=Number(side.dataset.end);
  const fragment=document.createDocumentFragment();
  if(direction==='up'){{
    const next=Math.max(1,start-CONTEXT_BATCH);
    for(let number=next;number<start;number++)fragment.append(contextRow(number,lines[number-1]||''));
    side.querySelector('.before-lines').prepend(fragment);start=next;
  }}else{{
    const next=Math.min(lines.length,end+CONTEXT_BATCH);
    for(let number=end+1;number<=next;number++)fragment.append(contextRow(number,lines[number-1]||''));
    side.querySelector('.after-lines').append(fragment);end=next;
  }}
  side.dataset.start=String(start);side.dataset.end=String(end);updateContextControls(side);
}}
function collapseContext(button){{
  const side=button.closest('.code-side');
  side.querySelectorAll('.expanded-context').forEach(row=>row.remove());
  side.dataset.start=side.dataset.initialStart;side.dataset.end=side.dataset.initialEnd;
  updateContextControls(side);
}}
document.addEventListener('click',event=>{{
  const expand=event.target.closest('.context-expander');if(expand){{expandContext(expand);return;}}
  const collapse=event.target.closest('.collapse-context');if(collapse)collapseContext(collapse);
}});
</script></body></html>'''
    return document


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="逐项复查 Git diff 并生成三栏对照 HTML")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("prepare", "build"):
        item = subparsers.add_parser(command, help="生成审查骨架" if command == "prepare" else "校验审查并生成 HTML")
        item.add_argument("--repo", type=Path, required=True, help="目标 Git 工作树")
        item.add_argument("--base", required=True, help="目标分支提交或固定 SHA")
        item.add_argument("--head", required=True, help="源分支提交或固定 SHA")
        item.add_argument("--max-diff-bytes", type=int, default=5 * 1024 * 1024, help="允许读取的最大 diff 字节数")
    subparsers.choices["prepare"].add_argument("--review-json", type=Path, required=True, help="审查骨架输出路径")
    subparsers.choices["build"].add_argument("--reviews", type=Path, required=True, help="已填写的审查 JSON")
    subparsers.choices["build"].add_argument("--output", type=Path, required=True, help="HTML 输出路径")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        data = collect(args.repo, args.base, args.head, args.max_diff_bytes)
        if args.command == "prepare":
            args.review_json.parent.mkdir(parents=True, exist_ok=True)
            args.review_json.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            wide = data["stats"]["files"] > 8 or data["stats"]["added"] + data["stats"]["deleted"] > 500
            print(f"已生成审查骨架：{args.review_json}")
            print(f"文件 {data['stats']['files']}，新增 {data['stats']['added']}，删除 {data['stats']['deleted']}，审查单元 {data['stats']['segments']}")
            if wide:
                print("提示：检测到大范围修改信号，请优先审查能否删除或拆分。")
        else:
            supplied = json.loads(args.reviews.read_text(encoding="utf-8"))
            data = merge_and_validate(data, supplied)
            data["source_context"] = collect_source_context(data)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(render_html(data), encoding="utf-8")
            print(f"已生成三栏审查 HTML：{args.output}")
        return 0
    except (ReviewError, OSError, json.JSONDecodeError) as error:
        print(f"错误：{error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
