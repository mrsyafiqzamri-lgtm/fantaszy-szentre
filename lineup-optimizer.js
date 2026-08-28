(() => {
  const VERSION = '20260828-lineup2';

  function lxp(p, gw) {
    try { return Number(xpAt(p, gw) || 0); }
    catch { return Number(p?.xp?.[0] || 0); }
  }

  function playerById(id) {
    return state.players.find(p => Number(p.id) === Number(id));
  }

  function statusBadge(p) {
    const risky = p.status !== 'a' || Number(p.xmins || 0) < 50;
    if (!risky) return '';
    const label = p.status !== 'a'
      ? (p.news ? p.news.slice(0, 34) : 'Flagged')
      : `${p.xmins} xMins`;
    return ` <span class="badge ${Number(p.xmins||0)<35?'sell':'watch'}">${esc(label)}</span>`;
  }

  function chip(p, gw, cap=null, vice=null) {
    const role = cap?.id === p.id ? ' (C)' : vice?.id === p.id ? ' (VC)' : '';
    return `<span style="display:inline-block;margin:3px 5px 3px 0;padding:6px 9px;border:1px solid rgba(255,255,255,.08);border-radius:10px">
      <b>${esc(p.web_name)}${role}</b>
      <span class="team-code"> ${fmt(lxp(p,gw))} xP</span>${statusBadge(p)}
    </span>`;
  }

  function starterIdsFromPublic(td) {
    return new Set(
      (td.picks?.picks || [])
        .filter(x => Number(x.position || 99) <= 11)
        .map(x => Number(x.element))
    );
  }

  function lineupFromPlayers(players, gw) {
    const best = legalBestXIAt(players, gw);
    const ranked = [...best.xi].sort((a,b)=>lxp(b,gw)-lxp(a,gw));
    const captain = ranked[0] || null;
    const vice = ranked[1] || null;
    const xiIds = new Set(best.xi.map(p=>p.id));
    const bench = players.filter(p=>!xiIds.has(p.id));
    const benchGK = bench.filter(p=>p.pos==='GKP').sort((a,b)=>lxp(b,gw)-lxp(a,gw));
    const benchOut = bench.filter(p=>p.pos!=='GKP').sort((a,b)=>{
      const d = lxp(b,gw)-lxp(a,gw);
      return d || Number(b.xmins||0)-Number(a.xmins||0);
    });
    return {
      players, best, captain, vice, benchGK, benchOut,
      xpWithCaptain: best.total + (captain ? lxp(captain,gw) : 0),
      riskyXI: best.xi.filter(p=>p.status!=='a' || Number(p.xmins||0)<50)
    };
  }

  function groupedXI(L, gw) {
    return ['GKP','DEF','MID','FWD'].map(pos=>{
      const arr = L.best.xi.filter(p=>p.pos===pos).sort((a,b)=>lxp(b,gw)-lxp(a,gw));
      if (!arr.length) return '';
      return `<div style="margin-top:10px">
        <div class="stat-label" style="margin-bottom:4px">${pos}</div>
        <div>${arr.map(p=>chip(p,gw,L.captain,L.vice)).join('')}</div>
      </div>`;
    }).join('');
  }

  function benchHTML(L, gw) {
    const out = L.benchOut.map((p,i)=>`
      <div class="list-row">
        <div class="rank">${i+1}</div>
        <div class="list-main"><b>${esc(p.web_name)}</b><div>${p.teamCode} · ${p.pos} · ${p.xmins} xMins${p.news ? ` · ${esc(p.news.slice(0,55))}` : ''}</div></div>
        <div class="list-score">${fmt(lxp(p,gw))}</div>
      </div>`).join('');
    const gk = L.benchGK[0];
    return `${out}${gk ? `
      <div class="list-row">
        <div class="rank">GK</div>
        <div class="list-main"><b>${esc(gk.web_name)}</b><div>${gk.teamCode} · bench goalkeeper · ${gk.xmins} xMins${gk.news ? ` · ${esc(gk.news.slice(0,55))}` : ''}</div></div>
        <div class="list-score">${fmt(lxp(gk,gw))}</div>
      </div>` : ''}`;
  }

  // ------------------------------------------------------------
  // MY TEAMS: current/latest-public 15-man squad lineup optimiser
  // ------------------------------------------------------------
  function currentLineup(td, gw) {
    const squad = teamSquad(td);
    const L = lineupFromPlayers(squad, gw);
    const publicXI = starterIdsFromPublic(td);
    L.toStart = L.best.xi.filter(p=>!publicXI.has(p.id));
    L.toBench = squad.filter(p=>publicXI.has(p.id) && !L.best.xi.some(x=>x.id===p.id));
    return L;
  }

  function changesHTML(L) {
    if (!L.toStart?.length && !L.toBench?.length) {
      return `<div class="notice" style="margin-top:12px"><b>vs latest public XI:</b> no lineup changes suggested.</div>`;
    }
    return `<div class="notice" style="margin-top:12px">
      <b>vs latest public XI:</b>
      START ${L.toStart?.length ? L.toStart.map(p=>esc(p.web_name)).join(', ') : '—'}
      · BENCH ${L.toBench?.length ? L.toBench.map(p=>esc(p.web_name)).join(', ') : '—'}
    </div>`;
  }

  function currentTeamCard(td, gw) {
    if (!td.ok) return `<div class="card team-card"><div class="team-title">${esc(td.name)}</div><div class="notice warn">Could not load this squad.</div></div>`;
    const L = currentLineup(td,gw);
    const risky = L.riskyXI.length
      ? `<div class="notice warn" style="margin-top:12px"><b>Starting XI flag:</b> ${L.riskyXI.map(p=>`${esc(p.web_name)} (${p.xmins} xMins)`).join(' · ')}</div>`
      : '';

    return `<div class="card team-card">
      <div class="section-head">
        <div><div class="team-title">${esc(td.name)}</div><div class="team-meta">${esc(td.type)} · ${esc(td.objective)}</div></div>
        <span class="badge keep">${esc(L.best.formation)}</span>
      </div>
      <div class="team-numbers">
        <div class="mini"><span>GW${gw} XI xP</span><b>${fmt(L.best.total)}</b></div>
        <div class="mini"><span>With Captain</span><b>${fmt(L.xpWithCaptain)}</b></div>
        <div class="mini"><span>Bench xP</span><b>${fmt([...L.benchOut,...L.benchGK].reduce((s,p)=>s+lxp(p,gw),0))}</b></div>
      </div>
      <div style="margin-top:14px"><div class="section-head"><h3 style="margin:0">STARTING XI</h3><span class="stat-note">SZxP next-GW optimum</span></div>${groupedXI(L,gw)}</div>
      <div style="margin-top:18px"><div class="section-head"><h3 style="margin:0">BENCH ORDER</h3><span class="stat-note">1 → 2 → 3 · GK separate</span></div>${benchHTML(L,gw)}</div>
      ${changesHTML(L)}
      ${risky}
      <div class="action-line" style="margin-top:12px">
        <strong>CAPTAIN:</strong> ${L.captain ? `${esc(L.captain.web_name)} · ${fmt(lxp(L.captain,gw))} xP` : '—'}<br>
        <strong>VICE:</strong> ${L.vice ? `${esc(L.vice.web_name)} · ${fmt(lxp(L.vice,gw))} xP` : '—'}
      </div>
    </div>`;
  }

  function currentSummary(teams, gw) {
    const rows = teams.filter(x=>x.ok).map(td=>{
      const L = currentLineup(td,gw);
      const b1=L.benchOut[0];
      return `<tr>
        <td><b>${esc(td.name)}</b><div class="team-code">${esc(td.type)}</div></td>
        <td>${esc(L.best.formation)}</td>
        <td class="xp">${fmt(L.xpWithCaptain)}</td>
        <td>${L.captain?esc(L.captain.web_name):'—'}</td>
        <td>${L.vice?esc(L.vice.web_name):'—'}</td>
        <td>${b1?`${esc(b1.web_name)} · ${fmt(lxp(b1,gw))}`:'—'}</td>
        <td>${L.riskyXI.length?`<span class="badge watch">${L.riskyXI.length} flag${L.riskyXI.length>1?'s':''}</span>`:'<span class="badge buy">Clear</span>'}</td>
      </tr>`;
    }).join('');
    return `<div class="section card">
      <div class="section-head"><div><div class="eyebrow">9-Team Lineup Optimizer</div><h2 style="margin-top:5px">GW${gw} Start / Bench Control Room</h2></div><span class="stat-note">SZxP 2.1</span></div>
      <div class="notice">Each latest publicly known 15-man squad is rebuilt into the highest projected legal XI for GW${gw}. Bench order is ranked by next-GW xP, with the goalkeeper separate.</div>
      <div class="table-wrap" style="margin-top:12px"><table>
        <thead><tr><th>Team</th><th>Formation</th><th>Projected</th><th>C</th><th>VC</th><th>Bench #1</th><th>XI Risk</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
  }

  function renderCurrentLineups() {
    const root=document.getElementById('teams');
    if(!root || !state?.teamData?.length || !state?.nextEvents?.length) return;
    root.querySelector('#nineTeamLineupOptimizer')?.remove();
    const gw=Number(state.nextEvents[0].id);
    const holder=document.createElement('div');
    holder.id='nineTeamLineupOptimizer';
    holder.innerHTML=`
      ${currentSummary(state.teamData,gw)}
      <div class="section">
        <div class="section-head"><h2>Recommended XI + Bench</h2><span class="stat-note">${state.teamData.filter(x=>x.ok).length}/9 squads loaded</span></div>
        <div class="grid three">${state.teamData.map(td=>currentTeamCard(td,gw)).join('')}</div>
      </div>
      <div class="notice warn">Before the deadline, Official FPL does not expose private current-GW transfers or lineup changes. This view therefore uses each team's latest publicly locked 15-man squad.</div>`;
    const firstGrid=root.querySelector('.section.grid.three');
    if(firstGrid) firstGrid.insertAdjacentElement('beforebegin',holder);
    else root.appendChild(holder);
  }

  // ------------------------------------------------------------
  // TRANSFERS: mirror current Portfolio Transfer Szentre logic
  // so lineup is calculated AFTER the recommended move(s).
  // ------------------------------------------------------------
  function profile(td) {
    const type=String(td.type||'');
    const name=String(td.name||'');
    if(type.includes('Weekly Prize')) {
      if(name==='Petrol Neto') return {now:1,future:0,hit:1,risk:.10,diversity:.14,ceiling:.18,hold:.15};
      return {now:1,future:0,hit:1,risk:.18,diversity:.08,ceiling:.10,hold:.20};
    }
    if(type.includes('Cup')) return {now:1.45,future:.28,hit:1.35,risk:.65,diversity:0,ceiling:0,hold:.85};
    if(type.includes('H2H')) return {now:1.30,future:.35,hit:1.25,risk:.55,diversity:0,ceiling:0,hold:.75};
    if(type.includes('Monthly')) return {now:1.12,future:.82,hit:1,risk:.28,diversity:.04,ceiling:.05,hold:.45};
    if(type.includes('ANSARA')) return {now:1.18,future:.72,hit:1,risk:.25,diversity:.05,ceiling:.06,hold:.40};
    if(type.includes('Second')) return {now:1,future:.96,hit:1,risk:.25,diversity:.12,ceiling:.03,hold:.55};
    if(type.includes('Third')) return {now:1.05,future:.90,hit:1,risk:.22,diversity:.15,ceiling:.05,hold:.50};
    return {now:1,future:1,hit:1,risk:.30,diversity:0,ceiling:0,hold:.65};
  }

  function exposure() {
    const out={};
    for(const td of state.teamData.filter(x=>x.ok)) for(const p of teamSquad(td)) out[p.id]=(out[p.id]||0)+1;
    return out;
  }

  function clubCounts(ids) {
    const out={};
    ids.forEach(id=>{const p=playerById(id); if(p) out[p.team]=(out[p.team]||0)+1;});
    return out;
  }

  function riskCost(moves,pf) {
    return moves.reduce((s,m)=>{
      const p=m.inc;
      let r=Math.max(0,70-Number(p.xmins||0))/22;
      if(p.confidence==='Low') r+=.8;
      else if(p.confidence==='Medium') r+=.2;
      if(p.status!=='a') r+=1.2;
      return s+r*pf.risk;
    },0);
  }

  function divValue(moves,pf,exp) {
    return moves.reduce((s,m)=>s+Math.max(-2,3-Number(exp[m.inc.id]||0))*pf.diversity*.12,0);
  }

  function ceilValue(moves,pf) {
    return moves.reduce((s,m)=>{
      const p=m.inc;
      const gap=Math.max(0,Number(p.ceiling||0)-Number(p.xp?.[0]||0));
      const diff=Math.max(0,8-Number(p.selected_by_percent||0))/8;
      return s+pf.ceiling*(gap+diff);
    },0);
  }

  function mirrorRoute(td,exp) {
    const squad=teamSquad(td);
    const originalIds=squad.map(p=>p.id);
    const bank=Number(td.picks?.entry_history?.bank||0);
    const ft=inferredFreeTransfers(td);
    const base1=squadScore(originalIds,'gw1');
    const base4=squadScore(originalIds,'4gw');
    const pf=profile(td);
    const maxK=Math.min(5,Math.max(2,ft+2));
    const scoreCache=new Map();

    const scoreIds=(ids,mode)=>{
      const key=`${mode}:${ids.slice().sort((a,b)=>a-b).join(',')}`;
      if(!scoreCache.has(key)) scoreCache.set(key,squadScore(ids,mode));
      return scoreCache.get(key);
    };

    const evaluate=st=>{
      const gross1=scoreIds(st.ids,'gw1');
      const gross4=scoreIds(st.ids,'4gw');
      const hit=4*Math.max(0,st.moves.length-ft);
      const gw1Gain=gross1-base1;
      const fourGain=gross4-base4;
      const future=fourGain-gw1Gain;
      const gw1Net=gw1Gain-hit;
      const fourNet=fourGain-hit;
      const risk=riskCost(st.moves,pf);
      const div=divValue(st.moves,pf,exp);
      const ceil=ceilValue(st.moves,pf);
      const objective=pf.now*gw1Gain+pf.future*future-pf.hit*hit-risk+div+ceil;
      return {...st,hit,gross1,gross4,gw1Gain,fourGain,future,gw1Net,fourNet,risk,div,ceil,objective};
    };

    const zero=evaluate({ids:originalIds,bank,moves:[],remaining:new Set(originalIds)});
    let beam=[zero], all=[zero];
    const BEAM=10;

    for(let k=1;k<=maxK;k++){
      const children=[];
      for(const st of beam){
        const owned=new Set(st.ids);
        const clubs=clubCounts(st.ids);
        const sellable=[...st.remaining].map(playerById).filter(Boolean)
          .sort((a,b)=>(Number(a.xp4||0)+1.15*Number(a.xp?.[0]||0)+Number(a.xmins||0)/100)-(Number(b.xp4||0)+1.15*Number(b.xp?.[0]||0)+Number(b.xmins||0)/100))
          .slice(0,4);

        for(const out of sellable){
          const sp=sellingPrice(td,out);
          const budget=st.bank+sp;
          const candidates=state.players.filter(inc=>
            inc.element_type===out.element_type &&
            !owned.has(inc.id) &&
            inc.now_cost<=budget &&
            inc.xmins>=48 &&
            inc.status!=='u' &&
            ((clubs[inc.team]||0)-(inc.team===out.team?1:0))<3
          ).sort((a,b)=>{
            const av=1.45*Number(a.xp?.[0]||0)+Number(a.xp4||0)+Number(a.ceiling||0)*.12;
            const bv=1.45*Number(b.xp?.[0]||0)+Number(b.xp4||0)+Number(b.ceiling||0)*.12;
            return bv-av;
          }).slice(0,6);

          for(const inc of candidates){
            const ids=st.ids.map(id=>id===out.id?inc.id:id);
            const remaining=new Set(st.remaining); remaining.delete(out.id);
            children.push(evaluate({ids,bank:budget-inc.now_cost,moves:[...st.moves,{out,inc,sell:sp,buy:inc.now_cost}],remaining}));
          }
        }
      }
      if(!children.length) break;
      const dedup=new Map();
      for(const c of children){
        const key=c.ids.slice().sort((a,b)=>a-b).join(',');
        const prev=dedup.get(key);
        if(!prev || c.objective>prev.objective) dedup.set(key,c);
      }
      beam=[...dedup.values()].sort((a,b)=>b.objective-a.objective).slice(0,BEAM);
      all.push(...beam.slice(0,5));
    }

    const unique=new Map();
    for(const r of all){
      const key=r.ids.slice().sort((a,b)=>a-b).join(',');
      const prev=unique.get(key);
      if(!prev || r.objective>prev.objective) unique.set(key,r);
    }
    let routes=[...unique.values()].sort((a,b)=>b.objective-a.objective);
    const roll=routes.find(r=>!r.moves.length)||zero;
    let best=routes[0]||roll;
    if(best.moves.length && best.objective-roll.objective<pf.hold) best=roll;

    if(String(td.type||'').includes('Weekly Prize')){
      routes=routes.sort((a,b)=>(b.gw1Net+b.ceil+b.div-b.risk)-(a.gw1Net+a.ceil+a.div-a.risk));
      best=routes[0]||roll;
      if(best.moves.length && best.gw1Net<pf.hold) best=roll;
    }
    return {td,best,ft};
  }

  function routeText(r) {
    return !r.moves.length ? 'Hold squad' : r.moves.map(m=>`${m.out.web_name} → ${m.inc.web_name}`).join(' · ');
  }

  function postTransferCard(rec,gw) {
    const players=rec.best.ids.map(playerById).filter(Boolean);
    const L=lineupFromPlayers(players,gw);
    const pre=currentLineup(rec.td,gw);
    const preIds=new Set(pre.best.xi.map(p=>p.id));
    const postIds=new Set(L.best.xi.map(p=>p.id));
    const enters=L.best.xi.filter(p=>!preIds.has(p.id));
    const leaves=pre.best.xi.filter(p=>!postIds.has(p.id));
    const bank=Number(rec.best.bank||0)/10;

    return `<div class="section card" id="postTransferLineup">
      <div class="section-head">
        <div><div class="eyebrow">After Suggested Transfer</div><h2 style="margin-top:5px">GW${gw} Optimised XI · ${esc(rec.td.name)}</h2></div>
        <span class="badge buy">${esc(L.best.formation)}</span>
      </div>

      <div class="notice"><b>Apply first:</b> ${esc(routeText(rec.best))}. Then set the lineup below. This is calculated from the resulting 15-man squad, not the old squad.</div>

      <div class="grid stats" style="margin-top:12px">
        <div class="card"><div class="stat-label">Post-transfer XI xP</div><div class="stat-value">${fmt(L.best.total)}</div><div class="stat-note">before captain double</div></div>
        <div class="card"><div class="stat-label">Projected Score</div><div class="stat-value">${fmt(L.xpWithCaptain)}</div><div class="stat-note">XI + captain extra</div></div>
        <div class="card"><div class="stat-label">Transfer Cost</div><div class="stat-value">${rec.best.hit?'-'+rec.best.hit:'0'}</div><div class="stat-note">${rec.best.moves.length} move${rec.best.moves.length===1?'':'s'} · bank £${fmt(bank,1)}m</div></div>
        <div class="card"><div class="stat-label">Captain</div><div class="stat-value" style="font-size:1.35rem">${L.captain?esc(L.captain.web_name):'—'}</div><div class="stat-note">VC ${L.vice?esc(L.vice.web_name):'—'}</div></div>
      </div>

      <div style="margin-top:16px"><div class="section-head"><h3 style="margin:0">START THESE 11</h3><span class="stat-note">after recommended transfer(s)</span></div>${groupedXI(L,gw)}</div>

      <div style="margin-top:18px"><div class="section-head"><h3 style="margin:0">BENCH IN THIS ORDER</h3><span class="stat-note">1 → 2 → 3 · GK separate</span></div>${benchHTML(L,gw)}</div>

      <div class="notice" style="margin-top:12px"><b>Lineup effect vs current-squad optimiser:</b>
        ${enters.length?`START ${enters.map(p=>esc(p.web_name)).join(', ')}`:'no new starter'}
        · ${leaves.length?`BENCH/OUT ${leaves.map(p=>esc(p.web_name)).join(', ')}`:'no starter displaced'}.
      </div>

      ${L.riskyXI.length?`<div class="notice warn" style="margin-top:12px"><b>XI risk:</b> ${L.riskyXI.map(p=>`${esc(p.web_name)} (${p.xmins} xMins)`).join(' · ')}</div>`:''}
      <p class="model-note">This lineup follows the same objective-aware transfer logic currently used by Portfolio Transfer Szentre, then re-optimises the resulting squad for next-GW SZxP. If the transfer recommendation changes after a data refresh, this lineup changes with it.</p>
    </div>`;
  }

  let transferTimer=null;
  let transferRendering=false;

  function renderPostTransferLineup() {
    if(transferRendering) return;
    const root=document.getElementById('transfers');
    if(!root || !state?.teamData?.some?.(x=>x.ok) || !state?.nextEvents?.length) return;
    if(!root.querySelector('#portfolioTransferTeamSelect')) return; // portfolio plan not built yet

    transferRendering=true;
    try{
      root.querySelector('#postTransferLineup')?.remove();
      const selectedId=Number(localStorage.getItem('fs:portfolioTransferTeam') || root.querySelector('#portfolioTransferTeamSelect')?.value || state.teamData.find(x=>x.ok)?.id);
      const td=state.teamData.find(x=>x.ok && Number(x.id)===selectedId) || state.teamData.find(x=>x.ok);
      if(!td) return;
      const rec=mirrorRoute(td,exposure());
      const gw=Number(state.nextEvents[0].id);
      const holder=document.createElement('div');
      holder.innerHTML=postTransferCard(rec,gw);
      const node=holder.firstElementChild;
      const note=[...root.querySelectorAll('.model-note')].at(-1);
      if(note) note.insertAdjacentElement('beforebegin',node);
      else root.appendChild(node);
    } finally {
      transferRendering=false;
    }
  }

  function scheduleTransferRender() {
    clearTimeout(transferTimer);
    transferTimer=setTimeout(()=>{try{renderPostTransferLineup();}catch(e){console.error('Post-transfer lineup:',e);}},80);
  }

  function watchTransfers() {
    const root=document.getElementById('transfers');
    if(!root) return;
    const obs=new MutationObserver(()=>{if(!transferRendering) scheduleTransferRender();});
    obs.observe(root,{childList:true,subtree:true});
    document.addEventListener('change',e=>{
      if(e.target?.id==='portfolioTransferTeamSelect') setTimeout(scheduleTransferRender,30);
    });
    document.addEventListener('click',e=>{
      if(e.target.closest('.nav-item[data-view="transfers"],[data-go="transfers"]')) setTimeout(scheduleTransferRender,700);
    });
  }

  // Hook My Teams renderer.
  if(typeof renderTeams==='function'){
    const base=renderTeams;
    renderTeams=function(...args){
      const out=base.apply(this,args);
      try{renderCurrentLineups();}catch(e){console.error('Lineup optimizer:',e);}
      return out;
    };
  }

  setTimeout(()=>{try{renderCurrentLineups();}catch{}},1200);
  watchTransfers();

  window.FSLineupOptimizer={version:VERSION,renderCurrent:renderCurrentLineups,renderPostTransfer:renderPostTransferLineup};
})();