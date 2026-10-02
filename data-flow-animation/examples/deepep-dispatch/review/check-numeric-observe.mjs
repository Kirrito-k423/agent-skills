import {buildModel,PRESETS} from '../animation/model.mjs';
import {leaves,equal} from './numeric-oracle.mjs';
import fs from 'node:fs';import crypto from 'node:crypto';
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),path=new URL('../animation/provenance.mjs',import.meta.url),startHash=sha(path),{explain}=await import('../animation/provenance.mjs');
let queries=0,computed=0;const cases=[],issues=[],refs=new Map();
for(const preset of Object.keys(PRESETS)){const m=buildModel(preset);let count=0;for(const f of m.frames)for(const [id,value]of Object.entries(f.snapshot))for(const leaf of leaves(value)){
 const q={objectId:id,elementPath:leaf.path,step:f.step,phase:'auto'};let x;queries++;count++;try{x=explain(m,q);}catch(e){if(issues.length<30)issues.push({preset,q,error:e.message});continue;}
 if(!equal(x.result,leaf.value)||(x.computed!==undefined&&!equal(x.computed,leaf.value))){if(issues.length<30)issues.push({preset,q,result:x.result,computed:x.computed,expected:leaf.value});}
 if(typeof leaf.value==='string'&&x.operation.includes('缓存继承')&&issues.length<30)issues.push({preset,q,error:'false cached inheritance on non-value field'});if(x.computed!==undefined)computed++;if(x.producerStep>f.step&&issues.length<30)issues.push({preset,q,error:'future producer'});
 const ref=x.sourceRef,key=JSON.stringify(ref);if(!refs.has(key))refs.set(key,{...ref,example:{preset,...q}});
 }cases.push({preset,frames:m.frames.length,queries:count});}
if(sha(path)!==startHash)throw Error('provenance changed during full-stage review');
for(const ref of refs.values()){const sourcePath=ref.file==='animation/model.mjs'?new URL('../animation/model.mjs',import.meta.url):new URL('../DeepEP-Ascend/'+ref.file,import.meta.url);if(!fs.existsSync(sourcePath)){issues.push({sourceRef:ref,error:'source file absent'});continue;}const text=fs.readFileSync(sourcePath,'utf8').split('\n')[ref.line-1];if(!text?.trim())issues.push({sourceRef:ref,error:'sourceRef line blank/absent'});}
const result={status:issues.length?'REWORK':'PASS',reviewer:'independent-review',provenance_sha256:startHash,queries,computed,cases,sourceRefs:[...refs.values()],issues};fs.writeFileSync(new URL('numeric-all-stages.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,sourceRefs:refs.size},null,2));
