/* 按应到块数加权的经验完成曲线；输入 events 已按时间排序并去重首次就绪块。 */
const PacketProgress = (() => {
  function build(tasks, observations, events, blocks, accepted, axis) {
    const series = new Map(), taskSeries = new Array(tasks.length);
    function get(group, rank) {
      const key=`${group}/${rank}`;
      if(!series.has(key))series.set(key,{key,group,rank,total:0,firstCheck:null,points:[[0,0]]});
      return series.get(key);
    }
    tasks.forEach((a,i)=>{
      if(!accepted[i]||!a[4])return;
      const rank=a[axis==='src'?0:1], group=a[6];
      taskSeries[i]=[get(group,rank),get(group,'all'),get('all',rank),get('all','all')];
      for(const s of taskSeries[i])s.total+=a[4]*blocks;
    });
    for(const o of observations)for(const s of taskSeries[o[0]]||[])
      s.firstCheck=s.firstCheck===null?o[1]:Math.min(s.firstCheck,o[1]);
    for(const e of events){
      if(!e[2])continue;
      for(const s of taskSeries[e[1]]||[]){
        const last=s.points[s.points.length-1];
        if(last[0]===e[0])last[1]+=e[2];else s.points.push([e[0],last[1]+e[2]]);
      }
    }
    for(const s of series.values()){
      s.observed=s.points[s.points.length-1][1];
      if(s.observed>s.total)throw new Error('首次就绪块数超过应到总量');
      s.first=s.points.find(p=>p[1]>0)?.[0]??null;
      s.milestones=[.1,.5,.9,1].map(q=>s.points.find(p=>p[1]>=Math.ceil(q*s.total))?.[0]??null);
    }
    return series;
  }
  function at(series,tick){
    if(!series)return 0;let lo=0,hi=series.points.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(series.points[mid][0]<=tick)lo=mid+1;else hi=mid;}
    return lo?series.points[lo-1][1]:0;
  }
  return {build,at};
})();
if(typeof module!=='undefined')module.exports=PacketProgress;
