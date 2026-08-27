// Fantaszy Szentre — Weekly Lineup Builder
// Best legal 15 for the next GW + five diversified squads from user-selected eligible clubs.
(() => {
  const BUDGET = 1000; // £100.0m in FPL tenths
  const POS_COUNTS = {1:2, 2:5, 3:5, 4:3};
  const POS_NAME = {1:'GKP', 2:'DEF', 3:'MID', 4:'FWD'};
  const SLOT_ORDER = [1,1,2,2,2,2,2,3,3,3,3,3,4,4,4];
  const PROFILES = [
    {key:'optimal', label:'Optimal', copy:'Highest modelled next-GW score.', xp:1.00, ceiling:.03, safety:.03, diff:0, value:.08, diversity:.30, bench:.05},
    {key:'ceiling', label:'Ceiling', copy:'More upside for a weekly-prize swing.', xp:.90, ceiling:.26, safety:.01, diff:.03, value:.05, diversity:.65, bench:.03},
    {key:'safe', label:'Safe', copy:'Prioritises xMins and role security.', xp:.94, ceiling:.03, safety:.22, diff:0, value:.06, diversity:.75, bench:.06},
    {key:'differential', label:'Differential', copy:'Lower-owned upside without abandoning SZxP.', xp:.86, ceiling:.14, safety:.03, diff:.24, value:.05, diversity:.95, bench:.03},
    {key:'contrarian', label:'Contrarian', copy:'The strongest deliberate diversification route.', xp:.78, ceiling:.22, safety:.01, diff:.34, value:.04, diversity:1.35, bench:.02},
  ];
  const BEST_PROFILE = {key:'best', label:'Best 15', copy:'Pure next-GW model route.', xp:1.00, ceiling:.02, safety:.03, diff:0, value:.08, diversity:0, bench:.06};

  let lastBuild = null;
  let best15Cache = null;
  let isBuilding = false;

  const gw = () => Number(state.nextEvents?.[0]?.id || 0);
  const px = p => Number(p?.xp?.[0] || 0);
  const pcost = p => Number(p?.now_cost || 0);
  const own = p => Number(p?.selected_by_percent || 0);
  const safety = p => {
    let v = Math.max(0, Math.min(1, Number(p?.xmins || 0) / 90));
    if (p?.confidence === 'High') v += .18;
    else if (p?.confidence === 'Low') v -= .18;
    if (p?.status !== 'a') v -= .35;
    return v;
  };
  const diffBonus = p => Math.max(0, Math.min(1, (10 - own(p)) / 10));
  const ceilingGap = p => Math.max(0, Number(p?.ceiling || px(p)) - px(p));
  const valueScore = p => px(p) / Math.max(4, pcost(p)/10);

  function profilePlayerScore(p, profile, exposure={}) {
    return profile.xp*px(p)
      + profile.ceiling*ceilingGap(p)
      + profile.safety*safety(p)*2.2
      + profile.diff*diffBonus(p)*2.8
      + profile.value*valueScore(p)
      - profile.diversity*Number(exposure[p.id] || 0)*.32;
  }

  function legalPool(teamIds) {
    const ids = new Set(teamIds.map(Number));
    return state.players.filter(p =>
      ids.has(Number(p.team)) &&
      p.status !== 'u' &&
      Number(p.xmins || 0) >= 20 &&
      px(p) > 0 &&
      pcost(p) > 0
    );
  }

  function candidatePools(teamIds, profile, exposure) {
    const pool = legalPool(teamIds);
    const out = {};
    for (const pos of [1,2,3,4]) {
      const arr = pool.filter(p => Number(p.element_type) === pos);
      const best = [...arr].sort((a,b)=>profilePlayerScore(b,profile,exposure)-profilePlayerScore(a,profile,exposure)).slice(0,18);
      const cheap = [...arr].sort((a,b)=>pcost(a)-pcost(b) || px(b)-px(a)).slice(0,7);
      const xps = [...arr].sort((a,b)=>px(b)-px(a)).slice(0,7);
      const map = new Map();
      [...best,...cheap,...xps].forEach(p=>map.set(p.id,p));
      out[pos] = [...map.values()];
    }
    return out;
  }

  function feasibility(teamIds) {
    const unique = [...new Set(teamIds.map(Number))];
    if (unique.length < 5) return 'Select at least 5 eligible clubs. With max 3 players per club, fewer than 5 clubs cannot produce a 15-player squad.';
    const pool = legalPool(unique);
    for (const [pos,count] of Object.entries(POS_COUNTS)) {
      const n = pool.filter(p=>Number(p.element_type)===Number(pos)).length;
      if (n < count) return `Not enough eligible ${POS_NAME[pos]} players to build a legal squad.`;
    }
    return '';
  }

  function minRemainingCost(slotIndex, pools) {
    const remain = SLOT_ORDER.slice(slotIndex);
    let total = 0;
    for (const pos of remain) {
      const arr = pools[pos] || [];
      if (!arr.length) return Infinity;
      total += Math.min(...arr.map(p=>pcost(p)));
    }
    return total;
  }

  function clubCounts(ids) {
    const c = {};
    ids.forEach(id=>{
      const p = state.players.find(x=>x.id===id);
      if (p) c[p.team]=(c[p.team]||0)+1;
    });
    return c;
  }

  function captainMetric(p, profile) {
    return profile.xp*px(p)
      + profile.ceiling*Math.max(0, Number(p.ceiling||px(p))-px(p))
      + profile.safety*safety(p)*.8
      + profile.diff*diffBonus(p)*.7;
  }

  function evaluateSquad(ids, profile, exposure={}, previousXIs=[]) {
    const players = ids.map(id=>state.players.find(p=>p.id===id)).filter(Boolean);
    if (players.length !== 15) return null;
    const nextGw = gw();
    const best = legalBestXIAt(players,nextGw);
    const xi = best.xi || [];
    if (xi.length !== 11) return null;

    const capRank = [...xi].sort((a,b)=>captainMetric(b,profile)-captainMetric(a,profile));
    const captain = capRank[0];
    const vice = capRank[1];
    const actualProjected = Number(best.total||0) + (captain ? px(captain) : 0);

    const xiSet = new Set(xi.map(p=>p.id));
    const bench = players.filter(p=>!xiSet.has(p.id)).sort((a,b)=>px(b)-px(a));
    const ceilingLift = xi.reduce((s,p)=>s+ceilingGap(p),0) + (captain?ceilingGap(captain):0);
    const safeLift = xi.reduce((s,p)=>s+safety(p),0);
    const diffLift = xi.reduce((s,p)=>s+diffBonus(p),0);
    const benchXP = bench.reduce((s,p)=>s+px(p),0);
    const exposureCost = xi.reduce((s,p)=>s+Number(exposure[p.id]||0),0);

    let overlapPenalty = 0;
    for (const prev of previousXIs) {
      const prevSet = new Set(prev);
      const overlap = xi.reduce((n,p)=>n+(prevSet.has(p.id)?1:0),0);
      overlapPenalty += Math.max(0, overlap-8) * 1.8; // aim for at least 3 XI differences
    }

    const objective = actualProjected
      + profile.ceiling*ceilingLift
      + profile.safety*safeLift*1.15
      + profile.diff*diffLift*1.8
      + profile.bench*benchXP
      - profile.diversity*exposureCost*.55
      - overlapPenalty*profile.diversity;

    const cost = players.reduce((s,p)=>s+pcost(p),0);
    return {ids, players, xi, bench, captain, vice, formation:best.formation, projected:actualProjected, objective, cost};
  }

  function buildSquad(teamIds, profile, exposure={}, previousXIs=[]) {
    const error = feasibility(teamIds);
    if (error) return {error};

    const pools = candidatePools(teamIds,profile,exposure);
    let beam = [{ids:[], cost:0, clubs:{}, score:0}];
    const BEAM = 80;

    for (let slot=0; slot<SLOT_ORDER.length; slot++) {
      const pos = SLOT_ORDER[slot];
      const children = [];
      const minRemain = minRemainingCost(slot+1,pools);

      for (const st of beam) {
        const owned = new Set(st.ids);
        for (const p of pools[pos]) {
          if (owned.has(p.id)) continue;
          if ((st.clubs[p.team]||0) >= 3) continue;
          const newCost = st.cost + pcost(p);
          if (newCost > BUDGET) continue;
          if (newCost + minRemain > BUDGET) continue;

          const clubs = {...st.clubs, [p.team]:(st.clubs[p.team]||0)+1};
          const score = st.score + profilePlayerScore(p,profile,exposure);
          children.push({ids:[...st.ids,p.id], cost:newCost, clubs, score});
        }
      }

      if (!children.length) return {error:'No legal squad could be built from those eligible clubs within the £100.0m budget.'};

      const dedup = new Map();
      for (const c of children) {
        const key = c.ids.slice().sort((a,b)=>a-b).join(',');
        const prev = dedup.get(key);
        if (!prev || c.score > prev.score) dedup.set(key,c);
      }
      beam = [...dedup.values()].sort((a,b)=>b.score-a.score).slice(0,BEAM);
    }

    const evaluated = beam.map(st=>evaluateSquad(st.ids,profile,exposure,previousXIs)).filter(Boolean).sort((a,b)=>b.objective-a.objective);
    return evaluated[0] || {error:'Could not evaluate a legal squad.'};
  }

  function updateExposure(exposure, squad) {
    const xiIds = new Set(squad.xi.map(p=>p.id));
    squad.players.forEach(p => {
      exposure[p.id] = Number(exposure[p.id]||0) + (xiIds.has(p.id)?.9:.18);
    });
    if (squad.captain) exposure[squad.captain.id] = Number(exposure[squad.captain.id]||0) + 1.2;
    return exposure;
  }

  function benchOrder(squad) {
    const gk = squad.bench.filter(p=>Number(p.element_type)===1);
    const outfield = squad.bench.filter(p=>Number(p.element_type)!==1).sort((a,b)=>px(b)-px(a));
    return [...outfield,...gk];
  }

  function playerRoleBadge(p,squad) {
    if (squad.captain?.id===p.id) return 'C';
    if (squad.vice?.id===p.id) return 'VC';
    return '';
  }

  function squadTable(squad) {
    const xiSet = new Set(squad.xi.map(p=>p.id));
    const bench = benchOrder(squad);
    const ordered = [
      ...squad.xi.sort((a,b)=>Number(a.element_type)-Number(b.element_type) || px(b)-px(a)),
      ...bench
    ];
    return `<div class="table-wrap"><table>
      <thead><tr><th>Role</th><th>Player</th><th>Club</th><th>Price</th><th>Own</th><th>xMins</th><th>GW xP</th></tr></thead>
      <tbody>${ordered.map(p=>{
        const role = xiSet.has(p.id) ? `XI${playerRoleBadge(p,squad)?' · '+playerRoleBadge(p,squad):''}` : 'BENCH';
        return `<tr>
          <td><span class="badge ${xiSet.has(p.id)?'buy':'watch'}">${role}</span></td>
          <td><b>${esc(p.web_name)}</b><div class="team-code">${p.pos}</div></td>
          <td>${esc(p.teamCode)}</td>
          <td>${money(p.now_cost)}</td>
          <td>${fmt(p.selected_by_percent)}%</td>
          <td>${p.xmins}</td>
          <td class="xp">${fmt(px(p))}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  function squadSummary(squad, label, copy, open=false) {
    if (squad.error) return `<div class="notice warn">${esc(squad.error)}</div>`;
    const owned = squad.players.reduce((s,p)=>s+pcost(p),0);
    return `<details class="card" ${open?'open':''} style="margin-top:14px">
      <summary style="cursor:pointer;list-style:none">
        <div class="section-head" style="margin-bottom:0">
          <div><div class="eyebrow">${esc(label)}</div><h2 style="margin-top:5px">${fmt(squad.projected)} projected points</h2></div>
          <div class="stat-note" style="text-align:right">£${fmt(owned/10)}m · ${esc(squad.formation)}<br>C ${esc(squad.captain?.web_name||'—')} · VC ${esc(squad.vice?.web_name||'—')}</div>
        </div>
        <p class="subtext" style="margin:8px 0 0">${esc(copy)}</p>
      </summary>
      <div style="margin-top:14px">${squadTable(squad)}</div>
    </details>`;
  }

  function selectedClubIds() {
    return [...document.querySelectorAll('.weekly-club-check:checked')].map(x=>Number(x.value));
  }

  function persistSelection(ids) {
    try { localStorage.setItem('fs:weeklyEligibleClubs', JSON.stringify(ids)); } catch {}
  }

  function savedSelection() {
    try {
      const x = JSON.parse(localStorage.getItem('fs:weeklyEligibleClubs')||'[]');
      return Array.isArray(x) ? x.map(Number) : [];
    } catch { return []; }
  }

  function clubSelectorMarkup() {
    const saved = new Set(savedSelection());
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-top:12px">
      ${state.teams.map(t=>`<label class="card" style="padding:10px 12px;display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" class="weekly-club-check" value="${t.id}" ${saved.has(Number(t.id))?'checked':''}>
        <span><b>${esc(t.short_name||t.name)}</b><div class="team-code">${esc(t.name)}</div></span>
      </label>`).join('')}
    </div>`;
  }

  function buildFive(teamIds) {
    const error = feasibility(teamIds);
    if (error) return {error, squads:[]};

    const exposure = {};
    const prev = [];
    const squads = [];
    for (const profile of PROFILES) {
      const squad = buildSquad(teamIds,profile,exposure,prev);
      if (squad.error) return {error:squad.error,squads};
      squads.push({profile,squad});
      prev.push(squad.xi.map(p=>p.id));
      updateExposure(exposure,squad);
    }
    return {squads};
  }

  function allClubIds() {
    return state.teams.map(t=>Number(t.id));
  }

  function renderBest15() {
    const target = document.getElementById('weeklyBest15');
    if (!target) return;
    if (!best15Cache || best15Cache.gw !== gw() || best15Cache.stamp !== state.meta?.updated_at_utc) {
      const squad = buildSquad(allClubIds(),BEST_PROFILE,{},[]);
      best15Cache = {gw:gw(), stamp:state.meta?.updated_at_utc, squad};
    }
    const s = best15Cache.squad;
    target.innerHTML = squadSummary(
      s,
      `Best 15 · GW${gw()}`,
      'A legal £100.0m FPL squad from the full player pool: 2 GKP, 5 DEF, 5 MID, 3 FWD and max 3 per club. Starting XI and captain are optimised for this Gameweek.',
      true
    );
  }

  function renderBuiltFive(result, ids) {
    const target = document.getElementById('weeklyFiveResults');
    if (!target) return;
    if (result.error) {
      target.innerHTML = `<div class="notice warn">${esc(result.error)}</div>`;
      return;
    }
    const names = ids.map(id=>state.teams.find(t=>Number(t.id)===Number(id))?.short_name).filter(Boolean).join(', ');
    target.innerHTML = `
      <div class="notice">Eligible clubs: ${esc(names)}. Five squads use the same legal FPL rules but different risk profiles and an explicit overlap penalty to diversify your winning routes. Strong core picks may still repeat when the model edge is large.</div>
      ${result.squads.map((x,i)=>squadSummary(x.squad,`Option ${i+1} · ${x.profile.label}`,x.profile.copy,i===0)).join('')}
    `;
  }

  function renderWeeklyShell() {
    const root = document.getElementById('weekly');
    if (!root) return;
    root.innerHTML = `
      <div class="hero">
        <div class="eyebrow">Weekly Szentre</div>
        <h1>Build the team to win this Gameweek.</h1>
        <p class="subtext">See the model's best legal 15 for GW${gw()}, or restrict the eligible clubs and generate five diversified 15-player squads for a weekly mini-league.</p>
      </div>

      <div id="weeklyBest15"><div class="skeleton"></div></div>

      <div class="section card">
        <div class="section-head"><h2>Eligible-Club Weekly Builder</h2><span class="stat-note">5 diversified squads</span></div>
        <div class="notice">Standard FPL squad rules are enforced: £100.0m budget, 15 players (2 GKP / 5 DEF / 5 MID / 3 FWD), max 3 players from one club, legal starting XI, captain and vice-captain.</div>
        <p class="subtext" style="margin-top:14px">Tick only the Premier League clubs that your weekly league allows.</p>
        <div class="controls" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:0">
          <button class="icon-button" id="weeklySelectAll" style="width:auto;padding:0 14px">Select all</button>
          <button class="icon-button" id="weeklyClear" style="width:auto;padding:0 14px">Clear</button>
          <button class="icon-button" id="weeklyBuildFive" style="width:auto;padding:0 14px;border-color:rgba(85,230,165,.35);color:var(--accent)">Build 5 teams</button>
        </div>
        ${clubSelectorMarkup()}
        <div id="weeklySelectionCount" class="model-note"></div>
      </div>

      <div id="weeklyFiveResults" class="section"></div>
      <p class="model-note">These are SZxP model recommendations, not guaranteed outcomes. The five-team builder deliberately trades a small amount of model-optimal similarity for portfolio diversification.</p>
    `;
    wireWeekly();
    updateSelectionCount();
    setTimeout(renderBest15,40);
  }

  function updateSelectionCount() {
    const el = document.getElementById('weeklySelectionCount');
    if (el) el.textContent = `${selectedClubIds().length} eligible clubs selected`;
  }

  function wireWeekly() {
    document.querySelectorAll('.weekly-club-check').forEach(x=>x.addEventListener('change',()=>{
      const ids=selectedClubIds();
      persistSelection(ids);
      updateSelectionCount();
    }));

    document.getElementById('weeklySelectAll')?.addEventListener('click',()=>{
      document.querySelectorAll('.weekly-club-check').forEach(x=>x.checked=true);
      persistSelection(selectedClubIds());
      updateSelectionCount();
    });

    document.getElementById('weeklyClear')?.addEventListener('click',()=>{
      document.querySelectorAll('.weekly-club-check').forEach(x=>x.checked=false);
      persistSelection([]);
      updateSelectionCount();
      const r=document.getElementById('weeklyFiveResults');
      if(r) r.innerHTML='';
    });

    document.getElementById('weeklyBuildFive')?.addEventListener('click',()=>{
      if (isBuilding) return;
      const ids=selectedClubIds();
      persistSelection(ids);
      const error=feasibility(ids);
      const target=document.getElementById('weeklyFiveResults');
      if(error){ if(target) target.innerHTML=`<div class="notice warn">${esc(error)}</div>`; return; }

      isBuilding=true;
      const btn=document.getElementById('weeklyBuildFive');
      if(btn){btn.disabled=true;btn.textContent='Building…';}
      if(target) target.innerHTML=`<div class="skeleton"></div>`;
      setTimeout(()=>{
        try {
          lastBuild=buildFive(ids);
          renderBuiltFive(lastBuild,ids);
        } catch(e) {
          console.error(e);
          if(target) target.innerHTML=`<div class="notice warn">${esc(e.message||String(e))}</div>`;
        } finally {
          isBuilding=false;
          if(btn){btn.disabled=false;btn.textContent='Build 5 teams';}
        }
      },30);
    });
  }

  function ready() {
    return document.getElementById('weekly') && state?.players?.length && state?.teams?.length && state?.nextEvents?.length;
  }

  function ensureRendered() {
    if (!ready()) return;
    const root=document.getElementById('weekly');
    if (!root.dataset.weeklyReady) {
      root.dataset.weeklyReady='1';
      renderWeeklyShell();
    }
  }

  // Six nav items need six columns; keep this isolated here so styles.css is untouched.
  const style=document.createElement('style');
  style.textContent='.bottom-nav{grid-template-columns:repeat(6,1fr)!important}@media(max-width:420px){.nav-item small{font-size:8px}.nav-item{padding-left:2px;padding-right:2px}}';
  document.head.appendChild(style);

  document.addEventListener('click',e=>{
    if(e.target.closest('.nav-item[data-view="weekly"],[data-go="weekly"]')){
      setTimeout(ensureRendered,20);
      setTimeout(ensureRendered,450);
    }
  });

  setTimeout(ensureRendered,2500);
})();