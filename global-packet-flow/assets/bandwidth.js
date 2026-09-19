/* 接收观测计数的有限差分。不是链路计数器，也不假设首测之前的传输速率。 */
const PacketBandwidth=(()=>{
  function build(tasks,events,accepted,opt={}){
    const scope=tasks.map((a,i)=>accepted[i]&&a[4]>0&&(opt.local||a[6]>=0)&&
      (opt.group==='all'||opt.group===undefined||a[6]===Number(opt.group))&&
      (opt.rank==='all'||opt.rank===undefined||a[opt.axis==='src'?0:1]===Number(opt.rank)));
    const samples=[];let previous=-Infinity;
    for(const e of events){
      if(e[4]>0||!scope[e[1]])continue;
      if(e[0]<previous)throw new Error('带宽观察事件必须按时间排序');previous=e[0];
      let sample=samples[samples.length-1];if(!sample||sample.end!==e[0]){sample={end:e[0],total:0,groups:{},ranks:{}};samples.push(sample);}
      const a=tasks[e[1]],g=a[6],r=a[opt.axis==='src'?0:1];sample.total+=e[2];
      if(e[2]){sample.groups[g]=(sample.groups[g]||0)+e[2];sample.ranks[r]=(sample.ranks[r]||0)+e[2];}
    }
    if(!samples.length)return {samples:0,first:null,last:null,initial:0,observed:0,intervals:[]};
    const first=samples[0],last=samples[samples.length-1].end,intervals=[];
    const minimumWindow=Math.max(1,Math.ceil((last-first.end)/200000));
    const window=opt.mode==='window'?Math.max(minimumWindow,Math.trunc(Number(opt.window)||1000)):0;
    if(window){
      for(let start=first.end;start<last;start+=window)intervals.push({start,end:Math.min(start+window,last),total:0,groups:{},ranks:{}});
      for(const s of samples.slice(1)){const index=Math.ceil((s.end-first.end)/window)-1,target=intervals[index];target.total+=s.total;for(const key of ['groups','ranks'])for(const [id,n]of Object.entries(s[key]))target[key][id]=(target[key][id]||0)+n;}
    }else for(let i=1;i<samples.length;i++)intervals.push({start:samples[i-1].end,...samples[i]});
    for(const it of intervals)it.rate=it.total/(it.end-it.start);
    return {samples:samples.length,first:first.end,last,window,initial:first.total,
      observed:samples.reduce((n,s)=>n+s.total,0),intervals};
  }
  // 区间 (start,end]；首测前与末测后缺少差分基线，不冒充零带宽。
  function locate(data,tick){
    if(data.first===null||tick<=data.first||tick>data.last)return -1;
    let lo=0,hi=data.intervals.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(data.intervals[mid].end<tick)lo=mid+1;else hi=mid;}
    return lo<data.intervals.length?lo:-1;
  }
  // 画面像素桶按持续时间加权；峰值另外保留，不能隐藏很窄的尖峰。
  function project(data,start,end,columns){
    const width=(end-start)/columns;
    const bins=Array.from({length:columns},(_,i)=>({start:start+i*width,end:start+(i+1)*width,coverage:0,total:0,peak:0,groups:{},ranks:{}}));
    for(const it of data.intervals){
      if(it.end<=start||it.start>=end)continue;
      const low=Math.max(0,Math.floor((it.start-start)/width)),high=Math.min(columns-1,Math.ceil((it.end-start)/width)-1),dt=it.end-it.start;
      for(let i=low;i<=high;i++){
        const b=bins[i],overlap=Math.max(0,Math.min(it.end,b.end)-Math.max(it.start,b.start));if(!overlap)continue;
        b.coverage+=overlap;b.total+=it.rate*overlap;b.peak=Math.max(b.peak,it.rate);
        for(const key of ['groups','ranks'])for(const [id,n]of Object.entries(it[key]))b[key][id]=(b[key][id]||0)+n/dt*overlap;
      }
    }
    for(const b of bins)if(b.coverage){b.total/=b.coverage;for(const key of ['groups','ranks'])for(const id in b[key])b[key][id]/=b.coverage;}
    return bins;
  }
  function gbps(rate,bytesPerPacket,usPerCycle){return usPerCycle>0?rate*bytesPerPacket/usPerCycle/1000:null;}
  return {build,locate,project,gbps};
})();
if(typeof module!=='undefined')module.exports=PacketBandwidth;
