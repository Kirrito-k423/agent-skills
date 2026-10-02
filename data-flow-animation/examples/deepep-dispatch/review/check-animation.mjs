import assert from 'node:assert/strict';
import {buildModel,PRESETS,UNKNOWN} from '../animation/model.mjs';
const report=[];
for(const preset of Object.keys(PRESETS)){
 const m=buildModel(preset),c=m.config,actual=m.frames.at(-1).snapshot;
 const rankCounts=Array.from({length:c.R},()=>Array(c.R).fill(0)),expCounts=Array.from({length:c.R},()=>Array(c.E/c.R).fill(0));
 for(const t of m.tokens){const dests=new Set();for(const e of t.topk){if(e<0)continue;const d=Math.floor(e/(c.E/c.R));dests.add(d);expCounts[d][e%(c.E/c.R)]++;}for(const d of dests)rankCounts[t.r][d]++;}
 assert.deepEqual(m.counts,rankCounts);assert.deepEqual(m.expertCounts,expCounts);
 let nRecv=0,nExpand=0;
 for(let d=0;d<c.R;d++){
  const used=new Set();let nextBase=0;
  expCounts[d].forEach((n,e)=>{assert.equal(m.prefixExpert[d][e],nextBase+n);nextBase+=Math.ceil(n/c.A)*c.A;});assert.equal(m.expanded[d],nextBase);
  for(const rec of m.outputPlan[d]){
   nRecv++;const t=m.tokens.find(t=>t.key===rec.key);assert(t);let master=-1;
   rec.slots.forEach((slot,j)=>{const e=t.topk[j],local=e>=d*(c.E/c.R)&&e<(d+1)*(c.E/c.R);assert.equal(slot>=0,local);if(!local)return;master=j;nExpand++;assert(!used.has(slot));used.add(slot);assert.deepEqual(actual[m.id(d,'recv_x',slot)],t.x);if(c.weights)assert.equal(actual[m.id(d,'recv_topk_weights',slot)],t.weights[j]);if(c.fp8)assert.deepEqual(actual[m.id(d,'recv_sf',slot)],t.sf);});
   assert.equal(rec.master,master);assert.deepEqual(actual[m.id(d,'recv_src_metadata',rec.pos)], [...rec.slots,t.gid,master]);
  }
  for(let slot=0;slot<m.expanded[d];slot++)if(!used.has(slot)){assert.deepEqual(actual[m.id(d,'recv_x',slot)],c.zeroPadding?Array(c.H).fill(0):UNKNOWN);if(c.weights)assert.equal(actual[m.id(d,'recv_topk_weights',slot)],c.zeroPadding?0:UNKNOWN);}
 }
 assert.equal(nRecv,rankCounts.flat().reduce((a,b)=>a+b,0));assert.equal(nExpand,expCounts.flat().reduce((a,b)=>a+b,0));
 const issues=[];let prior;
 for(const f of m.frames){if(prior)for(const rd of f.reads){if(JSON.stringify(rd.value)!==JSON.stringify(prior[rd.id]))issues.push(`frame ${f.step} read ${rd.id} not pre-write snapshot`);}prior=f.snapshot;}
 if(!c.cached){const count=m.frames.find(f=>f.stage==='counts');if(count){const allMeta=m.tokens.every(t=>count.snapshot[m.id(t.r,'metadata_send_buffer',t.t)]!==UNKNOWN);if(!allMeta)issues.push('counts published before metadata needed by worker431-451');}}
 let readyCells=0;
 if(!c.cached){
  const prefix=m.frames.find(f=>f.stage==='prefix'), slots=m.frames.find(f=>f.stage==='slots');
  assert(prefix&&slots);assert.equal(prefix.reads.length,c.R*c.C);
  for(let r=0;r<c.R;r++)for(let core=0;core<c.C;core++){
   const cell=m.id(r,'local_rank_histogram',core), read=prefix.reads.find(x=>x.id===cell);
   assert(read,`${preset} missing readiness read ${cell}`);assert.equal(read.value.arrival,1,`${preset} not ready ${cell}`);
   const perCore=Array(c.R).fill(0);
   for(const t of m.tokens.filter(t=>t.r===r&&t.t===core))for(const d of new Set(t.topk.filter(e=>e>=0).map(e=>Math.floor(e/(c.E/c.R)))))perCore[d]++;
   assert.deepEqual(read.value.count,perCore);readyCells++;
   const publish=m.frames.slice(0,prefix.step).flatMap(f=>f.writes).find(w=>w.id===cell&&w.after?.arrival===1);
   assert(publish,`${preset} absent explicit publish ${cell}`);assert.equal(publish.before,0);
   assert.equal(prefix.snapshot[cell].arrival,2);assert.equal(slots.snapshot[cell],0);
  }
  if(c.T===0){const idle=m.frames.find(f=>f.stage==='idle');assert(idle&&idle.step<prefix.step);assert.equal(idle.writes.length,c.R*c.C);}
 }
 assert.deepEqual(issues,[]);
 report.push({preset,nRecv,nExpand,readyCells,oracle:'PASS',issues});
}
console.log(JSON.stringify(report,null,2));
