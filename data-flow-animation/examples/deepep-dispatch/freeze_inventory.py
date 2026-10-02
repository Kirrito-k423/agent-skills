import hashlib, json, re
from pathlib import Path
from tree_sitter import Language, Parser
import tree_sitter_cpp

ROOT = Path(__file__).parent
REPO = ROOT / 'DeepEP-Ascend'
FILES = ['deep_ep/include/deep_ep/impls/ep/dispatch.hpp',
         'deep_ep/include/deep_ep/impls/ep/dispatch_copy_epilogue.hpp']
parser = Parser(Language(tree_sitter_cpp.language()))

def mask(s):
    s = re.sub(r'__launch_bounds__\([^)]*\)', lambda m: ' '*len(m[0]), s)
    return re.sub(r'\b__(?:aicore|forceinline|simt_vf|simd_vf|gm|ubuf|global|vector)__\b',
                  lambda m: ' '*len(m[0]), s)

def lexical(s):
    # Preserve physical offsets while excluding comments, strings and character literals.
    p = re.compile(r'//[^\n]*|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"|\x27(?:\\.|[^\x27\\])*\x27')
    return p.sub(lambda m: ''.join('\n' if c=='\n' else ' ' for c in m[0]), s)

def line(s, offset): return s[:offset].count('\n') + 1

def template_start(s, offset):
    # A definition's immediately preceding template declaration belongs to its range.
    lo=s.rfind('\n', 0, offset)+1
    before=s[:lo]
    m=re.search(r'template\s*<[^;{}]*>\s*$', before)
    return m.start() if m else lo

def text_inventory(s):
    lex=lexical(s); out=[]
    # All named function bodies in these sources carry a SIMT/SIMD/AICore/global qualifier.
    pattern=re.compile(r'(?m)^\s*(?:__simt_vf__|__simd_vf__|__aicore__|__global__)')
    candidates=[]
    for m in pattern.finditer(lex):
        start=m.start()
        while lex[start].isspace(): start+=1
        opening=lex.find('{', start)
        sig=lex[start:opening]
        if ';' in sig: continue
        names=re.findall(r'\b([A-Za-z_]\w*)\s*\(',sig)
        names=[x for x in names if x not in ['__launch_bounds__']]
        if not names: continue
        candidates.append((template_start(s,start),opening,names[0],'definition'))
    for m in re.finditer(r'(?m)^\s*(?:const\s+)?auto\s+(\w+)\s*=\s*\[',lex):
        start=m.start()
        while lex[start].isspace(): start+=1
        candidates.append((start,lex.find('{',m.end()),m[1],'lambda'))
    for start,opening,name,kind in candidates:
        depth=1; pos=opening+1
        while depth and pos<len(lex):
            if lex[pos]=='{': depth+=1
            elif lex[pos]=='}': depth-=1
            pos+=1
        out.append({'name':name,'start':line(s,start),'end':line(s,pos-1),'kind':kind})
    return sorted(out,key=lambda x:(x['start'],x['end']))

def syntax_inventory(s):
    tree=parser.parse(mask(s).encode()); out=[]; errors=[]
    def walk(n):
        if n.type=='ERROR': errors.append([n.start_point.row+1,n.end_point.row+1])
        if n.type=='function_definition':
            d=n.child_by_field_name('declarator')
            while d and d.type in ['function_declarator','pointer_declarator','reference_declarator']:
                d=d.child_by_field_name('declarator')
            name=s.encode()[d.start_byte:d.end_byte].decode() if d else '?'
            start=n.parent.start_point.row+1 if n.parent.type=='template_declaration' else n.start_point.row+1
            out.append({'name':name,'start':start,'end':n.end_point.row+1,'kind':'definition'})
        elif n.type=='lambda_expression':
            p=n.parent
            name_node=p.child_by_field_name('declarator')
            name=s.encode()[name_node.start_byte:name_node.end_byte].decode() if name_node else '?'
            start=p.parent.start_point.row+1 if p.parent.type=='declaration' else p.start_point.row+1
            out.append({'name':name,'start':start,'end':n.end_point.row+1,'kind':'lambda'})
        for c in n.children: walk(c)
    walk(tree.root_node)
    return sorted(out,key=lambda x:(x['start'],x['end'])),errors

manifest={'revision':'3b25377d04b24fc6154698ded78a2bcb2c59afff',
          'deep_jit_revision':'65f513952b8771408a19202f65e36398522db6db','files':[]}
for rel in FILES:
    path=REPO/rel; s=path.read_text(); syntax,errors=syntax_inventory(s); text=text_inventory(s)
    print(rel, 'syntax',syntax,'text',text,'errors',errors)
    assert syntax==text, f'inventory disagreement: {rel}'
    manifest['files'].append({'path':str(path),'relative_path':rel,'line_count':len(s.splitlines()),
        'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'syntax':syntax,'text':text,'parser_errors':errors,
        'functions':syntax,'status':'FROZEN'})
(ROOT/'source-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
