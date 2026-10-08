const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function frontend(wx={},globalData={}) {
 let page;
 const context={wx,getApp:()=>({globalData}),Page:x=>{page=x},require:()=>require('../miniprogram/utils/references'),console};
 vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/index/index.js'),'utf8')+'\nglobalThis.cacheApi={cachedVerification,rememberVerification};',context);
 return {page,api:context.cacheApi};
}
test('设备存储不可用不影响核验返回',()=>{
 const {api}=frontend({getStorageSync(){throw Error('storage denied')},setStorageSync(){throw Error('quota exceeded')}});
 assert.equal(api.cachedVerification('文献'),null);
 assert.doesNotThrow(()=>api.rememberVerification('文献',{status:'verified',confidence:.99}));
});
test('小程序初始显示1000，独立计数成功后更新并保存',async()=>{
 const saved=new Map();const {page}=frontend({getStorageSync:k=>saved.get(k),setStorageSync:(k,v)=>saved.set(k,v)});
 page.setData=values=>Object.assign(page.data,values);
 const visits=[];
 page.callCloud=async(name,event)=>{visits.push({name,event});return{ok:true,platform:'miniprogram',legacyBase:1000,total:1002}};
 assert.equal(page.data.visitTotal,1000);
 await page.refreshVisits();await page.refreshVisits();
 assert.equal(page.data.visitTotal,1002);assert.equal(saved.get('wenzheng-mini-pv-base1000-20261008'),1002);
 assert.equal(visits[0].name,'userHistory');assert.equal(visits[0].event.visitId,visits[1].event.visitId);
});
test('小程序计数失败或返回网站数据时保留1000基数及本机上次值',async()=>{
 for(const cached of [undefined,1045]){
  const {page}=frontend({getStorageSync:()=>cached});page.setData=values=>Object.assign(page.data,values);
  page.callCloud=async()=>({ok:true,platform:'website',legacyBase:1000,total:9000});
  await page.refreshVisits();assert.equal(page.data.visitTotal,cached||1000);assert.match(page.data.visitNote,/统计暂不可用/);
 }
});
test('小程序存储失败不影响1000基数的云端累计值显示',async()=>{
 const {page}=frontend({getStorageSync(){throw Error('denied')},setStorageSync(){throw Error('denied')}});
 page.setData=values=>Object.assign(page.data,values);
 page.callCloud=async()=>({ok:true,platform:'miniprogram',legacyBase:1000,total:1001});
 await page.refreshVisits();assert.equal(page.data.visitTotal,1001);assert.equal(page.data.visitNote,'');
});
test('建议著录保留提交序号，重复载入不会重复序号',()=>{
 const {page}=frontend();const result={status:'verified',canonical:'[1] 作者. 篇名[J]. 刊名, 2024, 2(1):1-3.',canonicalStandard:'GB/T 7714—2015'};
 const prepared=page.prepareResult(result,'[29] 原著录',0);assert.equal(prepared.canonical,'[29] 作者. 篇名[J]. 刊名, 2024, 2(1):1-3.');
 assert.equal(page.prepareResult(prepared,'[29] 原著录',0).canonical,prepared.canonical);
 assert.equal(prepared.canonicalStandard,'GB/T 7714—2015');
});
