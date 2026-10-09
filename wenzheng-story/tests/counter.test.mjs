import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../counter.js',import.meta.url),'utf8');
const counter='wenzheng_story_pv_20261009_5617ac9e430b',key='wenzheng-story-pv-confirmed-v1';
const page='https://hlforever11.github.io/wenzheng-story/?v=2026080701#lessons';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const response=(value,identity=counter)=>new Response(JSON.stringify({key:identity,value}));
let serial=0;
async function execute({newFetch=()=>response(1),historyFetch=()=>new Response('bad gateway',{status:502}),old,brokenStorage=false,pageUrl=page}={}){
 const value={textContent:'2'},status={textContent:''},holder={setAttribute(){},title:''};
 const calls=[],timers=new Map(),saved=new Map([[ 'wenzheng-web-pv-base1000-20261008','9999'],...(old===undefined?[]:[[key,String(old)]])]);let id=0;
 const context={window:{},location:{href:pageUrl},crypto:{randomUUID:()=>`page-${++serial}`},AbortController,
  document:{referrer:'',getElementById:id=>({pageVisitCount:value,storyVisitCounter:holder,storyVisitStatus:status})[id]},
  localStorage:{getItem:k=>{if(brokenStorage)throw Error('denied');return saved.get(k)},setItem:(k,v)=>{if(brokenStorage)throw Error('denied');saved.set(k,v)}},
  setTimeout:fn=>{timers.set(++id,fn);return id},clearTimeout:id=>timers.delete(id),console:{warn(){}},
  fetch:async(url,options)=>{calls.push({url,options});return url.includes('cdn.busuanzi.cc')?historyFetch(url,options):newFetch(url,options)}};
 vm.runInNewContext(source,context);await flush();
 return{value,status,holder,saved,calls,context,timers,expire:async()=>{for(const [id,fn] of [...timers]){timers.delete(id);fn()}await flush()}};
}
test('原统计服务停机时两个浏览器的新增访问仍共享累计，链接参数不拆分计数',async()=>{
 let remote=0;const cached=new Map();
 const newFetch=url=>{if(!cached.has(url))cached.set(url,++remote);return response(cached.get(url))};
 const a=await execute({newFetch}),b=await execute({newFetch,pageUrl:'https://hlforever11.github.io/wenzheng-story/?view=raw#record'});
 assert.equal(a.value.textContent,'3');assert.equal(b.value.textContent,'4');
 assert.notEqual(a.calls[0].url,b.calls[0].url);assert.match(a.calls[0].url,new RegExp(`/hit/${counter}`));
 assert.equal(a.calls[0].options.cache,'no-store');assert.match(b.status.textContent,/历史待恢复/);
});
test('新增访问仅加已确认旧记录2，与文证网站1000基数及缓存独立',async()=>{
 const r=await execute({newFetch:()=>response(13)});
 assert.equal(r.value.textContent,'15');assert.equal(r.saved.get(key),'15');assert.match(r.holder.title,/新增访问已同步/);
 assert.match(r.status.textContent,/历史待恢复/);
});
test('恢复入口保留原页面身份和偏移，两个可能重叠的统计总量不相加',async()=>{
 const r=await execute({newFetch:()=>response(17),historyFetch:()=>new Response('{"busuanzi_page_pv":205,"busuanzi_site_pv":99999}')});
 assert.equal(r.value.textContent,'202');assert.equal(r.saved.get(key),'202');assert.match(r.status.textContent,/历史待核对/);
 const original=r.calls.find(c=>c.url.includes('cdn.busuanzi.cc'));
 assert.equal(JSON.parse(original.options.body).url,page);assert.equal(original.options.method,'POST');
 const newer=await execute({newFetch:()=>response(300),historyFetch:()=>new Response('{"busuanzi_page_pv":205}')});
 assert.equal(newer.value.textContent,'302');
});
test('原服务挂起不阻塞新增计数，其超时不会覆盖新增结果',async()=>{
 const r=await execute({newFetch:()=>response(5),historyFetch:()=>new Promise(()=>{})});
 assert.equal(r.value.textContent,'7');assert.match(r.holder.title,/新增访问已同步/);
 await r.expire();assert.equal(r.value.textContent,'7');assert.match(r.status.textContent,/历史待恢复/);
 assert.equal(r.calls.find(c=>c.url.includes('cdn.busuanzi.cc')).options.signal.aborted,true);
});
test('hit已计数但响应丢失时只用get读取，迟到响应不再覆盖结果',async()=>{
 let late;
 const r=await execute({newFetch:url=>url.includes('/hit/')?new Promise(resolve=>{late=resolve}):response(3)});
 await r.expire();assert.equal(r.value.textContent,'5');assert.match(r.status.textContent,/最近记录/);
 const current=r.calls.filter(c=>c.url.includes('countapi.mileshilliard.com'));
 assert.equal(current.length,2);assert.equal(current.filter(c=>c.url.includes('/hit/')).length,1);assert.match(current[1].url,/\/get\//);
 assert.equal(current[0].options.signal.aborted,true);late(response(1));await flush();assert.equal(r.value.textContent,'5');
});
test('两服务都不可用时保留确认记录，绝不清零或在本地虚增',async()=>{
 const r=await execute({newFetch:()=>{throw Error('offline')},old:250});
 assert.equal(r.value.textContent,'250');assert.match(r.status.textContent,/统计暂不可用/);assert.equal(r.calls.filter(c=>c.url.includes('/hit/')).length,1);
});
test('缺失、非法、错误标识和溢出的新增计数不覆盖历史',async()=>{
 for(const raw of [undefined,null,'',true,-1,1.5,'1oops',Number.MAX_SAFE_INTEGER]){
  const r=await execute({newFetch:()=>response(raw)});assert.equal(r.value.textContent,'2');assert.match(r.status.textContent,/暂不可用/);
 }
 const r=await execute({newFetch:()=>response(9999,'different-site')});assert.equal(r.value.textContent,'2');
});
test('原服务占位零及非法历史不覆盖有效新增访问，也不误称历史已恢复',async()=>{
 for(const raw of [0,null,undefined,'1oops',true,-1,3,4,Number.MAX_SAFE_INTEGER+1]){
  const r=await execute({newFetch:()=>response(5),historyFetch:()=>new Response(JSON.stringify({busuanzi_page_pv:raw}))});
  assert.equal(r.value.textContent,'7');assert.match(r.status.textContent,/历史待恢复/);
 }
});
test('两个服务的响应先后顺序不造成计数回退或双倍累计',async()=>{
 let late;const r=await execute({newFetch:()=>response(500),historyFetch:()=>new Promise(resolve=>{late=resolve})});
 assert.equal(r.value.textContent,'502');late(new Response('{"busuanzi_page_pv":205}'));await flush();assert.equal(r.value.textContent,'502');
 let lateNew;const r2=await execute({newFetch:()=>new Promise(resolve=>{lateNew=resolve}),historyFetch:()=>new Response('{"busuanzi_page_pv":205}')});
 assert.equal(r2.value.textContent,'202');lateNew(response(500));await flush();assert.equal(r2.value.textContent,'502');
});
test('响应头已返回但正文挂起也受超时保护，读取也挂起时会停止等待',async()=>{
 const r=await execute({newFetch:url=>url.includes('/hit/')?{ok:true,json:()=>new Promise(()=>{})}:response(5)});
 await r.expire();assert.equal(r.value.textContent,'7');assert.match(r.status.textContent,/最近记录/);
 const both=await execute({newFetch:()=>new Promise(()=>{})});await both.expire();await both.expire();
 assert.equal(both.value.textContent,'2');assert.equal(both.timers.size,0);assert.equal(both.calls.filter(c=>c.url.includes('/hit/')).length,1);
 const history=await execute({historyFetch:()=>({ok:true,json:()=>new Promise(()=>{})})});await history.expire();assert.equal(history.value.textContent,'3');
});
test('重复脚本只计一次，存储权限错误不妨碍云端计数',async()=>{
 const r=await execute({newFetch:()=>response(7),brokenStorage:true});vm.runInNewContext(source,r.context);await flush();
 assert.equal(r.calls.length,2);assert.equal(r.value.textContent,'9');
 const old=await execute({old:250});assert.equal(old.value.textContent,'250');
 for(const invalid of [0,'NaN',Infinity])assert.equal((await execute({old:invalid})).value.textContent,'3');
});
test('HTML与历史说明明确为已确认下限，未声称完整历史已恢复',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const history=JSON.parse(readFileSync(new URL('../counter-history.json',import.meta.url),'utf8'));
 assert.match(html,/累计访问至少/);assert.match(html,/counter-resume1/);assert.equal(history.fullHistoryRecovered,false);
 assert.equal(history.originalOffset,3);assert.equal(history.lastVerifiedTotal,2);assert.equal(history.newVisits.counterKey,counter);
});
