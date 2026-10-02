import assert from 'node:assert/strict';import fs from 'node:fs';import {buildModel,history,PRESETS,UNKNOWN} from './model.mjs';
let assertions=0;const ok=(v,msg)=>{assert(v,msg);assertions++;},eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);assertions++;};const source=JSON.parse(fs.readFileSync(new URL('./sources.json',import.meta.url)));
for(const preset of Object.keys(PRESETS)){
 const m=buildModel(preset),c=m.config,final=m.frames.at(-1).snapshot;ok(c.C>=16,'host core constraint');ok((c.A&(c.A-1))===0,'alignment');
 let hits=0,copies=0;const count=Array.from({length:4},()=>Array(4).fill(0)),expert=Array.from({length:4},()=>[0,0]);
 for(const t of m.tokens){const ds=new Set();for(const e of t.topk){ok(e===-1||(e>=0&&e<8),'legal expert');if(e>=0){expert[Math.floor(e/2)][e%2]++;hits++;ds.add(Math.floor(e/2));}}for(const d of ds){count[t.r][d]++;copies++;}eq(t.slot.filter(s=>s>=0).length,ds.size,'one slot per dst rank');ok(new Set(t.topk.filter(e=>e>=0)).size===t.topk.filter(e=>e>=0).length,'distinct valid experts');}
 eq(m.counts,count,'rank dedup oracle');eq(m.expertCounts,expert,'expert histogram oracle');eq(m.recvPlan.flat().length,copies,'recv unique copies');
 let outputHits=0;for(let dst=0;dst<4;dst++){let alignedBase=0;for(let e=0;e<2;e++){eq(m.prefixExpert[dst][e],alignedBase+expert[dst][e],'expert mixed prefix');alignedBase+=Math.ceil(expert[dst][e]/c.A)*c.A;}eq(m.expanded[dst],alignedBase,'capacity including padding');
 const used=new Set();for(const rec of m.outputPlan[dst]){const recvId=m.id(dst,'recv_buffer',`${rec.r},${rec.slot}`);eq(final[recvId].hidden,rec.x,'recv hidden');ok(rec.slot>=0&&rec.slot<c.M,'source partition bound');eq(final[m.id(dst,'recv_src_metadata',rec.pos)],rec.metadata,'source metadata');let master=-1;for(let j=0;j<2;j++){const slot=rec.slots[j];if(slot<0)continue;master=j;ok(!used.has(slot),'no overwrite');used.add(slot);eq(final[m.id(dst,'recv_x',slot)],rec.x,'full 256 payload');if(c.weights)eq(final[m.id(dst,'recv_topk_weights',slot)],rec.weights[j],'expert weight');if(c.sfPacks)eq(final[m.id(dst,'recv_sf',slot)],rec.sf,'all SF packs');outputHits++;}eq(rec.master,master,'last local j master');}
 for(let slot=0;slot<m.expanded[dst];slot++)if(!used.has(slot)){eq(final[m.id(dst,'recv_x',slot)],c.zeroPadding?Array(256).fill(0):UNKNOWN,'padding unknown vs zero');}
 }
 eq(outputHits,hits,'expert hit conservation');
 for(const f of m.frames){ok(Array.isArray(f.transfers),'transfers array');for(const src of f.sources){ok(source.files[src.file][src.def-1].includes(src.fn),'real function definition');for(const line of src.active){ok(line>=src.start&&line<=src.end,'active in excerpt');const text=source.files[src.file][line-1];ok(text.trim()&&!/^\s*\/\//.test(text)&&!/^\s*}\s*$/.test(text),'no blank/comment/brace red');}}
 if(f.stage==='prefix')for(const read of f.reads)eq(read.value.arrival,1,'all active and idle cores publish ready before prefix');
 if(f.step>0)for(const read of f.reads)eq(read.value,m.frames[f.step-1].snapshot[read.id],'read captures pre-write');for(const w of f.writes){eq(w.after,f.snapshot[w.id],'write state');if(f.step>0)eq(w.before,m.frames[f.step-1].snapshot[w.id],'write before state');}
 }
 const local=m.frames.find(f=>f.stage==='local'),metaReady=m.frames.find(f=>f.title.startsWith('metadata_ready')),countsFrame=m.frames.find(f=>f.stage==='counts');ok(metaReady.step<local.step,'metadata ready before local consume');if(countsFrame)ok(countsFrame.step>local.step,'counts after SIMT metadata');
 if(c.cached){ok(!m.frames.some(f=>['histogram','prefix','counts','epPrefix'].includes(f.stage)),'cached skip stats');ok(!m.frames.some(f=>f.writes.some(w=>w.id.includes('recv_src_metadata'))),'cached reuses metadata');}
 if(!c.weights)ok(!Object.keys(m.ledger).some(k=>k.includes('topk_weights')),'no optional weights cells');
 if(c.T){const h=history(m,'R0.x[0]',0);eq(h[0].value,0,'zero payload distinct from unknown');}
 console.log('PASS',preset,`${m.frames.length} frames / ${copies} rank copies / ${hits} expert hits`);
}
console.log(`${assertions} invariant/source/read-write assertions PASS`);
