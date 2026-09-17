#!/usr/bin/env python3
"""验证三栏生成器的覆盖、转义、漂移和强制复查行为。"""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("pr_to_html.py")


class PrToHtmlTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "-q")
        self.git("config", "user.email", "review@example.invalid")
        self.git("config", "user.name", "审查测试")
        lines = [f"value_{index} = {index}" for index in range(24)]
        (self.repo / "sample.py").write_text("\n".join(lines) + "\n", encoding="utf-8")
        self.git("add", "sample.py")
        self.git("commit", "-qm", "基线")
        self.base = self.git("rev-parse", "HEAD").stdout.strip()
        lines[1] = "value_1 = '<危险内容>'"
        lines[21] = "value_21 = 210"
        (self.repo / "sample.py").write_text("\n".join(lines) + "\n", encoding="utf-8")
        self.git("commit", "-qam", "修改两处")
        self.review_json = self.root / "review.json"
        self.output = self.root / "review.html"

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.repo), *args], check=True,
                              text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def tool(self, *args, check=True):
        return subprocess.run([sys.executable, str(SCRIPT), *args], check=check,
                              text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def prepare(self):
        self.tool("prepare", "--repo", str(self.repo), "--base", self.base,
                  "--head", "HEAD", "--review-json", str(self.review_json))
        return json.loads(self.review_json.read_text(encoding="utf-8"))

    @staticmethod
    def complete(data):
        data["review"].update({
            "title": "最小修改复查",
            "requirement": "只修改两个独立的配置值",
            "summary": "两个改动分别处理两个独立配置。",
            "scope_verdict": "最小",
            "scope_reason": "两个单元都直接对应需求，没有顺手重构。",
            "validation_level": "单元测试",
            "recommended_actions": [],
        })
        for index, item in enumerate(data["segments"]):
            item.update({
                "reviewed": True,
                "requirement_link": f"对应第 {index + 1} 个配置要求。",
                "old_title": "<旧逻辑>配置值不符合要求",
                "old_explanation": "旧值与本次明确要求不同，需要局部替换。",
                "evidence": [f"sample.py 的审查单元 {item['id']}"],
                "new_title": "仅替换目标配置值",
                "new_explanation": "新实现保持文件结构，只修改目标值。",
                "correctness": "合理",
                "correctness_reason": "类型和调用方式不变，修改范围局限于常量。",
                "minimality": "必需",
                "minimality_reason": "删除此改动会使对应需求无法满足，没有更小实现。",
                "risks": [],
                "validation": ["测试夹具已核对两处目标值"],
            })
        return data

    def test_prepare_and_build_cover_every_change(self):
        data = self.prepare()
        self.assertEqual(data["stats"]["segments"], 2)
        self.assertEqual(data["stats"]["added"], 2)
        self.assertEqual(data["stats"]["deleted"], 2)
        identifiers = [item["id"] for item in data["segments"]]
        self.assertEqual(len(identifiers), len(set(identifiers)))
        changed = sum(item["added"] + item["deleted"] for item in data["segments"])
        self.assertEqual(changed, 4)

        self.review_json.write_text(
            json.dumps(self.complete(data), ensure_ascii=False, indent=2), encoding="utf-8")
        self.tool("build", "--repo", str(self.repo), "--base", self.base,
                  "--head", "HEAD", "--reviews", str(self.review_json),
                  "--output", str(self.output))
        page = self.output.read_text(encoding="utf-8")
        self.assertIn('class="three-columns"', page)
        self.assertIn('.page{width:100%;max-width:none', page)
        self.assertIn('minmax(760px,60fr)', page)
        self.assertIn("&lt;危险内容&gt;", page)
        self.assertIn("&lt;旧逻辑&gt;", page)
        self.assertNotIn("<危险内容>", page)
        self.assertEqual(page.count('class="change-card"'), 2)
        self.assertGreaterEqual(page.count('data-file="sample.py"'), 2)
        self.assertIn("c.dataset.file===f", page)
        self.assertIn("测试夹具已核对两处目标值", page)
        self.assertIn('class="context-expander"', page)
        self.assertIn('class="collapse-context hidden"', page)
        self.assertIn("const sourceContext=", page)
        self.assertIn("value_10 = 10", page)
        self.assertIn("function expandContext", page)
        self.assertIn("function collapseContext", page)
        self.assertIn("\\u003c危险内容\\u003e", page)

    def test_build_rejects_unreviewed_and_stale_data(self):
        data = self.prepare()
        incomplete = self.tool(
            "build", "--repo", str(self.repo), "--base", self.base, "--head", "HEAD",
            "--reviews", str(self.review_json), "--output", str(self.output), check=False)
        self.assertEqual(incomplete.returncode, 2)
        self.assertIn("尚未填写", incomplete.stderr)

        self.review_json.write_text(
            json.dumps(self.complete(data), ensure_ascii=False, indent=2), encoding="utf-8")
        with (self.repo / "sample.py").open("a", encoding="utf-8") as stream:
            stream.write("extra = True\n")
        self.git("commit", "-qam", "head 漂移")
        stale = self.tool(
            "build", "--repo", str(self.repo), "--base", self.base, "--head", "HEAD",
            "--reviews", str(self.review_json), "--output", str(self.output), check=False)
        self.assertEqual(stale.returncode, 2)
        self.assertIn("base/head 已漂移", stale.stderr)


if __name__ == "__main__":
    unittest.main()
