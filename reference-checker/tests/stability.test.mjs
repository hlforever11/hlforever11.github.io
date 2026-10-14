import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {browserApi} from './browser-api.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const buffer=text=>{const b=Buffer.from(text);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};
const a='[1] 王明. 参考咨询方法[J]. 图书馆, 2024, 3(1): 1-8.';
const b='[2] 李华. 文献检索方法[J]. 图书馆, 2023, 2(1): 9-16.';
const good={status:'verified',confidence:.99,authenticityConfidence:.99,differences:[],canonical:'SMITH J. Example[J]. Review, 2024, 1(1):1-8.',sourceUrl:'https://doi.org/10.1234/a.b'};
function manualClock(){let id=0;const timers=new Map();return{timers,setTimeout:fn=>{timers.set(++id,fn);return id},clearTimeout:id=>timers.delete(id),expire:async()=>{for(const [i,fn] of [...timers]){timers.delete(i);fn()}await flush()}}}
async function settled(p){return Promise.race([p.then(()=>true,()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),120))])}

test('全角序号、标点及零宽字符不合并中英文题录',()=>{
 const {api}=browserApi();const text='［１］ 王明．参考咨询方法［Ｊ］．图书馆，２０２４，３（１）：１－８．\n［２］ 李华．文献检索方法［Ｊ］．图书馆，２０２３，２（１）：９－１６．';
 assert.equal(api.refs(text).length,2);const p=api.parseReference(api.refs(text)[0]);assert.equal(p.title,'参考咨询方法');assert.equal(p.year,2024);
 assert.equal(api.refs(a+'\n\u200b'+b).length,2);
});
test('文献题名中的References和参考文献不是文档章节标题',()=>{
 const {api}=browserApi();const first='[1] SMITH J. References for reliable research[J]. Review, 2024, 1(1): 1-8.';
 const list=api.extractReferences('正文内容\n参考文献\n'+first+'\n'+b+'\n致谢\n感谢老师的指导。');
 assert.equal(list.length,2);assert.equal(list[0],first);assert.equal(list[1],b);
 const chinese='[1] 王明. 参考文献核验方法[J]. 图书馆,2024,1(1):1-8.';
 assert.equal(api.extractReferences('参考文献\n'+chinese)[0],chinese);
});
test('同段落章节标题与连续序号仍能提取，跨行题录保持完整',()=>{
 const {api}=browserApi();assert.equal(api.extractReferences('参考文献'+a+' '+b).length,2);
 const result=api.extractReferences('参考文献\n[1] 王明. 参考咨询\n方法[J]. 图书馆, 2024, 3(1): 1-8.\n'+b);
 assert.equal(result.length,2);assert.match(result[0],/参考咨询 方法/);
});
test('不同DOI不能因删除点号而命中同一个成功缓存',()=>{
 const {api}=browserApi();const x='SMITH J. Example[J]. Review, 2024. DOI:10.1234/a.b.',y=x.replace('a.b','ab');
 api.rememberVerification(x,good);assert.ok(api.cachedVerification(x));assert.equal(api.cachedVerification(y),null);
});
test('损坏、未来时间及不可信状态的缓存不会变成永久成功',()=>{
 for(const item of [{storedAt:'bad',result:good},{storedAt:Date.now()+86400000,result:good},{storedAt:Date.now(),result:{...good,status:'toString'}},{storedAt:Date.now(),result:{...good,differences:'broken'}}]){
  const {api,context}=browserApi();context.localStorage.setItem(api.VERIFY_CACHE_KEY,JSON.stringify({[api.verificationCacheKey(a)]:item}));assert.equal(api.cachedVerification(a),null);
 }
});
test('单条损坏的历史不会使其余正常历史消失，计数只能为数字',()=>{
 const {api,context}=browserApi();context.localStorage.setItem('wenzheng-verification-history-v1',JSON.stringify([null,{id:'bad',references:[null]},{id:'ok',references:[a],createdAt:'2024-01-01',counts:{verified:'<img onerror=alert(1)>'}}]));
 const history=api.readHistory();assert.equal(history.length,1);assert.equal(history[0].id,'ok');assert.equal(history[0].counts.verified,0);
});
test('两次连续上传时较慢的旧文件不能覆盖新文件',async()=>{
 const {api,nodes}=browserApi();let complete;
 const first=api.handleFile({name:'old.txt',size:20,arrayBuffer:()=>new Promise(resolve=>{complete=resolve})});
 await flush();await api.handleFile({name:'new.txt',size:20,arrayBuffer:async()=>buffer(b)});assert.equal(nodes.get('#input').value,b);
 complete(buffer(a));await first;await flush();assert.equal(nodes.get('#input').value,b);
});
test('读取期间清空后，迟到的文件内容不能重新出现',async()=>{
 const {api,nodes}=browserApi();let complete;
 const reading=api.handleFile({name:'old.txt',size:20,arrayBuffer:()=>new Promise(resolve=>{complete=resolve})});await flush();api.clearInput();
 complete(buffer(a));await reading;assert.equal(nodes.get('#input').value,'');
});
test('UTF16文本能按BOM读取，不产生乱码作者',async()=>{
 const {api,nodes}=browserApi();const bytes=Buffer.concat([Buffer.from([255,254]),Buffer.from(a,'utf16le')]);
 await api.handleFile({name:'utf16.txt',size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(nodes.get('#input').value,a);
});
test('请求和JSON正文不响应时，超时仍能结束等待',async()=>{
 const clock=manualClock(),r=browserApi(()=>new Promise(()=>{}),clock);const request=settled(r.api.fetchJson('https://example.org/data'));await flush();await clock.expire();assert.equal(await request,true);
 const clock2=manualClock(),r2=browserApi(async()=>({ok:true,json:()=>new Promise(()=>{})}),clock2);const body=settled(r2.api.fetchJson('https://example.org/data'));await flush();await clock2.expire();assert.equal(await body,true);
});
test('中文期刊名录加载也有超时，并能在恢复后重新读取',async()=>{
 const clock=manualClock();let online=false;const r=browserApi(()=>online?new Response('[]'):new Promise(()=>{}),clock);
 const first=settled(r.api.loadChineseJournalIndex());await flush();await clock.expire();assert.equal(await first,true);online=true;
 assert.equal((await r.api.loadChineseJournalIndex()).rows.length,0);
});
test('核验过程中按钮可停止，取消后解除界面锁定且不新增重试请求',async()=>{
 let calls=0;const clock=manualClock(),r=browserApi(()=>{calls++;return new Promise(()=>{})},clock);r.nodes.get('#input').value=a;
 const first=r.nodes.get('#verifyBtn').onclick();await flush();assert.equal(r.nodes.get('#verifyBtn').disabled,false);
 const before=calls;await r.nodes.get('#verifyBtn').onclick();assert.equal(await settled(first),true);await flush();assert.equal(r.nodes.get('#input').disabled,false);assert.equal(calls,before);assert.equal(clock.timers.size,0);
});
test('结果来源只允许安全网页链接，异常差异列表不使结果页崩溃',()=>{
 const {api}=browserApi();const html=api.card({...good,sourceUrl:'javascript:alert(1)',evidenceLinks:[null,{label:'unsafe',url:'data:text/html,test'}],differences:'broken'},0);
 assert.doesNotMatch(html,/href="(?:javascript:|data:)/);assert.match(html,/已确认真实/);
});
test('英文姓氏在前的作者及Crossref中文姓与名顺序正确',()=>{
 const {api}=browserApi();for(const name of ['SMITH J','Smith, J.'])assert.equal(api.gtAuthor(name),'SMITH J');
 assert.equal(api.crossrefCandidate({author:[{family:'王',given:'明'}],title:['Example']}).authors[0],'王明');
});
test('DOI点号不同不能视为精确标识符一致',()=>{
 const {api}=browserApi(),parsed=api.parseReference('SMITH J. Example title[J]. Review, 2024. DOI:10.1234/a.b.');
 const candidate={title:'Example title',authors:['John Smith'],authorKeys:['smith'],container:'Review',doi:'10.1234/ab',sources:['test']};
 assert.equal(api.scoreCandidate(parsed,candidate).identifierExact,false);
});
test('PDF组件不会在首屏通过静态模块导入阻塞纯文本核验',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');assert.equal(/^\s*import\s+\*\s+as\s+pdfjsLib/m.test(html),false);
});

test('异常和成功的PDF均释放worker，取消读取后也能释放',async()=>{
 const {api}=browserApi();
 for(const pages of [1,101]){
  let destroyed=0,cleaned=0;
  const library={getDocument:()=>({promise:Promise.resolve({numPages:pages,getPage:async()=>({getTextContent:async()=>({items:[{str:a,hasEOL:true}]}),cleanup:()=>cleaned++})}),destroy:async()=>destroyed++})};
  const task=api.readPdf({arrayBuffer:async()=>buffer('fake')},new AbortController().signal,Promise.resolve(library));
  if(pages===1){assert.match(await task,/参考咨询方法/);assert.equal(cleaned,1)}else await assert.rejects(task,/超过 100 页/);
  assert.equal(destroyed,1);
 }
 let destroyed=0,done;const controller=new AbortController();
 const library={getDocument:()=>({promise:new Promise(resolve=>{done=resolve}),destroy:()=>{destroyed++}})};
 const result=api.readPdf({arrayBuffer:async()=>buffer('fake')},controller.signal,Promise.resolve(library));await flush();controller.abort();
 assert.equal(destroyed,1);done({numPages:0});await assert.rejects(result,/停止/);assert.equal(destroyed,1);
});
test('空文件、超限文件、错误扩展名不会覆盖已有输入，读取后按钮可用',async()=>{
 const {api,nodes}=browserApi();nodes.get('#input').value=a;
 for(const file of [{name:'empty.txt',size:0},{name:'big.pdf',size:16*1024*1024},{name:'old.doc',size:10}]){
  await api.handleFile(file);assert.equal(nodes.get('#input').value,a);assert.equal(nodes.get('#verifyBtn').disabled,false);
 }
});
test('文档读取没有完成时不会启动核验，超时后恢复操作',async()=>{
 const clock=manualClock(),r=browserApi(undefined,clock);
 const task=r.api.handleFile({name:'slow.txt',size:10,arrayBuffer:()=>new Promise(()=>{})});await flush();assert.equal(r.nodes.get('#verifyBtn').disabled,true);
 await clock.expire();await task;assert.equal(r.nodes.get('#input').disabled,false);assert.match(r.nodes.get('#fileMessage').textContent,/超时/);
});
test('有坏记录或仅name字段的Crossref作者不会使其他记录丢失',async()=>{
 const {api}=browserApi(async()=>new Response(JSON.stringify({message:{items:[null,{title:['An unseen result'],author:[null,{name:'Research Consortium'}],page:123,DOI:'10.1234/valid'}]}})));
 const result=await api.queryCrossref(api.parseReference(a)),match=result.candidates.find(c=>c.title==='An unseen result');
 assert.ok(match);assert.equal(match.authors[0],'Research Consortium');assert.equal(match.pages,'123');assert.ok(match.authorKeys.length);
});
test('建议著录保留全角、圆圈和普通数字的原始序号',()=>{
 const {api}=browserApi();for(const prefix of ['［１６］','⑯','16.','16、','16 '])assert.equal(api.numberedCanonical('王明. 方法[J]. 图书馆,2024.',0,prefix+' 王明. 方法[J]. 图书馆,2024.'),'[16] 王明. 方法[J]. 图书馆,2024.');
});

for(const [kind,raw] of [
 ['中文期刊',a],
 ['外文图书','SMITH J. Uncatalogued monograph[M]. London: Example Press, 2024.'],
 ['会议论文','SMITH J. An unindexed experiment[C]//Proceedings of Example Conference. 2024: 1-8.'],
 ['学位论文','王明. 一项尚未收录的研究[D]. 成都:某大学,2024.'],
 ['标准','某机构. 新标准: GB/T 12345-2024[S]. 北京:某出版社,2024.'],
 ['专利','王明. 某项装置:CN123456789A[P].2024-01-01.'],
 ['报纸','王明. 新闻题名[N]. 某报,2024-01-01(1).'],
 ['在线报告','Research Council. A new report[R/OL]. 2024. https://example.org/report.'],
 ['网页','机构. 一则新闻[EB/OL].(2024-01-01)[2024-01-02].https://example.org/news.']
])test(`数据源离线时${kind}仍返回可解释结果，不误报虚假`,async()=>{
 const {api}=browserApi();const result=await api.verifyOneLocal(raw);assert.ok(['unverified','review','error'].includes(result.status));assert.ok(result.note);assert.doesNotMatch(result.note,/该文献是虚假|判定为虚假/);
});

test('同一DOI的完整来源能补齐空作者和未核实末页，不保留过时缺项',()=>{
 const {api}=browserApi(),base={title:'Example',doi:'10.1234/test',sources:['first'],authors:[],authorKeys:[],pages:'1',partialFields:['其余作者','末页']};
 const full={...base,sources:['second'],authors:['John Smith'],authorKeys:['smith'],pages:'1-8',partialFields:[]};
 const merged=api.mergeCandidates([base,full])[0];assert.equal(merged.authors[0],'John Smith');assert.equal(merged.pages,'1-8');assert.equal(merged.partialFields.length,0);
 const reverse=api.mergeCandidates([full,base])[0];assert.equal(reverse.authors[0],'John Smith');assert.equal(reverse.pages,'1-8');assert.equal(reverse.partialFields.length,0);
});
test('同一题录换序号可复用成功证据，结果仍保留本次提交内容',()=>{
 const {api}=browserApi();api.rememberVerification(a,good);const changed=a.replace('[1]','[16]'),cached=api.cachedVerification(changed);assert.ok(cached);assert.equal(cached.submitted,changed);
});
test('浏览器拒绝存储时核验仍可完成，并明确提示历史未保存',async()=>{
 const r=browserApi(undefined,{localStorage:{getItem(){throw Error('denied')},setItem(){throw Error('denied')},removeItem(){throw Error('denied')}}});
 r.nodes.get('#input').value=a;await r.nodes.get('#verifyBtn').onclick();assert.equal(r.nodes.get('#input').disabled,false);assert.match(r.nodes.get('#cards').innerHTML,/暂未证实/);assert.match(r.nodes.get('#fileMessage').textContent,/未能保存历史/);
});

test('GBK文本自动转为可检索的中文题录',async()=>{
 const {api,nodes}=browserApi(),bytes=Buffer.from('5b315d20cdf5c3f72e20b2cebfbcd7c9d1afb7bdb7a85b4a5d2e20cdbccae9b9dd2c20323032342c20332831293a20312d382e','hex');
 await api.handleFile({name:'gbk.txt',size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(nodes.get('#input').value,a);
});
