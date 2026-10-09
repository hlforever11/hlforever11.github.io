import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../counter.js',import.meta.url),'utf8');
const counter='wenzheng_web_pv_20261008_3bfea882af07',key='wenzheng-web-pv-base1000-20261008';
let serial=0;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const response=(value,identity=counter)=>new Response(JSON.stringify({key:identity,value}));
async function execute(fetch,old,storageFailure=false){
 const value={textContent:'1,012'},status={textContent:''},holder={classList:{add(){}},setAttribute(){},title:''};
 const saved=new Map(old===undefined?[]:[[key,String(old)],['wenzheng-site-pv-last','9000']]);
 const timers=new Map(),calls=[];let timerId=0;
 const context={window:{},crypto:{randomUUID:()=>`page-${++serial}`},AbortController,
  setTimeout:fn=>{timers.set(++timerId,fn);return timerId},clearTimeout:id=>timers.delete(id),
  document:{getElementById:id=>({siteCounter:holder,websiteVisitCount:value,websiteVisitStatus:status})[id]},
  localStorage:{getItem:k=>{if(storageFailure)throw Error('storage denied');return saved.get(k)},setItem:(k,v)=>{if(storageFailure)throw Error('storage denied');saved.set(k,v)}},
  console:{warn(){}},fetch:async(url,options)=>{calls.push({url,options});return fetch(url,options)}};
 vm.runInNewContext(source,context);await flush();
 return{value,status,holder,saved,calls,context,timers,expire:async()=>{for(const [id,fn] of [...timers]){timers.delete(id);fn()}await flush()}};
}
test('1000基数延续已确认记录，不将检查点再次加到云端值',async()=>{
 const r=await execute(async()=>response('13'));
 assert.equal(r.value.textContent,'1,013');assert.equal(r.saved.get(key),'1013');assert.equal(r.status.textContent,'');
 assert.match(r.calls[0].url,/\/hit\/wenzheng_web_pv_/);assert.equal(r.calls[0].options.cache,'no-store');
});
test('即使共享代理按网址缓存，不同浏览器访问也分别递增',async()=>{
 const cache=new Map();let remote=12;
 const fetch=async url=>{if(!cache.has(url))cache.set(url,++remote);return response(cache.get(url))};
 const a=await execute(fetch),b=await execute(fetch);
 assert.equal(a.value.textContent,'1,013');assert.equal(b.value.textContent,'1,014');assert.notEqual(a.calls[0].url,b.calls[0].url);
});
test('服务失败不虚增或清零；只用不计数的get恢复记录',async()=>{
 const r=await execute(async url=>{if(url.includes('/hit/'))throw Error('connection lost');return response(46)},1045);
 assert.equal(r.value.textContent,'1,046');assert.equal(r.calls.length,2);assert.match(r.calls[1].url,/\/get\//);assert.match(r.status.textContent,/最近记录/);
});
test('两种请求都失败时保持原值，并显示可见失败状态',async()=>{
 const r=await execute(async()=>{throw Error('offline')},1045);
 assert.equal(r.value.textContent,'1,045');assert.match(r.status.textContent,/统计暂不可用/);assert.equal(r.calls.filter(c=>c.url.includes('/hit/')).length,1);
 assert.equal((await execute(async()=>{throw Error('offline')})).value.textContent,'1,012');
});
test('命中已计数但响应丢失，超时后只读恢复，迟到响应不再修改页面',async()=>{
 let late;
 const r=await execute(url=>url.includes('/hit/')?new Promise(resolve=>{late=resolve}):response(14));
 assert.match(r.status.textContent,/更新中/);await r.expire();
 assert.equal(r.value.textContent,'1,014');assert.equal(r.calls.length,2);assert.equal(r.calls[0].options.signal.aborted,true);
 late(response(13));await flush();assert.equal(r.value.textContent,'1,014');
});
test('响应头返回但JSON正文挂起也有超时',async()=>{
 const r=await execute(url=>url.includes('/hit/')?{ok:true,json:()=>new Promise(()=>{})}:response(15));
 await r.expire();assert.equal(r.value.textContent,'1,015');assert.match(r.calls[1].url,/\/get\//);
});
test('get也挂起时停止等待，保留记录且不会再发送hit',async()=>{
 const r=await execute(()=>new Promise(()=>{}));await r.expire();await r.expire();
 assert.equal(r.calls.length,2);assert.equal(r.value.textContent,'1,012');assert.match(r.status.textContent,/统计暂不可用/);assert.equal(r.timers.size,0);
});
test('缺失、非法、错误计数标识和溢出响应均不覆盖历史记录',async()=>{
 for(const raw of [undefined,null,'',true,-1,1.5,'oops',Number.MAX_SAFE_INTEGER]){
  const r=await execute(async()=>response(raw));assert.equal(r.value.textContent,'1,012');assert.match(r.status.textContent,/暂不可用/);
 }
 const r=await execute(async()=>response(9999,'different-site'));assert.equal(r.value.textContent,'1,012');
});
test('重复载入脚本只计一次；低于已确认历史的响应标为待同步',async()=>{
 const r=await execute(async()=>response(20),1050);
 vm.runInNewContext(source,r.context);await flush();assert.equal(r.calls.length,1);assert.equal(r.value.textContent,'1,050');assert.match(r.status.textContent,/待同步/);
});
test('存储故障和非法缓存不阻断云端计数，不混入别的站点旧缓存',async()=>{
 assert.equal((await execute(async()=>response(16),undefined,true)).value.textContent,'1,016');
 for(const old of [0,145,'NaN',Infinity])assert.equal((await execute(async()=>response(16),old)).value.textContent,'1,016');
});
