#!/usr/bin/env python3
"""校验位图观测模型，生成双屏联动的控制页和动画页。"""
import argparse
import base64
import gzip
import hashlib
import json
import re
import tempfile
from pathlib import Path


def validate(model):
    """拒绝越界索引、无效位图和不安全的整数时间。"""
    if model.get('schema') != 'packet-flow.v1':
        raise ValueError('模型版本必须是 packet-flow.v1')
    ranks, cores, blocks = (model[k] for k in ('ranks', 'cores', 'blocksPerToken'))
    if not (1 <= ranks <= 512 and 1 <= cores <= 256 and 1 <= blocks <= 24):
        raise ValueError('rank、核或块数超出支持范围')
    if not model['launches']:
        raise ValueError('模型没有可播放的轮次')
    for launch in model['launches']:
        if len(launch['origins']) != ranks or len(launch['coreEpoch']) != ranks * cores or len(launch['coreEnd']) != ranks * cores:
            raise ValueError('时钟表长度与 rank×核规模不符')
        if any(not isinstance(x, str) or not x.isdecimal() for x in launch['origins']):
            raise ValueError('原始 tick 必须使用十进制字符串')
        tasks = launch['tasks']
        for src, dst, rx, expert, count, tx, group in tasks:
            if not (0 <= src < ranks and 0 <= dst < ranks and 0 <= rx < cores and -1 <= tx < cores and count >= 0 and expert >= 0 and -1 <= group < model['groups']):
                raise ValueError('任务的端点、数量或 group 越界')
        last = {}
        for task, start, end, copied, begin, masks, record, line in launch['observations']:
            if not (0 <= task < len(tasks) and 0 <= start <= end < 2**53 and (copied == 0 or end <= copied < 2**53)):
                raise ValueError('观察的任务索引或时间无效')
            if start < last.get(task, 0):
                raise ValueError('同一任务的观察顺序回退')
            last[task] = start
            if begin < 0 or begin + len(masks) > tasks[task][4] or not masks or any(not isinstance(v, int) or not 0 <= v < 2**blocks for v in masks):
                raise ValueError('观察的 slot 或位图越界')
            if record < 0 or line < 1:
                raise ValueError('原始记录定位无效')
    return model


def render(model, output):
    validate(model)
    data = json.dumps(model, ensure_ascii=False, separators=(',', ':')).encode()
    packed = base64.b64encode(gzip.compress(data, mtime=0)).decode()
    assets = Path(__file__).resolve().parents[1] / 'assets'
    template = (assets / 'viewer.html').read_text()
    if template.count('__PACKED_MODEL__') != 1:
        raise ValueError('页面模板的数据占位符无效')
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    template = template.replace('__PACKED_MODEL__', packed).replace('__MODEL_ID__', hashlib.sha256(data).hexdigest())
    template = template.replace('__SYNC_SCRIPT__', (assets / 'sync.js').read_text())
    template = template.replace('__PROGRESS_SCRIPT__', (assets / 'progress.js').read_text() + '\n' + (assets / 'charts.js').read_text())
    template = template.replace('__BANDWIDTH_SCRIPT__', (assets / 'bandwidth.js').read_text() + '\n' + (assets / 'bandwidth-view.js').read_text())
    for role in ('control', 'visual'):
        (output.parent / f'{role}.html').write_text(template.replace('__PAGE_ROLE__', role))
    # 保留旧入口；两个实际页面都内嵌完整数据，移动文件时一起复制即可。
    if output.name not in ('control.html', 'visual.html'):
        output.write_text('''<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<title>全局数据流 · 双屏入口</title><script>location.replace('control.html'+location.search+location.hash)</script>
<p><a href="control.html">打开控制页</a> · <a href="visual.html">打开动画页</a></p></html>''')
    print(f'已生成 {output.parent}/control.html、visual.html；入口 {output.name}；模型 {len(data):,} 字节，压缩后 {len(packed):,} 字节')


def self_test():
    fixture = {'schema': 'packet-flow.v1', 'ranks': 1, 'cores': 1, 'groups': 1, 'blocksPerToken': 2,
               'launches': [{'origins': ['9007199254740993'], 'coreEpoch': [0], 'coreEnd': [20],
                            'tasks': [[0, 0, 0, 0, 1, 0, -1]], 'observations': [[0, 1, 2, 3, 0, [3], 1, 1]]}]}
    validate(fixture)
    for field, value in [(0, 1), (2, 2**53), (4, 1), (5, [4])]:
        broken = json.loads(json.dumps(fixture))
        broken['launches'][0]['observations'][0][field] = value
        try:
            validate(broken)
        except ValueError:
            continue
        raise AssertionError('错误模型未被拒绝')
    with tempfile.TemporaryDirectory() as directory:
        output = Path(directory) / 'index.html'
        render(fixture, output)
        for role in ('control', 'visual'):
            page = (output.parent / f'{role}.html').read_text()
            assert f'data-role="{role}"' in page
            assert not re.search(r'__(PACKED_MODEL|PAGE_ROLE|SYNC_SCRIPT|PROGRESS_SCRIPT|BANDWIDTH_SCRIPT|MODEL_ID)__', page)
            encoded = re.search(r'<script id="packed"[^>]*>(.*?)</script>', page, re.S).group(1)
            assert json.loads(gzip.decompress(base64.b64decode(encoded))) == fixture
        assert 'location.search' in output.read_text()
    print('自检通过：模型边界、双页生成、内嵌数据一致性、占位符与兼容入口')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('model', nargs='?', help='规范化模型 JSON 路径')
    parser.add_argument('--output', help='输出 HTML 路径')
    parser.add_argument('--self-test', action='store_true', help='运行内置边界自检')
    args = parser.parse_args()
    if args.self_test:
        self_test()
    elif args.model and args.output:
        render(json.loads(Path(args.model).read_text()), args.output)
    else:
        parser.error('请提供模型与 --output，或使用 --self-test')
