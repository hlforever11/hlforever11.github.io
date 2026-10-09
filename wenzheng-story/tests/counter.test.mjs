import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../counter.js',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const page='https://hlforever11.github.io/wenzheng-story/?v=2026080701#lessons';
async function execute(fetch,old,brokenStorage=false){
 const value={textContent:'2'},status={textContent:''},holder={setAttribute(){},title:''};
 const calls=[],timers=new Map(),saved=new Map(old===undefined?[]:[['wenzheng-story-pv-confirmed-v1',String(old)]]);let id=0;
 const context={window:{},location:{href:page},crypto:{randomUUID:()=>String(Math.random())},AbortController,
  document:{referrer:'',getElementById:id=>({pageVisitCount:value,storyVisitCounter:holder,storyVisitStatus:status})[id]},
  localStorage:{getItem:k=>{if(brokenStorage)throw Error('denied');return saved.get(k)},setItem:(k,v)=>{if(brokenStorage)throw Error('denied');saved.set(k,v)}},
  setTimeout:fn=>{timers.set(++id,fn);return id},clearTimeout:id=>timers.delete(id),console:{warn(){}},
  fetch:async(url,options)=>{calls.push({url,options});return fetch(url,options)}};
 vm.runInNewContext(source,context);await flush();
 return{value,status,holder,saved,calls,context,timers,expire:async()=>{for(const [id,fn] of [...timers]){timers.delete(id);fn()}await flush()}};
}
test('恢复原服务历史量，只减原偏移3，不叠加1000或其他站点数据',async()=>{
 const r=await execute(async()=>new Response('{"busuanzi_page_pv":205,"busuanzi_site_pv":99999}'));
 assert.equal(r.value.textContent,'202');assert.equal(r.status.textContent,'');assert.equal(r.saved.get('wenzheng-story-pv-confirmed-v1'),'202');
 assert.equal(JSON.parse(r.calls[0].options.body).url,page);assert.match(r.calls[0].url,/^https:\/\/cdn\.busuanzi\.cc\/api\.php\?request=/);
});
test('统计服务失败保留已核实记录，明确标注尚未恢复完整历史',async()=>{
 const r=await execute(async()=>new Response('bad gateway',{status:502}));
 assert.equal(r.value.textContent,'2');assert.match(r.status.textContent,/历史记录待同步/);assert.equal(r.calls.length,1);
 const newer=await execute(async()=>{throw Error('offline')},250);assert.equal(newer.value.textContent,'250');
});
test('占位零、错误数据、低于已确认历史的结果不清空历史',async()=>{
 for(const raw of [0,null,undefined,'1oops',true,-1,3,4,Number.MAX_SAFE_INTEGER+1]){
  const r=await execute(async()=>new Response(JSON.stringify({busuanzi_page_pv:raw})));
  assert.equal(r.value.textContent,'2');assert.match(r.status.textContent,/待同步/);
 }
});
test('慢请求及正文挂起超时，迟到响应不覆盖历史且不重复上报',async()=>{
 let late;
 const r=await execute(()=>new Promise(resolve=>{late=resolve}));await r.expire();
 assert.equal(r.value.textContent,'2');assert.equal(r.calls.length,1);assert.equal(r.calls[0].options.signal.aborted,true);assert.match(r.status.textContent,/待同步/);
 late(new Response('{"busuanzi_page_pv":999}'));await flush();assert.equal(r.value.textContent,'2');
 const body=await execute(()=>({ok:true,json:()=>new Promise(()=>{})}));await body.expire();assert.match(body.status.textContent,/待同步/);
});
test('重复脚本只上报一次，存储权限错误不阻止真实计数显示',async()=>{
 const r=await execute(async()=>new Response('{"busuanzi_page_pv":103}'),undefined,true);
 vm.runInNewContext(source,r.context);await flush();assert.equal(r.calls.length,1);assert.equal(r.value.textContent,'100');
});
