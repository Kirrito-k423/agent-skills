#!/usr/bin/env python3
"""校验代码走读分析数据，并生成无外部依赖的单文件 HTML。"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
from pathlib import Path
from typing import Any


SKILL_ROOT = Path(__file__).resolve().parent.parent
ASSET_ROOT = SKILL_ROOT / "assets"
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
EDGE_KINDS = {"control", "data", "sync", "handshake"}
SEGMENT_KINDS = {"input", "compute", "guard", "loop", "sync", "output", "debug"}
SYMBOL_TYPES = {"input", "output", "api", "call", "sync"}
CALL_TYPES = {"internal", "external"}
MAX_SEGMENT_LINES = 60
MEMORY_SPACE_KINDS = {"gm", "ub", "control"}
TRANSFER_KINDS = {"data", "control", "sync"}
LINE_NOTE_KINDS = {
    "signature", "statement", "declaration", "branch", "loop", "call", "sync",
    "comment", "preprocessor", "brace", "blank",
}
PLACEHOLDER_PATTERNS = [
    re.compile(r"^语义块[\s_-]*\d+$", re.IGNORECASE),
    re.compile(r"^(条件守卫\s*/?\s*路径选择|条件判断|核心逻辑|业务逻辑|数据处理|调用函数|调用API|返回结果|准备工作|收尾工作)([\s_-]*\d+)?$", re.IGNORECASE),
    re.compile(r"^(继续执行当前函数的数据变换|循环处理一批任务|同步与可见性|内存绑定\s*/?\s*数据搬运)$", re.IGNORECASE),
    re.compile(r"^(具体逻辑见代码|详见源码|待补充|暂无说明|TODO|TBD|N/?A)$", re.IGNORECASE),
]
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class ValidationError(ValueError):
    """分析数据与源码不一致。"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成三轨联动的自包含代码走读 HTML")
    parser.add_argument("--source", required=True, type=Path, help="源码文件的绝对或相对路径")
    parser.add_argument(
        "--source-label",
        help="写入 HTML 的源码位置标签；省略时使用源码绝对路径",
    )
    parser.add_argument("--analysis", required=True, type=Path, help="分析 JSON 路径")
    parser.add_argument("--output", type=Path, help="输出 HTML 路径")
    parser.add_argument("--validate-only", action="store_true", help="只校验，不生成 HTML")
    parser.add_argument(
        "--allow-unreviewed-draft",
        action="store_true",
        help="仅生成带警告的未复查草稿；不得用于最终交付",
    )
    args = parser.parse_args()
    if not args.validate_only and args.output is None:
        parser.error("生成页面时必须提供 --output")
    return args


