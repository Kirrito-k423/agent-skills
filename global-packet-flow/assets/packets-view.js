let packetData=null,packetKey='',packetGeometry=null,packetDrawn=[],packetListKey='',packetUIReady=false;
function packetScope(){return PacketTimeline.scope(M.ranks,$('sourceRank').value,$('destRank').value);}
function packetOptions(){return {axis:shared?.packetAxis||'src',size:document.body.dataset.view==='flow'?8:Number(shared?.packetRows)||8,page:Number(shared?.packetPage)||0,from:Number(shared?.packetFrom)||0,to:Number(shared?.packetTo)||duration};}
function rebuildPackets(){
 const scope=packetScope(),key=[M.launches.indexOf(L),$('sourceRank').value,$('destRank').value,$('group').value].join('/');
 document.body.dataset.packets=scope.eligible?'ready':'large';
 $('showpackets').textContent=`信包时序 · ${scope.count}`;
 if(key!==packetKey){packetData=PacketTimeline.build(L,M.blocksPerToken,scope,accepted);packetKey=key;packetListKey='';}
 return scope;
}
function packetJump(p){send({type:'packet',task:p.task,slot:p.slot,block:p.block,tick:p.end});}
function packetTable(){
 if(ROLE!=='control')return;
 const src=Number(shared?.packetPairSrc),dst=Number(shared?.packetPairDst),from=Number(shared?.packetPickFrom),to=Number(shared?.packetPickTo),page=Number(shared?.packetListPage)||0;
 const pair=packetData.pairs.find(p=>p.src===src&&p.dst===dst),key=[packetKey,src,dst,from,to,page,selectedTask,selectedBlock,Math.floor(t)].join('/');
 if(key===packetListKey)return;packetListKey=key;const body=$('packetRowsBody');body.replaceChildren();
 if(!pair||!Number.isFinite(from)||!Number.isFinite(to)){$('packetPick').textContent='点击时序点可展开重合包；点击行名聚焦该来源→目的。';$('packetListPrev').disabled=$('packetListNext').disabled=true;return;}
 const packets=pair.packets.filter(p=>p.end>=from&&p.end<=to),start=Math.min(page*64,Math.max(0,Math.floor((packets.length-1)/64)*64));
 $('packetPick').textContent=`R${src} → R${dst} · [${count(from)}, ${count(to)}] tick · ${count(packets.length)} 个原子包 · ${packets.length?start+1:0}–${Math.min(start+64,packets.length)} · 同 tick 重合不代表一个包`;
 $('packetListPrev').disabled=start===0;$('packetListNext').disabled=start+64>=packets.length;
 for(const p of packets.slice(start,start+64)){
  const a=L.tasks[p.task],tr=document.createElement('tr'),th=document.createElement('th'),button=document.createElement('button');button.textContent=`T${p.task} / s${p.slot} / b${p.block}`;button.onclick=()=>packetJump(p);th.append(button);tr.append(th);
  tr.dataset.task=p.task;tr.dataset.block=p.slot*M.blocksPerToken+p.block;tr.classList.toggle('packet-selected',p.task===selectedTask&&p.slot*M.blocksPerToken+p.block===selectedBlock);
  for(const value of [p.end<=t?'已完成':'尚未到时',groupLabel(p.group),`${a[5]} → ${a[2]}`,`${count(p.start)}–${count(p.end)}`,`record ${p.record} · L${p.line}`])addText(tr,value,'td');body.append(tr);
 }
}
function drawPackets(){
 if(!packetUIReady)return;
 const scope=rebuildPackets(),scene=document.body.dataset.view;
 if(scene!=='packets'&&!(scene==='flow'&&scope.eligible))return;
 const o=packetOptions(),data=packetData,rows=[...data.pairs].sort((a,b)=>o.axis==='src'?a.src-b.src||a.dst-b.dst:a.dst-b.dst||a.src-b.src),pages=Math.max(1,Math.ceil(rows.length/o.size)),page=Math.min(o.page,pages-1),visible=rows.slice(page*o.size,(page+1)*o.size);
 $('packetAxis').value=o.axis;$('packetRows').value=o.size;$('packetRows').disabled=scene==='flow';
 $('packetPageLabel').textContent=`${page+1}/${pages} 页 · ${visible.length? page*o.size+1:0}–${Math.min((page+1)*o.size,rows.length)} / ${scope.count} 组合`;
 $('packetPrev').disabled=page===0;$('packetNext').disabled=page===pages-1;
 $('packetScope').textContent=scope.eligible?`${scope.sources.length} 来源 × ${scope.destinations.length} 目的 = ${scope.count} 组合 · ${o.axis==='src'?'发送端优先':'接收端优先'}排序 · 已完成 ${count(data.pairs.reduce((n,p)=>n+PacketTimeline.at(p.packets,t),0))} / ${count(data.expected)} 包 · 全日志缺少就绪时间 ${count(data.expected-data.observed)} 包`:`${scope.count} 组合超过 512，请筛选来源或目的 rank 后查看逐包时序。`;
 $('packetScope').dataset.pairs=scope.count;$('packetScope').dataset.expected=data.expected;$('packetScope').dataset.completed=data.pairs.reduce((n,p)=>n+PacketTimeline.at(p.packets,t),0);
 packetTable();
 const c=$('packetCanvas'),rect=c.getBoundingClientRect();if(!rect.width||!rect.height)return;
 const [w,h]=fit(c),x=c.getContext('2d'),left=156,right=100,top=23,bottom=30,width=Math.max(1,w-left-right),height=Math.max(1,h-top-bottom),rowHeight=height/Math.max(1,visible.length),from=Math.min(o.from,duration-1),to=Math.max(from+1,Math.min(duration,o.to));
 packetGeometry={w,h,left,right,top,bottom,width,height,rowHeight,from,to,visible};packetDrawn=[];x.clearRect(0,0,w,h);
 if(!scope.eligible){x.fillStyle='#69788b';x.font='13px sans-serif';x.fillText('选择一端 rank 后，可查看 64 条来源→目的泳道。',30,50);packetTable();return;}
 const px=tick=>left+(tick-from)/(to-from)*width;
 x.font='11px -apple-system,sans-serif';x.fillStyle='#68788b';x.fillText('来源 → 目的',8,13);x.textAlign='right';x.fillText('完成 / 应到',w-5,13);x.textAlign='center';x.fillText('首次就绪观测 end · tick',left+width/2,13);
 for(let i=0;i<=4;i++){const tick=from+(to-from)*i/4,v=px(tick);x.strokeStyle='#e6edf1';x.beginPath();x.moveTo(v,top);x.lineTo(v,h-bottom);x.stroke();x.fillText(count(Math.round(tick)),v,h-12);}
 for(const [ri,pair]of visible.entries()){
  const y=top+ri*rowHeight,cy=y+rowHeight/2,done=PacketTimeline.at(pair.packets,t);x.fillStyle=ri%2?'#f5f8fa':'#fbfcfd';x.globalAlpha=.55;x.fillRect(left,y,width,rowHeight-1);x.globalAlpha=1;
  x.fillStyle='#235363';x.textAlign='left';x.fillText(`R${pair.src} → R${pair.dst}`,8,cy+4);x.textAlign='right';x.fillStyle=pair.total?'#526679':'#8c98a5';x.fillText(pair.total?`${count(done)} / ${count(pair.total)}`:'无有效任务',w-5,cy+4);
  let ordinal=0,previous=-1;const lanes=Math.max(1,Math.min(128,Math.floor((rowHeight-6)/4))),spacing=Math.max(0,Math.min(4,(rowHeight-6)/lanes)),radius=Math.max(.8,Math.min(1.25,rowHeight/10));
  for(const p of pair.packets){
   if(p.end<from||p.end>to)continue;if(previous!==p.end){previous=p.end;ordinal=0;}
   const ax=px(p.end),ay=cy+((ordinal++%lanes)-(lanes-1)/2)*spacing,complete=p.end<=t;
   x.fillStyle=complete?'#128e85':'#d7e0e8';x.fillRect(ax-radius,ay-radius,radius*2,radius*2);
   if(p.task===selectedTask&&p.slot*M.blocksPerToken+p.block===selectedBlock){x.strokeStyle='#cf5552';x.lineWidth=1.4;x.strokeRect(ax-3,ay-3,6,6);}
   packetDrawn.push({x:ax,y:ay,p,pair,ri});
  }
  if(pair.missing){x.fillStyle='#a96935';x.textAlign='left';x.fillText(`未知 ${pair.missing}`,left+4,y+11);}
 }
 if(t>=from&&t<=to){x.strokeStyle='#cf5552';x.lineWidth=1.3;x.setLineDash([4,3]);x.beginPath();x.moveTo(px(t),top);x.lineTo(px(t),h-bottom);x.stroke();x.setLineDash([]);}
 c.dataset.tick=Math.round(t);c.dataset.visiblePairs=visible.length;c.dataset.atomicPoints=packetDrawn.length;packetTable();
}
function packetHit(event){
 const g=packetGeometry;if(!g)return null;const r=$('packetCanvas').getBoundingClientRect(),x=event.clientX-r.left,y=event.clientY-r.top,ri=Math.floor((y-g.top)/g.rowHeight),pair=g.visible[ri];if(!pair||y<g.top||y>g.h-g.bottom)return null;
 if(x<g.left)return {pair,label:true};if(x>g.left+g.width)return null;
 const near=packetDrawn.filter(p=>p.ri===ri&&Math.abs(p.x-x)<=5);if(!near.length)return null;
 near.sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y));const target=near[0];
 const from=near.reduce((n,p)=>Math.min(n,p.p.end),Infinity),to=near.reduce((n,p)=>Math.max(n,p.p.end),-Infinity);return {pair,from,to,target:target.p,total:near.length,x,y};
}
function initPackets(){
 $('showpackets').onclick=()=>send({type:'scene',value:'packets'});$('packetExpand').onclick=()=>send({type:'scene',value:'packets'});
 for(const [id,field]of [['packetAxis','packetAxis'],['packetRows','packetRows']])$(id).onchange=()=>send({type:'packetSetting',field,value:$(id).value});
 const turnPage=delta=>{const o=packetOptions(),pages=Math.max(1,Math.ceil(packetScope().count/o.size));send({type:'packetPage',delta,size:o.size,page:Math.min(o.page,pages-1)});};
 $('packetPrev').onclick=()=>turnPage(-1);$('packetNext').onclick=()=>turnPage(1);
 $('packetZoom').onclick=()=>send({type:'packetZoom',from:Math.max(0,t-1000),to:Math.min(duration,t+1000)});$('packetFull').onclick=()=>send({type:'packetZoom',from:0,to:0});
 $('packetListPrev').onclick=()=>send({type:'packetListPage',delta:-1});$('packetListNext').onclick=()=>send({type:'packetListPage',delta:1});
 const c=$('packetCanvas'),tip=$('packetTip');
 c.onmousemove=e=>{const hit=packetHit(e);if(!hit){tip.hidden=true;return;}tip.hidden=false;tip.textContent=hit.label?`点击聚焦 R${hit.pair.src} → R${hit.pair.dst}`:`R${hit.pair.src} → R${hit.pair.dst} · 光标附近 ${hit.total} 包 · ${count(hit.from)}–${count(hit.to)} tick · 点击展开全部包并定位证据`;tip.style.left=Math.max(0,Math.min((hit.x||0)+10,c.clientWidth-320))+'px';tip.style.top=Math.max(0,(hit.y||0)-45)+'px';};
 c.onmouseleave=()=>tip.hidden=true;c.onclick=e=>{const hit=packetHit(e);if(!hit)return;if(hit.label)send({type:'pairFocus',src:hit.pair.src,dst:hit.pair.dst});else send({type:'packetPick',src:hit.pair.src,dst:hit.pair.dst,from:hit.from,to:hit.to,packet:hit.target});};
 new ResizeObserver(()=>{if(shared)drawPackets()}).observe(c);packetUIReady=true;
}
