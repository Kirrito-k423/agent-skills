"""以原生 PPTX 部件复用模板封面和结束页，保留背景、布局、母版与媒体字节。"""
from pathlib import Path
import argparse
import copy
import hashlib
import json
import posixpath
import re
import zipfile
import xml.etree.ElementTree as E

ROOT = Path(__file__).resolve().parents[1]
NS = {'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'rel': 'http://schemas.openxmlformats.org/package/2006/relationships',
      'ct': 'http://schemas.openxmlformats.org/package/2006/content-types'}
for prefix in ('p', 'a', 'r'):
    E.register_namespace(prefix, NS[prefix])
for prefix, uri in [('p14', 'http://schemas.microsoft.com/office/powerpoint/2010/main'),
                    ('a16', 'http://schemas.microsoft.com/office/drawing/2014/main'),
                    ('mc', 'http://schemas.openxmlformats.org/markup-compatibility/2006')]:
    E.register_namespace(prefix, uri)

def xml(value):
    return E.tostring(value, encoding='utf-8', xml_declaration=True)

def relationships_xml(value):
    E.register_namespace('', NS['rel'])
    return xml(value)

def read_package(path):
    with zipfile.ZipFile(path) as package:
        return {name: package.read(name) for name in package.namelist()}

def rel_name(part):
    return posixpath.join(posixpath.dirname(part), '_rels', posixpath.basename(part) + '.rels')

def resolve(part, target):
    return posixpath.normpath(target.lstrip('/') if target.startswith('/') else posixpath.join(posixpath.dirname(part), target))

def ordered_slides(parts):
    presentation = E.fromstring(parts['ppt/presentation.xml'])
    relationships = E.fromstring(parts['ppt/_rels/presentation.xml.rels'])
    mapping = {r.get('Id'): resolve('ppt/presentation.xml', r.get('Target')) for r in relationships}
    return [mapping[s.get('{'+NS['r']+'}id')] for s in presentation.find('p:sldIdLst', NS)]

class PartImporter:
    def __init__(self, source, output, content_types, prefix, skip_notes=False):
        self.source, self.output, self.content_types = source, output, content_types
        self.prefix, self.skip_notes = prefix, skip_notes
        self.mapping = {}
        ct = E.fromstring(source['[Content_Types].xml'])
        self.overrides = {e.get('PartName').lstrip('/'): e.get('ContentType') for e in ct if e.tag.endswith('Override')}
        # OPC 扩展名按大小写无关匹配；合并不同模板时不能把 jpg / JPG 当成两种默认类型。
        existing = {e.get('Extension', '').lower() for e in content_types if e.tag.endswith('Default')}
        for e in ct:
            extension = e.get('Extension', '').lower()
            if e.tag.endswith('Default') and extension not in existing:
                content_types.append(copy.deepcopy(e)); existing.add(extension)

    def copy(self, part):
        if part in self.mapping:
            return self.mapping[part]
        if part not in self.source:
            raise ValueError('模板内部引用缺失：' + part)
        directory, filename = posixpath.split(part)
        match = re.fullmatch(r'(.+?)(\d+)(\.[^.]+)', filename)
        if match:
            stem, _, extension = match.groups()
            number = 1
            while f'{directory}/{stem}{number}{extension}' in self.output:
                number += 1
            destination = f'{directory}/{stem}{number}{extension}'
        else:
            destination = f'{directory}/{self.prefix.rsplit("/", 1)[-1]}-{filename}'
        self.mapping[part] = destination
        self.output[destination] = self.source[part]
        if part in self.overrides:
            E.SubElement(self.content_types, '{'+NS['ct']+'}Override',
                         PartName='/' + destination, ContentType=self.overrides[part])
        relationships = rel_name(part)
        if relationships in self.source:
            root = E.fromstring(self.source[relationships])
            for relation in list(root):
                if self.skip_notes and relation.get('Type', '').endswith('/notesSlide'):
                    root.remove(relation); continue
                if relation.get('TargetMode') == 'External':
                    continue
                target = self.copy(resolve(part, relation.get('Target')))
                relation.set('Target', '/' + target)
            self.output[rel_name(destination)] = relationships_xml(root)
        return destination

