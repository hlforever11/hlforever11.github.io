// A user-selected starting value plus this website's independent new page views.
(() => {
  const value=document.getElementById('websiteVisitCount');
  const holder=document.getElementById('siteCounter');
  if(!value || !holder || window.wenzhengVisitCounted)return;
  window.wenzhengVisitCounted=true;
  const base=1000;
  const key='wenzheng-web-pv-base1000-20261008';
  const counter='wenzheng_web_pv_20261008_3bfea882af07';
  const show=(number,state='live')=>{
    value.textContent=number.toLocaleString('zh-CN');
    holder.classList.add('ready');
    holder.setAttribute('aria-label',`文证网站累计访问 ${number} 次`);
    holder.title=state==='base'?'预设起始基数1000，正在读取网站新增访问次数':state==='cached'?'显示最近一次成功读取值；起始基数1000，与小程序分别计数':'起始基数1000＋网站新增访问次数；与小程序分别计数';
  };
  let last=base;
  show(last,'base');
  try {
    const old=Number(localStorage.getItem(key));
    if(Number.isSafeInteger(old) && old>=base){last=old;show(last,'cached')}
  }catch(error){}
  // No automatic retry: an ambiguous network failure must not count twice.
  fetch(`https://countapi.mileshilliard.com/api/v1/hit/${counter}`,{
    cache:'no-store',referrerPolicy:'no-referrer'
  }).then(response=>{if(!response.ok)throw Error('counter unavailable');return response.json()})
    .then(data=>{
      const raw=data.value;
      const added=Number(raw);
      if(raw===undefined || raw===null || !/^\d+$/.test(String(raw)) || !Number.isSafeInteger(added) || !Number.isSafeInteger(base+added) || added<0)throw Error('invalid count');
      last=Math.max(last,base+added);
      show(last);
      try{localStorage.setItem(key,String(last))}catch(error){}
    }).catch(error=>{
      console.warn('访问统计读取失败：',error.message);
      holder.title=last===base?'统计暂不可用，当前显示预设起始基数1000':'统计暂不可用，保留最近一次成功读取值；起始基数1000';
    });
})();
