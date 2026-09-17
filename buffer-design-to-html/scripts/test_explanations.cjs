#!/usr/bin/env node
'use strict';
// 说明契约与逐条源码证据校验；小模型全遍历，大重复序列按首/中/末抽样。
const fs=require('node:fs'),path=require('node:path');
const {loadHtml}=require('./test_template.cjs');
const fail=(ok,msg)=>{if(!ok)throw Error(msg);};
const text=v=>typeof v==='string'&&v.trim().length>0;
function verifyExplanation(x,n,Core,stats,cache){
 fail(x&&typeof x==='object',n.id+' 没有详细说明');
 for(const key of ['purpose','necessity','example'])fail(Array.isArray(x[key])&&x[key].length>0&&x[key].every(text),n.id+' 缺少 '+key);
 fail(Array.isArray(x.formulaSteps)&&x.formulaSteps.length>0,n.id+' 没有公式推导');
 for(const s of x.formulaSteps)for(const k of ['label','expression','substitution','reason'])fail(text(s[k]),n.id+' 公式缺少 '+k);
 fail(Array.isArray(x.boundaries),n.id+' 没有解释边界字段');
 fail(Array.isArray(x.lifecycle)&&x.lifecycle.length>0,n.id+' 没有使用时序');
 for(const s of x.lifecycle){
  for(const k of ['phase','actor','action','condition'])fail(text(s[k]),n.id+' 时序缺少 '+k);
  fail(Array.isArray(s.evidence)&&s.evidence.length>0,n.id+' 时序没有源码证据：'+s.phase);
  for(const p of s.evidence){
   fail(text(p.file)&&text(p.fn)&&text(p.role)&&text(p.code),n.id+' 源码信息不完整');
   fail(Number.isInteger(p.start)&&p.start>0&&Number.isInteger(p.end)&&p.end>=p.start,n.id+' 无效行号');
   fail(Array.isArray(p.highlights)&&p.highlights.length>0,n.id+' 缺少高亮对象');
   const key=JSON.stringify([p.file,p.start,p.end,p.highlights]);
   if(cache.has(key))continue;
   cache.add(key);stats.proofs++;
   const parts=Core.highlightSegments(p.code,p.highlights),names=new Set(parts.filter(s=>s.highlight).map(s=>s.text));
   fail(parts.map(s=>s.text).join('')===p.code,n.id+' 高亮改变原文');
   for(const name of p.highlights)fail(names.has(name),n.id+' '+s.phase+' L'+p.start+'–'+p.end+' 缺少真实高亮 '+name);
   if(!/合成|教学示例/.test(p.file)){
    fail(path.isAbsolute(p.file),n.id+' 真实源码不是绝对路径');
    const lines=fs.readFileSync(p.file,'utf8').replace(/\r\n/g,'\n').split('\n');
    fail(lines.slice(p.start-1,p.end).join('\n')===p.code,n.id+' 说明证据与源码行不一致');
   }
  }
 }
 const serialized=JSON.stringify(x);
 fail(!/undefined|\bNaN\b|详细解释生成失败/.test(serialized),n.id+' 存在未定义代入');
 stats.nodes++;
}
function inspect(Case,Core,raw,bank=0){
 const model=Case.build(raw,bank),stats={nodes:0,proofs:0,sampled:0},cache=new Set(),seen=new Set();
 function walk(n,targets){
  if(!seen.has(n.id)){seen.add(n.id);verifyExplanation(Case.explainSpace(n,model.values),n,Core,stats,cache);}
  fail(stats.nodes<25000,'说明测试超出有界节点预算');
  const kids=Core.childrenOf(n);
  if(n.rangeCount!==undefined){
   if(!targets){const c=n.rangeCount,a=n.rangeStart;targets=c<=8n?Array.from({length:Number(c)},(_,i)=>a+BigInt(i)):[a,a+c/2n,a+c-1n];if(c>8n)stats.sampled++;}
   for(const k of kids){
    if(!seen.has(k.id)){seen.add(k.id);verifyExplanation(Case.explainSpace(k,model.values),k,Core,stats,cache);}
    const a=k.repeatIndex!==undefined?k.repeatIndex:k.rangeStart,c=k.repeatIndex!==undefined?1n:k.rangeCount;
    const chosen=targets.filter(i=>i>=a&&i<a+c);
    if(chosen.length)walk(k,k.repeatIndex!==undefined?undefined:chosen);
   }
  }else for(const k of kids)walk(k);
 }
 walk(model.root);
 return {stats,model};
}
function main(){
 const file=process.argv[2]||path.join(__dirname,'../assets/buffer-design-template.html'),{Case,Core}=loadHtml(file);
 fail(typeof Case.explainSpace==='function','缺少 Case.explainSpace');
 let first,changed=false,total=0;
 for(const p of Case.presets){if(p.expectInvalid)continue;const {stats,model}=inspect(Case,Core,p.values);total+=stats.nodes;
  const example=JSON.stringify(Case.explainSpace(model.root,model.values).example);if(first===undefined)first=example;else if(example!==first)changed=true;
  console.log('通过：'+p.label+'，'+stats.nodes+' 个空间说明、'+stats.proofs+' 组精确行证据；'+stats.sampled+' 个大序列抽样。');
 }
 fail(changed,'当前参数变化未反映到根空间实例');
 const p=Case.presets.find(p=>!p.expectInvalid);if(Case.build(p.values).bankPairs){const r=inspect(Case,Core,p.values,1);console.log('通过：Bank 1，'+r.stats.nodes+' 个空间说明。');}
 // 反例：契约必须能识别单句概要、失去时序证据和未更新的动态代入。
 const m=Case.build(p.values),x=Case.explainSpace(m.root,m.values),mutations=[v=>{v.formulaSteps=[];},v=>{v.lifecycle[0].evidence=[];},v=>{v.example=['undefined'];}];
 for(const mutate of mutations){const v=JSON.parse(JSON.stringify(x));mutate(v);let rejected=false;try{verifyExplanation(v,m.root,Core,{nodes:0,proofs:0},new Set());}catch{rejected=true;}fail(rejected,'未拒绝说明篡改');}
 console.log('通过：'+total+' 个空间说明，动态实例变化与 3 类说明篡改反例。此检查不替代时序语义审阅或设备运行。');
}
module.exports={inspect,verifyExplanation};
if(require.main===module)try{main();}catch(e){console.error('说明校验失败：'+e.message);process.exitCode=1;}
