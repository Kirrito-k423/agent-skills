"""草稿逐页保留合同的离线回归测试。"""
import copy
from io import BytesIO
import unittest
from zipfile import ZipFile

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

    def test读取可见性使用演示文稿页序(self):
        stream = BytesIO()
        with ZipFile(stream, 'w') as package:
            package.writestr('ppt/presentation.xml',
                '<p:presentation xmlns:p="http://purl.oclc.org/ooxml/presentationml/main" '
                'xmlns:r="http://purl.oclc.org/ooxml/officeDocument/relationships"><p:sldIdLst>'
                + ''.join(f'<p:sldId id="{300+i}" r:id="r{i}"/>' for i in (3, 1, 5, 2, 4))
                + '</p:sldIdLst></p:presentation>')
            package.writestr('ppt/_rels/presentation.xml.rels', '<Relationships>'
                + ''.join(f'<Relationship Id="r{i}" Target="slides/slide{i}.xml"/>' for i in range(1, 6))
                + '</Relationships>')
            for i, flag in enumerate((' show="0"', ' show="false"', '', ' show="true"', ' show="1"'), 1):
                package.writestr(f'ppt/slides/slide{i}.xml', f'<sld{flag}/>')
            package.writestr('ppt/slides/slide99.xml', '<sld/>')
        self.assertEqual(ppt.inspect_source_draft(stream),
                         {'slide_count': 5, 'visible_pages': [1, 3, 5], 'hidden_pages': [2, 4]})

    def test隐藏页跳过且可见页保留原号(self):
        draft = self.deck['source_draft']
        draft.update(slide_count=5, hidden_pages=[2, 4])
        draft['page_map'] = [dict(source_page=p, output_page=i) for i, p in enumerate((1, 3, 5), 1)]
        self.assertEqual(ppt.validate_source_draft(self.deck), [])
        draft['page_map'][1]['source_page'] = 2
        self.assertTrue(ppt.validate_source_draft(self.deck))

    def test全部隐藏时映射为空(self):
        self.deck['source_draft'].update(hidden_pages=[1, 2, 3], page_map=[])
        self.assertEqual(ppt.validate_source_draft(self.deck), [])

    def test隐藏页必须为合法原页码(self):
        for invalid in (None, 1, [True], [0], [4], [1, 1], [{}]):
            with self.subTest(invalid=invalid):
                self.deck['source_draft']['hidden_pages'] = invalid
                self.assertTrue(any('hidden_pages' in e for e in ppt.validate_source_draft(self.deck)))

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
