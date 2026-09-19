/* 图表完整显示观测过程；共享游标定位当前动画时刻。 */
let progressData=null,progressDataKey='',progressLayoutKey='',progressUIReady=false;
const progressCharts=[];
const groupLabel=g=>g==='all'?'全部 group':Number(g)<0?'本机复制':`group ${g}`;
const rankColor=r=>`hsl(${(Number(r)*137.508)%360} 53% 44%)`;
function progressOptions(){return {axis:shared?.curveAxis||'dst',group:String(shared?.curveGroup??'all'),rank:String(shared?.curveRank??'all')}}
function progressName(s){return s.rank==='all'?groupLabel(s.group):`R${s.rank} · ${groupLabel(s.group)}`}
function progressJump(tick){if(tick!==null)send({type:'seek',ratio:tick/duration})}
function progressSeries(group,rank){return progressData.get(`${group}/${rank}`)}
function progressTableBody(id,series){
 const body=$(id);body.replaceChildren();
 for(const s of series){
  const tr=document.createElement('tr');tr.dataset.series=s.key;
  const title=document.createElement('th');title.scope='row';const choose=document.createElement('button');choose.textContent=progressName(s);
  choose.onclick=()=>send({type:'curve',field:s.rank==='all'?'curveGroup':'curveRank',value:String(s.rank==='all'?s.group:s.rank)});title.append(choose);tr.append(title);
  const total=document.createElement('td');total.textContent=count(s.total);tr.append(total);
  for(const [i,tick] of [s.firstCheck,s.first,...s.milestones].entries()){
   const td=document.createElement('td');
   if(tick===null)td.textContent=i<2?'未观测':'未达';else{const button=document.createElement('button');button.textContent=count(tick);button.title='跳转到此观测时刻';button.dataset.tick=tick;button.onclick=()=>progressJump(tick);td.append(button);}tr.append(td);
  }
  const tail=document.createElement('td');tail.textContent=s.milestones[3]===null?'未达':count(s.milestones[3]-s.milestones[2]);tr.append(tail);body.append(tr);
 }
}
function progressRebuild(){
 if(!progressUIReady||!L)return;
 const opt=progressOptions(),key=[M.launches.indexOf(L),$('group').value,$('sourceRank').value,$('destRank').value,opt.axis].join('|');
 if(key!==progressDataKey){progressData=PacketProgress.build(L.tasks,L.observations,events,M.blocksPerToken,accepted,opt.axis);progressDataKey=key;progressLayoutKey='';}
 const config=[key,opt.group,opt.rank].join('|');
 if(config!==progressLayoutKey){
  $('curveAxis').value=opt.axis;$('curveGroup').value=opt.group;$('curveRank').value=opt.rank;
  const groups=Array.from(progressData.values()).filter(s=>s.group!=='all'&&String(s.rank)===opt.rank).sort((a,b)=>Number(a.group)-Number(b.group));
  const ranks=Array.from(progressData.values()).filter(s=>String(s.group)===opt.group&&s.rank!=='all').sort((a,b)=>Number(a.rank)-Number(b.rank));
  const axisLabel=opt.axis==='dst'?'接收 rank':'来源 rank';
  $('curveScope').textContent=`${L.label} · ${axisLabel}口径 · ${opt.rank==='all'?'全部 rank 按块加权':`聚焦 R${opt.rank}`} · ${groupLabel(opt.group)} · 继承顶部 group / 来源 / 目的筛选`;
  $('groupChartTitle').textContent=`不同 group · ${opt.rank==='all'?'全部 rank 汇总':`${axisLabel} R${opt.rank}`}`;
  $('rankChartTitle').textContent=`不同${axisLabel} · ${groupLabel(opt.group)}`;
  $('curveClockNote').textContent=opt.axis==='dst'?'横轴：接收 rank 相对 tick（各卡 LW epoch 对齐，跨卡未校准）。':'横轴：各目的 rank 相对 tick 的归一化合并；不是来源 rank 的发送时钟。';
  progressCharts[0].series=groups;progressCharts[0].focus=opt.group;progressCharts[0].kind='group';
  progressCharts[1].series=ranks;progressCharts[1].focus=opt.rank;progressCharts[1].kind='rank';
  $('groupCurveLegend').replaceChildren();
  for(const s of groups){const button=document.createElement('button');button.textContent=groupLabel(s.group);button.style.borderColor=color(Number(s.group));button.style.color=color(Number(s.group));button.classList.toggle('selected',String(s.group)===opt.group);button.onclick=()=>send({type:'curve',field:'curveGroup',value:String(s.group)});$('groupCurveLegend').append(button);}
  $('rankCurveLegend').textContent=`显示 ${ranks.length} 条 rank 曲线 · ${opt.rank==='all'?'悬停辨认，点曲线聚焦某 rank':`高亮 R${opt.rank}，其余保留作比较`}`;
  progressTableBody('groupMilestones',groups);progressTableBody('rankMilestones',ranks);
  for(const chart of progressCharts)chart.dirty=true;
  progressLayoutKey=config;
 }
}
function paintProgressBase(chart){
 const rect=chart.canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
 const d=devicePixelRatio||1,w=rect.width,h=rect.height;
 if(chart.canvas.width!==Math.round(w*d)||chart.canvas.height!==Math.round(h*d)){
  chart.canvas.width=chart.base.width=Math.round(w*d);chart.canvas.height=chart.base.height=Math.round(h*d);
 }
 const c=chart.base.getContext('2d');c.setTransform(d,0,0,d,0,0);c.clearRect(0,0,w,h);
 const g={left:50,top:24,width:w-72,height:h-67,w,h};chart.geometry=g;
 const x=tick=>g.left+tick/duration*g.width,y=pct=>g.top+(1-pct)*g.height;
 c.font='11px -apple-system,sans-serif';c.fillStyle='#68788b';c.textAlign='right';c.strokeStyle='#e7edf2';c.lineWidth=1;
 for(const q of [0,.1,.5,.9,1]){const py=y(q);c.beginPath();c.moveTo(g.left,py);c.lineTo(w-22,py);c.stroke();c.fillText(`${Math.round(q*100)}%`,g.left-8,py+4);}
 c.textAlign='center';for(let i=0;i<=4;i++){const tick=duration*i/4,px=x(tick);c.fillText(count(Math.round(tick)),px,h-24);}
 c.textAlign='left';c.fillText('完成度',4,12);c.textAlign='right';c.fillText('相对 tick',w-20,h-6);
 chart.markers=[];
 const focused=s=>String(chart.kind==='group'?s.group:s.rank)===chart.focus;
 const ordered=[...chart.series].sort((a,b)=>Number(focused(a))-Number(focused(b)));
 c.save();c.beginPath();c.rect(g.left,g.top-4,g.width,g.height+8);c.clip();
 for(const s of ordered){
  const strong=focused(s),stroke=chart.kind==='group'?color(Number(s.group)):rankColor(s.rank);
  c.strokeStyle=stroke;c.globalAlpha=strong?1:chart.kind==='group'?.75:chart.focus==='all'?.30:.12;c.lineWidth=strong?2.7:chart.kind==='group'?1.6:1;
  c.beginPath();c.moveTo(x(0),y(0));let last=0;
  for(const p of s.points){c.lineTo(x(p[0]),y(last/s.total));c.lineTo(x(p[0]),y(p[1]/s.total));last=p[1];}c.lineTo(x(duration),y(last/s.total));c.stroke();
  if(strong){
   const points=[['首块',s.first],...s.milestones.map((tick,i)=>[['P10','P50','P90','P100'][i],tick])];
   for(const [label,tick]of points){if(tick===null)continue;const py=y(PacketProgress.at(s,tick)/s.total),px=x(tick);c.globalAlpha=1;c.fillStyle='#fff';c.beginPath();c.arc(px,py,4,0,Math.PI*2);c.fill();c.stroke();chart.markers.push({x:px,y:py,tick,label,series:s});}
  }
 }
 c.restore();c.globalAlpha=1;
 if(!ordered.length){c.fillStyle='#69788b';c.textAlign='center';c.fillText('当前筛选范围没有有效任务',w/2,h/2);}
 chart.dirty=false;
}
function drawProgress(){
 if(!progressUIReady||document.body.dataset.view!=='curves')return;
 progressRebuild();
 for(const chart of progressCharts){
  const rect=chart.canvas.getBoundingClientRect();if(!rect.width||!rect.height)continue;
  if(chart.dirty||chart.geometry?.w!==rect.width||chart.geometry?.h!==rect.height)paintProgressBase(chart);
  const c=chart.canvas.getContext('2d'),d=devicePixelRatio||1,g=chart.geometry;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,chart.canvas.width,chart.canvas.height);c.drawImage(chart.base,0,0);c.setTransform(d,0,0,d,0,0);
  const px=g.left+t/duration*g.width;c.strokeStyle='#ca5353';c.lineWidth=1.3;c.setLineDash([4,3]);c.beginPath();c.moveTo(px,g.top);c.lineTo(px,g.top+g.height);c.stroke();c.setLineDash([]);
  let focus=chart.series.find(s=>String(chart.kind==='group'?s.group:s.rank)===chart.focus);
  if(focus){const ready=PacketProgress.at(focus,t),py=g.top+(1-ready/focus.total)*g.height;c.fillStyle='#ca5353';c.beginPath();c.arc(px,py,4,0,Math.PI*2);c.fill();chart.readout.textContent=`${progressName(focus)} · 当前 ${(ready/focus.total*100).toFixed(1)}% · ${count(ready)}/${count(focus.total)} 块`;}
  else chart.readout.textContent=`当前游标 ${count(Math.round(t))} tick · 完整曲线用于复盘；点选曲线可聚焦`;
  chart.canvas.dataset.series=chart.series.length;chart.canvas.dataset.tick=Math.round(t);chart.canvas.dataset.total=chart.series.reduce((n,s)=>n+s.total,0);
 }
}
function progressHit(chart,event){
 const g=chart.geometry;if(!g)return null;const rect=chart.canvas.getBoundingClientRect(),px=event.clientX-rect.left,py=event.clientY-rect.top;
 if(px<g.left||px>g.left+g.width||py<g.top-7||py>g.top+g.height+7)return null;
 const marker=chart.markers.find(m=>Math.hypot(m.x-px,m.y-py)<8);if(marker)return {series:marker.series,tick:marker.tick,marker:marker.label};
 const tick=Math.round((px-g.left)/g.width*duration);let distance=Infinity,nearest=null;
 for(const s of chart.series){const y=g.top+(1-PacketProgress.at(s,tick)/s.total)*g.height,delta=Math.abs(y-py);if(delta<distance){distance=delta;nearest=s;}}
 return nearest?{series:nearest,tick,marker:null}:null;
}
function exportProgress(){
 progressRebuild();const opt=progressOptions();
 const rows=[['launch','rank_axis','group','rank','expected_blocks','observed_blocks','first_check','first_positive','p10','p50','p90','p100']];
 for(const s of progressData.values())if(s.group!=='all'&&s.rank!=='all')rows.push([M.launches.indexOf(L)+1,opt.axis,s.group,s.rank,s.total,s.observed,s.firstCheck,s.first,...s.milestones]);
 const csv='\uFEFF'+rows.map(row=>row.map(v=>v??'').join(',')).join('\n'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download=`packet-flow-launch${M.launches.indexOf(L)+1}-${opt.axis}-milestones.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function initProgress(){
 for(let g=-1;g<M.groups;g++)$('curveGroup').add(new Option(groupLabel(g),g));for(let r=0;r<M.ranks;r++)$('curveRank').add(new Option(`rank ${r}`,r));
 for(const field of ['curveAxis','curveGroup','curveRank'])$(field).onchange=()=>send({type:'curve',field,value:$(field).value});
 $('curveClear').onclick=()=>send({type:'curveReset'});$('exportProgress').onclick=exportProgress;
 for(const view of ['flow','curves'])$('show'+view).onclick=()=>send({type:'scene',value:view});
 for(const id of ['group','rank']){
  const chart={canvas:$(id+'Progress'),base:document.createElement('canvas'),readout:$(id+'ProgressReadout'),tooltip:$(id+'ProgressTip'),series:[],dirty:true};progressCharts.push(chart);
  chart.canvas.onmousemove=event=>{const hit=progressHit(chart,event);if(!hit){chart.tooltip.hidden=true;return;}const s=hit.series,ready=PacketProgress.at(s,hit.tick);chart.tooltip.textContent=`${progressName(s)} · ${hit.marker||'时刻'} ${count(hit.tick)} tick · ${(ready/s.total*100).toFixed(2)}% (${count(ready)}/${count(s.total)})`;
   chart.tooltip.hidden=false;const r=chart.canvas.getBoundingClientRect();chart.tooltip.style.left=Math.max(0,Math.min(event.clientX-r.left+10,r.width-310))+'px';chart.tooltip.style.top=Math.max(0,event.clientY-r.top-40)+'px';};
  chart.canvas.onmouseleave=()=>chart.tooltip.hidden=true;
  chart.canvas.onclick=async event=>{const hit=progressHit(chart,event);if(!hit)return;await send({type:'curve',field:id==='group'?'curveGroup':'curveRank',value:String(id==='group'?hit.series.group:hit.series.rank)});progressJump(hit.tick);};
  new ResizeObserver(()=>{chart.dirty=true;if(shared)drawProgress()}).observe(chart.canvas);
 }
 progressUIReady=true;
}
