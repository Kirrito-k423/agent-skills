import {buildModel,PRESETS,UNKNOWN} from '../animation/model.mjs';
import {reference} from './numeric-reference.mjs';

import {queries,equal,at,derive} from './numeric-oracle.mjs';
import fs from 'node:fs';import crypto from 'node:crypto';
const provenanceBefore=crypto.createHash('sha256').update(fs.readFileSync(new URL('../animation/provenance.mjs',import.meta.url))).digest('hex');
const {explain}=await import('../animation/provenance.mjs');
const issues=new Map(),stats={queries:0,computed:0,operands:0,missingComputed:0,ledgerOperands:0,unboundOperands:0,nonNumericOperands:0},cases={};
function fail(kind,q,extra){const key=[kind,q.objectId?.replace(/\[[^\]]*\]/g,'[]'),q.phase].join('|');let x=issues.get(key);if(x)x.count++;else issues.set(key,{kind,query:q,...extra,count:1});}
for(const preset of Object.keys(PRESETS)){
 const m=buildModel(preset);derive(m);const independent=reference(m);let n=0;
 for(const query of queries(m)){const {expected,...q}=query;n++;stats.queries++;let x;
 try{x=explain(m,q);}catch(e){fail('exception',{preset,...q},{message:e.message});continue;}
 if(typeof expected==='string'&&x.operation.includes('缓存继承'))fail('false_cached_inheritance',{preset,...q},{operation:x.operation,origin:x.origin});
 if(x.calculation.some(t=>/NaN|undefined/.test(t)))fail('invalid_calculation_text',{preset,...q},{calculation:x.calculation});
 if(!equal(x.result,expected))fail('result_mismatch',{preset,...q},{expected,actual:x.result});
 const bound=q.phase==='read-before'||q.phase==='write-before'?q.step-1:q.step;
 let latest=-1;for(let k=0;k<=bound;k++){const f=m.frames[k];if(!f.writes.some(w=>w.id===q.objectId))continue;const field=q.elementPath[0],obj=m.ledger[q.objectId].obj,write=f.writes.find(w=>w.id===q.objectId);let actualWrite=true;if(['ub_rank_histogram','ub_expert_histogram'].includes(obj)&&f.stage==='histogram'&&q.elementPath.length&&equal(at(write.before,q.elementPath),at(write.after,q.elementPath)))actualWrite=false;if(obj==='local_copy_dst_slot_idx'&&['slots','restore'].includes(f.stage)&&write.after===-1)actualWrite=false;if(m.ledger[q.objectId].obj==='signals'&&q.elementPath.length)actualWrite=field==='metadata_ready'?f.title.startsWith('metadata_ready'):field==='local_copy_ready'?['slots','restore'].includes(f.stage):field==='doorbell'?f.stage==='issue':field==='payload'?f.stage==='receive':field==='arrival'?f.stage==='counts':false;if(actualWrite)latest=k;}if(typeof expected==='number'||typeof expected==='boolean'||(m.ledger[q.objectId].obj==='SQE'&&q.elementPath.at(-1)==='source')){const ref=independent.value(q.objectId,q.elementPath,latest);if(!equal(expected,ref))fail('source_equation_mismatch',{preset,...q},{snapshot:expected,independent:ref});}
 if(x.producerStep!==latest)fail('producer_mismatch',{preset,...q},{expectedProducer:latest,actualProducer:x.producerStep});
 if(x.producerStep>bound)fail('future_producer',{preset,...q},{producer:x.producerStep,bound});
 if(x.computed!==undefined){stats.computed++;if(!equal(x.computed,expected))fail('computed_mismatch',{preset,...q},{expected,computed:x.computed});}
 else if(typeof expected==='number'&&x.producerStep>=0)stats.missingComputed++;
 for(const op of x.operands||[]){stats.operands++;
  if(op.objectId in m.ledger){stats.ledgerOperands++;const f=m.frames[op.step],actual=op.phase==='previous-fresh-input'||op.phase==='original-input'?at(m.frames[0].snapshot[op.objectId],op.elementPath||[]):op.phase==='read-before'?at(f?.reads.find(r=>r.id===op.objectId)?.value,op.elementPath||[]):at(m.frames[Math.max(0,(op.step??0)-1)]?.snapshot[op.objectId],op.elementPath||[]);
   if(!equal(op.value,actual))fail('operand_snapshot_mismatch',{preset,...q},{operand:op,actual});
   if(op.step>q.step)fail('future_operand',{preset,...q},{operand:op});
   if(op.value===UNKNOWN&&typeof expected==='number'){stats.nonNumericOperands++;fail('unknown_arithmetic_operand',{preset,...q},{operand:op,result:expected,operation:x.operation});}
  }else if(op.kind==='parameter'&&op.objectId?.startsWith('@config.')){if(!equal(op.value,m.config[op.objectId.slice(8)]))fail('parameter_mismatch',{preset,...q},{operand:op});}else if(['constant','event','input','index','layout','event-set'].includes(op.kind)){if(op.kind==='event'&&op.step>=0&&op.value!==m.frames[op.step]?.title)fail('event_mismatch',{preset,...q},{operand:op});}else{stats.unboundOperands++;fail('unbound_operand',{preset,...q},{operand:op});}
 }
 }
 cases[preset]={queries:n};
}
const provenanceAfter=crypto.createHash('sha256').update(fs.readFileSync(new URL('../animation/provenance.mjs',import.meta.url))).digest('hex');if(provenanceAfter!==provenanceBefore)throw Error('Author modified provenance during review run; rerun frozen artifact');
const result={status:issues.size?'REWORK':'SNAPSHOT_CHECK_PASS',reviewer:'independent-review',scope:'phase snapshot/producer upper bound/available computed/operand backreference; semantic audit separate',model_sha256:crypto.createHash('sha256').update(fs.readFileSync(new URL('../animation/model.mjs',import.meta.url))).digest('hex'),provenance_sha256:crypto.createHash('sha256').update(fs.readFileSync(new URL('../animation/provenance.mjs',import.meta.url))).digest('hex'),stats,cases,issues:[...issues.values()]};fs.writeFileSync(new URL(process.env.NUMERIC_REPORT||'numeric-oracle-r2.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,issues:result.issues.slice(0,12)},null,2));
