#!/usr/bin/env python3
"""通过 Codex app-server 文本 delta 测量可见输出流式吞吐。"""

from __future__ import annotations

import argparse
import json
import os
import queue
import subprocess
import tempfile
import threading
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


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
            "unrecognized arguments": "无法识别的参数",
            "argument ": "参数 ",
            "choose from": "可选值",
        }
        for source, target in translations.items():
            message = message.replace(source, target)
        self.print_usage(sys.stderr)
        self.exit(2, f"{self.prog}: 错误：{message}\n")


@dataclass
class Delta:
    elapsed_seconds: float
    text: str


@dataclass
class StreamMetrics:
    model: str
    effort: str
    tier: str
    requested_min_text_tokens: int
    expected_rows: int
    words_per_row: int
    success: bool
    target_reached: bool
    turn_status: str | None
    e2e_seconds: float
    ttft_seconds: float | None
    first_to_last_delta_seconds: float | None
    first_to_completed_seconds: float | None
    delta_count: int
    text_chars: int
    text_words: int
    text_tokens: int
    first_delta_tokens: int
    usage_input_tokens: int | None
    usage_cached_input_tokens: int | None
    usage_output_tokens: int | None
    usage_reasoning_output_tokens: int | None
    usage_non_reasoning_output_tokens: int | None
    e2e_text_tps: float | None
    stream_text_tps: float | None
    boundary_adjusted_stream_text_tps: float | None
    message_matches_deltas: bool
    tokenizer: str


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_output_schema(rows: int, words_per_row: int) -> tuple[dict[str, Any], str]:
    phrase = " ".join(["speed"] * words_per_row)
    schema = {
        "type": "object",
        "properties": {
            "rows": {
                "type": "array",
                "minItems": rows,
                "maxItems": rows,
                "items": {"type": "string", "enum": [phrase]},
            }
        },
        "required": ["rows"],
        "additionalProperties": False,
    }
    return schema, phrase


def expected_payload(rows: int, phrase: str) -> str:
    return json.dumps({"rows": [phrase] * rows}, separators=(",", ":"), ensure_ascii=False)


def derive_stream_rates(
    deltas: list[Delta],
    text_tokens: int,
    first_delta_tokens: int,
    turn_started: float,
    turn_completed: float,
) -> dict[str, float | None]:
    if not deltas:
        return {
            "ttft_seconds": None,
            "first_to_last_delta_seconds": None,
            "first_to_completed_seconds": None,
            "e2e_text_tps": text_tokens / (turn_completed - turn_started)
            if turn_completed > turn_started
            else None,
            "stream_text_tps": None,
            "boundary_adjusted_stream_text_tps": None,
        }
    first = deltas[0].elapsed_seconds
    last = deltas[-1].elapsed_seconds
    span = last - first
    return {
        "ttft_seconds": first - turn_started,
        "first_to_last_delta_seconds": span if span > 0 else None,
        "first_to_completed_seconds": turn_completed - first,
        "e2e_text_tps": text_tokens / (turn_completed - turn_started)
        if turn_completed > turn_started
        else None,
        "stream_text_tps": text_tokens / span if span > 0 else None,
        "boundary_adjusted_stream_text_tps": (text_tokens - first_delta_tokens) / span
        if span > 0 and text_tokens >= first_delta_tokens
        else None,
    }


def _reader(
    channel: str,
    stream: Any,
    started: float,
    output: queue.Queue[tuple[str, float, str] | None],
) -> None:
    try:
        for line in iter(stream.readline, ""):
            output.put((channel, time.monotonic() - started, line.rstrip("\n")))
    finally:
        stream.close()
        output.put(None)


