"""Check that delivered pages retain the independently reviewed content."""
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

BASE = Path(__file__).resolve().parent


def read(name):
    return json.loads((BASE / name).read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


manifest = read("source-manifest.json")
ledger = read("review/functions-final-ledger.json")
assert ledger["status"] == "PASS"
assert set(ledger["expected_definition_ids"]) == set(ledger["valid_pass_function_ids"])
assert len(set(ledger["valid_pass_function_ids"])) == 14
frozen = {}
for fragment in ["dispatch-worker", "dispatch-issue", "epilogue-main", "helpers"]:
    for fn in read(f"review/{fragment}.reviewed.json")["functions"]:
        assert fn["id"] not in frozen
        frozen[fn["id"]] = fn
memories = read("review/memory-models.reviewed.json")
files = []
for source in manifest["files"]:
    name = Path(source["relative_path"]).stem
    source_path = BASE / "DeepEP-Ascend" / source["relative_path"]
    assert sha(source_path) == source["sha256"]
    assert source["syntax"] == source["text"]
    analysis_path = BASE / "walkthrough" / f"{name}.analysis.json"
    html_path = BASE / "walkthrough" / f"{name}.walkthrough.html"
    analysis = json.loads(analysis_path.read_text())
    assert analysis["source_revision"] == manifest["revision"]
    assert analysis["review_summary"]["status"] == "PASS"
    assert len(analysis["functions"]) == len(source["functions"])
    assert sorted((f["name"], f["start"], f["end"]) for f in analysis["functions"]) == sorted((f["name"], f["start"], f["end"]) for f in source["functions"])
    for fn in analysis["functions"]:
        assert fn == frozen[fn["id"]], f"changed reviewed function: {fn['id']}"
        assert fn["review"]["status"] == "PASS"
        assert fn["review"]["source_sha256"] == source["sha256"]
        assert fn["review"]["draft_author"] != fn["review"]["reviewer"]
        assert sorted(n["line"] for n in fn["line_notes"]) == list(range(fn["start"], fn["end"] + 1))
    memory = analysis["memory_model"]
    assert memory == memories[name], f"changed reviewed memory model: {name}"
    assert memory["review"]["status"] == "PASS"
    match = re.search(r'<script id="walkthrough-data" type="application/json">([\s\S]*?)</script>', html_path.read_text())
    assert match, "missing inline payload"
    payload = json.loads(match.group(1))
    assert payload["analysis"] == analysis
    assert payload["draftMode"] is False
    assert payload["lines"] == source_path.read_text().splitlines()
    files.append({
        "name": name,
        "source_sha256": source["sha256"],
        "line_count": source["line_count"],
        "modules": len(analysis["modules"]),
        "functions": len(analysis["functions"]),
        "segments": sum(len(f["segments"]) for f in analysis["functions"]),
        "memory_spaces": len(memory["spaces"]),
        "memory_regions": len(memory["regions"]),
        "memory_transfers": len(memory["transfers"]),
        "memory_paths": len(memory["paths"]),
        "memory_allocations": len(memory["allocations"]),
        "analysis_sha256": sha(analysis_path),
        "html_sha256": sha(html_path),
        "reviewed_content_unchanged": True,
    })
animation_review = read("review/animation-review.json")
assert animation_review["status"] == "PASS"
assert sha(BASE / "animation/model.mjs") == animation_review["model_sha256"]
assert len(animation_review["presets"]) == 9
assert all(p["oracle"] == "PASS" and not p["issues"] for p in animation_review["presets"])
numeric_review = read("review/numeric-review.json")
assert numeric_review["status"] == "PASS", "numeric provenance has not passed independent review"
assert not numeric_review["gaps"] and not numeric_review["required_changes"]
assert numeric_review["source_commit"] == manifest["revision"]
assert numeric_review["model_sha256"] == sha(BASE / "animation/model.mjs")
assert numeric_review["provenance_sha256"] == sha(BASE / "animation/provenance.mjs")
numeric_ui = read("root-numeric-ui.json")
assert numeric_ui["status"] == "PASS" and not numeric_ui["errors"]
numeric_object_ui = read("root-numeric-object-ui.json")
assert numeric_object_ui["status"] == "PASS" and not numeric_object_ui["errors"]
for ui in [numeric_ui, numeric_object_ui]:
    for filename, digest in ui["deliveredHashes"].items():
        assert sha(BASE / "animation" / filename) == digest, f"numeric UI evidence is stale: {filename}"
numeric_browser = read("animation/numeric-browser-results.json")
assert not numeric_browser["errors"]
assert numeric_browser["queries"] > 0 and numeric_browser["checks"] > 0
for filename, digest in numeric_browser["hashes"].items():
    assert sha(BASE / "animation" / filename) == digest, f"author numeric browser evidence is stale: {filename}"
numeric_model_test = read("animation/numeric-test-results.json")
for filename, digest in numeric_model_test["hashes"].items():
    assert sha(BASE / "animation" / filename) == digest, f"author numeric model evidence is stale: {filename}"
terminology_review = read("review/terminology-review.json")
assert terminology_review["status"] == "PASS", "terminology has not passed independent review"
assert not terminology_review["gaps"] and not terminology_review["required_changes"]
assert terminology_review["source_commit"] == manifest["revision"]
for filename, digest in terminology_review["hashes"].items():
    assert sha(BASE / "animation" / filename) == digest, f"independent terminology review is stale: {filename}"
terminology_ui = read("root-terminology-ui.json")
assert terminology_ui["status"] == "PASS" and not terminology_ui["errors"]
for filename, digest in terminology_ui["deliveredHashes"].items():
    assert sha(BASE / "animation" / filename) == digest, f"root terminology UI evidence is stale: {filename}"
terminology_browser = read("animation/terminology-browser-results.json")
terminology_coverage = read("animation/terminology-coverage.json")
assert terminology_browser["status"] == "PASS" and not terminology_browser["errors"]
assert terminology_coverage["status"] == "PASS" and not terminology_coverage["gaps"]
for evidence in [terminology_browser, terminology_coverage]:
    for filename, digest in evidence["hashes"].items():
        assert sha(BASE / "animation" / filename) == digest, f"author terminology evidence is stale: {filename}"
assert len(terminology_coverage["sourceFiles"]) == 9
assert terminology_coverage["sourceLines"] == 3732
assert terminology_coverage["sourceBindings"] > 0
animation_sources = read("animation/sources.json")
assert animation_sources["commit"] == manifest["revision"]
assert len(animation_sources["files"]) == 9
assert sum(len(lines) for lines in animation_sources["files"].values()) == 3732
for filename, lines in animation_sources["files"].items():
    assert (BASE / "DeepEP-Ascend" / filename).read_text().splitlines() == lines, f"changed frozen context source: {filename}"
assert sha(BASE / "animation/model.mjs") == "567fc1e82f4c91dd09c481a05d7eee2b6ea850e6f155a541c1a3f1c95b633197"
assert sha(BASE / "animation/provenance.mjs") == "6ac9d0f9ad90d2666d7d3d2ee639c570292ba0b9429a4b337d5d23e4f55befa8"
browser = read("animation/browser-results.json")
assert not browser["errors"] and not browser["failures"]
root_animation = read("root-animation-ui.json")
root_walkthrough = read("root-walkthrough-ui.json")
assert root_walkthrough["status"] == "PASS" and not root_walkthrough["errors"]
model_test = (BASE / "animation/model-test-results.txt").read_text()
assert "assertions PASS" in model_test
assert model_test.count("PASS ") >= 9
assert (BASE / "index.html").is_file() and (BASE / "serve.py").is_file()
result = {
    "status": "PASS",
    "checked_at_utc": datetime.now(timezone.utc).isoformat(),
    "source_revision": manifest["revision"],
    "deep_jit_gitlink": manifest["deep_jit_revision"],
    "walkthrough": {
        "full_source_lines": sum(f["line_count"] for f in files),
        "unique_function_definitions": 14,
        "independent_pass_functions": 14,
        "includes_lambdas": 2,
        "total_modules": sum(f["modules"] for f in files),
        "total_segments": sum(f["segments"] for f in files),
        "independent_pass_memory_models": 2,
        "files": files,
        "ui_evidence": "root-walkthrough-ui.json",
    },
    "animation": {
        "model_sha256": animation_review["model_sha256"],
        "independent_oracle_presets": 9,
        "model_test_output": model_test.splitlines(),
        "browser_combinations": browser["combinations"],
        "browser_errors": browser["errors"],
        "browser_failures": browser["failures"],
        "browser_viewports": browser["viewports"],
        "root_independent_ui_evidence": "root-animation-ui.json",
        "review_evidence": "review/animation-review.json",
        "numeric_provenance": {
            "independent_review": numeric_review["status"],
            "review_evidence": "review/numeric-review.json",
            "provenance_sha256": numeric_review["provenance_sha256"],
            "root_ui_evidence": "root-numeric-ui.json",
            "root_ui_checks": numeric_ui["checks"],
            "root_object_ui_evidence": "root-numeric-object-ui.json",
            "root_object_ui_checks": numeric_object_ui["checks"],
            "independent_coverage": numeric_review["coverage"],
            "author_browser_evidence": "animation/numeric-browser-results.json",
            "author_visible_queries": numeric_browser["queries"],
            "author_browser_checks": numeric_browser["checks"],
            "author_numeric_test_evidence": "animation/numeric-test-results.json",
            "author_numeric_queries": numeric_model_test["queries"],
            "delivered_hashes": numeric_ui["deliveredHashes"],
            "skill_commit": "045c6678b5332b8399b63232b8536f17386da687",
            "before_evidence": "numeric-before/browser-reproduction.json",
        },
        "terminology": {
            "independent_review": terminology_review["status"],
            "review_evidence": "review/terminology-review.json",
            "independent_coverage": terminology_review["coverage"],
            "root_ui_evidence": "root-terminology-ui.json",
            "root_ui_checks": terminology_ui["checks"],
            "root_ui_samples": len(terminology_ui["samples"]),
            "author_browser_evidence": "animation/terminology-browser-results.json",
            "author_browser_checks": terminology_browser["checks"],
            "author_browser_coverage": terminology_browser["coverage"],
            "author_coverage_evidence": "animation/terminology-coverage.json",
            "delivered_hashes": terminology_review["hashes"],
            "skill_commit": "eb2740498eafa9dc92115f1ba4d39e154e92fa89",
            "before_evidence": "terminology-before/browser-reproduction.json",
            "unresolved_source_identifiers": 0,
            "original_model_and_numeric_provenance_unchanged": True,
        },
    },
    "conditional_paths": [
        "fresh and cached routing / slot metadata",
        "BF16 and FP8 packed scale-factor metadata",
        "optional weights and valid -1 routing sentinel",
        "rank deduplication, local copy, remote write, SQ NOP and final WRITE completion",
        "zero-input and empty ranks/AIVs, raw and aligned expert prefix counts",
        "epilogue drain/barrier, expanded slots and optional padding initialization",
    ],
    "evidence_boundary": {
        "source_inspection": True,
        "cpu_teaching_model": True,
        "browser_interactions": True,
        "cann_compile": False,
        "multi_rank_npu_precision": False,
        "hardware_trace_or_performance": False,
    },
    "token_usage": "Unavailable; no cost or token savings claim",
}
(BASE / "validation-summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"status": result["status"], "lines": result["walkthrough"]["full_source_lines"], "functions": 14, "segments": result["walkthrough"]["total_segments"], "animation_combinations": browser["combinations"]}, ensure_ascii=False))
