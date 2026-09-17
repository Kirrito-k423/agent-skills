// 可复用的容量、流程、符号、证据和坐标视图；只渲染模型，不执行公式文本。
function unitBlocks(bytes,unit,page=0n,limit=128n){
  ensure(typeof bytes==='bigint'&&bytes>=0n&&typeof unit==='bigint'&&unit>0n,'单位方块需要非负字节和正单位');
  ensure(page>=0n&&limit>0n&&limit<=256n,'单位方块分页参数无效');
  const full=bytes/unit,remainder=bytes%unit,count=full+(remainder?1n:0n),pages=max(1n,(count+limit-1n)/limit);
  const active=min(page,pages-1n),start=active*limit,end=min(start+limit,count),cells=[];
  for(let i=start;i<end;i++)cells.push({index:i,bytes:i<full?unit:remainder});
  return {bytes,unit,full,remainder,count,pages,page:active,start,end,cells};
}
function coordinates(allocation,region){
  const base=region.codeBase?region.codeBase.offset:region.offset;
  ensure(base>=0n&&base<=region.offset&&region.offset+region.reserved<=allocation.bytes,'坐标换算超出父空间');
  return {parentBytes:allocation.bytes,parentStart:region.offset,parentEnd:region.offset+region.reserved,
    baseOffset:base,localStart:region.offset-base,localEnd:region.offset+region.reserved-base};
}
function assertVisualContract(model){
  const evidence=e=>ensure(e&&e.source&&e.code,'缺少申请、切片、符号或流程源码证据');
  ensure(Array.isArray(model.symbols)&&model.symbols.length>0,'缺少符号表');
  const symbols=new Set();for(const s of model.symbols){ensure(s.id&&!symbols.has(s.id)&&s.meaning&&s.unit&&s.codeName&&s.value!==undefined,'符号定义不完整或重复');symbols.add(s.id);evidence(s.evidence);}
  const checkSymbols=xs=>{ensure(Array.isArray(xs),'缺少就地符号释义');for(const id of xs)ensure(symbols.has(id),'使用了未定义符号');};
  for(const a of model.allocations){evidence(a.allocationEvidence);ensure(a.baseName,'allocation 缺少基址名称');for(const r of a.regions){evidence(r.placementEvidence);checkSymbols(r.symbols);coordinates(a,r);}}
  for(const f of model.derivations)checkSymbols(f.symbols);
  ensure(Array.isArray(model.flows)&&model.flows.length>0,'缺少生命周期流程图');
  for(const flow of model.flows){ensure(flow.id&&flow.title&&flow.width>0&&flow.height>0&&flow.nodes.length>0,'流程图定义不完整');const ns=new Map(flow.nodes.map(n=>[n.id,n]));ensure(ns.size===flow.nodes.length,'流程节点 ID 重复');for(const n of flow.nodes){ensure(n.lines.length>0&&n.x>=0&&n.y>=0,'流程节点缺少标签或位置');evidence(n.evidence);if(n.kind==='decision')ensure(flow.edges.filter(e=>e.from===n.id).length>=2,'判断节点缺少两条分支');}for(const e of flow.edges)ensure(ns.has(e.from)&&ns.has(e.to)&&e.label,'流程边缺少端点或关系说明');}
  if(model.epoch){ensure(model.epoch.banks===2,'双缓冲模型必须有两个 bank');evidence(model.epoch.evidence);}
  return model;
}
function makeSplitReader({el}){
  const views={region:['detailSection','showRegion'],flow:['flowDetail','showFlow'],symbol:['symbolDetail','showSymbol']};
  const labels={region:'所选空间模块',flow:'点击左侧流程节点或申请入口',symbol:'点击左侧符号查看定义'};
  function mobile(pane){el('readerLayout').dataset.mobilePane=pane;el('mobileVisual').setAttribute('aria-pressed',String(pane==='visual'));el('mobileCode').setAttribute('aria-pressed',String(pane==='code'));}
  function show(kind,label,reset=true,reveal=true){
    if(label)labels[kind]=label;
    for(const [key,[panel,button]] of Object.entries(views)){el(panel).hidden=key!==kind;el(button).setAttribute('aria-pressed',String(key===kind));}
    el('inspectorSelection').textContent=labels[kind];
    if(reset)el('codePane').scrollTop=0;
    if(reveal)mobile('code');
  }
  for(const [kind,[,button]] of Object.entries(views))el(button).addEventListener('click',()=>show(kind));
  el('mobileVisual').addEventListener('click',()=>mobile('visual'));el('mobileCode').addEventListener('click',()=>mobile('code'));
  for(const [button,target] of [['navSpace','proofSection'],['navCapacity','capacitySection'],['navFlow','lifecycleSection'],['navLedger','allocationSection'],['navBytes','byteSection']])el(button).addEventListener('click',()=>{mobile('visual');if(el(target).scrollIntoView)el(target).scrollIntoView({block:'start'});});
  return {show};
}
function makeVisualRenderer(ctx){
  const {el,make,getModel,regionButton,reader}=ctx,ns='http://www.w3.org/2000/svg';
  let unitChoice='auto',scope='allocations',round=0,unitPages=new Map();
  function svg(tag,attrs={},text){const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;return n;}
  const ratio=(n,d)=>d===0n?0:Number(n*1000000000n/d)/1000000000;
  function evidencePanel(title,e,open=false){const details=make('details');details.className='evidence-panel';details.open=open;details.append(make('summary',title+' · '+e.source),make('pre',e.code));return details;}
  function sourceLink(title,e){const b=make('button',title+' · 右侧查看');b.type='button';b.title=e.source;b.addEventListener('click',()=>{el('flowEvidence').replaceChildren(evidencePanel(title,e,true));reader.show('flow',title);});return b;}
  function symbolsFor(ids){const box=make('div');box.className='symbol-inline';for(const id of ids){const s=getModel().symbols.find(s=>s.id===id),b=make('button',`${s.id} = ${s.value} ${s.unit} · ${s.meaning}`);b.type='button';b.title=`源码变量：${s.codeName}；${s.evidence.source}`;b.addEventListener('click',()=>{el('symbolEvidence').replaceChildren(evidencePanel(s.id+'：'+s.codeName,s.evidence,true));reader.show('symbol',s.id+'：'+s.meaning);});box.appendChild(b);}return box;}
  function renderSymbols(){const m=getModel();el('symbols').replaceChildren(symbolsFor(m.symbols.map(s=>s.id)));el('symbolEvidence').replaceChildren();}
  const choices=[['auto','自动单位'],['1024','1 KiB / 格'],['1048576','1 MiB / 格'],['104857600','100 MiB / 格']];
  for(const [value,label] of choices){const b=make('button',label);b.type='button';b.dataset.unit=value;b.addEventListener('click',()=>{unitChoice=value;unitPages.clear();renderCapacity();});el('unitControls').appendChild(b);}
  function capacityItems(){const m=getModel();if(scope==='allocations')return m.allocations.map((a,i)=>({id:a.id,label:a.label,bytes:a.bytes,color:['#7356b8','#287db3','#19856c'][i%3]}));return m.allocations.find(a=>a.id===scope).regions.map(r=>({id:r.id,label:r.label,bytes:r.reserved,color:r.color,region:r}));}
  function renderCapacity(){
    const m=getModel();if(!m)return;
    if(scope!=='allocations'&&!m.allocations.some(a=>a.id===scope))scope='allocations';
    el('capacityScopes').replaceChildren();for(const [id,label] of [['allocations',m.allocations.length+' 块独立申请'],...m.allocations.map(a=>[a.id,a.baseName+' 内部分区'])]){const b=make('button',label);b.type='button';b.setAttribute('aria-pressed',String(id===scope));b.addEventListener('click',()=>{scope=id;unitPages.clear();renderCapacity();});el('capacityScopes').appendChild(b);}
    const items=capacityItems(),largest=items.reduce((n,i)=>max(n,i.bytes),0n);
    let unit=unitChoice==='auto'?1024n:BigInt(unitChoice);if(unitChoice==='auto'){if(largest>128n*unit)unit=MiB;if(largest>128n*unit)unit=100n*MiB;}
    for(const b of el('unitControls').children)b.setAttribute('aria-pressed',String(b.dataset.unit===unitChoice));
    el('unitLegend').textContent=`统一尺度：一个满色正方形 = ${formatBytes(unit)}；完整格 18×18 px。尾格只按余数比例填色，未填区域不计入容量。每部分最多显示 128 格，超出时分页；这里比较的是彩色面积，卡片外框不表示容量。`;
    el('capacityBlocks').replaceChildren();
    for(const item of items){const view=unitBlocks(item.bytes,unit,unitPages.get(item.id)||0n),card=make('article');card.className='unit-card';card.dataset.capacity=item.id;
      card.append(make('h3',item.label),make('strong',formatBytes(item.bytes)),make('p',`${view.full} 个整格 + ${view.remainder} / ${unit} 个尾格；${view.full} × ${unit} + ${view.remainder} = ${view.bytes} B`));
      const grid=make('div');grid.className='unit-grid';for(const cell of view.cells){const tile=make('span');tile.className='unit-tile';tile.dataset.bytes=String(cell.bytes);tile.dataset.unit=String(unit);const fill=make('span');fill.className='unit-fill';fill.style.width=ratio(cell.bytes,unit)*100+'%';fill.style.background=item.color;tile.title=`第 ${cell.index+1n} 格：${cell.bytes} / ${unit} B；面积 ${percentage(cell.bytes,unit)}`;tile.setAttribute('aria-label',tile.title);tile.appendChild(fill);grid.appendChild(tile);}card.appendChild(grid);
      if(view.remainder&&ratio(view.remainder,unit)*18<1)card.appendChild(make('p','尾格不足 1 像素宽，按真实比例保留；切换更小单位或进入局部空间查看，未人为放大。'));
      const actions=make('div');actions.className='actions';const prev=make('button','前 128 格'),next=make('button','后 128 格');prev.type=next.type='button';prev.disabled=view.page===0n;next.disabled=view.page+1n>=view.pages;prev.addEventListener('click',()=>{unitPages.set(item.id,view.page-1n);renderCapacity();});next.addEventListener('click',()=>{unitPages.set(item.id,view.page+1n);renderCapacity();});actions.append(prev,next,make('small',`显示格 [${view.start}, ${view.end}) / 共 ${view.count} 格；第 ${view.page+1n}/${view.pages} 页`));if(item.region)actions.appendChild(regionButton(item.region));card.appendChild(actions);el('capacityBlocks').appendChild(card);
    }
  }
  function renderFlow(flow){
    const panel=make('article');panel.className='flow-panel';panel.append(make('h3',flow.title),make('p',flow.note||'实线表示执行路径；虚线表示数据或标志依赖。点击节点查看该步骤源码。'));
    const canvas=svg('svg',{viewBox:`0 0 ${flow.width} ${flow.height}`,role:'group','aria-label':flow.title,class:'flow-svg'});
    const defs=svg('defs'),marker=svg('marker',{id:'arrow-'+flow.id,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto'});marker.appendChild(svg('path',{d:'M0,0 L10,5 L0,10 Z',fill:'#527292'}));defs.appendChild(marker);canvas.appendChild(defs);
    const nodes=new Map(flow.nodes.map(n=>[n.id,n]));
    for(const e of flow.edges){const a=nodes.get(e.from),b=nodes.get(e.to),w=a.w||220,h=a.h||68,bw=b.w||220;
      const points=e.points||[[a.x+w/2,a.y+h],[a.x+w/2,(a.y+h+b.y)/2],[b.x+bw/2,(a.y+h+b.y)/2],[b.x+bw/2,b.y]];
      canvas.appendChild(svg('polyline',{points:points.map(p=>p.join(',')).join(' '),fill:'none',stroke:e.dashed?'#9b772b':'#527292','stroke-width':2,'stroke-dasharray':e.dashed?'6 4':'none','marker-end':`url(#arrow-${flow.id})`}));
      const at=e.textAt||[(points[1][0]+points[2][0])/2,points[1][1]];canvas.appendChild(svg('text',{x:at[0]+6,y:at[1]-6,class:'flow-edge-label'},e.label));
    }
    for(const n of flow.nodes){const w=n.w||220,h=n.h||68,g=svg('g',{tabindex:0,role:'button','aria-label':n.lines.join('，')+'；查看源码','data-flow-node':n.id});
      g.appendChild(svg('rect',{x:n.x,y:n.y,width:w,height:h,rx:n.kind==='decision'?22:9,fill:n.kind==='decision'?'#fff1cc':'#eaf3fc',stroke:n.kind==='decision'?'#bb8a25':'#6a8fb4','stroke-width':2}));
      n.lines.forEach((line,i)=>g.appendChild(svg('text',{x:n.x+w/2,y:n.y+(h-n.lines.length*19)/2+16+i*19,'text-anchor':'middle',class:'flow-node-label'},line)));
      const show=()=>{el('flowEvidence').replaceChildren(evidencePanel(n.lines.join(' / '),n.evidence,true));reader.show('flow',n.lines.join(' / '));};g.addEventListener('click',show);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();show();}});canvas.appendChild(g);
    }
    const wrap=make('div');wrap.className='flow-scroll';wrap.appendChild(canvas);panel.appendChild(wrap);return panel;
  }
  function renderEpoch(){const m=getModel();el('epochView').replaceChildren();if(!m.epoch)return;
    const header=make('h3','同一布局连续三轮：读旧 epoch 选 bank，保存翻转值给下一轮');el('epochView').append(header);
    const controls=make('div');controls.className='actions';for(const [label,action] of [['下一轮',()=>round++],['模拟几何变化后的清零',()=>round=0]]){const b=make('button',label);b.type='button';b.addEventListener('click',()=>{action();renderEpoch();});controls.appendChild(b);}el('epochView').appendChild(controls);
    const rows=make('div');rows.className='epoch-grid';for(let i=0;i<3;i++){const r=round+i,bank=r%2,card=make('div');card.className='epoch-card';card.append(make('strong',`第 ${r+1} 轮 · 读 epoch=${bank}`),make('div',`状态 bank ${bank} + 接收 window ${bank}`),make('div',`写回 epoch=${1-bank} → 下一轮`),make('small','staging / Scratch 顺序复用，不新增申请'));card.dataset.bank=String(bank);rows.appendChild(card);}el('epochView').append(rows,make('p','这是源码状态机示意，不执行 kernel。几何参数变化清零后重新从 0 开始；不能由双 bank 推断多轮并发安全。'),sourceLink('epoch 读写与选择',m.epoch.evidence));
  }
  function renderLifecycle(){el('flowCharts').replaceChildren(...getModel().flows.map(renderFlow));el('flowEvidence').replaceChildren();renderEpoch();}
  function renderAddress(a,r){const c=coordinates(a,r),canvas=svg('svg',{viewBox:'0 0 1000 285',role:'img','aria-label':'父 allocation 与子区坐标转换',class:'address-svg'}),x=40,w=920;
    const left=x+w*ratio(c.parentStart,c.parentBytes),right=x+w*ratio(c.parentEnd,c.parentBytes);
    canvas.appendChild(svg('text',{x,y:24,class:'flow-node-label'},`${a.baseName}：父空间 [0, ${c.parentBytes}) B；上条按真实比例`));
    canvas.appendChild(svg('rect',{x,y:44,width:w,height:34,fill:'#e2e8ef'}));canvas.appendChild(svg('rect',{x:left,y:44,width:right-left,height:34,fill:'#297aab'}));
    canvas.appendChild(svg('text',{x,y:104,class:'flow-node-label'},`父 offset：${c.parentStart} → ${c.parentEnd}；子区跨度 ${r.reserved} B`));
    canvas.appendChild(svg('line',{x1:left,y1:78,x2:x,y2:150,stroke:'#527292','stroke-dasharray':'5 4'}));canvas.appendChild(svg('line',{x1:right,y1:78,x2:x+w,y2:150,stroke:'#527292','stroke-dasharray':'5 4'}));
    canvas.appendChild(svg('rect',{x,y:150,width:w,height:34,fill:'#297aab'}));
    canvas.appendChild(svg('text',{x,y:211,class:'flow-node-label'},`下条放大该切片：局部 [${c.localStart}, ${c.localEnd}) B；基址 = ${a.baseName} + ${c.baseOffset}`));
    canvas.appendChild(svg('text',{x,y:242,class:'flow-node-label'},`父坐标 − ${c.baseOffset} = 局部坐标：${c.parentStart} − ${c.baseOffset} = ${c.localStart}；${c.parentEnd} − ${c.baseOffset} = ${c.localEnd}`));
    el('addressView').replaceChildren(canvas,make('p','连接线表示同一段字节的放大映射，不是数据复制，也不是另一次内存申请。'));
    el('regionEvidence').replaceChildren(symbolsFor(r.symbols),evidencePanel('① 父空间实际申请 · '+a.baseName,a.allocationEvidence,true),evidencePanel('② 本区 offset / 容量计算 · 借用切片',r.placementEvidence,true));
  }
  function render(){renderSymbols();renderCapacity();renderLifecycle();}
  return {render,renderCapacity,renderAddress,symbolsFor,evidencePanel,sourceLink};
}
