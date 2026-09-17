#!/usr/bin/env python3
"""对 Codex CLI 的模型、推理档位和服务层执行可审计测速。"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import queue
import random
import shutil
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence


DEFAULT_MODELS = ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]
DEFAULT_EFFORTS = ["low", "medium", "high", "xhigh"]
DEFAULT_TIERS = ["standard", "fast"]
DEFAULT_WORKLOADS = ["latency", "decode", "prefill-short", "prefill-long"]
MODEL_ITEM_TYPES = {"reasoning", "agent_message", "assistant_message", "message"}
VISIBLE_ITEM_TYPES = {"agent_message", "assistant_message", "message"}
TOOL_ITEM_TYPES = {
    "command_execution",
    "mcp_tool_call",
    "function_call",
    "computer_call",
    "web_search_call",
    "tool_call",
}


class ChineseArgumentParser(argparse.ArgumentParser):
    """将 argparse 的固定标题和常见错误转换为中文。"""

    def format_help(self) -> str:
        text = super().format_help()
        replacements = {
            "usage:": "用法：",
            "options:": "选项：",
            "positional arguments:": "位置参数：",
            "show this help message and exit": "显示帮助并退出",
        }
        for source, target in replacements.items():
            text = text.replace(source, target)
        return text

    def error(self, message: str) -> None:
        translations = {
            "the following arguments are required": "缺少必需参数",
            "invalid choice": "无效选项",
            "invalid int value": "无效整数",
            "invalid float value": "无效数字",
            "expected one argument": "需要一个参数值",
            "expected at least one argument": "至少需要一个参数值",
            "unrecognized arguments": "无法识别的参数",
            "argument ": "参数 ",
            "choose from": "可选值",
        }
        for source, target in translations.items():
            message = message.replace(source, target)
        self.print_usage(sys.stderr)
        self.exit(2, f"{self.prog}: 错误：{message}\n")


@dataclass(frozen=True)
class Experiment:
    model: str
    effort: str
    tier: str
    workload: str
    phase: str
    repeat: int

    @property
    def key(self) -> str:
        return "__".join(
            [self.model, self.effort, self.tier, self.workload, self.phase, str(self.repeat)]
        )


@dataclass
class Matrix:
    models: list[str]
    efforts: list[str]
    tiers: list[str]
    workloads: list[str]
    repeats: int
    warmups: int

    @property
    def configurations(self) -> int:
        return len(self.models) * len(self.efforts) * len(self.tiers) * len(self.workloads)

    @property
    def requests(self) -> int:
        return self.configurations * (self.repeats + self.warmups)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def split_csv(value: str | None) -> list[str] | None:
    if value is None:
        return None
    items = [item.strip() for item in value.split(",") if item.strip()]
    if not items:
        raise ValueError("逗号分隔参数不能为空")
    return items


def percentile(values: Sequence[float], quantile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    position = (len(ordered) - 1) * quantile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return float(ordered[lower])
    weight = position - lower
    return float(ordered[lower] * (1 - weight) + ordered[upper] * weight)


def median_number(rows: Iterable[dict[str, Any]], field: str) -> float | None:
    values = [float(row[field]) for row in rows if isinstance(row.get(field), (int, float))]
    return float(statistics.median(values)) if values else None


def resolve_matrix(args: argparse.Namespace) -> Matrix:
    presets: dict[str, Matrix] = {
        "smoke": Matrix(["gpt-5.6-terra"], ["medium"], DEFAULT_TIERS, ["latency"], 1, 0),
        "quick": Matrix(DEFAULT_MODELS, DEFAULT_EFFORTS, DEFAULT_TIERS, ["latency", "decode"], 1, 0),
        "full": Matrix(DEFAULT_MODELS, DEFAULT_EFFORTS, DEFAULT_TIERS, DEFAULT_WORKLOADS, 5, 1),
        "custom": Matrix(DEFAULT_MODELS, DEFAULT_EFFORTS, DEFAULT_TIERS, DEFAULT_WORKLOADS, 1, 0),
    }
    base = presets[args.preset]
    matrix = Matrix(
        split_csv(args.models) or list(base.models),
        split_csv(args.efforts) or list(base.efforts),
        split_csv(args.tiers) or list(base.tiers),
        split_csv(args.workloads) or list(base.workloads),
        args.repeats if args.repeats is not None else base.repeats,
        args.warmups if args.warmups is not None else base.warmups,
    )
    if matrix.repeats < 1:
        raise ValueError("正式重复次数必须至少为 1")
    if matrix.warmups < 0:
        raise ValueError("预热次数不能为负数")
    if getattr(args, "decode_repetitions", 1) < 1:
        raise ValueError("decode 输出重复次数必须至少为 1")
    if getattr(args, "prefill_short_words", 1) < 1:
        raise ValueError("短输入填充词数必须至少为 1")
    if getattr(args, "prefill_long_words", 1) < 1:
        raise ValueError("长输入填充词数必须至少为 1")
    if getattr(args, "prefill_long_words", 2) <= getattr(args, "prefill_short_words", 1):
        raise ValueError("长输入填充词数必须大于短输入填充词数")
    invalid_tiers = sorted(set(matrix.tiers) - {"standard", "fast"})
    if invalid_tiers:
        raise ValueError(f"不支持的服务层：{','.join(invalid_tiers)}")
    invalid_workloads = sorted(
        set(matrix.workloads) - {"latency", "decode", "prefill-short", "prefill-long", "custom"}
    )
    if invalid_workloads:
        raise ValueError(f"不支持的工作负载：{','.join(invalid_workloads)}")
    if "custom" in matrix.workloads and not getattr(args, "prompt_file", None):
        raise ValueError("使用 custom 工作负载时必须提供 --prompt-file")
    return matrix


def build_experiments(matrix: Matrix, seed: int) -> list[Experiment]:
    blocks: list[list[Experiment]] = []
    for model in matrix.models:
        for effort in matrix.efforts:
            for tier in matrix.tiers:
                for workload in matrix.workloads:
                    block = [
                        Experiment(model, effort, tier, workload, "warmup", index + 1)
                        for index in range(matrix.warmups)
                    ]
                    block.extend(
                        Experiment(model, effort, tier, workload, "measure", index + 1)
                        for index in range(matrix.repeats)
                    )
                    blocks.append(block)
    random.Random(seed).shuffle(blocks)
    return [experiment for block in blocks for experiment in block]


def create_prompt(experiment: Experiment, args: argparse.Namespace, sequence: int) -> str:
    nonce = f"run-{sequence:08d}"
    if experiment.workload == "latency":
        return (
            f"测速标识：{nonce}。不要调用任何工具，不要解释，不要使用 Markdown，"
            "只输出两个大写字母 OK。"
        )
    if experiment.workload == "decode":
        return (
            f"测速标识：{nonce}。不要调用任何工具，不要解释。直接输出恰好 "
            f"{args.decode_repetitions} 个由单个空格分隔的小写单词 speed，不添加标题、编号、"
            "标点、代码块或其他内容。"
        )
    if experiment.workload in {"prefill-short", "prefill-long"}:
        word_count = (
            args.prefill_short_words
            if experiment.workload == "prefill-short"
            else args.prefill_long_words
        )
        atoms = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"]
        filler = " ".join(atoms[index % len(atoms)] for index in range(word_count))
        return (
            f"测速标识：{nonce}。以下是无需分析的填充材料。材料开始：{filler}。材料结束。"
            "不要调用任何工具，不要解释，不要使用 Markdown，只输出大写单词 READY。"
        )
    if experiment.workload == "custom":
        content = Path(args.prompt_file).expanduser().read_text(encoding="utf-8")
        return f"测速标识：{nonce}\n{content}"
    raise ValueError(f"未知工作负载：{experiment.workload}")


def resolve_codex_binary(value: str | None) -> str:
    if value:
        candidate = str(Path(value).expanduser())
        if not Path(candidate).is_file():
            raise FileNotFoundError(f"找不到 Codex CLI：{candidate}")
        return candidate
    found = shutil.which("codex")
    if not found:
        raise FileNotFoundError("PATH 中找不到 codex，请通过 --codex-bin 指定")
    return found


def build_command(
    codex_bin: str,
    experiment: Experiment,
    prompt: str,
    workspace: Path,
) -> list[str]:
    command = [
        codex_bin,
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
        "--json",
        "--color",
        "never",
        "-s",
        "read-only",
        "-c",
        'approval_policy="never"',
        "-C",
        str(workspace),
        "-m",
        experiment.model,
        "-c",
        f'model_reasoning_effort="{experiment.effort}"',
    ]
    if experiment.tier == "fast":
        command.extend(["-c", 'service_tier="priority"'])
    command.append(prompt)
    return command


def _stream_reader(
    channel: str,
    stream: Any,
    started: float,
    output_queue: queue.Queue[tuple[str, float, str] | None],
) -> None:
    try:
        for line in iter(stream.readline, ""):
            output_queue.put((channel, time.monotonic() - started, line.rstrip("\n")))
    finally:
        stream.close()
        output_queue.put(None)


def execute_command(
    command: Sequence[str],
    timeout: float,
    raw_path: Path,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], float, int, bool]:
    started = time.monotonic()
    process = subprocess.Popen(
        list(command),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    assert process.stdout is not None and process.stderr is not None
    output_queue: queue.Queue[tuple[str, float, str] | None] = queue.Queue()
    threads = [
        threading.Thread(
            target=_stream_reader,
            args=("stdout", process.stdout, started, output_queue),
            daemon=True,
        ),
        threading.Thread(
            target=_stream_reader,
            args=("stderr", process.stderr, started, output_queue),
            daemon=True,
        ),
    ]
    for thread in threads:
        thread.start()

    stdout_events: list[dict[str, Any]] = []
    raw_entries: list[dict[str, Any]] = []
    completed_streams = 0
    timed_out = False
    deadline = started + timeout
    while completed_streams < 2:
        remaining = deadline - time.monotonic()
        if remaining <= 0 and process.poll() is None:
            timed_out = True
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
            remaining = 0.2
        try:
            item = output_queue.get(timeout=max(0.05, min(0.2, remaining if remaining > 0 else 0.2)))
        except queue.Empty:
            continue
        if item is None:
            completed_streams += 1
            continue
        channel, elapsed, line = item
        entry: dict[str, Any] = {"elapsed_seconds": elapsed, "channel": channel, "line": line}
        if channel == "stdout":
            try:
                parsed = json.loads(line)
                if isinstance(parsed, dict):
                    entry["event"] = parsed
                    stdout_events.append({"elapsed_seconds": elapsed, "event": parsed})
            except json.JSONDecodeError:
                pass
        raw_entries.append(entry)

    exit_code = process.wait()
    wall_seconds = time.monotonic() - started
    with raw_path.open("w", encoding="utf-8") as handle:
        for entry in raw_entries:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return stdout_events, raw_entries, wall_seconds, exit_code, timed_out


def _item_type(event: dict[str, Any]) -> str | None:
    item = event.get("item")
    return item.get("type") if isinstance(item, dict) else None


def _item_id(event: dict[str, Any]) -> str | None:
    item = event.get("item")
    return str(item.get("id")) if isinstance(item, dict) and item.get("id") is not None else None


def derive_metrics(
    events: Sequence[dict[str, Any]],
    wall_seconds: float,
    exit_code: int,
    timed_out: bool,
    raw_entries: Sequence[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    usage: dict[str, Any] = {}
    turn_completed = False
    first_json_event: float | None = None
    thread_started: float | None = None
    first_model_event: float | None = None
    first_visible_event: float | None = None
    first_visible_kind: str | None = None
    message_starts: dict[str, float] = {}
    active_decode_seconds: float | None = None
    tool_item_ids: set[str] = set()
    errors: list[str] = []

    for envelope in events:
        elapsed = float(envelope["elapsed_seconds"])
        event = envelope["event"]
        event_type = event.get("type")
        if first_json_event is None:
            first_json_event = elapsed
        if event_type == "thread.started" and thread_started is None:
            thread_started = elapsed
        item_type = _item_type(event)
        if item_type in MODEL_ITEM_TYPES and first_model_event is None:
            first_model_event = elapsed
        if item_type in VISIBLE_ITEM_TYPES and first_visible_event is None:
            first_visible_event = elapsed
            first_visible_kind = str(event_type)
        if item_type in TOOL_ITEM_TYPES and event_type in {"item.started", "item.completed"}:
            tool_item_ids.add(_item_id(event) or f"anonymous-{len(tool_item_ids)}")
        if item_type in VISIBLE_ITEM_TYPES and event_type == "item.started":
            message_starts[_item_id(event) or "__anonymous__"] = elapsed
        if item_type in VISIBLE_ITEM_TYPES and event_type == "item.completed":
            start = message_starts.get(_item_id(event) or "__anonymous__")
            if start is not None and elapsed > start:
                active_decode_seconds = elapsed - start
        if event_type in {"item.delta", "item.updated"} and item_type in VISIBLE_ITEM_TYPES:
            if first_visible_kind is None:
                first_visible_event = elapsed
                first_visible_kind = str(event_type)
        if event_type == "turn.completed":
            turn_completed = True
            candidate = event.get("usage")
            if isinstance(candidate, dict):
                usage = candidate
        if event_type == "turn.failed":
            errors.append(json.dumps(event, ensure_ascii=False))
        if item_type == "error":
            item = event.get("item")
            if isinstance(item, dict):
                errors.append(str(item.get("message", "未知错误")))

    if raw_entries:
        stderr_lines = [entry["line"] for entry in raw_entries if entry.get("channel") == "stderr"]
        if exit_code != 0 and stderr_lines:
            errors.extend(stderr_lines[-5:])

    input_tokens = int(usage.get("input_tokens") or 0)
    cached_input_tokens = int(usage.get("cached_input_tokens") or 0)
    output_tokens = int(usage.get("output_tokens") or 0)
    reasoning_output_tokens = int(usage.get("reasoning_output_tokens") or 0)
    usage_non_reasoning_output_tokens = max(0, output_tokens - reasoning_output_tokens)
    usage_non_reasoning_wall_tps = (
        usage_non_reasoning_output_tokens / wall_seconds if wall_seconds > 0 else None
    )
    usage_non_reasoning_active_tps = (
        usage_non_reasoning_output_tokens / active_decode_seconds
        if active_decode_seconds is not None and active_decode_seconds > 0
        else None
    )
    strict_ttft = (
        first_visible_event
        if first_visible_kind in {"item.delta", "item.updated"}
        else None
    )
    return {
        "success": exit_code == 0 and turn_completed and not timed_out,
        "exit_code": exit_code,
        "timed_out": timed_out,
        "wall_seconds": wall_seconds,
        "first_json_event_seconds": first_json_event,
        "thread_started_seconds": thread_started,
        "first_model_event_seconds": first_model_event,
        "first_visible_event_seconds": first_visible_event,
        "first_visible_event_kind": first_visible_kind,
        "strict_ttft_seconds": strict_ttft,
        "active_decode_seconds": active_decode_seconds,
        "input_tokens": input_tokens,
        "cached_input_tokens": cached_input_tokens,
        "uncached_input_tokens": max(0, input_tokens - cached_input_tokens),
        "output_tokens": output_tokens,
        "reasoning_output_tokens": reasoning_output_tokens,
        "usage_non_reasoning_output_tokens": usage_non_reasoning_output_tokens,
        "usage_non_reasoning_wall_tps": usage_non_reasoning_wall_tps,
        "usage_non_reasoning_active_tps": usage_non_reasoning_active_tps,
        "tool_item_count": len(tool_item_ids),
        "errors": errors,
    }


def read_models_cache() -> tuple[Path | None, dict[str, Any] | None]:
    codex_root = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))).expanduser()
    path = codex_root / "models_cache.json"
    if not path.is_file():
        return None, None
    try:
        return path, json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return path, None


def validate_matrix_against_cache(matrix: Matrix) -> list[str]:
    path, cache = read_models_cache()
    if not cache:
        return [f"无法读取模型目录：{path or '未找到 models_cache.json'}"]
    models = {entry.get("slug"): entry for entry in cache.get("models", [])}
    problems: list[str] = []
    for model_name in matrix.models:
        entry = models.get(model_name)
        if not entry:
            problems.append(f"模型目录中不存在 {model_name}")
            continue
        supported = {item.get("effort") for item in entry.get("supported_reasoning_levels", [])}
        missing_efforts = sorted(set(matrix.efforts) - supported)
        if missing_efforts:
            problems.append(f"{model_name} 不支持档位：{','.join(missing_efforts)}")
        if "fast" in matrix.tiers and "fast" not in entry.get("additional_speed_tiers", []):
            problems.append(f"{model_name} 未声明 fast 服务层")
    return problems


def matrix_text(matrix: Matrix) -> str:
    lines = [
        f"模型：{', '.join(matrix.models)}",
        f"推理档位：{', '.join(matrix.efforts)}",
        f"服务层：{', '.join(matrix.tiers)}",
        f"工作负载：{', '.join(matrix.workloads)}",
        f"正式重复：{matrix.repeats}",
        f"每组预热：{matrix.warmups}",
        f"配置组数：{matrix.configurations}",
        f"总请求数：{matrix.requests}",
    ]
    if matrix.requests >= 100:
        lines.append("用量提示：请求数较大，建议先运行 smoke 或 quick。")
    return "\n".join(lines)


def command_check(args: argparse.Namespace) -> int:
    try:
        codex_bin = resolve_codex_binary(args.codex_bin)
    except FileNotFoundError as exc:
        print(f"检查失败：{exc}", file=sys.stderr)
        return 1
    version = subprocess.run(
        [codex_bin, "--version"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    print(f"Codex CLI：{codex_bin}")
    print(f"版本：{version.stdout.strip() or version.stderr.strip()}")
    path, cache = read_models_cache()
    if not cache:
        print(f"模型目录：无法读取 {path or 'models_cache.json'}", file=sys.stderr)
        return 1
    print(f"模型目录：{path}")
    print(f"目录获取时间：{cache.get('fetched_at', '未知')}")
    models = {entry.get("slug"): entry for entry in cache.get("models", [])}
    failed = False
    for model_name in DEFAULT_MODELS:
        entry = models.get(model_name)
        if not entry:
            print(f"缺失模型：{model_name}", file=sys.stderr)
            failed = True
            continue
        efforts = ",".join(item.get("effort", "") for item in entry.get("supported_reasoning_levels", []))
        fast = "是" if "fast" in entry.get("additional_speed_tiers", []) else "否"
        print(f"{model_name}：档位={efforts}，快速模式={fast}")
    print("环境检查不会发起模型请求。")
    return 1 if failed else 0


def command_plan(args: argparse.Namespace) -> int:
    try:
        matrix = resolve_matrix(args)
    except (ValueError, OSError) as exc:
        print(f"计划失败：{exc}", file=sys.stderr)
        return 2
    print(matrix_text(matrix))
    problems = validate_matrix_against_cache(matrix)
    if problems:
        print("\n模型目录检查：")
        for problem in problems:
            print(f"- {problem}")
        return 1
    print("\n模型目录检查：通过")
    print("此命令不会发起模型请求。")
    return 0


def manifest_payload(args: argparse.Namespace, matrix: Matrix, codex_bin: str) -> dict[str, Any]:
    version = subprocess.run(
        [codex_bin, "--version"], capture_output=True, text=True, check=False
    ).stdout.strip()
    prompt_path = Path(args.prompt_file).expanduser().resolve() if args.prompt_file else None
    prompt_sha256 = (
        hashlib.sha256(prompt_path.read_bytes()).hexdigest() if prompt_path is not None else None
    )
    return {
        "schema_version": "codex-model-speed-benchmark.v1",
        "created_at": utc_now(),
        "codex_bin": codex_bin,
        "codex_version": version,
        "preset": args.preset,
        "matrix": asdict(matrix),
        "seed": args.seed,
        "timeout_seconds": args.timeout,
        "decode_repetitions": args.decode_repetitions,
        "prefill_short_words": args.prefill_short_words,
        "prefill_long_words": args.prefill_long_words,
        "prompt_file": str(prompt_path) if prompt_path else None,
        "prompt_file_sha256": prompt_sha256,
        "measurement_notes": {
            "standard_tier": "未设置 service_tier",
            "fast_tier": 'service_tier="priority"',
            "strict_ttft_requires_delta_event": True,
        },
    }


def manifest_signature(payload: dict[str, Any]) -> str:
    comparable = dict(payload)
    comparable.pop("created_at", None)
    return hashlib.sha256(
        json.dumps(comparable, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def load_existing_keys(results_path: Path) -> set[str]:
    keys: set[str] = set()
    if not results_path.is_file():
        return keys
    with results_path.open(encoding="utf-8") as handle:
        for line in handle:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("experiment_key"):
                keys.add(str(row["experiment_key"]))
    return keys


def prepare_output_dir(
    args: argparse.Namespace,
    payload: dict[str, Any],
) -> tuple[Path, set[str]]:
    if args.output_dir:
        output_dir = Path(args.output_dir).expanduser().resolve()
    else:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        output_dir = (Path.cwd() / f"codex-benchmark-{stamp}").resolve()
    manifest_path = output_dir / "manifest.json"
    results_path = output_dir / "results.jsonl"
    if output_dir.exists() and any(output_dir.iterdir()):
        if not args.resume:
            raise FileExistsError(f"输出目录非空；如需续跑请添加 --resume：{output_dir}")
        if not manifest_path.is_file():
            raise FileNotFoundError("续跑目录缺少 manifest.json")
        old_payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest_signature(old_payload) != manifest_signature(payload):
            raise ValueError("续跑参数与原 manifest.json 不一致")
    else:
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "raw").mkdir(exist_ok=True)
        manifest_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    (output_dir / "raw").mkdir(exist_ok=True)
    return output_dir, load_existing_keys(results_path)


def prompt_descriptor(prompt: str) -> str:
    digest = hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:16]
    return f"字符数={len(prompt)}，sha256={digest}"


def command_run(args: argparse.Namespace) -> int:
    try:
        matrix = resolve_matrix(args)
        codex_bin = resolve_codex_binary(args.codex_bin)
        if args.timeout <= 0:
            raise ValueError("单次请求超时必须大于 0 秒")
        if args.max_requests is not None and args.max_requests < 1:
            raise ValueError("最大请求数必须至少为 1")
    except (ValueError, OSError) as exc:
        print(f"运行准备失败：{exc}", file=sys.stderr)
        return 2
    problems = validate_matrix_against_cache(matrix)
    if problems and not args.allow_unlisted:
        print("模型目录检查失败：", file=sys.stderr)
        for problem in problems:
            print(f"- {problem}", file=sys.stderr)
        print("确认服务端支持但本地目录尚未更新时，可添加 --allow-unlisted。", file=sys.stderr)
        return 2
    experiments = build_experiments(matrix, args.seed)
    if args.max_requests is not None:
        experiments = experiments[: args.max_requests]
    print(matrix_text(matrix))
    print(f"本次实际计划请求：{len(experiments)}")

    with tempfile.TemporaryDirectory(prefix="codex-speed-benchmark-") as temporary:
        workspace = Path(temporary)
        if args.dry_run:
            for index, experiment in enumerate(experiments, 1):
                prompt = create_prompt(experiment, args, index)
                command = build_command(codex_bin, experiment, "<提示词已省略>", workspace)
                print(f"[{index}/{len(experiments)}] {experiment.key}")
                print("  " + " ".join(command[:-1]) + f" <{prompt_descriptor(prompt)}>")
            print("试运行未发起模型请求。")
            return 0
        if not args.confirm_usage:
            print("拒绝执行：真实测速会消耗 Codex 用量，请添加 --confirm-usage。", file=sys.stderr)
            return 2

        payload = manifest_payload(args, matrix, codex_bin)
        try:
            output_dir, existing_keys = prepare_output_dir(args, payload)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            print(f"输出目录准备失败：{exc}", file=sys.stderr)
            return 2
        results_path = output_dir / "results.jsonl"
        remaining = [experiment for experiment in experiments if experiment.key not in existing_keys]
        print(f"输出目录：{output_dir}")
        print(f"已完成：{len(experiments) - len(remaining)}，待执行：{len(remaining)}")
        with results_path.open("a", encoding="utf-8") as results_handle:
            for index, experiment in enumerate(remaining, 1):
                sequence = len(existing_keys) + index
                prompt = create_prompt(experiment, args, sequence)
                command = build_command(codex_bin, experiment, prompt, workspace)
                safe_key = hashlib.sha256(experiment.key.encode("utf-8")).hexdigest()[:12]
                raw_path = output_dir / "raw" / f"{sequence:05d}-{safe_key}.jsonl"
                print(
                    f"[{index}/{len(remaining)}] {experiment.model} {experiment.effort} "
                    f"{experiment.tier} {experiment.workload} {experiment.phase}#{experiment.repeat}",
                    flush=True,
                )
                started_at = utc_now()
                events, raw_entries, wall_seconds, exit_code, timed_out = execute_command(
                    command, args.timeout, raw_path
                )
                metrics = derive_metrics(
                    events, wall_seconds, exit_code, timed_out, raw_entries=raw_entries
                )
                row = {
                    "schema_version": "codex-model-speed-benchmark.sample.v1",
                    "experiment_key": experiment.key,
                    "sequence": sequence,
                    "started_at": started_at,
                    "finished_at": utc_now(),
                    **asdict(experiment),
                    "prompt_chars": len(prompt),
                    "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
                    "raw_path": str(raw_path.relative_to(output_dir)),
                    **metrics,
                }
                results_handle.write(json.dumps(row, ensure_ascii=False) + "\n")
                results_handle.flush()
                status = "成功" if metrics["success"] else "失败"
                print(
                    f"  {status}：{wall_seconds:.3f}s，输入={metrics['input_tokens']}，"
                    f"usage 非 reasoning 输出={metrics['usage_non_reasoning_output_tokens']}"
                )
        summarize_directory(output_dir)
        print(f"测速完成：{output_dir / 'report.md'}")
        return 0


def load_results(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"results.jsonl 第 {line_number} 行损坏：{exc}") from exc
            if isinstance(row, dict):
                rows.append(row)
    return rows


def aggregate_rows(rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if row.get("phase") == "measure":
            key = (str(row["model"]), str(row["effort"]), str(row["tier"]), str(row["workload"]))
            groups[key].append(row)
    summary: list[dict[str, Any]] = []
    for key in sorted(groups):
        group = groups[key]
        successful = [row for row in group if row.get("success")]
        wall = [float(row["wall_seconds"]) for row in successful if row.get("wall_seconds") is not None]
        first_model = [
            float(row["first_model_event_seconds"])
            for row in successful
            if row.get("first_model_event_seconds") is not None
        ]
        usage_tokens = [
            float(
                row.get("usage_non_reasoning_output_tokens", row.get("visible_output_tokens"))
            )
            for row in successful
            if row.get("usage_non_reasoning_output_tokens", row.get("visible_output_tokens"))
            is not None
        ]
        wall_tps = [
            float(row.get("usage_non_reasoning_wall_tps", row.get("visible_output_wall_tps")))
            for row in successful
            if row.get("usage_non_reasoning_wall_tps", row.get("visible_output_wall_tps"))
            is not None
        ]
        active_tps = [
            float(
                row.get("usage_non_reasoning_active_tps", row.get("active_decode_tps"))
            )
            for row in successful
            if row.get("usage_non_reasoning_active_tps", row.get("active_decode_tps"))
            is not None
        ]
        summary.append(
            {
                "model": key[0],
                "effort": key[1],
                "tier": key[2],
                "workload": key[3],
                "samples": len(group),
                "successes": len(successful),
                "success_rate": len(successful) / len(group) if group else 0,
                "wall_p50_seconds": percentile(wall, 0.5),
                "wall_p90_seconds": percentile(wall, 0.9),
                "first_model_event_p50_seconds": percentile(first_model, 0.5),
                "input_tokens_p50": median_number(successful, "input_tokens"),
                "cached_input_tokens_p50": median_number(successful, "cached_input_tokens"),
                "reasoning_output_tokens_p50": median_number(successful, "reasoning_output_tokens"),
                "usage_non_reasoning_output_tokens_p50": (
                    float(statistics.median(usage_tokens)) if usage_tokens else None
                ),
                "usage_non_reasoning_wall_tps_p50": percentile(wall_tps, 0.5),
                "usage_non_reasoning_active_tps_p50": percentile(active_tps, 0.5),
                "active_decode_coverage": len(active_tps) / len(successful) if successful else 0,
                "tool_item_count_p50": median_number(successful, "tool_item_count"),
            }
        )
    return summary


def calculate_speedups(summary: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    paired: dict[tuple[str, str, str], dict[str, dict[str, Any]]] = defaultdict(dict)
    for row in summary:
        paired[(row["model"], row["effort"], row["workload"])][row["tier"]] = row
    output: list[dict[str, Any]] = []
    for key in sorted(paired):
        tiers = paired[key]
        standard = tiers.get("standard")
        fast = tiers.get("fast")
        if not standard or not fast:
            continue
        standard_wall = standard.get("wall_p50_seconds")
        fast_wall = fast.get("wall_p50_seconds")
        standard_tps = standard.get("usage_non_reasoning_wall_tps_p50")
        fast_tps = fast.get("usage_non_reasoning_wall_tps_p50")
        output.append(
            {
                "model": key[0],
                "effort": key[1],
                "workload": key[2],
                "latency_speedup": (
                    standard_wall / fast_wall
                    if isinstance(standard_wall, (int, float))
                    and isinstance(fast_wall, (int, float))
                    and fast_wall > 0
                    else None
                ),
                "wall_tps_ratio": (
                    fast_tps / standard_tps
                    if isinstance(standard_tps, (int, float))
                    and isinstance(fast_tps, (int, float))
                    and standard_tps > 0
                    else None
                ),
            }
        )
    return output


def calculate_prefill_proxies(summary: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    paired: dict[tuple[str, str, str], dict[str, dict[str, Any]]] = defaultdict(dict)
    for row in summary:
        if row["workload"] in {"prefill-short", "prefill-long"}:
            paired[(row["model"], row["effort"], row["tier"])][row["workload"]] = row
    output: list[dict[str, Any]] = []
    for key in sorted(paired):
        short = paired[key].get("prefill-short")
        long = paired[key].get("prefill-long")
        if not short or not long:
            continue
        short_time = short.get("first_model_event_p50_seconds") or short.get("wall_p50_seconds")
        long_time = long.get("first_model_event_p50_seconds") or long.get("wall_p50_seconds")
        short_tokens = short.get("input_tokens_p50")
        long_tokens = long.get("input_tokens_p50")
        delta_time = (
            long_time - short_time
            if isinstance(short_time, (int, float)) and isinstance(long_time, (int, float))
            else None
        )
        delta_tokens = (
            long_tokens - short_tokens
            if isinstance(short_tokens, (int, float)) and isinstance(long_tokens, (int, float))
            else None
        )
        proxy = (
            delta_tokens / delta_time
            if isinstance(delta_tokens, (int, float))
            and isinstance(delta_time, (int, float))
            and delta_tokens > 0
            and delta_time > 0
            else None
        )
        output.append(
            {
                "model": key[0],
                "effort": key[1],
                "tier": key[2],
                "input_token_delta": delta_tokens,
                "response_time_delta_seconds": delta_time,
                "prefill_proxy_tps": proxy,
            }
        )
    return output


def csv_value(value: Any) -> Any:
    if isinstance(value, list):
        return " | ".join(str(item) for item in value)
    if isinstance(value, bool):
        return "true" if value else "false"
    return value


def write_csv(path: Path, rows: Sequence[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fields: list[str] = []
    for row in rows:
        for key in row:
            if key not in fields:
                fields.append(key)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: csv_value(row.get(key)) for key in fields})


def fmt(value: Any, digits: int = 2) -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return str(value)


def make_report(
    manifest: dict[str, Any],
    rows: Sequence[dict[str, Any]],
    summary: Sequence[dict[str, Any]],
    speedups: Sequence[dict[str, Any]],
    prefill: Sequence[dict[str, Any]],
) -> str:
    successful = sum(1 for row in rows if row.get("success") and row.get("phase") == "measure")
    measured = sum(1 for row in rows if row.get("phase") == "measure")
    lines = [
        "# Codex 模型测速报告",
        "",
        f"生成时间：{utc_now()}",
        "",
        "## 概览",
        "",
        f"- Codex 版本：`{manifest.get('codex_version', '未知')}`",
        f"- 正式样本：{measured}",
        f"- 成功样本：{successful}",
        f"- 成功率：{successful / measured:.1%}" if measured else "- 成功率：—",
        "",
        "## 配置汇总",
        "",
        "| 模型 | 档位 | 服务层 | 负载 | 成功/样本 | 总耗时 P50 | 总耗时 P90 | 首模型事件 P50 | usage 非 reasoning wall tok/s | usage 非 reasoning active tok/s |",
        "|---|---|---|---|---:|---:|---:|---:|---:|---:|",
    ]
    for row in summary:
        lines.append(
            "| {model} | {effort} | {tier} | {workload} | {successes}/{samples} | "
            "{wall50} | {wall90} | {first} | {wall_tps} | {active_tps} |".format(
                **row,
                wall50=fmt(row.get("wall_p50_seconds"), 3),
                wall90=fmt(row.get("wall_p90_seconds"), 3),
                first=fmt(row.get("first_model_event_p50_seconds"), 3),
                wall_tps=fmt(row.get("usage_non_reasoning_wall_tps_p50")),
                active_tps=fmt(row.get("usage_non_reasoning_active_tps_p50")),
            )
        )
    lines.extend(
        [
            "",
            "## 快速模式实测比值",
            "",
            "| 模型 | 档位 | 负载 | 延迟加速比 | 端到端输出吞吐比 |",
            "|---|---|---|---:|---:|",
        ]
    )
    if speedups:
        for row in speedups:
            lines.append(
                f"| {row['model']} | {row['effort']} | {row['workload']} | "
                f"{fmt(row.get('latency_speedup'))}× | {fmt(row.get('wall_tps_ratio'))}× |"
            )
    else:
        lines.append("| — | — | — | — | — |")
    lines.extend(
        [
            "",
            "## 输入处理代理值",
            "",
            "| 模型 | 档位 | 服务层 | 输入 token 差 | 响应时间差 | prefill 代理 tok/s |",
            "|---|---|---|---:|---:|---:|",
        ]
    )
    if prefill:
        for row in prefill:
            lines.append(
                f"| {row['model']} | {row['effort']} | {row['tier']} | "
                f"{fmt(row.get('input_token_delta'), 0)} | "
                f"{fmt(row.get('response_time_delta_seconds'), 3)} | "
                f"{fmt(row.get('prefill_proxy_tps'))} |"
            )
    else:
        lines.append("| — | — | — | — | — | — |")
    lines.extend(
        [
            "",
            "## 解释边界",
            "",
            "- `wall_seconds` 和 token 用量是直接观测值。",
            "- `usage_non_reasoning_output_tokens` 是 usage 的 `output_tokens - reasoning_output_tokens`；它可能包含最终消息文本以外的非 reasoning 输出，不能直接称为可见文本 token。",
            "- `usage_non_reasoning_wall_tps` 包含客户端启动、排队、输入处理和隐藏推理，不是纯解码吞吐。",
            "- 只有 JSONL 提供助手消息开始或增量事件时，`usage_non_reasoning_active_tps` 才有值；需测实际消息文本时使用 app-server 流式脚本。",
            "- `prefill_proxy_tps` 是长短输入差分代理值，不是服务端真实 prefill 吞吐。",
            "- 快速模式会增加 Codex 用量；本报告只比较速度，不代表成本或质量最优。",
            "- 原始事件保存在 `raw/`，逐样本数据保存在 `samples.csv` 和 `results.jsonl`。",
            "",
        ]
    )
    return "\n".join(lines)


def summarize_directory(output_dir: Path) -> dict[str, Any]:
    manifest_path = output_dir / "manifest.json"
    results_path = output_dir / "results.jsonl"
    if not manifest_path.is_file() or not results_path.is_file():
        raise FileNotFoundError("结果目录必须包含 manifest.json 和 results.jsonl")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    rows = load_results(results_path)
    summary = aggregate_rows(rows)
    speedups = calculate_speedups(summary)
    prefill = calculate_prefill_proxies(summary)
    payload = {
        "schema_version": "codex-model-speed-benchmark.summary.v1",
        "generated_at": utc_now(),
        "summary": summary,
        "speedups": speedups,
        "prefill_proxies": prefill,
    }
    write_csv(output_dir / "samples.csv", rows)
    write_csv(output_dir / "summary.csv", summary)
    (output_dir / "summary.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (output_dir / "report.md").write_text(
        make_report(manifest, rows, summary, speedups, prefill), encoding="utf-8"
    )
    return payload


def command_summarize(args: argparse.Namespace) -> int:
    output_dir = Path(args.result_dir).expanduser().resolve()
    try:
        payload = summarize_directory(output_dir)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"汇总失败：{exc}", file=sys.stderr)
        return 1
    print(f"汇总组数：{len(payload['summary'])}")
    print(f"报告：{output_dir / 'report.md'}")
    return 0


def add_matrix_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--preset",
        choices=["smoke", "quick", "full", "custom"],
        default="quick",
        help="测试规模预设，默认 quick",
    )
    parser.add_argument("--models", help="逗号分隔的模型名称")
    parser.add_argument("--efforts", help="逗号分隔的推理档位")
    parser.add_argument("--tiers", help="逗号分隔的服务层：standard,fast")
    parser.add_argument(
        "--workloads",
        help="逗号分隔的工作负载：latency,decode,prefill-short,prefill-long,custom",
    )
    parser.add_argument("--repeats", type=int, help="每组正式重复次数")
    parser.add_argument("--warmups", type=int, help="每组预热次数")
    parser.add_argument("--prompt-file", help="custom 工作负载使用的 UTF-8 提示文件")
    parser.add_argument("--decode-repetitions", type=int, default=256, help="decode 负载输出 speed 的次数")
    parser.add_argument("--prefill-short-words", type=int, default=1024, help="短输入填充词数")
    parser.add_argument("--prefill-long-words", type=int, default=8192, help="长输入填充词数")


def build_parser() -> ChineseArgumentParser:
    parser = ChineseArgumentParser(description="对 Codex 模型、推理档位和服务层执行可复现测速")
    subparsers = parser.add_subparsers(dest="command", required=True, title="子命令")

    check_parser = subparsers.add_parser("check", help="检查本机 Codex CLI 和模型目录")
    check_parser.add_argument("--codex-bin", help="Codex CLI 的绝对路径")
    check_parser.set_defaults(handler=command_check)

    plan_parser = subparsers.add_parser("plan", help="显示测试矩阵和请求数量，不发起请求")
    add_matrix_arguments(plan_parser)
    plan_parser.set_defaults(handler=command_plan)

    run_parser = subparsers.add_parser("run", help="执行测试并生成报告")
    add_matrix_arguments(run_parser)
    run_parser.add_argument("--codex-bin", help="Codex CLI 的绝对路径")
    run_parser.add_argument("--output-dir", help="结果输出目录，默认在当前目录生成时间戳目录")
    run_parser.add_argument("--timeout", type=float, default=300, help="单次请求超时秒数")
    run_parser.add_argument("--seed", type=int, default=20260812, help="配置组随机顺序种子")
    run_parser.add_argument("--confirm-usage", action="store_true", help="确认真实请求会消耗 Codex 用量")
    run_parser.add_argument("--dry-run", action="store_true", help="只显示命令和提示摘要，不发起请求")
    run_parser.add_argument("--resume", action="store_true", help="从已有结果目录续跑")
    run_parser.add_argument("--max-requests", type=int, help="最多执行的请求数，用于小范围验证")
    run_parser.add_argument(
        "--allow-unlisted",
        action="store_true",
        help="允许运行本地模型目录尚未声明的模型、档位或服务层",
    )
    run_parser.set_defaults(handler=command_run)

    summary_parser = subparsers.add_parser("summarize", help="重新汇总已有结果")
    summary_parser.add_argument("result_dir", help="包含 manifest.json 和 results.jsonl 的目录")
    summary_parser.set_defaults(handler=command_summarize)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
