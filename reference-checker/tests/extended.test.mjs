import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {browserApi} from './browser-api.mjs';
const require=createRequire(import.meta.url);
const core=require('../../reference-checker-miniprogram/cloudfunctions/verifyReference/lib/core');
const records=JSON.parse(readFileSync(new URL('./six-references.json',import.meta.url)));
const offline=async()=>{throw Error('Offline: external requests disabled')};
const web=browserApi().api;
const citation=(r,i)=>`[${[4,16,20,22,27,29][i]}] ${r.authors.slice(0,3).join(', ')}${r.authors.length>3?', 等':''}. ${r.title}[J]. ${r.container}, ${r.year}, ${r.volume||'43'}(${r.issue}): ${r.pages||'91-99'}.${r.doi?' DOI:'+r.doi+'.':''}`;

test('按用户原样提交的六条题录，两端均确认存在并保留第六条字段复核提示',async()=>{
 global.fetch=offline;
 const raw=`[4] 王曦. 人工智能赋能智慧图书馆发展的作用机制[J]. 图书情报知识, 2024, 41(6): 94-101, 165. DOI:10.13366/j.dik.2024.06.094.
 [16] 郭亚军, 冯思倩, 寇旭颍, 等. 生成式AI背景下的图书馆员: 角色、技能与进路[J]. 图书情报工作, 2024, 68(13): 69-77. DOI:10.13266/j.issn.0252-3116.2024.13.006.
 [20] 时莹, 王铮. 数字化转型中的高校图书馆数字化服务能力影响因素研究[J]. 图书情报工作, 2022, 66(23): 41-50. DOI:10.13266/j.issn.0252-3116.2022.23.005.
 [22] COX A M, MAZUMDAR S. Defining artificial intelligence for librarians[J]. Journal of Librarianship and Information Science, 2024, 56(2): 330-340. DOI:10.1177/09610006221142029.
 [27] 龚芙蓉. ChatGPT类生成式AI对高校图书馆数字素养教育的影响探析[J]. 图书情报知识, 2023, 40(5): 97-106, 156. DOI:10.13366/j.dik.2023.05.097.
 [29] 吴爱红. 高校图书馆馆员生成式人工智能胜任力测度研究[J]. 情报科学, 2025, 43(8): 91-99.`;
 const list=web.refs(raw);assert.equal(list.length,6);
 for(const [i,reference] of list.entries())for(const api of [web,{verifyOneLocal:core.verifyReference}]){
  const r=await api.verifyOneLocal(reference);assert.equal(r.status,i===5?'partial':'verified',r.note);
  if(i===5)assert.match(r.note,/卷号、页码/);
 }
});

for(const [i,r] of records.entries()) {
 const raw=citation(r,i);
 test(`网站与小程序解析同一题录：${r.title}`,()=>{
  const a=web.parseReference(raw),b=core.parseReference(raw);
  for(const field of ['title','authors','year','volume','issue','pages','doi'])assert.equal(a[field],b[field]);
  assert.equal(a.title,r.title);assert.equal(a.pages,r.pages||'91-99');
 });
 test(`两端核验及GB/T建议：${r.title}`,async()=>{
  global.fetch=offline;
  for(const api of [web,{verifyOneLocal:core.verifyReference}]){
   const result=await api.verifyOneLocal(raw);
   assert.equal(result.status,i===5?'partial':'verified',result.note);assert.ok(result.confidence>=.9);
   assert.match(result.canonical,/\[J\]\. .+, \d{4}, \d+\(\d+\):/);
   assert.ok(result.sourceUrl);if(i===0||i===4)assert.match(result.canonical,/, (?:165|156)\./);
   if(i===3)assert.match(result.canonical,/COX A M, MAZUMDAR S/);
  }
 });
}

for(const [name,mutate] of [
 ['全角括号',s=>s.replace('(6)','（6）')],
 ['全角类型标识',s=>s.replace('[J]','［J］')],
 ['不换行空格与零宽字符',s=>s.replace(/ /g,'\u00a0').replace('人工智能','人工\u200b智能')],
 ['PDF长横线',s=>s.replace(/-/g,'–')],
 ['省略DOI',s=>s.replace(/ DOI:.+$/,'')],
 ['卷期页缺失',s=>s.replace(', 41(6): 94-101, 165.','.')] ]){
 test(`格式边界：${name}`,async()=>{
  global.fetch=offline;const raw=mutate(citation(records[0],0));
  for(const api of [web,{verifyOneLocal:core.verifyReference}]){
   const result=await api.verifyOneLocal(raw);assert.ok(['verified','corrected','partial'].includes(result.status),result.note);
   assert.match(result.canonical,/41\(6\):94-101, 165/);
  }
 });
}

