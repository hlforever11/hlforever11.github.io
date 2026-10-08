import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../counter.js',import.meta.url),'utf8');

async function execute(fetch,old) {
 const value={textContent:'—'},holder={classList:{add(){}},title:''},saved=new Map(old?[['wenzheng-page-pv-last',String(old)]]:[]);
 let payload;
 const context={document:{referrer:'',getElementById:id=>id==='siteCounter'?holder:value},localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},AbortController,setTimeout:()=>0,clearTimeout(){},fetch:async(url,options)=>{payload=JSON.parse(options.body);return fetch(url,options)}};
 vm.runInNewContext(source,context);await new Promise(resolve=>setImmediate(resolve));return{value,holder,saved,payload};
}
test('更新版本参数不改变网站统计URL，沿用单页历史值',async()=>{
 const r=await execute(async()=>new Response('{"busuanzi_page_pv":138,"busuanzi_site_pv":9000}'));
 assert.equal(r.payload.url,'https://hlforever11.github.io/reference-checker/');assert.equal(r.value.textContent,'138');assert.equal(r.saved.get('wenzheng-page-pv-last'),'138');
});
test('计数服务故障保留上次值，失败不归零',async()=>{
 const r=await execute(async()=>{throw Error('timeout')},145);assert.equal(r.value.textContent,'145');assert.match(r.holder.title,/上次成功读取/);
});
test('无历史缓存的计数服务故障明确显示不可用',async()=>{
 const r=await execute(async()=>new Response('not-json'));assert.equal(r.value.textContent,'暂不可用');assert.match(r.holder.title,/不会重置/);
});
