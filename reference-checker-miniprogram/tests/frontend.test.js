const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function frontend(wx={}) {
 let page;
 const context={wx,getApp:()=>({globalData:{}}),Page:x=>{page=x},require:()=>require('../miniprogram/utils/references'),console};
 vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/index/index.js'),'utf8')+'\nglobalThis.cacheApi={cachedVerification,rememberVerification};',context);
 return {page,api:context.cacheApi};
}
test('设备存储不可用不影响核验返回',()=>{
 const {api}=frontend({getStorageSync(){throw Error('storage denied')},setStorageSync(){throw Error('quota exceeded')}});
 assert.equal(api.cachedVerification('文献'),null);
 assert.doesNotThrow(()=>api.rememberVerification('文献',{status:'verified',confidence:.99}));
});
test('建议著录保留提交序号，重复载入不会重复序号',()=>{
 const {page}=frontend();const result={status:'verified',canonical:'[1] 作者. 篇名[J]. 刊名, 2024, 2(1):1-3.',canonicalStandard:'GB/T 7714—2015'};
 const prepared=page.prepareResult(result,'[29] 原著录',0);assert.equal(prepared.canonical,'[29] 作者. 篇名[J]. 刊名, 2024, 2(1):1-3.');
 assert.equal(page.prepareResult(prepared,'[29] 原著录',0).canonical,prepared.canonical);
 assert.equal(prepared.canonicalStandard,'GB/T 7714—2015');
});
