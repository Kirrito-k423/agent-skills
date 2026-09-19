/* 原子包身份固定为 launch 内 task/slot/block，横轴只采用首次就绪观察 end。 */
const PacketTimeline=(()=>{
 function scope(ranks,src='all',dst='all'){
  const select=v=>v==='all'?Array.from({length:ranks},(_,i)=>i):[Number(v)];
  const sources=select(src),destinations=select(dst),count=sources.length*destinations.length;
  return {sources,destinations,count,eligible:count<=512};
 }
 function matches(a,filters){return ['group','sourceRank','destRank'].every((key,i)=>filters[key]===undefined||filters[key]==='all'||a[[6,0,1][i]]===Number(filters[key]));}
 function build(L,blocks,scope,accepted){
  if(!scope.eligible)return {pairs:[],expected:0,observed:0};
  const pairs=[],lookup=new Map();
  for(const src of scope.sources)for(const dst of scope.destinations){const pair={src,dst,total:0,packets:[]};pairs.push(pair);lookup.set(src+'/'+dst,pair);}
  const seen=new Map();let expected=0;
  L.tasks.forEach((a,i)=>{if(!accepted[i])return;const pair=lookup.get(a[0]+'/'+a[1]);if(!pair)return;pair.total+=a[4]*blocks;expected+=a[4]*blocks;seen.set(i,new Uint32Array(a[4]));});
  for(const [oi,o]of L.observations.entries()){
   const [task,start,end,,begin,words,record,line]=o,masks=seen.get(task);if(!masks)continue;
   const a=L.tasks[task],pair=lookup.get(a[0]+'/'+a[1]);
   words.forEach((word,j)=>{const slot=begin+j;let fresh=word&~masks[slot];masks[slot]|=word;while(fresh){const bit=31-Math.clz32(fresh&-fresh);fresh&=fresh-1;pair.packets.push({task,slot,block:bit,start,end,record,line,observation:oi,group:a[6]});}});
  }
  let observed=0;for(const pair of pairs){pair.packets.sort((a,b)=>a.end-b.end||a.task-b.task||a.slot-b.slot||a.block-b.block);observed+=pair.packets.length;pair.missing=pair.total-pair.packets.length;}
  return {pairs,expected,observed};
 }
 function at(packets,tick){let lo=0,hi=packets.length;while(lo<hi){const m=(lo+hi)>>>1;if(packets[m].end<=tick)lo=m+1;else hi=m;}return lo;}
 return {scope,matches,build,at};
})();
if(typeof module!=='undefined')module.exports=PacketTimeline;
