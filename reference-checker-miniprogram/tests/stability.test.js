const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const parser=require('../miniprogram/utils/references');
const cloudParser=require('../cloudfunctions/extractDocument/lib/references');
const REF='[1] 王明. 文献核验方法[J]. 测试期刊, 2024, 3(1):1-8.';
const valid={status:'verified',confidence:.99,canonical:'王明. 文献核验方法[J]. 测试期刊, 2024, 3(1):1-8.',differences:[],evidenceLinks:[]};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
function frontend(extraWx={}){
 let page;const saved=new Map();
 const wx={cloud:{},getStorageSync:k=>saved.get(k),setStorageSync:(k,v)=>saved.set(k,v),removeStorageSync:k=>saved.delete(k),showToast(){},showModal(){},pageScrollTo(){},...extraWx};
 const context={wx,getApp:()=>({globalData:{cloudAvailable:true}}),Page:p=>{page=p},require:p=>p.endsWith('/cloud')?require('../miniprogram/utils/cloud'):parser,setTimeout,clearTimeout,console};
 vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/index/index.js'),'utf8')+'\nglobalThis.cacheApi={cachedVerification,rememberVerification};',context);
 page.setData=data=>Object.assign(page.data,data);
 return{page,saved,api:context.cacheApi};
}
test('小程序与文档云函数可拆开同行小数点序号且保留题名、DOI和致谢边界',()=>{
 const first='1. Smith J. Library 2.0: Tools for reference verification[J]. Testing Journal, 2024, 3(1):1-8. DOI:10.98765/a.b.';
 const second='2. 王明. 参考文献核验方法[J]. 测试期刊, 2024, 3(2):9-18.';
 for(const api of [parser,cloudParser]){
  const pasted=api.splitReferences(first+' '+second);assert.equal(pasted.length,2);assert.equal(pasted[0],first);
  const imported=api.extractReferencesFromDocument('正文\n参考文献\n'+first+' '+second+'\n致谢\n感谢老师。');
  assert.equal(imported.length,2);assert.equal(imported[1],second);assert.doesNotMatch(imported.join(' '),/感谢老师/);
 }
});
test('全角序号和零宽字符可解析，无序号APA换行合并',()=>{
 const input='［１］ 王\u200b明. 第一篇[J]. 测试期刊, 2024. ［２］ 李华. 第二篇[J]. 测试期刊, 2023.';
 assert.equal(parser.splitReferences(input).length,2);
 const apa='References\nSmith (2024). Research on library\nreference verification. Testing Journal, 3(1), 1–8.\nJones (2023). Second study. Another Journal, 2(1), 1–6.';
 assert.equal(parser.extractReferencesFromDocument(apa).length,2);
});
test('本机缓存严格区分DOI与URL标点、路径大小写，停用旧缓存',()=>{
 const {api,saved}=frontend();
 api.rememberVerification(REF+' DOI:10.98765/a.b.',valid);
 assert.ok(api.cachedVerification(REF+' DOI:10.98765/a.b.'));assert.equal(api.cachedVerification(REF+' DOI:10.98765/a.b.').note,valid.note);assert.match(api.cachedVerification(REF+' DOI:10.98765/a.b.').detailsNote,/本机最近一次/);
 assert.equal(api.cachedVerification(REF+' DOI:10.98765/ab.'),null);
 api.rememberVerification(REF+' https://example.org/Case_A',valid);
 assert.equal(api.cachedVerification(REF+' https://example.org/case_a'),null);
 assert.ok(saved.has('wenzheng-success-cache-v8'));assert.equal(saved.has('wenzheng-success-cache-v3'),false);
});
test('无效置信度不进入成功缓存',()=>{
 const {api}=frontend();for(const confidence of [NaN,Infinity,-1,2])api.rememberVerification(REF,{...valid,confidence});
 assert.equal(api.cachedVerification(REF),null);
});
test('停止核验立即恢复按钮，迟到云端结果不更新结果或缓存',async()=>{
 const {page,api}=frontend();const waiting=deferred();page.callCloud=()=>waiting.promise;page.updateInput(REF);
 const job=page.verifyAll();await tick();assert.equal(page.data.loading,true);
 page.stopVerification();await job;assert.equal(page.data.loading,false);assert.equal(page.data.canVerify,true);assert.equal(page.data.results.length,0);
 waiting.resolve(valid);await tick();assert.equal(page.data.results.length,0);assert.equal(api.cachedVerification(REF),null);
});
test('停止后可立即核验新内容，前一批迟到结果不覆盖新批次',async()=>{
 const {page}=frontend();const waiting=deferred();page.callCloud=()=>waiting.promise;page.updateInput(REF);
 const old=page.verifyAll();await tick();page.stopVerification();await old;
 page.updateInput(REF.replace('王明','李华'));page.callCloud=async()=>valid;await page.verifyAll();
 const shown=page.data.results[0].submitted;waiting.resolve({...valid,note:'old'});await tick();
 assert.equal(page.data.results[0].submitted,shown);assert.equal(page.data.results[0].note,undefined);assert.match(page.data.progressText,/已完成 1 条/);
});
test('卸载页面后未完成请求不再写入页面',async()=>{
 const {page}=frontend();const waiting=deferred();page.callCloud=()=>waiting.promise;page.updateInput(REF);
 const job=page.verifyAll();await tick();page.onUnload();await job;waiting.resolve(valid);await tick();assert.equal(page.data.results.length,0);
});
test('前一次慢文档不能覆盖后选择的文档',async()=>{
 const {page}=frontend();const first=deferred();page.readTextFile=path=>path==='old'?first.promise:Promise.resolve(REF.replace('王明','李华'));
 const old=page.handleDocument({name:'old.txt',path:'old',size:100});await tick();
 await page.handleDocument({name:'new.txt',path:'new',size:100});first.resolve(REF);await old;
 assert.match(page.data.inputValue,/李华/);assert.equal(page.data.fileReading,false);assert.equal(page.data.canVerify,true);
});
test('文档解析期间输入或清空内容，迟到结果均不会覆盖',async()=>{
 for(const action of ['type','clear']){
  const {page}=frontend();const waiting=deferred();page.readTextFile=()=>waiting.promise;page.updateInput(REF);
  const job=page.handleDocument({name:'test.txt',path:'x',size:100});await tick();assert.equal(page.data.canVerify,false);
  if(action==='type')page.onInput({detail:{value:REF.replace('王明','李华')}});else page.clearInput();
  const input=page.data.inputValue;waiting.resolve(REF);await job;assert.equal(page.data.inputValue,input);assert.equal(page.data.fileMessage,'');
 }
});
test('文档读取失败后保留原输入并恢复核验',async()=>{
 const {page}=frontend();page.updateInput(REF);page.readTextFile=async()=>{throw Error('损坏的文档')};
 await page.handleDocument({name:'test.txt',path:'x',size:100});assert.equal(page.data.inputValue,REF);assert.equal(page.data.fileReading,false);assert.equal(page.data.canVerify,true);assert.match(page.data.fileMessage,/损坏/);
});
test('取消上传后返回的临时文件仍会请求删除',async()=>{
 const waiting=deferred(),deleted=[];
 const {page}=frontend({cloud:{uploadFile:()=>waiting.promise,deleteFile:async({fileList})=>{deleted.push(...fileList)}}});
 const job=page.handleDocument({name:'test.docx',path:'x',size:100});await tick();page.clearInput();waiting.resolve({fileID:'late-upload'});await job;
 assert.deepEqual(deleted,['late-upload']);assert.equal(page.data.inputValue,'');
});
test('超出20条只核验20条，服务失败也能结束并继续操作',async()=>{
 const {page}=frontend();let calls=0;page.callCloud=async()=>{calls++;throw Error('离线')};
 page.updateInput(Array.from({length:24},(_,i)=>REF.replace('[1]',`[${i+1}]`)).join('\n'));
 await page.verifyAll();assert.equal(calls,20);assert.equal(page.data.results.length,20);assert.equal(page.data.loading,false);assert.equal(page.data.canVerify,true);
});
test('设备存储故障不阻断载入页面与历史状态恢复',()=>{
 const {page}=frontend({getStorageSync(){throw Error('denied')}});assert.doesNotThrow(()=>page.onShow());assert.doesNotThrow(()=>page.restoreHistoryState());
});
test('云请求超时后拒绝等待，迟到结果不改变已返回状态',async()=>{
 const timers=new Map();let serial=0;const context={module:{exports:{}},setTimeout:fn=>{timers.set(++serial,fn);return serial},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/utils/cloud'),'utf8'),context);
 const waiting=deferred();const job=context.module.exports.withTimeout(()=>waiting.promise,100,'超时');await tick();
 const rejection=assert.rejects(job,/超时/);for(const fn of timers.values())fn();await rejection;waiting.resolve('late');await tick();assert.equal(timers.size,0);
});
test('页脚只保留原有说明、隐私入口和邮箱，核验仍可停止',()=>{
 const html=fs.readFileSync(require.resolve('../miniprogram/pages/index/index.wxml'),'utf8');
 assert.match(html,/停止核验/);assert.match(html,/!loading && !canVerify/);
 const footer=html.slice(html.indexOf('<view class="footer">'));
 assert.match(footer,/重要用途请以出版者或原始网页记录为准/);assert.match(footer,/隐私说明/);assert.match(footer,/linhu@scu.edu.cn/);
 assert.doesNotMatch(footer,/clientBuild|visitTotal|visitNote|V\d+|版本|日期|访问/);
});
