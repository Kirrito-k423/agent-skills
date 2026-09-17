#!/usr/bin/env python3
"""验证测速脚本的公开命令生成、事件解析和统计行为。"""

from __future__ import annotations

import tempfile
import unittest
import json
import sys
from argparse import Namespace
from pathlib import Path

import codex_benchmark as benchmark


class BenchmarkTests(unittest.TestCase):
    def test_standard_and_fast_commands_are_distinct(self) -> None:
        standard = benchmark.Experiment("gpt-5.6-terra", "medium", "standard", "latency", "measure", 1)
        fast = benchmark.Experiment("gpt-5.6-terra", "medium", "fast", "latency", "measure", 1)
        standard_command = benchmark.build_command("codex", standard, "测试", Path("/tmp/bench"))
        fast_command = benchmark.build_command("codex", fast, "测试", Path("/tmp/bench"))
        self.assertNotIn('service_tier="priority"', standard_command)
        self.assertIn('service_tier="priority"', fast_command)
        self.assertIn('model_reasoning_effort="medium"', fast_command)
        self.assertIn('approval_policy="never"', fast_command)
        self.assertNotIn("-a", fast_command)

    def test_completed_message_does_not_claim_strict_ttft(self) -> None:
        events = [
            {"elapsed_seconds": 0.1, "event": {"type": "thread.started", "thread_id": "t"}},
            {
                "elapsed_seconds": 8.0,
                "event": {
                    "type": "item.completed",
                    "item": {"id": "m", "type": "agent_message", "text": "结果"},
                },
            },
            {
                "elapsed_seconds": 9.0,
                "event": {
                    "type": "turn.completed",
                    "usage": {
                        "input_tokens": 1000,
                        "cached_input_tokens": 200,
                        "output_tokens": 120,
                        "reasoning_output_tokens": 20,
                    },
                },
            },
        ]
        metrics = benchmark.derive_metrics(events, 10.0, 0, False)
        self.assertTrue(metrics["success"])
        self.assertEqual(metrics["usage_non_reasoning_output_tokens"], 100)
        self.assertEqual(metrics["uncached_input_tokens"], 800)
        self.assertEqual(metrics["usage_non_reasoning_wall_tps"], 10.0)
        self.assertEqual(metrics["first_visible_event_seconds"], 8.0)
        self.assertIsNone(metrics["strict_ttft_seconds"])
        self.assertIsNone(metrics["usage_non_reasoning_active_tps"])

    def test_started_and_completed_message_enable_active_decode_tps(self) -> None:
        events = [
            {
                "elapsed_seconds": 2.0,
                "event": {"type": "item.started", "item": {"id": "m", "type": "agent_message"}},
            },
            {
                "elapsed_seconds": 6.0,
                "event": {"type": "item.completed", "item": {"id": "m", "type": "agent_message"}},
            },
            {
                "elapsed_seconds": 6.1,
                "event": {
                    "type": "turn.completed",
                    "usage": {
                        "input_tokens": 100,
                        "cached_input_tokens": 0,
                        "output_tokens": 110,
                        "reasoning_output_tokens": 10,
                    },
                },
            },
        ]
        metrics = benchmark.derive_metrics(events, 8.0, 0, False)
        self.assertEqual(metrics["active_decode_seconds"], 4.0)
        self.assertEqual(metrics["usage_non_reasoning_active_tps"], 25.0)

    def test_completed_tool_item_is_counted_without_started_event(self) -> None:
        events = [
            {
                "elapsed_seconds": 1.0,
                "event": {
                    "type": "item.completed",
                    "item": {"id": "tool-1", "type": "command_execution"},
                },
            },
            {
                "elapsed_seconds": 2.0,
                "event": {"type": "turn.completed", "usage": {}},
            },
        ]
        metrics = benchmark.derive_metrics(events, 2.0, 0, False)
        self.assertEqual(metrics["tool_item_count"], 1)

    def test_quick_matrix_has_expected_request_count(self) -> None:
        args = Namespace(
            preset="quick",
            models=None,
            efforts=None,
            tiers=None,
            workloads=None,
            repeats=None,
            warmups=None,
            prompt_file=None,
        )
        matrix = benchmark.resolve_matrix(args)
        self.assertEqual(matrix.configurations, 48)
        self.assertEqual(matrix.requests, 48)

    def test_invalid_prefill_shape_is_rejected(self) -> None:
        args = Namespace(
            preset="custom",
            models="gpt-5.6-terra",
            efforts="medium",
            tiers="standard",
            workloads="prefill-short,prefill-long",
            repeats=1,
            warmups=0,
            prompt_file=None,
            decode_repetitions=8,
            prefill_short_words=1024,
            prefill_long_words=1024,
        )
        with self.assertRaisesRegex(ValueError, "长输入填充词数"):
            benchmark.resolve_matrix(args)

    def test_speedup_and_prefill_proxy_use_independent_pairs(self) -> None:
        summary = [
            {
                "model": "m",
                "effort": "medium",
                "tier": "standard",
                "workload": "latency",
                "wall_p50_seconds": 10.0,
                "usage_non_reasoning_wall_tps_p50": 5.0,
            },
            {
                "model": "m",
                "effort": "medium",
                "tier": "fast",
                "workload": "latency",
                "wall_p50_seconds": 5.0,
                "usage_non_reasoning_wall_tps_p50": 8.0,
            },
            {
                "model": "m",
                "effort": "medium",
                "tier": "standard",
                "workload": "prefill-short",
                "first_model_event_p50_seconds": 2.0,
                "wall_p50_seconds": 2.5,
                "input_tokens_p50": 1000.0,
            },
            {
                "model": "m",
                "effort": "medium",
                "tier": "standard",
                "workload": "prefill-long",
                "first_model_event_p50_seconds": 4.0,
                "wall_p50_seconds": 4.5,
                "input_tokens_p50": 5000.0,
            },
        ]
        speedup = benchmark.calculate_speedups(summary)[0]
        proxy = benchmark.calculate_prefill_proxies(summary)[0]
        self.assertEqual(speedup["latency_speedup"], 2.0)
        self.assertEqual(speedup["wall_tps_ratio"], 1.6)
        self.assertEqual(proxy["prefill_proxy_tps"], 2000.0)

    def test_summarize_writes_all_reports(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            (output / "manifest.json").write_text(
                '{"codex_version":"codex-cli test"}\n', encoding="utf-8"
            )
            row = {
                "experiment_key": "k",
                "phase": "measure",
                "model": "m",
                "effort": "medium",
                "tier": "standard",
                "workload": "latency",
                "success": True,
                "wall_seconds": 2.0,
                "first_model_event_seconds": 1.5,
                "input_tokens": 100,
                "cached_input_tokens": 20,
                "reasoning_output_tokens": 5,
                "usage_non_reasoning_output_tokens": 5,
                "usage_non_reasoning_wall_tps": 2.5,
                "usage_non_reasoning_active_tps": None,
                "tool_item_count": 0,
            }
            (output / "results.jsonl").write_text(
                benchmark.json.dumps(row, ensure_ascii=False) + "\n", encoding="utf-8"
            )
            benchmark.summarize_directory(output)
            for name in ["samples.csv", "summary.csv", "summary.json", "report.md"]:
                self.assertTrue((output / name).is_file(), name)

    def test_execute_command_captures_jsonl_and_raw_log(self) -> None:
        script = (
            "import json; "
            "print(json.dumps({'type':'thread.started','thread_id':'t'}), flush=True); "
            "print(json.dumps({'type':'turn.completed','usage':{'input_tokens':1}}), flush=True)"
        )
        with tempfile.TemporaryDirectory() as temporary:
            raw_path = Path(temporary) / "raw.jsonl"
            events, raw_entries, wall, exit_code, timed_out = benchmark.execute_command(
                [sys.executable, "-c", script], 5.0, raw_path
            )
            self.assertEqual(exit_code, 0)
            self.assertFalse(timed_out)
            self.assertGreater(wall, 0)
            self.assertEqual(len(events), 2)
            self.assertEqual(len(raw_entries), 2)
            saved = [json.loads(line) for line in raw_path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(saved[1]["event"]["type"], "turn.completed")


if __name__ == "__main__":
    unittest.main(verbosity=2)
