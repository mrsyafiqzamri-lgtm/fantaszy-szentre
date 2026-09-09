
(() => {
  'use strict';

  const VERSION='20260909-owner30-1';
  const KEYS={
    home:'fs30:homeTeam',
    team:'fs30:teamHub',
    showAll:'fs30:showAllLeagues',
    positions:'fs30:positions',
    clubs:'fs30:clubs'
  };

  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const n=v=>Number(v||0);
  const fmt=(v,d=1)=>n(v).toFixed(d);
  const int=v=>n(v)>0?n(v).toLocaleString():'—';
  const esc=(s='')=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const price=v=>`£${(n(v)/10).toFixed(1)}m`;

  function dataReady(){
    try{return Boolean(state?.teamData?.some?.(x=>x.ok)&&state?.players?.length&&state?.nextEvents?.length)}
    catch{return false}
  }

  function teams(){return state.teamData.filter(x=>x.ok)}

  function selected(key){
    const list=teams();
    if(!list.length)return null;
    const saved=Number(localStorage.getItem(key)||list[0].id);
    return list.find(x=>Number(x.id)===saved)||list[0];
  }

  function loadArray(key,fallback){
    try{const x=JSON.parse(localStorage.getItem(key)||'null');return Array.isArray(x)?x:fallback}
    catch{return fallback}
  }

  function saveArray(key,v){try{localStorage.setItem(key,JSON.stringify(v))}catch{}}

  function picker(td,id){
    return `<label class="fs-label" for="${id}">Choose team</label>
      <select class="fs-picker" id="${id}">
        ${teams().map(t=>`<option value="${t.id}" ${Number(t.id)===Number(td.id)?'selected':''}>${esc(t.name)}</option>`).join('')}
      </select>`;
  }

  function kit(p,role=''){
    return `<div class="fs30-kit-wrap">
      <div class="fs30-kit"><span>${esc(p.teamCode||'FPL')}</span>${role?`<b class="fs30-role ${role==='VC'?'vc':''}">${role}</b>`:''}</div>
    </div>`;
  }

  function contractBlock(){
    const c=window.FS30?.contract?.()||{ok:false,reason:'3.0 runtime not loaded.'};
    return `<div class="${c.ok?'fs30-contract-ok':'fs30-contract-bad'}">
      <b>${c.ok?'3.0 Production Verified':'Recommendations Withheld'}</b>
      <span>${esc(c.reason)}</span>
    </div>`;
  }

  function rankMovement(rank,last){
    rank=n(rank);last=n(last);
    if(!rank||!last)return{text:'—',cls:''};
    const d=last-rank;
    if(d>0)return{text:`↑ ${int(d)}`,cls:'fs-up'};
    if(d<0)return{text:`↓ ${int(Math.abs(d))}`,cls:'fs-down'};
    return{text:'—',cls:''};
  }

  function leagueRows(td){
    const normal=(l,scoring)=>({
      name:l.name||`League ${l.id}`,
      type:l.league_type==='x'?'Private':'Official',
      scoring,
      rank:n(l.entry_rank||l.rank),
      last:n(l.entry_last_rank),
      count:n(l.rank_count)
    });
    return [
      ...(td.entry?.leagues?.classic||[]).map(x=>normal(x,'Classic')),
      ...(td.entry?.leagues?.h2h||[]).map(x=>normal(x,'H2H'))
    ].filter(x=>x.rank>0).sort((a,b)=>a.rank-b.rank||a.name.localeCompare(b.name));
  }

  function homeMarkup(td){
    const e=td.entry||{};
    const gw=Number(state.publishedGW||e.current_event||0);
    const rows=leagueRows(td);
    const showAll=localStorage.getItem(KEYS.showAll)==='1';
    const visible=showAll?rows:rows.slice(0,8);
    return `
      <div class="fs-head">
        <div><div class="eyebrow">My FPL</div><h1>Current position</h1></div>
        <div class="fs-meta">After GW${gw||'—'}<br>latest public FPL rank</div>
      </div>
      ${picker(td,'fs30HomePicker')}
      <div class="fs-ranks">
        <div class="fs-card fs-rank primary"><div class="fs-rank-label">Overall Rank</div><div class="fs-v">${int(e.summary_overall_rank)}</div><div class="fs-s">${int(e.summary_overall_points)} total points</div></div>
        <div class="fs-card fs-rank"><div class="fs-rank-label">GW${gw} Rank</div><div class="fs-v">${int(e.summary_event_rank)}</div><div class="fs-s">${int(e.summary_event_points)} GW points</div></div>
        <div class="fs-card fs-rank"><div class="fs-rank-label">Total Points</div><div class="fs-v">${int(e.summary_overall_points)}</div><div class="fs-s">Season score</div></div>
        <div class="fs-card fs-rank"><div class="fs-rank-label">GW Points</div><div class="fs-v">${int(e.summary_event_points)}</div><div class="fs-s">Latest completed GW</div></div>
      </div>
      <div class="fs-card">
        <div class="fs-sec-head"><h2>Best league positions</h2><span>best current rank first</span></div>
        ${visible.map(l=>{const mv=rankMovement(l.rank,l.last);return `<div class="fs-league-row">
          <div class="fs-ln"><b>${esc(l.name)}</b><span>${esc(l.type)} · ${esc(l.scoring)}</span></div>
          <div class="fs-ls"><span>Position</span><b>#${int(l.rank)}</b></div>
          <div class="fs-ls"><span>Movement</span><b class="${mv.cls}">${mv.text}</b></div>
          <div class="fs-ls fs-league-total"><span>Entries</span><b>${int(l.count)}</b></div>
        </div>`}).join('')||'<div class="fs30-empty">No league ranking available.</div>'}
        ${rows.length>8?`<button class="fs-show" id="fs30ShowLeagues">${showAll?'Show best 8 only':`Show all ${rows.length} leagues`}</button>`:''}
      </div>`;
  }

  function renderHome(){
    if(!dataReady())return;
    const host=$('#overview');
    let root=$('#fsOwnerHome',host);
    if(!root){root=document.createElement('div');root.id='fsOwnerHome';host.prepend(root)}
    const td=selected(KEYS.home);if(!td)return;
    root.innerHTML=homeMarkup(td);
    $('#fs30HomePicker')?.addEventListener('change',e=>{localStorage.setItem(KEYS.home,e.target.value);renderHome()});
    $('#fs30ShowLeagues')?.addEventListener('click',()=>{
      const x=localStorage.getItem(KEYS.showAll)==='1';
      localStorage.setItem(KEYS.showAll,x?'0':'1');renderHome();
    });
  }

  function filterState(){
    const allPos=['GKP','DEF','MID','FWD'];
    const allClubs=state.teams.map(t=>t.short_name);
    const positions=loadArray(KEYS.positions,allPos);
    const clubs=loadArray(KEYS.clubs,allClubs);
    return{
      positions:positions.length?positions:allPos,
      clubs:clubs.length?clubs:allClubs,
      search:($('#fs30Search')?.value||'').trim().toLowerCase()
    };
  }

  function playerRows(){
    if(!window.FS30?.ensure?.())return contractBlock();
    const f=filterState();
    const rows=FS30.strictPlayers()
      .filter(p=>f.positions.includes(p.pos)&&f.clubs.includes(p.teamCode))
      .filter(p=>!f.search||`${p.web_name} ${p.first_name} ${p.second_name} ${p.teamCode}`.toLowerCase().includes(f.search))
      .sort((a,b)=>n(b.xp?.[0])-n(a.xp?.[0])||n(b.xmins)-n(a.xmins))
      .slice(0,100);
    return `<div class="fs-prow fs-ph"><div></div><div>Player</div><div>Price</div><div>xMins</div><div>Next GW SZxP</div></div>
      ${rows.map(p=>`<div class="fs-prow">
        ${kit(p)}
        <div class="fs-pname"><b>${esc(p.web_name)}</b><span>${esc(p.teamCode)} · ${esc(p.pos)} · ${esc((p.fixturesXP||[])[0]||'')}</span></div>
        <div class="fs-cell"><span>Price</span><b>${price(p.now_cost)}</b></div>
        <div class="fs-cell fs-mins"><span>xMins</span><b>${Math.round(n(p.xmins))}</b></div>
        <div class="fs-cell fs-xp"><span>GW${state.nextEvents[0].id} SZxP</span><b>${fmt(p.xp?.[0])}</b></div>
      </div>`).join('')||'<div class="fs30-empty">No players match these filters.</div>'}`;
  }

  function playersMarkup(){
    const savedPos=new Set(loadArray(KEYS.positions,['GKP','DEF','MID','FWD']));
    const savedClubs=new Set(loadArray(KEYS.clubs,state.teams.map(t=>t.short_name)));
    return `<div class="fs-head">
      <div><div class="eyebrow">Player Szentre · 3.0</div><h1>GW${state.nextEvents[0].id} SZxP</h1></div>
      <div class="fs-meta">Next Gameweek only<br>highest SZxP first</div>
    </div>
    <div class="fs-pcontrols">
      <input class="fs-search" id="fs30Search" placeholder="Search player or club…">
      <div class="fs-card fs-filter"><div class="fs-filtertop"><b>Positions</b><button type="button" data-all="position">All</button></div>
        <div class="fs-checks">${['GKP','DEF','MID','FWD'].map(x=>`<label class="fs-check"><input data-pos type="checkbox" value="${x}" ${savedPos.has(x)?'checked':''}><span>${x}</span></label>`).join('')}</div>
      </div>
      <div class="fs-card fs-filter"><div class="fs-filtertop"><b>Clubs</b><button type="button" data-all="club">All</button></div>
        <div class="fs-checks">${state.teams.map(t=>`<label class="fs-check"><input data-club type="checkbox" value="${t.short_name}" ${savedClubs.has(t.short_name)?'checked':''}><span>${esc(t.short_name)}</span></label>`).join('')}</div>
      </div>
    </div>
    <div class="fs-card" id="fs30PlayerRows">${playerRows()}</div>`;
  }

  function renderPlayerRows(){const box=$('#fs30PlayerRows');if(box)box.innerHTML=playerRows()}

  function renderPlayers(){
    if(!dataReady())return;
    const host=$('#players');
    let root=$('#fsPlayerClean',host);
    if(!root){root=document.createElement('div');root.id='fsPlayerClean';host.prepend(root)}
    root.innerHTML=playersMarkup();
    $('#fs30Search')?.addEventListener('input',renderPlayerRows);
    $$('[data-pos]').forEach(x=>x.addEventListener('change',()=>{saveArray(KEYS.positions,$$('[data-pos]:checked').map(y=>y.value));renderPlayerRows()}));
    $$('[data-club]').forEach(x=>x.addEventListener('change',()=>{saveArray(KEYS.clubs,$$('[data-club]:checked').map(y=>y.value));renderPlayerRows()}));
    $$('[data-all]').forEach(btn=>btn.addEventListener('click',()=>{
      const boxes=btn.dataset.all==='position'?$$('[data-pos]'):$$('[data-club]');
      boxes.forEach(x=>x.checked=true);
      saveArray(btn.dataset.all==='position'?KEYS.positions:KEYS.clubs,boxes.map(x=>x.value));
      renderPlayerRows();
    }));
  }

  function pitchPlayer(p,projection){
    const role=Number(projection.captain?.id)===Number(p.id)?'C':Number(projection.vice?.id)===Number(p.id)?'VC':'';
    return `<div class="fs30-pitch-player">${kit(p,role)}<b>${esc(p.web_name)}</b><span>${fmt(p.xp?.[0])} xP</span></div>`;
  }

  function pitch(proj){
    const groups=[1,2,3,4].map(k=>proj.xi.filter(p=>Number(p.element_type)===k));
    return `<div class="fs30-pitch">${groups.map(g=>`<div class="fs30-pitch-row">${g.map(p=>pitchPlayer(p,proj)).join('')}</div>`).join('')}</div>`;
  }

  function transferMarkup(plan){
    if(plan.action==='UNAVAILABLE')return `<div class="fs-plan-main"><b>Unavailable</b><span>${esc(plan.reason)}</span></div>`;
    if(plan.action==='ROLL')return `<div class="fs-plan-main"><b>ROLL</b><span>${esc(plan.reason)}</span></div>
      <div class="fs-plan-stats"><span class="fs-badge">${esc((plan.risk||'balanced').toUpperCase())}</span><span class="fs-badge">${plan.ft||1} FT</span></div>`;
    const b=plan.best;
    return `<div class="fs-plan-main"><b>${esc(b.route)}</b><span>${esc(plan.reason)}</span></div>
      <div class="fs-plan-stats">
        <span class="fs-badge accent">${b.nextGain>=0?'+':''}${fmt(b.nextGain)} next GW</span>
        <span class="fs-badge">${b.fourGain>=0?'+':''}${fmt(b.fourGain)} 4GW</span>
        <span class="fs-badge">${fmt(b.score,0)}/100</span>
        ${b.hit?`<span class="fs-badge danger">-${b.hit} hit</span>`:''}
      </div>`;
  }

  function chipMarkup(chip){
    return `<div class="fs-plan-main"><b>${esc(chip.action)}</b><span>${esc(chip.reason)}</span></div>
      <div class="fs-plan-stats">${Object.entries(chip.scores||{}).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<span class="fs-badge ${chip.best?.chip===k?'accent':''}">${k} ${fmt(v,0)}</span>`).join('')}</div>`;
  }

  function warnings(squad){
    return squad.filter(p=>p.status!=='a'||n(p.xmins)<58||(p.news&&String(p.news).trim()))
      .sort((a,b)=>n(a.xmins)-n(b.xmins));
  }

  function teamMarkup(td){
    if(!window.FS30?.ensure?.())return `<div class="fs-head"><div><div class="eyebrow">My Team</div><h1>GW — Plan</h1></div></div>${contractBlock()}`;
    const squad=FS30.squadFromTeam(td);
    const proj=FS30.bestXI(squad,0);
    const bench=FS30.benchOrder(squad,proj.xi);
    const transfer=FS30.commercialTransferPlan(td);
    const chip=FS30.chipPlan(td);
    const warn=warnings(squad);
    const ft=typeof inferredFreeTransfers==='function'?inferredFreeTransfers(td):'—';
    const bank=n(td.picks?.entry_history?.bank);
    return `<div class="fs-head">
      <div><div class="eyebrow">My Team · 3.0</div><h1>GW${state.nextEvents[0].id} Plan</h1></div>
      <div class="fs-meta">one page<br>no legacy recommendation</div>
    </div>
    ${picker(td,'fs30TeamPicker')}
    <div class="fs-summary">
      <div class="fs-card"><div class="fs-k">Projected</div><div class="fs-v">${fmt(proj.projectedWithCaptain)}</div><div class="fs-s">XI + captain</div></div>
      <div class="fs-card"><div class="fs-k">Free Transfers</div><div class="fs-v">${ft}</div><div class="fs-s">before suggested move</div></div>
      <div class="fs-card"><div class="fs-k">Bank</div><div class="fs-v">£${fmt(bank/10)}m</div><div class="fs-s">latest public squad</div></div>
      <div class="fs-card"><div class="fs-k">Warnings</div><div class="fs-v">${warn.length}</div><div class="fs-s">owned players to review</div></div>
    </div>

    <div class="fs-plan-grid">
      <div class="fs-card fs-plan"><div class="fs-plan-top"><div><div class="fs-k">Transfer suggestion</div><h2>${esc(transfer.action)}</h2></div><button class="fs-info" data-info="transfer">i</button></div>${transferMarkup(transfer)}</div>
      <div class="fs-card fs-plan"><div class="fs-plan-top"><div><div class="fs-k">Chip suggestion</div><h2>${esc(chip.action)}</h2></div><button class="fs-info" data-info="chip">i</button></div>${chipMarkup(chip)}</div>
    </div>

    <div class="fs-sec-head fs-no-border"><h2>Starting XI · ${esc(proj.formation)}</h2><span>C ${esc(proj.captain?.web_name||'—')} · VC ${esc(proj.vice?.web_name||'—')}</span></div>
    <div class="fs30-note">${esc(proj.captainReason||'')}</div>
    ${pitch(proj)}

    <div class="fs-card fs-bench">
      <div class="fs-sec-head"><h2>Bench order</h2><span>3.0 lineup priority</span></div>
      <div class="fs-benchgrid">${bench.map((p,i)=>`<div class="fs-bp"><div class="fs-k">${i+1}</div><b>${esc(p.web_name)}</b><span>${fmt(p.xp?.[0])} xP · ${Math.round(n(p.xmins))} xMins</span></div>`).join('')}</div>
    </div>

    <div class="fs-card fs-warning-card">
      <div class="fs-sec-head"><h2>Squad warnings</h2><span>${warn.length}</span></div>
      ${warn.map(p=>`<div class="fs-alert"><div><b>${esc(p.web_name)} · ${esc(p.teamCode)}</b><span>${esc(p.news||`${Math.round(n(p.xmins))} expected minutes`)}</span></div><span class="fs-badge ${n(p.xmins)<45?'danger':'warn'}">${Math.round(n(p.xmins))} xMins</span></div>`).join('')||'<div class="fs30-empty">No urgent warning.</div>'}
    </div>

    ${transfer.alternatives?.length?`<details class="fs-card fs-details"><summary>Other transfer options</summary>
      ${transfer.alternatives.map(a=>`<div class="fs-option"><b>${esc(a.route)}</b><span>${fmt(a.score,0)}/100</span><span>${a.nextGain>=0?'+':''}${fmt(a.nextGain)} next</span><span class="fs-four">${a.fourGain>=0?'+':''}${fmt(a.fourGain)} 4GW</span></div>`).join('')}
    </details>`:''}`;
  }

  function renderTeam(){
    if(!dataReady())return;
    const host=$('#teams');
    let root=$('#fsTeamHub',host);
    if(!root){root=document.createElement('div');root.id='fsTeamHub';host.prepend(root)}
    const td=selected(KEYS.team);if(!td)return;
    root.innerHTML=teamMarkup(td);
    $('#fs30TeamPicker')?.addEventListener('change',e=>{localStorage.setItem(KEYS.team,e.target.value);renderTeam()});
  }

  async function fetchJson(path){
    const r=await fetch(`${path}?v=${Date.now()}`,{cache:'no-store'});
    if(!r.ok)throw new Error(String(r.status));
    return r.json();
  }

  async function accuracy(){
    const target=$('#fs30Accuracy');if(!target)return;
    target.innerHTML='<div class="fs30-note">Loading genuine locked accuracy…</div>';
    const [a30,a22]=await Promise.all([
      fetchJson('data/accuracy-3.0.json').catch(()=>({gameweeks:[]})),
      fetchJson('data/accuracy-2.2.json').catch(()=>({gameweeks:[]}))
    ]);
    const last=a=>[...(a.gameweeks||[])].sort((x,y)=>n(x.gw)-n(y.gw)).at(-1)||null;
    const p=last(a30),s=last(a22);
    target.innerHTML=`<div class="fs-accgrid">
      <div class="fs-card"><div class="fs-k">3.0 Latest</div><div class="fs-v">${p?`GW${p.gw}`:'Waiting'}</div></div>
      <div class="fs-card"><div class="fs-k">3.0 Player MAE</div><div class="fs-v">${p?.relevant?.mae==null?'—':fmt(p.relevant.mae,3)}</div></div>
      <div class="fs-card"><div class="fs-k">2.2 Shadow MAE</div><div class="fs-v">${s?.relevant?.mae==null?'—':fmt(s.relevant.mae,3)}</div></div>
      <div class="fs-card"><div class="fs-k">3.0 Team MAE</div><div class="fs-v">${p?.team_mae==null?'—':fmt(p.team_mae,3)}</div></div>
    </div>`;
  }

  function moreMarkup(){
    const c=FS30?.contract?.()||{ok:false,reason:'3.0 runtime unavailable'};
    return `<div class="fs-head"><div><div class="eyebrow">More</div><h1>3.0 audit</h1></div></div>
      ${contractBlock()}
      <div class="fs-more">
        <div class="fs-card"><h2>Model comparison</h2><p>Genuine locked 3.0 accuracy versus the 2.2 shadow benchmark.</p><button class="fs-morebtn" id="fs30AccuracyBtn">View comparison</button></div>
        <div class="fs-card"><h2>Captain logic</h2><p>Highest calibrated xP wins unless the gap is within ${FS30?.captainCloseXp?.toFixed?.(2)||'0.30'} xP, where Captain Szentre resolves the close call.</p><button class="fs-morebtn" data-info="captain">Explain</button></div>
        <div class="fs-card"><h2>Testing contract</h2><p>Visible recommendations are withheld if the canonical feed is not SZxP 3.0 Commercial Core.</p><button class="fs-morebtn" data-info="contract">Explain</button></div>
        <div class="fs-card"><h2>Match Szentre</h2><p>The old Poisson exact-score model is removed from this test surface because it was not part of production 3.0.</p><button class="fs-morebtn" data-info="match">Why?</button></div>
      </div>
      <div class="fs-acc" id="fs30Accuracy"></div>`;
  }

  function renderMore(){
    if(!dataReady())return;
    const root=$('#more');if(!root)return;
    root.innerHTML=moreMarkup();
    $('#fs30AccuracyBtn')?.addEventListener('click',accuracy);
  }

  function installModal(){
    if($('#fs30Modal'))return;
    const m=document.createElement('div');m.id='fs30Modal';m.className='fs-modal';
    m.innerHTML=`<div class="fs-modalbox"><div class="fs-modalhead"><h2 id="fs30ModalTitle"></h2><button class="fs-close" id="fs30ModalClose">×</button></div><p id="fs30ModalBody"></p></div>`;
    document.body.appendChild(m);
    $('#fs30ModalClose').addEventListener('click',()=>m.classList.remove('open'));
    m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('open')});
  }

  function info(key){
    const map={
      transfer:['Transfer Szentre 3.0','Route search uses the current 3.0 player projections. The final action is scored with Commercial Transfer Szentre: next-GW gain, four-GW gain, hit cost, fixture swing, minutes/availability and squad flexibility. ROLL is a valid answer.'],
      chip:['Chip Szentre 3.0','Wildcard, Free Hit, Bench Boost and Triple Captain are scored separately using the commercial chip weights. Only the strongest opportunity is allowed, and NO CHIP remains valid if nothing clears the play threshold.'],
      captain:['Captain selection','Captaincy doubles one player’s actual FPL points, so calibrated next-GW xP is the primary decision. Captain Szentre is a close-call quality check, not a licence to ignore a clearly higher xP.'],
      contract:['3.0 testing contract','The owner test surface does not silently fall back to 2.2, 2.1 or FPL ep_next. If the canonical production metadata is not SZxP 3.0 Commercial Core, recommendations are withheld.'],
      match:['Why Match Szentre is hidden','The previous match exact-score tool used a separate FPL-strength + Poisson model and was not production SZxP 3.0. Keeping it visible would make your launch test a mixed-model test, so it is intentionally removed until a proper 3.0 match engine is defined.']
    };
    return map[key]||['Fantaszy Szentre','Extra detail is kept here so the weekly UI stays clean.'];
  }

  function showInfo(key){
    installModal();
    const [t,b]=info(key);
    $('#fs30ModalTitle').textContent=t;$('#fs30ModalBody').textContent=b;$('#fs30Modal').classList.add('open');
  }

  function renderAll(){
    if(!dataReady())return false;
    window.FS30?.ensure?.();
    renderHome();renderPlayers();renderTeam();renderMore();
    return true;
  }

  document.body.addEventListener('click',e=>{
    const i=e.target.closest('[data-info]');if(i)showInfo(i.dataset.info);
  });

  let lastStamp='';
  const boot=setInterval(()=>{
    if(!dataReady())return;
    const stamp=`${state.meta?.updated_at_utc||''}:${state.teamData.filter(x=>x.ok).length}`;
    if(stamp!==lastStamp){
      lastStamp=stamp;
      renderAll();
    }
  },700);
  setTimeout(()=>clearInterval(boot),20000);

  const steady=setInterval(()=>{
    if(!dataReady())return;
    const stamp=`${state.meta?.updated_at_utc||''}:${state.teamData.filter(x=>x.ok).length}`;
    if(stamp!==lastStamp){lastStamp=stamp;renderAll()}
  },5000);

  $('#refreshBtn')?.addEventListener('click',()=>setTimeout(()=>{lastStamp='';renderAll()},1500));

  installModal();
  window.FSOwner30={version:VERSION,render:renderAll};
})();
