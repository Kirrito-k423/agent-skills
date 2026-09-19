#!/usr/bin/env node
/* 独立手算原子身份与缺失状态，不以位图快照数替代包数。 */
const assert=require('node:assert/strict'),P=require('../assets/packets.js');
assert.equal(P.scope(64).eligible,false);assert.equal(P.scope(64,'30').count,64);
assert.equal(P.scope(512,'0').eligible,true);assert.equal(P.scope(513,'0').eligible,false);
assert.deepEqual(P.scope(64,'30','61').sources,[30]);assert.deepEqual(P.scope(64,'30','61').destinations,[61]);
const L={tasks:[[0,1,0,0,2,28,0],[1,0,1,0,1,29,1],[0,0,0,0,0,0,-1]],observations:[
 [0,1,5,0,0,[1],1,10], [1,2,5,8,0,[3],1,20], [0,6,9,10,0,[3],2,11],
 [0,10,12,0,0,[3,1],3,12], [0,13,15,0,1,[1],4,13]
]};
const d=P.build(L,2,P.scope(2),[true,true,true]),p=d.pairs.find(p=>p.src===0&&p.dst===1);
assert.equal(d.pairs.length,4);assert.equal(d.expected,6);assert.equal(d.observed,5);
assert.deepEqual(p.packets.map(p=>[p.task,p.slot,p.block,p.end,p.record,p.line]),[[0,0,0,5,1,10],[0,0,1,9,2,11],[0,1,0,12,3,12]]);
assert.equal(p.missing,1);assert.equal(d.pairs.find(p=>p.src===0&&p.dst===0).total,0);
assert.deepEqual([0,5,8,9,12,99,0].map(t=>P.at(p.packets,t)),[0,1,1,2,3,3,0]);
assert.equal(P.build(L,2,P.scope(2,'0','1'),[true,true,true]).expected,4);
assert.equal(P.build(L,2,P.scope(2),[false,true,false]).observed,2);
assert.deepEqual(P.build(L,2,P.scope(64),[true,true,true]).pairs,[]);
assert.equal(P.matches(L.tasks[0],{sourceRank:'0',destRank:'1',group:'0'}),true);
assert.equal(P.matches(L.tasks[0],{sourceRank:'1',destRank:'1',group:'all'}),false);
console.log('信包时序测试通过：512 门槛、笛卡尔组合、原子身份、同 tick 包、重复观察去重、复制不重计、未知包、无任务、正反向播放查询与双端筛选');
