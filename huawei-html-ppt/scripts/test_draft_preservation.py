"""草稿逐页保留合同的离线回归测试。"""
import copy
import unittest

import ppt


class DraftPreservationTest(unittest.TestCase):
    def setUp(self):
        self.deck = {
            'slides': [
                {'title': 'E3-Q1', 'panels': [{'blocks': [
                    {'type': 'image', 'path': '/tmp/target.png'}]}]},
                {'title': 'E3-Q2', 'panels': [{'blocks': [
                    {'type': 'image', 'path': '/tmp/result.png'}]}]},
            ],
            'closing': {'title': 'Thank you'},
            'source_draft': {
                'slide_count': 3,
                'preserve_pages': True,
                'page_map': [{'source_page': 1, 'output_page': 1},
                             {'source_page': 2, 'output_page': 2},
                             {'source_page': 3, 'output_page': 3}],
                'required_figures': ['target.png', 'result.png'],
                'required_identifiers': ['E3-Q1', 'E3-Q2'],
            },
        }

    def test完整覆盖(self):
        self.assertEqual(ppt.validate_source_draft(self.deck), [])

    def test缺少页或重复映射(self):
        deck = copy.deepcopy(self.deck)
        deck['source_draft']['page_map'][1]['output_page'] = 1
        self.assertTrue(any('不同的有效交付页' in e for e in ppt.validate_source_draft(deck)))
        deck['source_draft']['page_map'].pop()
        self.assertTrue(any('全部页码' in e for e in ppt.validate_source_draft(deck)))

    def test页数不足(self):
        deck = copy.deepcopy(self.deck)
        deck.pop('closing')
        self.assertTrue(any('少于原稿' in e for e in ppt.validate_source_draft(deck)))

    def test缺少图与问题(self):
        deck = copy.deepcopy(self.deck)
        deck['source_draft']['required_figures'].append('absent.png')
        deck['source_draft']['required_identifiers'].append('E3-Q3')
        errors = ppt.validate_source_draft(deck)
        self.assertTrue(any('absent.png' in e for e in errors))
        self.assertTrue(any('E3-Q3' in e for e in errors))

    def test用户授权精简(self):
        deck = copy.deepcopy(self.deck)
        deck.pop('closing')
        deck['source_draft']['preserve_pages'] = False
        deck['source_draft'].pop('page_map')
        self.assertEqual(ppt.validate_source_draft(deck), [])


if __name__ == '__main__':
    unittest.main()
