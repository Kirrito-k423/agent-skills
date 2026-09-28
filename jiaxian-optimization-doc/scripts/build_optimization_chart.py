#!/usr/bin/env python3
"""从同条件的累计阶段 CSV 生成耗时、加速比双联图与派生指标。仅依赖标准库。"""

import argparse
import csv
import html
import json
import math
from pathlib import Path
import sys
import unicodedata


FIELDS = ['stage_id', 'stage', 'time_ms', 'config_id', 'evidence', 'source']
DERIVED = ['step_saved_ms', 'cumulative_saved_ms', 'time_reduction_pct',
           'step_speedup', 'cumulative_speedup']
STATUS = {'measured': '实测数据', 'reported': '原文报告，未独立复现',
          'estimated': '理论估计，非实测结果'}


class ChineseParser(argparse.ArgumentParser):
    def error(self, message):
        self.print_usage(sys.stderr)
        self.exit(2, '错误：命令参数不完整或格式无效。请使用 --help 查看用法。\n')

    def format_usage(self):
        return super().format_usage().replace('usage:', '用法:', 1)

    def format_help(self):
        return super().format_help().replace('usage:', '用法:', 1)


def read_stages(path):
    with path.open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream)
        headers = reader.fieldnames or []
        if len(headers) != len(set(headers)) or not set(FIELDS).issubset(headers):
            raise ValueError('CSV 表头缺失或重复，必需字段：' + ', '.join(FIELDS))
        rows = []
        for line, raw in enumerate(reader, 2):
            if None in raw or any(raw.get(key) is None for key in FIELDS):
                raise ValueError(f'第 {line} 行字段数量不正确。')
            row = {key: raw[key].strip() for key in FIELDS}
            if any(not value for value in row.values()):
                raise ValueError(f'第 {line} 行含空字段；缺测数据不能作为已知耗时绘图。')
            try:
                time = float(row['time_ms'])
            except ValueError:
                raise ValueError(f'第 {line} 行 time_ms 必须是毫秒数值。') from None
            if not math.isfinite(time) or time <= 0:
                raise ValueError(f'第 {line} 行耗时必须是正有限数，不能使用零、NaN 或 Inf。')
            if row['evidence'] not in STATUS:
                raise ValueError(f'第 {line} 行 evidence 必须是 measured、reported 或 estimated。')
            row['time_ms'] = time
            rows.append(row)
    if len(rows) < 2:
        raise ValueError('至少提供基线与一个后续阶段；首行作为初始基线。')
    if len({row['stage_id'] for row in rows}) != len(rows):
        raise ValueError('stage_id 必须唯一，不能重复阶段编号。')
    if len({row['config_id'] for row in rows}) != 1:
        raise ValueError('存在不同可比配置，请拆分数据后分别绘图。')
    if len({row['evidence'] for row in rows}) != 1:
        raise ValueError('实测、原文报告与估计不能混为同一阶段曲线，请分别绘图。')
    baseline = previous = rows[0]['time_ms']
    for row in rows:
        time = row['time_ms']
        row.update(step_saved_ms=previous-time, cumulative_saved_ms=baseline-time,
                   time_reduction_pct=100*(1-time/baseline),
                   step_speedup=previous/time, cumulative_speedup=baseline/time)
        if not all(math.isfinite(row[key]) for key in DERIVED):
            raise ValueError('派生指标超出数值范围，请检查耗时与单位。')
        previous = time
    return rows


def wrap_display(value, columns):
    lines, current, width = [], '', 0
    for char in str(value):
        size = 2 if unicodedata.east_asian_width(char) in ('W', 'F') else 1
        if char == '\n' or width + size > columns:
            lines.append(current)
            current, width = '', 0
        if char != '\n':
            current += char
            width += size
    if current:
        lines.append(current)
    return lines or ['']


