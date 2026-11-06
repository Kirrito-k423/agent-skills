"""验证已授权默认模板的原生复用、字段填充与包结构。"""
from pathlib import Path
import json
import copy
import sys
import tempfile
import unittest
import xml.etree.ElementTree as E
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pptx_template_bookends as bookends

class TemplateBookendTests(unittest.TestCase):
    def test_replacement_keeps_target_layout(self):
        template = bookends.ROOT/'assets/templates/huawei-light-16-9.pptx'
        fragment = bookends.read_package(template)
        first = bookends.ordered_slides(fragment)[0]
        root = E.fromstring(fragment[first]);tree = root.find('p:cSld/p:spTree', bookends.NS)
        concrete = next(shape for shape in tree if 'Security Level:' in ''.join(shape.itertext()))
        concrete = copy.deepcopy(concrete)
        next(concrete.iter('{'+bookends.NS['a']+'}t')).text = '替换后的合成正文'
        for node in list(tree)[2:]:tree.remove(node)
        tree.append(concrete);fragment[first] = bookends.xml(root)
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder)/'fragment.pptx'
            import zipfile
            with zipfile.ZipFile(source,'w',compression=zipfile.ZIP_DEFLATED) as package:
                for name,value in fragment.items():package.writestr(name,value)
            output = Path(folder)/'result.pptx'
            bookends.apply_bookends(template,template,output,'合成题目','合成作者','2026-01-01',replacements={2:source})
            result = bookends.read_package(output);second = bookends.ordered_slides(result)[1]
            self.assertIn('替换后的合成正文',''.join(E.fromstring(result[second]).itertext()))
            original_relations = E.fromstring(bookends.read_package(template)[bookends.rel_name(second)])
            updated_relations = E.fromstring(result[bookends.rel_name(second)])
            def layout(relations):return next(r.get('Target') for r in relations if r.get('Type','').endswith('/slideLayout'))
            self.assertEqual(layout(original_relations),layout(updated_relations))

    def test_native_dependencies_and_confirmed_fields(self):
        template = bookends.ROOT/'assets/templates/huawei-light-16-9.pptx'
        original = bookends.read_package(template)
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)/'report.pptx'
            receipt = bookends.apply_bookends(template, template, output, '合成题目', '合成作者', '2026-01-01')
            parts = bookends.read_package(output)
            slides = bookends.ordered_slides(parts)
            self.assertEqual(len(slides), 6)
            self.assertTrue(all(part.startswith('ppt/slides/') for part in slides))
            identifiers = [node.get('id') for node in E.fromstring(parts['ppt/presentation.xml']).findall('.//p:sldMasterId', bookends.NS)]
            for name, value in parts.items():
                if '/slideMasters/' in name and name.endswith('.xml'):
                    identifiers.extend(node.get('id') for node in E.fromstring(value).findall('.//p:sldLayoutId', bookends.NS))
            self.assertEqual(len(identifiers), len(set(identifiers)))
            self.assertIn('xmlns="'+bookends.NS['ct']+'"', parts['[Content_Types].xml'].decode())
            self.assertIn('xmlns="'+bookends.NS['rel']+'"', parts['ppt/_rels/presentation.xml.rels'].decode())
            cover = ''.join(E.fromstring(parts[slides[0]]).itertext())
            self.assertIn('合成题目', cover)
            self.assertIn('作者：合成作者', cover)
            self.assertIn('日期：2026-01-01', cover)
            self.assertNotIn('部门：', cover)
            self.assertNotIn('Security Level:', cover)
            closing = E.fromstring(parts[slides[-1]])
            self.assertIn('Thank you.', ''.join(closing.itertext()))
            self.assertEqual(receipt['materialized_layout_objects'], 1)
            expected_media = {value for name, value in original.items() if name.startswith('ppt/media/')}
            copied_media = [parts[destination] for source, destination in receipt['template_part_map'].items()
                            if source.startswith('ppt/media/')]
            self.assertTrue(copied_media)
            self.assertTrue(all(value in expected_media for value in copied_media))
            with self.assertRaises(ValueError):
                bookends.apply_bookends(template, template, output, '题目', '作者', '2026-01-01')

if __name__ == '__main__':
    unittest.main()
