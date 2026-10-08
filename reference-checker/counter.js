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
  // The original counter did not cancel slow responses. Keep waiting after the
  // loading hint so a late historical total can still reach the page.
  const timeout=setTimeout(()=>{
    if(value.textContent==='—'){
      holder.title='正在读取原站点历史累计访问次数，统计请求仍在等待响应';
      value.textContent='读取中';
    }
  },8000);
  fetch('https://cdn.busuanzi.cc/api.php',{
    method:'POST',body:JSON.stringify({url:page,referrer:document.referrer})
  }).then(response=>{if(!response.ok)throw Error('counter unavailable');return response.json()})
    .then(data=>{
      const raw=data.busuanzi_site_pv;
      const number=Number(raw);
      if(raw===undefined || raw===null || !/^\d+$/.test(String(raw)) || !Number.isSafeInteger(number) || number<0)throw Error('invalid count');
      show(number);try{localStorage.setItem(key,String(number))}catch(error){}
    }).catch(error=>{
      console.warn('访问统计读取失败：',error.message);
      if(value.textContent==='—' || value.textContent==='读取中'){holder.title='当前连接未能读取历史累计访问次数，未重置计数';value.textContent='暂不可用'}
    }).finally(()=>clearTimeout(timeout));
})();
