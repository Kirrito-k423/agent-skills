#!/usr/bin/env python3
"""验证严格函数复查门禁能通过具体解释，并拒绝占位与漏行。"""

from __future__ import annotations

import copy
import hashlib
import unittest
from pathlib import Path

from render_walkthrough import ValidationError, call_syntax_present, render, validate_analysis


SOURCE = """int add(int a, int b)
{
    int sum = a + b;
    return sum;
}
"""


def valid_analysis() -> dict:
    source_sha256 = hashlib.sha256(SOURCE.encode("utf-8")).hexdigest()
    return {
        "schema_version": 2,
        "title": "加法函数代码走读",
        "summary": "读取两个整数，计算并返回它们的和。",
        "language": "cpp",
        "review_summary": {
            "status": "PASS",
            "source_sha256": source_sha256,
            "inventory_count": 1,
            "reviewed_count": 1,
            "pending_functions": [],
            "rework_functions": [],
        },
        "function_inventory": [{
            "id": "add-1",
            "name": "add",
            "signature": "int add(int a, int b)",
            "start": 1,
            "end": 5,
            "unit_kind": "definition",
            "inactive": False,
        }],
        "modules": [{
            "id": "calculate",
            "name": "整数加法",
            "summary": "把两个输入整数相加并返回结果。",
            "ranges": [[1, 5]],
            "position": {"x": 50, "y": 50},
            "tips": [],
            "edges": [],
            "inactive": False,
        }],
        "functions": [{
            "id": "add-1",
            "module_id": "calculate",
            "name": "add",
            "start": 1,
            "end": 5,
            "summary": "读取形参 a 与 b，把二者相加后通过 sum 返回。",
            "inactive": False,
            "inputs": ["a", "b"],
            "outputs": ["sum"],
            "side_effects": [],
            "review": {
                "status": "PASS",
                "reviewer": "review-agent",
                "draft_author": "analysis-agent",
                "revision": 1,
                "line_range": [1, 5],
                "gaps": [],
                "overlaps": [],
                "unresolved": [],
                "required_changes": [],
            },
            "line_notes": [
                {"line": 1, "kind": "signature", "explanation": "声明 add 接收整数 a、b，并约定返回一个整数结果。", "reads": ["a", "b"], "writes": []},
                {"line": 2, "kind": "brace", "explanation": "打开 add 的函数体作用域。", "reads": [], "writes": []},
                {"line": 3, "kind": "declaration", "explanation": "读取 a 与 b 完成加法，并把结果初始化到局部变量 sum。", "reads": ["a", "b"], "writes": ["sum"]},
                {"line": 4, "kind": "statement", "explanation": "读取 sum 作为 add 的最终返回值交给调用者。", "reads": ["sum"], "writes": []},
                {"line": 5, "kind": "brace", "explanation": "关闭 add 的函数体，结束本次加法计算。", "reads": [], "writes": []},
            ],
            "segments": [{
                "id": "add-calculate",
                "start": 1,
                "end": 5,
                "title": "读取 a、b，生成并返回 sum",
                "detail": "函数把两个整数形参相加到 sum，再把 sum 返回给调用者。",
                "kind": "compute",
                "input_state": ["a：第一个整数形参", "b：第二个整数形参"],
                "mechanism": "执行 sum = a + b 保存加法结果，随后 return sum。",
                "output_state": ["sum：a 与 b 的整数和，并作为返回值"],
                "why": "用具名局部变量 sum 保存中间结果，使返回的数据来源可以直接追踪。",
                "calls": [],
            }],
        }],
        "symbols": [],
        "glossary": [],
    }


