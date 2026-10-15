const {test}=require('node:test');
const assert=require('node:assert/strict');
const {main}=require('../cloudfunctions/verifyReference/index');

test('云函数成功缓存不能混淆只差点号的DOI',async()=>{
 const saved=global.fetch;
 const reference='SMITH J. Network retrieval cache identity[J]. Testing Journal, 2024, 3(1): 1-8. DOI:10.98765/a.b.';
 const item={title:['Network retrieval cache identity'],author:[{family:'Smith',given:'John'}],'container-title':['Testing Journal'],published:{'date-parts':[[2024]]},volume:'3',issue:'1',page:'1-8',DOI:'10.98765/a.b',type:'journal-article'};
 let calls=0;
 global.fetch=async input=>{
  const url=new URL(String(input));
  if(url.hostname!=='api.crossref.org')throw Error('offline test');
  calls++;return new Response(JSON.stringify({message:url.pathname==='/works'?{items:[item]}:item}));
 };
 try{
  const first=await main({reference});assert.ok(['verified','partial'].includes(first.status),first.note);
  const repeated=await main({reference});assert.equal(repeated.cacheHit,true);
  const before=calls,changed=await main({reference:reference.replace('a.b','ab')});
  assert.notEqual(changed.cacheHit,true);assert.ok(calls>before);
  assert.equal(changed.status,'corrected');assert.ok(changed.differences.some(d=>d.field==='DOI'));
 }finally{global.fetch=saved}
});