def fill_cover(value, title, author, date, department=None):
    root = E.fromstring(value)
    title_found = metadata_found = False
    tree = root.find('p:cSld/p:spTree', NS)
    for shape in list(tree):
        body = shape.find('p:txBody', NS)
        if body is None:
            continue
        placeholder = shape.find('p:nvSpPr/p:nvPr/p:ph', NS)
        text = ''.join(shape.itertext())
        if placeholder is not None and placeholder.get('type') in ('title', 'ctrTitle'):
            for paragraph in body.findall('a:p', NS):
                body.remove(paragraph)
            paragraph = E.SubElement(body, '{'+NS['a']+'}p')
            run = E.SubElement(paragraph, '{'+NS['a']+'}r')
            E.SubElement(run, '{'+NS['a']+'}t').text = title.replace('\n', ' ')
            title_found = True
        elif '作者：' in text or '作者:' in text:
            paragraphs = body.findall('a:p', NS)
            lines = ([f'部门：{department}'] if department else []) + [f'作者：{author}', f'日期：{date}']
            prototype = paragraphs[0] if paragraphs else E.Element('{'+NS['a']+'}p')
            for paragraph in paragraphs:
                body.remove(paragraph)
            for line in lines:
                paragraph = copy.deepcopy(prototype)
                for child in list(paragraph):
                    if child.tag != '{'+NS['a']+'}pPr':
                        paragraph.remove(child)
                run = E.SubElement(paragraph, '{'+NS['a']+'}r')
                E.SubElement(run, '{'+NS['a']+'}t').text = line
                body.append(paragraph)
            metadata_found = True
        elif text.strip() in ('Security Level:', 'Security Level：'):
            tree.remove(shape)
    if not title_found or not metadata_found:
        raise ValueError('未找到模板封面的标题或作者占位符，须先核对模板字段')
    return xml(root)

