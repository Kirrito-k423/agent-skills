"""验证两种风格均读取图表、写作和结论标签规则。"""
from pathlib import Path
import re
import tempfile
import unittest

import ppt


class PresentationPreferenceTests(unittest.TestCase):
    def test_both_styles_load_visual_and_writing_rules(self):
        with tempfile.TemporaryDirectory() as directory:
            for style in ('technical-project', 'insight-analysis'):
                plan = ppt.plan({'text': '技术汇报', 'style': style, 'state_dir': directory})
                refs = set(plan['unit_refs'])
                self.assertTrue({'language.plain@2', 'diagram.fidelity@2',
                                 'conclusion.ribbon@1', 'chart.simple@3'} <= refs, refs)

    def test_both_conclusion_labels_are_white_on_red(self):
        css = (Path(__file__).resolve().parents[1] / 'assets/two-style/style.css').read_text(encoding='utf-8')
        for selector in (r'\.feature-conclusion>strong', r'\.insight-conclusion \.conclusion-label'):
            match = re.search(selector + r'\{([^}]+)\}', css)
            self.assertIsNotNone(match)
            for expected in ('background:var(--brand)', 'color:#fff', 'justify-content:center', 'align-items:center'):
                self.assertIn(expected, match.group(1))


if __name__ == '__main__':
    unittest.main()
