// 1000 is the owner's selected baseline. The checkpoint is a verified total,
// not another baseline or an extra number to add to the remote counter.
(() => {
  const value=document.getElementById('websiteVisitCount');
  const holder=document.getElementById('siteCounter');
  const status=document.getElementById('websiteVisitStatus');
  if(!value || !holder || window.wenzhengVisitCounted)return;
  window.wenzhengVisitCounted=true;
  const base=1000,checkpoint=1012;
  const key='wenzheng-web-pv-base1000-20261008';
  const counter='wenzheng_web_pv_20261008_3bfea882af07';
  const requestId=globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let last=checkpoint;
  const show=(number,state)=>{
    value.textContent=number.toLocaleString('zh-CN');
    holder.classList.add('ready');
    holder.setAttribute('aria-label',`文证网站累计访问 ${number} 次`);
    const notes={pending:'（更新中）',live:'',cached:'（最近记录）',unavailable:'（统计暂不可用）',stale:'（统计待同步）'};
    if(status)status.textContent=notes[state] || '';
    holder.title=state==='live'?'起始基数1000＋网站新增访问次数；与小程序分别计数':state==='pending'?'正在更新；当前保留最近已确认的访问量':state==='stale'?'计数服务返回值低于已确认记录，保留记录并等待同步':state==='cached'?'计数请求未确认，当前显示最近一次云端记录':'统计暂不可用；当前显示最近已确认的访问量';
  };
  try{
    const old=Number(localStorage.getItem(key));
    if(Number.isSafeInteger(old) && old>=base)last=Math.max(last,old);
  }catch(error){}
  show(last,'pending');
  async function request(action,timeout){
    const controller=typeof AbortController==='function'?new AbortController():null;
    let timer;
    try{
      // cache:no-store alone does not change a shared proxy's cache key.
      const url=`https://countapi.mileshilliard.com/api/v1/${action}/${counter}?request=${encodeURIComponent(requestId)}-${action}`;
      const data=await Promise.race([
        (async()=>{
          const response=await fetch(url,{cache:'no-store',referrerPolicy:'no-referrer',...(controller?{signal:controller.signal}:{})});
          if(!response.ok)throw Error('counter unavailable');
          return response.json();
        })(),
        new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller?.abort();reject(Error('counter timeout'))},timeout)})
      ]);
      if(data?.key!==counter)throw Error('wrong counter');
      const raw=data.value,added=Number(raw);
      if(raw===undefined || raw===null || !/^\d+$/.test(String(raw)) || !Number.isSafeInteger(added) || added<0 || !Number.isSafeInteger(base+added))throw Error('invalid count');
      return base+added;
    }finally{clearTimeout(timer)}
  }
  function publish(total,counted){
    const behind=total<last;
    last=Math.max(last,total);
    show(last,behind?'stale':counted?'live':'cached');
    try{localStorage.setItem(key,String(last))}catch(error){}
  }
  (async()=>{
    try{publish(await request('hit',7000),true)}
    catch(error){
      // A timed-out hit may already have reached the server. Read only;
      // never retry the increment or invent a local +1.
      try{publish(await request('get',4000),false)}
      catch(readError){show(last,'unavailable');console.warn('访问统计读取失败：',readError.message)}
    }
  })();
})();
