"""原图裁切参数与 HTML 输出的离线回归测试。"""
from pathlib import Path
from tempfile import TemporaryDirectory
import struct
import unittest

import source_images


class SourceImageCropTest(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'source.png'
        self.path.write_bytes(b'\x89PNG\r\n\x1a\n' + b'\x00\x00\x00\rIHDR' + struct.pack('>II', 800, 400))
        self.spec = {'path': str(self.path), 'alt': '实验曲线', 'source': {'figure': '原图'},
                     'height': 300, 'crop': {'left': 0.1, 'top': 0.2, 'right': 0.1, 'bottom': 0.2}}

    def tearDown(self):
        self.tmp.cleanup()

    def test裁切与原图嵌入(self):
        result = source_images.image_html(self.spec)
        self.assertIn('class="source-crop"', result)
        self.assertIn('aspect-ratio:2.66666667', result)
        self.assertIn('data-source-sha256=', result)
        self.assertIn('data:image/png;base64,', result)

    def test无效裁切被拒绝(self):
        self.spec['crop']['left'] = 0.9
        with self.assertRaisesRegex(ValueError, '非空图像'):
            source_images.read_image(self.spec)
        self.spec['crop']['left'] = float('nan')
        with self.assertRaisesRegex(ValueError, '有限数值'):
            source_images.read_image(self.spec)

    def test无裁切兼容(self):
        del self.spec['crop']
        self.assertNotIn('source-crop', source_images.image_html(self.spec))


if __name__ == '__main__':
    unittest.main()
