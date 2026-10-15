(() => {
  const shown=document.getElementById('pageVisitCount');
  const holder=document.getElementById('storyVisitCounter');
  const status=document.getElementById('storyVisitStatus');
  if(!shown || !holder || window.wenzhengStoryVisitCounted)return;
  window.wenzhengStoryVisitCounted=true;
  // Owner-requested reset: 900 plus new shared page visits from 2026-10-15.
  // Use a new remote counter and cache key; never merge the retired totals.
  const base=900,key='wenzheng-story-pv-base900-20261015';
  const counter='wenzheng_story_pv_base900_20261015_94ef6a7b113e';
  const requestId=globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let last=base;
  try{
    const cached=Number(localStorage.getItem(key));
    if(Number.isSafeInteger(cached) && cached>=base)last=Math.max(last,cached);
  }catch(error){}
  function show(state){
    shown.textContent=last.toLocaleString('zh-CN');
    holder.setAttribute('aria-label',`协作实录累计访问 ${last} 次`);
    const notes={pending:'（更新中）',live:'',cached:'（最近记录）',unavailable:'（统计暂不可用）',stale:'（统计待同步）'};
    if(status)status.textContent=notes[state] || '';
    holder.title=state==='live'?'起始基数900＋本实录新增访问次数（2026年10月15日重设）':state==='pending'?'正在更新；当前显示起始基数或最近已确认的访问量':state==='stale'?'计数服务返回值低于已确认记录，保留记录并等待同步':state==='cached'?'计数请求未确认，当前显示最近一次云端记录':'统计暂不可用；当前保留起始基数或最近已确认的访问量';
  }
  function publish(total,counted){
    const behind=total<last;
    last=Math.max(last,total);
    try{localStorage.setItem(key,String(last))}catch(error){}
    show(behind?'stale':counted?'live':'cached');
  }
  async function request(action,timeout){
    const controller=typeof AbortController==='function'?new AbortController():null;
    let timer;
    try{
      // Unique URLs prevent cached hit responses from suppressing real visits.
      const data=await Promise.race([
        (async()=>{
          const response=await fetch(`https://countapi.mileshilliard.com/api/v1/${action}/${counter}?request=${encodeURIComponent(requestId)}-${action}`,{
            cache:'no-store',referrerPolicy:'no-referrer',...(controller?{signal:controller.signal}:{})
          });
          if(!response.ok)throw Error('counter unavailable');
          return response.json();
        })(),
        new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller?.abort();reject(Error('counter timeout'))},timeout)})
      ]);
      const raw=data?.value,added=Number(raw);
      if(data?.key!==counter || raw===undefined || raw===null || !/^\d+$/.test(String(raw)) || !Number.isSafeInteger(added) || !Number.isSafeInteger(base+added))throw Error('invalid visit count');
      return base+added;
    }finally{clearTimeout(timer)}
  }
  show('pending');
  (async()=>{
    try{publish(await request('hit',12000),true)}
    catch(error){
      // A lost response may follow a successful hit. Read only; do not hit twice
      // or invent a local increment when the shared service cannot be reached.
      try{publish(await request('get',8000),false)}
      catch(readError){show('unavailable');console.warn('实录访问统计暂不可用：',readError.message)}
    }
  })();
})();