def render(rows, title, statistic):
    width = max(960, 160 * len(rows) + 160)
    left, right = 92, width - 45
    label_lines = [wrap_display(row['stage_id'] + ' ' + row['stage'], 18) for row in rows]
    title_lines = wrap_display(title, (width - 100) // 15)
    subtitle = STATUS[rows[0]['evidence']] + '；统计口径：' + statistic
    subtitle_lines = wrap_display(subtitle, (width - 100) // 8)
    header_bottom = 50 + 34 * len(title_lines) + 23 * len(subtitle_lines)
    plot_h = 190
    top1 = header_bottom + 44
    bottom1 = top1 + plot_h
    top2 = bottom1 + 100
    bottom2 = top2 + plot_h
    footer_y = bottom2 + 34 + 21 * max(map(len, label_lines))
    footer_lines = wrap_display('可比配置：' + rows[0]['config_id'] + '；逐阶段来源与派生指标见 metrics.csv。', (width-100)//8)
    height = footer_y + 35 + 23 * len(footer_lines)
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
             '<title>' + html.escape(title) + '</title>',
             '<desc>' + html.escape(json.dumps({'statistic': statistic, 'stages': rows}, ensure_ascii=False)) + '</desc>',
             '<rect width="100%" height="100%" fill="#f8fafc"/>',
             '<g font-family="PingFang SC,Microsoft YaHei,Noto Sans CJK SC,sans-serif" fill="#172b4d">']

    def text(x, y, value, size=15, anchor='start', color='#172b4d'):
        parts.append(f'<text x="{x:.2f}" y="{y:.2f}" font-size="{size}" text-anchor="{anchor}" fill="{color}">{html.escape(str(value))}</text>')

    def line(x1, y1, x2, y2, color='#dbe3ec', dashed=False):
        dash = ' stroke-dasharray="6 5"' if dashed else ''
        parts.append(f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" stroke="{color}"{dash}/>')

    for i, value in enumerate(title_lines):
        text(44, 42 + i*34, value, size=27)
    for i, value in enumerate(subtitle_lines):
        text(44, 49 + len(title_lines)*34 + i*23, value, color='#52657a')
    text(left, top1-20, '绝对耗时 / ms（越低越好）', size=18)
    text(left, top2-20, '累计加速比 / 倍（相对首阶段，越高越好）', size=18)
    max_time = max(row['time_ms'] for row in rows)
    max_speed = max(row['cumulative_speedup'] for row in rows)
    if not all(math.isfinite(value * 1.25) for value in (max_time, max_speed)):
        raise ValueError('绘图坐标超出数值范围，请检查耗时单位。')
    # 将最大值映射到轴高的 80%，为点上数值留出空间。
    time_y = lambda value: bottom1 - value / max_time * plot_h * .8
    speed_y = lambda value: bottom2 - value / max_speed * plot_h * .8
    for k in range(6):
        y1, y2 = bottom1-k*plot_h/5, bottom2-k*plot_h/5
        line(left, y1, right, y1)
        line(left, y2, right, y2)
        text(left-12, y1+5, f'{max_time*(k/4):.4g}', anchor='end')
        text(left-12, y2+5, f'{max_speed*(k/4):.3g}', anchor='end')
    line(left, speed_y(1), right, speed_y(1), '#9e7136', dashed=True)
    text(right, speed_y(1)-8, '基线 1.0 倍', anchor='end', color='#8a652f')
    step = (right-left)/len(rows)
    xs = [left+step*(i+.5) for i in range(len(rows))]
    estimated = rows[0]['evidence'] == 'estimated'
    for x, row in zip(xs, rows):
        bar_w = min(step*.45, 74)
        y = time_y(row['time_ms'])
        dash = ' stroke="#2563a6" stroke-dasharray="5 4"' if estimated else ''
        parts.append(f'<rect x="{x-bar_w/2:.2f}" y="{y:.2f}" width="{bar_w:.2f}" height="{bottom1-y:.2f}" rx="3" fill="#4486b8"{dash}/>')
        text(x, y-10, f'{row["time_ms"]:.6g}', anchor='middle')
    points = ' '.join(f'{x:.2f},{speed_y(row["cumulative_speedup"]):.2f}' for x, row in zip(xs, rows))
    dash = ' stroke-dasharray="7 5"' if estimated else ''
    parts.append(f'<polyline points="{points}" fill="none" stroke="#b7612b" stroke-width="3"{dash}/>')
    for x, row, labels in zip(xs, rows, label_lines):
        y = speed_y(row['cumulative_speedup'])
        parts.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="5" fill="#b7612b"/>')
        text(x, y-12, f'{row["cumulative_speedup"]:.3f} 倍', anchor='middle', color='#984715')
        for j, label in enumerate(labels):
            text(x, bottom2+27+j*21, label, anchor='middle')
    for i, value in enumerate(footer_lines):
        text(44, footer_y+i*23, value, color='#52657a')
    parts.append('</g></svg>')
    return '\n'.join(parts)


def main():
    parser = ChineseParser(description='从同条件累计阶段数据生成耗时与加速比图，不验证输入证据的真实性。', add_help=False)
    parser._optionals.title = '选项'
    parser.add_argument('-h', '--help', action='help', help='显示中文帮助并退出')
    parser.add_argument('--input', required=True, type=Path, metavar='输入CSV', help='阶段 CSV，首行为基线')
    parser.add_argument('--output-dir', required=True, type=Path, metavar='输出目录', help='写入 optimization.svg 与 metrics.csv')
    parser.add_argument('--title', default='优化耗时与累计加速比', metavar='标题', help='图表中文标题')
    parser.add_argument('--statistic', required=True, metavar='统计口径', help='如重复实验中位数、样本数及测量范围')
    args = parser.parse_args()
    try:
        if not args.title.strip() or not args.statistic.strip():
            raise ValueError('标题与统计口径不能为空。')
        rows = read_stages(args.input)
        svg = render(rows, args.title, args.statistic)
        paths = [args.output_dir/'optimization.svg', args.output_dir/'metrics.csv']
        if args.input.resolve() in [path.resolve() for path in paths]:
            raise ValueError('输出路径与输入 CSV 冲突，请选择其他输出目录。')
        args.output_dir.mkdir(parents=True, exist_ok=True)
        paths[0].write_text(svg, encoding='utf-8')
        with paths[1].open('w', encoding='utf-8', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=FIELDS+DERIVED)
            writer.writeheader()
            writer.writerows(rows)
    except (OSError, UnicodeError, csv.Error):
        print('错误：无法读写数据，请检查文件路径、权限、UTF-8 编码和 CSV 格式。', file=sys.stderr)
        return 2
    except ValueError as error:
        print(f'错误：{error}', file=sys.stderr)
        return 2
    print('已生成：' + str(paths[0]))
    print('已生成：' + str(paths[1]))
    print(f'累计加速比：{rows[-1]["cumulative_speedup"]:.4f} 倍；耗时降幅：{rows[-1]["time_reduction_pct"]:.2f}%。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
