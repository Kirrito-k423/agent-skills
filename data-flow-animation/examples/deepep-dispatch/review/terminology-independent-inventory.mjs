import fs from 'node:fs';
import crypto from 'node:crypto';
import {buildModel,PRESETS} from '../animation/model.mjs';
const base=new URL('../',import.meta.url),read=(p)=>fs.readFileSync(new URL(p,base),'utf8'),sources=JSON.parse(read('animation/sources.json'));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const wordRe=/[A-Za-z_][A-Za-z_0-9]*/g;
const output={reviewer:'/root/terminology_review',revision:1,commit:sources.commit,model_sha256:hash(read('animation/model.mjs')),presets:{},all_ledger_objects:new Set(),all_nested_fields:new Set(),all_source_identifiers:new Set(),source_snapshot_verified:true,source_text_hashes:{},surface_words:new Set()};
for(const [file,lines] of Object.entries(sources.files)){
 const raw=read('DeepEP-Ascend/'+file);const actual=raw.replace(/\r\n/g,'\n').split('\n');if(actual.at(-1)==='')actual.pop();
 if(JSON.stringify(actual)!==JSON.stringify(lines))throw Error('source snapshot does not match checkout: '+file);
 output.source_text_hashes[file]=hash(raw);
}
function nested(v,out,p=[]){if(v&&typeof v==='object'){for(const [k,x] of Object.entries(v)){if(!Array.isArray(v))out.add(k);nested(x,out,[...p,k]);}}}
for(const preset of Object.keys(PRESETS)){
 const m=buildModel(preset),objects=new Set(Object.values(m.ledger).map(l=>l.obj)),fields=new Set(),captionWords=new Set(),sourceIdent=new Set(),positions=[];
 Object.values(m.ledger).forEach(l=>{for(const w of ([l.obj,l.dtype,l.owner,l.memory,l.note].join(' ').match(wordRe)||[]))captionWords.add(w);});
 m.frames.forEach(f=>{
   Object.values(f.snapshot).forEach(v=>nested(v,fields));
   for(const w of ([f.title,f.explanation,f.condition,...f.actors].join(' ').match(wordRe)||[]))captionWords.add(w);
   (f.sources||[f.source]).forEach(s=>{for(let line=s.start;line<=s.end;line++){const text=sources.files[s.file][line-1];positions.push({file:s.file,line,text});for(const id of (text.match(wordRe)||[]))sourceIdent.add(id);}});
 });
 output.presets[preset]={frames:m.frames.length,ledger_objects:[...objects].sort(),nested_fields:[...fields].sort(),caption_words:[...captionWords].sort(),source_identifiers:[...sourceIdent].sort(),source_positions:positions};
 objects.forEach(x=>output.all_ledger_objects.add(x));fields.forEach(x=>output.all_nested_fields.add(x));captionWords.forEach(x=>output.surface_words.add(x));sourceIdent.forEach(x=>output.all_source_identifiers.add(x));
}
for(const k of ['all_ledger_objects','all_nested_fields','all_source_identifiers','surface_words'])output[k]=[...output[k]].sort();
fs.writeFileSync(new URL('./terminology-independent-inventory.json',import.meta.url),JSON.stringify(output,null,2));
console.log(JSON.stringify({status:'PREPARED',presets:Object.keys(output.presets).length,objects:output.all_ledger_objects.length,fields:output.all_nested_fields.length,sourceIds:output.all_source_identifiers.length,surfaceWords:output.surface_words.length,sourceSnapshotVerified:true}));