class StrictReviewValidationTest(unittest.TestCase):
    @staticmethod
    def 带内存搬运模型的分析() -> dict:
        analysis = valid_analysis()
        analysis["memory_model"] = {
            "review": {
                "status": "PASS", "reviewer": "memory-review-agent", "draft_author": "memory-analysis-agent",
                "revision": 1, "source_revisions": ["fixture@abc"], "unresolved": [], "required_changes": [],
            },
            "summary": "把输入整数从当前 Rank GM 搬到计算 UB，再把结果写回输出 GM。",
            "facts": ["测试模型只验证内存区域、搬运端点、函数和源码行之间的引用完整性。"],
            "canvas": {"width": 600, "height": 300},
            "spaces": [
                {"id": "local-gm", "name": "当前 Rank GM", "kind": "gm", "scope": "rank-local", "color": "#2457d6", "description": "保存输入整数与最终结果的全局内存。"},
                {"id": "aiv-ub", "name": "AIV UB", "kind": "ub", "scope": "aiv-private", "color": "#b66516", "description": "保存加法过程中的局部工作数据。"},
            ],
            "regions": [
                {"id": "input-gm", "space_id": "local-gm", "name": "输入整数", "owner": "当前 Rank", "address": "参数 a 与 b", "size": "两个 int", "purpose": "提供加法输入", "position": {"x": 100, "y": 100}, "evidence_lines": [1, 3]},
                {"id": "sum-ub", "space_id": "aiv-ub", "name": "局部 sum", "owner": "当前 AIV", "address": "局部变量 sum", "size": "一个 int", "purpose": "保存加法结果", "position": {"x": 400, "y": 100}, "evidence_lines": [3]},
            ],
            "transfers": [{
                "id": "calculate-sum", "kind": "data", "from": "input-gm", "to": "sum-ub",
                "module_ids": ["calculate"], "function_id": "add-1", "line": 3, "evidence_lines": [3],
                "api": "整数加法", "engine": "标量流水", "size": "两个 int 输入",
                "source_address": "形参 a 与 b", "target_address": "局部变量 sum",
                "sync": "单线程语句顺序", "description": "读取 a 与 b，并把加法结果保存到 sum。", "curve": 0,
            }],
            "paths": [{"id": "main-data", "name": "主数据路径", "color": "#2457d6", "description": "输入进入局部结果的最短路径。", "transfer_ids": ["calculate-sum"]}],
            "allocations": [{
                "id": "test-workspace", "space_id": "local-gm", "name": "测试全局工作区", "kind": "allocator",
                "scope": "当前 Rank", "capacity": "2 × sizeof(int)", "base": "测试 allocator 返回地址", "alignment": "alignof(int)",
                "lifetime": "一次测试调用", "reuse": "a/b 输入与 sum 不重叠", "purpose": "验证大块申请与区域引用契约",
                "evidence": ["test fixture：SOURCE L1–L5"], "region_ids": ["input-gm"],
            }],
            "resource_budget": {
                "summary": "测试用资源预算只验证容量卡片和证据字段会进入正式页面。",
                "assumptions": ["int 的具体字节数由目标 ABI 决定。"],
                "cards": [{
                    "id": "test-rank-bytes", "label": "每 Rank 工作区", "value": "2 × sizeof(int)",
                    "detail": "包含两个整数输入，不把局部 sum 重复计入 GM。", "level": "verified",
                    "evidence": ["test fixture：SOURCE L1–L3"],
                }],
            },
        }
        return analysis

    def test_识别_vf_call_模板参数中的_simt_kernel(self) -> None:
        line = "AscendC::Simt::VF_CALL<simt_prepare_mapping>(dim, ptr);"
        self.assertTrue(call_syntax_present("simt_prepare_mapping", line))
        self.assertTrue(call_syntax_present("VF_CALL", line))
        self.assertFalse(call_syntax_present("unrelated_kernel", line))

    def test_识别三尖括号形式的设备核启动(self) -> None:
        line = "v1_dispatch_udma_kernel<<<block_dim, ub_bytes, stream>>>(x, tiling);"
        self.assertTrue(call_syntax_present("v1_dispatch_udma_kernel", line))
        self.assertTrue(call_syntax_present("v1_dispatch_udma_kernel", "v1_dispatch_udma_kernel<<<"))
        self.assertFalse(call_syntax_present("unrelated_kernel", line))

    def test_具体解释通过严格门禁(self) -> None:
        validate_analysis(valid_analysis(), SOURCE, 5)

    def test_语义块最多六十行(self) -> None:
        source = "\n".join(f"// line_{line}" for line in range(1, 62)) + "\n"
        analysis = copy.deepcopy(valid_analysis())
        analysis["review_summary"]["source_sha256"] = hashlib.sha256(source.encode("utf-8")).hexdigest()
        analysis["function_inventory"][0]["end"] = 61
        analysis["modules"][0]["ranges"] = [[1, 61]]
        function = analysis["functions"][0]
        function["end"] = 61
        function["review"]["line_range"] = [1, 61]
        function["line_notes"] = [
            {"line": line, "kind": "comment", "explanation": f"第 {line} 行标记 line_{line} 的测试上下文。", "reads": [], "writes": []}
            for line in range(1, 62)
        ]
        function["segments"][0].update({
            "start": 1,
            "end": 61,
            "detail": "line_1 到 line_61 被故意合并，用于验证严格的六十行上限。",
        })
        with self.assertRaisesRegex(ValidationError, "最多允许 60 行"):
            validate_analysis(analysis, source, 61)

    def test_源码标签可隐藏本机绝对路径(self) -> None:
        analysis = validate_analysis(valid_analysis(), SOURCE, 5)
        page = render(
            Path("/private/work/source.cc"),
            SOURCE,
            analysis,
            source_label="samples/source.cc",
        )
        self.assertIn('"sourcePath":"samples/source.cc"', page)
        self.assertNotIn("/private/work/source.cc", page)

    def test_内存搬运模型引用真实函数与代码行(self) -> None:
        validate_analysis(self.带内存搬运模型的分析(), SOURCE, 5)

    def test_内存搬运标签使用独立步骤条而不覆盖拓扑节点(self) -> None:
        analysis = validate_analysis(self.带内存搬运模型的分析(), SOURCE, 5)
        page = render(Path("/tmp/add.cc"), SOURCE, analysis)
        self.assertIn('class="memory-transfer-rail"', page)
        self.assertIn('class="memory-edge-hit"', page)
        self.assertNotIn('class="memory-edge-label', page)

    def test_内存模式独占原两列并显示大块申请预算(self) -> None:
        analysis = validate_analysis(self.带内存搬运模型的分析(), SOURCE, 5)
        page = render(Path("/tmp/add.cc"), SOURCE, analysis)
        self.assertIn('data-workspace-view="memory"', page)
        self.assertIn('class="memory-allocation-strip"', page)
        self.assertIn('class="resource-budget-overview"', page)
        self.assertIn('function applyWorkspaceMode', page)
        self.assertIn('function chooseWorkspaceView', page)
        self.assertIn('memory-workspace-mode', page)

    def test_内存模型缺少大块申请会失败(self) -> None:
        analysis = self.带内存搬运模型的分析()
        del analysis["memory_model"]["allocations"]
        with self.assertRaisesRegex(ValidationError, "大块申请"):
            validate_analysis(analysis, SOURCE, 5)

    def test_内存模型必须经过独立复核(self) -> None:
        analysis = self.带内存搬运模型的分析()
        analysis["memory_model"]["review"]["reviewer"] = "memory-analysis-agent"
        with self.assertRaisesRegex(ValidationError, "不能与 draft_author 相同"):
            validate_analysis(analysis, SOURCE, 5)

    def test_内存搬运端点不存在会失败(self) -> None:
        analysis = self.带内存搬运模型的分析()
        analysis["memory_model"]["transfers"][0]["to"] = "missing-region"
        with self.assertRaisesRegex(ValidationError, "不存在的内存区域"):
            validate_analysis(analysis, SOURCE, 5)

    def test_遗漏逐行解释会失败(self) -> None:
        analysis = copy.deepcopy(valid_analysis())
        analysis["functions"][0]["line_notes"].pop(2)
        with self.assertRaisesRegex(ValidationError, "逐行覆盖"):
            validate_analysis(analysis, SOURCE, 5)

    def test_占位标题会失败(self) -> None:
        analysis = copy.deepcopy(valid_analysis())
        analysis["functions"][0]["segments"][0]["title"] = "语义块 04"
        with self.assertRaisesRegex(ValidationError, "占位解释"):
            validate_analysis(analysis, SOURCE, 5)

    def test_作者不能自签复查通过(self) -> None:
        analysis = copy.deepcopy(valid_analysis())
        analysis["functions"][0]["review"]["reviewer"] = "analysis-agent"
        with self.assertRaisesRegex(ValidationError, "不能与 draft_author 相同"):
            validate_analysis(analysis, SOURCE, 5)

    def test_函数清单不能遗漏定义(self) -> None:
        analysis = copy.deepcopy(valid_analysis())
        analysis["functions"] = []
        with self.assertRaisesRegex(ValidationError, "至少需要一个函数"):
            validate_analysis(analysis, SOURCE, 5)

    def test_活动模块不能没有函数解释(self) -> None:
        analysis = copy.deepcopy(valid_analysis())
        analysis["modules"].append({
            "id": "orphan",
            "name": "未解释模块",
            "summary": "这个活动模块尚未分配任何真实函数解释。",
            "ranges": [[1, 5]],
            "position": {"x": 75, "y": 75},
            "edges": [],
            "tips": [],
            "inactive": False,
        })
        with self.assertRaisesRegex(ValidationError, "活动 E2E 模块没有函数解释"):
            validate_analysis(analysis, SOURCE, 5)

    def test_典型路径必须沿真实模块有向边(self) -> None:
        analysis = copy.deepcopy(valid_analysis())
        analysis["primary_path"] = ["calculate", "missing-module"]
        with self.assertRaisesRegex(ValidationError, "指向不存在模块"):
            validate_analysis(analysis, SOURCE, 5)

    def test_DAG节点支持完整说明浮层与明显选中背景(self) -> None:
        page = render(Path("/tmp/add.cc"), SOURCE, valid_analysis())
        self.assertIn('id="graph-node-popover"', page)
        self.assertIn('data-info-summary="${esc(module.summary)}"', page)
        self.assertIn('data-info-summary="${esc(node.fn.summary)}"', page)
        self.assertIn('state.graphInfoPinned = { kind: "module"', page)
        self.assertIn("function centerE2EOnModule", page)
        self.assertIn("centerE2EOnModule(module.id);", page)
        self.assertIn("horizontalGutter", page)
        self.assertIn("verticalGutter", page)
        self.assertIn("functionHistory: []", page)
        self.assertIn("function restoreFunctionHistory", page)
        self.assertIn('data-function-back', page)
        self.assertIn('data-function-history-index', page)
        self.assertIn('data-call-line="${call.line}"', page)
        self.assertIn('data-column-resizer="left-middle"', page)
        self.assertIn('data-column-resizer="middle-code"', page)
        self.assertIn('data-function-row-resizer', page)
        self.assertIn('id="layout-reset"', page)
        self.assertIn("function applyLayout", page)
        self.assertIn("function resetLayout", page)
        self.assertIn(".module-node.active {", page)
        self.assertIn("background: var(--accent-soft)", page)


if __name__ == "__main__":
    unittest.main(verbosity=2)