class AppServerClient:
    def __init__(
        self,
        command: list[str],
        environment: dict[str, str],
        timeout: float,
        raw_path: Path | None = None,
    ):
        self.started = time.monotonic()
        self.timeout = timeout
        self.process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env=environment,
        )
        assert self.process.stdin is not None
        assert self.process.stdout is not None
        assert self.process.stderr is not None
        self.input = self.process.stdin
        self.events: queue.Queue[tuple[str, float, str] | None] = queue.Queue()
        self.raw: list[dict[str, Any]] = []
        self.raw_handle = None
        if raw_path is not None:
            raw_path.parent.mkdir(parents=True, exist_ok=True)
            self.raw_handle = raw_path.open("w", encoding="utf-8")
        self.pending: list[tuple[float, dict[str, Any]]] = []
        self.closed_streams = 0
        for channel, stream in (("stdout", self.process.stdout), ("stderr", self.process.stderr)):
            threading.Thread(
                target=_reader,
                args=(channel, stream, self.started, self.events),
                daemon=True,
            ).start()

    def send(self, message: dict[str, Any]) -> float:
        sent = time.monotonic() - self.started
        self.input.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
        self.input.flush()
        return sent

    def _next(self, deadline: float) -> tuple[float, dict[str, Any]]:
        if self.pending:
            return self.pending.pop(0)
        while time.monotonic() < deadline:
            try:
                entry = self.events.get(timeout=0.2)
            except queue.Empty:
                if self.process.poll() is not None:
                    raise RuntimeError(f"app-server 已退出，退出码 {self.process.returncode}")
                continue
            if entry is None:
                self.closed_streams += 1
                if self.closed_streams >= 2:
                    raise RuntimeError("app-server 输出流已关闭")
                continue
            channel, elapsed, line = entry
            raw_entry: dict[str, Any] = {
                "elapsed_seconds": elapsed,
                "channel": channel,
                "line": line,
            }
            self.raw.append(raw_entry)
            if channel != "stdout":
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(message, dict):
                raw_entry["message"] = message
                if self.raw_handle is not None:
                    self.raw_handle.write(json.dumps(raw_entry, ensure_ascii=False) + "\n")
                    self.raw_handle.flush()
                return elapsed, message
            if self.raw_handle is not None:
                self.raw_handle.write(json.dumps(raw_entry, ensure_ascii=False) + "\n")
                self.raw_handle.flush()
        raise TimeoutError(f"等待 app-server 事件超过 {self.timeout:.0f} 秒")

    def wait_for(self, predicate: Callable[[dict[str, Any]], bool]) -> tuple[float, dict[str, Any]]:
        deadline = time.monotonic() + self.timeout
        skipped: list[tuple[float, dict[str, Any]]] = []
        while True:
            elapsed, message = self._next(deadline)
            if predicate(message):
                self.pending = skipped + self.pending
                return elapsed, message
            skipped.append((elapsed, message))

    def stop(self) -> None:
        try:
            self.input.close()
        except OSError:
            pass
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        if self.raw_handle is not None:
            self.raw_handle.close()
            self.raw_handle = None


def require_tokenizer() -> tuple[Callable[[str], list[int]], str]:
    try:
        import tiktoken  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError(
            "缺少 tiktoken。请安装到隔离目录并通过 PYTHONPATH 提供，例如："
            "python3 -m pip install --target /tmp/codex-benchmark-deps tiktoken"
        ) from exc
    encoding = tiktoken.get_encoding("o200k_base")
    return encoding.encode, "tiktoken:o200k_base"


def usage_breakdown(message: dict[str, Any]) -> dict[str, int] | None:
    params = message.get("params")
    if not isinstance(params, dict):
        return None
    token_usage = params.get("tokenUsage")
    if not isinstance(token_usage, dict):
        return None
    last = token_usage.get("last")
    return last if isinstance(last, dict) else None


