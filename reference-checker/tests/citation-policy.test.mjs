import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import policy from '../citation-policy.js';
import core from '../../reference-checker-miniprogram/cloudfunctions/verifyReference/lib/core.js';
import {browserApi} from './browser-api.mjs';

test('网站和云端执行同一份容错与2025国标规则',()=>{
 assert.equal(readFileSync(new URL('../citation-policy.js',import.meta.url),'utf8'),readFileSync(new URL('../../reference-checker-miniprogram/cloudfunctions/verifyReference/lib/citation-policy.js',import.meta.url),'utf8'));
});
test('姓名缩写、倒置姓名、撇号、复姓和前缀等价，首字母冲突不等价',()=>{
 for(const [a,b] of [["D'Ignazio, C.","Catherine D'Ignazio"],['Klein, L. F.','Lauren Frederica Klein'],['Einstein A','Albert Einstein'],['De Morgan, A.','Augustus De Morgan'],['Godard, J.-L.','Jean-Luc Godard']]) assert.equal(policy.compareName(a,b),'equivalent',a);
 assert.equal(policy.compareName('Smith, J.','Alice Smith'),'conflict');
 assert.equal(policy.compareName('Kezar, A. J.','Adrianna Kezar'),'ambiguous');
});
test('姓名缩写包含逗号不拆分，全大写首字母作者串不错误合并',()=>{
 assert.deepEqual(policy.splitAuthors("D'Ignazio, C., & Klein, L. F"),["D'Ignazio, C",'Klein, L. F']);
 assert.equal(policy.splitAuthors('L S T, G V L').length,2);
});
test('机构全称缩写与上下级关系分别处理，不能只因共用机构词判同一作者',()=>{
 assert.equal(policy.compareName('IFLA','International Federation of Library Associations and Institutions'),'equivalent');
 assert.equal(policy.compareName('IFLA','IFLA FAIFE (Committee on Freedom of Access to Information and Freedom of Expression)'),'related');
 assert.equal(policy.compareName('American Library Association','Another Library Association'),'conflict');
});
test('可接受的作者截断不判错，作者顺序和替换作者仍可识别',()=>{
 assert.equal(policy.authorsRelation('Smith, J., et al.',['John Smith','Alice Brown','Bruce Jones']).kind,'equivalent');
 assert.equal(policy.authorsRelation('Brown, A., & Smith, J.',['John Smith','Alice Brown']).kind,'order');
 assert.equal(policy.authorsRelation('Smith, J., & Brown, Z.',['John Smith','Alice Brown']).kind,'conflict');
});
test('截图的Data feminism经未预存的OpenAlex目录确认，两端均不将缩写作者判错',async()=>{
 const raw="D'Ignazio, C., & Klein, L. F. (2020). Data feminism. MIT Press.";
 const fetcher=async input=>{if(!String(input).startsWith('https://api.openalex.org/'))throw Error('offline');return new Response(JSON.stringify({results:[{id:'https://openalex.org/Wtest',title:'Data Feminism',publication_year:2020,type:'book',authorships:[{author:{display_name:"Catherine D'Ignazio"}},{author:{display_name:'Lauren Frederica Klein'}}],primary_location:{source:{display_name:'The MIT Press eBooks'}}}]}));};
 const saved=global.fetch;global.fetch=fetcher;
 try {for(const verify of [browserApi(fetcher).api.verifyOneLocal,core.verifyReference]){
  const r=await verify(raw);assert.ok(['verified','partial'].includes(r.status),r.note);assert.equal(r.differences.some(d=>d.field==='作者'),false);assert.match(r.citationStyle.label,/推测/);assert.equal(r.canonicalStandard,'GB/T 7714—2025');
 }} finally {global.fetch=saved;}
});
test('IFLA原文支持2020年而非路径中的2019年，真实年份问题仍提示',async()=>{
 const raw='International Federation of Library Associations and Institutions. (2019). IFLA statement on libraries and artificial intelligence. https://repository.ifla.org/handle/20.500.14598/1646';
 const saved=global.fetch;global.fetch=async()=>{throw Error('offline')};
 try {for(const verify of [browserApi().api.verifyOneLocal,core.verifyReference]){
  const r=await verify(raw);assert.equal(r.status,'corrected');assert.ok(r.differences.some(d=>d.field==='年份'&&Number(d.verified)===2020));assert.equal(r.differences.some(d=>d.field==='作者'),false);
 }}finally{global.fetch=saved;}
});
test('中文期刊依据2025第8.5条生成，补充字段与真实性分别表达',()=>{
 const parsed={raw:'张三.学习服务研究.图书馆,2024.',title:'学习服务研究',authors:'张三',year:2024,container:'图书馆'};
 const record={title:parsed.title,authors:['张三','李四','王五','赵六'],type:'journal-article',year:2024,container:'图书馆',volume:'43',issue:'5',pages:'10-20',source:'期刊官网'};
 const r=policy.applyResult({status:'verified',confidence:.97,source:'期刊官网',differences:[],citationEvidence:policy.evidence(record)},parsed);
 assert.equal(r.canonical,'张三, 李四, 王五, 等. 学习服务研究[J]. 图书馆, 2024, 43(5):10-20.');
 assert.equal(r.canonicalLabel,'国标著录草稿');assert.match(r.formatChecks.join(''),/文献类型标识/);assert.equal(r.status,'verified');
});
test('2025作者姓氏大小写、书籍出版地和版次按条文处理，不虚构城市',()=>{
 const r=policy.formatGb2025({title:'Example book',authors:['Albert Einstein'],container:'Example Press',type:'book',year:2020},{edition:'2nd ed.',container:'Example Press'});
 assert.match(r.text,/^Einstein A\./);assert.match(r.text,/\[M\]\. 2nd ed\./);assert.doesNotMatch(r.text,/出版地不详|S\.l\.|引用日期/);assert.match(r.warnings.join(''),/出版地/);
 const chinese=policy.formatGb2025({title:'学习方法',authors:['张三'],type:'book',container:'教育出版社',year:2024},{container:'北京:教育出版社',pages:'12-15'});
 assert.match(chinese.text,/北京:教育出版社, 2024:12-15/);
});
test('2025报告格式不套图书出版社模板，也不强加引用日期',()=>{
 const r=policy.formatGb2025({title:'服务报告',authors:['研究委员会'],container:'研究委员会',type:'report',online:true,publicationDate:'2023-05-01',sourceUrl:'https://example.org/report.pdf'},{raw:''});
 assert.equal(r.text,'研究委员会. 服务报告[R/OL]. 2023-05-01. https://example.org/report.pdf.');assert.equal(r.warnings.length,0);
});
test('网页和预印本须有实际引用日期，新预印本标识为PP而不是R',()=>{
 const page=policy.formatGb2025({title:'网站新闻',type:'webpage',publicationDate:'2024-01-01',sourceUrl:'https://example.org/'},{});
 assert.match(page.warnings.join(''),/引用日期必备/);assert.doesNotMatch(page.text,/2026-10-22/);
 const preprint=policy.formatGb2025({title:'A study',authors:['John Smith'],type:'preprint',container:'arXiv',publicationDate:'2024-01-01',sourceUrl:'https://arxiv.org/abs/2401.00001'},{accessDate:'2026-10-22'});
 assert.match(preprint.text,/\[PP\/OL\]/);assert.match(preprint.text,/\(2024-01-01\)\[2026-10-22\]/);
});
test('2025第8.5.1.1允许引文页码不同于文章起讫页，越界仍提示核对',()=>{
 for(const pages of ['12','12-14','12, 18-19'])assert.ok(policy.pagesCompatible(pages,'10-20'));
 assert.equal(policy.pagesCompatible('12-30','10-20'),false);
 const base={status:'corrected',confidence:.98,source:'期刊官网',citationEvidence:{authority:true},differences:[{field:'页码',submitted:'12-14',verified:'10-20'}]};
 assert.equal(policy.applyResult(base,{raw:''}).differences.length,0);
 assert.equal(policy.applyResult({...base,differences:[{field:'页码',submitted:'30',verified:'10-20'}]},{raw:''}).differences.length,1);
});
test('同一记录的在线和印刷年份分别认可，普通目录冲突只列待核对信息',()=>{
 const make=e=>policy.applyResult({status:'corrected',confidence:.98,source:'目录',citationEvidence:e,differences:[{field:'年份',submitted:2023,verified:2024}]},{raw:''});
 assert.equal(make({authority:true,acceptedYears:[2023,2024]}).status,'verified');
 assert.equal(make({authority:false}).status,'partial');assert.equal(make({authority:false}).differences.length,0);
 assert.equal(make({authority:true}).status,'corrected');
});
test('出版者常见变体、刊名规范缩写不作为直接纠错，不能匹配不同期刊',()=>{
 assert.ok(policy.equivalentSource('MIT Press','The MIT Press eBooks'));
 assert.ok(policy.equivalentSource('J Libr Inf Sci','Journal of Librarianship and Information Science'));
 assert.equal(policy.equivalentSource('Journal of Data Science','Journal of Library Science'),false);
});
test('英语原著录仅提示推测格式，可选转换默认收起，旧响应不冒充2025输出',()=>{
 const {api}=browserApi();const r=policy.applyResult({status:'verified',confidence:.99,source:'官网',differences:[],citationEvidence:policy.evidence({title:'Example',authors:['John Smith'],year:2024,type:'book',container:'Press'})},{raw:'Smith, J. (2024). Example. Press.',title:'Example'});
 const html=api.card(r,0);assert.match(html,/可选国标格式转换/);assert.doesNotMatch(html,/<details class="canonical" open/);assert.doesNotMatch(html,/著录需修正/);
 assert.equal(policy.applyResult({status:'verified',confidence:.98,differences:[],canonical:'old 2015 output'},{raw:'Example'}).canonical,'');
});
test('失败只表达本次服务未完成，无法识别的格式不会武断标为APA7',()=>{
 const r=policy.applyResult({status:'error',note:'核验失败：网络错误',confidence:0,differences:[]},{raw:'Some reference'});
 assert.match(r.note,/不代表文献虚假/);assert.equal(r.citationStyle.certainty,'unknown');
});
