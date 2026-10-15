import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserApi} from './browser-api.mjs';

const cloud='https://cloud.example.org/api/verify-reference';
const ref='SMITH J. Reliable retrieval under network failures[J]. Testing Journal, 2024, 3(1): 1-8. DOI:10.98765/a.b.';
const item={title:['Reliable retrieval under network failures'],author:[{family:'Smith',given:'John'}],'container-title':['Testing Journal'],'published-print':{'date-parts':[[2024]]},volume:'3',issue:'1',page:'1-8',DOI:'10.98765/a.b',type:'journal-article'};
const uncertain={status:'review',confidence:.7,differences:[],note:'近似记录，仍需复核',sourceUrl:'https://example.org/record'};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function virtualClock(){
 let now=0,id=0;const timers=new Map();
 return{timers,get now(){return now},setTimeout(fn,ms){timers.set(++id,{at:now+ms,fn});return id},clearTimeout(id){timers.delete(id)},async advance(ms){
  const end=now+ms;await flush();
  while(true){const next=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush()}
  now=end;await flush();
 }};
}
function crossref(url){if(String(url).includes('api.crossref.org'))return new Response(JSON.stringify({message:{items:[item]}}));throw Error('source unavailable')}

test('同段普通数字、括号和圆圈序号分别拆分，文档提取也保持两条',()=>{
 const {api}=browserApi();
 for(const [a,b] of [['1.','2.'],['1、','2、'],['(1)','(2)'],['①','②']]){
  const input=`${a} SMITH J. First topic[J]. Review,2024,1:1-8. ${b} JONES M. Second topic[J]. Review,2024,1:9-16.`;
  const list=api.refs(input);assert.equal(list.length,2);assert.match(list[1],/JONES M/);
  assert.equal(api.extractReferences('参考文献\n'+input+'\n致谢').length,2);
 }
 assert.equal(api.refs('1. 王明. 第 2. 部分的研究方法[J]. 图书馆,2024,1(1):1-8.').length,1);
});
test('CNKI格式转为云端输入时保留DOI和原始网址',()=>{
 const {api}=browserApi();
 const raw='研究方法[J]. 王明. 图书馆,2024,3(1):1-8. DOI:10.98765/a.b. https://example.org/article?id=1&part=2';
 const parsed=api.parseReference(raw);assert.equal(parsed.cnkiTitleFirst,true);
 const roundtrip=api.parseReference(api.conventionalReference(parsed));
 for(const field of ['title','authors','doi','url','year','volume','issue','pages'])assert.equal(roundtrip[field],parsed[field],field);
});
test('云端不响应时备用来源能在单条总时限内完成',async()=>{
 const clock=virtualClock();let calls=0;
 const r=browserApi(async url=>{if(String(url)===cloud){calls++;return new Promise(()=>{})}return crossref(url)},{...clock,window:{WENZHENG_API_URL:cloud}});
 let result;r.api.verifyOne(ref).then(value=>{result=value});await clock.advance(11000);
 assert.ok(result,'备用来源应在云端超时后返回');assert.ok(['verified','partial','corrected'].includes(result.status),result.note);assert.equal(calls,1);assert.equal(clock.timers.size,0);
});
test('未证实结果直接交给独立来源，不重复请求同一云端',async()=>{
 let calls=0;
 const r=browserApi(async url=>{if(String(url)===cloud){calls++;return new Response(JSON.stringify(uncertain))}return crossref(url)},{window:{WENZHENG_API_URL:cloud}});
 const result=await r.api.verifyOne(ref);assert.ok(['verified','partial','corrected'].includes(result.status));assert.equal(calls,1);
});
test('云端连接失败后短期跳过故障接口，新的文献仍查询备用来源',async()=>{
 let calls=0;
 const r=browserApi(async url=>{if(String(url)===cloud){calls++;throw new TypeError('Failed to fetch')}return crossref(url)},{window:{WENZHENG_API_URL:cloud}});
 await r.api.verifyOne(ref);await r.api.verifyOne(ref.replace('2024','2023'));assert.equal(calls,1);
});
test('备用来源超时后保留云端已取得的复核证据',async()=>{
 const clock=virtualClock();
 const r=browserApi(async url=>{
  if(String(url)===cloud)return new Response(JSON.stringify(uncertain));
  return new Promise(()=>{});
 },{...clock,window:{WENZHENG_API_URL:cloud}});
 // UNESDOC first queries its catalogue, then can try the original page.
 const raw='UNESCO. An unseen catalogue document[EB/OL]. (2024-01-01). https://unesdoc.unesco.org/ark:/48223/pf0000000000';
 let result;r.api.verifyOne(raw).then(value=>{result=value});await clock.advance(18000);
 assert.equal(result?.status,'review');assert.equal(result.sourceUrl,uncertain.sourceUrl);assert.equal(clock.timers.size,0);
});
test('旧云端缓存混淆DOI时不接受未报告差异的成功响应',async()=>{
 const good={status:'verified',confidence:.99,differences:[],canonical:ref.replace('a.b','ab'),sourceUrl:'https://doi.org/10.98765/ab'};
 const r=browserApi(async()=>new Response(JSON.stringify(good)),{window:{WENZHENG_API_URL:cloud}});
 await assert.rejects(r.api.callCloudVerification(ref),/DOI/);
 const corrected=browserApi(async()=>new Response(JSON.stringify({...good,status:'corrected',differences:[{field:'DOI',submitted:'10.98765/a.b',verified:'10.98765/ab'}]})),{window:{WENZHENG_API_URL:cloud}});
 assert.equal((await corrected.api.callCloudVerification(ref)).status,'corrected');
});
test('浏览器恢复输入但没有input事件时，pageshow恢复核验按钮',()=>{
 const handlers={};const r=browserApi(undefined,{window:{addEventListener:(event,handler)=>handlers[event]=handler}});
 r.nodes.get('#input').value=ref;assert.equal(r.nodes.get('#verifyBtn').disabled,true);
 handlers.pageshow();assert.equal(r.nodes.get('#verifyBtn').disabled,false);assert.equal(r.nodes.get('#clearBtn').disabled,false);
});
