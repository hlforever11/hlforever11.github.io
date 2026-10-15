import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../counter.js',import.meta.url),'utf8');
const counter='wenzheng_story_pv_base900_20261015_94ef6a7b113e';
const key='wenzheng-story-pv-base900-20261015';
const page='https://hlforever11.github.io/wenzheng-story/?v=2026080701#lessons';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const response=(value,identity=counter)=>new Response(JSON.stringify({key:identity,value}));
let serial=0;
async function execute({newFetch=()=>response(1),old,brokenStorage=false,pageUrl=page,noStatus=false,noHolder=false,noModernAPIs=false}={}){
 const value={textContent:'900'},status={textContent:''},holder={setAttribute(k,v){this[k]=v},title:''};
 const calls=[],timers=new Map(),saved=new Map([
  ['wenzheng-web-pv-base1000-20261008','99999'],['wenzheng-story-pv-confirmed-v1','9999'],
  ...(old===undefined?[]:[[key,String(old)]])]);let id=0;
 const context={window:{},location:{href:pageUrl},crypto:{randomUUID:()=>`page-${++serial}`},AbortController,
  document:{referrer:'',getElementById:id=>({pageVisitCount:value,storyVisitCounter:noHolder?null:holder,storyVisitStatus:noStatus?null:status})[id]},
  localStorage:{getItem:k=>{if(brokenStorage)throw Error('denied');return saved.get(k)},setItem:(k,v)=>{if(brokenStorage)throw Error('denied');saved.set(k,v)}},
  setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),console:{warn(){}},
  fetch:async(url,options)=>{calls.push({url,options});return newFetch(url,options)}};
 if(noModernAPIs){delete context.crypto;delete context.AbortController}
 vm.runInNewContext(source,context);await flush();
 return{value,status,holder,saved,calls,context,timers,expire:async()=>{for(const [id,{fn}] of [...timers]){timers.delete(id);fn()}await flush()}};
}
test('从900加新增访问，共享计数不随链接参数或片段拆分',async()=>{
 let remote=0;const cached=new Map();
 const newFetch=url=>{if(!cached.has(url))cached.set(url,++remote);return response(cached.get(url))};
 const a=await execute({newFetch}),b=await execute({newFetch,pageUrl:'https://hlforever11.github.io/wenzheng-story/?view=raw#record'});
 assert.equal(a.value.textContent,'901');assert.equal(b.value.textContent,'902');
 assert.notEqual(a.calls[0].url,b.calls[0].url);assert.match(a.calls[0].url,new RegExp(`/hit/${counter}`));
 assert.equal(a.calls[0].options.cache,'no-store');assert.equal(a.calls[0].options.referrerPolicy,'no-referrer');
 assert.equal(a.status.textContent,'');assert.equal(a.holder['aria-label'],'协作实录累计访问 901 次');
});
test('旧实录与主站缓存不导入重设计数，只请求新服务一次',async()=>{
 const r=await execute({newFetch:()=>response(13)});
 assert.equal(r.value.textContent,'913');assert.equal(r.saved.get(key),'913');
 assert.equal(r.saved.get('wenzheng-story-pv-confirmed-v1'),'9999');
 assert.equal(r.calls.length,1);assert.match(r.holder.title,/起始基数900/);
 assert.doesNotMatch(r.calls[0].url,/busuanzi/);assert.doesNotMatch(r.status.textContent,/历史/);
});
test('刷新后保留新计数记录，较低云端值提示待同步而不倒退',async()=>{
 const r=await execute({newFetch:()=>response(1),old:915});
 assert.equal(r.value.textContent,'915');assert.match(r.status.textContent,/待同步/);
 const synced=await execute({newFetch:()=>response(16),old:915});
 assert.equal(synced.value.textContent,'916');assert.equal(synced.status.textContent,'');
});
test('hit已计数但响应丢失时只用get读取，迟到响应不覆盖结果',async()=>{
 let late;
 const r=await execute({newFetch:url=>url.includes('/hit/')?new Promise(resolve=>{late=resolve}):response(3)});
 assert.equal(r.value.textContent,'900');assert.match(r.status.textContent,/更新中/);
 assert.equal([...r.timers.values()][0].ms,12000);
 await r.expire();assert.equal(r.value.textContent,'903');assert.match(r.status.textContent,/最近记录/);
 assert.equal(r.calls.length,2);assert.equal(r.calls.filter(c=>c.url.includes('/hit/')).length,1);assert.match(r.calls[1].url,/\/get\//);
 assert.equal(r.calls[0].options.signal.aborted,true);late(response(1));await flush();assert.equal(r.value.textContent,'903');
});
test('断网时显示900或最近确认记录，绝不在本地虚增',async()=>{
 for(const old of [undefined,950]){
  const r=await execute({newFetch:()=>{throw Error('offline')},old});
  assert.equal(r.value.textContent,String(old??900));assert.match(r.status.textContent,/统计暂不可用/);
  assert.equal(r.calls.filter(c=>c.url.includes('/hit/')).length,1);assert.equal(r.calls.length,2);
 }
});
test('非法数值、错误计数标识和溢出不覆盖900基数',async()=>{
 for(const raw of [undefined,null,'',true,-1,1.5,'1oops',Number.MAX_SAFE_INTEGER]){
  const r=await execute({newFetch:()=>response(raw)});assert.equal(r.value.textContent,'900');assert.match(r.status.textContent,/暂不可用/);
 }
 const r=await execute({newFetch:()=>response(9999,'different-site')});assert.equal(r.value.textContent,'900');
});
test('合法零值表示尚无新增访问，合法数字字符串可读取',async()=>{
 const zero=await execute({newFetch:()=>response(0)});assert.equal(zero.value.textContent,'900');assert.equal(zero.status.textContent,'');
 const text=await execute({newFetch:()=>response('12')});assert.equal(text.value.textContent,'912');
});
test('HTTP错误或无效JSON后只读恢复一次',async()=>{
 for(const broken of [()=>new Response('bad gateway',{status:502}),()=>new Response('not JSON')]){
  const r=await execute({newFetch:url=>url.includes('/hit/')?broken():response(4)});
  assert.equal(r.value.textContent,'904');assert.equal(r.calls.length,2);assert.match(r.status.textContent,/最近记录/);
 }
});
test('响应正文挂起也受超时保护，两个请求都挂起时终止等待',async()=>{
 const r=await execute({newFetch:url=>url.includes('/hit/')?{ok:true,json:()=>new Promise(()=>{})}:response(5)});
 await r.expire();assert.equal(r.value.textContent,'905');assert.match(r.status.textContent,/最近记录/);
 const both=await execute({newFetch:()=>new Promise(()=>{})});await both.expire();
 assert.equal([...both.timers.values()][0].ms,8000);await both.expire();
 assert.equal(both.value.textContent,'900');assert.equal(both.timers.size,0);assert.match(both.status.textContent,/暂不可用/);
 assert.equal(both.calls.filter(c=>c.url.includes('/hit/')).length,1);
});
test('重复脚本只计一次，存储权限错误不妨碍云端计数',async()=>{
 const r=await execute({newFetch:()=>response(7),brokenStorage:true});vm.runInNewContext(source,r.context);await flush();
 assert.equal(r.calls.length,1);assert.equal(r.value.textContent,'907');
});
test('非法新缓存忽略，缺失状态元素仍可显示计数',async()=>{
 for(const old of [0,899,'NaN',Infinity])assert.equal((await execute({old})).value.textContent,'901');
 const r=await execute({noStatus:true});assert.equal(r.value.textContent,'901');
 const absent=await execute({noHolder:true});assert.equal(absent.calls.length,0);
});
test('无randomUUID和AbortController时仍可计数，超时仍生效',async()=>{
 const r=await execute({noModernAPIs:true});assert.equal(r.value.textContent,'901');assert.equal(r.calls[0].options.signal,undefined);
 const hanging=await execute({noModernAPIs:true,newFetch:()=>new Promise(()=>{})});
 await hanging.expire();await hanging.expire();assert.match(hanging.status.textContent,/暂不可用/);assert.equal(hanging.timers.size,0);
});
test('HTML、计数脚本版本和审计记录采用同一900基数与新标识',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const history=JSON.parse(readFileSync(new URL('../counter-history.json',import.meta.url),'utf8'));
 assert.match(html,/id="pageVisitCount">900<\/span>/);assert.match(html,/counter.js\?v=20261015-base900-1/);
 assert.doesNotMatch(html,/累计访问至少|历史待恢复/);assert.equal(history.baseline,900);assert.equal(history.resetOn,'2026-10-15');
 assert.equal(history.newVisits.counterKey,counter);assert.equal(history.newVisits.cacheKey,key);
 assert.equal(history.retired.fullHistoryRecovered,false);assert.equal(history.retired.originalOffset,3);
});
