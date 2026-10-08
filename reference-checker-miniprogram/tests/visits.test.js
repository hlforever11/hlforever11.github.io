const test = require('node:test');
const assert = require('node:assert/strict');
const {createVisitRecorder,historicalBase,BASE_VISITS} = require('../cloudfunctions/userHistory/visits');

function fakeDb(initial) {
  let value=initial,queue=Promise.resolve();
  const db={runTransaction(fn){const job=queue.then(async()=>({result:await fn({collection(name){assert.equal(name,'reference_users');return{doc(id){assert.equal(id,'wenzheng-miniprogram-visits');return{async get(){return{data:value}},async set({data}){value=structuredClone(data)}}}}}})}));queue=job.catch(()=>{});return job}};
  return{db,get:()=>value};
}

test('小程序按指定基数1000开始，首次访问为1001',async()=>{
  const mock=fakeDb();const count=createVisitRecorder(mock.db);
  assert.equal(BASE_VISITS,1000);assert.equal((await count('u',{action:'visitRead'})).total,1000);
  const r=await count('u',{action:'visit',visitId:'session_0001'});
  assert.equal(r.total,1001);assert.equal(r.historyPending,false);assert.equal(r.platform,'miniprogram');
});
test('同一会话重试只计一次，不同会话分别计数',async()=>{
  const mock=fakeDb();const count=createVisitRecorder(mock.db);
  const a=await count('u',{action:'visit',visitId:'session_0001'});
  const b=await count('u',{action:'visit',visitId:'session_0001'});
  const c=await count('u',{action:'visit',visitId:'session_0002'});
  assert.equal(a.total,1001);assert.equal(b.total,1001);assert.equal(c.total,1002);
});
test('并发访问不丢失，部署后仍在1000基数上续计',async()=>{
  const mock=fakeDb();const count=createVisitRecorder(mock.db);
  await Promise.all(Array.from({length:40},(_,i)=>count('u',{action:'visit',visitId:'session_'+String(i).padStart(4,'0')})));
  const r=await createVisitRecorder(mock.db)('u',{action:'visitRead'});assert.equal(r.newVisits,40);assert.equal(r.total,1040);
});
test('已有文档在重新部署后续计，读取不产生访问',async()=>{
  const mock=fakeDb({newVisits:17,legacyBase:120,recentVisits:[],note:'preserved'});
  const count=createVisitRecorder(mock.db);assert.equal((await count('u',{action:'visitRead'})).total,1017);
  assert.equal((await count('u',{action:'visit',visitId:'session_0001'})).total,1018);
  assert.equal(mock.get().note,'preserved');assert.equal(mock.get().legacyBase,1000);
});
test('以前为空值或1041的基数统一改为1000，不抹掉新增记录',async()=>{
  for(const legacyBase of [null,0,1041]){
    const mock=fakeDb({newVisits:8,legacyBase,recentVisits:[]});
    assert.equal((await createVisitRecorder(mock.db)('u',{action:'visitRead'})).total,1008);
  }
});
test('不同微信身份的同名会话分别计数，安全整数溢出拒绝写入',async()=>{
  const mock=fakeDb();const count=createVisitRecorder(mock.db);
  await count('a',{action:'visit',visitId:'session_0001'});
  assert.equal((await count('b',{action:'visit',visitId:'session_0001'})).total,1002);
  const full=fakeDb({newVisits:Number.MAX_SAFE_INTEGER,legacyBase:1000,recentVisits:[]});
  await assert.rejects(createVisitRecorder(full.db)('u',{action:'visitRead'}),/安全整数/);
});
test('无效基数或访问标识不会污染累计值',async()=>{
  for(const x of [-1,1.2,'oops','',undefined])assert.equal(historicalBase(x),null);
  const mock=fakeDb();const count=createVisitRecorder(mock.db);
  assert.equal((await count('u',{action:'visit',visitId:''})).ok,false);assert.equal(mock.get(),undefined);
});