def apply_bookends(input_path, template_path, output_path, title, author, date,
                   department=None, replacements=None, cover_slide=1, closing_slide=None,
                   preserve_replacement_layouts=None):
    output_path = Path(output_path)
    if output_path.exists():
        raise ValueError('输出文件已存在，请使用新路径')
    base, template = read_package(input_path), read_package(template_path)
    presentation = E.fromstring(base['ppt/presentation.xml'])
    relationships = E.fromstring(base['ppt/_rels/presentation.xml.rels'])
    content_types = E.fromstring(base['[Content_Types].xml'])
    slide_list = presentation.find('p:sldIdLst', NS)
    original_slide_parts = ordered_slides(base)
    template_slides = ordered_slides(template)
    by_id = {r.get('Id'): r for r in relationships}
    importers = []
    importer = PartImporter(template, base, content_types, 'ppt/reused-template', skip_notes=True)
    importers.append(importer)
    cover = importer.copy(template_slides[cover_slide-1])
    thanks_source = template_slides[(closing_slide or len(template_slides))-1]
    closing = importer.copy(thanks_source)
    closing_original = base[closing]
    materialized = 0
    closing_root = E.fromstring(base[closing])
    closing_tree = closing_root.find('p:cSld/p:spTree', NS)
    drawable_tags = {'{'+NS['p']+'}'+tag for tag in ('sp', 'pic', 'graphicFrame', 'grpSp', 'cxnSp')}
    if not any(child.tag in drawable_tags for child in closing_tree):
        closing_rels = E.fromstring(base[rel_name(closing)])
        layout_part = next(resolve(closing, relation.get('Target')) for relation in closing_rels
                           if relation.get('Type', '').endswith('/slideLayout'))
        layout_root = E.fromstring(base[layout_part])
        layout_tree = layout_root.find('p:cSld/p:spTree', NS)
        layout_relations = E.fromstring(base[rel_name(layout_part)])
        master_part = next(resolve(layout_part, r.get('Target')) for r in layout_relations
                           if r.get('Type', '').endswith('/slideMaster'))
        master_relations = E.fromstring(base[rel_name(master_part)])
        theme_part = next(resolve(master_part, r.get('Target')) for r in master_relations
                          if r.get('Type', '').endswith('/theme'))
        source_theme = E.fromstring(base[theme_part])
        for child in list(layout_tree):
            if child.tag in drawable_tags and child.find('.//p:ph', NS) is None:
                copied = copy.deepcopy(child)
                font_ref = child.find('p:style/a:fontRef', NS)
                font_role = font_ref.get('idx') if font_ref is not None else 'minor'
                font = source_theme.find(f'.//a:fontScheme/a:{font_role}Font/a:latin', NS)
                if font is not None and font.get('typeface'):
                    for path in ('.//a:rPr', './/a:defRPr', './/a:endParaRPr'):
                        for properties in copied.findall(path, NS):
                            if properties.find('a:latin', NS) is None:
                                E.SubElement(properties, '{'+NS['a']+'}latin', typeface=font.get('typeface'))
                closing_tree.append(copied); layout_tree.remove(child); materialized += 1
        if not materialized:
            raise ValueError('结束页仅含母版内容，未找到可原样复用的可见图元')
        base[closing], base[layout_part] = xml(closing_root), xml(layout_root)
    base[cover] = fill_cover(base[cover], title, author, date, department)
    by_id[slide_list[0].get('{'+NS['r']+'}id')].set('Target', '/' + cover)
    preserve_replacement_layouts = set(preserve_replacement_layouts or [])
    if not preserve_replacement_layouts <= set(replacements or {}):
        raise ValueError('保留源布局的页码必须对应正文替换页')
    for number, file_path in (replacements or {}).items():
        if not 1 < number <= len(slide_list):
            raise ValueError('正文替换页码越界')
        fragment = read_package(file_path)
        imported = PartImporter(fragment, base, content_types, f'ppt/replacement-{number}')
        importers.append(imported)
        source_part = ordered_slides(fragment)[0]
        target_part = original_slide_parts[number-1]
        source_root, target_root = E.fromstring(fragment[source_part]), E.fromstring(base[target_part])
        source_relations = E.fromstring(fragment[rel_name(source_part)])
        target_relations = E.fromstring(base[rel_name(target_part)])
        relation_ids = {r.get('Id') for r in target_relations}
        replacement_ids = {}
        for relation in source_relations:
            kind = relation.get('Type', '')
            if kind.endswith('/slideLayout'):
                if number in preserve_replacement_layouts:
                    destination = imported.copy(resolve(source_part, relation.get('Target')))
                    target_layout = next((r for r in target_relations if r.get('Type', '').endswith('/slideLayout')), None)
                    if target_layout is None:
                        raise ValueError('正文替换页缺少布局引用')
                    target_layout.set('Target', '/' + destination)
                continue
            if kind.endswith('/notesSlide'):
                destination_note = next((r for r in target_relations if r.get('Type', '').endswith('/notesSlide')), None)
                if destination_note is not None:
                    base[resolve(target_part, destination_note.get('Target'))] = fragment[resolve(source_part, relation.get('Target'))]
                continue
            identity = 'rContent1'
            while identity in relation_ids:
                identity = 'rContent'+str(int(identity.removeprefix('rContent'))+1)
            relation_ids.add(identity); replacement_ids[relation.get('Id')] = identity
            copied_relation = copy.deepcopy(relation); copied_relation.set('Id', identity)
            if relation.get('TargetMode') != 'External':
                destination = imported.copy(resolve(source_part, relation.get('Target')))
                copied_relation.set('Target', '/' + destination)
            target_relations.append(copied_relation)
        source_content = copy.deepcopy(source_root.find('p:cSld', NS))
        for node in source_content.iter():
            for attribute, value in list(node.attrib.items()):
                if attribute.startswith('{'+NS['r']+'}') and value in replacement_ids:
                    node.set(attribute, replacement_ids[value])
        old_content = target_root.find('p:cSld', NS)
        target_root.remove(old_content); target_root.insert(0, source_content)
        base[target_part] = xml(target_root)
        base[rel_name(target_part)] = relationships_xml(target_relations)
    ids = {r.get('Id') for r in relationships}
    def add_relation(target, kind):
        number = 1
        while 'rBookend'+str(number) in ids:
            number += 1
        identity = 'rBookend'+str(number); ids.add(identity)
        E.SubElement(relationships, '{'+NS['rel']+'}Relationship', Id=identity,
                     Type=NS['r']+'/'+kind, Target='/' + target)
        return identity
    relationship_id = add_relation(closing, 'slide')
    E.SubElement(slide_list, '{'+NS['p']+'}sldId', id=str(max(int(s.get('id')) for s in slide_list)+1),
                 attrib={'{'+NS['r']+'}id': relationship_id})
    masters = presentation.find('p:sldMasterIdLst', NS)
    if masters is None:
        masters = E.Element('{'+NS['p']+'}sldMasterIdLst'); presentation.insert(0, masters)
    used_ids = [int(m.get('id')) for m in masters]
    for part, value in base.items():
        if '/slideMasters/' in part and part.endswith('.xml'):
            used_ids.extend(int(node.get('id')) for node in E.fromstring(value).findall('.//p:sldLayoutId', NS))
    next_master = max(used_ids or [2147483647]) + 1
    for imported in importers:
        for source, destination in sorted(imported.mapping.items()):
            if source.startswith('ppt/slideMasters/') and source.endswith('.xml'):
                rid = add_relation(destination, 'slideMaster')
                E.SubElement(masters, '{'+NS['p']+'}sldMasterId', id=str(next_master), attrib={'{'+NS['r']+'}id': rid})
                next_master += 1
                master_root = E.fromstring(base[destination])
                for layout_id in master_root.findall('.//p:sldLayoutId', NS):
                    layout_id.set('id', str(next_master)); next_master += 1
                base[destination] = xml(master_root)
    notes_masters = presentation.find('p:notesMasterIdLst', NS)
    notes_master_part = None
    if notes_masters is not None and len(notes_masters):
        notes_rid = notes_masters[0].get('{'+NS['r']+'}id')
        notes_master_part = resolve('ppt/presentation.xml', by_id[notes_rid].get('Target'))
    if notes_master_part:
        for imported in importers:
            for source, destination in imported.mapping.items():
                if source.startswith('ppt/notesSlides/') and source.endswith('.xml'):
                    name = rel_name(destination)
                    root = E.fromstring(base[name])
                    for relation in root:
                        if relation.get('Type', '').endswith('/notesMaster'):
                            relation.set('Target', '/' + notes_master_part)
                    base[name] = relationships_xml(root)
    source_size = E.fromstring(template['ppt/presentation.xml']).find('p:sldSz', NS)
    presentation.find('p:sldSz', NS).attrib.update(source_size.attrib)
    total = len(slide_list)
    for part in original_slide_parts[1:]:
        root = E.fromstring(base[part])
        for node in root.findall('.//a:t', NS):
            if node.text:
                node.text = re.sub(r'^(\d{2}\s*/\s*)\d+(?=\s)', lambda match: match.group(1)+str(total), node.text)
        base[part] = xml(root)
    base['ppt/presentation.xml'] = xml(presentation)
    base['ppt/_rels/presentation.xml.rels'] = relationships_xml(relationships)
    E.register_namespace('', NS['ct'])
    base['[Content_Types].xml'] = xml(content_types)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_path, 'w', compression=zipfile.ZIP_DEFLATED) as package:
        for name, value in base.items():
            package.writestr(name, value)
    return {'slides': total, 'cover_part': cover, 'closing_part': closing,
            'closing_xml_unchanged': base[closing] == template[thanks_source],
            'closing_original_xml_sha256': hashlib.sha256(closing_original).hexdigest(),
            'materialized_layout_objects': materialized,
            'template_sha256': hashlib.sha256(Path(template_path).read_bytes()).hexdigest(),
            'template_part_map': importer.mapping,
            'copied_parts': len(importer.mapping), 'output': str(output_path)}

