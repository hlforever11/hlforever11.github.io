import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../counter.js',import.meta.url),'utf8');

const key='wenzheng-web-pv-base1000-20261008';
async function execute(fetch,old,storageFailure=false) {
 const value={textContent:'1,000'},holder={classList:{add(){}},setAttribute(){},title:''};
 const saved=new Map(old===undefined?[]:[[key,String(old)],['wenzheng-site-pv-last','9000']]);
 const calls=[];
 const context={window:{},document:{getElementById:id=>id==='siteCounter'?holder:value},localStorage:{getItem:k=>{if(storageFailure)throw Error('storage denied');return saved.get(k)},setItem:(k,v)=>{if(storageFailure)throw Error('storage denied');saved.set(k,v)}},console:{warn(){}},fetch:async(url,options)=>{calls.push({url,options});return fetch(url,options)}};
 vm.runInNewContext(source,context);await new Promise(resolve=>setImmediate(resolve));return{value,holder,saved,calls,context};
}
test('网站基数1000，只叠加独立网站记录的新增访问',async()=>{
 const r=await execute(async()=>new Response('{"value":"1","busuanzi_site_pv":9000}'));
 assert.equal(r.value.textContent,'1,001');assert.equal(r.saved.get(key),'1001');
 assert.match(r.calls[0].url,/\/hit\/wenzheng_web_pv_/);assert.equal(r.calls[0].options.cache,'no-store');
});
test('不同浏览器共享新增访问计数，不是各自的本机访问量',async()=>{
 let remote=0;const fetch=async()=>new Response(JSON.stringify({value:++remote}));
 assert.equal((await execute(fetch)).value.textContent,'1,001');
 assert.equal((await execute(fetch)).value.textContent,'1,002');
});
test('计数服务故障保留最近成功值，失败不归零或重复计数',async()=>{
 const r=await execute(async()=>{throw Error('timeout')},1045);
 assert.equal(r.value.textContent,'1,045');assert.match(r.holder.title,/统计暂不可用/);assert.equal(r.calls.length,1);
});
test('首次断网仍显示指定基数1000，明确标明预设起始值',async()=>{
 const r=await execute(async()=>new Response('not-json'));
 assert.equal(r.value.textContent,'1,000');assert.match(r.holder.title,/预设起始基数1000/);
});
test('等待慢响应时显示1000，返回后继续累计',async()=>{
 let respond;
 const r=await execute(()=>new Promise(resolve=>{respond=resolve}));
 assert.equal(r.value.textContent,'1,000');
 respond(new Response('{"value":2}'));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(r.value.textContent,'1,002');
});
test('缺失、非法及溢出响应不污染计数，也不叠加旧站数据',async()=>{
 for(const raw of [undefined,null,'',true,-1,1.5,'oops',Number.MAX_SAFE_INTEGER]){
  const r=await execute(async()=>new Response(JSON.stringify({value:raw,busuanzi_site_pv:9000})));
  assert.equal(r.value.textContent,'1,000');assert.match(r.holder.title,/统计暂不可用/);
 }
});
test('重复载入脚本只发出一次访问请求',async()=>{
 const r=await execute(async()=>new Response('{"value":1}'));
 vm.runInNewContext(source,r.context);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(r.calls.length,1);
});
test('旧缓存不降低1000基数，服务较旧响应不降低当前累计值',async()=>{
 assert.equal((await execute(async()=>new Response('{"value":0}'),145)).value.textContent,'1,000');
 assert.equal((await execute(async()=>new Response('{"value":20}'),1050)).value.textContent,'1,050');
});
test('浏览器存储不可用不阻断云端计数显示',async()=>{
 const r=await execute(async()=>new Response('{"value":3}'),undefined,true);assert.equal(r.value.textContent,'1,003');
});
