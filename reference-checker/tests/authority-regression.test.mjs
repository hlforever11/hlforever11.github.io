import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {browserApi} from './browser-api.mjs';
const refs=JSON.parse(readFileSync(new URL('../../reference-checker-miniprogram/tests/authority-five.json',import.meta.url)));
const confirmed=['verified','partial','corrected'];
test('五条原样APA机构文件、图书和网页在外部请求全失败时仍有可追溯原始证据',async()=>{
 const {api}=browserApi();for(const raw of refs){const result=await api.verifyOne(raw);assert.ok(confirmed.includes(result.status),raw+' '+result.note);assert.ok(result.sourceUrl);assert.ok(result.confidence>=.8);assert.equal(result.differences.some(d=>d.field==='作者'),false);}
 const c=await api.verifyOne(refs[2]),k=await api.verifyOne(refs[4]),news=await api.verifyOne(refs[3]);
 assert.match(c.canonical,/V1\.1/);assert.match(k.canonical,/2nd ed\./);assert.doesNotMatch(k.canonical,/ed\.\./);
 assert.match(news.canonical,/\[EB\/OL\]/);assert.match(news.canonical,/2023-04-07/);
});
test('APA版次/版本与Markdown排版不混入题名，出版社触发图书通道',()=>{
 const {api}=browserApi();assert.equal(api.parseReference(refs[4]).edition,'2nd ed.');assert.equal(api.parseReference(refs[2]).version,'1.1');
 for(const raw of refs){assert.doesNotMatch(api.parseReference(raw).title,/\*|Version|2nd ed/);}
 const novel=api.parseReference('Smith, A. (2021). *Designing Learning Services* (3rd ed.). Routledge.');
 assert.equal(novel.type,'M');assert.ok(api.buildVerificationPlan(novel).includes('google-books'));assert.equal(novel.title,'Designing Learning Services');
});
test('英文姓氏逗号与缩写不拆成两个人，含and的机构全称仍为一个作者',()=>{
 const {api}=browserApi();assert.equal(api.splitSubmittedAuthors('Kezar, A. J.').length,1);
 assert.equal(api.splitSubmittedAuthors('Smith, J., & Jones, A.').length,2);
 assert.equal(api.splitSubmittedAuthors('International Federation of Library Associations and Institutions').length,1);
 assert.notEqual(api.authorKey('American Library Association'),api.authorKey('Another Library Association'));
});
test('非索引中的英文图书可经新增独立目录确认，目录失效不阻断其他来源',async()=>{
 let calls=[];const raw='Smith, A. (2021). *Designing Learning Services* (3rd ed.). Routledge.';
 const {api}=browserApi(async url=>{calls.push(String(url));if(!String(url).startsWith('https://www.googleapis.com/books/'))throw Error('offline');
 return new Response(JSON.stringify({items:[{id:'synthetic-test',volumeInfo:{title:'Designing Learning Services',authors:['Alice Smith'],publishedDate:'2021',publisher:'Routledge',infoLink:'https://books.google.com/books?id=synthetic-test'}}]}));});
 assert.equal(api.TRUSTED_REFERENCE_CACHE.some(r=>r.title==='Designing Learning Services'),false);
 const r=await api.verifyOneLocal(raw);assert.ok(confirmed.includes(r.status),r.note);assert.match(r.source,/Google Books/);assert.match(r.canonical,/3rd ed/);assert.ok(calls.some(url=>url.includes('inauthor')));
});
test('作品级目录不把第一版出版年强行改写第二版年份',()=>{
 const {api}=browserApi(),p=api.parseReference('Smith, A. (2021). Designing Learning Services (3rd ed.). Routledge.');
 const candidate=api.openLibraryCandidate({title:'Designing Learning Services',author_name:['Alice Smith'],publisher:['Routledge'],first_publish_year:2014},'',p);
 assert.equal(candidate.year,null);assert.equal(candidate.edition,'');
});
test('JSON-LD作者、标题、出版日期在无标准meta标签网页也可读取',()=>{
 const {api}=browserApi();const meta=api.structuredWebMetadata('<script type="application/ld+json">'+JSON.stringify({'@graph':[{'@type':'WebPage',name:'Site'},{'@type':'NewsArticle',headline:'Synthetic report release',author:{'@type':'Organization',name:'Example Research Council'},datePublished:'2021-06-02',publisher:{name:'Example Council'}}]})+'</script>');
 assert.equal(meta.title,'Synthetic report release');assert.equal(meta.authors[0],'Example Research Council');assert.equal(meta.publicationDate,'2021-06-02');
});
test('PDF元数据与首页分行标题通用读取，不能只因链接可达就确认不同题名',()=>{
 const {api}=browserApi(),p=api.parseReference('Example Research Council. (2021). Building resilient\nlibrary services. https://example.org/report.pdf');
 const c=api.pdfIdentityCandidate('Building resilient\nlibrary services\nPublished 2021\nExample Research Council',{},p,p.url);
 assert.ok(api.scoreCandidate(p,c).titleScore>.95);
 const wrong=api.pdfIdentityCandidate('Completely unrelated document\nAnnual budgets\nReferences',{},p,p.url);assert.ok(api.scoreCandidate(p,wrong).titleScore<.72);
});
test('仅核对过的网址别名可复用记录，伪造题名、作者或任意网址均不能白名单放行',async()=>{
 const {api}=browserApi();
 for(const raw of [refs[1].replace('Benjamin','Unknownauthor'),refs[3].replace('critical thinkers','obedient parrots'),refs[0].replace('https://www.ala.org/educationcareers/sites/ala.org.educationcareers/files/content/careers/corecomp/corecompetences/finalcorecompstat09.pdf','https://example.org/forged.pdf')]){
  const r=await api.verifyOneLocal(raw);assert.notEqual(r.trustedSource,true);assert.ok(!['verified','partial','corrected'].includes(r.status));
 }
});
