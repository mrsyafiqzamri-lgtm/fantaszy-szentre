// Fantaszy Szentre data freshness indicator — event driven, no polling spam.
(() => {
  'use strict';

  const PUBLIC_ENGINE_NAME='Fantaszy Szentre Engine';
  const FRESH_MIN=90;
  const STALE_MIN=180;

  const ageText=mins=>{
    if(mins==null||!Number.isFinite(mins))return'age unknown';
    if(mins<1)return'just now';
    if(mins<60)return`${Math.round(mins)} min ago`;
    const h=mins/60;
    if(h<24)return`${h.toFixed(h<10?1:0)}h ago`;
    return`${(h/24).toFixed(1)}d ago`;
  };

  function info(meta){
    const raw=meta?.updated_at_utc;
    if(!raw)return{level:'unknown',label:'UNKNOWN',ageMin:null,updated:'—',short:'—'};
    const date=new Date(raw);
    if(!Number.isFinite(date.getTime()))return{level:'unknown',label:'UNKNOWN',ageMin:null,updated:'—',short:'—'};
    const ageMin=Math.max(0,(Date.now()-date.getTime())/60000);
    const updated=date.toLocaleString(undefined,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
    const short=date.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
    if(ageMin>STALE_MIN)return{level:'stale',label:'STALE',ageMin,updated,short};
    if(ageMin>FRESH_MIN)return{level:'delayed',label:'DELAYED',ageMin,updated,short};
    return{level:'fresh',label:'FRESH',ageMin,updated,short};
  }

  const currentMeta=()=>{try{return state?.meta||{}}catch{return{}}};

  function paint(meta){
    const x=info(meta||currentMeta());
    const pill=document.querySelector('#apiStatus');
    if(pill){
      const dot=pill.querySelector('.dot');
      const label=pill.querySelector('span:last-child');
      pill.className='status-pill';
      if(x.level==='fresh')pill.classList.add('ok');
      if(x.level==='stale')pill.classList.add('bad');
      if(label)label.textContent=`${x.label} · ${x.short}`;
      if(dot){
        dot.style.background=x.level==='delayed'?'#f5c451':'';
        dot.style.boxShadow=x.level==='delayed'?'0 0 0 5px rgba(245,196,81,.12)':'';
      }
    }

    const overview=document.querySelector('#overview');
    const root=overview?.querySelector('#fsOwnerHome');
    if(!overview||!root)return;
    let notice=overview.querySelector('#dataFreshnessNotice');
    if(!notice){notice=document.createElement('div');notice.id='dataFreshnessNotice';root.prepend(notice)}
    notice.className=`notice ${x.level==='stale'?'warn':''}`;
    notice.textContent=`${x.label} · ${PUBLIC_ENGINE_NAME} updated ${x.updated} (${ageText(x.ageMin)}). Hourly data bundle; refresh checks the newest published snapshot.`;
  }

  window.addEventListener('fs:data-ready',()=>requestAnimationFrame(()=>paint(currentMeta())));
  window.addEventListener('fs:view-change',e=>{if(e.detail?.name==='overview')requestAnimationFrame(()=>paint(currentMeta()))});
  window.addEventListener('fs:refresh-complete',()=>requestAnimationFrame(()=>paint(currentMeta())));

  window.FSFreshness={paint,info};
})();
