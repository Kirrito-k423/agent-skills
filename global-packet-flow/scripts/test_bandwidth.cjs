#!/usr/bin/env node
/* 不均匀测量、并列时间、零增量和来源组成的独立手算例。 */
const assert=require('node:assert/strict'),B=require('../assets/bandwidth.js');
const tasks=[[0,1,0,0,2,0,0],[2,1,1,0,2,0,1],[1,1,0,0,1,0,-1],[3,3,0,0,0,0,2]];
const events=[[10,0,2,0,0],[10,1,1,0,0],[12,2,8,0,0],[14,0,4,0,0],[14,1,2,0,0],[15,1,0,0,8],[17,0,0,0,0],[20,1,3,0,0],[25,3,100,0,0]];
const accepted=tasks.map(()=>true),d=B.build(tasks,events,accepted);
assert.equal(d.samples,4);assert.equal(d.initial,3);assert.equal(d.observed,12);
assert.deepEqual(d.intervals.map(i=>[i.start,i.end,i.total,i.rate]),[[10,14,6,1.5],[14,17,0,0],[17,20,3,1]]);
assert.deepEqual(d.intervals[0].groups,{'0':4,'1':2});assert.deepEqual(d.intervals[0].ranks,{'1':6});
const source=B.build(tasks,events,accepted,{axis:'src'});
assert.deepEqual(source.intervals[0].ranks,{'0':4,'2':2});
assert.equal(B.build(tasks,events,accepted,{local:true}).observed,20);
assert.equal(B.build(tasks,events,accepted,{group:'1'}).observed,6);
assert.equal(B.build(tasks,events,accepted,{rank:'2',axis:'src'}).observed,6);
assert.equal(B.build(tasks,events,[true,false,false,false]).observed,6);
assert.equal(B.build(tasks,events,accepted,{rank:'2',axis:'dst'}).samples,0);
assert.equal(B.build(tasks,events.slice(0,2),accepted).intervals.length,0);
assert.deepEqual([9,10,10.1,14,14.1,20,21].map(t=>B.locate(d,t)),[-1,-1,0,0,1,2,-1]);
const w=B.build(tasks,events,accepted,{mode:'window',window:6});
assert.deepEqual(w.intervals.map(i=>[i.start,i.end,i.total,i.rate]),[[10,16,6,1],[16,20,3,.75]]);
for(const data of [d,source,w])for(const i of data.intervals){
 assert.equal(Object.values(i.groups).reduce((a,b)=>a+b,0),i.total);
 assert.equal(Object.values(i.ranks).reduce((a,b)=>a+b,0),i.total);
}
const projected=B.project(d,8,22,7);
assert.equal(projected.reduce((n,b)=>n+b.total*b.coverage,0),9);
assert.equal(Math.max(...projected.map(b=>b.peak)),1.5);
assert.equal(projected[0].coverage,0);assert.equal(projected.at(-1).coverage,0);
for(const p of projected)if(p.coverage)for(const k of ['groups','ranks'])assert.ok(Math.abs(Object.values(p[k]).reduce((a,b)=>a+b,0)-p.total)<1e-12);
assert.equal(B.gbps(2,512,.001),1024);assert.equal(B.gbps(2,128,.001),256);
assert.equal(B.gbps(2,512,0),null);
assert.throws(()=>B.build(tasks,[events[3],events[0]],accepted));
console.log('带宽测试通过：不等间隔、首测基线、并列时间、零增量、本机复制、双 rank 口径、筛选、窗口尾段、逐项守恒、边界查询、像素积分、峰值、单位换算');
