// Restore the original site-PV metric so earlier cumulative visits continue.
(() => {
  const value=document.getElementById('busuanzi_site_pv');
  const holder=document.getElementById('siteCounter');
  if(!value || !holder)return;
  const page='https://hlforever11.github.io/reference-checker/';
  const key='wenzheng-site-pv-last';
  const show=(number,cached=false)=>{
    value.textContent=number.toLocaleString('zh-CN');
    holder.classList.add('ready');
    holder.title=cached?'上次成功读取的原站点累计访问次数，当前统计服务暂不可用':'沿用原站点历史累计访问次数；与微信小程序分别计数';
  };
  try {const old=Number(localStorage.getItem(key));if(Number.isSafeInteger(old)&&old>0)show(old,true)}catch(error){}
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8000);
  fetch('https://cdn.busuanzi.cc/api.php',{
    method:'POST',body:JSON.stringify({url:page,referrer:document.referrer}),signal:controller.signal
  }).then(response=>{if(!response.ok)throw Error('counter unavailable');return response.json()})
    .then(data=>{
      const raw=data.busuanzi_site_pv;
      const number=Number(raw);
      if(raw===undefined || raw===null || !/^\d+$/.test(String(raw)) || !Number.isSafeInteger(number) || number<0)throw Error('invalid count');
      show(number);try{localStorage.setItem(key,String(number))}catch(error){}
    }).catch(()=>{
      if(value.textContent==='—'){holder.title='访问统计服务暂时无法连接，历史累计数据不会重置';value.textContent='暂不可用'}
    }).finally(()=>clearTimeout(timeout));
})();
