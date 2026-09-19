#!/usr/bin/env node
/* 手工构造不等量任务，验证加权阈值、时间并列、筛选与未达状态。 */
const assert=require('node:assert/strict');
const {build,at}=require('../assets/progress.js');
const tasks=[[0,0,0,0,1,0,0],[1,0,1,0,9,0,0],[1,1,0,0,0,0,1]];
const obs=[[0,1,10,0,0,[1023],0,1],[1,5,20,0,0,[1023],1,2]];
const events=[[10,0,10],[20,1,20],[20,1,5],[25,0,0],[30,1,25],[40,1,40]];
const dst=build(tasks,obs,events,10,[true,true,true],'dst');
const aggregate=dst.get('0/all');
assert.equal(aggregate.total,100);
assert.equal(aggregate.firstCheck,1);
assert.deepEqual(aggregate.points,[[0,0],[10,10],[20,35],[30,60],[40,100]]);
assert.deepEqual(aggregate.milestones,[10,30,40,40]);
assert.equal(at(aggregate,19),10);assert.equal(at(aggregate,20),35);
assert.equal(at(aggregate,0),0);assert.equal(at(aggregate,50),100);
assert.equal(dst.get('all/0').total,100);
assert.equal(dst.has('1/1'),false); // 零任务不能伪造 100%。
const src=build(tasks,obs,events,10,[true,true,true],'src');
assert.deepEqual(src.get('0/1').milestones,[20,30,40,40]);
assert.equal(src.get('0/0').total,10);
const filtered=build(tasks,obs,events,10,[false,true,false],'dst');
assert.equal(filtered.get('all/all').total,90);
const partial=build(tasks,obs,events.slice(0,4),10,[true,true,true],'dst').get('all/all');
assert.deepEqual(partial.milestones,[10,null,null,null]);
const unseen=build(tasks,[],[],10,[true,false,false],'dst').get('all/all');
assert.equal(unseen.first,null);assert.equal(unseen.firstCheck,null);
assert.deepEqual(unseen.milestones,[null,null,null,null]);
assert.equal(build(tasks,obs,events,10,[false,false,false],'dst').size,0);
console.log('完成度测试通过：按块加权、并列时间合并、阶梯查询、双 rank 口径、筛选、零任务与未达阈值');
