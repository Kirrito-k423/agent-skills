"""为完整汇报装配独立封面和目录，保留正文及其证据口径。"""
from copy import deepcopy
from html import escape

LAYOUTS = {'project-cover', 'project-agenda', 'insight-cover', 'insight-agenda'}


def assemble(deck, config=None):
    """按一级章节插入导航目录，并统一计算实际交付页码。"""
    result = deepcopy(deck)
    slides = result.get('slides', [])
    if not slides or result.get('report_kind') == 'paper-analysis':
        return result
    if any(s.get('layout') in LAYOUTS for s in slides):
        return result
    cfg = config or {}
    chapters = deepcopy(cfg.get('chapters', []))
    repeat = cfg.get('repeat_agenda', bool(chapters))
    if type(repeat) is not bool:
        raise ValueError('repeat_agenda 必须为布尔值')
    if not chapters:
        if len(slides) > 8:
            raise ValueError('正文超过八页，请提供 frontmatter.chapters 的一级章节与正文页码范围')
        chapters = [{'title': s['title'], 'start_content': i, 'end_content': i}
                    for i, s in enumerate(slides, 1)]
    if not 1 <= len(chapters) <= 8:
        raise ValueError('目录应包含一至八个一级章节')
    cursor = 1
    for index, c in enumerate(chapters):
        start, end = c.get('start_content'), c.get('end_content')
        if (not c.get('title') or type(start) is not int or type(end) is not int
                or start != cursor or not start <= end <= len(slides)):
            raise ValueError('目录章节必须连续覆盖全部正文，且 start_content/end_content 从 1 开始')
        offset = 2 + (index if repeat else 0)
        c['start_page'], c['end_page'] = start + offset, end + offset
        cursor = end + 1
    if cursor != len(slides) + 1:
        raise ValueError('目录范围未覆盖全部正文')
    stem = 'project' if result['style'] == 'technical-project' else 'insight'
    cover = {'layout': stem + '-cover', 'role': 'cover', 'title': cfg.get('title', result['title']),
             'subtitle': cfg.get('subtitle', ''), 'date': cfg.get('date', ''),
             'notes': {'scope': '封面仅标识主题；日期按提供的含义展示。'}}
    def agenda(active=None):
        page = {'layout': stem + '-agenda', 'role': 'agenda', 'title': '目录',
                'chapters': deepcopy(chapters), 'notes': {'scope': '页码包含章节切换目录，当前章红色，已讲章节灰色。'}}
        if active is not None:
            page['active_chapter'] = active
        return page
    pages = [cover]
    if not repeat:
        pages.append(agenda())
    for index, chapter in enumerate(chapters, 1):
        if repeat:
            pages.append(agenda(index))
        for content in slides[chapter['start_content']-1:chapter['end_content']]:
            content['chapter_index'] = index
            pages.append(content)
    result['slides'] = pages
    result['report_frontmatter'] = 2
    result['repeat_agenda'] = repeat
    return result


def validate_structure(deck):
    version = deck.get('report_frontmatter')
    if version not in (1, 2):
        return []
    slides = deck.get('slides', [])
    if len(slides) < 3 or slides[0].get('role') != 'cover' or slides[1].get('role') != 'agenda':
        return ['完整汇报须以独立封面和目录开头，随后保留正文']
    chapters = slides[1].get('chapters', [])
    repeat = version == 2 and deck.get('repeat_agenda', False)
    if sum(s.get('role') == 'cover' for s in slides) != 1:
        return ['完整汇报只能包含一个开头的封面']
    agendas = [s for s in slides if s.get('role') == 'agenda']
    if len(agendas) != (len(chapters) if repeat else 1):
        return ['目录数量必须对应一级章节切换位置']
    if any(s.get('chapters') != chapters for s in agendas):
        return ['各次目录必须展示相同的完整章节与交付页码']
    cursor = 3
    for index, c in enumerate(chapters, 1):
        if repeat and (slides[cursor-2].get('role') != 'agenda' or
                       slides[cursor-2].get('active_chapter') != index):
            return ['每个一级章节前须展示目录，且当前章高亮顺序正确']
        if c.get('start_page') != cursor or type(c.get('end_page')) is not int or not cursor <= c['end_page'] <= len(slides):
            return ['目录交付页码与正文不连续或越界']
        for page in slides[cursor-1:c['end_page']]:
            if page.get('layout') in LAYOUTS or (version == 2 and page.get('chapter_index') != index):
                return ['章节范围必须连续覆盖本章正文']
        cursor = c['end_page'] + 1
        if repeat and index < len(chapters):
            cursor += 1
    return [] if chapters and cursor == len(slides) + 1 else ['目录必须覆盖全部正文']


def render_frontmatter(slide, deck, number, logo):
    """原生导出标记只描述现有文字与版式，不把整页转为图片。"""
    title = escape(slide['title']).replace('\n', '<br>')
    rule = '<div class="report-rule" data-native-shape></div>'
    if slide['role'] == 'cover':
        body = (f'<h1 data-native-text>{title}</h1>{rule}'
                f'<p class="report-subtitle" data-native-text>{escape(slide.get("subtitle", ""))}</p>'
                '<div class="report-band" data-native-shape></div>'
                f'<p class="report-date" data-native-text>{escape(slide.get("date", "")).replace(chr(10), "<br>")}</p>')
        kind = 'report-cover'
    else:
        rows = []
        for i, chapter in enumerate(slide['chapters'], 1):
            first, last = chapter['start_page'], chapter['end_page']
            pages = str(first) if first == last else f'{first}–{last}'
            active = slide.get('active_chapter')
            state = 'completed' if active and i < active else 'current' if active == i else 'upcoming' if active else 'overview'
            rows.append(f'<li class="agenda-{state}"'+(' aria-current="step"' if state == 'current' else '')+f'><span class="agenda-number" data-native-text>{i:02d}</span>'
                        f'<span class="agenda-title" data-native-text>{escape(chapter["title"])}</span>'
                        f'<span class="agenda-pages" data-native-text>P{pages}</span></li>')
        body = f'<h1 data-native-text>{title}</h1>{rule}<ol class="report-chapters">{"".join(rows)}</ol>'
        kind = 'report-agenda'
    return (f'<article class="slide {kind}" data-slide="{number}" data-layout="{slide["layout"]}">{body}'
            f'<footer><span>{number:02d} / {len(deck["slides"]):02d}　 Huawei Confidential</span>'
            f'<img alt="HUAWEI" src="data:image/png;base64,{logo}"></footer></article>')
