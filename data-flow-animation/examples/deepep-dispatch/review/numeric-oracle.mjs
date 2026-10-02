import {buildModel,PRESETS,UNKNOWN,PADDING} from '../animation/model.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
export const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const at=(v,path=[])=>path.reduce((x,k)=>x===UNKNOWN||x===PADDING?x:x!==null&&typeof x==='object'?x[k]:undefined,v);
export function* leaves(v,path=[]){
 if(v!==null&&typeof v==='object') { for(const [k,x] of Object.entries(v)) yield* leaves(x,[...path,Array.isArray(v)?Number(k):k]); }
 else yield {path,value:v};
}
export function expectedValue(m,q){
 const f=m.frames[q.step],w=f.writes.find(x=>x.id===q.objectId),r=f.reads.find(x=>x.id===q.objectId);
 const base=q.phase==='initial'?m.frames[0].snapshot[q.objectId]:q.phase==='read-before'?r?.value:q.phase==='write-before'?w?.before:q.phase==='write-after'?w?.after:f.snapshot[q.objectId];
 return at(base,q.elementPath);
}
export function* queries(m){
 for(const [id,value] of Object.entries(m.frames[0].snapshot))for(const leaf of leaves(value))yield {objectId:id,elementPath:leaf.path,step:0,phase:'initial',expected:leaf.value};
 for(const f of m.frames){
  for(const r of f.reads)for(const leaf of leaves(r.value))yield {objectId:r.id,elementPath:leaf.path,step:f.step,phase:'read-before',expected:leaf.value};
  for(const w of f.writes)for(const [phase,val] of [['write-before',w.before],['write-after',w.after]])for(const leaf of leaves(val))yield {objectId:w.id,elementPath:leaf.path,step:f.step,phase,expected:leaf.value};
  for(const w of f.writes)for(const leaf of leaves(w.after))yield {objectId:w.id,elementPath:leaf.path,step:f.step,phase:'history',expected:leaf.value};
 }
 const last=m.frames.at(-1);for(const [id,value]of Object.entries(last.snapshot))for(const leaf of leaves(value))yield {objectId:id,elementPath:leaf.path,step:last.step,phase:'observe',expected:leaf.value};
}
// Derived independently from initial topk snapshots, never use model counts/prefix/outputPlan as operands.
export function derive(m){
 const c=m.config,s=m.frames[0].snapshot;const count=Array.from({length:c.R},()=>Array(c.R).fill(0)),experts=Array(c.E).fill(0),perToken=[];
 for(let r=0;r<c.R;r++)for(let t=0;t<c.T;t++){
  const topk=s[`R${r}.topk_idx[${t}]`],valid=topk.filter(e=>e>=0),rankSet=[...new Set(valid.map(e=>Math.floor(e/(c.E/c.R))))];
  for(const e of valid)experts[e]++;for(const d of rankSet)count[r][d]++;
  perToken.push({r,t,topk,valid,rankSet,contribution:Array.from({length:c.R},(_,d)=>Number(rankSet.includes(d)))});
 }
 const pr=Array.from({length:c.R},(_,d)=>Array.from({length:c.R},(_,r)=>count.slice(0,r+1).reduce((s,x)=>s+x[d],0)));
 const pe=Array.from({length:c.R},(_,d)=>{let start=0;return Array.from({length:c.E/c.R},(_,e)=>{const n=experts[d*(c.E/c.R)+e],end=start+n;start+=Math.ceil(n/c.A)*c.A;return end;});});
 assert.deepEqual(count,m.counts);assert.deepEqual(pr,m.prefixRank);assert.deepEqual(pe,m.prefixExpert);
 if(c.T&&perToken.find(t=>t.r===0&&t.t===3)?.topk.join(',')==='-1,0'){assert.equal(s['R0.topk_idx[3]'][0],-1);assert.equal(s['R0.topk_idx[3]'][1],0);}
 return {count,experts,prefixRank:pr,prefixExpert:pe,perToken};
}
export function inventory(m){
 const out={objectKinds:[...new Set(Object.values(m.ledger).map(x=>x.obj))].sort(),objects:Object.keys(m.ledger).length,phases:{},types:{},byObjectKind:{},queries:0,sameValueWrites:0,unknownLeaves:0,paddingLeaves:0};
 derive(m);
 for(const f of m.frames)for(const w of f.writes)if(equal(w.before,w.after))out.sameValueWrites++;
 for(const q of queries(m)){assert.deepEqual(expectedValue(m,q),q.expected);out.queries++;out.phases[q.phase]=(out.phases[q.phase]||0)+1;const kind=m.ledger[q.objectId].obj;out.byObjectKind[kind]=(out.byObjectKind[kind]||0)+1;out.types[typeof q.expected]=(out.types[typeof q.expected]||0)+1;if(q.expected===UNKNOWN)out.unknownLeaves++;if(q.expected===PADDING)out.paddingLeaves++;}
 return out;
}
if(process.argv.includes('--inventory')){
 const results={reviewer:'independent-review',status:'BASELINE_ONLY',model_sha256:crypto.createHash('sha256').update(fs.readFileSync(new URL('../animation/model.mjs',import.meta.url))).digest('hex'),cases:{}};
 for(const preset of Object.keys(PRESETS))results.cases[preset]=inventory(buildModel(preset));
 fs.writeFileSync(new URL('numeric-baseline.json',import.meta.url),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(Object.fromEntries(Object.entries(results.cases).map(([k,v])=>[k,{queries:v.queries,kinds:v.objectKinds.length,sameWrites:v.sameValueWrites}]))));
}
