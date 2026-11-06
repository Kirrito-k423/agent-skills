"""验证完整汇报的封面、目录和正文，全部使用合成材料。"""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import ppt
import report_frontmatter


def sample(style='technical-project', count=2):
    slide = {'title': '合成机制', 'header_mode': 'conclusion', 'conclusion': ['机制和边界'],
             'panels': [{'title': '示意', 'blocks': [{'type': 'text', 'text': '仅用于测试'}]}]}
    return {'title': '合成技术汇报', 'style': style,
            'slides': [dict(copy.deepcopy(slide), title=f'合成内容{i+1}') for i in range(count)]}


class CompleteReportTests(unittest.TestCase):
    def test_default_keeps_content_and_adds_two_pages(self):
        for style in ['technical-project', 'insight-analysis']:
            original = sample(style)
            request = {'style': style, 'deck': original}
            deck = ppt.resolved_deck(request, ppt.plan(request))
            self.assertEqual(len(deck['slides']), 4)
            self.assertEqual([s['role'] for s in deck['slides'][:2]], ['cover', 'agenda'])
            self.assertEqual(deck['slides'][2]['title'], original['slides'][0]['title'])
            self.assertNotIn('layout', original['slides'][0])
            self.assertTrue(ppt.validate(deck)['ok'])
            self.assertEqual(deck['slides'][1]['chapters'][0]['start_page'], 3)

    def test_fragments_single_page_and_idempotence(self):
        request = {'deck': sample(), 'include_frontmatter': False}
        self.assertEqual(len(ppt.resolved_deck(request, ppt.plan(request))['slides']), 2)
        request = {'deck': sample(count=1)}
        self.assertEqual(len(ppt.resolved_deck(request, ppt.plan(request))['slides']), 1)
        deck = report_frontmatter.assemble(sample())
        self.assertEqual(report_frontmatter.assemble(deck), deck)

    def test_ranges_cover_all_content(self):
        chapters = [{'title': '机制', 'start_content': 1, 'end_content': 2},
                    {'title': '验证', 'start_content': 3, 'end_content': 10}]
        deck = report_frontmatter.assemble(sample(count=10), {'chapters': chapters})
        self.assertEqual(deck['slides'][1]['chapters'][-1]['end_page'], 13)
        self.assertEqual(len(deck['slides']), 13)
        self.assertEqual(deck['slides'][4]['active_chapter'], 2)
        self.assertFalse(report_frontmatter.validate_structure(deck))
        for bad in [chapters[:1], [dict(chapters[0], start_content=2), chapters[1]],
                    [chapters[0], dict(chapters[1], end_content=11)]]:
            with self.assertRaises(ValueError):
                report_frontmatter.assemble(sample(count=10), {'chapters': bad})
        with self.assertRaises(ValueError):
            report_frontmatter.assemble(sample(count=10))

    def test_chapter_navigation_states_and_ranges(self):
        chapters = [{'title': '机制', 'start_content': 1, 'end_content': 2},
                    {'title': '验证', 'start_content': 3, 'end_content': 4},
                    {'title': '计划', 'start_content': 5, 'end_content': 5}]
        for style in ['technical-project', 'insight-analysis']:
            deck = report_frontmatter.assemble(sample(style, 5), {'chapters': chapters})
            agendas = [(i+1, s) for i, s in enumerate(deck['slides']) if s.get('role') == 'agenda']
            self.assertEqual([i for i, s in agendas], [2, 5, 8])
            self.assertEqual([s['active_chapter'] for i, s in agendas], [1, 2, 3])
            self.assertEqual([(c['start_page'], c['end_page']) for c in agendas[0][1]['chapters']], [(3, 4), (6, 7), (9, 9)])
            self.assertFalse(report_frontmatter.validate_structure(deck))
            rendered = report_frontmatter.render_frontmatter(agendas[1][1], deck, 5, '')
            self.assertEqual(rendered.count('agenda-completed'), 1)
            self.assertEqual(rendered.count('agenda-current'), 1)
            self.assertEqual(rendered.count('agenda-upcoming'), 1)
            corrupted = copy.deepcopy(deck)
            corrupted['slides'][4]['active_chapter'] = 1
            self.assertTrue(report_frontmatter.validate_structure(corrupted))
            corrupted = copy.deepcopy(deck)
            corrupted['slides'][4]['chapters'][0]['end_page'] = 99
            self.assertTrue(report_frontmatter.validate_structure(corrupted))
        one_agenda = report_frontmatter.assemble(sample(count=5), {'chapters': chapters, 'repeat_agenda': False})
        self.assertEqual(len(one_agenda['slides']), 7)
        self.assertFalse(report_frontmatter.validate_structure(one_agenda))

    def test_render_and_escape(self):
        with tempfile.TemporaryDirectory() as tmp:
            request = {'deck': sample(), 'frontmatter': {'title': '<合成>\n技术汇报'}}
            result = ppt.render(request, tmp)
            content = Path(result['html']).read_text()
            visible = content.split('<script type="application/json"')[0]
            self.assertEqual(visible.count('<article class="slide '), 4)
            self.assertIn('&lt;合成&gt;<br>技术汇报', visible)
            self.assertIn('P3', visible)
            self.assertIn('04 / 04', visible)
            deck = json.loads((Path(tmp) / 'deck-model.json').read_text())
            self.assertTrue(ppt.validate(deck)['ok'])
            deck['slides'][1]['chapters'][0]['start_page'] = 4
            self.assertFalse(ppt.validate(deck)['ok'])


if __name__ == '__main__':
    unittest.main()
