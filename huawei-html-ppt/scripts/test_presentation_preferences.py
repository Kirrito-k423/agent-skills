"""验证两种风格均读取图表、写作和结论标签规则。"""
from pathlib import Path
import copy
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
                                 'conclusion.ribbon@2', 'chart.simple@3',
                                 'experiment.figure-config@1'} <= refs, refs)

    def test_both_conclusion_labels_are_white_on_red(self):
        css = (Path(__file__).resolve().parents[1] / 'assets/two-style/style.css').read_text(encoding='utf-8')
        for selector in (r'\.feature-conclusion>strong', r'\.insight-conclusion \.conclusion-label'):
            match = re.search(selector + r'\{([^}]+)\}', css)
            self.assertIsNotNone(match)
            for expected in ('background:var(--brand)', 'color:#fff', 'justify-content:center', 'align-items:center'):
                self.assertIn(expected, match.group(1))
            declarations = dict(item.split(':', 1) for item in match.group(1).split(';') if ':' in item)
            self.assertEqual(declarations['width'], declarations['height'])
            self.assertEqual(declarations['flex-direction'], 'column')

    def test_config_is_validated_and_rendered_for_both_styles(self):
        cfg = {'model': '<模型>', 'hardware': '设备 × 1', 'parallel': 'TP1', 'kv_hbm': '8 GiB/卡（固定）'}
        for style in ('technical-project', 'insight-analysis'):
            s = {'title': '合成实验', 'conclusion': '结论',
                 'panels': [{'title': '实验结果', 'blocks': [{'type': 'text', 'text': '测试'}]}],
                 'experiment_config': cfg}
            if style == 'technical-project':
                s['header_mode'] = 'conclusion'
            request = {'deck': {'title': '合成', 'style': style, 'slides': [s]}, 'include_frontmatter': False}
            deck = ppt.resolved_deck(request, ppt.plan(request))
            self.assertTrue(ppt.validate(deck)['ok'], ppt.validate(deck))
            for invalid in (None, {}, dict(cfg, model=''), dict(cfg, parallel=2), dict(cfg, scope='')):
                broken = copy.deepcopy(deck)
                broken['slides'][0]['experiment_config'] = invalid
                self.assertFalse(ppt.validate(broken)['ok'], invalid)
            with tempfile.TemporaryDirectory() as directory:
                html = Path(ppt.render(request, directory)['html']).read_text(encoding='utf-8')
                visible = html.split('<script type="application/json"')[0]
                self.assertIn('<span>分析</span><span>结论</span>', visible)
                self.assertIn('模型：&lt;模型&gt;', visible)
                self.assertIn('设备：设备 × 1', visible)
                self.assertIn('KV HBM：8 GiB/卡（固定）', visible)


if __name__ == '__main__':
    unittest.main()