def main():
    defaults = json.loads((ROOT/'assets/templates/default.json').read_text(encoding='utf-8'))
    parser = argparse.ArgumentParser(description='原生复用模板封面与 Thanks 页，填写作者和版本日期')
    parser.add_argument('--input', required=True, help='已有正文 PPTX，首张封面将被替换')
    parser.add_argument('--output', required=True, help='新的输出 PPTX 路径')
    parser.add_argument('--template', help='可选的用户模板，默认使用已授权内置模板')
    parser.add_argument('--title', required=True, help='封面标题')
    parser.add_argument('--author', default=defaults['author'], help='作者，优先使用用户本次指定值')
    parser.add_argument('--date', required=True, help='宿主提供的版本日期，不替代实验时点')
    parser.add_argument('--department', help='用户明确提供时填写部门')
    parser.add_argument('--replace-slide', action='append', default=[], help='可选正文替换，格式为页码=单页原生PPTX')
    parser.add_argument('--preserve-replacement-layout', action='append', type=int, default=[], help='替换时保留指定页的原始布局、母版与主题')
    args = parser.parse_args()
    replacements = {int(v.split('=', 1)[0]): v.split('=', 1)[1] for v in args.replace_slide}
    result = apply_bookends(args.input, args.template or ROOT/'assets/templates'/defaults['file'], args.output,
                            args.title, args.author, args.date, args.department, replacements,
                            defaults['cover_slide'], defaults['closing_slide'] if not args.template else None,
                            args.preserve_replacement_layout)
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
