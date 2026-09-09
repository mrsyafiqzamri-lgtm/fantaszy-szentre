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
  const isAttack = p => pos(p)===3 || pos(p)===4;
  const isDefence = p => pos(p)===1 || pos(p)===2;

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

  function teamName(id) {
    return state.teams.find(t=>Number(t.id)===Number(id))?.short_name || `T${id}`;
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

  function feasible(teamIds) {
    const ids = [...new Set((teamIds||[]).map(Number))];
    if (ids.length < 5) return 'Select at least 5 clubs.';
    const pool = legalPool(ids);
    for (const [k,count] of Object.entries(POS_COUNTS)) {
      if (pool.filter(p=>pos(p)===Number(k)).length < count) {
        return 'Not enough eligible 3.0 players for a legal 15.';
      }
    }
    return '';
  }

  function meanTop(values, take=4) {
    const arr=[...values].sort((a,b)=>b-a).slice(0,take);
    return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
  }

  function teamMetrics() {
    const result = new Map();
    for (const t of state.teams) {
      const players = FS30.strictPlayers().filter(p=>Number(p.team)===Number(t.id));
      const attackers = players.filter(isAttack).map(p=>{
        const mins=Math.max(.25,Math.min(1,n(p.xmins)/90));
        return (xp(p,0)+.22*Math.max(0,n(p.ceiling)-xp(p,0)))*mins;
      });
      const defenders = players.filter(isDefence).map(p=>{
        const mins=Math.max(.25,Math.min(1,n(p.xmins)/90));
        return (xp(p,0)+.010*n(p.lineupScore))*mins;
      });
      const availability = meanTop(players.map(p=>Math.max(0,Math.min(1,n(p.xmins)/90))),11);
      const attack=meanTop(attackers,4);
      const defence=meanTop(defenders,4);
      result.set(Number(t.id),{
        attack,defence,availability,
        overall:.62*attack+.38*defence
      });
    }
    return result;
  }

  function nextFixtures() {
    const gw=Number(state.nextEvents?.[0]?.id||0);
    return (state.fixtures||[]).filter(f=>Number(f.event)===gw);
  }

  function fixtureInfo(f,metrics) {
    const h=metrics.get(Number(f.team_h))||{overall:0,attack:0,defence:0};
    const a=metrics.get(Number(f.team_a))||{overall:0,attack:0,defence:0};
    const homeAdj=h.overall*1.045;
    const edge=homeAdj-a.overall;
    const avg=Math.max(.25,(homeAdj+a.overall)/2);
    return {...f,edge,closeness:Math.abs(edge)/avg,home:h,away:a};
  }

  function makeScripts(teamIds) {
    const selected=new Set(teamIds.map(Number));
    const metrics=teamMetrics();
    const fixtures=nextFixtures().map(f=>fixtureInfo(f,metrics));
    const paired=fixtures
      .filter(f=>selected.has(Number(f.team_h))&&selected.has(Number(f.team_a)))
      .sort((a,b)=>a.closeness-b.closeness);

    const scripts=[{
      key:'anchor',label:'Anchor',kind:'anchor',maxDrop:0,diversity:0,
      keyBet:'Pure SZxP 3.0 expected-value team.'
    }];

    if (paired.length) {
      const f=paired[0];
      const strong=f.edge>=0?Number(f.team_h):Number(f.team_a);
      const weak=strong===Number(f.team_h)?Number(f.team_a):Number(f.team_h);
      const close=f.closeness<=.18;

      scripts.push({
        key:'side-strong',label:`${teamName(strong)} Dominant`,kind:'sidewin',
        team:strong,opp:weak,maxDrop:3.2,diversity:.70,
        keyBet:`Backing ${teamName(strong)} to win the close eligible-club matchup.`
      });

      if (close) {
        scripts.push({
          key:'side-reverse',label:`${teamName(weak)} Upset`,kind:'sidewin',
          team:weak,opp:strong,maxDrop:4.5,diversity:.92,
          keyBet:`Covering the opposite result: ${teamName(weak)} beats ${teamName(strong)}.`
        });
      }

      scripts.push({
        key:'open',label:`${teamName(f.team_h)}-${teamName(f.team_a)} Open`,kind:'open',
        home:Number(f.team_h),away:Number(f.team_a),maxDrop:4.0,diversity:.82,
        keyBet:`Backing attackers from both sides; avoiding defensive contradiction.`
      });
    }

    const selectedMetrics=[...selected].map(id=>({id,...(metrics.get(id)||{})}));
    const usedAttack=new Set(scripts.filter(s=>s.team).map(s=>s.team));
    for (const m of [...selectedMetrics].sort((a,b)=>b.attack-a.attack)) {
      if (scripts.length>=4) break;
      if (usedAttack.has(m.id)) continue;
      const fx=fixtures.find(f=>Number(f.team_h)===m.id||Number(f.team_a)===m.id);
      const opp=fx?(Number(fx.team_h)===m.id?Number(fx.team_a):Number(fx.team_h)):null;
      scripts.push({
        key:`attack-${m.id}`,label:`${teamName(m.id)} Attack`,kind:'attack',
        team:m.id,opp,maxDrop:3.8,diversity:.78,
        keyBet:`Building around a ${teamName(m.id)} attacking haul.`
      });
      usedAttack.add(m.id);
    }

    if (scripts.length<5) {
      const def=[...selectedMetrics].sort((a,b)=>b.defence-a.defence)[0];
      if (def) {
        const fx=fixtures.find(f=>Number(f.team_h)===def.id||Number(f.team_a)===def.id);
        const opp=fx?(Number(fx.team_h)===def.id?Number(fx.team_a):Number(fx.team_h)):null;
        scripts.push({
          key:`def-${def.id}`,label:`${teamName(def.id)} Clean Sheet`,kind:'defence',
          team:def.id,opp,maxDrop:4.2,diversity:.88,
          keyBet:`Backing ${teamName(def.id)} defence and avoiding opposing attackers.`
        });
      }
    }

    while (scripts.length<5) {
      scripts.push({
        key:`contrarian-${scripts.length}`,label:'Contrarian Ceiling',kind:'contrarian',
        maxDrop:4.5,diversity:1.05,
        keyBet:'High-ceiling 3.0 route with lower overlap to earlier options.'
      });
    }

    return scripts.slice(0,5);
  }

  function scriptBoost(p,script) {
    if (!script || script.kind==='anchor') return 0;
    const team=Number(p.team);
    let boost=0;

    if (script.kind==='sidewin') {
      if (team===Number(script.team)) {
        boost += isAttack(p)?.72:.28;
      } else if (team===Number(script.opp)) {
        boost += isDefence(p)?-.95:-.18;
      }
    } else if (script.kind==='attack') {
      if (team===Number(script.team)) boost += isAttack(p)?.72:.08;
      if (team===Number(script.opp) && isDefence(p)) boost -= .72;
    } else if (script.kind==='open') {
      if (team===Number(script.home)||team===Number(script.away)) {
        boost += isAttack(p)?.52:-.62;
      }
    } else if (script.kind==='defence') {
      if (team===Number(script.team)) boost += isDefence(p)?.82:.05;
      if (team===Number(script.opp) && isAttack(p)) boost -= .42;
    } else if (script.kind==='contrarian') {
      boost += .10*Math.max(0,n(p.ceiling)-xp(p,0));
    }
    return boost;
  }

  function profileScore(p, script, exposure={}, captainExposure={}, mode='next') {
    const base = mode==='4gw' ? n(p.xp4) : xp(p,0);
    if (mode==='4gw') return base;
    const ceilingGap=Math.max(0,n(p.ceiling)-xp(p,0));
    const safety=Math.max(0,Math.min(1,n(p.xmins)/90));
    const exp=n(exposure[p.id]);
    const capExp=n(captainExposure[p.id]);
    return base
      + scriptBoost(p,script)
      + .065*ceilingGap
      + .035*safety
      - n(script?.diversity)*exp*.38
      - n(script?.diversity)*capExp*.22;
  }

  function candidatePools(teamIds,script,exposure,capExposure,mode) {
    const pool=legalPool(teamIds);
    const out={};
    for (const k of [1,2,3,4]) {
      const arr=pool.filter(p=>pos(p)===k);
      const best=[...arr].sort((a,b)=>profileScore(b,script,exposure,capExposure,mode)-profileScore(a,script,exposure,capExposure,mode)).slice(0,24);
      const cheap=[...arr].sort((a,b)=>cost(a)-cost(b)||profileScore(b,script,exposure,capExposure,mode)-profileScore(a,script,exposure,capExposure,mode)).slice(0,9);
      const map=new Map();
      [...best,...cheap].forEach(p=>map.set(Number(p.id),p));
      out[k]=[...map.values()];
    }
    return out;
  }

  function minRemainingCost(slot,pools) {
    let total=0;
    for (const k of SLOT_ORDER.slice(slot)) {
      if (!pools[k]?.length) return Infinity;
      total+=Math.min(...pools[k].map(cost));
    }
    return total;
  }

  function genericCorrelationPenalty(xi) {
    const fixtures=nextFixtures();
    let penalty=0;
    for (const f of fixtures) {
      const h=xi.filter(p=>Number(p.team)===Number(f.team_h));
      const a=xi.filter(p=>Number(p.team)===Number(f.team_a));
      if (!h.length||!a.length) continue;
      const hAtk=h.filter(isAttack).length;
      const aAtk=a.filter(isAttack).length;
      const hDef=h.filter(isDefence).length;
      const aDef=a.filter(isDefence).length;
      penalty += .62*(hAtk*aDef+aAtk*hDef);
      if (hAtk>=2&&aDef>=1) penalty+=.55;
      if (aAtk>=2&&hDef>=1) penalty+=.55;
    }
    return penalty;
  }

  function scriptFit(xi,script) {
    if (!script||script.kind==='anchor'||script.kind==='contrarian') return 0;
    const count=(team,pred)=>xi.filter(p=>Number(p.team)===Number(team)&&pred(p)).length;
    let fit=0;

    if (script.kind==='sidewin') {
      fit += .55*count(script.team,isAttack)+.24*count(script.team,isDefence);
      fit -= .82*count(script.opp,isDefence);
      fit -= .16*count(script.opp,isAttack);
    } else if (script.kind==='attack') {
      fit += .52*count(script.team,isAttack);
      fit -= .64*count(script.opp,isDefence);
    } else if (script.kind==='open') {
      fit += .36*(count(script.home,isAttack)+count(script.away,isAttack));
      fit -= .58*(count(script.home,isDefence)+count(script.away,isDefence));
    } else if (script.kind==='defence') {
      fit += .62*count(script.team,isDefence);
      fit -= .34*count(script.opp,isAttack);
    }
    return fit;
  }

  function evaluate(ids,script,exposure={},priorXis=[],captainExposure={},mode='next') {
    const players=ids.map(id=>state.players.find(p=>Number(p.id)===Number(id))).filter(Boolean);
    if (players.length!==15) return null;

    if (mode==='4gw') {
      const score=players.reduce((s,p)=>s+n(p.xp4),0);
      return {players,ids,objective:score,projected:score,cost:players.reduce((s,p)=>s+cost(p),0)};
    }

    const lineup=FS30.bestXI(players,0);
    if (lineup.xi.length!==11||!lineup.captain) return null;

    const bench=FS30.benchOrder(players,lineup.xi);
    const projected=n(lineup.projectedWithCaptain);
    const ceilingLift=lineup.xi.reduce((s,p)=>s+Math.max(0,n(p.ceiling)-xp(p,0)),0);
    const exposureCost=lineup.xi.reduce((s,p)=>s+n(exposure[p.id]),0);
    const correlationPenalty=genericCorrelationPenalty(lineup.xi);
    const scenarioFit=scriptFit(lineup.xi,script);

    let overlapPenalty=0,maxOverlap=0;
    for (const prior of priorXis) {
      const set=new Set(prior);
      const overlap=lineup.xi.reduce((s,p)=>s+(set.has(Number(p.id))?1:0),0);
      maxOverlap=Math.max(maxOverlap,overlap);
      overlapPenalty += Math.max(0,overlap-7)*1.35;
      if (overlap>8) overlapPenalty += (overlap-8)*3.6;
    }

    const capPenalty=n(captainExposure[lineup.captain.id])*1.10*n(script?.diversity);
    const objective=projected
      + scenarioFit
      + .055*ceilingLift
      - correlationPenalty
      - n(script?.diversity)*exposureCost*.32
      - n(script?.diversity)*overlapPenalty
      - capPenalty;

    return {
      players,ids,xi:lineup.xi,bench,
      captain:lineup.captain,vice:lineup.vice,
      captainReason:lineup.captainReason,
      formation:lineup.formation,
      projected,objective,maxOverlap,
      scenarioFit,correlationPenalty,
      cost:players.reduce((s,p)=>s+cost(p),0)
    };
  }

  function build(teamIds,script,exposure={},priorXis=[],captainExposure={},floor=-Infinity,mode='next') {
    const err=feasible(teamIds);
    if (err) return {error:err};

    const pools=candidatePools(teamIds,script,exposure,captainExposure,mode);
    let beam=[{ids:[],cost:0,clubs:{},score:0}];
    const BEAM=140;

    for (let slot=0;slot<SLOT_ORDER.length;slot++) {
      const k=SLOT_ORDER[slot];
      const children=[];
      const minRemain=minRemainingCost(slot+1,pools);

      for (const st of beam) {
        const owned=new Set(st.ids);
        for (const p of pools[k]) {
          if (owned.has(Number(p.id))) continue;
          if ((st.clubs[p.team]||0)>=3) continue;
          const newCost=st.cost+cost(p);
          if (newCost>BUDGET||newCost+minRemain>BUDGET) continue;
          children.push({
            ids:[...st.ids,Number(p.id)],
            cost:newCost,
            clubs:{...st.clubs,[p.team]:(st.clubs[p.team]||0)+1},
            score:st.score+profileScore(p,script,exposure,captainExposure,mode)
          });
        }
      }

      if (!children.length) return {error:'No legal 3.0 squad found within £100.0m.'};
      const dedup=new Map();
      for (const c of children) {
        const key=[...c.ids].sort((a,b)=>a-b).join(',');
        const prev=dedup.get(key);
        if (!prev||c.score>prev.score) dedup.set(key,c);
      }
      beam=[...dedup.values()].sort((a,b)=>b.score-a.score).slice(0,BEAM);
    }

    const evaluated=beam.map(s=>evaluate(s.ids,script,exposure,priorXis,captainExposure,mode)).filter(Boolean);
    const allowed=evaluated.filter(x=>n(x.projected)>=floor);
    if (mode!=='next') return (allowed.length?allowed:evaluated).sort((a,b)=>b.objective-a.objective)[0]||{error:'Could not evaluate the squad.'};

    const meaningful=(allowed.length?allowed:evaluated).filter(x=>!priorXis.length||x.maxOverlap<=8);
    return (meaningful.length?meaningful:(allowed.length?allowed:evaluated))
      .sort((a,b)=>b.objective-a.objective)[0]||{error:'Could not evaluate the squad.'};
  }

  function getBest15(mode='next') {
    if (!ready()) return null;
    const stamp=`${state.meta?.updated_at_utc||''}:${mode}`;
    if (CACHE.has(stamp)) return CACHE.get(stamp);
    const anchor={key:'anchor',label:'Anchor',kind:'anchor',maxDrop:0,diversity:0,keyBet:'Pure SZxP 3.0 expected value.'};
    const result=build(allClubIds(),anchor,{},[],{},-Infinity,mode);
    CACHE.clear();
    CACHE.set(stamp,result);
    return result;
  }

  function exposureAdd(exposure,capExposure,squad) {
    if (!squad?.xi) return;
    const xi=new Set(squad.xi.map(p=>Number(p.id)));
    squad.players.forEach(p=>{
      exposure[p.id]=n(exposure[p.id])+(xi.has(Number(p.id))?.92:.12);
    });
    if (squad.captain) {
      exposure[squad.captain.id]=n(exposure[squad.captain.id])+.55;
      capExposure[squad.captain.id]=n(capExposure[squad.captain.id])+1;
    }
  }

  function buildFive(teamIds) {
    const scripts=makeScripts(teamIds);
    const anchor=build(teamIds,scripts[0],{},[],{},-Infinity,'next');
    if (anchor.error) return {error:anchor.error,squads:[]};

    const exposure={},capExposure={},prior=[];
    const squads=[{script:scripts[0],squad:anchor}];
    exposureAdd(exposure,capExposure,anchor);
    prior.push(anchor.xi.map(p=>Number(p.id)));

    for (const script of scripts.slice(1)) {
      const floor=n(anchor.projected)-n(script.maxDrop||4);
      let squad=build(teamIds,script,exposure,prior,capExposure,floor,'next');
      if (squad.error) {
        const fallback={...script,kind:'contrarian',label:`${script.label} Alt`,keyBet:'Fallback high-ceiling route with lower overlap.'};
        squad=build(teamIds,fallback,exposure,prior,capExposure,floor-.75,'next');
      }
      if (squad.error) return {error:squad.error,squads};
      squads.push({script,squad});
      exposureAdd(exposure,capExposure,squad);
      prior.push(squad.xi.map(p=>Number(p.id)));
    }

    return {squads,anchorProjected:anchor.projected};
  }

  function jersey(p,role='') {
    return `<div class="fs30-kit-wrap">
      <div class="fs30-kit">
        <span>${esc(p.teamCode||'FPL')}</span>
        ${role?`<b class="fs30-role ${role==='VC'?'vc':''}">${role}</b>`:''}
      </div>
    </div>`;
  }

  function pitchPlayer(p,squad) {
    const role=Number(squad.captain?.id)===Number(p.id)?'C':Number(squad.vice?.id)===Number(p.id)?'VC':'';
    return `<div class="fs30-pitch-player">${jersey(p,role)}<b>${esc(p.web_name)}</b><span>${fmt(xp(p,0))} xP</span></div>`;
  }

  function pitch(squad) {
    if (!squad||squad.error) return `<div class="fs30-empty">${esc(squad?.error||'No squad')}</div>`;
    const groups=[1,2,3,4].map(k=>squad.xi.filter(p=>pos(p)===k));
    return `<div class="fs30-pitch">
      ${groups.map(g=>`<div class="fs30-pitch-row">${g.map(p=>pitchPlayer(p,squad)).join('')}</div>`).join('')}
    </div>`;
  }

  function bench(squad) {
    return `<div class="fs30-bench">${(squad.bench||[]).map((p,i)=>`<div><span>${i+1}</span><b>${esc(p.web_name)}</b><small>${fmt(xp(p,0))} xP</small></div>`).join('')}</div>`;
  }

  function best15Markup() {
    const s=getBest15('next');
    if (!s) return `<div class="fs30-contract-bad">Waiting for verified 3.0 production data.</div>`;
    if (s.error) return `<div class="fs30-contract-bad">${esc(s.error)}</div>`;
    return `<div class="fs30-week-summary">
      <div><span>Projected</span><b>${fmt(s.projected)}</b></div>
      <div><span>Cost</span><b>£${fmt(s.cost/10)}m</b></div>
      <div><span>Formation</span><b>${esc(s.formation)}</b></div>
      <div><span>Captain</span><b>${esc(s.captain?.web_name||'—')}</b></div>
    </div>
    <div class="fs30-note">Best projected legal 15 from SZxP 3.0.</div>
    ${pitch(s)}
    <div class="fs30-section-title"><b>Bench</b><span>3.0 lineup order</span></div>${bench(s)}`;
  }

  function clubSelector() {
    const selected=new Set(savedClubs());
    return `<div class="fs30-clubs">${state.teams.map(t=>`<label><input class="fs30-club-check" type="checkbox" value="${t.id}" ${selected.has(Number(t.id))?'checked':''}><span>${esc(t.short_name)}</span></label>`).join('')}</div>`;
  }

  function buildFiveMarkup() {
    return `<div class="fs30-builder-actions">
      <button type="button" id="fs30AllClubs">Select all</button>
      <button type="button" id="fs30ClearClubs">Clear</button>
      <button type="button" class="primary" id="fs30BuildFive">Build 5</button>
    </div>
    ${clubSelector()}
    <div id="fs30FiveResults" class="fs30-five-results">
      <div class="fs30-note">Build 5 now targets five different winning paths: coherent match scripts, controlled overlap, captain exposure and attacker-vs-opposition-defender correlation.</div>
    </div>`;
  }

  function fiveResults(result) {
    if (result.error) return `<div class="fs30-contract-bad">${esc(result.error)}</div>`;
    return result.squads.map((x,i)=>{
      const s=x.squad,script=x.script;
      return `<details class="fs30-option" ${i===0?'open':''}>
        <summary>
          <div><span>Option ${i+1} · ${esc(script.label)}</span><b>${fmt(s.projected)} projected</b></div>
          <small>C ${esc(s.captain?.web_name||'—')} · £${fmt(s.cost/10)}m</small>
        </summary>
        <div class="fs30-option-body">
          <div class="fs30-keybet"><span>Key bet</span><b>${esc(script.keyBet)}</b></div>
          ${pitch(s)}${bench(s)}
        </div>
      </details>`;
    }).join('');
  }

  function render(tab='best') {
    const root=document.getElementById('weekly');
    if (!root) return;
    if (!ready()) {
      root.innerHTML=`<div class="fs-head"><div><div class="eyebrow">Weekly Szentre</div><h1>GW —</h1></div></div><div class="fs30-contract-bad">${esc(FS30?.contract?.().reason||'Waiting for 3.0')}</div>`;
      return;
    }
    const gw=Number(state.nextEvents?.[0]?.id||0);
    root.innerHTML=`<div class="fs-head">
      <div><div class="eyebrow">Weekly Szentre · 3.0</div><h1>GW${gw} Weekly Lab</h1></div>
      <div class="fs-meta">Best 15 + prize portfolio<br>independent of Match Predictions</div>
    </div>
    <div class="fs30-tabs">
      <button type="button" data-fs30-tab="best" class="${tab==='best'?'active':''}">Best 15</button>
      <button type="button" data-fs30-tab="five" class="${tab==='five'?'active':''}">Build 5</button>
    </div>
    <div class="fs30-tab-panel">${tab==='best'?best15Markup():buildFiveMarkup()}</div>`;
    root.querySelectorAll('[data-fs30-tab]').forEach(b=>b.addEventListener('click',()=>render(b.dataset.fs30Tab)));
    if (tab==='five') wireBuilder();
  }

  function wireBuilder() {
    const root=document.getElementById('weekly');
    const selected=()=>[...root.querySelectorAll('.fs30-club-check:checked')].map(x=>Number(x.value));
    root.querySelectorAll('.fs30-club-check').forEach(x=>x.addEventListener('change',()=>saveClubs(selected())));
    root.querySelector('#fs30AllClubs')?.addEventListener('click',()=>{root.querySelectorAll('.fs30-club-check').forEach(x=>x.checked=true);saveClubs(selected())});
    root.querySelector('#fs30ClearClubs')?.addEventListener('click',()=>{root.querySelectorAll('.fs30-club-check').forEach(x=>x.checked=false);saveClubs([])});
    root.querySelector('#fs30BuildFive')?.addEventListener('click',()=>{
      const ids=selected();saveClubs(ids);
      const target=root.querySelector('#fs30FiveResults');
      target.innerHTML='<div class="fs30-note">Building five coherent 3.0 prize scenarios…</div>';
      setTimeout(()=>{target.innerHTML=fiveResults(buildFive(ids))},20);
    });
  }

  let lastStamp='';
  function boot() {
    if (!ready()) return false;
    const stamp=state.meta?.updated_at_utc||'';
    if (stamp!==lastStamp||!document.getElementById('weekly')?.querySelector('.fs30-tabs')) {
      lastStamp=stamp;render('best');
    }
    return true;
  }

  const wait=setInterval(()=>{if(boot())clearInterval(wait)},200);
  setTimeout(()=>clearInterval(wait),20000);
  document.getElementById('refreshBtn')?.addEventListener('click',()=>setTimeout(()=>{lastStamp='';boot()},1400));

  window.FSWeekly30={
    version:'20260909-weekly30-scenario2',
    getBest15,buildFive,render,makeScripts
  };
})();