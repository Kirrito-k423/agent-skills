"""Embed local source figures unchanged; never fetch remote material."""
from pathlib import Path
import base64
import hashlib
import html
import math
import struct


def read_image(spec):
    if not isinstance(spec, dict):
        raise ValueError('image must be an object')
    value = spec.get('path')
    if not isinstance(value, str) or '://' in value or value.startswith('data:'):
        raise ValueError('image.path must name a local file')
    path = Path(value)
    if not path.is_absolute() or not path.is_file():
        raise ValueError('image.path must be an existing absolute local file')
    if not isinstance(spec.get('alt'), str) or not spec['alt'].strip():
        raise ValueError('image.alt must describe the figure')
    source = spec.get('source')
    if not isinstance(source, dict) or not source or not any(source.values()):
        raise ValueError('image.source must record its original reference')
    height=spec.get('height')
    if height is not None and (isinstance(height,bool) or not isinstance(height,(int,float)) or not 40<=height<=600):
        raise ValueError('image.height must be a number from 40 to 600')
    data = path.read_bytes()
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        mime = 'image/png'
    elif data.startswith(b'\xff\xd8\xff'):
        mime = 'image/jpeg'
    elif data[:6] in (b'GIF87a', b'GIF89a'):
        mime = 'image/gif'
    elif data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        mime = 'image/webp'
    else:
        raise ValueError('image must be PNG, JPEG, GIF or WebP; export other figures locally first')
    crop = spec.get('crop')
    if crop is not None:
        if not isinstance(crop, dict) or set(crop) != {'left', 'top', 'right', 'bottom'}:
            raise ValueError('crop 必须包含 left、top、right、bottom 四个比例')
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 <= v < 1 for v in crop.values()):
            raise ValueError('crop 比例必须为 0 到 1 之间的有限数值')
        if crop['left'] + crop['right'] >= 1 or crop['top'] + crop['bottom'] >= 1:
            raise ValueError('crop 必须保留非空图像区域')
        if mime != 'image/png' or len(data) < 24 or data[12:16] != b'IHDR':
            raise ValueError('裁切预览需要 PNG 原图，请先在本地转换')
        width, height_px = struct.unpack('>II', data[16:24])
        if not width or not height_px:
            raise ValueError('PNG 图片尺寸无效')
    return data, mime


def image_html(spec):
    data, mime = read_image(spec)
    uri = 'data:' + mime + ';base64,' + base64.b64encode(data).decode('ascii')
    alt = html.escape(spec['alt'], quote=True)
    sha = hashlib.sha256(data).hexdigest()
    sizing=f' style="height:{float(spec["height"]):g}px;flex:none"' if spec.get('height') is not None else ''
    crop = spec.get('crop')
    if crop is not None:
        width, height = struct.unpack('>II', data[16:24])
        rem_x = 1 - crop['left'] - crop['right']
        rem_y = 1 - crop['top'] - crop['bottom']
        ratio = width * rem_x / (height * rem_y)
        view_h = float(spec.get('height', 400))
        frame = f'position:relative;overflow:hidden;width:min(100%,{view_h*ratio:.3f}px);aspect-ratio:{ratio:.8f};max-height:100%'
        image_style = (f'position:absolute;max-width:none;object-fit:fill;left:{-100*crop["left"]/rem_x:.6f}%;'
                       f'top:{-100*crop["top"]/rem_y:.6f}%;width:{100/rem_x:.6f}%;height:{100/rem_y:.6f}%')
        return (f'<figure class="source-figure"{sizing}><div class="source-crop" style="{frame}">'
                f'<img style="{image_style}" src="{uri}" alt="{alt}" data-source-sha256="{sha}"></div></figure>')
    return (f'<figure class="source-figure"{sizing}><img src="{uri}" alt="{alt}" '
            f'data-source-sha256="{sha}"></figure>')