test('英文APA保留姓名缩写、正式年份及卷页',()=>{
 const raw='Cox, A. M., & Mazumdar, S. (2024). Defining artificial intelligence for librarians. Journal of Librarianship and Information Science, 56(2), 330–340. https://doi.org/10.1177/09610006221142029';
 for(const parse of [web.parseReference,core.parseReference]){
  const p=parse(raw);assert.equal(p.title,records[3].title);assert.equal(p.year,2024);assert.equal(p.volume,'56');assert.equal(p.issue,'2');assert.equal(p.pages,'330-340');
 }
});
test('带句点的题名不丢失前半部分',()=>{
 for(const parse of [web.parseReference,core.parseReference])assert.equal(parse('王明. 第1章. 信息检索的新问题[J]. 图书馆, 2024, 3(1): 1-8.').title,'第1章. 信息检索的新问题');
});
test('Crossref文本作者不会使查询中断，正式出版年优先于首发年',async()=>{
 const calls=[];
 const {api}=browserApi(async(url)=>{calls.push(new URL(url));return new Response(JSON.stringify({message:{items:[]}}),{status:200})});
 await api.queryCrossref(api.parseReference(citation(records[3],3)));
 assert.ok(calls.some(x=>x.searchParams.has('query.author')));
 assert.equal(api.yearFromCrossref({'published-print':{'date-parts':[[2024]]},'published-online':{'date-parts':[[2022]]},published:{'date-parts':[[2022]]}}),2024);
});
test('题名和来源均不同，真实DOI不能替另一条文献背书',async()=>{
 global.fetch=offline;
 const raw=citation(records[3],3).replace(records[3].title,'Quantum experiments on Mars').replace(records[3].container,'Imaginary Review');
 for(const api of [web,{verifyOneLocal:core.verifyReference}])assert.ok(['unverified','review'].includes((await api.verifyOneLocal(raw)).status));
});
test('真实题名配错误DOI应修正DOI，不误报著录一致',async()=>{
 global.fetch=offline;const raw=citation(records[0],0).replace(records[0].doi,'10.12345/incorrect');
 for(const api of [web,{verifyOneLocal:core.verifyReference}]){
  const r=await api.verifyOneLocal(raw);assert.equal(r.status,'corrected');assert.ok(r.differences.some(x=>x.field==='DOI'));
 }
});
test('多作者中混入一个错误作者不能悄悄放行',async()=>{
 global.fetch=offline;const raw=citation(records[1],1).replace('冯思倩','张三');
 for(const api of [web,{verifyOneLocal:core.verifyReference}]){
  const r=await api.verifyOneLocal(raw);assert.equal(r.status,'corrected');assert.ok(r.differences.some(x=>x.field==='作者'));
 }
});
test('分段页码末段不同必须显示差异',async()=>{
 global.fetch=offline;const raw=citation(records[0],0).replace('165','169');
 for(const api of [web,{verifyOneLocal:core.verifyReference}])assert.ok((await api.verifyOneLocal(raw)).differences.some(x=>x.field==='页码'));
});
test('未知文献在全部来源超时、500或损坏JSON时不报虚假',async()=>{
 const raw='SMITH J. Unknown interdisciplinary experiment[J]. Unindexed Review, 2025, 8(2): 20-25.';
 for(const fetch of [offline,async()=>new Response('',{status:500}),async()=>new Response('not-json',{status:200})]){
  const {api}=browserApi(fetch);const r=await api.verifyOneLocal(raw);assert.ok(['unverified','review'].includes(r.status));
 }
});
test('期刊目录加载失败后可以恢复',async()=>{
 let times=0;const {api}=browserApi(async()=>{if(!times++)throw Error('timeout');return new Response('[]')});
 await assert.rejects(api.loadChineseJournalIndex());assert.equal((await api.loadChineseJournalIndex()).rows.length,0);assert.equal(times,2);
});
test('空输入、纯序号不制造文献，超过20条保留总数',()=>{
 assert.equal(web.refs(' \n\t').length,0);assert.equal(web.refs('[1]\n[2]').length,0);
 const many=Array.from({length:24},(_,i)=>`[${i+1}] 王明. 题目${i}[J]. 刊名,2024.`).join('\n');assert.equal(web.refs(many).length,24);
});
test('PDF worker版本与解析器一致且资源完整',()=>{
 const pdf=readFileSync(new URL('../vendor/pdf.min.mjs',import.meta.url),'utf8');
 const worker=readFileSync(new URL('../vendor/pdf.worker.min.mjs',import.meta.url),'utf8');
 assert.match(pdf,/pdfjsVersion = 6\.1\.200/);assert.match(worker,/pdfjsVersion = 6\.1\.200/);assert.ok(worker.length>1000000);
});
test('网站与小程序使用独立计数',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');assert.match(html,/id="busuanzi_page_pv"/);assert.doesNotMatch(html,/busuanzi_site_pv/);
 const wxml=readFileSync(new URL('../../reference-checker-miniprogram/miniprogram/pages/index/index.wxml',import.meta.url),'utf8');assert.doesNotMatch(wxml,/历史累计用户/);assert.match(wxml,/新版累计访问/);
});
