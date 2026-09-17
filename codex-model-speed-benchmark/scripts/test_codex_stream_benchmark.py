import importlib.util
import json
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("codex_stream_benchmark.py")
SPEC = importlib.util.spec_from_file_location("codex_stream_benchmark", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class StreamBenchmarkTests(unittest.TestCase):
    def test_help_is_localized_to_chinese(self):
        help_text = MODULE.parser().format_help()
        self.assertIn("用法：", help_text)
        self.assertIn("选项：", help_text)
        self.assertIn("显示帮助并退出", help_text)
        self.assertIn("确认真实请求会消耗 Codex 用量", help_text)
        self.assertNotIn("show this help message and exit", help_text)

    def test_output_schema_requires_exact_rows(self):
        schema, phrase = MODULE.build_output_schema(3, 2)
        rows = schema["properties"]["rows"]
        self.assertEqual(rows["minItems"], 3)
        self.assertEqual(rows["maxItems"], 3)
        self.assertEqual(rows["items"]["enum"], ["speed speed"])
        self.assertEqual(phrase, "speed speed")

    def test_expected_payload_is_compact_and_complete(self):
        payload = MODULE.expected_payload(2, "speed speed")
        self.assertEqual(json.loads(payload), {"rows": ["speed speed", "speed speed"]})
        self.assertNotIn(": ", payload)

    def test_stream_rate_excludes_fixed_ttft(self):
        deltas = [MODULE.Delta(10.0, "a"), MODULE.Delta(12.0, "b")]
        rates = MODULE.derive_stream_rates(deltas, 202, 2, 1.0, 13.0)
        self.assertEqual(rates["ttft_seconds"], 9.0)
        self.assertEqual(rates["stream_text_tps"], 101.0)
        self.assertEqual(rates["boundary_adjusted_stream_text_tps"], 100.0)
        self.assertAlmostEqual(rates["e2e_text_tps"], 202 / 12)

    def test_no_deltas_does_not_claim_stream_speed(self):
        rates = MODULE.derive_stream_rates([], 100, 0, 1.0, 11.0)
        self.assertIsNone(rates["ttft_seconds"])
        self.assertIsNone(rates["stream_text_tps"])
        self.assertEqual(rates["e2e_text_tps"], 10.0)


if __name__ == "__main__":
    unittest.main()
