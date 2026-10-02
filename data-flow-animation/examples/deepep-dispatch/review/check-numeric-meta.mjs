import {buildModel,PRESETS} from '../animation/model.mjs';
import {explain} from '../animation/provenance.mjs';
import {metaCases} from './numeric-meta-cases.mjs';
import {equal,at} from './numeric-oracle.mjs';
import fs from 'node:fs';import crypto from 'node:crypto';
const results=[],gaps=[];let queries=0,mutationRejected=0;
for(const preset of Object.keys(PRESETS)){const m=buildModel(preset);let n=0;for(const {query:q,expected} of metaCases(m)){queries++;n++;let x;try{x=explain(m,q);}catch(e){gaps.push({preset,q,error:e.message});continue;}
 if(!equal(x.result,expected)||!equal(x.computed,expected))gaps.push({preset,q,expected,result:x.result,computed:x.computed});
 for(const o of x.operands){if(o.objectId===q.objectId)gaps.push({preset,q,issue:'self_dependency',operand:o});if(o.kind==='parameter'&&!equal(o.value,m.config[o.objectId.slice(8)]))gaps.push({preset,q,issue:'parameter_mismatch',operand:o});if(o.objectId in m.ledger&&!equal(o.value,at(m.frames[0].snapshot[o.objectId],o.elementPath||[])))gaps.push({preset,q,issue:'input_operand_mismatch',operand:o});}
 if(q.objectId.startsWith('@metric.')){let rejected=false;try{explain(m,{...q,value:expected+1});}catch{rejected=true;}if(rejected)mutationRejected++;else gaps.push({preset,q,issue:'wrong_display_value_accepted'});}
 }results.push({preset,queries:n});}
const j={reviewer:'independent-review',status:gaps.length?'REWORK':'PASS',queries,mutationRejected,cases:results,gaps,provenance_sha256:crypto.createHash('sha256').update(fs.readFileSync(new URL('../animation/provenance.mjs',import.meta.url))).digest('hex')};fs.writeFileSync(new URL('numeric-meta-review.json',import.meta.url),JSON.stringify(j,null,2)+'\n');console.log(JSON.stringify({...j,gaps:j.gaps.slice(0,8)},null,2));
