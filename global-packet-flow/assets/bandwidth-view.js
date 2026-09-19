let bandwidthData=null,bandwidthKey='',bandwidthPaintKey='',bandwidthReady=false,bandwidthRowKey='';
const bandwidthCharts=[];
const bwNumber=n=>n!==0&&Math.abs(n)<.00001?Number(n).toExponential(3):Number(n).toLocaleString('zh-CN',{maximumFractionDigits:5});
function bandwidthOptions(){return {axis:shared?.bwAxis||'dst',group:String(shared?.bwGroup??'all'),rank:String(shared?.bwRank??'all'),local:shared?.bwLocal===true,mode:shared?.bwMode||'adjacent',window:Number(shared?.bwWindow)||1000,bytes:Number(shared?.bwPacketBytes)||M.blockBytes,us:Number(shared?.bwCycleUs)||0,unit:shared?.bwUnit==='gbps'&&Number(shared?.bwCycleUs)>0?'gbps':'packets',capacity:Number(shared?.bwCapacity)||0,from:Number(shared?.bwFrom)||0,to:Number(shared?.bwTo)||duration};}
function bandwidthUnit(opt){return opt.unit==='gbps'?'估算 GB/s':'包/tick';}
function bandwidthScale(opt){return opt.unit==='gbps'?opt.bytes/opt.us/1000:1;}
function bandwidthRebuild(){
 const o=bandwidthOptions(),key=[M.launches.indexOf(L),$('group').value,$('sourceRank').value,$('destRank').value,o.axis,o.group,o.rank,o.local,o.mode,o.window].join('|');
 if(key!==bandwidthKey){bandwidthData=PacketBandwidth.build(L.tasks,events,accepted,o);bandwidthKey=key;bandwidthPaintKey='';bandwidthRowKey='';}
 const config=key+JSON.stringify([o.bytes,o.us,o.unit,o.capacity,o.from,o.to]);
 if(config!==bandwidthPaintKey){
  for(const [id,value]of Object.entries({bwAxis:o.axis,bwGroup:o.group,bwRank:o.rank,bwMode:o.mode,bwWindow:o.window,bwPacketBytes:o.bytes,bwCycleUs:o.us||'',bwUnit:o.unit,bwCapacity:o.capacity||''}))if(document.activeElement!==$(id))$(id).value=String(value);
  $('bwLocal').checked=o.local;$('bwWindow').disabled=o.mode!=='window';$('bwUnit').options[1].disabled=!o.us;
  $('bwCapacityUnit').textContent=bandwidthUnit(o);
  $('bandwidthScope').textContent=`${L.label} · ${o.axis==='dst'?'接收':'来源'} rank · ${o.rank==='all'?'全部 rank':`R${o.rank}`} · ${groupLabel(o.group)} · ${o.local?'包含本机复制（不全是网络流量）':'排除本机复制'} · ${o.mode==='window'?`固定 ${count(o.window)} tick 窗口`:'相邻去重观测 end'} · 继承顶部筛选`;
  $('bandwidthEvidence').textContent=`${count(bandwidthData.samples)} 个测量点 / ${count(bandwidthData.intervals.length)} 个差分区间。首测已有 ${count(bandwidthData.initial)} 包，单独记账；首测前和末测后没有带宽值。每包 ${bwNumber(o.bytes)} B；${o.us?`每 cycle ${bwNumber(o.us)} μs（用户配置换算）`:'cycle 时间未配置，保留原始包/tick'}。${bandwidthData.window>o.window?`窗口自动扩大到 ${count(bandwidthData.window)} tick，最多显示 20 万个区间。`:''}`;
  for(const c of bandwidthCharts)c.dirty=true;bandwidthPaintKey=config;bandwidthRowKey='';
 }
 return o;
}
function paintBandwidthBase(chart,o){
 const rect=chart.canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
 const w=rect.width,h=rect.height,d=devicePixelRatio||1;chart.canvas.width=chart.base.width=Math.round(w*d);chart.canvas.height=chart.base.height=Math.round(h*d);
 const c=chart.base.getContext('2d');c.setTransform(d,0,0,d,0,0);c.clearRect(0,0,w,h);
 const from=Math.min(o.from,Math.max(0,duration-1)),to=Math.max(from+1,Math.min(duration,o.to)),columns=Math.max(1,Math.min(1600,Math.floor(w-85))),scale=bandwidthScale(o);
 const bins=PacketBandwidth.project(bandwidthData,from,to,columns),max=Math.max(o.capacity,...bins.map(b=>b.peak*scale),.001)*1.08;
 const g={left:62,top:26,width:w-85,height:h-70,w,h,from,to,max};chart.geometry=g;chart.bins=bins;
 const x=tick=>g.left+(tick-from)/(to-from)*g.width,y=value=>g.top+(1-value/max)*g.height;
 c.font='11px -apple-system,sans-serif';c.strokeStyle='#e7edf2';c.fillStyle='#647488';c.lineWidth=1;c.textAlign='right';
 for(let i=0;i<=4;i++){const value=max*i/4,py=y(value);c.beginPath();c.moveTo(g.left,py);c.lineTo(w-23,py);c.stroke();c.fillText(Number(value.toPrecision(3)).toLocaleString('zh-CN',{maximumSignificantDigits:3}),g.left-7,py+4);}
 c.textAlign='center';for(let i=0;i<=4;i++)c.fillText(count(Math.round(from+(to-from)*i/4)),x(from+(to-from)*i/4),h-25);
 c.textAlign='left';c.fillText(bandwidthUnit(o),3,12);c.textAlign='right';c.fillText('接收端相对 tick',w-22,h-7);
 for(let i=0;i<bins.length;i++){
  const b=bins[i],px=x(b.start),pw=g.width/bins.length+.3;
  if(!b.coverage){c.fillStyle='#f4f6f8';c.fillRect(px,g.top,pw,g.height);continue;}
  let sum=0;for(const [id,value]of Object.entries(b[chart.kind]).sort((a,b)=>Number(a[0])-Number(b[0]))){const v=value*scale;c.fillStyle=chart.kind==='groups'?color(Number(id)):rankColor(id);c.globalAlpha=.78;c.fillRect(px,y(sum+v),pw,Math.max(.1,v/max*g.height));sum+=v;}c.globalAlpha=1;
 }
 // 峰值包络保留窄尖峰；堆叠仍保持时间加权面积。
 for(const [field,stroke]of [['peak','#53667e'],['total','#122f40']]){
  c.strokeStyle=stroke;c.lineWidth=field==='peak'?.65:1.1;c.globalAlpha=field==='peak'?.65:1;c.beginPath();let started=false;
  for(const b of bins){if(!b.coverage){started=false;continue;}const px=x(b.start),py=y(b[field]*scale);if(started)c.lineTo(px,py);else c.moveTo(px,py);c.lineTo(x(b.end),py);started=true;}c.stroke();c.globalAlpha=1;
 }
 if(o.capacity){c.strokeStyle='#b47925';c.setLineDash([5,4]);c.beginPath();c.moveTo(g.left,y(o.capacity));c.lineTo(w-23,y(o.capacity));c.stroke();c.setLineDash([]);c.fillStyle='#946222';c.fillText('配置参考上限',w-24,Math.max(g.top+13,y(o.capacity)-6));}
 if(!bandwidthData.intervals.length){c.fillStyle='#69788b';c.textAlign='center';c.fillText('没有两个有效测量点，无法计算差分',w/2,h/2);}
 chart.dirty=false;
}
function bandwidthRows(id,parts,it,o,kind){
 const body=$(id);body.replaceChildren();
 if(!it)return;
 for(const [name,n]of Object.entries(parts).sort((a,b)=>b[1]-a[1]||Number(a[0])-Number(b[0]))){
  const tr=document.createElement('tr');tr.dataset.part=name;const label=document.createElement('th'),button=document.createElement('button');button.textContent=kind==='groups'?groupLabel(Number(name)):`R${name}`;
  button.style.borderLeft=`4px solid ${kind==='groups'?color(Number(name)):rankColor(name)}`;button.style.paddingLeft='6px';
  button.onclick=()=>send({type:'bandwidth',field:kind==='groups'?'bwGroup':'bwRank',value:name});label.append(button);tr.append(label);
  const rate=n/(it.end-it.start),values=[count(n),bwNumber(rate),o.us?bwNumber(PacketBandwidth.gbps(rate,o.bytes,o.us)):'待配置',`${(n/it.total*100).toFixed(2)}%`];
  for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td);}body.append(tr);
 }
}
function drawBandwidth(){
 if(!bandwidthReady||document.body.dataset.view!=='bandwidth')return;
 const o=bandwidthRebuild(),index=PacketBandwidth.locate(bandwidthData,t),it=index<0?null:bandwidthData.intervals[index],scale=bandwidthScale(o);
 $('bandwidthNow').textContent=it?`区间 (${count(it.start)}, ${count(it.end)}] · Δt=${count(it.end-it.start)} tick · 新增 ${count(it.total)} 包 · ${bwNumber(it.rate)} 包/tick${o.us?` · ${bwNumber(PacketBandwidth.gbps(it.rate,o.bytes,o.us))} GB/s（配置换算）`:''}${o.capacity?` · 参考比 ${(it.rate*scale/o.capacity*100).toFixed(1)}%`:''}`:'当前游标处没有两个测量点，带宽未知';
 $('bandwidthNow').dataset.rate=it?String(it.rate):'';$('bandwidthNow').dataset.packets=it?String(it.total):'';$('bandwidthNow').dataset.interval=index;
 const rowKey=bandwidthPaintKey+'|'+index;
 if(rowKey!==bandwidthRowKey){
  bandwidthRows('bwGroupRows',it?.groups||{},it,o,'groups');bandwidthRows('bwRankRows',it?.ranks||{},it,o,'ranks');
  for(const [kind,id]of [['groups','bwGroupLegend'],['ranks','bwRankLegend']]){
   const box=$(id),parts=Object.entries(it?.[kind]||{}).sort((a,b)=>b[1]-a[1]);box.replaceChildren();
   if(!parts.length){box.textContent=it?'本区间没有新增观测包':'没有有效差分区间';continue;}
   if(kind==='ranks')addText(box,`${parts.length} 个 rank 贡献`,'span');
   for(const [key,n]of parts.slice(0,kind==='ranks'?5:parts.length)){const label=addText(box,`${kind==='groups'?groupLabel(Number(key)):'R'+key} ${(n/it.total*100).toFixed(1)}%`,'span');label.style.borderLeft=`4px solid ${kind==='groups'?color(Number(key)):rankColor(key)}`;label.style.paddingLeft='4px';}
   if(kind==='ranks'&&parts.length>5)addText(box,'完整组成见控制页','span');
  }
  bandwidthRowKey=rowKey;
 }
 for(const chart of bandwidthCharts){
  const r=chart.canvas.getBoundingClientRect();if(!r.width||!r.height)continue;
  if(chart.dirty||chart.geometry?.w!==r.width||chart.geometry?.h!==r.height)paintBandwidthBase(chart,o);
  const c=chart.canvas.getContext('2d'),d=devicePixelRatio||1,g=chart.geometry;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,chart.canvas.width,chart.canvas.height);c.drawImage(chart.base,0,0);c.setTransform(d,0,0,d,0,0);
  if(t>=g.from&&t<=g.to){const px=g.left+(t-g.from)/(g.to-g.from)*g.width;c.strokeStyle='#ce4e50';c.lineWidth=1.4;c.setLineDash([4,3]);c.beginPath();c.moveTo(px,g.top);c.lineTo(px,g.top+g.height);c.stroke();c.setLineDash([]);}
  chart.canvas.dataset.tick=Math.round(t);chart.canvas.dataset.intervals=bandwidthData.intervals.length;chart.canvas.dataset.rate=it?.rate??'';
 }
 for(const id of ['bwPrevious','bwNext','bwZoom'])$(id).disabled=!bandwidthData.intervals.length;
}
function bandwidthHit(chart,e){
 const g=chart.geometry;if(!g)return null;const r=chart.canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
 if(x<g.left||x>g.left+g.width||y<g.top||y>g.top+g.height)return null;
 const tick=g.from+(x-g.left)/g.width*(g.to-g.from),index=PacketBandwidth.locate(bandwidthData,tick);return index<0?null:{tick,index,it:bandwidthData.intervals[index],x,y};
}
function bandwidthStep(delta){
 bandwidthRebuild();if(!bandwidthData.intervals.length)return;
 let index=PacketBandwidth.locate(bandwidthData,t);if(index<0)index=t<=bandwidthData.first?-1:bandwidthData.intervals.length;
 index=Math.max(0,Math.min(bandwidthData.intervals.length-1,index+delta));progressJump(bandwidthData.intervals[index].end);
}
function exportBandwidth(){
 const o=bandwidthRebuild(),rows=[['start_tick','end_tick','decomposition','member','new_packets','packets_per_tick','bytes_per_packet','us_per_cycle','estimated_GBps']];
 // 导出分别标记 group、rank 组成，不能把两套加总当作两倍流量。
 for(const it of bandwidthData.intervals)for(const [kind,parts]of [['total',{all:it.total}],['groups',it.groups],['ranks',it.ranks]])for(const [id,n]of Object.entries(parts)){
  const rate=n/(it.end-it.start);rows.push([it.start,it.end,kind,id,n,rate,o.bytes,o.us||'',PacketBandwidth.gbps(rate,o.bytes,o.us)??'']);
 }
 const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.join(',')).join('\n')],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`packet-flow-launch${M.launches.indexOf(L)+1}-${o.mode}-bandwidth.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function initBandwidth(){
 for(let g=-1;g<M.groups;g++)$('bwGroup').add(new Option(groupLabel(g),g));for(let r=0;r<M.ranks;r++)$('bwRank').add(new Option(`rank ${r}`,r));
 for(const id of ['bwAxis','bwGroup','bwRank','bwMode','bwWindow','bwPacketBytes','bwCycleUs','bwUnit','bwCapacity'])$(id).onchange=()=>send({type:'bandwidth',field:id,value:$(id).value});
 $('bwLocal').onchange=()=>send({type:'bandwidth',field:'bwLocal',value:$('bwLocal').checked});
 $('showbandwidth').onclick=()=>send({type:'scene',value:'bandwidth'});$('bwPrevious').onclick=()=>bandwidthStep(-1);$('bwNext').onclick=()=>bandwidthStep(1);$('bwZoom').onclick=()=>send({type:'bwZoom',from:Math.max(0,t-1000),to:Math.min(duration,t+1000)});$('bwFull').onclick=()=>send({type:'bwZoom',from:0,to:0});$('bwExport').onclick=exportBandwidth;
 for(const kind of ['groups','ranks']){
  const chart={kind,canvas:$(kind+'Bandwidth'),base:document.createElement('canvas'),tip:$(kind+'BandwidthTip'),dirty:true};bandwidthCharts.push(chart);
  chart.canvas.onmousemove=e=>{const hit=bandwidthHit(chart,e);if(!hit){chart.tip.hidden=true;return;}const {it}=hit,o=bandwidthOptions();chart.tip.textContent=`(${count(it.start)}, ${count(it.end)}] · ${count(it.total)} 包 / ${count(it.end-it.start)} tick = ${bwNumber(it.rate)} 包/tick；`+Object.entries(it[kind]).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([id,n])=>`${kind==='groups'?groupLabel(Number(id)):'R'+id} ${count(n)} 包`).join(' · ');chart.tip.hidden=false;chart.tip.style.left=Math.max(0,Math.min(hit.x+8,chart.geometry.w-320))+'px';chart.tip.style.top=Math.max(0,hit.y-55)+'px';};
  chart.canvas.onmouseleave=()=>chart.tip.hidden=true;chart.canvas.onclick=e=>{const hit=bandwidthHit(chart,e);if(hit)progressJump(hit.it.end);};
  new ResizeObserver(()=>{chart.dirty=true;if(shared)drawBandwidth()}).observe(chart.canvas);
 }
 bandwidthReady=true;
}
