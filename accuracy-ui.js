(() => {
  'use strict';

  const VERSION='20260908-accuracy30';
  let running=false;

  const fmt=(n,d=2)=>n==null||Number.isNaN(Number(n))?'N/A':Number(n).toFixed(d);

  async function json(path){
    const r=await fetch(`${path}?v=${Date.now()}`,{cache:'no-store'});
    if(!r.ok) throw new Error(`${r.status} ${path}`);
    return r.json();
  }

  const rows=a=>a?.gameweeks||[];
  const latest=a=>[...rows(a)].sort((x,y)=>Number(x.gw)-Number(y.gw)).at(-1)||null;
  const byGw=a=>Object.fromEntries(rows(a).map(x=>[Number(x.gw),x]));

  function card(label,value,note){
    return `<div class="card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></div>`;
  }

  function table(prod,shadow){
    const pm=byGw(prod), sm=byGw(shadow);
    const gws=[...new Set([...Object.keys(pm),...Object.keys(sm)].map(Number))].sort((a,b)=>b-a);
    if(!gws.length) return '';
    return `<div class="table-wrap"><table>
      <thead><tr><th>GW</th><th>3.0 Player MAE</th><th>2.2 Shadow MAE</th><th>3.0 Top100 MAE</th><th>3.0 Team MAE</th><th>2.2 Team MAE</th><th>3.0 Bias</th></tr></thead>
      <tbody>${gws.map(gw=>{
        const p=pm[gw],s=sm[gw];
        return `<tr>
          <td><b>GW${gw}</b></td>
          <td>${fmt(p?.relevant?.mae)}</td>
          <td>${fmt(s?.relevant?.mae)}</td>
          <td>${fmt(p?.top100?.mae)}</td>
          <td>${fmt(p?.team_mae)}</td>
          <td>${fmt(s?.team_mae)}</td>
          <td>${fmt(p?.relevant?.bias)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  function markup(prod,shadow,legacy){
    const p=latest(prod);
    const s=latest(shadow);

    if(!p){
      return `
        <div class="section-head"><h2>SZxP 3.0 Model Audit</h2><span class="stat-note">commercial production</span></div>
        <div class="notice">
          SZxP 3.0 Commercial Core is live. Its first genuine accuracy row appears only after the first Gameweek with a locked pre-deadline 3.0 snapshot is final.
        </div>
        ${s?`<div class="grid stats" style="margin-top:12px">
          ${card(`Last 2.2 Benchmark`,`GW${s.gw}`,`Player MAE ${fmt(s.relevant?.mae)} · Team MAE ${fmt(s.team_mae)}`)}
          ${card('2.2 Top100 MAE',fmt(s.top100?.mae),'reference only')}
          ${card('2.2 Mean Bias',fmt(s.relevant?.bias),'reference only')}
          ${card('3.0 Status','LIVE','awaiting first completed genuine GW')}
        </div>`:''}
      `;
    }

    const sm=byGw(shadow)[Number(p.gw)];
    const raw=p.raw_relevant;
    const calGain=(raw?.mae!=null&&p.relevant?.mae!=null)
      ? Number(raw.mae)-Number(p.relevant.mae):null;

    return `
      <div class="section-head"><h2>GW${p.gw} · SZxP 3.0 vs Actual</h2><span class="stat-note">2.2 shadow retained</span></div>
      <div class="grid stats">
        ${card('3.0 Player MAE',fmt(p.relevant?.mae),`${p.relevant?.n||0} predictions · lower is better`)}
        ${card('2.2 Shadow MAE',fmt(sm?.relevant?.mae),'same GW when available')}
        ${card('3.0 Team MAE',fmt(p.team_mae),`${p.team_predictions_evaluated||0} owner test squads`)}
        ${card('Calibration Effect',calGain==null?'N/A':`${calGain>=0?'+':''}${fmt(calGain)}`,calGain==null?'raw audit unavailable':calGain>0?'calibration improved MAE':'raw projection was better')}
      </div>
      <p class="model-note">3.0 keeps raw 2.2 xP inside every locked snapshot, so calibration can be audited rather than hidden. Player Szentre, Captain Szentre and decision scores are separate from raw xP.</p>
      ${table(prod,shadow)}
    `;
  }

  async function render(){
    if(running) return;
    const root=document.getElementById('overview');
    if(!root||!root.children.length) return;
    running=true;
    try{
      const [prod,shadow,legacy]=await Promise.all([
        json('data/accuracy-3.0.json').catch(()=>({gameweeks:[]})),
        json('data/accuracy-2.2.json').catch(()=>({gameweeks:[]})),
        json('data/accuracy.json').catch(()=>({gameweeks:[]})),
      ]);
      let el=document.getElementById('predictionAccuracyUpgrade');
      if(!el){
        el=document.createElement('div');
        el.id='predictionAccuracyUpgrade';
        el.className='section card';
        const stats=root.querySelector('.grid.stats');
        if(stats) stats.insertAdjacentElement('afterend',el); else root.prepend(el);
      }
      el.innerHTML=markup(prod,shadow,legacy);
    }catch(e){console.warn('3.0 Accuracy UI',e);}
    finally{running=false;}
  }

  const root=document.getElementById('overview');
  if(root){
    new MutationObserver(()=>{if(!running)setTimeout(render,60)})
      .observe(root,{childList:true});
  }
  document.addEventListener('click',e=>{
    if(e.target?.closest?.('#refreshBtn,[data-view="overview"]')) setTimeout(render,900);
  });
  window.addEventListener('load',()=>setTimeout(render,250));
  setTimeout(render,700);

  window.FSAccuracyUI={version:VERSION,render};
})();
