const test=require('node:test');
const assert=require('node:assert/strict');
const {parseReference,verifyReference,_test}=require('../cloudfunctions/verifyReference/lib/core');
const originalFetch=global.fetch;
test.afterEach(()=>{global.fetch=originalFetch});
const raw='陈晨, 李明. 人智协同中的信息核验任务实验[J]. 图书情报知识, 2025, 42(1): 20-29, 88. DOI:10.13366/j.dik.2025.01.020.';
const html=`<html><head><meta name="citation_title" content="人智协同中的信息核验任务实验"><meta name="citation_author" content="陈晨"><meta name="citation_author" content="李明"><meta name="citation_journal_title" content="图书情报知识"><meta name="citation_publication_date" content="2025-01-10"><meta name="citation_volume" content="42"><meta name="citation_issue" content="1"><meta name="citation_firstpage" content="20"><meta name="citation_lastpage" content="29"><meta name="citation_doi" content="10.13366/j.dik.2025.01.020"></head><body><p>陈晨, 李明. 人智协同中的信息核验任务实验[J]. 图书情报知识, 2025, 42(1):20-29,88.</p><p>参考文献：王明. 不同文献[J]. 其他刊物,2020,1(2):1-8.</p></body></html>`;
test('未预存的新文献能由期刊官网通用规则核验并保留分段页码',async()=>{
 const urls=[];global.fetch=async(input)=>{const url=String(input);urls.push(url);if(url.startsWith('https://dik.whu.edu.cn/'))return new Response(html);throw Error('other provider offline')};
 const r=await verifyReference(raw);assert.equal(r.status,'verified',r.note);assert.match(r.source,/期刊官网题录/);assert.match(r.canonical,/20-29, 88/);
 assert.ok(urls.some(u=>u==='https://dik.whu.edu.cn/jwk3/tsqbzs/CN/10.13366/j.dik.2025.01.020'));
});
test('官网页只有参考文献命中，不能为不同主文章背书',()=>{
 const other=html.replace(/citation_title" content="人智协同中的信息核验任务实验/,'citation_title" content="完全不同的量子物理研究');
 assert.equal(_test.officialJournalCandidate(other,'https://dik.whu.edu.cn/',parseReference(raw)),null);
});
test('无DOI的卷期页可定位官网，但仍须验证网页身份',()=>{
 const p=parseReference(raw.replace(/ DOI:.+$/,''));assert.deepEqual(_test.officialJournalUrls(p),['https://dik.whu.edu.cn/jwk3/tsqbzs/CN/Y2025/V42/I1/20']);
});