def run(args: argparse.Namespace) -> tuple[StreamMetrics, list[dict[str, Any]], str]:
    encode, tokenizer_name = require_tokenizer()
    schema, phrase = build_output_schema(args.rows, args.words_per_row)
    expected = expected_payload(args.rows, phrase)
    expected_tokens = len(encode(expected))
    if expected_tokens < args.min_text_tokens:
        raise ValueError(
            f"当前 schema 的规范 JSON 仅约 {expected_tokens} tokens，低于目标 {args.min_text_tokens}；"
            "请增加 --rows"
        )

    command = [args.codex_bin, "app-server", "--stdio"]
    environment = os.environ.copy()
    output_dir = Path(args.output_dir).expanduser()
    output_dir.mkdir(parents=True, exist_ok=True)
    client = AppServerClient(command, environment, args.timeout, output_dir / "events.jsonl")
    deltas: list[Delta] = []
    completed_text = ""
    last_usage: dict[str, int] | None = None
    turn_status: str | None = None
    turn_started = 0.0
    turn_completed = 0.0
    try:
        client.send(
            {
                "id": 1,
                "method": "initialize",
                "params": {
                    "clientInfo": {
                        "name": "codex-model-speed-benchmark",
                        "title": "Codex Model Speed Benchmark",
                        "version": "0.2.0",
                    },
                    "capabilities": {"experimentalApi": True},
                },
            }
        )
        _, initialized = client.wait_for(lambda message: message.get("id") == 1)
        if "error" in initialized:
            raise RuntimeError(f"initialize 失败：{initialized['error']}")
        client.send({"method": "initialized", "params": {}})

        thread_params: dict[str, Any] = {
            "cwd": args.workspace,
            "runtimeWorkspaceRoots": [args.workspace],
            "model": args.model,
            "approvalPolicy": "never",
            "sandbox": "read-only",
            "ephemeral": True,
            "baseInstructions": (
                "You are a deterministic text-generation benchmark. Never call tools. "
                "Return only the JSON required by the supplied output schema and fill every required item."
            ),
            "developerInstructions": (
                "Complete the full structured output even when it is long. Do not summarize, abbreviate, "
                "omit, or replace repeated entries with ellipses."
            ),
            "config": {
                "model_reasoning_effort": args.effort,
                "model_verbosity": "high",
            },
        }
        if args.tier == "fast":
            thread_params["serviceTier"] = "priority"
        client.send({"id": 2, "method": "thread/start", "params": thread_params})
        _, thread_response = client.wait_for(lambda message: message.get("id") == 2)
        if "error" in thread_response:
            raise RuntimeError(f"thread/start 失败：{thread_response['error']}")
        thread_id = thread_response["result"]["thread"]["id"]

        prompt = (
            f"Generate the complete structured output. The rows array must contain exactly {args.rows} "
            f"items. Every item must contain exactly {args.words_per_row} space-separated copies of "
            "the lowercase word speed. Do not stop early."
        )
        turn_started = client.send(
            {
                "id": 3,
                "method": "turn/start",
                "params": {
                    "threadId": thread_id,
                    "input": [{"type": "text", "text": prompt}],
                    "model": args.model,
                    "effort": args.effort,
                    "serviceTier": "priority" if args.tier == "fast" else None,
                    "approvalPolicy": "never",
                    "sandboxPolicy": {"type": "readOnly", "networkAccess": False},
                    "outputSchema": schema,
                },
            }
        )
        _, turn_response = client.wait_for(lambda message: message.get("id") == 3)
        if "error" in turn_response:
            raise RuntimeError(f"turn/start 失败：{turn_response['error']}")
        turn_id = turn_response["result"]["turn"]["id"]

        deadline = time.monotonic() + args.timeout
        while time.monotonic() < deadline:
            elapsed, message = client._next(deadline)
            method = message.get("method")
            params = message.get("params")
            if method == "item/agentMessage/delta" and isinstance(params, dict):
                if params.get("threadId") == thread_id and params.get("turnId") == turn_id:
                    delta = params.get("delta")
                    if isinstance(delta, str):
                        deltas.append(Delta(elapsed, delta))
            elif method == "item/completed" and isinstance(params, dict):
                item = params.get("item")
                if isinstance(item, dict) and item.get("type") == "agentMessage":
                    completed_text = str(item.get("text") or "")
            elif method == "thread/tokenUsage/updated":
                candidate = usage_breakdown(message)
                if candidate is not None:
                    last_usage = candidate
            elif method == "turn/completed" and isinstance(params, dict):
                turn = params.get("turn")
                if isinstance(turn, dict) and turn.get("id") == turn_id:
                    turn_status = str(turn.get("status"))
                    turn_completed = elapsed
                    break
        else:
            raise TimeoutError(f"turn 超过 {args.timeout:.0f} 秒仍未完成")
    finally:
        client.stop()

    delta_text = "".join(delta.text for delta in deltas)
    final_text = completed_text or delta_text
    text_tokens = len(encode(final_text))
    first_delta_tokens = len(encode(deltas[0].text)) if deltas else 0
    rates = derive_stream_rates(
        deltas, text_tokens, first_delta_tokens, turn_started, turn_completed
    )
    usage_input = int(last_usage["inputTokens"]) if last_usage else None
    usage_cached = int(last_usage["cachedInputTokens"]) if last_usage else None
    usage_output = int(last_usage["outputTokens"]) if last_usage else None
    usage_reasoning = int(last_usage["reasoningOutputTokens"]) if last_usage else None
    usage_non_reasoning = (
        max(0, usage_output - usage_reasoning)
        if usage_output is not None and usage_reasoning is not None
        else None
    )
    metrics = StreamMetrics(
        model=args.model,
        effort=args.effort,
        tier=args.tier,
        requested_min_text_tokens=args.min_text_tokens,
        expected_rows=args.rows,
        words_per_row=args.words_per_row,
        success=turn_status == "completed",
        target_reached=text_tokens >= args.min_text_tokens,
        turn_status=turn_status,
        e2e_seconds=turn_completed - turn_started,
        ttft_seconds=rates["ttft_seconds"],
        first_to_last_delta_seconds=rates["first_to_last_delta_seconds"],
        first_to_completed_seconds=rates["first_to_completed_seconds"],
        delta_count=len(deltas),
        text_chars=len(final_text),
        text_words=len(final_text.split()),
        text_tokens=text_tokens,
        first_delta_tokens=first_delta_tokens,
        usage_input_tokens=usage_input,
        usage_cached_input_tokens=usage_cached,
        usage_output_tokens=usage_output,
        usage_reasoning_output_tokens=usage_reasoning,
        usage_non_reasoning_output_tokens=usage_non_reasoning,
        e2e_text_tps=rates["e2e_text_tps"],
        stream_text_tps=rates["stream_text_tps"],
        boundary_adjusted_stream_text_tps=rates["boundary_adjusted_stream_text_tps"],
        message_matches_deltas=bool(completed_text) and completed_text == delta_text,
        tokenizer=tokenizer_name,
    )
    return metrics, client.raw, final_text


