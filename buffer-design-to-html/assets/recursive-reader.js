/* 中文离线递归空间阅读器；MemoryCase 提供源码支撑的纯数据模型。 */
(function(){
'use strict';
if(typeof document==='undefined')return;
const Core=globalThis.RecursiveMemory,Case=globalThis.MemoryCase;
const $=id=>document.getElementById(id),mk=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const format=n=>n.toString().replace(/\B(?=(\d{3})+(?!\d))/g,',');
const human=n=>{for(const[u,d]of [['GiB',1073741824n],['MiB',1048576n],['KiB',1024n]])if(n>=d)return (Number(n*100n/d)/100).toFixed(2)+' '+u;return n+' B';};
const percent=(n,d)=>d?Number(n*1000000n/d)/10000:0;
const palette=['#376c9e','#248575','#8e69a7','#b67544','#708499','#ac665d','#5a7d55','#7a73a2'];
const typeName={group:'组合空间',field:'字段',padding:'对齐留空',reserve:'预留 / 未消费余位',unknown:'内部格式未确定'};
let model,selected,focus,bank=0,expanded=new Set(),registry=new Map(),params={},valid=false;
let inspectorMode='space',activeParameter=null,currentDiagnosis=null,lastBuildError=null,rememberedSpace={};
function button(text,fn,cls){const b=mk('button',text,cls);b.type='button';b.addEventListener('click',fn);return b;}
function color(n){if(n.kind==='padding')return '#a58b65';if(n.kind==='reserve')return '#8794a4';if(n.kind==='unknown')return '#8a78a6';let h=0;for(const c of n.id)h=(h*31+c.charCodeAt(0))>>>0;return palette[h%palette.length];}
function getChildren(node){const kids=Core.childrenOf(node);let sum=0n;for(const n of kids){n.parent=node;n.absolute=node.absolute+n.offset;registry.set(n.id,n);sum+=n.bytes;}if(kids.length)Core.validateChildren(node);return kids;}
function isBranch(n){return !!(n.childrenFactory||(n.children&&n.children.length));}
function path(n){const a=[];for(let cur=n;cur;cur=cur.parent)a.unshift(cur);return a;}
function resolve(id){if(!id||!model?.root)return null;if(registry.has(id))return registry.get(id);let cursor=model.root;for(let tries=0;tries<160;tries++){const cs=getChildren(cursor);const direct=cs.find(n=>n.id===id);if(direct)return direct;const next=cs.find(n=>id.startsWith(n.id+'/')||id.startsWith(n.id+':range:')||id.startsWith(n.id+':item:'));if(next){cursor=next;continue;}const rootId=cursor.id.split(':range:')[0],tail=id.slice(rootId.length);const match=tail.match(/^(?:\/[A-Za-z-]+|:item:|:range:)(\d+)/);if(match){const index=BigInt(match[1]),range=cs.find(n=>n.rangeStart!==undefined&&index>=n.rangeStart&&index<n.rangeStart+n.rangeCount);if(range){cursor=range;continue;}}return null;}return null;}
function normalize(node){return node;}
function select(n,{reveal=true}={}){inspectorMode='space';selected=normalize(n);renderTree();renderMap();renderInspector();if(reveal&&innerWidth<=900)switchPane('code');}
function drill(n){if(!n||!valid)return;inspectorMode='space';if(!isBranch(n)){select(n);return;}focus=n;expanded.add(n.id);selected=normalize(n);getChildren(n);renderSpace();renderInspector();}
function visit(id,zoom=false){const n=resolve(id);if(n){if(zoom)drill(n);else select(n);}}
function switchPane(p){$('readerLayout').dataset.mobilePane=p;$('mobileVisual').setAttribute('aria-pressed',String(p==='visual'));$('mobileCode').setAttribute('aria-pressed',String(p==='code'));}
function showEvidence(title,why,proof){inspectorMode='evidence';$('detail').replaceChildren(mk('h2',title),mk('p',why));renderSources($('detail'),proof||[]);$('codePane').scrollTop=0;if(innerWidth<=900)switchPane('code');}
const asList=value=>Array.isArray(value)?value:[];
const display=value=>value===undefined||value===null?'未计算':String(value);
function defaultParameter(p){
 const range=p.min!==undefined||p.max!==undefined?'页面输入护栏：'+(p.min??'无下限')+' ～ '+(p.max??'无上限')+'；这是本页接收范围，不能据此推断源码或硬件极限。':'此模型未提供范围限制的进一步说明。';
 return {title:p.label+' · 参数与限制',meaning:p.meaning||p.description||p.label+'；对应 '+(p.codeName||p.id)+'。',unit:p.unit||'以参数定义为准',category:'输入护栏 / 模型元数据',codeNames:p.codeName?[p.codeName]:[],limits:[range],effects:['修改后重新计算当前模拟器中的空间布局。'],notes:['此通用模型未提供分层限制解释，正式案例应补充源码硬约束、容量约束和建模假设。'],evidence:[],links:[]};
}
function diagnoseCurrent(){
 let diagnosis;
 try{if(typeof Case.diagnose==='function')diagnosis=Case.diagnose({...params},bank);}catch(error){diagnosis={ok:false,title:'当前输入无法完成诊断',summary:error.message,issues:[{title:'诊断输入未解析',detail:error.message,parameters:activeParameter?[activeParameter]:[]}]};}
 if(!diagnosis||typeof diagnosis!=='object')diagnosis={ok:valid,title:valid?'当前参数已通过模型检查':'当前参数无法构建空间树',summary:lastBuildError||'该通用模型未提供进一步的容量诊断。',issues:valid?[]:[{title:'请修正当前输入',detail:lastBuildError||'输入或容量不满足模型条件。',parameters:activeParameter?[activeParameter]:[]}]};
 if(!valid&&diagnosis.ok)diagnosis={...diagnosis,ok:false,issues:[...asList(diagnosis.issues),{title:'空间模型仍未通过',detail:lastBuildError||'本次空间树构建失败。',parameters:[]}]};
 currentDiagnosis={...diagnosis,ok:diagnosis.ok===true};
 return currentDiagnosis;
}
function addList(target,title,items){if(!asList(items).length)return;target.append(mk('h3',title));const list=mk('ul',undefined,'help-list');for(const text of items)list.append(mk('li',display(text)));target.append(list);}
function applySimulation(values){
 for(const p of Case.parameters)if(Object.prototype.hasOwnProperty.call(values||{},p.id)){params[p.id]=String(values[p.id]);$('param-'+p.id).value=params[p.id];}
 refresh();
}
function appendDiagnosis(target){
 const diagnosis=currentDiagnosis||diagnoseCurrent(),section=mk('section',undefined,'diagnosis '+(diagnosis.ok?'diagnosis-ok':'diagnosis-error'));
 section.dataset.diagnosisOk=String(diagnosis.ok);section.append(mk('span',diagnosis.ok?'当前输入可建模':'当前输入需要调整','tag'),mk('h2',diagnosis.title||'当前容量诊断'),mk('p',diagnosis.summary||'诊断使用当前输入参数。'));
 for(const issue of asList(diagnosis.issues)){const card=mk('article',undefined,'diagnostic-issue');card.append(mk('strong',issue.title||'待调整项'),mk('p',issue.detail||''));const related=mk('div',undefined,'actions');for(const id of asList(issue.parameters)){const p=Case.parameters.find(p=>p.id===id);if(p)related.append(button('解释 '+p.label,()=>showParameter(id,{reveal:true}),'parameter-link'));}card.append(related);section.append(card);}
 if(asList(diagnosis.actions).length){section.append(mk('p','以下按钮只改变本页模拟器输入，不会修改 Host 配置、重新申请设备内存或执行外部源码。','simulation-note'));const actions=mk('div',undefined,'actions diagnostic-actions');for(const action of diagnosis.actions)actions.append(button(action.label||'应用模拟参数',()=>{inspectorMode='diagnosis';applySimulation(action.values);},'diagnostic-action'));section.append(actions);}
 if(asList(diagnosis.calculations).length){const disclosure=mk('details',undefined,'diagnostic-derivation');disclosure.open=inspectorMode!=='parameter';disclosure.append(mk('summary','逐步推导容量 · '+diagnosis.calculations.length+' 项当前计算'));const calculations=mk('div',undefined,'diagnostic-calculations');for(const item of diagnosis.calculations){const row=mk('article',undefined,'diagnostic-calculation');row.append(mk('strong',item.label||'当前计算'),mk('div',display(item.expression),'mono'),mk('p','代入：'+display(item.substitution),'small'),mk('div',display(item.result),'diagnostic-result'));calculations.append(row);}disclosure.append(calculations);section.append(disclosure);}
 addList(section,'诊断边界',diagnosis.notes);
 if(asList(diagnosis.evidence).length){const source=mk('details');source.append(mk('summary','诊断依据与限制来源'));renderSources(source,diagnosis.evidence);section.append(source);}target.append(section);
}
function renderParameter(){
 const p=Case.parameters.find(p=>p.id===activeParameter)||Case.parameters[0];if(!p)return;activeParameter=p.id;
 let help=defaultParameter(p);
 try{if(typeof Case.explainParameter==='function'){const supplied=Case.explainParameter(p.id,{...params},bank);if(supplied&&typeof supplied==='object')help={...help,...supplied};}}catch(error){help.notes=[...asList(help.notes),'当前输入下的扩展解释未能生成：'+error.message];}
 const div=$('detail');div.hidden=false;div.replaceChildren(mk('span',help.category||'参数与限制','tag'),mk('h2',help.title||p.label),mk('p',help.meaning||p.label));
 div.append(mk('p','当前输入：'+display(params[p.id])+' · 单位：'+(help.unit||'以参数定义为准'),'parameter-current'));
 const names=mk('div',undefined,'code-names');for(const name of asList(help.codeNames))names.append(mk('code',name));div.append(names);
 addList(div,'限制来自哪里',help.limits);addList(div,'它影响哪些空间',help.effects);addList(div,'说明与假设',help.notes);
 if(asList(help.links).length){const links=mk('div',undefined,'parameter-links');for(const item of help.links){try{const url=new URL(item.url);if(!['https:','http:'].includes(url.protocol))continue;const anchor=mk('a',item.label||url.hostname);anchor.href=url.href;anchor.target='_blank';anchor.rel='noopener noreferrer';links.append(anchor);}catch{}}div.append(links);}
 appendDiagnosis(div);
 if(asList(help.evidence).length){const source=mk('details');source.append(mk('summary','参数与限制的源码依据'));renderSources(source,help.evidence);div.append(source);}
 for(const definition of Case.parameters){const control=$('param-'+definition.id)?.closest('.parameter-control');if(control)control.dataset.active=String(definition.id===p.id);}
}
function showParameter(id,{reveal=false,preserveScroll=false}={}){const oldTop=$('codePane').scrollTop;activeParameter=id;inspectorMode='parameter';renderParameter();$('codePane').scrollTop=preserveScroll?oldTop:0;if(reveal&&innerWidth<=900)switchPane('code');}
function showDiagnostic({reveal=true,preserveScroll=false}={}){const oldTop=$('codePane').scrollTop;inspectorMode='diagnosis';const div=$('detail');div.hidden=false;div.replaceChildren();appendDiagnosis(div);$('codePane').scrollTop=preserveScroll?oldTop:0;if(reveal&&innerWidth<=900)switchPane('code');}
function renderCurrentInspector(){if(inspectorMode==='parameter')renderParameter();else if(inspectorMode==='diagnosis'||!valid){$('detail').hidden=false;$('detail').replaceChildren();appendDiagnosis($('detail'));}else renderInspector();}
function refresh(){
 const oldSel=selected?.id||rememberedSpace.selected,oldFocus=focus?.id||rememberedSpace.focus,oldExpanded=expanded.size?[...expanded]:(rememberedSpace.expanded||[]),oldRightTop=$('codePane').scrollTop;
 lastBuildError=null;
 try{model=Case.build(params,bank);registry=new Map();model.root.absolute=0n;model.root.parent=null;registry.set(model.root.id,model.root);Core.validateTree(model.root,{expandDepth:1,maxNodes:2000});getChildren(model.root);focus=model.root;selected=model.root;expanded=new Set([model.root.id]);
  for(const id of oldExpanded){const n=resolve(id);if(n)expanded.add(n.id);}focus=resolve(oldFocus)||model.root;selected=resolve(oldSel)||focus;valid=true;$('error').hidden=true;$('live').hidden=false;$('detail').hidden=false;
  document.title=model.title||Case.title;$('caseTitle').textContent=model.title||Case.title;$('caseSubtitle').textContent=model.subtitle||'';$('totalLabel').textContent='总容量 '+human(model.root.bytes)+' · 精确 '+format(model.root.bytes)+' B';
  $('notes').replaceChildren(...(model.notes||[]).map(x=>mk('p',x,'footnote')));$('example').textContent=model.example||'';
  rememberedSpace={selected:selected.id,focus:focus.id,expanded:[...expanded]};renderBank();renderFlow();renderShortcuts();renderSpace();
 }catch(e){valid=false;lastBuildError=e.message;rememberedSpace={selected:oldSel,focus:oldFocus,expanded:oldExpanded};model=undefined;selected=undefined;focus=undefined;registry=new Map();expanded=new Set();$('error').textContent=e.message;$('error').hidden=false;$('live').hidden=true;$('detail').hidden=false;$('selectedLabel').textContent='当前输入未生成空间树；右侧显示本次诊断';$('totalLabel').textContent='当前参数尚未形成有效空间布局';$('caseSubtitle').textContent='当前输入待校验 · 右侧解释参数含义与限制';}
 diagnoseCurrent();renderCurrentInspector();if(inspectorMode==='parameter'||inspectorMode==='diagnosis')$('codePane').scrollTop=oldRightTop;
}
function renderShortcuts(){$('shortcuts').replaceChildren();for(const s of model.shortcuts||[])$('shortcuts').append(button(s.label,()=>visit(s.id,true)));}
function renderBank(){const box=$('bankPanel');box.hidden=!(model.bankPairs?.length);if(box.hidden)return;$('bankPairs').replaceChildren();for(const pair of model.bankPairs){const n=mk('div',undefined,'bank-pair'+(pair.bank===bank?' selected':''));n.dataset.bank=String(pair.bank);n.append(mk('strong','Bank '+pair.bank+(pair.bank===bank?' · 本轮选中':' · 另一物理份')));for(const [id,label]of [[pair.stateId,'状态'],[pair.windowId,'token']]){const node=resolve(id),b=button(label+'：'+human(node.bytes)+' · +'+format(node.absolute)+' B',()=>drill(node));b.style.setProperty('--node-color',color(node));n.append(b);if(label==='状态')n.append(mk('div','同一个 dataState_ 配对选择 ↓','pair-link'));}$('bankPairs').append(n);}
 for(const b of $('bankSwitch').querySelectorAll('button[data-bank]'))b.setAttribute('aria-pressed',String(+b.dataset.bank===bank));
}
function renderFlow(){$('allocationFlow').replaceChildren();for(const s of model.allocationFlow||[]){const b=button(s.label,()=>s.id?visit(s.id):showEvidence(s.label,s.detail,s.evidence));b.append(mk('small',s.detail));$('allocationFlow').append(b);}}
function renderSpace(){renderCrumbs();renderTree();renderMap();}
function renderCrumbs(){$('breadcrumbs').replaceChildren();for(const [i,n]of path(focus).entries()){if(i)$('breadcrumbs').append(mk('span','/'));$('breadcrumbs').append(button(n.label,()=>drill(n)));}$('focusTitle').textContent=focus.label;$('focusSize').textContent=format(focus.bytes)+' B · '+human(focus.bytes);$('up').disabled=!focus.parent;}
function renderTree(){if(!valid)return;const body=$('treeBody'),wrap=body.closest('.tree-wrap'),oldTop=wrap.scrollTop,oldLeft=$('visualPane').scrollTop;body.replaceChildren();let rows=0;
 function row(node,depth){if(++rows>320)return;normalize(node);const tr=mk('tr');tr.dataset.node=node.id;if(selected.id===node.id)tr.className='selected';const td=mk('td'),name=mk('div',undefined,'tree-name');name.style.paddingLeft=Math.min(depth,10)*12+'px';const branch=isBranch(node),toggle=button(branch?(expanded.has(node.id)?'▾':'▸'):'·',()=>{if(!branch)return;if(expanded.has(node.id))expanded.delete(node.id);else{getChildren(node);expanded.add(node.id);}renderTree();},'toggle');toggle.setAttribute('aria-label',(expanded.has(node.id)?'收起 ':'展开 ')+node.label);toggle.setAttribute('aria-expanded',String(expanded.has(node.id)));if(!branch)toggle.disabled=true;const dot=mk('span',undefined,'node-dot');dot.style.setProperty('--node-color',color(node));const label=button(node.label,()=>select(node),'node-select');label.title=node.id;name.append(toggle,dot,label);td.append(name);const interval=mk('div','父区 ['+format(node.offset)+', '+format(node.offset+node.bytes)+') B','small tree-interval');interval.style.paddingLeft=(Math.min(depth,10)*12+33)+'px';td.append(interval);
 const size=mk('td',undefined,'bytes');size.append(mk('div',human(node.bytes)),mk('small',format(node.bytes)+' B','small'));const share=mk('td',undefined,'bytes'),pct=percent(node.bytes,node.parent?.bytes||node.bytes);share.append(mk('div',pct<.01&&pct>0?'<0.01%':pct.toFixed(2)+'%'));const track=mk('div',undefined,'share-track'),fill=mk('div',undefined,'share-fill');fill.style.width=pct+'%';fill.style.setProperty('--node-color',color(node));track.append(fill);share.append(track);const action=mk('td');if(branch)action.append(button('进入',()=>drill(node),'drill'));else action.append(mk('span',typeName[node.kind]||'字段','small'));tr.append(td,size,share,action);body.append(tr);if(branch&&expanded.has(node.id))for(const c of getChildren(node))row(c,depth+1);
 }
 row(focus,0);$('treeLimit').hidden=rows<=320;$('selectedLabel').textContent='选中：'+selected.label;wrap.scrollTop=oldTop;$('visualPane').scrollTop=oldLeft;
}
function renderMap(){if(!valid)return;const area=$('treemap');area.replaceChildren();const children=getChildren(focus),items=children.length?children:[focus],w=area.clientWidth,h=area.clientHeight;if(!w||!h)return;
 const rects=Core.treemap(items,w,h);for(const r of rects){const node=items.find(n=>n.id===r.id);if(!node||r.w<=0||r.h<=0)continue;const tile=button('',()=>select(node),'tile'+(selected.id===node.id?' selected':''));tile.dataset.node=node.id;tile.dataset.kind=node.kind;tile.style.left=r.x+'px';tile.style.top=r.y+'px';tile.style.width=r.w+'px';tile.style.height=r.h+'px';tile.style.setProperty('--node-color',color(node));tile.title=node.label+'\n'+format(node.bytes)+' B\n占当前层 '+percent(node.bytes,focus.bytes).toFixed(4)+'%\n单击看解释；双击进入';tile.setAttribute('aria-label',node.label+'，'+format(node.bytes)+' B');tile.addEventListener('dblclick',()=>drill(node));if(r.w>=74&&r.h>=44){const label=mk('span',node.label,'tile-label');label.append(mk('small',human(node.bytes)));tile.append(label);}area.append(tile);}
 const zero=items.filter(n=>n.bytes===0n);$('mapNote').textContent='矩形面积 = 本层字节占比。很小的区可从上方树表进入；空间顺序看树表与右侧地址路径。'+(zero.length?' 本层另有 '+zero.length+' 个0 B子区，在树表保留，面积为0。':'');
 $('currentMapTotal').textContent='当前层 '+format(focus.bytes)+' B = 子空间 '+format(children.length?children.reduce((s,n)=>s+n.bytes,0n):focus.bytes)+' B';
}
function renderSources(target,proof){for(const p of proof){const article=mk('article',undefined,'source-card');article.dataset.evidence=p.id||'';const label=mk('div',undefined,'source-label');label.append(mk('strong',p.role||'源码证据'));if(p.fn)label.append(mk('div',p.fn,'small'));label.append(mk('div',(p.file||'已标注来源')+(p.start?':'+p.start+(p.end&&p.end!==p.start?'–'+p.end:''):''),'source-path'));const pre=mk('pre');const lines=String(p.code||'无独立赋值语句；由相邻字段边界推导。').split('\n');for(let i=0;i<lines.length;i++){const line=mk('span',undefined,'code-line');line.append(mk('span',p.start?String(p.start+i):'','line-number'));for(const seg of Core.highlightSegments(lines[i],p.highlights||[]))line.append(mk(seg.highlight?'mark':'span',seg.text));pre.append(line);}article.append(label,pre);target.append(article);}}
function addCoordinateView(target,n){const steps=path(n),section=mk('div');section.append(mk('h3','基地址坐标：从父 allocation 一层层进入'),mk('p','下面每个框是上一框的一部分。加上本层offset就得到它在父区中的位置；图中的箭头表示包含与换零点。','small'));const stack=mk('div',undefined,'coordinate-path');for(const item of steps){const b=mk('div',undefined,'coordinate-step');b.append(mk('strong',item.label));const line=item.parent?'父区内 ['+format(item.offset)+', '+format(item.offset+item.bytes)+') B':'本allocation相对坐标 [0, '+format(item.bytes)+') B';b.append(mk('div',line,'mono'),mk('div','allocation起点 + '+format(item.absolute)+' B；跨度 '+format(item.bytes)+' B','small'));if(item.parent){const bar=mk('div',undefined,'address-bar'),part=mk('i');part.style.left=percent(item.offset,item.parent.bytes)+'%';part.style.width=percent(item.bytes,item.parent.bytes)+'%';bar.append(part);b.append(bar,mk('div','上条在父空间中按真实比例定位；下个框重新放大。','small'));}if(item.id!==n.id)b.append(button('查看这一层的公式与源码',()=>select(item), 'drill'));stack.append(b);}section.append(stack);target.append(section);}
function effectiveAddress(n){for(let a=n;a;a=a.parent){if(!a.address)continue;const extra=n.absolute-a.absolute;if(!extra)return a.address;const x=a.address;return {...x,byteOffset:x.byteOffset+extra,elementIndex:x.elementBytes?(x.byteOffset+extra)/x.elementBytes:undefined,terms:[...x.terms,{label:'进入当前子字段',expression:'所选字段相对 '+a.label+' 的偏移',value:extra,unit:'B',nodeId:n.id}]};}return null;}
function baseGraph(entries){const group=mk('div',undefined,'base-forest'),byId=new Map(entries.map(e=>[e.id,e]));function walk(a){const wrap=mk('div',undefined,'base-branch'),parent=byId.get(a.parentId);if(parent)wrap.append(mk('div','↓ +'+format(a.offset-parent.offset)+' B（从 '+parent.label+' 起）','base-edge'));const card=mk('div',undefined,'base-card');card.append(mk('strong',a.label),mk('div','相对 shmemBuffer_：+'+format(a.offset)+' B','small'));const aliases=mk('div',undefined,'code-names');for(const [i,name]of (a.codeNames||[]).entries()){if(i)aliases.append(mk('span','≡'));aliases.append(mk('code',name));}card.append(aliases);if(a.explanation)card.append(mk('p',a.explanation,'small'));if(resolve(a.id))card.append(button('进入这段空间',()=>visit(a.id,true),'drill'));wrap.append(card);const children=entries.filter(e=>e.parentId===a.id);if(children.length){const sub=mk('div',undefined,'base-children');for(const c of children)sub.append(walk(c));wrap.append(sub);}return wrap;}for(const e of entries.filter(e=>!e.parentId||!byId.has(e.parentId)))group.append(walk(e));return group;}
function addSymbols(target,n){const text=[n.formula?.expression,...(effectiveAddress(n)?.terms||[]).map(t=>t.expression)].join(' ');const matches=(model.symbols||[]).filter(s=>new RegExp('(^|[^A-Za-z0-9_])('+s.id+'|'+s.codeName+')([^A-Za-z0-9_]|$)').test(text));if(!matches.length)return;const d=mk('div',undefined,'definition-list');for(const s of matches){d.append(mk('code',s.id+' = '+format(s.value)+' '+s.unit),mk('span',s.codeName+'：'+s.meaning));}target.append(d);}
function addAddress(target,n){const a=effectiveAddress(n);if(!a)return;const base=resolve(a.baseId),card=mk('div',undefined,'formula');card.append(mk('h3','把源码下标递归拆成空间项'));const list=mk('ol',undefined,'terms');for(const t of a.terms||[]){const li=mk('li');li.append(mk('strong',t.label+'：'),mk('code',t.expression),mk('span',' = '+format(t.value)+' '+t.unit));if(t.nodeId)li.append(button('进入对应子空间',()=>visit(t.nodeId,true)));list.append(li);}card.append(list);card.append(mk('p','相对 '+(base?.label||a.baseId)+' 的字节偏移 = '+(a.terms||[]).map(x=>format(x.value)).join(' + ')+' = '+format(a.byteOffset)+' B','mono'));if(a.elementBytes){card.append(mk('p','Tensor的[]按元素计数：'+format(a.byteOffset)+' B ÷ '+a.elementBytes+' B/元素 = 下标 '+format(a.elementIndex),'mono'),mk('p','因此 /sizeof(float) 只改变下标单位；它没有再划分或申请空间。4 × 元素下标会回到同一个字节地址。','small'));}if(base)card.append(mk('p','最终地址 = shmemBuffer_ + '+format(base.absolute)+' + '+format(a.byteOffset)+' = shmemBuffer_ + '+format(base.absolute+a.byteOffset)+' B','mono'));target.append(card);}
function addAliases(target,n){const entries=model.baseEntries||[];if(!entries.length)return;const d=mk('details');d.open=!!n.address;d.append(mk('summary','真实源码基址与别名：它们在同一块内哪里？'));d.append(mk('p','以下offset都相对本Rank的shmemBuffer_。StateBank等名称是图上的空间标签；源码对象用等宽高亮显示。','small'));d.append(baseGraph(entries));const explanations=mk('details');explanations.append(mk('summary','各基址的绑定源码与限定条件'));for(const a of entries){const row=mk('div',undefined,'alias');row.append(mk('strong',a.label+' · +'+format(a.offset)+' B'));const code=mk('div',undefined,'code-names');for(const name of a.codeNames||[])code.append(mk('code',name));row.append(code,mk('p',a.explanation));if(resolve(a.id))row.append(button('在空间树定位',()=>visit(a.id,true),'drill'));row.append(button('查看绑定源码',()=>showEvidence(a.label,a.explanation,a.evidence),'drill'));explanations.append(row);}d.append(explanations);target.append(d);}
function addMatrix(target,n){if(!n.matrix)return;const {rows,cols,rowLabel,colLabel}=n.matrix;if(rows>16n||cols>16n)return;const div=mk('div');div.append(mk('h3','每个32 B格为什么重复？'),mk('p','生产核p连续写一整行；消费核q跨行读取自己的一列，并只清这一列。每个消费者需要独立完成标志，所以同一个sum要复制U份。','small'));const grid=mk('div',undefined,'matrix');grid.style.gridTemplateColumns='66px repeat('+cols+',minmax(0,1fr))';grid.append(mk('span','写 ↓ / 读 →','matrix-head'));for(let j=0n;j<cols;j++)grid.append(mk('span',colLabel+'='+j,'matrix-head'));for(let i=0n;i<rows;i++){grid.append(button(rowLabel+'='+i,()=>visit(n.id+'/p'+i,true),'matrix-head'));for(let j=0n;j<cols;j++)grid.append(button('sum / flag\np'+i+' → q'+j,()=>visit(n.id+'/p'+i+'/q'+j,true)));}div.append(grid);if(rows===1n)div.append(mk('p','当前U=1，复制关系退化成一格。用左侧“2个CumSum核”预设查看2×2矩阵。','notice'));div.append(mk('p','写行：起点 (RR×32 + p×U×32)/4，连续复制U个32 B块。读列：起点 (RR×32 + q×32)/4，每次读32 B，再跳(U−1)个32 B块。','small'));target.append(div);}
function getSpaceExplanation(n){
 if(typeof Case.explainSpace!=='function')return null;
 try{return Case.explainSpace(n,model.values)||null;}catch(error){return {purpose:['详细解释生成失败：'+error.message],boundaries:['当前说明不完整，请重新生成并验证产物。']};}
}
function explanationNavigation(target,explanation){
 if(!explanation)return;
 const nav=mk('div',undefined,'space-reading-nav');nav.setAttribute('aria-label','当前空间的阅读导航');
 for(const [id,label]of [['space-purpose','为什么需要'],['space-formula','公式详解'],['space-lifecycle','何时使用'],['space-source','源码与地址']])nav.append(button(label,()=>{const section=$(id);if(!section)return;const pane=$('codePane');pane.scrollTop+=section.getBoundingClientRect().top-pane.getBoundingClientRect().top-pane.querySelector('.pane-top').offsetHeight-10;},'drill'));
 target.append(nav);
}
function appendSpacePurpose(target,x){if(!x)return;const section=mk('section',undefined,'space-narrative');section.id='space-purpose';section.append(mk('h3','为什么需要这段空间？'));for(const p of x.purpose||[])section.append(mk('p',p));target.append(section);}
function appendFormulaReasoning(target,x){
 if(!x)return;const section=mk('section',undefined,'space-narrative');
 if(x.formulaSteps?.length){section.append(mk('h3','沿着公式逐项推导'));const steps=mk('ol',undefined,'formula-walk');for(const s of x.formulaSteps){const li=mk('li');li.append(mk('strong',s.label),mk('div',s.expression,'equation mono'),mk('div','当前代入：'+s.substitution,'small mono'),mk('p',s.reason));steps.append(li);}section.append(steps);}
 if(x.necessity?.length){section.append(mk('h3','这些份数与布局能直接省掉吗？'));for(const p of x.necessity)section.append(mk('p',p));}
 if(x.example?.length){const example=mk('div',undefined,'worked-space-example');example.append(mk('h3','用当前参数走一遍'));for(const p of x.example)example.append(mk('p',p));section.append(example);}
 target.append(section);
}
function appendSpaceLifecycle(target,x){
 if(!x)return;const section=mk('section',undefined,'space-narrative');section.id='space-lifecycle';section.append(mk('h3','谁在何时使用它？'));
 const timeline=mk('ol',undefined,'space-lifecycle');for(const step of x.lifecycle||[]){const li=mk('li');li.append(mk('strong',step.phase+' · '+step.actor));if(step.condition)li.append(mk('p','发生条件：'+step.condition,'lifecycle-condition'));li.append(mk('p',step.action));if(step.evidence?.length){const proof=mk('details');proof.append(mk('summary','核对这一步的源码 · '+step.evidence.map(e=>e.fn+' L'+e.start+'–'+e.end).join(' / ')));renderSources(proof,step.evidence);li.append(proof);}timeline.append(li);}section.append(timeline);
 if(x.boundaries?.length){const boundaries=mk('div',undefined,'narrative-boundary');boundaries.append(mk('strong','源码事实与解释边界'));for(const p of x.boundaries)boundaries.append(mk('p',p));section.append(boundaries);}
 if(x.related?.length){const links=mk('div',undefined,'actions');for(const item of x.related)links.append(button('继续看：'+item.label,()=>visit(item.id,true),'drill'));section.append(links);}
 target.append(section);
}
function renderInspector(){
 if(!valid)return;
 const n=normalize(selected),div=$('detail'),x=getSpaceExplanation(n);div.replaceChildren();
 div.append(mk('span',typeName[n.kind]||'组合空间','tag'),mk('span','相对allocation +'+format(n.absolute)+' B','tag'),mk('h2',n.label),mk('p',n.why||n.formula?.why||''));
 const codeNames=mk('div',undefined,'code-names');for(const name of n.codeNames||[])codeNames.append(mk('code',name));div.append(codeNames,mk('p','黄色高亮对应真实源码标识符。下面按必要性、公式因子、使用时序逐步解释。','highlight-key'));
 explanationNavigation(div,x);appendSpacePurpose(div,x);
 const formulaSection=mk('section');formulaSection.id='space-formula';const f=n.formula;
 if(f){const c=mk('div',undefined,'formula');c.append(mk('h3','这个子空间为什么占这些字节？'),mk('div',f.expression,'equation'),mk('p','当前代入：'+f.substitution,'mono'),mk('strong',format(n.bytes)+' B · '+human(n.bytes),'result'),mk('p',f.why));formulaSection.append(c);}
 appendFormulaReasoning(formulaSection,x);addSymbols(formulaSection,n);div.append(formulaSection);
 const bankAncestor=path(n).find(a=>a.bank!==undefined);if(bankAncestor&&bankAncestor.bank!==bank)div.append(mk('p','当前查看Bank '+bankAncestor.bank+'的物理容量；当前演示dataState_='+bank+'。以下getter只有在dataState_='+bankAncestor.bank+'时才指向所选这份空间。','notice'));
 appendSpaceLifecycle(div,x);
 const sourceSection=mk('section');sourceSection.id='space-source';const proofs=n.evidence||[];
 if(proofs.length){sourceSection.append(mk('h3','对应源码 · 高亮本空间对象'));renderSources(sourceSection,proofs.slice(0,1));if(proofs.length>1){const more=mk('details');more.append(mk('summary','另外 '+(proofs.length-1)+' 段构造 / 消费证据'));renderSources(more,proofs.slice(1));sourceSection.append(more);}}
 const actions=mk('div',undefined,'actions selection-actions');if(isBranch(n))actions.append(button('在左侧进入此空间',()=>drill(n)));if(n.parent)actions.append(button('看父空间',()=>select(n.parent)));sourceSection.append(actions);addAddress(sourceSection,n);addMatrix(sourceSection,n);
 if(n.packedRange){const [lo,hi]=n.packedRange;sourceSection.append(mk('h3','packed 坐标如何变成物理坐标？'),mk('p','本片段在packed中为 ['+lo+', '+hi+') B。每480 B packed数据后插入32 B trailer，因此：','small'),mk('p','物理 token 偏移 = floor(t/480)×512 + t%480','mono'),mk('p','片段起点 t='+lo+' → '+(lo/480n)+'×512 + '+(lo%480n)+' = '+((lo/480n)*512n+lo%480n)+' B','mono'));}
 addCoordinateView(sourceSection,n);addAliases(sourceSection,n);div.append(sourceSection);$('codePane').scrollTop=0;
}

function bankExplanation(){if(!valid)return showDiagnostic();inspectorMode='bank';const d=model.values;if(!d||!model.bankPairs?.length)return;const div=$('detail');div.replaceChildren(mk('h2','Bank：同一块申请中的两对可选空间'),mk('p','每Rank始终保留两份状态区、两份token窗口。dataState_是一个0/1选择值；本次调用选择编号相同的一份状态区和一份token窗口。它们处理同一轮，但在allocation中处于不同位置。'));
 const g=mk('div',undefined,'bank-addresses');for(const pair of model.bankPairs){const s=resolve(pair.stateId),w=resolve(pair.windowId),card=mk('div',undefined,'bank-address');card.append(mk('strong','dataState_ = '+pair.bank+(pair.bank===bank?'（当前演示）':'')),mk('p','状态：+ '+format(s.absolute)+' B，跨度 '+human(s.bytes)),mk('p','token：+ '+format(w.absolute)+' B，跨度 '+human(w.bytes)),button('进入状态Bank '+pair.bank,()=>drill(s)),button('进入token Bank '+pair.bank,()=>drill(w)));g.append(card);}div.append(g,mk('p','状态地址 = 共同状态起点 + dataState_×384 KiB','mono'),mk('p','token地址 = token池起点 + dataState_×(tokenWinSize/2)','mono'),mk('p','切换只移动这两组基址。stage、staging、URMA预留、selector仍在各自固定位置，本次模拟的 '+human(model.root.bytes)+'（'+format(model.root.bytes)+' B）总容量不会变化。','notice'),mk('p','InitWinState的定义未随附件提供，因此按钮仅展示“如果返回0/1，地址分别在哪里”，不模拟未知的自动翻转时序。flagPadOffset_是UB中另一套双缓冲，未画入本SHMEM allocation。','small'));
 if(Object.prototype.hasOwnProperty.call(params,'AM'))div.append(mk('p','allocation 大小由当前 AM 模拟输入决定。调整 AM 只用于规划容量；本页没有修改 Host/Device 中的申请或常量，也没有重新申请设备内存。','simulation-note'));
 addAliases(div,model.root);const all=[...resolve('state'+bank).evidence,...resolve('window'+bank).evidence];renderSources(div,all);$('codePane').scrollTop=0;if(innerWidth<=900)switchPane('code');}
function setup(){
 for(const p of Case.parameters){
  params[p.id]=String(p.value??'');const control=mk('div',undefined,'parameter-control'),head=mk('div',undefined,'parameter-heading'),label=mk('label',p.label),small=mk('small',p.codeName||p.id),input=mk('input');
  input.id='param-'+p.id;label.htmlFor=input.id;input.type='text';input.inputMode='numeric';input.value=params[p.id];input.setAttribute('aria-label',p.label);
  const help=button('?',()=>showParameter(p.id,{reveal:true}),'parameter-help');help.id='help-'+p.id;help.setAttribute('aria-label','解释参数 '+p.label);help.title='查看含义、限制来源、影响空间和当前诊断';
  input.addEventListener('focus',()=>showParameter(p.id,{reveal:false}));input.addEventListener('input',()=>{params[p.id]=input.value;activeParameter=p.id;inspectorMode='parameter';refresh();});
  head.append(label,help);control.append(head,small,input);$('controls').append(control);
 }
 for(const preset of Case.presets)$('presets').append(button(preset.label,()=>applySimulation(preset.values)));
 const nav=$('showSelected').parentElement,parametersButton=button('参数与限制',()=>showParameter(activeParameter||Case.parameters[0].id,{reveal:true})),diagnosisButton=button('容量诊断',()=>showDiagnostic());parametersButton.id='showParameters';diagnosisButton.id='showDiagnosis';nav.append(parametersButton,diagnosisButton);
 const calculatorNote=$('calculator').querySelector('p.small');if(calculatorNote)calculatorNote.textContent='聚焦参数查看右侧解释，点“?”查看含义与限制。输入会重算；超限时隐藏旧空间树，并显示当前参数的容量诊断。所有操作仅用于本页模拟。';
 $('mobileVisual').addEventListener('click',()=>switchPane('visual'));$('mobileCode').addEventListener('click',()=>switchPane('code'));$('up').addEventListener('click',()=>{if(focus?.parent)drill(focus.parent);});$('root').addEventListener('click',()=>drill(model?.root));$('explainBank').addEventListener('click',bankExplanation);$('showSelected').addEventListener('click',()=>{if(!valid)return showDiagnostic();inspectorMode='space';renderInspector();});$('showBases').addEventListener('click',()=>{if(!valid)return showDiagnostic();inspectorMode='bases';const div=$('detail');div.replaceChildren(mk('h2','基地址与视图的坐标关系'));addAliases(div,{address:true});$('codePane').scrollTop=0;});
 for(const b of $('bankSwitch').querySelectorAll('button[data-bank]'))b.addEventListener('click',()=>{const old=bank;bank=+b.dataset.bank;if(selected?.id.startsWith('state'+old)||selected?.id.startsWith('window'+old)){const replacement=selected.id.replace(new RegExp('^(state|window)'+old),'$1'+bank);selected={id:replacement};}if(focus?.id.startsWith('state'+old)||focus?.id.startsWith('window'+old))focus={id:focus.id.replace(new RegExp('^(state|window)'+old),'$1'+bank)};refresh();});
 let resize;addEventListener('resize',()=>{clearTimeout(resize);resize=setTimeout(renderMap,100);});refresh();
 globalThis.MemoryReader={getState:()=>({selected:selected?.id,focus:focus?.id,bank,valid,registered:registry.size,inspectorMode,activeParameter,diagnosisOk:currentDiagnosis?.ok}),refresh,resolve,showParameter,showDiagnostic};
}
setup();
})();
