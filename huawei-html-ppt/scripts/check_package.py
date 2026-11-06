"""Check portable core size, forbidden bundles and local Markdown links."""
from pathlib import Path
import json
import re
import hashlib

ROOT = Path(__file__).resolve().parents[1]


def check():
    files = [p for p in ROOT.rglob('*') if p.is_file()]
    manifest = ROOT/'assets/templates/default.json'
    approved = {}
    if manifest.exists():
        spec = json.loads(manifest.read_text(encoding='utf-8'))
        template = ROOT/'assets/templates'/spec['file']
        if (template.is_file() and template.suffix.lower() == '.pptx'
                and template.stat().st_size <= 4*1024*1024
                and hashlib.sha256(template.read_bytes()).hexdigest() == spec['sha256']):
            approved[template] = template.stat().st_size
    bad = [str(p.relative_to(ROOT)) for p in files if 'node_modules' in p.parts or '__pycache__' in p.parts
           or (p.suffix.lower() in ('.pptx', '.ppt', '.pdf', '.zip', '.pyc') and p not in approved)]
    missing = []
    for p in ROOT.rglob('*.md'):
        for target in re.findall(r'\]\(([^)]+)\)', p.read_text(encoding='utf-8')):
            if '://' in target or target.startswith('#'): continue
            target = target.split('#', 1)[0]
            if target and not (p.parent / target).exists(): missing.append({'file': str(p.relative_to(ROOT)), 'target': target})
    size = sum(p.stat().st_size for p in files)
    core_size = size - sum(approved.values())
    return {'ok': not bad and not missing and core_size < 1024*1024, 'files': len(files), 'bytes': size,
            'core_bytes': core_size, 'approved_template_bytes': sum(approved.values()),
            'forbidden_bundles': bad, 'missing_links': missing, 'size_budget_bytes': 1024*1024}


if __name__ == '__main__':
    result = check(); print(json.dumps(result, ensure_ascii=False, indent=2)); raise SystemExit(not result['ok'])
