import fs from 'node:fs';
import crypto from 'node:crypto';
import {buildModel,PRESETS} from '../animation/model.mjs';
import {glossary,explainTerm,sourceFragment,sourceId,termText,D,E,H,K,L} from '../animation/terminology.mjs';
const base=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,base),'utf8'),hash=p=>crypto.createHash('sha256').update(read(p)).digest('hex');
const sources=JSON.parse(read('animation/sources.json')),decode=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const defaultModel=buildModel();
const report={reviewer:'/root/terminology_review',revision:1,status:'REWORK',hashes:{model:hash('animation/model.mjs'),terminology:hash('animation/terminology.mjs')},coverage:{sourceFiles:0,sourceLines:0,sourceBindings:0,contextCases:0,configQueries:0,objectQueries:0},gaps:[],semanticCases:[],references:[],unresolved:[],badSourceText:[]};
for (const [file,lines] of Object.entries(sources.files)){
 report.coverage.sourceFiles++;const htmls=sourceFragment(file,1,lines.length,lines);
 htmls.forEach((html,i)=>{
   report.coverage.sourceLines++;
   const plain=decode(html.replace(/<[^>]*>/g,''));
   if(plain!==lines[i]&&!(lines[i]===''&&plain===' '))report.badSourceText.push({file,line:i+1,expected:lines[i],actual:plain});
   for(const a of html.matchAll(/data-unresolved-term="([^"]+)"/g))report.unresolved.push({file,line:i+1,id:decode(a[1])});
   for(const a of html.matchAll(/data-term-query="([^"]+)"/g)){const q=JSON.parse(decode(a[1]));report.coverage.sourceBindings++;const x=explainTerm(defaultModel,q);if(!x||!x.definition)report.gaps.push({kind:'empty-source-definition',q});if(q.context.file!==file||q.context.line!==i+1)report.gaps.push({kind:'source-context-mismatch',q,file,line:i+1});}
 });
}
function testSource(name,file,line,wanted,forbidden=[]){
 const rendered=sourceFragment(file,line,line,sources.files[file],{step:0})[0];
 const actualQueries=[...rendered.matchAll(/data-term-query="([^"]+)"/g)].map(a=>JSON.parse(decode(a[1])));
 const q=actualQueries.find(a=>a.context.identifier===name||glossary[a.termId]?.label===name);
 const x=q?.termId?explainTerm(buildModel(),q):null;const text=x?x.definition+' '+x.currentRole:'';
 const pass=x&&wanted.every(re=>re.test(text))&&!forbidden.some(re=>re.test(text));
 report.coverage.contextCases++;report.semanticCases.push({name,file,line,expected:wanted.map(String),definition:x?.definition,status:pass?'PASS':'REWORK'});if(!pass)report.gaps.push({kind:'incorrect-context-semantics',name,file,line,definition:x?.definition});
}
testSource('expert_histogram',D,179,[/全局expert/,/本核|每AIV/]);
testSource('expert_histogram',D,511,[/本地expert/,/远端|source rank/]);
testSource('rank_histogram',D,186,[/计数/]);
testSource('rank_histogram',D,272,[/排他前缀/]);
testSource('dst_slot_idx',D,272,[/来源rank分区/]);
testSource('dst_slot_idx',E,484,[/输出行/]);
testSource('dst_slot_idx',E,108,[/本地expert|local expert|expert/,/数组|计数|下一|next|起始/],[/dispatch目的buffer/]);
testSource('ptr',E,21,[/UB/,/填充/]);
testSource('value',E,21,[/填充值/],[/prefix分支/]);
testSource('num_tokens','csrc/buffers/ep.hpp',430,[/expand|展开|combine/],[/0<=T<=M|0≤T≤M/]);
testSource('rank_idx',E,143,[/来源rank/]);
testSource('has_dst_slot',E,482,[/当前|本/,/top-k|位置|j/]);
testSource('token_idx',E,133,[/接收流/,/总|全/],[/源rank输入/]);
testSource('num_tokens',E,151,[/步|移动/],[/0<=T<=M|有效输入token数量T/]);
testSource('ptr',K,58,[/函数指针|kernel.*指针|指向.*dispatch_impl/],[/工作区信号地址/]);
testSource('ptr',K,119,[/函数指针|kernel.*指针|指向.*epilogue/],[/工作区信号地址/]);
testSource('ptr',L,50,[/base|基址/],[/工作区信号地址/]);
testSource('rank_idx',L,118,[/分区|选|目标/],[/本kernel所在rank编号/]);
testSource('len',H,299,[/字节|byte/],[/序列长度/]);
testSource('status',H,430,[/CQE/,/状态|错误/],[/^归约packed状态/]);
testSource('value','csrc/buffers/ep.hpp',206,[/optional|可选/,/取|值/],[/prefix分支/]);
testSource('data','deep_ep/buffers/ep.py',149,[/Tensor|张量/,/重排|排序|view/],[/histogram helper读取的int64/]);
testSource('data','deep_ep/buffers/ep.py',35,[/属性|底层存储/,/版本|检查/],[/^Python当前排序重排/]);
testSource('i','csrc/buffers/ep.hpp',301,[/rank|来源/,/统计|同步|计数/],[/具体遍历范围与步长/]);
testSource('i','csrc/buffers/ep.hpp',309,[/本地expert|local expert|专家/,/统计|同步|计数/],[/具体遍历范围与步长/]);
testSource('i','csrc/buffers/ep.hpp',463,[/bias/,/两|2/],[/具体遍历范围与步长/]);
testSource('i','deep_ep/buffers/ep.py',41,[/expert|专家/],[/具体遍历范围与步长/]);
testSource('src',H,119,[/SQ|CQ/,/字段|上下文/],[/^本机metadata复制的GM源/]);
testSource('size',H,149,[/byte|字节|容量/],[/^Tensor维度/]);
testSource('num_bytes','deep_ep/buffers/ep.py',227,[/容量|分配|buffer|缓冲/],[/赋给SGE长度/]);
testSource('status','deep_ep/include/deep_ep/comm/barrier.hpp',148,[/轮|phase|两bit|2/,/符号|sign|状态/],[/^归约packed/]);
testSource('rank_idx','deep_ep/include/deep_ep/layout/ep/workspace.hpp',43,[/目的rank/],[/本kernel所在rank/]);
testSource('rank_idx','deep_ep/include/deep_ep/layout/ep/workspace.hpp',47,[/来源rank/],[/^本kernel所在rank/]);
testSource('signals','deep_ep/include/deep_ep/layout/ep/workspace.hpp',21,[/EPSignals/,/统计|前缀/]);
testSource('i',E,105,[/local expert|本地expert|expert|bin/],[/具体遍历范围与步长/]);
testSource('i',E,401,[/AIV|核/,/后/],[/具体遍历范围与步长/]);
testSource('i',E,431,[/MTE/,/stage|预加载/],[/具体遍历范围与步长/]);
testSource('i',E,444,[/metadata/,/stage|事件/],[/具体遍历范围与步长/]);
testSource('i','deep_ep/include/deep_ep/comm/barrier.hpp',100,[/轮询|空指令|周期/],[/具体遍历范围与步长/]);
testSource('j',D,226,[/目的rank/],[/^top-k lane/]);
testSource('ptr',D,362,[/hidden/,/源|x/],[/^当前语句明确指向的工作区信号/]);
testSource('ptr',D,364,[/metadata/,/源/],[/^当前语句明确指向的工作区信号/]);
testSource('x',D,104,[/threadIdx|线程|坐标/],[/^原始输入 hidden/]);
testSource('get_iqent',E,390,[/MTE2/,/预加载|队列/],[/布局供迭代/]);
testSource('token_idx',L,124,[/record|slot|槽|记录/,/分区|布局/],[/^dispatch的源rank输入/]);
testSource('global',E,318,[/空间|全局|接收流/],[/^来源 token 的全局编号/]);
testSource('raw pointers','deep_ep/buffers/ep.py',35,[/指针|存储/,/版本|检查/],[/^expert 的实际有效/]);
testSource('k',D,226,[/核|AIV/,/求和|累计/]);
testSource('N',E,57,[/元素|数量/]);
testSource('my_vec_core_idx',E,401,[/AIV|核/,/当前|本/]);
testSource('n_burst',E,401,[/后续|后面|核|AIV/,/次数|数量|个数/]);
testSource('burst_len',E,402,[/字节|sizeof/,/expert|专家/]);
testSource('expert_count',E,402,[/核|AIV|数组/,/计数/]);
testSource('my_expert_count',E,402,[/本核|当前核|AIV/,/计数/]);
const arrival=explainTerm(defaultModel,{termId:'field.arrival',context:{objectId:'R0.signals',elementPath:['arrival'],step:0}});
report.coverage.contextCases++;report.semanticCases.push({name:'signals.arrival',objectId:'R0.signals',definition:arrival.definition,status:/状态字符串/.test(arrival.definition)&&arrival.currentValue==='未到'?'PASS':'REWORK'});if(!/状态字符串/.test(arrival.definition)||arrival.currentValue!=='未到')report.gaps.push({kind:'signals-arrival-context',definition:arrival.definition,value:arrival.currentValue});
for(const c of [
 {label:'capacity bytes',text:'bytes',context:{objectId:'R0.SQE[2]',surface:'control',step:12},id:'bytes',value:256,valueObject:'@bytes'},
 {label:'SGE bytes',text:'bytes',context:{objectId:'R0.SQE[2]',elementPath:[0,'SGEs',0,'bytes'],step:12},id:'field.bytes',value:512,valueObject:'R0.SQE[2]'},
 {label:'source rank partition',text:'source分区 = 4B',context:{surface:'visual',stage:'counts'},id:'source'},
 {label:'operand source before producer',text:'source-before-producer',context:{objectId:'R0.x[0]',elementPath:[0]},id:'source'}
]){const h=termText(c.text,c.context),match=[...h.matchAll(/data-term-query="([^"]+)"/g)][0],q=match&&JSON.parse(decode(match[1])),x=q&&explainTerm(defaultModel,q);const pass=q?.termId===c.id&&(!('value'in c)||x.currentValue===c.value&&x.valueQuery?.objectId===c.valueObject);report.coverage.contextCases++;report.semanticCases.push({name:c.label,query:q,definition:x?.definition,currentValue:x?.currentValue,status:pass?'PASS':'REWORK'});if(!pass)report.gaps.push({kind:'ordinary-word-vs-nested-field-context',label:c.label,query:q,definition:x?.definition,currentValue:x?.currentValue});}
for(const preset of Object.keys(PRESETS)){const m=buildModel(preset);for(const termId of ['R','E','K','T','M','H','A','C']){const x=explainTerm(m,{termId,context:{step:0,preset}});report.coverage.configQueries++;if(x.currentValue!==m.config[termId]||x.valueQuery?.objectId!=='@config.'+termId)report.gaps.push({kind:'config-binding',preset,termId});}
 for(const [objectId,l]of Object.entries(m.ledger)){const x=explainTerm(m,{termId:'object.'+l.obj,context:{step:0,preset,objectId}});report.coverage.objectQueries++;if(x.objectId!==objectId||x.unit!==l.dtype||!x.currentRole.includes(l.memory))report.gaps.push({kind:'object-context',preset,objectId});}
}
for(const [id,x]of Object.entries(glossary)){const r=x.sourceRef;if(!r||!r.url){report.gaps.push({kind:'missing-reference',id});continue;}if(r.commit){try{const line=read('DeepEP-Ascend/'+r.file).split('\n')[r.line-1];if(!line?.trim())report.references.push({id,status:'REWORK',ref:r,reason:'missing or blank source anchor'});}catch(e){report.references.push({id,status:'REWORK',ref:r,reason:'file does not exist'});}}}
if(report.unresolved.length)report.gaps.push({kind:'unresolved-source-identifiers',count:report.unresolved.length,unique:[...new Set(report.unresolved.map(x=>x.id))]});
if(report.badSourceText.length)report.gaps.push({kind:'modified-source-text',count:report.badSourceText.length});
if(report.references.length)report.gaps.push({kind:'invalid-source-anchors',count:report.references.length});
report.status=report.gaps.length?'REWORK':'STATIC_CHECK_PASS_PENDING_MANUAL_AND_UI';
fs.writeFileSync(new URL('./terminology-static-audit.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,coverage:report.coverage,gaps:report.gaps}));