def require_dict(value: Any, where: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValidationError(f"{where} 必须是对象")
    return value


def require_list(value: Any, where: str) -> list[Any]:
    if not isinstance(value, list):
        raise ValidationError(f"{where} 必须是数组")
    return value


def require_text(value: Any, where: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{where} 必须是非空字符串")
    return value.strip()


def normalized_text(value: str) -> str:
    return re.sub(r"[\s，。；：、,.!！?？/]+", "", value).lower()


def call_syntax_present(call_name: str, source_line: str) -> bool:
    """识别普通/模板调用、VF_CALL，以及 kernel<<<...>>>(...) 启动。"""
    direct = re.search(
        rf"\b{re.escape(call_name)}\s*(?:<[^;{{}}()]*>)?\s*\(",
        source_line,
    )
    simt_kernel = re.search(
        rf"\bVF_CALL\s*<\s*{re.escape(call_name)}\s*>\s*\(",
        source_line,
    )
    # 三尖括号 launch 配置常被 clang-format 拆到后续行；首行的 `name<<<`
    # 已足以证明这是设备核调用，而不是普通标识符引用。
    launch_kernel = re.search(
        rf"\b{re.escape(call_name)}\s*<<<",
        source_line,
    )
    return direct is not None or simt_kernel is not None or launch_kernel is not None


def require_quality_text(value: Any, where: str, min_chars: int = 6) -> str:
    text = require_text(value, where)
    normalized = re.sub(r"\s+", " ", text).strip()
    if len(re.sub(r"\s+", "", normalized)) < min_chars:
        raise ValidationError(f"{where} 信息量不足：{text!r}")
    if any(pattern.fullmatch(normalized) for pattern in PLACEHOLDER_PATTERNS):
        raise ValidationError(f"{where} 是占位解释：{text!r}")
    return text


def require_text_list(value: Any, where: str, *, allow_empty: bool = True) -> list[str]:
    items = require_list(value, where)
    if not allow_empty and not items:
        raise ValidationError(f"{where} 不能为空")
    return [require_text(item, f"{where}[{index}]") for index, item in enumerate(items)]


def require_line(value: Any, where: str, line_count: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValidationError(f"{where} 必须是整数行号")
    if not 1 <= value <= line_count:
        raise ValidationError(f"{where}={value} 越界，源码共有 {line_count} 行")
    return value


def require_id(value: Any, where: str) -> str:
    item_id = require_text(value, where)
    if not ID_PATTERN.fullmatch(item_id):
        raise ValidationError(f"{where}={item_id!r} 只能包含字母、数字、短横线和下划线")
    return item_id


def validate_memory_model(
    raw_model: Any,
    *,
    modules_by_id: dict[str, dict[str, Any]],
    functions_by_id: dict[str, dict[str, Any]],
    source_lines: list[str],
    line_count: int,
) -> None:
    """校验可选的内存层级与关键路径搬运模型。"""
    if raw_model is None:
        return
    model = require_dict(raw_model, "memory_model")
    require_quality_text(model.get("summary"), "memory_model.summary", 12)
    require_text_list(model.get("facts"), "memory_model.facts", allow_empty=False)
    canvas = require_dict(model.get("canvas"), "memory_model.canvas")
    canvas_width = canvas.get("width")
    canvas_height = canvas.get("height")
    if not isinstance(canvas_width, (int, float)) or isinstance(canvas_width, bool) or canvas_width < 600:
        raise ValidationError("memory_model.canvas.width 必须是不小于 600 的数字")
    if not isinstance(canvas_height, (int, float)) or isinstance(canvas_height, bool) or canvas_height < 300:
        raise ValidationError("memory_model.canvas.height 必须是不小于 300 的数字")

    spaces = require_list(model.get("spaces"), "memory_model.spaces")
    regions = require_list(model.get("regions"), "memory_model.regions")
    transfers = require_list(model.get("transfers"), "memory_model.transfers")
    paths = require_list(model.get("paths"), "memory_model.paths")
    if not spaces or not regions or not transfers or not paths:
        raise ValidationError("memory_model 的 spaces、regions、transfers、paths 均不能为空")

    space_ids: set[str] = set()
    for index, raw_space in enumerate(spaces):
        where = f"memory_model.spaces[{index}]"
        space = require_dict(raw_space, where)
        space_id = require_id(space.get("id"), f"{where}.id")
        if space_id in space_ids:
            raise ValidationError(f"内存空间 ID 重复：{space_id}")
        space_ids.add(space_id)
        require_text(space.get("name"), f"{where}.name")
        kind = require_text(space.get("kind"), f"{where}.kind")
        if kind not in MEMORY_SPACE_KINDS:
            raise ValidationError(f"{where}.kind={kind!r} 不受支持")
        require_text(space.get("scope"), f"{where}.scope")
        require_quality_text(space.get("description"), f"{where}.description", 8)
        require_text(space.get("color"), f"{where}.color")

    region_ids: set[str] = set()
    for index, raw_region in enumerate(regions):
        where = f"memory_model.regions[{index}]"
        region = require_dict(raw_region, where)
        region_id = require_id(region.get("id"), f"{where}.id")
        if region_id in region_ids:
            raise ValidationError(f"内存区域 ID 重复：{region_id}")
        region_ids.add(region_id)
        space_id = require_id(region.get("space_id"), f"{where}.space_id")
        if space_id not in space_ids:
            raise ValidationError(f"{where}.space_id 指向不存在的内存空间：{space_id}")
        for field in ("name", "owner", "address", "size", "purpose"):
            require_quality_text(region.get(field), f"{where}.{field}", 4)
        position = require_dict(region.get("position"), f"{where}.position")
        x = position.get("x")
        y = position.get("y")
        if not isinstance(x, (int, float)) or isinstance(x, bool) or not 0 <= x <= canvas_width:
            raise ValidationError(f"{where}.position.x 超出画布")
        if not isinstance(y, (int, float)) or isinstance(y, bool) or not 0 <= y <= canvas_height:
            raise ValidationError(f"{where}.position.y 超出画布")
        evidence = require_list(region.get("evidence_lines"), f"{where}.evidence_lines")
        if not evidence:
            raise ValidationError(f"{where}.evidence_lines 不能为空")
        for line_index, line in enumerate(evidence):
            require_line(line, f"{where}.evidence_lines[{line_index}]", line_count)

    transfer_ids: set[str] = set()
    for index, raw_transfer in enumerate(transfers):
        where = f"memory_model.transfers[{index}]"
        transfer = require_dict(raw_transfer, where)
        transfer_id = require_id(transfer.get("id"), f"{where}.id")
        if transfer_id in transfer_ids:
            raise ValidationError(f"搬运 ID 重复：{transfer_id}")
        transfer_ids.add(transfer_id)
        for endpoint in ("from", "to"):
            region_id = require_id(transfer.get(endpoint), f"{where}.{endpoint}")
            if region_id not in region_ids:
                raise ValidationError(f"{where}.{endpoint} 指向不存在的内存区域：{region_id}")
        kind = require_text(transfer.get("kind"), f"{where}.kind")
        if kind not in TRANSFER_KINDS:
            raise ValidationError(f"{where}.kind={kind!r} 不受支持")
        function_id = require_id(transfer.get("function_id"), f"{where}.function_id")
        function = functions_by_id.get(function_id)
        if function is None:
            raise ValidationError(f"{where}.function_id 指向不存在的函数：{function_id}")
        line = require_line(transfer.get("line"), f"{where}.line", line_count)
        if not function["start"] <= line <= function["end"]:
            raise ValidationError(f"{where}.line 不在所声明函数范围内")
        module_ids = require_list(transfer.get("module_ids"), f"{where}.module_ids")
        if not module_ids:
            raise ValidationError(f"{where}.module_ids 不能为空")
        for module_index, module_id in enumerate(module_ids):
            module_id = require_id(module_id, f"{where}.module_ids[{module_index}]")
            if module_id not in modules_by_id:
                raise ValidationError(f"{where}.module_ids 指向不存在的模块：{module_id}")
        for field in (
            "api", "engine", "size", "source_address", "target_address", "sync", "description"
        ):
            require_quality_text(transfer.get(field), f"{where}.{field}", 3)
        evidence = require_list(transfer.get("evidence_lines"), f"{where}.evidence_lines")
        if line not in evidence:
            raise ValidationError(f"{where}.evidence_lines 必须包含主跳转行 {line}")
        for line_index, evidence_line in enumerate(evidence):
            require_line(evidence_line, f"{where}.evidence_lines[{line_index}]", line_count)
        curve = transfer.get("curve", 0)
        if not isinstance(curve, (int, float)) or isinstance(curve, bool):
            raise ValidationError(f"{where}.curve 必须是数字")

    path_ids: set[str] = set()
    covered_transfers: set[str] = set()
    for index, raw_path in enumerate(paths):
        where = f"memory_model.paths[{index}]"
        path = require_dict(raw_path, where)
        path_id = require_id(path.get("id"), f"{where}.id")
        if path_id in path_ids:
            raise ValidationError(f"内存路径 ID 重复：{path_id}")
        path_ids.add(path_id)
        require_text(path.get("name"), f"{where}.name")
        require_quality_text(path.get("description"), f"{where}.description", 8)
        require_text(path.get("color"), f"{where}.color")
        path_transfers = require_list(path.get("transfer_ids"), f"{where}.transfer_ids")
        if not path_transfers:
            raise ValidationError(f"{where}.transfer_ids 不能为空")
        if len(path_transfers) != len(set(path_transfers)):
            raise ValidationError(f"{where}.transfer_ids 不能重复")
        for transfer_index, transfer_id in enumerate(path_transfers):
            transfer_id = require_id(transfer_id, f"{where}.transfer_ids[{transfer_index}]")
            if transfer_id not in transfer_ids:
                raise ValidationError(f"{where}.transfer_ids 指向不存在的搬运：{transfer_id}")
            covered_transfers.add(transfer_id)
    if covered_transfers != transfer_ids:
        raise ValidationError(
            "memory_model 仍有未归入任何关键路径的搬运：" + ", ".join(sorted(transfer_ids - covered_transfers))
        )

    if model.get("allocations") is None:
        raise ValidationError("memory_model.allocations（大块申请）不能为空")
    allocations = require_list(model.get("allocations"), "memory_model.allocations")
    if not allocations:
        raise ValidationError("memory_model.allocations 不能为空；必须说明大块申请、容量与生命周期")
    allocation_ids: set[str] = set()
    for index, raw_allocation in enumerate(allocations):
        where = f"memory_model.allocations[{index}]"
        allocation = require_dict(raw_allocation, where)
        allocation_id = require_id(allocation.get("id"), f"{where}.id")
        if allocation_id in allocation_ids:
            raise ValidationError(f"内存申请 ID 重复：{allocation_id}")
        allocation_ids.add(allocation_id)
        space_id = require_id(allocation.get("space_id"), f"{where}.space_id")
        if space_id not in space_ids:
            raise ValidationError(f"{where}.space_id 指向不存在的内存空间：{space_id}")
        for field in ("name", "kind", "scope", "capacity", "base", "alignment", "lifetime", "reuse", "purpose"):
            require_quality_text(allocation.get(field), f"{where}.{field}", 3)
        evidence = require_text_list(allocation.get("evidence"), f"{where}.evidence", allow_empty=False)
        region_refs = require_list(allocation.get("region_ids"), f"{where}.region_ids")
        for region_index, region_id in enumerate(region_refs):
            region_id = require_id(region_id, f"{where}.region_ids[{region_index}]")
            if region_id not in region_ids:
                raise ValidationError(f"{where}.region_ids 指向不存在的内存区域：{region_id}")

    budget = require_dict(model.get("resource_budget"), "memory_model.resource_budget")
    require_quality_text(budget.get("summary"), "memory_model.resource_budget.summary", 12)
    require_text_list(budget.get("assumptions"), "memory_model.resource_budget.assumptions", allow_empty=False)
    cards = require_list(budget.get("cards"), "memory_model.resource_budget.cards")
    if not cards:
        raise ValidationError("memory_model.resource_budget.cards 不能为空")
    card_ids: set[str] = set()
    for index, raw_card in enumerate(cards):
        where = f"memory_model.resource_budget.cards[{index}]"
        card = require_dict(raw_card, where)
        card_id = require_id(card.get("id"), f"{where}.id")
        if card_id in card_ids:
            raise ValidationError(f"资源预算卡片 ID 重复：{card_id}")
        card_ids.add(card_id)
        for field in ("label", "value", "detail"):
            require_quality_text(card.get(field), f"{where}.{field}", 3)
        level = require_text(card.get("level", "info"), f"{where}.level")
        if level not in {"info", "verified", "warning", "critical"}:
            raise ValidationError(f"{where}.level={level!r} 不受支持")
        require_text_list(card.get("evidence"), f"{where}.evidence", allow_empty=False)

    review = require_dict(model.get("review"), "memory_model.review")
    if review.get("status") != "PASS":
        raise ValidationError("memory_model.review.status 必须为 PASS")
    reviewer = require_text(review.get("reviewer"), "memory_model.review.reviewer")
    draft_author = require_text(review.get("draft_author"), "memory_model.review.draft_author")
    if reviewer == draft_author:
        raise ValidationError("memory_model.review.reviewer 不能与 draft_author 相同")
    revision = review.get("revision")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        raise ValidationError("memory_model.review.revision 必须是正整数")
    require_text_list(review.get("source_revisions"), "memory_model.review.source_revisions", allow_empty=False)
    for field in ("unresolved", "required_changes"):
        values = require_list(review.get(field), f"memory_model.review.{field}")
        if values:
            raise ValidationError(f"memory_model.review.{field} 在 PASS 时必须为空")


def validate_analysis(
    analysis: Any,
    source_text: str,
    line_count: int,
    *,
    allow_unreviewed_draft: bool = False,
) -> dict[str, Any]:
    root = require_dict(analysis, "分析数据")
    source_lines = source_text.splitlines()
    require_text(root.get("title"), "title")
    require_text(root.get("summary"), "summary")
    require_text(root.get("language"), "language")

    modules = require_list(root.get("modules"), "modules")
    functions = require_list(root.get("functions"), "functions")
    symbols = require_list(root.get("symbols", []), "symbols")
    require_list(root.get("glossary", []), "glossary")
    if not modules:
        raise ValidationError("modules 至少需要一个 E2E 模块")
    if not functions:
        raise ValidationError("functions 至少需要一个函数")

    inventory_definitions: dict[str, dict[str, Any]] = {}
    if not allow_unreviewed_draft:
        if root.get("schema_version") != 2:
            raise ValidationError("正式渲染要求 schema_version=2；旧数据只能使用 --allow-unreviewed-draft")
        review_summary = require_dict(root.get("review_summary"), "review_summary")
        if review_summary.get("status") != "PASS":
            raise ValidationError("review_summary.status 必须为 PASS")
        source_sha256 = require_text(review_summary.get("source_sha256"), "review_summary.source_sha256")
        if not SHA256_PATTERN.fullmatch(source_sha256):
            raise ValidationError("review_summary.source_sha256 必须是 64 位小写 SHA-256")
        actual_sha256 = hashlib.sha256(source_text.encode("utf-8")).hexdigest()
        if source_sha256 != actual_sha256:
            raise ValidationError("源码 SHA-256 已变化，现有函数复查全部失效")
        inventory = require_list(root.get("function_inventory"), "function_inventory")
        if not inventory:
            raise ValidationError("function_inventory 不能为空")
        inventory_ids: set[str] = set()
        for index, raw_item in enumerate(inventory):
            where = f"function_inventory[{index}]"
            item = require_dict(raw_item, where)
            item_id = require_id(item.get("id"), f"{where}.id")
            if item_id in inventory_ids:
                raise ValidationError(f"函数清单 ID 重复：{item_id}")
            inventory_ids.add(item_id)
            require_text(item.get("name"), f"{where}.name")
            require_text(item.get("signature"), f"{where}.signature")
            start = require_line(item.get("start"), f"{where}.start", line_count)
            end = require_line(item.get("end"), f"{where}.end", line_count)
            if start > end:
                raise ValidationError(f"{where} 开始行不能大于结束行")
            unit_kind = require_text(item.get("unit_kind"), f"{where}.unit_kind")
            if unit_kind not in {"definition", "declaration_only"}:
                raise ValidationError(f"{where}.unit_kind={unit_kind!r} 不受支持")
            if not isinstance(item.get("inactive"), bool):
                raise ValidationError(f"{where}.inactive 必须是 boolean")
            if unit_kind == "definition":
                inventory_definitions[item_id] = item
        inventory_count = review_summary.get("inventory_count")
        reviewed_count = review_summary.get("reviewed_count")
        if inventory_count != len(inventory_definitions):
            raise ValidationError("review_summary.inventory_count 与函数定义清单数量不一致")
        if reviewed_count != len(inventory_definitions):
            raise ValidationError("review_summary.reviewed_count 与函数定义清单数量不一致")
        for field in ("pending_functions", "rework_functions"):
            values = require_list(review_summary.get(field), f"review_summary.{field}")
            if values:
                raise ValidationError(f"review_summary.{field} 必须为空")

    module_ids: set[str] = set()
    modules_by_id: dict[str, dict[str, Any]] = {}
    coverage = [False] * (line_count + 1)
    for index, raw_module in enumerate(modules):
        where = f"modules[{index}]"
        module = require_dict(raw_module, where)
        module_id = require_id(module.get("id"), f"{where}.id")
        if module_id in module_ids:
            raise ValidationError(f"模块 ID 重复：{module_id}")
        module_ids.add(module_id)
        modules_by_id[module_id] = module
        require_text(module.get("name"), f"{where}.name")
        require_text(module.get("summary"), f"{where}.summary")
        ranges = require_list(module.get("ranges"), f"{where}.ranges")
        if not ranges:
            raise ValidationError(f"{where}.ranges 不能为空")
        for range_index, raw_range in enumerate(ranges):
            range_where = f"{where}.ranges[{range_index}]"
            item_range = require_list(raw_range, range_where)
            if len(item_range) != 2:
                raise ValidationError(f"{range_where} 必须是 [开始行, 结束行]")
            start = require_line(item_range[0], f"{range_where}[0]", line_count)
            end = require_line(item_range[1], f"{range_where}[1]", line_count)
            if start > end:
                raise ValidationError(f"{range_where} 开始行不能大于结束行")
            for line in range(start, end + 1):
                coverage[line] = True
        position = require_dict(module.get("position"), f"{where}.position")
        for axis in ("x", "y"):
            value = position.get(axis)
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not 5 <= value <= 95:
                raise ValidationError(f"{where}.position.{axis} 必须在 5 到 95 之间")
        require_list(module.get("edges", []), f"{where}.edges")
        require_list(module.get("tips", []), f"{where}.tips")

    missing_lines = [line for line in range(1, line_count + 1) if not coverage[line]]
    if missing_lines:
        preview = ", ".join(map(str, missing_lines[:12]))
        suffix = "…" if len(missing_lines) > 12 else ""
        raise ValidationError(f"模块未覆盖 {len(missing_lines)} 行源码：{preview}{suffix}")

    for index, raw_module in enumerate(modules):
        module = require_dict(raw_module, f"modules[{index}]")
        for edge_index, raw_edge in enumerate(module.get("edges", [])):
            where = f"modules[{index}].edges[{edge_index}]"
            edge = require_dict(raw_edge, where)
            target = require_id(edge.get("to"), f"{where}.to")
            if target not in module_ids:
                raise ValidationError(f"{where}.to 指向不存在的模块：{target}")
            kind = require_text(edge.get("kind"), f"{where}.kind")
            if kind not in EDGE_KINDS:
                raise ValidationError(f"{where}.kind={kind!r} 不受支持")

    if "primary_path" in root:
        primary_path = require_list(root.get("primary_path"), "primary_path")
        if len(primary_path) < 2:
            raise ValidationError("primary_path 至少需要两个模块")
        normalized_primary_path: list[str] = []
        for path_index, module_id in enumerate(primary_path):
            module_id = require_id(module_id, f"primary_path[{path_index}]")
            normalized_primary_path.append(module_id)
            module = modules_by_id.get(module_id)
            if module is None:
                raise ValidationError(f"primary_path 指向不存在模块：{module_id}")
            if module.get("inactive", False):
                raise ValidationError(f"primary_path 不能包含未激活模块：{module_id}")
        if len(set(normalized_primary_path)) != len(normalized_primary_path):
            raise ValidationError("primary_path 不能重复经过同一模块")
        for source_id, target_id in zip(normalized_primary_path, normalized_primary_path[1:]):
            if not any(edge.get("to") == target_id for edge in modules_by_id[source_id].get("edges", [])):
                raise ValidationError(f"primary_path 缺少真实有向边：{source_id} -> {target_id}")

    function_ids: set[str] = set()
    for index, raw_function in enumerate(functions):
        where = f"functions[{index}]"
        function = require_dict(raw_function, where)
        function_id = require_id(function.get("id"), f"{where}.id")
        if function_id in function_ids:
            raise ValidationError(f"函数 ID 重复：{function_id}")
        function_ids.add(function_id)
        require_text(function.get("name"), f"{where}.name")
        require_quality_text(function.get("summary"), f"{where}.summary", 10)
        module_id = require_id(function.get("module_id"), f"{where}.module_id")
        if module_id not in module_ids:
            raise ValidationError(f"{where}.module_id 指向不存在的模块：{module_id}")
        start = require_line(function.get("start"), f"{where}.start", line_count)
        end = require_line(function.get("end"), f"{where}.end", line_count)
        if start > end:
            raise ValidationError(f"{where} 开始行不能大于结束行")
        require_text_list(function.get("inputs", []), f"{where}.inputs")
        require_text_list(function.get("outputs", []), f"{where}.outputs")
        if not allow_unreviewed_draft:
            require_text_list(function.get("side_effects", []), f"{where}.side_effects")
            inventory_item = inventory_definitions.get(function_id)
            if not inventory_item:
                raise ValidationError(f"{where}.id={function_id!r} 不在冻结函数定义清单中")
            if (inventory_item["start"], inventory_item["end"]) != (start, end):
                raise ValidationError(f"{where} 范围与冻结函数清单不一致")
            review = require_dict(function.get("review"), f"{where}.review")
            if review.get("status") != "PASS":
                raise ValidationError(f"{where}.review.status 必须为 PASS")
            reviewer = require_text(review.get("reviewer"), f"{where}.review.reviewer")
            draft_author = require_text(review.get("draft_author"), f"{where}.review.draft_author")
            if reviewer == draft_author:
                raise ValidationError(f"{where}.reviewer 不能与 draft_author 相同")
            revision = review.get("revision")
            if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
                raise ValidationError(f"{where}.review.revision 必须是正整数")
            line_range = require_list(review.get("line_range"), f"{where}.review.line_range")
            if line_range != [start, end]:
                raise ValidationError(f"{where}.review.line_range 必须等于函数完整范围")
            for field in ("gaps", "overlaps", "unresolved", "required_changes"):
                values = require_list(review.get(field), f"{where}.review.{field}")
                if values:
                    raise ValidationError(f"{where}.review.{field} 在 PASS 时必须为空")

            line_notes = require_list(function.get("line_notes"), f"{where}.line_notes")
            expected_lines = list(range(start, end + 1))
            actual_lines: list[int] = []
            explanations: set[str] = set()
            for note_index, raw_note in enumerate(line_notes):
                note_where = f"{where}.line_notes[{note_index}]"
                note = require_dict(raw_note, note_where)
                line = require_line(note.get("line"), f"{note_where}.line", line_count)
                actual_lines.append(line)
                kind = require_text(note.get("kind"), f"{note_where}.kind")
                if kind not in LINE_NOTE_KINDS:
                    raise ValidationError(f"{note_where}.kind={kind!r} 不受支持")
                explanation = require_quality_text(note.get("explanation"), f"{note_where}.explanation", 6)
                normalized = normalized_text(explanation)
                if kind not in {"brace", "blank"} and normalized in explanations:
                    raise ValidationError(f"{note_where}.explanation 与本函数其他行重复")
                explanations.add(normalized)
                source_line = source_lines[line - 1]
                for field in ("reads", "writes"):
                    identifiers = require_text_list(note.get(field), f"{note_where}.{field}")
                    for identifier in identifiers:
                        if not re.search(rf"\b{re.escape(identifier)}\b", source_line):
                            raise ValidationError(
                                f"{note_where}.{field} 的 {identifier!r} 未在第 {line} 行出现"
                            )
            if actual_lines != expected_lines:
                raise ValidationError(f"{where}.line_notes 必须按顺序逐行覆盖 L{start}–L{end}")
        segments = require_list(function.get("segments"), f"{where}.segments")
        if not segments:
            raise ValidationError(f"{where}.segments 不能为空")
        cursor = start
        local_segment_ids: set[str] = set()
        local_segment_titles: set[str] = set()
        for segment_index, raw_segment in enumerate(segments):
            segment_where = f"{where}.segments[{segment_index}]"
            segment = require_dict(raw_segment, segment_where)
            segment_id = require_id(segment.get("id"), f"{segment_where}.id")
            if segment_id in local_segment_ids:
                raise ValidationError(f"函数 {function_id} 的语义块 ID 重复：{segment_id}")
            local_segment_ids.add(segment_id)
            segment_start = require_line(segment.get("start"), f"{segment_where}.start", line_count)
            segment_end = require_line(segment.get("end"), f"{segment_where}.end", line_count)
            if segment_start != cursor:
                raise ValidationError(
                    f"{segment_where} 应从第 {cursor} 行开始，实际为第 {segment_start} 行"
                )
            if segment_end < segment_start or segment_end > end:
                raise ValidationError(f"{segment_where} 行号范围无效")
            segment_line_count = segment_end - segment_start + 1
            if segment_line_count > MAX_SEGMENT_LINES:
                raise ValidationError(
                    f"{segment_where} 最多允许 {MAX_SEGMENT_LINES} 行，实际为 {segment_line_count} 行"
                )
            cursor = segment_end + 1
            title = require_quality_text(segment.get("title"), f"{segment_where}.title", 4)
            normalized_title = normalized_text(title)
            if normalized_title in local_segment_titles:
                raise ValidationError(f"{segment_where}.title 与本函数其他语义块重复")
            local_segment_titles.add(normalized_title)
            detail = require_quality_text(segment.get("detail"), f"{segment_where}.detail", 10)
            kind = require_text(segment.get("kind"), f"{segment_where}.kind")
            if kind not in SEGMENT_KINDS:
                raise ValidationError(f"{segment_where}.kind={kind!r} 不受支持")
            if not allow_unreviewed_draft:
                input_state = require_text_list(
                    segment.get("input_state"), f"{segment_where}.input_state", allow_empty=False
                )
                mechanism = require_quality_text(
                    segment.get("mechanism"), f"{segment_where}.mechanism", 12
                )
                output_state = require_text_list(
                    segment.get("output_state"), f"{segment_where}.output_state", allow_empty=False
                )
                why = require_quality_text(segment.get("why"), f"{segment_where}.why", 10)
                segment_source = "\n".join(source_lines[segment_start - 1:segment_end])
                source_identifiers = {
                    token for token in re.findall(r"\b[A-Za-z_][A-Za-z0-9_]*\b", segment_source)
                    if len(token) >= 3
                }
                combined = " ".join([title, detail, mechanism, why, *input_state, *output_state])
                if source_identifiers and not any(
                    re.search(rf"\b{re.escape(identifier)}\b", combined)
                    for identifier in source_identifiers
                ):
                    raise ValidationError(f"{segment_where} 的解释必须引用至少一个本段源码标识符")
            for call_index, raw_call in enumerate(require_list(segment.get("calls", []), f"{segment_where}.calls")):
                call_where = f"{segment_where}.calls[{call_index}]"
                call = require_dict(raw_call, call_where)
                require_text(call.get("name"), f"{call_where}.name")
                call_line = require_line(call.get("line"), f"{call_where}.line", line_count)
                if not segment_start <= call_line <= segment_end:
                    raise ValidationError(f"{call_where}.line 必须位于当前语义块内")
                source_line = source_lines[call_line - 1]
                call_name = call["name"]
                if not call_syntax_present(call_name, source_line):
                    raise ValidationError(f"{call_where}.name={call_name!r} 未在调用行以函数调用形式出现")
                call_type = require_text(call.get("type"), f"{call_where}.type")
                if call_type not in CALL_TYPES:
                    raise ValidationError(f"{call_where}.type={call_type!r} 不受支持")
        if cursor != end + 1:
            raise ValidationError(f"{where}.segments 只覆盖到第 {cursor - 1} 行，函数结束于第 {end} 行")

    if not allow_unreviewed_draft and set(function_ids) != set(inventory_definitions):
        missing = sorted(set(inventory_definitions) - set(function_ids))
        extra = sorted(set(function_ids) - set(inventory_definitions))
        raise ValidationError(f"冻结函数清单与 functions[] 不一致；缺失={missing}，多余={extra}")

    if not allow_unreviewed_draft:
        explained_module_ids = {item["module_id"] for item in functions}
        empty_active_modules = [
            item["id"] for item in modules
            if not item.get("inactive", False) and item["id"] not in explained_module_ids
        ]
        if empty_active_modules:
            raise ValidationError(
                "仍有活动 E2E 模块没有函数解释：" + ", ".join(empty_active_modules)
            )

    for function_index, raw_function in enumerate(functions):
        for segment_index, raw_segment in enumerate(raw_function.get("segments", [])):
            for call_index, raw_call in enumerate(raw_segment.get("calls", [])):
                if raw_call.get("type") == "internal":
                    where = (
                        f"functions[{function_index}].segments[{segment_index}]"
                        f".calls[{call_index}].target"
                    )
                    target = require_id(raw_call.get("target"), where)
                    if target not in function_ids:
                        raise ValidationError(f"{where} 指向不存在的函数：{target}")
                    target_function = next(item for item in functions if item["id"] == target)
                    if raw_call.get("name") != target_function.get("name"):
                        raise ValidationError(f"{where} 的调用名与目标函数名不一致")

    symbol_names: set[str] = set()
    for index, raw_symbol in enumerate(symbols):
        where = f"symbols[{index}]"
        symbol = require_dict(raw_symbol, where)
        name = require_text(symbol.get("name"), f"{where}.name")
        if name in symbol_names:
            raise ValidationError(f"符号重复：{name}")
        symbol_names.add(name)
        symbol_type = require_text(symbol.get("type"), f"{where}.type")
        if symbol_type not in SYMBOL_TYPES:
            raise ValidationError(f"{where}.type={symbol_type!r} 不受支持")
        require_text(symbol.get("description"), f"{where}.description")
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
            if not re.search(rf"\b{re.escape(name)}\b", source_text):
                raise ValidationError(f"{where}.name={name!r} 未在源码中找到完整标识符")

    for index, raw_entry in enumerate(root.get("glossary", [])):
        where = f"glossary[{index}]"
        entry = require_dict(raw_entry, where)
        require_text(entry.get("term"), f"{where}.term")
        require_text(entry.get("description"), f"{where}.description")

    validate_memory_model(
        root.get("memory_model"),
        modules_by_id=modules_by_id,
        functions_by_id={item["id"]: item for item in functions},
        source_lines=source_lines,
        line_count=line_count,
    )

    return root


def read_text(path: Path, label: str) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise ValidationError(f"{label}不存在：{path}") from exc
    except UnicodeDecodeError as exc:
        raise ValidationError(f"{label}不是 UTF-8 文本：{path}") from exc


def render(
    source_path: Path,
    source_text: str,
    analysis: dict[str, Any],
    *,
    draft_mode: bool = False,
    source_label: str | None = None,
) -> str:
    template = read_text(ASSET_ROOT / "template.html", "HTML 模板")
    styles = read_text(ASSET_ROOT / "styles.css", "样式文件")
    runtime = read_text(ASSET_ROOT / "runtime.js", "运行脚本")
    payload = {
        "sourceName": source_path.name,
        "sourcePath": source_label or str(source_path.resolve()),
        "lines": source_text.splitlines(),
        "analysis": analysis,
        "draftMode": draft_mode,
    }
    payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    payload_json = payload_json.replace("</", "<\\/").replace("<!--", "<\\!--")
    replacements = {
        "__DOCUMENT_TITLE__": html.escape(analysis["title"]),
        "__INLINE_STYLES__": styles,
        "__WALKTHROUGH_DATA__": payload_json,
        "__INLINE_RUNTIME__": runtime,
    }
    for marker, value in replacements.items():
        if marker not in template:
            raise ValidationError(f"HTML 模板缺少占位符：{marker}")
        template = template.replace(marker, value)
    return template


def main() -> int:
    args = parse_args()
    try:
        source_text = read_text(args.source, "源码文件")
        lines = source_text.splitlines()
        if not lines:
            raise ValidationError("源码文件为空")
        analysis_text = read_text(args.analysis, "分析 JSON")
        try:
            raw_analysis = json.loads(analysis_text)
        except json.JSONDecodeError as exc:
            raise ValidationError(f"分析 JSON 格式错误：第 {exc.lineno} 行第 {exc.colno} 列") from exc
        analysis = validate_analysis(
            raw_analysis,
            source_text,
            len(lines),
            allow_unreviewed_draft=args.allow_unreviewed_draft,
        )
        segment_count = sum(len(item["segments"]) for item in analysis["functions"])
        memory_model = analysis.get("memory_model")
        memory_summary = ""
        if memory_model:
            memory_summary = (
                f"，{len(memory_model['spaces'])} 类内存空间，"
                f"{len(memory_model['allocations'])} 个大块申请/资源预算，"
                f"{len(memory_model['regions'])} 个内存区域，"
                f"{len(memory_model['transfers'])} 条搬运/同步边，"
                f"{len(memory_model['paths'])} 条内存关键路径"
            )
        if args.validate_only:
            mode = "草稿结构校验" if args.allow_unreviewed_draft else "严格复查校验"
            print(
                f"{mode}通过：{len(lines)} 行源码，{len(analysis['modules'])} 个模块，"
                f"{len(analysis['functions'])} 个函数，{segment_count} 个语义块{memory_summary}。"
            )
            return 0
        output = args.output.resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            render(
                args.source,
                source_text,
                analysis,
                draft_mode=args.allow_unreviewed_draft,
                source_label=args.source_label,
            ),
            encoding="utf-8",
        )
        mode = "未复查草稿" if args.allow_unreviewed_draft else "严格复查正式页"
        print(
            f"生成完成（{mode}）：{output}\n"
            f"覆盖 {len(lines)} 行源码，{len(analysis['modules'])} 个模块，"
            f"{len(analysis['functions'])} 个函数，{segment_count} 个语义块{memory_summary}。"
        )
        return 0
    except ValidationError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