def format_number(value: float | None, digits: int = 2) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


def write_outputs(
    output_dir: Path, metrics: StreamMetrics, raw: list[dict[str, Any]], final_text: str
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "metrics.json").write_text(
        json.dumps(asdict(metrics), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    with (output_dir / "events.jsonl").open("w", encoding="utf-8") as handle:
        for entry in raw:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    (output_dir / "output.txt").write_text(final_text, encoding="utf-8")
    report = [
        "# Codex 10K 流式输出测速",
        "",
        f"生成时间：{utc_now()}",
        "",
        f"- 配置：`{metrics.model}` / `{metrics.effort}` / `{metrics.tier}`",
        f"- 状态：{'成功' if metrics.success else '失败'}；10K 目标：{'达到' if metrics.target_reached else '未达到'}",
        f"- 实际文本 tokens：{metrics.text_tokens}（{metrics.tokenizer}）",
        f"- usage 非 reasoning tokens：{metrics.usage_non_reasoning_output_tokens}",
        f"- 端到端耗时：{metrics.e2e_seconds:.3f} s",
        f"- TTFT：{format_number(metrics.ttft_seconds, 3)} s",
        f"- 首末 delta 区间：{format_number(metrics.first_to_last_delta_seconds, 3)} s",
        f"- 文本 delta 数：{metrics.delta_count}",
        f"- 端到端文本吞吐：{format_number(metrics.e2e_text_tps)} tok/s",
        f"- 常见流式吞吐（全部文本 tokens / 首末 delta 区间）：{format_number(metrics.stream_text_tps)} tok/s",
        f"- 边界修正吞吐（扣除首 delta tokens）：{format_number(metrics.boundary_adjusted_stream_text_tps)} tok/s",
        f"- 完成消息与 delta 拼接一致：{'是' if metrics.message_matches_deltas else '否'}",
        "",
        "## 口径",
        "",
        "- 流式吞吐通过 app-server 的 `item/agentMessage/delta` 到达时间计算。",
        "- 文本 token 使用本地 `o200k_base` 对最终消息独立计数，不以 usage 差值冒充可见文本 token。",
        "- 边界修正值扣除了第一个 delta 的 tokens，因为这些 token 在开始计时前已经生成。",
        "- 端到端吞吐仍包含客户端、排队、输入处理和隐藏推理，不能与纯流式吞吐混用。",
        "",
    ]
    (output_dir / "report.md").write_text("\n".join(report), encoding="utf-8")


def parser() -> ChineseArgumentParser:
    result = ChineseArgumentParser(description="通过 Codex app-server delta 测量 10K 输出吞吐")
    result.add_argument("--model", default="gpt-5.6-terra", help="待测模型名称")
    result.add_argument("--effort", default="medium", help="推理档位")
    result.add_argument(
        "--tier",
        choices=["standard", "fast"],
        default="fast",
        help="服务层，默认 fast",
    )
    result.add_argument(
        "--min-text-tokens", type=int, default=10_000, help="最终消息的最少文本 token 数"
    )
    result.add_argument("--rows", type=int, default=900, help="结构化输出的固定行数")
    result.add_argument("--words-per-row", type=int, default=10, help="每行固定单词数")
    result.add_argument("--timeout", type=float, default=360, help="单次请求超时秒数")
    result.add_argument(
        "--codex-bin",
        default="/Applications/ChatGPT.app/Contents/Resources/codex",
        help="Codex CLI 的绝对路径",
    )
    result.add_argument("--workspace", default=tempfile.gettempdir(), help="隔离工作目录")
    result.add_argument("--output-dir", required=True, help="结果输出目录")
    result.add_argument(
        "--confirm-usage", action="store_true", help="确认真实请求会消耗 Codex 用量"
    )
    return result


def main() -> int:
    args = parser().parse_args()
    if not args.confirm_usage:
        print("拒绝发起真实请求：请添加 --confirm-usage", flush=True)
        return 2
    if args.rows < 1 or args.words_per_row < 1 or args.min_text_tokens < 1:
        print("rows、words-per-row 和 min-text-tokens 必须为正数", flush=True)
        return 2
    try:
        metrics, raw, final_text = run(args)
        write_outputs(Path(args.output_dir).expanduser(), metrics, raw, final_text)
    except Exception as exc:
        print(f"测速失败：{exc}", flush=True)
        return 1
    print(json.dumps(asdict(metrics), ensure_ascii=False, indent=2), flush=True)
    print(f"报告：{Path(args.output_dir).expanduser() / 'report.md'}", flush=True)
    return 0 if metrics.success and metrics.target_reached else 1


if __name__ == "__main__":
    raise SystemExit(main())
