(() => {
  const shown=document.getElementById('pageVisitCount');
  const holder=document.getElementById('storyVisitCounter');
  const status=document.getElementById('storyVisitStatus');
  if(!shown || !holder || window.wenzhengStoryVisitCounted)return;
  window.wenzhengStoryVisitCounted=true;
  // Preserve the original service and the owner's 2026-08-07 reset offset.
  // 2 is the last confirmed display in the saved conversation, not full history.
  const offset=3,checkpoint=2,key='wenzheng-story-pv-confirmed-v1';
  let last=checkpoint;
  try{
    const cached=Number(localStorage.getItem(key));
    if(Number.isSafeInteger(cached) && cached>=0)last=Math.max(last,cached);
  }catch(error){}
  const show=(state)=>{
    shown.textContent=last.toLocaleString('zh-CN');
    holder.setAttribute('aria-label',`协作实录累计访问 ${last} 次`);
    if(status)status.textContent=state==='live'?'':state==='pending'?'（历史记录同步中）':'（历史记录待同步）';
    holder.title=state==='live'?'原不蒜子页面访问量减去改版时的起始偏移3，延续原历史记录':'当前为最近已确认记录；原统计服务尚未成功返回最新历史访问量';
  };
  show('pending');
  const requestId=globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const controller=typeof AbortController==='function'?new AbortController():null;
  let timer;
  (async()=>{
    try{
      // Same endpoint and page identity as the original 3.6.9 script.
      const data=await Promise.race([
        (async()=>{
          const response=await fetch(`https://cdn.busuanzi.cc/api.php?request=${encodeURIComponent(requestId)}`,{
          method:'POST',cache:'no-store',referrerPolicy:'no-referrer',
          body:JSON.stringify({url:location.href,referrer:document.referrer}),
          ...(controller?{signal:controller.signal}:{})
          });
          if(!response.ok)throw Error('counter unavailable');
          return response.json();
        })(),
        new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller?.abort();reject(Error('counter timeout'))},8000)})
      ]);
      const raw=data?.busuanzi_page_pv;
      if(raw===undefined || raw===null || !/^\d+$/.test(String(raw)) || !Number.isSafeInteger(Number(raw)) || Number(raw)<offset)throw Error('invalid history');
      const total=Number(raw)-offset;
      if(total<last)throw Error('history behind checkpoint');
      last=total;show('live');
      try{localStorage.setItem(key,String(last))}catch(error){}
    }catch(error){show('unavailable');console.warn('实录历史访问统计暂不可用：',error.message)}
    finally{clearTimeout(timer)}
  })();
})();
