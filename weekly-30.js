
(() => {
  'use strict';

  const BUDGET = 1000;
  const POS_COUNTS = {1:2,2:5,3:5,4:3};
  const SLOT_ORDER = [1,1,2,2,2,2,2,3,3,3,3,3,4,4,4];
  const CACHE = new Map();
  const BUILD_KEY = 'fs30:weeklyClubs';
  const n = v => Number(v || 0);
  const esc = (s='') => String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const fmt = (v,d=1) => n(v).toFixed(d);
  const xp = (p,h=0) => n(p?.xp?.[h]);
  const cost = p => n(p?.now_cost);
  const pos = p => Number(p?.element_type || 0);

  const PROFILES = [
    {key:'optimal', label:'Optimal', ceiling:0, safety:0, diversity:0},
    {key:'ceiling', label:'Ceiling', ceiling:.10, safety:0, diversity:.20},
    {key:'safe', label:'Minutes-safe', ceiling:0, safety:.08, diversity:.28},
    {key:'alt-a', label:'Alternative A', ceiling:.04, safety:.03, diversity:.62},
    {key:'alt-b', label:'Alternative B', ceiling:.06, safety:.01, diversity:.88},
  ];

  function ready() {
    return Boolean(window.FS30?.ensure?.() && state?.nextEvents?.length);
  }

  function allClubIds() {
    return state.teams.map(t=>Number(t.id));
  }

  function savedClubs() {
    try {
      const x = JSON.parse(localStorage.getItem(BUILD_KEY) || '[]');
      return Array.isArray(x) && x.length ? x.map(Number) : allClubIds();
    } catch {
      return allClubIds();
    }
  }

  function saveClubs(ids) {
    try { localStorage.setItem(BUILD_KEY, JSON.stringify(ids)); } catch {}
  }

  function legalPool(teamIds) {
    const allowed = new Set((teamIds || []).map(Number));
    return FS30.strictPlayers().filter(p =>
      allowed.has(Number(p.team)) &&
      p.status !== 'u' &&
      n(p.xmins) >= 20 &&
      xp(p,0) > 0 &&
      cost(p) > 0
    );
  }

  function profileScore(p, profile, exposure={}, mode='next') {
    const base = mode === '4gw' ? n(p.xp4) : xp(p,0);
    const ceilingGap = Math.max(0,n(p.ceiling)-xp(p,0));
    const safety = Math.max(0,Math.min(1,n(p.xmins)/90));
    return base
      + profile.ceiling*ceilingGap
      + profile.safety*safety*2.2
      - profile.diversity*n(exposure[p.id])*0.32;
  }

  function candidatePools(teamIds, profile, exposure, mode) {
    const pool = legalPool(teamIds);
    const out = {};
    for (const k of [1,2,3,4]) {
      const arr = pool.filter(p=>pos(p)===k);
      const best = [...arr].sort((a,b)=>profileScore(b,profile,exposure,mode)-profileScore(a,profile,exposure,mode)).slice(0,20);
      const cheap = [...arr].sort((a,b)=>cost(a)-cost(b) || profileScore(b,profile,exposure,mode)-profileScore(a,profile,exposure,mode)).slice(0,8);
      const map = new Map();
      [...best,...cheap].forEach(p=>map.set(Number(p.id),p));
      out[k] = [...map.values()];
    }
    return out;
  }

  function feasible(teamIds) {
    const ids = [...new Set((teamIds||[]).map(Number))];
    if (ids.length < 5) return 'Select at least 5 clubs.';
    const pool = legalPool(ids);
    for (const [k,count] of Object.entries(POS_COUNTS)) {
      if (pool.filter(p=>pos(p)===Number(k)).length < count) return 'Not enough eligible players for a legal 15.';
    }
    return '';
  }

  function minRemainingCost(slot, pools) {
    let total=0;
    for (const k of SLOT_ORDER.slice(slot)) {
      if (!pools[k]?.length) return Infinity;
      total += Math.min(...pools[k].map(cost));
    }
    return total;
  }

  function evaluate(ids, profile, exposure={}, priorXis=[], mode='next') {
    const players = ids.map(id=>state.players.find(p=>Number(p.id)===Number(id))).filter(Boolean);
    if (players.length !== 15) return null;

    if (mode === '4gw') {
      const score = players.reduce((s,p)=>s+n(p.xp4),0);
      return {players, ids, objective:score, projected:score, cost:players.reduce((s,p)=>s+cost(p),0)};
    }

    const lineup = FS30.bestXI(players,0);
    if (lineup.xi.length !== 11 || !lineup.captain) return null;

    const ceilingLift = lineup.xi.reduce((s,p)=>s+Math.max(0,n(p.ceiling)-xp(p,0)),0);
    const safeLift = lineup.xi.reduce((s,p)=>s+Math.max(0,Math.min(1,n(p.xmins)/90)),0);
    const exposureCost = lineup.xi.reduce((s,p)=>s+n(exposure[p.id]),0);

    let overlapPenalty=0;
    for (const prior of priorXis) {
      const set = new Set(prior);
      const overlap = lineup.xi.reduce((s,p)=>s+(set.has(Number(p.id))?1:0),0);
      overlapPenalty += Math.max(0,overlap-8)*1.2;
    }

    const projected = n(lineup.projectedWithCaptain);
    const objective = projected
      + profile.ceiling*ceilingLift
      + profile.safety*safeLift*.75
      - profile.diversity*exposureCost*.35
      - profile.diversity*overlapPenalty;

    const xiIds = new Set(lineup.xi.map(p=>Number(p.id)));
    const bench = FS30.benchOrder(players,lineup.xi);
    return {
      players, ids, xi:lineup.xi, bench,
      captain:lineup.captain, vice:lineup.vice,
      captainReason:lineup.captainReason,
      formation:lineup.formation,
      projected, objective,
      cost:players.reduce((s,p)=>s+cost(p),0)
    };
  }

  function build(teamIds, profile=PROFILES[0], exposure={}, priorXis=[], floor=-Infinity, mode='next') {
    const err = feasible(teamIds);
    if (err) return {error:err};

    const pools = candidatePools(teamIds,profile,exposure,mode);
    let beam = [{ids:[],cost:0,clubs:{},score:0}];
    const BEAM=90;

    for (let slot=0; slot<SLOT_ORDER.length; slot++) {
      const k = SLOT_ORDER[slot];
      const children=[];
      const minRemain = minRemainingCost(slot+1,pools);

      for (const st of beam) {
        const owned = new Set(st.ids);
        for (const p of pools[k]) {
          if (owned.has(Number(p.id))) continue;
          if ((st.clubs[p.team]||0)>=3) continue;
          const newCost=st.cost+cost(p);
          if (newCost>BUDGET || newCost+minRemain>BUDGET) continue;
          children.push({
            ids:[...st.ids,Number(p.id)],
            cost:newCost,
            clubs:{...st.clubs,[p.team]:(st.clubs[p.team]||0)+1},
            score:st.score+profileScore(p,profile,exposure,mode)
          });
        }
      }

      if (!children.length) return {error:'No legal squad found within £100.0m.'};
      const dedup=new Map();
      for (const c of children) {
        const key=[...c.ids].sort((a,b)=>a-b).join(',');
        const prev=dedup.get(key);
        if (!prev || c.score>prev.score) dedup.set(key,c);
      }
      beam=[...dedup.values()].sort((a,b)=>b.score-a.score).slice(0,BEAM);
    }

    const evaluated=beam.map(s=>evaluate(s.ids,profile,exposure,priorXis,mode)).filter(Boolean);
    const allowed=evaluated.filter(x=>n(x.projected)>=floor);
    return (allowed.length?allowed:evaluated).sort((a,b)=>b.objective-a.objective)[0] || {error:'Could not evaluate the squad.'};
  }

  function getBest15(mode='next') {
    if (!ready()) return null;
    const stamp = `${state.meta?.updated_at_utc || ''}:${mode}`;
    if (CACHE.has(stamp)) return CACHE.get(stamp);
    const result = build(allClubIds(),PROFILES[0],{},[],-Infinity,mode);
    CACHE.clear();
    CACHE.set(stamp,result);
    return result;
  }

  function exposureAdd(exp,squad) {
    if (!squad?.xi) return;
    const xi = new Set(squad.xi.map(p=>Number(p.id)));
    squad.players.forEach(p=>exp[p.id]=n(exp[p.id])+(xi.has(Number(p.id))?.9:.15));
    if (squad.captain) exp[squad.captain.id]=n(exp[squad.captain.id])+1.1;
  }

  function buildFive(teamIds) {
    const optimal=build(teamIds,PROFILES[0],{},[],-Infinity,'next');
    if (optimal.error) return {error:optimal.error,squads:[]};
    const floor=n(optimal.projected)-2.25;
    const exp={};
    const prior=[];
    const squads=[{profile:PROFILES[0],squad:optimal}];
    exposureAdd(exp,optimal);
    prior.push(optimal.xi.map(p=>Number(p.id)));

    for (const profile of PROFILES.slice(1)) {
      const s=build(teamIds,profile,exp,prior,floor,'next');
      if (s.error) return {error:s.error,squads};
      squads.push({profile,squad:s});
      exposureAdd(exp,s);
      prior.push(s.xi.map(p=>Number(p.id)));
    }
    return {squads};
  }

  function jersey(p,role='') {
    return `<div class="fs30-kit-wrap">
      <div class="fs30-kit">
        <span>${esc(p.teamCode || 'FPL')}</span>
        ${role?`<b class="fs30-role ${role==='VC'?'vc':''}">${role}</b>`:''}
      </div>
    </div>`;
  }

  function pitchPlayer(p,squad) {
    const role = Number(squad.captain?.id)===Number(p.id) ? 'C' : Number(squad.vice?.id)===Number(p.id) ? 'VC' : '';
    return `<div class="fs30-pitch-player">
      ${jersey(p,role)}
      <b>${esc(p.web_name)}</b>
      <span>${fmt(xp(p,0))} xP</span>
    </div>`;
  }

  function pitch(squad) {
    if (!squad || squad.error) return `<div class="fs30-empty">${esc(squad?.error || 'No squad')}</div>`;
    const groups=[1,2,3,4].map(k=>squad.xi.filter(p=>pos(p)===k));
    return `<div class="fs30-pitch">
      ${groups.map(g=>`<div class="fs30-pitch-row">${g.map(p=>pitchPlayer(p,squad)).join('')}</div>`).join('')}
    </div>`;
  }

  function bench(squad) {
    return `<div class="fs30-bench">
      ${(squad.bench||[]).map((p,i)=>`<div><span>${i+1}</span><b>${esc(p.web_name)}</b><small>${fmt(xp(p,0))} xP</small></div>`).join('')}
    </div>`;
  }

  function best15Markup() {
    const s=getBest15('next');
    if (!s) return `<div class="fs30-contract-bad">Waiting for verified 3.0 production data.</div>`;
    if (s.error) return `<div class="fs30-contract-bad">${esc(s.error)}</div>`;
    return `
      <div class="fs30-week-summary">
        <div><span>Projected</span><b>${fmt(s.projected)}</b></div>
        <div><span>Cost</span><b>£${fmt(s.cost/10)}m</b></div>
        <div><span>Formation</span><b>${esc(s.formation)}</b></div>
        <div><span>Captain</span><b>${esc(s.captain?.web_name || '—')}</b></div>
      </div>
      <div class="fs30-note">Captain = highest calibrated 3.0 SZxP, with Captain Szentre used only when the xP gap is within ${FS30.captainCloseXp.toFixed(2)}.</div>
      ${pitch(s)}
      <div class="fs30-section-title"><b>Bench</b><span>3.0 lineup order</span></div>
      ${bench(s)}
    `;
  }

  function clubSelector() {
    const selected=new Set(savedClubs());
    return `<div class="fs30-clubs">
      ${state.teams.map(t=>`<label>
        <input class="fs30-club-check" type="checkbox" value="${t.id}" ${selected.has(Number(t.id))?'checked':''}>
        <span>${esc(t.short_name)}</span>
      </label>`).join('')}
    </div>`;
  }

  function buildFiveMarkup() {
    return `
      <div class="fs30-builder-actions">
        <button type="button" id="fs30AllClubs">Select all</button>
        <button type="button" id="fs30ClearClubs">Clear</button>
        <button type="button" class="primary" id="fs30BuildFive">Build 5</button>
      </div>
      ${clubSelector()}
      <div id="fs30FiveResults" class="fs30-five-results">
        <div class="fs30-note">Pick eligible clubs, then build five 3.0 squads. Option 1 is pure projected points; the others diversify without dropping more than 2.25 xP where possible.</div>
      </div>
    `;
  }

  function fiveResults(result) {
    if (result.error) return `<div class="fs30-contract-bad">${esc(result.error)}</div>`;
    return result.squads.map((x,i)=>{
      const s=x.squad;
      return `<details class="fs30-option" ${i===0?'open':''}>
        <summary>
          <div><span>Option ${i+1} · ${esc(x.profile.label)}</span><b>${fmt(s.projected)} projected</b></div>
          <small>C ${esc(s.captain?.web_name || '—')} · £${fmt(s.cost/10)}m</small>
        </summary>
        <div class="fs30-option-body">${pitch(s)}${bench(s)}</div>
      </details>`;
    }).join('');
  }

  function render(tab='best') {
    const root=document.getElementById('weekly');
    if (!root) return;
    if (!ready()) {
      root.innerHTML=`<div class="fs-head"><div><div class="eyebrow">Weekly Szentre</div><h1>GW —</h1></div></div><div class="fs30-contract-bad">${esc(FS30?.contract?.().reason || 'Waiting for 3.0')}</div>`;
      return;
    }
    const gw=Number(state.nextEvents?.[0]?.id || 0);
    root.innerHTML=`
      <div class="fs-head">
        <div><div class="eyebrow">Weekly Szentre · 3.0</div><h1>GW${gw} Weekly Lab</h1></div>
        <div class="fs-meta">Only production 3.0<br>no legacy match model</div>
      </div>
      <div class="fs30-tabs">
        <button type="button" data-fs30-tab="best" class="${tab==='best'?'active':''}">Best 15</button>
        <button type="button" data-fs30-tab="five" class="${tab==='five'?'active':''}">Build 5</button>
      </div>
      <div class="fs30-tab-panel">${tab==='best'?best15Markup():buildFiveMarkup()}</div>
    `;
    root.querySelectorAll('[data-fs30-tab]').forEach(b=>b.addEventListener('click',()=>render(b.dataset.fs30Tab)));
    if (tab==='five') wireBuilder();
  }

  function wireBuilder() {
    const root=document.getElementById('weekly');
    const selected=()=>[...root.querySelectorAll('.fs30-club-check:checked')].map(x=>Number(x.value));
    root.querySelectorAll('.fs30-club-check').forEach(x=>x.addEventListener('change',()=>saveClubs(selected())));
    root.querySelector('#fs30AllClubs')?.addEventListener('click',()=>{
      root.querySelectorAll('.fs30-club-check').forEach(x=>x.checked=true);
      saveClubs(selected());
    });
    root.querySelector('#fs30ClearClubs')?.addEventListener('click',()=>{
      root.querySelectorAll('.fs30-club-check').forEach(x=>x.checked=false);
      saveClubs([]);
    });
    root.querySelector('#fs30BuildFive')?.addEventListener('click',()=>{
      const ids=selected();
      saveClubs(ids);
      const target=root.querySelector('#fs30FiveResults');
      target.innerHTML='<div class="fs30-note">Building five 3.0 squads…</div>';
      setTimeout(()=>{
        const result=buildFive(ids);
        target.innerHTML=fiveResults(result);
      },20);
    });
  }

  let lastStamp='';
  function boot() {
    if (!ready()) return false;
    const stamp=state.meta?.updated_at_utc || '';
    if (stamp!==lastStamp || !document.getElementById('weekly')?.querySelector('.fs30-tabs')) {
      lastStamp=stamp;
      render('best');
    }
    return true;
  }

  const wait=setInterval(()=>{ if (boot()) clearInterval(wait); },200);
  setTimeout(()=>clearInterval(wait),20000);
  document.getElementById('refreshBtn')?.addEventListener('click',()=>setTimeout(()=>{lastStamp='';boot()},1400));

  window.FSWeekly30 = {
    version:'20260909-weekly30-1',
    getBest15,
    buildFive,
    render,
  };
})();
