const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const core=require('../cloudfunctions/verifyReference/lib/core');
const refs=require('./authority-five.json');
const good=['verified','partial','corrected'];
const offline=async()=>{throw Error('offline test')};
const saved=global.fetch;
test.beforeEach(()=>{global.fetch=offline});test.afterEach(()=>{global.fetch=saved});
test('小程序核验核心可确认五条原始题录，机构作者与个人APA缩写不会误改',async()=>{
 for(const ref of refs){const r=await core.verifyReference(ref);assert.ok(good.includes(r.status),r.note);assert.ok(r.sourceUrl);assert.equal(r.differences.some(d=>d.field==='作者'),false);}
 const k=await core.verifyReference(refs[4]),c=await core.verifyReference(refs[2]);assert.match(k.canonical,/2nd ed\./);assert.match(c.canonical,/Version 1\.1/);
});
test('未预存的第三版Routledge图书可由独立目录确认',async()=>{
 global.fetch=async input=>{if(!String(input).startsWith('https://www.googleapis.com/books/'))throw Error('offline');return new Response(JSON.stringify({items:[{id:'synthetic',volumeInfo:{title:'Designing Learning Services',authors:['Alice Smith'],publisher:'Routledge',publishedDate:'2021',infoLink:'https://books.google.com/books?id=synthetic'}}]}))};
 const raw='Smith, A. (2021). *Designing Learning Services* (3rd ed.). Routledge.';
 assert.equal(core._test.queryVerifiedReferenceIndex(core.parseReference(raw)).candidates.length,0);
 const r=await core.verifyReference(raw);assert.ok(good.includes(r.status),r.note);assert.match(r.source,/Google Books/);assert.match(r.canonical,/3rd ed/);
});
test('只有作品级初版年份的目录不用于改写后来版次的出版年',()=>{
 const parsed=core.parseReference('Smith, A. (2021). Designing Learning Services (3rd ed.). Routledge.');
 const c=core._test.openLibraryCandidate({title:'Designing Learning Services',author_name:['Alice Smith'],publisher:['Routledge'],first_publish_year:2014},'',parsed);
 assert.equal(c.year,null);assert.equal(c.edition,'');
});
test('真实PDF解析通道可读首页分行题名、作者和出版年',async()=>{
 const pdf=await core._test.readPublicPdf(fs.readFileSync(__dirname+'/fixtures/synthetic-report.pdf'));
 const p=core.parseReference('Example Research Council. (2021). Building resilient library services. https://example.org/report.pdf');
 const c=core._test.pdfIdentityCandidate(pdf.text,pdf.info,p,p.url);assert.equal(c.title,'Building resilient library services');assert.equal(c.authors[0],'Example Research Council');assert.equal(c.year,2021);
});
test('JSON-LD正文作者与日期、HTML实体解码支持不同机构网站',()=>{
 const c=core._test.structuredWebMetadata('<script type="application/ld+json">{"@type":"Report","name":"Other institutional report","author":{"name":"Example Council"},"datePublished":"2022-03-04"}</script>');assert.equal(c.authors[0],'Example Council');assert.equal(c.publicationDate,'2022-03-04');
 assert.equal(core._test.decodeBibliographicEntities('&#8220;Let&#8217;s work&#8221;'),'“Let’s work”');
});
test('伪造作者、题名和未核对网址不能借用权威缓存',()=>{
 for(const raw of [refs[1].replace('Benjamin','Unknownauthor'),refs[3].replace('critical thinkers','obedient parrots'),refs[0].replace('www.ala.org/educationcareers','example.org/educationcareers')])assert.equal(core._test.queryVerifiedReferenceIndex(core.parseReference(raw)).candidates.length,0);
});

test('文档导入云函数也能读取使用共享缓冲区的小体积PDF',async()=>{
 const buffer=fs.readFileSync(__dirname+'/fixtures/synthetic-report.pdf');
 const text=await require('../cloudfunctions/extractDocument')._test.extractText(buffer,'pdf');
 assert.match(text,/Building resilient/);assert.match(text,/library services/);
});
