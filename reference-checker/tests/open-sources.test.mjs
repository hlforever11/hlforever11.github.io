import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import sources from '../open-sources.js';
import policy from '../citation-policy.js';
import core from '../../reference-checker-miniprogram/cloudfunctions/verifyReference/lib/core.js';
import {browserApi} from './browser-api.mjs';
const dataset={id:'10.98765/test-dataset',attributes:{doi:'10.98765/test-dataset',titles:[{title:'Mandarin language learning corpus'}],creators:[{name:'Chang, Chien-ju'}],publisher:'Example Repository',publicationYear:2020,types:{resourceTypeGeneral:'Dataset'},url:'https://example.org/dataset'}};
const json=value=>new Response(JSON.stringify(value));

test('新增开放来源代码在网站与云函数保持一致',()=>{
 assert.equal(readFileSync(new URL('../open-sources.js',import.meta.url),'utf8'),readFileSync(new URL('../../reference-checker-miniprogram/cloudfunctions/verifyReference/lib/open-sources.js',import.meta.url),'utf8'));
});
test('DataCite数据集DOI经过注册接口核验，不能误入普通网页通道',async()=>{
 const raw='Chang, Chien-ju. Mandarin language learning corpus[DS/OL]. Example Repository, 2020. DOI:10.98765/test-dataset.';
 const fetcher=async u=>{if(new URL(u).hostname!=='api.datacite.org')throw Error('offline');return json({data:new URL(u).pathname==='/dois'?[dataset]:dataset});};
 const saved=global.fetch;global.fetch=fetcher;
 try{for(const verify of [browserApi(fetcher).api.verifyOneLocal,core.verifyReference]){const r=await verify(raw);assert.equal(r.status,'verified',r.detailsNote);assert.equal(r.source,'DataCite');assert.match(r.canonical,/DS\/OL/);}}finally{global.fetch=saved;}
});
test('未带DOI的著者年份输入仍检索DataCite，注册记录也不能放行完全不同的题名',async()=>{
 const fetcher=async u=>{if(new URL(u).hostname!=='api.datacite.org')throw Error('offline');return json({data:[dataset]});};
 const {api}=browserApi(fetcher);
 const good=await api.verifyOneLocal('Chang, C. (2020). Mandarin language learning corpus. Example Repository.');
 assert.ok(['verified','partial'].includes(good.status),good.detailsNote);assert.equal(good.differences.length,0);
 const bad=await api.verifyOneLocal('Chang, C. (2020). Completely unrelated fabricated history of astronomy. Example Repository. DOI:10.98765/test-dataset.');
 assert.ok(['review','unverified'].includes(bad.status));
});
test('Europe PMC按完整题名查询，无PMID也能返回可追溯的医学题录',async()=>{
 let query;const adapter=sources.create({authorKey:x=>x,fetchJson:async input=>{const u=new URL(input);query=u.searchParams.get('query');return{resultList:{result:[{id:'12345678',source:'MED',pmid:'12345678',doi:'10.98765/clinical',title:'Clinical library trial',authorList:{author:[{fullName:'Smith JA',firstName:'Jane Alice',lastName:'Smith'}]},pubYear:'2024',journalInfo:{volume:'2',journal:{title:'Clinical Journal'}},pageInfo:'10-20'}]}};}});
 const r=await adapter.queryEuropePmc({title:'Clinical library trial'});assert.equal(query,'TITLE:"Clinical library trial"');
 assert.equal(r.candidates[0].provenance.original,'PubMed');assert.equal(r.candidates[0].pmid,'12345678');assert.equal(policy.compareName('Smith JA','Jane Alice Smith'),'equivalent');
});
test('PubMed真实API的对象型UID可正确解析，不将对象转成错误PMID',async()=>{
 const calls=[];const adapter=sources.create({authorKey:x=>x,fetchJson:async input=>{const u=new URL(input);calls.push(u);assert.equal(u.searchParams.has('email'),false);
  if(u.hostname==='pubmed.ncbi.nlm.nih.gov')return{success:true,result:{uids:[{pubmed:'40958589'}]}};
  assert.equal(u.searchParams.get('id'),'40958589');return{result:{'40958589':{title:'A clinical study',authors:[{name:'Smith JA'}],pubdate:'2025',fulljournalname:'Clinical Journal',articleids:[{idtype:'doi',value:'10.98765/a'}]}}};
 }});
 const r=await adapter.queryPubMed({raw:'Smith JA. A clinical study. Clinical Journal, 2025.',title:'A clinical study'});assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].pmid,'40958589');assert.equal(calls.length,2);
});
test('倒置全名、全大写姓氏和中间名不误报作者，替换姓名仍报冲突',()=>{
 assert.equal(policy.authorsRelation('Chang, Chien-ju',['Chang, Chien-ju']).kind,'equivalent');
 for(const [a,b] of [['LIU, M.','Min LIU'],['XIONG, Y.','Yifeng XIONG'],['Smith JA','Jane Alice Smith'],['Santander Oliván, M.','Mario Santander Oliván'],['Dias Pereira Calças MA','Maria Amália Dias Pereira Calças']])assert.equal(policy.compareName(a,b),'equivalent',a);
 assert.equal(policy.compareName('Smith JA','Jane Beth Smith'),'conflict');
 const {api}=browserApi();
 for(const raw of ['J. C. R. Licklider. Libraries of the future[M]. MIT Press, 1965.','Khia A. Johnson. A Mandarin corpus[DS/OL]. Repository, 2020.']){
  for(const parse of [api.parseReference,core.parseReference])assert.doesNotMatch(parse(raw).title,/Licklider|Johnson/);
 }
 assert.equal(api.parseReference('Johnston B, Webber S. Information literacy[J]. Higher Education, 2003.').title,'Information literacy');
});
test('双重转义的来源题名按文字比较，两端不误报题名差异',()=>{
 const item={title:['Earth systems &amp;lt;italic&amp;gt;quo vadis&amp;lt;/italic&amp;gt;?&amp;mdash;A review'],author:[{given:'John',family:'Smith'}],DOI:'10.98765/a'};
 for(const api of [browserApi().api,core._test]){assert.equal(api.decodeBibliographicEntities(item.title[0]),'Earth systems quo vadis ?—A review');assert.equal(api.crossrefCandidate(item).title,'Earth systems quo vadis ?—A review');}
});
test('已确认结果只显示简短结论，详细依据和参考著录默认折叠',()=>{
 const {api}=browserApi(),parsed=api.parseReference('张三. 测试方法[J]. 图书馆, 2024.');
 const r=policy.applyResult({status:'verified',confidence:.99,source:'Crossref',submitted:parsed.raw,differences:[],note:'详细来源说明，未见明确冲突；这不代表完整格式审校。',citationEvidence:policy.evidence({title:'测试方法',authors:['张三'],container:'图书馆',year:2024,type:'journal-article'})},parsed);
 assert.equal(r.note,'已在Crossref找到对应文献。');assert.equal(r.displayStyle,'');
 const html=api.card(r,0);assert.doesNotMatch(html,/<details[^>]*open|未见明确字段冲突/);assert.match(html,/核验详情/);assert.match(html,/参考著录/);
});
