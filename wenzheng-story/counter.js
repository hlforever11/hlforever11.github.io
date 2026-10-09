(() => {
  const shown=document.getElementById('pageVisitCount');
  const holder=document.getElementById('storyVisitCounter');
  const status=document.getElementById('storyVisitStatus');
  if(!shown || !holder || window.wenzhengStoryVisitCounted)return;
  window.wenzhengStoryVisitCounted=true;
  // Only 2 old visits are confirmed. The complete historical total is unknown.
  // New visits use their own shared counter, independent of the tool website.
  const checkpoint=2,offset=3,key='wenzheng-story-pv-confirmed-v1';
  const counter='wenzheng_story_pv_20261009_5617ac9e430b';
  const requestId=globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let last=checkpoint,newState='pending',historyState='pending';
  try{
    const cached=Number(localStorage.getItem(key));
    if(Number.isSafeInteger(cached) && cached>=0)last=Math.max(last,cached);
  }catch(error){}
  function show(){
    shown.textContent=last.toLocaleString('zh-CN');
    holder.setAttribute('aria-label',`协作实录累计访问至少 ${last} 次，完整历史待恢复`);
    const historyNote=historyState==='available'?'历史待核对':'历史待恢复';
    const note=newState==='pending'?`更新中，${historyNote}`:newState==='cached'?`最近记录，${historyNote}`:newState==='unavailable'?`统计暂不可用，${historyNote}`:historyNote;
    if(status)status.textContent=`（${note}）`;
    holder.title=newState==='live'?'新增访问已同步；当前为已确认访问量的下限，完整历史仍待恢复':'当前保留最近已确认的访问量下限；完整历史仍待恢复';
  }
  function preserve(total){
    last=Math.max(last,total);
    try{localStorage.setItem(key,String(last))}catch(error){}
    show();
  }
  async function request(url,options,timeout){
    const controller=typeof AbortController==='function'?new AbortController():null;
    let timer;
    try{
      return await Promise.race([
        (async()=>{
          const response=await fetch(url,{cache:'no-store',referrerPolicy:'no-referrer',...options,...(controller?{signal:controller.signal}:{})});
          if(!response.ok)throw Error('counter unavailable');
          return response.json();
        })(),
        new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller?.abort();reject(Error('counter timeout'))},timeout)})
      ]);
    }finally{clearTimeout(timer)}
  }
  const integer=value=>value!==undefined && value!==null && /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value));
  async function newVisits(action,timeout){
    const data=await request(`https://countapi.mileshilliard.com/api/v1/${action}/${counter}?request=${encodeURIComponent(requestId)}-${action}`,{},timeout);
    if(data?.key!==counter || !integer(data.value) || !Number.isSafeInteger(checkpoint+Number(data.value)))throw Error('invalid new visit count');
    return checkpoint+Number(data.value);
  }
  show();
  (async()=>{
    try{const total=await newVisits('hit',20000);newState='live';preserve(total)}
    catch(error){
      // A failed response may follow a successful increment. Only read it back.
      try{const total=await newVisits('get',12000);newState='cached';preserve(total)}
      catch(readError){newState='unavailable';show();console.warn('实录新增访问统计暂不可用：',readError.message)}
    }
  })();
  (async()=>{
    try{
      // Retain the original page identity and service as a history recovery path.
      const data=await request(`https://cdn.busuanzi.cc/api.php?request=${encodeURIComponent(requestId)}`,{
        method:'POST',body:JSON.stringify({url:location.href,referrer:document.referrer})
      },8000);
      const raw=data?.busuanzi_page_pv;
      if(!integer(raw) || Number(raw)<offset+checkpoint)throw Error('invalid history');
      historyState='available';
      // The two providers can contain overlapping visits. Never add both totals.
      preserve(Number(raw)-offset);
    }catch(error){historyState='unavailable';show();console.warn('实录历史访问统计暂不可用：',error.message)}
  })();
})();
