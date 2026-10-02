"""Package only this local delivery after all validation gates pass."""
from pathlib import Path
import json
import subprocess
import zipfile

BASE = Path(__file__).resolve().parent
subprocess.run(["python3", str(BASE / "validate_handoff.py")], check=True)
summary = json.loads((BASE / "validation-summary.json").read_text())
assert summary["status"] == "PASS"
source = BASE / "DeepEP-Ascend"
files = {p for p in source.rglob("*") if p.is_file() and ".git" not in p.parts and "__pycache__" not in p.parts}
for folder in ["animation", "walkthrough", "review"]:
    files.update(p for p in (BASE / folder).rglob("*") if p.is_file() and "__pycache__" not in p.parts)
files.update(p for p in BASE.iterdir() if p.is_file() and p.suffix in {".html", ".md", ".json", ".png", ".py", ".cjs"})
files.update(p for p in (BASE / "numeric-before").iterdir() if p.suffix in {".json", ".png"})
files.update(p for p in (BASE / "terminology-before").iterdir() if p.suffix in {".json", ".png"})
files = {p for p in files if p.is_file() and p.name != "package-report.json"}
output = BASE / "dispatch-analysis.zip"
with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for p in sorted(files):
        z.write(p, p.relative_to(BASE).as_posix())
with zipfile.ZipFile(output) as z:
    assert z.testzip() is None
    names = set(z.namelist())
    assert not any("/.git/" in name or name.endswith(".zip") for name in names)
    required = {"index.html", "serve.py", "animation/provenance.mjs", "animation/numeric-ui.mjs", "animation/terminology.mjs", "animation/terminology-source-extra.mjs", "animation/terminology-source-evidence.mjs", "animation/source.mjs", "review/numeric-review.json", "review/terminology-review.json", "root-numeric-ui.json", "root-numeric-object-ui.json", "root-terminology-ui.json"}
    assert required <= names
    for name in ["app.mjs", "model.mjs", "sync.mjs", "sources.json", "style.css"]:
        assert "animation/" + name in names
    for name in ["animation/control.html", "animation/visual.html"]:
        assert z.read(name) == (BASE / name).read_bytes()
report = {"status": "PASS", "files": len(names), "zip_bytes": output.stat().st_size, "numeric_review": summary["animation"]["numeric_provenance"]["independent_review"], "terminology_review": summary["animation"]["terminology"]["independent_review"], "checked_required_files": sorted(required)}
(BASE / "package-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(report, ensure_ascii=False))
