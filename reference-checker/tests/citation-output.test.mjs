import {test} from 'node:test';
import assert from 'node:assert/strict';
import policy from '../citation-policy.js';
import core from '../../reference-checker-miniprogram/cloudfunctions/verifyReference/lib/core.js';
import {browserApi} from './browser-api.mjs';
const web=browserApi().api;
const original='[1] 李书宁,刘一鸣.ChatGPT类智能对话工具兴起对图书馆行业的机遇与挑战[J].图书馆论坛,2023,43(05):104-110.';
const proposal='[3] Guidance for generative AI in education and research[R/OL]. 2023.';

test('截图中的原著录可保留，不重复展示仅有空格标点变化的版本',async()=>{
 for(const verify of [web.verifyOneLocal,core.verifyReference]){
  const r=await verify(original);assert.equal(r.status,'verified');assert.equal(r.canonicalComplete,true);assert.equal(r.canonicalUnchanged,true);assert.equal(r.showCanonical,false);
  const html=web.card(r,0);assert.doesNotMatch(html,/<details class="canonical"/);assert.match(html,/原著录可保留/);
 }
});
test('年份错误的中文文献给出已核对著录，默认展开且可复制',async()=>{
 for(const verify of [web.verifyOneLocal,core.verifyReference]){
  const r=await verify(original.replace('2023','2022'));assert.equal(r.status,'corrected');assert.equal(r.canonicalComplete,true);assert.equal(r.canonicalLabel,'核对后的著录');assert.equal(r.canonicalOpen,true);
  assert.match(r.canonical,/2023/);assert.doesNotMatch(r.canonical,/2022/);assert.ok(r.canonicalChanges.includes('年份'));
  const html=web.card(r,0);assert.match(html,/<details class="canonical" open>/);assert.match(html,/data-copy-citation=/);assert.match(html,/复制著录/);
 }
});
test('UNESCO待确认结果展示来源题录，不冒充已经确认同一文献',async()=>{
 for(const verify of [web.verifyOneLocal,core.verifyReference]){
  const r=await verify(proposal);assert.equal(r.status,'review');assert.equal(r.canonicalLabel,'匹配记录的著录');assert.equal(r.showCanonical,true);assert.equal(r.canonicalOpen,true);
  assert.match(r.canonical,/Miao F, Holmes W/);assert.match(r.canonical,/2023-09-07/);assert.match(r.canonical,/10\.54675\/ewzm9535/);assert.equal(r.canonicalComplete,true);
  assert.match(r.canonicalNote,/先确认/);assert.equal(r.canonicalCopyLabel,'复制匹配记录');
  assert.match(web.card(r,2),/\[3\] Miao F, Holmes W/);
 }
});
test('缺少卷页的来源记录不能把提交的卷页包装成已核实',()=>{
 const parsed=web.parseReference('张三. 测试文献[J]. 图书馆, 2024, 99(9):888-999.');
 const record={title:'测试文献',authors:['张三'],year:2024,container:'图书馆',type:'journal-article',source:'期刊官网'};
 const r=policy.applyResult({status:'partial',submitted:parsed.raw,source:'期刊官网',differences:[],citationEvidence:policy.evidence(record)},parsed);
 assert.doesNotMatch(r.canonical,/99\(9\)|888-999/);assert.equal(r.canonicalComplete,false);assert.equal(r.canonicalCopyLabel,'复制草稿');assert.match(r.canonicalWarnings.join(''),/卷号尚未核实/);
});
test('网页引用日期、版次和出版地缺证据时不能伪造已核对的完整著录',()=>{
 const p=web.parseReference('Smith, J. (2024). Example book (3rd ed.). London: Example Press.');
 const r=policy.applyResult({status:'verified',source:'出版者官网',differences:[],citationEvidence:policy.evidence({title:'Example book',authors:['John Smith'],year:2024,container:'Example Press',type:'book',source:'出版者官网'})},p);
 assert.doesNotMatch(r.canonical,/London|3rd ed/);assert.equal(r.canonicalComplete,false);assert.match(r.canonicalWarnings.join(''),/出版地|版次尚未核实/);
});
test('完整英文APA写法保留，国标转换仍是可选操作',()=>{
 const parsed=web.parseReference('Smith, J. (2024). Example book. Example Press.');
 const r=policy.applyResult({status:'verified',source:'出版者官网',differences:[],citationEvidence:policy.evidence({title:'Example book',authors:['John Smith'],year:2024,container:'Example Press',publicationPlace:'Cambridge',type:'book',source:'出版者官网'})},parsed);
 assert.equal(r.canonicalLabel,'可选国标格式');assert.equal(r.canonicalOpen,false);assert.equal(r.canonicalComplete,true);assert.equal(r.canonicalCopyLabel,'复制著录');assert.match(r.canonical,/Cambridge:Example Press/);
});
test('文内引文页码在已核对的文章页码范围内时予以保留',()=>{
 const record={title:'测试',authors:['张三'],year:2024,container:'图书馆',volume:'2',issue:'1',pages:'10-20',type:'journal-article'};
 assert.match(policy.sourceCitation(record,{pages:'12-14'}).text,/:12-14/);
 assert.match(policy.sourceCitation(record,{pages:'88-99'}).text,/:10-20/);
});
test('去重不能混淆DOI标点差异，正常期号前导零可等价',()=>{
 assert.ok(policy.sameCitation('张三.测试[J].图书馆,2024,2(05):1-8.','张三. 测试[J]. 图书馆, 2024, 2(5):1-8.'));
 assert.equal(policy.sameCitation('测试 DOI:10.98765/a.b.','测试 DOI:10.98765/ab.'),false);
});
test('复制按钮写入带原序号的完整著录',async()=>{
 let copied='';const {api}=browserApi(undefined,{navigator:{clipboard:{writeText:async value=>{copied=value}}}});
 const button={dataset:{copyCitation:'[29] 张三. 测试[J]. 图书馆, 2024.'},textContent:'复制著录'};
 assert.equal(await api.copyCanonical(button),true);assert.equal(copied,button.dataset.copyCitation);assert.equal(button.textContent,'已复制');
});
test('未匹配和服务异常不凭旧canonical字符串生成可采用著录',()=>{
 for(const status of ['review','unverified','error']){
  const r=policy.applyResult({status,source:'未知来源',canonical:'杜撰作者.杜撰书目.',differences:[]},{raw:'未知文献'});
  assert.equal(r.canonical,'');assert.equal(r.showCanonical,false);
 }
});

test('旧响应补入的其余作者和末页不得再次冒充来源已核实字段',()=>{
 const parsed=web.parseReference('张三, 李四. 测试[J]. 图书馆, 2024, 2(1):10-20.');
 const r=policy.applyResult({status:'partial',source:'DOI 注册元数据',differences:[],citationEvidence:{authority:true,partialFields:['其余作者','末页'],record:{title:'测试',authors:['张三','李四'],year:2024,container:'图书馆',volume:'2',issue:'1',pages:'10-20',type:'journal-article'}}},parsed);
 assert.equal(r.canonicalComplete,false);assert.doesNotMatch(r.canonical,/李四|10-20/);assert.match(r.canonicalWarnings.join(''),/其余作者|末页/);
});
