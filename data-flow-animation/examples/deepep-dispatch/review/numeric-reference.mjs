// Independent source-equation oracle. Input values come from frame 0; no counts/recvPlan/outputPlan/slot fields are consumed.
export function reference(m){
 const c=m.config,initial=m.frames[0].snapshot,perRank=c.E/c.R,align=n=>Math.ceil(n/c.A)*c.A;
 const tokens=[],incoming=Array.from({length:c.R},()=>[]),counts=Array.from({length:c.R},()=>Array(c.R).fill(0)),hits=Array(c.E).fill(0);
 for(let r=0;r<c.R;r++)for(let t=0;t<c.T;t++){
  const idx=initial[`R${r}.topk_idx[${t}]`],tok={r,t,idx,key:`${r}:${t}`,gid:r*c.M+t,slot:Array(c.K).fill(-1),gsge:Array(c.K).fill(-1),local:-1};
  const seen=new Set();idx.forEach((e,j)=>{if(e<0)return;hits[e]++;const d=Math.floor(e/perRank);if(seen.has(d))return;seen.add(d);tok.slot[j]=counts[r][d]++;if(d===r)tok.local=tok.slot[j];incoming[d].push({tok,j,slot:tok.slot[j]});});
  const rem=[...seen].filter(d=>d!==r).sort((a,b)=>(a-r+c.R)%c.R-(b-r+c.R)%c.R);for(let j=0;j<c.K;j++)if(tok.slot[j]>=0&&Math.floor(idx[j]/perRank)!==r)tok.gsge[j]=rem.indexOf(Math.floor(idx[j]/perRank))*6;
  tokens.push(tok);
 }
 const start=Array.from({length:c.R},(_,r)=>{let off=0;return Array.from({length:perRank},(_,e)=>{let v=off;off+=align(hits[r*perRank+e]);return v;});});
 const records=incoming.map((arr,d)=>{arr.sort((a,b)=>a.tok.r-b.tok.r||a.slot-b.slot);const next=[...start[d]];return arr.map((x,pos)=>{let slots=Array(c.K).fill(-1),last=-1;x.tok.idx.forEach((e,j)=>{if(e>=d*perRank&&e<(d+1)*perRank){slots[j]=next[e-d*perRank]++;last=j;}});return {...x,pos,slots,meta:[...slots,x.tok.gid,last]};});});
 const byteSize={hidden:c.H*(c.fp8?1:2),meta:(c.sfPacks?Math.ceil(c.sfPacks*2/32)*32:0)+Math.ceil((c.K*4+(c.cached?0:Math.ceil(c.K*8/32)*32+4))/32)*32};byteSize.record=byteSize.hidden+byteSize.meta;
 const topks=(r,max=c.T)=>tokens.filter(t=>t.r===r&&t.t<max),contrib=(t,d)=>Number(t.idx.some(e=>e>=0&&Math.floor(e/perRank)===d));
 function value(id,path,producer){const l=m.ledger[id],obj=l.obj,r=l.rank,i=l.index,p=path,t=tokens.find(t=>t.r===r&&t.t===Number(i)),f=producer>=0?m.frames[producer]:null;
  if(obj==='rank_histogram_sum_view')return producer<0?0:counts[r][p[0]];
  if(obj==='ub_rank_histogram')return producer<0?0:f.stage==='prefix'?topks(r,Number(i)).reduce((n,t)=>n+contrib(t,p[0]),0):tokens.filter(t=>t.r===r&&t.t===Number(i)).reduce((n,t)=>n+contrib(t,p[0]),0);
  if(obj==='local_rank_histogram'){if(!p.length)return 0;if(p[0]==='arrival')return f.stage==='prefix'?2:1;return tokens.filter(t=>t.r===r&&(f.stage==='prefix'?t.t<Number(i):t.t===Number(i))).reduce((n,t)=>n+contrib(t,p[1]),0);}
  if(obj==='ub_expert_histogram')return producer<0?0:tokens.filter(t=>t.r===r&&t.t===Number(i)).reduce((n,t)=>n+t.idx.filter(e=>e===p[0]).length,0);
  if(obj==='expert_histogram_sum_view'){if(producer<0)return 0;let upto=Math.max(...f.writes.filter(w=>m.ledger[w.id]?.obj==='ub_expert_histogram').map(w=>Number(m.ledger[w.id].index)));return topks(r,upto+1).reduce((n,t)=>n+t.idx.filter(e=>e===p[0]).length,0);}
  if(obj==='num_unaligned_recv_tokens_per_expert')return hits[r*perRank+p[0]];
  if(obj==='psum_num_recv_tokens_per_expert')return start[r][p[0]]+hits[r*perRank+p[0]];
  if(obj==='psum_num_recv_tokens_per_rank')return counts.slice(0,p[0]+1).reduce((n,x)=>n+x[r],0);
  if(obj==='dst_buffer_slot_idx')return t.slot[p[0]];
  if(obj==='dst_gsge_idx')return t.gsge[p[0]];
  if(obj==='local_copy_dst_slot_idx')return producer<0?-1:t.local;
  if(obj==='recv_src_metadata')return records[r][Number(i)].meta[p[0]];
  if(obj==='epilogue_expert_counter')return records[r].slice(0,p[0]).reduce((n,x)=>n+x.tok.idx.filter(e=>e===r*perRank+p[1]).length,0);
  if(obj==='metadata_send_buffer'){if(p[0]==='src_global_idx')return t.gid;const field={topk:'topk_idx',weights:'topk_weights',sf:'sf'}[p[0]];return initial[`R${r}.${field}[${i}]`]?.[p[1]];}
  if(obj==='recv_buffer'){const [sr,sl]=String(i).split(',').map(Number),rec=records[r].find(x=>x.tok.r===sr&&x.slot===sl),tok=rec.tok;if(p[0]==='hidden')return initial[`R${tok.r}.x[${tok.t}]`][p[1]];if(p[1]==='src_global_idx')return tok.gid;return initial[`R${tok.r}.${({topk:'topk_idx',weights:'topk_weights',sf:'sf'})[p[1]]}[${tok.t}]`]?.[p[2]];}
  if(['recv_x','recv_topk_weights','recv_sf'].includes(obj)){const rec=records[r].find(x=>x.slots.includes(Number(i)));if(!rec)return 0;const tok=rec.tok,field={recv_x:'x',recv_topk_weights:'topk_weights',recv_sf:'sf'}[obj];return initial[`R${tok.r}.${field}[${tok.t}]`][obj==='recv_topk_weights'?rec.slots.indexOf(Number(i)):p[0]];}
  if(obj==='SQE'){const peers=t.idx.map((e,j)=>({e,j,d:Math.floor(e/perRank)})).filter(x=>t.gsge[x.j]>=0).sort((a,b)=>t.gsge[a.j]-t.gsge[b.j]),z=peers[p[0]],slot=t.slot[z.j];if(p[1]==='SGEs'){let bytes=p[2]===0?byteSize.hidden:byteSize.meta;return p[3]==='bytes'?bytes:`R${r}.${p[2]===0?'x':'metadata_send_buffer'}+${t.t*bytes}`;}return {logicalSQE:p[0],physicalSQE:p[0],dst_rank:z.d,dst_slot:slot,remote_offset:(r*c.M+slot)*byteSize.record,num_sges:2,validWQEBBs:Math.ceil((48+2*16)/64),reservedWQEBBs:4,finalFlags:p[0]===peers.length-1}[p[1]];}
  if(obj==='signals')return producer<0?0:1;
  // Human-provided leaf inputs are authoritative frame-0 inputs, not kernel outputs.
  return path.reduce((x,k)=>x?.[k],initial[id]);
 }
 return {value,counts,hits,start,records,tokens,byteSize};
}
