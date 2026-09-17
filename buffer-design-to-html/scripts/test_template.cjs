#!/usr/bin/env node
'use strict';
// 验证离线页的纯模型；大规模递归按序列首/中/末路径抽样，不模拟 DOM。
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const own = (object, name) => Object.prototype.hasOwnProperty.call(object, name);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
function check(ok, message) { if (!ok) throw new Error(message); }
function rejects(run, message) {
  let rejected = false;
  try { run(); } catch { rejected = true; }
  check(rejected, '未拒绝反例：' + message);
}
function uint(value, where) {
  check(typeof value === 'bigint' && value >= 0n, where + '必须是非负 BigInt');
  return value;
}
function block(html, name) {
  const begin = '/* ' + name + '_START */', end = '/* ' + name + '_END */';
  check(html.split(begin).length === 2 && html.split(end).length === 2, name + '标记缺失或重复');
  const start = html.indexOf(begin) + begin.length, finish = html.indexOf(end, start);
  check(finish > start, name + '结束标记位置错误');
  return html.slice(start, finish).trim();
}
function loadHtml(file) {
  const html = fs.readFileSync(file, 'utf8');
  check(!/<script\b[^>]*\bsrc\s*=/i.test(html), '离线页不能依赖外部脚本');
  check(!/<link\b[^>]*\brel\s*=\s*["']?stylesheet\b[^>]*\bhref\s*=/i.test(html), '离线页不能依赖外部样式');
  const source = block(html, 'RECURSIVE_CORE'), model = block(html, 'MEMORY_CASE');
  const reader = block(html, 'RECURSIVE_READER');
  check(block(html, 'RECURSIVE_STYLE').length > 0, '递归阅读器缺少内嵌样式');
  const context = vm.createContext({});
  new vm.Script(source + '\n' + model, {filename: file}).runInContext(context, {timeout: 5000});
  new vm.Script(reader, {filename: '递归阅读器语法检查'});
  const Core = context.RecursiveMemory, Case = context.MemoryCase;
  check(Core && ['childrenOf','validateChildren','validateTree','treemap','highlightSegments','repeatNode'].every(name => typeof Core[name] === 'function'), '缺少递归核心接口');
  check(Case && typeof Case.build === 'function', '缺少 MemoryCase.build 纯模型接口');
  check(Array.isArray(Case.presets) && Case.presets.length >= 2, '至少需要两组预设');
  check(Array.isArray(Case.parameters) && Case.parameters.length > 0, '缺少参数定义');
  return {Core, Case, html, file, source};
}
function inspectModel(model, Core, options = {}) {
  const {maxNodes = 12000, maxChildren = 512, checkSources = true} = options;
  check(model && model.root, '模型没有根空间');
  const seen = new Map(), locations = new Map(), evidenceSeen = new Set(), sourceCache = new Map();
  const addressPending = [], uniqueFieldProofs = new Set();
  const stats = {nodes: 0, leaves: 0, fields: 0, padding: 0, sources: 0, addresses: 0, repeatGroups: 0, sampledSequences: 0, deferredBranches: 0, maxDepth: 0};
  function evidence(proof, where) {
    check(proof && nonempty(proof.file) && nonempty(proof.fn) && nonempty(proof.role) && nonempty(proof.code), where + '证据缺少路径、函数、用途或代码');
    check(Number.isSafeInteger(proof.start) && proof.start > 0 && Number.isSafeInteger(proof.end) && proof.end >= proof.start, where + '源码行号范围无效');
    check(Array.isArray(proof.highlights), where + '缺少精确高亮标识符列表');
    const highlighted = Core.highlightSegments(proof.code, proof.highlights);
    check(highlighted.map(segment => segment.text).join('') === proof.code, where + '高亮改变了源码文字');
    const names = new Set(highlighted.filter(segment => segment.highlight).map(segment => segment.text));
    for (const name of proof.highlights) check(names.has(name), where + '高亮标识符未在该代码片段中出现：' + name);
    const key = JSON.stringify([proof.file,proof.start,proof.end,proof.code]);
    if (!evidenceSeen.has(key)) {
      evidenceSeen.add(key); stats.sources++;
      if (checkSources) {
        const synthetic = /合成|教学示例/.test(proof.file);
        if (!synthetic) {
          check(path.isAbsolute(proof.file), where + '真实源码路径必须为绝对路径：' + proof.file);
          if (!sourceCache.has(proof.file)) sourceCache.set(proof.file, fs.readFileSync(proof.file, 'utf8').replace(/\r\n/g, '\n').split('\n'));
          const lines = sourceCache.get(proof.file);
          check(proof.end <= lines.length, where + '引用超过源码文件末行');
          const actual = lines.slice(proof.start - 1, proof.end).join('\n');
          check(actual.includes(proof.code.replace(/\r\n/g, '\n').trim()), where + '代码片段与所指源码行不符：' + proof.file + ':' + proof.start);
        } else {
          check(proof.code.split('\n').length <= proof.end - proof.start + 1, where + '合成源码片段长度超出声明行范围');
        }
      }
    }
    return names;
  }
  function metadata(node, absolute, depth) {
    check(node && typeof node === 'object' && nonempty(node.id) && nonempty(node.label), '节点缺少 ID 或中文名称');
    if (seen.has(node.id)) {
      check(seen.get(node.id) === node && locations.get(node.id) === absolute, '重复节点 ID 或同一对象出现在不同位置：' + node.id);
      return;
    }
    seen.set(node.id, node); locations.set(node.id, absolute);
    check(++stats.nodes <= maxNodes, '有界检查超过节点预算：' + maxNodes);
    stats.maxDepth = Math.max(stats.maxDepth, depth);
    uint(node.bytes, node.id + '.bytes'); uint(node.offset, node.id + '.offset');
    check(['group','field','padding','reserve','unknown'].includes(node.kind || (node.childrenFactory ? 'group' : '')), node.id + '空间类型无效');
    const f = node.formula;
    check(f && ['expression','substitution','unit','why'].every(key => nonempty(f[key])), node.id + '缺少完整公式、当前代入、单位或原因');
    check(f.unit === 'B' && typeof f.value === 'bigint' && f.value === node.bytes, node.id + '公式值或字节单位与空间跨度不一致');
    check(nonempty(node.why) || nonempty(f.why), node.id + '缺少空间用途说明');
    check(Array.isArray(node.evidence) && node.evidence.length > 0, node.id + '没有自身的源码证据');
    const names = new Set();
    for (const proof of node.evidence) for (const name of evidence(proof, node.id)) names.add(name);
    check(Array.isArray(node.codeNames), node.id + '缺少真实代码标识符列表');
    for (const name of node.codeNames) {
      check(names.has(name), node.id + '代码对象没有精确高亮证据：' + name);
    }
    if (node.kind === 'field') {
      stats.fields++;
      check(node.codeNames.length > 0 && names.size > 0, node.id + '字段未对应任何真实代码对象');
      uniqueFieldProofs.add(JSON.stringify(node.evidence.map(proof => [proof.code,proof.highlights])));
    }
    if (node.kind === 'padding') stats.padding++;
    if (node.address) addressPending.push({node, absolute});
    if (node.rangeCount !== undefined) {
      stats.repeatGroups++;
      uint(node.rangeStart, node.id + '.rangeStart'); uint(node.rangeCount, node.id + '.rangeCount'); uint(node.stride, node.id + '.stride');
      check(node.bytes === node.rangeCount * node.stride, node.id + '重复组大小与份数、stride不符');
    }
  }
  function open(node, absolute, depth) {
    metadata(node, absolute, depth);
    const kids = Core.validateChildren(node);
    check(kids.length <= maxChildren, node.id + '一次展开创建过多子节点');
    for (const child of kids) metadata(child, absolute + child.offset, depth + 1);
    if (!kids.length) stats.leaves++;
    if (kids.length) {
      const rectangles = Core.treemap(kids, 800, 400), area = 320000;
      let rendered = 0;
      for (const rectangle of rectangles) {
        const fraction = node.bytes ? Number(rectangle.bytes * 1000000000000000n / node.bytes) / 1e15 : 0;
        const actual = rectangle.w * rectangle.h;
        check(Number.isFinite(actual) && actual >= 0 && Math.abs(actual - fraction * area) < 1e-6, node.id + 'treemap面积与容量不成比例');
        rendered += actual;
      }
      check(Math.abs(rendered - (node.bytes ? area : 0)) < 1e-6, node.id + 'treemap总面积不守恒');
    }
    return kids;
  }
  function range(node, absolute, depth, targets) {
    const kids = open(node, absolute, depth);
    let end = node.rangeStart;
    for (const child of kids) {
      // 嵌套序列的根同时有父序列 repeatIndex 与自身 rangeStart。
      // 当前层先用父序列索引；进入该记录后再解释它自己的重复范围。
      const first = child.repeatIndex !== undefined ? child.repeatIndex : child.rangeStart;
      const count = child.repeatIndex !== undefined ? 1n : child.rangeCount;
      uint(first, child.id + '.重复索引'); uint(count, child.id + '.重复份数');
      check(first === end && child.bytes === count * node.stride && child.offset === (first - node.rangeStart) * node.stride, child.id + '重复组索引或地址不连续');
      end += count;
      const chosen = targets.filter(index => index >= first && index < first + count);
      if (!chosen.length) {
        if (child.childrenFactory || child.children?.length) stats.deferredBranches++;
        continue;
      }
      if (child.repeatIndex !== undefined) walk(child, absolute + child.offset, depth + 1);
      else range(child, absolute + child.offset, depth + 1, chosen);
    }
    check(end === node.rangeStart + node.rangeCount, node.id + '重复索引未覆盖完整范围');
  }
  function walk(node, absolute, depth) {
    if (node.rangeCount !== undefined) {
      const start = node.rangeStart, count = node.rangeCount;
      const targets = count <= 8n ? Array.from({length:Number(count)}, (_, index) => start + BigInt(index)) : [start,start + count / 2n,start + count - 1n];
      if (count > 8n) stats.sampledSequences++;
      range(node, absolute, depth, targets);
      return;
    }
    for (const child of open(node, absolute, depth)) walk(child, absolute + child.offset, depth + 1);
  }
  walk(model.root, 0n, 0);
  // 对已经物化的整个结构额外检查全局 ID/对象重用；不打开尚未访问的懒分支。
  const materialized = Core.validateTree(model.root, {maxNodes, expandDepth:0});
  stats.materializedNodes = materialized.nodes;
  stats.unopenedFactories = materialized.deferred;
  for (const {node, absolute} of addressPending) {
    const address = node.address, where = node.id + '.address';
    check(nonempty(address.baseId), where + '缺少基址 ID');
    uint(address.byteOffset, where + '.byteOffset');
    check(Array.isArray(address.terms) && address.terms.length > 0, where + '缺少递归偏移项');
    let sum = 0n;
    for (const term of address.terms) {
      check(nonempty(term.label) && term.unit === 'B', where + '偏移项缺少解释或字节单位');
      sum += uint(term.value, where + '.terms.value');
      if (term.nodeId) check(locations.has(term.nodeId), where + '偏移项引用不存在或尚未验证的空间：' + term.nodeId);
    }
    check(sum === address.byteOffset, where + '各偏移项之和不等于字节偏移');
    if (address.elementBytes !== undefined || address.elementIndex !== undefined) {
      check(uint(address.elementBytes, where + '.elementBytes') > 0n, where + '元素字节数必须大于0');
      check(uint(address.elementIndex, where + '.elementIndex') * address.elementBytes === address.byteOffset, where + '元素下标乘sizeof不等于字节偏移');
    }
    check(locations.has(address.baseId), where + '引用未验证的基址：' + address.baseId);
    check(locations.get(address.baseId) + address.byteOffset === absolute, where + '基址加偏移与树中绝对地址不同');
    stats.addresses++;
  }
  check(stats.fields > 0 && uniqueFieldProofs.size >= Math.min(2, stats.fields), '字段全部返回同一份代码，缺少独立证据');
  if (model.baseEntries) for (const base of model.baseEntries) {
    check(nonempty(base.id) && Array.isArray(base.codeNames) && Array.isArray(base.evidence), '基址说明不完整');
    uint(base.offset, base.id + '.offset');
    if (locations.has(base.id)) check(locations.get(base.id) === base.offset, base.id + '别名偏移与物理空间不同');
    const names = new Set();
    for (const proof of base.evidence) for (const name of evidence(proof, base.id)) names.add(name);
    for (const name of base.codeNames) check(names.has(name), base.id + '基址变量缺少精确证据：' + name);
  }
  if (model.bankPairs) {
    check(model.bankPairs.length >= 2, 'bank说明没有列出实际双份空间');
    const banks = new Set();
    for (const pair of model.bankPairs) {
      check(Number.isSafeInteger(pair.bank) && !banks.has(pair.bank), 'bank编号重复或无效');
      banks.add(pair.bank);
      for (const id of [pair.stateId,pair.windowId]) check(locations.has(id), 'bank配对引用了不存在的空间：' + id);
      check(pair.stateId !== pair.windowId, '状态bank和token窗口被错误合并为一个节点');
    }
  }
  check(Array.isArray(model.allocationFlow) && model.allocationFlow.length >= 2, '缺少保留的空间申请流程');
  return stats;
}
function counterexamples(Core) {
  const proof = {file:'教学示例（合成代码）',start:1,end:1,fn:'example',role:'字段赋值',code:'int32_t* value; value[0] = 1;',highlights:['value']};
  const node = (id, offset, bytes) => ({id,label:id,offset,bytes,kind:'field',codeNames:['value'],evidence:[proof],formula:{expression:'sizeof(int32_t)',substitution:'4',value:bytes,unit:'B',why:'一个4 B字段。'}});
  const fresh = () => {
    const left=node('left',0n,4n),right=node('right',4n,4n);
    right.evidence=[{...proof,code:'int32_t* value; value[1] = 2;'}];
    right.address={baseId:'root',byteOffset:4n,elementBytes:4n,elementIndex:1n,terms:[{label:'跳过首字段',value:4n,unit:'B'}]};
    return {root:{...node('root',0n,8n),kind:'group',children:[left,right]},allocationFlow:[{label:'申请'},{label:'释放'}]};
  };
  const cases = [
    ['丢失子节点', model => model.root.children.pop()],
    ['错误局部offset', model => {model.root.children[1].offset=3n;}],
    ['错误公式value', model => {model.root.children[0].formula.value=5n;}],
    ['错误字节地址', model => {model.root.children[1].address.byteOffset=8n;}],
    ['错误元素下标', model => {model.root.children[1].address.elementIndex=2n;}],
    ['缺少高亮变量', model => {model.root.children[0].evidence=[{...proof,highlights:['missing']}];}],
    ['变量前缀误匹配', model => {model.root.children[0].evidence=[{...proof,code:'int32_t* value_extra; value_extra[0] = 1;'}];}],
    ['缺少公式原因', model => {model.root.children[0].formula.why='';}],
    ['缺少源码行号', model => {model.root.children[0].evidence=[{...proof,start:0}];}],
  ];
  inspectModel(fresh(),Core);
  for (const [label, mutate] of cases) {const model=fresh();mutate(model);rejects(()=>inspectModel(model,Core),label);}
  const text='value[0] = value_extra + other_value; // value\n"value"; <tag>';
  const parts=Core.highlightSegments(text,['value']);
  check(parts.map(part=>part.text).join('')===text && parts.filter(part=>part.highlight).map(part=>part.text).join('|')==='value', '高亮器误匹配前缀、注释或字符串');
  return cases.length;
}
function inspectDiagnosis(diagnosis, parameters) {
  const names=new Set(parameters.map(parameter=>parameter.id));
  check(diagnosis&&typeof diagnosis.ok==='boolean'&&nonempty(diagnosis.title)&&nonempty(diagnosis.summary),'当前诊断缺少状态、标题或说明');
  for(const key of ['calculations','issues','notes','evidence','actions'])check(Array.isArray(diagnosis[key]),'当前诊断缺少数组字段：'+key);
  for(const item of diagnosis.calculations){
    check(['label','expression','substitution'].every(key=>nonempty(item[key])),'诊断计算缺少名称、公式或代入');
    check(['string','number','bigint'].includes(typeof item.result)&&String(item.result).trim()!=='','诊断计算缺少当前结果');
    if(typeof item.result==='number')check(Number.isFinite(item.result),'诊断结果不是有限数值');
  }
  for(const issue of diagnosis.issues){
    check(nonempty(issue.title)&&nonempty(issue.detail)&&Array.isArray(issue.parameters),'诊断问题缺少解释或参数关联');
    for(const id of issue.parameters)check(names.has(id),'诊断引用不存在的参数：'+id);
  }
  if(!diagnosis.ok)check(diagnosis.issues.length>0,'失败诊断必须说明待调整问题');
  for(const action of diagnosis.actions){
    check(nonempty(action.label)&&action.values&&typeof action.values==='object'&&!Array.isArray(action.values),'诊断建议缺少名称或模拟参数');
    for(const [id,value]of Object.entries(action.values))check(names.has(id)&&typeof value==='string','诊断建议只能写已定义参数的字符串输入：'+id);
  }
  return diagnosis;
}
function inspectParameter(help, parameter) {
  check(help&&['title','meaning','unit','category'].every(key=>nonempty(help[key])),'参数 '+parameter.id+' 缺少含义、单位或限制类别');
  for(const key of ['codeNames','limits','effects','notes','evidence','links'])check(Array.isArray(help[key]),'参数 '+parameter.id+' 缺少数组字段：'+key);
  check(help.limits.length>0&&help.effects.length>0,'参数 '+parameter.id+' 未说明限制或受影响空间');
  for(const link of help.links){check(nonempty(link.label)&&nonempty(link.url),'参数来源链接缺少名称或URL');const url=new URL(link.url);check(['https:','http:'].includes(url.protocol),'参数来源链接只能使用HTTP(S)');}
}
function main() {
  const args=process.argv.slice(2);
  if(args.includes('--help')) {console.log('用法：node test_template.cjs [HTML路径]\n默认检查递归合成模板；指定路径则检查该离线页的MemoryCase。小序列完整展开，大序列仅检查首/中/末路径及每个已打开父区的完整账本。不会模拟DOM、执行设备代码或代替浏览器验收。');return;}
  check(args.length<=1,'最多提供一个HTML路径');
  const file=args[0]?path.resolve(args[0]):path.resolve(__dirname,'../assets/buffer-design-template.html');
  const {Core,Case}=loadHtml(file);
  const reports=[];let invalidPresets=0,parameterChecks=0,diagnosticChecks=0;
  for (const preset of Case.presets) {
    check(nonempty(preset.label) && preset.values && typeof preset.values==='object','预设名称或参数缺失');
    if(preset.expectInvalid){
      let buildError;try{Case.build({...preset.values},0);}catch(error){buildError=error;}
      check(buildError,preset.label+'标为不合法预设，但模型却接受了它');
      const expected=preset.expectedError||preset.expectError;
      if(expected)check(String(buildError.message).includes(String(expected)),preset.label+'报错与预期条件不符');
      check(typeof Case.diagnose==='function',preset.label+'非法预设缺少当前参数诊断');
      const diagnosis=inspectDiagnosis(Case.diagnose({...preset.values},0),Case.parameters);
      check(!diagnosis.ok,preset.label+'构建失败但容量诊断仍表示通过');
      invalidPresets++;diagnosticChecks++;
      continue;
    }
    const first=Case.build({...preset.values},0);
    if(typeof Case.diagnose==='function'){const diagnosis=inspectDiagnosis(Case.diagnose({...preset.values},0),Case.parameters);check(diagnosis.ok,preset.label+'模型通过但容量诊断报告失败');diagnosticChecks++;}
    if(typeof Case.explainParameter==='function')for(const parameter of Case.parameters){inspectParameter(Case.explainParameter(parameter.id,{...preset.values},0),parameter);parameterChecks++;}
    const banks=first.bankPairs ? [0,1] : [0];
    let capacity, physicalRegions;
    for (const bank of banks) {
      const model=bank===0?first:Case.build({...preset.values},bank);
      const report=inspectModel(model,Core);
      const regions=Core.childrenOf(model.root).map(node=>[node.id,node.offset.toString(),node.bytes.toString()]);
      if(capacity===undefined)capacity=model.root.bytes;
      else check(capacity===model.root.bytes,preset.label+'切换bank改变了物理容量');
      if(physicalRegions===undefined)physicalRegions=JSON.stringify(regions);
      else check(physicalRegions===JSON.stringify(regions),preset.label+'切换bank改变了物理分区地址');
      reports.push({label:preset.label,bank,capacity:capacity.toString(),...report});
    }
  }
  const validPreset=Case.presets.find(preset=>!preset.expectInvalid);check(validPreset,'至少需要一个合法预设');
  const initial={...validPreset.values},firstParameter=Case.parameters[0].id;
  for(const bad of ['-1','1.2','1e6','abc','','9'.repeat(1000)]) rejects(()=>Case.build({...initial,[firstParameter]:bad},0),'非法整数输入 '+bad.slice(0,12));
  const failures=counterexamples(Core);
  if(!args[0]) {
    check(Case.build({N:'2'}).root.bytes===64n,'合成例子2条记录应为64 B');
    check(Case.build({N:'1000000'}).root.bytes===32000000n,'合成例子百万条记录应为32000000 B');
    rejects(()=>Case.build({N:'0'}),'合成例子零记录');
    rejects(()=>Case.build({N:'1000001'}),'合成例子超过预设最大值');
  }
  for(const report of reports) console.log('通过：'+report.label+' / bank '+report.bank+'，'+report.capacity+' B，检查'+report.nodes+'节点、'+report.sources+'段证据、'+report.addresses+'条地址；'+report.sampledSequences+'个大序列按首/中/末抽样，保留'+report.deferredBranches+'个未展开分支。');
  if(parameterChecks||diagnosticChecks)console.log('通过：'+parameterChecks+'份参数解释、'+diagnosticChecks+'组当前输入诊断、'+invalidPresets+'组预期非法预设；诊断建议只包含已定义模拟参数。');
  console.log('通过：'+Case.presets.length+'组预设、父子BigInt账本、真实面积、公式与字段高亮、源码行范围、bank容量不变、非法输入及'+failures+'项篡改反例。大规模检查有界，未穷举全部叶子；未执行真实浏览器或设备测试。');
}
module.exports={loadHtml,inspectModel,counterexamples,inspectDiagnosis,inspectParameter};
if(require.main===module)try{main();}catch(error){console.error('校验失败：'+error.message);process.exitCode=1;}
