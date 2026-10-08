const test = require('node:test');
const assert = require('node:assert/strict');
const {createVisitRecorder,historicalBase} = require('../cloudfunctions/userHistory/visits');

function fakeDb(initial) {
  let value=initial,queue=Promise.resolve();
  const db={runTransaction(fn){const job=queue.then(async()=>({result:await fn({collection(name){assert.equal(name,'reference_users');return{doc(id){assert.equal(id,'wenzheng-miniprogram-visits');return{async get(){return{data:value}},async set({data}){value=structuredClone(data)}}}}}})}));queue=job.catch(()=>{});return job}};
  return{db,get:()=>value};
}

test('未知历史访问量不会被虚构为访问基数',async()=>{
  const mock=fakeDb();const count=createVisitRecorder(mock.db,()=>undefined);
  const r=await count('u',{action:'visit',visitId:'session_0001'});
  assert.equal(r.total,1);assert.equal(r.historyPending,true);
});
test('同一会话重试只计一次，不同会话分别计数',async()=>{
  const mock=fakeDb();const count=createVisitRecorder(mock.db,()=>100);
  const a=await count('u',{action:'visit',visitId:'session_0001'});
  const b=await count('u',{action:'visit',visitId:'session_0001'});
  const c=await count('u',{action:'visit',visitId:'session_0002'});
  assert.equal(a.total,101);assert.equal(b.total,101);assert.equal(c.total,102);
});
test('并发访问不丢失，历史基数后补不清零新增量',async()=>{
  const mock=fakeDb();let base;const count=createVisitRecorder(mock.db,()=>base);
  await Promise.all(Array.from({length:40},(_,i)=>count('u',{action:'visit',visitId:'session_'+String(i).padStart(4,'0')})));
  base=600;const r=await count('u',{action:'visitRead'});assert.equal(r.newVisits,40);assert.equal(r.total,640);
  base=0;assert.equal((await count('u',{action:'visitRead'})).total,640);
});
test('已有文档在重新部署后续计，读取不产生访问',async()=>{
  const mock=fakeDb({newVisits:17,legacyBase:120,recentVisits:[]});
  const count=createVisitRecorder(mock.db,()=>0);assert.equal((await count('u',{action:'visitRead'})).total,137);
  assert.equal((await count('u',{action:'visit',visitId:'session_0001'})).total,138);
});
test('无效基数或访问标识不会污染累计值',async()=>{
  for(const x of [-1,1.2,'oops','',undefined])assert.equal(historicalBase(x),null);
  const mock=fakeDb();const count=createVisitRecorder(mock.db);
  assert.equal((await count('u',{action:'visit',visitId:''})).ok,false);assert.equal(mock.get(),undefined);
});
