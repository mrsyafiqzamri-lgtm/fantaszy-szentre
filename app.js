const FPL = 'https://fantasy.premierleague.com/api';
const CACHE_TTL = 20 * 60 * 1000;

const portfolio = [
  { id: 113200, name: 'Joaoassic Park', type: 'Main Team', objective: 'Long-term OR' },
  { id: 119375, name: 'Permas Jaya FC', type: 'Second Team', objective: 'Controlled diversification' },
  { id: 114940, name: 'KK Old Boys FC', type: 'Third Team', objective: 'Alternative season route' },
  { id: 139195, name: 'Toastin Adarabioyo', type: 'Weekly / H2H-ready', objective: 'High-floor weekly team' },
  { id: 131073, name: 'Enzopreneur', type: 'Cup Team', objective: 'Knockout survival' },
  { id: 132558, name: 'Colwill of Fortune', type: 'Monthly Team', objective: 'Monthly ceiling' },
  { id: 128817, name: 'Palmerlaysia Boleh!', type: 'ANSARA + Season', objective: 'Weekly upside + OR' },
  { id: 137607, name: 'Roger and Out', type: 'Weekly Prize', objective: 'One-week ceiling' },
  { id: 130090, name: 'Petrol Neto', type: 'Weekly Prize', objective: 'High-variance ceiling' },
];

const state = {
  bootstrap: null,
  fixtures: [],
  projectionData: null,
  accuracy: null,
  backtest: null,
  meta: null,
  players: [],
  events: [],
  teams: [],
  nextEvents: [],
  publishedGW: null,
  teamData: [],
  filters: { q: '', pos: 'ALL', club: 'ALL', horizon: '4' },
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = (n, d=1) => Number(n || 0).toFixed(d);
const money = n => `£${(Number(n || 0) / 10).toFixed(1)}m`;
const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}

function cacheGet(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    if (!v || Date.now() - v.t > CACHE_TTL) return null;
    return v.data;
  } catch { return null; }
}
function cacheSet(key, data) {
  try { localStorage.setItem(key, JSON.stringify({t:Date.now(), data})); } catch {}
}

async function fetchJSON(path, useCache=true) {
  const key = `fs:${path}`;
  if (useCache) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }
  const res = await fetch(`${FPL}${path}`, {headers:{Accept:'application/json'}});
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  const data = await res.json();
  cacheSet(key, data);
  return data;
}

async function fetchLocal(path, fallback=null, useCache=true) {
  const key = `fs-local:${path}`;
  if (useCache) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }
  try {
    const res = await fetch(path, {cache:'no-store'});
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    cacheSet(key, data);
    return data;
  } catch {
    return fallback;
  }
}

function setApiStatus(ok, text) {
  const el = $('#apiStatus');
  el.className = `status-pill ${ok ? 'ok' : 'bad'}`;
  el.querySelector('span:last-child').textContent = text;
}

function currentContext() {
  const now = Date.now();
  const events = state.events;
  const next = events.find(e => new Date(e.deadline_time).getTime() > now)
    || events.find(e => !e.finished)
    || events.at(-1);
  const lastFinished = [...events].reverse().find(e => e.finished);
  state.nextEvents = events.filter(e => e.id >= next.id).slice(0,4);
  state.publishedGW = lastFinished?.id || Math.max(1, next.id - 1);
  return {next, lastFinished};
}

function fixturesFor(teamId, eventId) {
  return state.fixtures.filter(f =>
    Number(f.event) === Number(eventId) &&
    (f.team_h === teamId || f.team_a === teamId)
  );
}

function fallbackXP(p) {
  const base = Number(p.ep_next || p.points_per_game || 2);
  return state.nextEvents.map((e, i) => {
    const fx = fixturesFor(p.team, e.id);
    if (!fx.length) return 0;
    return Math.round(base * fx.length * (i === 0 ? 1 : .94) * 10) / 10;
  });
}

function projectionMap() {
  return Object.fromEntries((state.projectionData?.players || []).map(p => [p.id, p]));
}

function verdict(p) {
  if (p.xmins < 35 || ['i','s','u'].includes(p.status)) return 'SELL';
  if (p.xp4 >= 22 && p.xmins >= 70) return 'BUY';
  if (p.xp4 >= 16) return 'KEEP';
  return 'WATCH';
}

function enrichPlayers() {
  const teamMap = Object.fromEntries(state.teams.map(t => [t.id, t]));
  const posMap = Object.fromEntries((state.bootstrap.element_types || []).map(p => [p.id, p.singular_name_short]));
  const pMap = projectionMap();

  state.players = state.bootstrap.elements.map(p => {
    const model = pMap[p.id];
    const xp = model?.xp?.slice(0,4) || fallbackXP(p);
    while (xp.length < 4) xp.push(0);
    const xmins = model?.xmins ?? Math.min(90, Math.max(0, Number(p.minutes || 0)));
    const xp4 = model?.xp4 ?? xp.reduce((a,b)=>a+b,0);

    const enriched = {
      ...p,
      teamObj: teamMap[p.team],
      teamCode: teamMap[p.team]?.short_name || '',
      pos: posMap[p.element_type] || '',
      xp,
      xp4,
      xmins,
      confidence: model?.confidence || 'Medium',
      ceiling: model?.ceiling_gw1 ?? xp[0],
      captainScore: model?.captain_score ?? xp[0],
      value4: model?.value_4gw ?? (xp4 / Math.max(3.5, Number(p.now_cost || 45)/10)),
      fixturesXP: model?.fixtures || [],
      xpFirstHalf: model?.xp_first_half || xp,
      fixturesFirstHalf: model?.fixtures_first_half || model?.fixtures || [],
      components: model?.components_gw1 || {},
      netTransfers: Number(p.transfers_in_event || 0) - Number(p.transfers_out_event || 0),
    };
    enriched.verdict = verdict(enriched);
    return enriched;
  });
}

function priceRisk(p) {
  const total = Number(state.bootstrap.total_players || 1);
  const owners = Math.max(1, total * Number(p.selected_by_percent || 0) / 100);
  const ratio = p.netTransfers / owners;
  if (ratio > .08) return {label:'Rise risk', level:'high', ratio};
  if (ratio > .035) return {label:'Rise watch', level:'medium', ratio};
  if (ratio < -.08) return {label:'Fall risk', level:'low', ratio};
  if (ratio < -.035) return {label:'Fall watch', level:'medium', ratio};
  return {label:'Stable', level:'', ratio};
}

function confidenceBadge(p) {
  const cls = p.confidence === 'High' ? 'buy' : p.confidence === 'Low' ? 'sell' : 'watch';
  return `<span class="badge ${cls}">${esc(p.confidence)}</span>`;
}

function playerRow(p, rank) {
  const risk = priceRisk(p);
  const news = p.news ? esc(p.news.slice(0,100)) : 'Available';
  return `<tr>
    <td>${rank}</td>
    <td>
      <div class="player-cell">
        <span class="pos">${p.pos}</span>
        <div><b>${esc(p.web_name)}</b><div class="team-code">${p.teamCode} · ${esc((p.fixturesXP||[])[0] || '')}</div></div>
      </div>
    </td>
    <td>${money(p.now_cost)}</td>
    <td>${fmt(p.selected_by_percent)}%</td>
    <td>${p.xmins}</td>
    <td>${confidenceBadge(p)}</td>
    <td class="xp">${fmt(p.xp[0])}</td>
    <td>${fmt(p.xp[1])}</td>
    <td>${fmt(p.xp[2])}</td>
    <td>${fmt(p.xp[3])}</td>
    <td class="xp">${fmt(p.xp4)}</td>
    <td>${fmt(p.value4,2)}</td>
    <td><span class="badge ${p.verdict.toLowerCase()}">${p.verdict}</span></td>
    <td><span class="badge ${risk.level}">${risk.label}</span></td>
    <td title="${news}">${p.status === 'a' ? '✓' : esc((p.news || p.status).slice(0,30))}</td>
  </tr>`;
}

function topPlayers(n=8, key='xp4') {
  return [...state.players]
    .filter(p => p.status !== 'u')
    .sort((a,b) => Number(b[key] || 0) - Number(a[key] || 0))
    .slice(0,n);
}

function accuracyMarkup() {
  const summary = state.accuracy?.summary;
  if (!summary || !summary.gameweeks_scored) {
    return `<div class="card">
      <div class="stat-label">Model Audit</div>
      <div class="stat-value">GW${state.nextEvents[0]?.id || '—'}</div>
      <div class="stat-note">First genuine pre-deadline SZxP snapshot is being tracked.</div>
    </div>`;
  }
  return `<div class="card">
    <div class="stat-label">Model MAE</div>
    <div class="stat-value">${fmt(summary.average_relevant_mae,2)}</div>
    <div class="stat-note">${summary.gameweeks_scored} GW scored · lower is better</div>
  </div>`;
}


function gw1BacktestMarkup() {
  const bt=state.backtest;
  if(!bt?.teams?.length) return '';
  const names=Object.fromEntries(portfolio.map(t=>[t.id,t.name]));
  const rows=bt.teams.filter(x=>!x.error).map(x=>{
    const delta=Number(x.actual_minus_szxp||0);
    return `<tr>
      <td><b>${esc(names[x.entry_id]||x.entry_id)}</b></td>
      <td>${fmt(x.retrospective_szxp)}</td>
      <td class="xp">${fmt(x.actual_points,0)}</td>
      <td class="${delta>=0?'delta-up':'delta-down'}">${delta>=0?'+':''}${fmt(delta)}</td>
      <td>${x.active_chip?esc(chipAlias(x.active_chip)):'—'}</td>
    </tr>`;
  }).join('');
  return `<div class="section card">
    <div class="section-head"><h2>GW1 SZxP vs Actual</h2><span class="stat-note">retrospective fit check</span></div>
    <div class="notice warn">This GW1 number is a backcast created after GW1 using post-GW1 data, so it contains hindsight leakage. It is useful for comparison, but it is NOT counted as genuine prediction accuracy. True locked accuracy starts from GW2.</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Team</th><th>GW1 SZxP</th><th>Actual</th><th>Actual − SZxP</th><th>Chip</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="model-note">Player-level retrospective MAE: ${fmt(bt.player_relevant_mae,2)}. Lower is better, but this GW1 figure is not a clean out-of-sample test.</p>
  </div>`;
}

function renderOverview() {
  const {next,lastFinished} = currentContext();
  const deadline = next ? new Date(next.deadline_time).toLocaleString(undefined,{
    weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'
  }) : '—';

  const topNext = topPlayers(1, 'captainScore')[0];
  const top4 = topPlayers(1, 'xp4')[0];
  const captains = topPlayers(6, 'captainScore');
  const values = [...state.players]
    .filter(p => p.xmins >= 65 && p.xp4 >= 12)
    .sort((a,b)=>b.value4-a.value4).slice(0,6);
  const injuryCount = state.players.filter(p => p.status !== 'a' || p.news).length;
  const modelVersion = state.projectionData?.model_version || 'Fallback';

  $('#overview').innerHTML = `
    <div class="hero">
      <div class="eyebrow">Fantaszy Szentre</div>
      <h1>Smarter Fantasy Decisions.</h1>
      <p class="subtext">${esc(modelVersion)} projections for the full player pool, your nine squads, captaincy, market movement and transfer decisions.</p>
    </div>

    <div class="grid stats">
      <div class="card"><div class="stat-label">Next Gameweek</div><div class="stat-value">GW${next?.id ?? '—'}</div><div class="stat-note">Deadline ${deadline}</div></div>
      <div class="card"><div class="stat-label">Top Next GW</div><div class="stat-value">${topNext ? fmt(topNext.xp[0]) : '—'}</div><div class="stat-note">${topNext ? esc(topNext.web_name) : '—'} · captain score ${topNext ? fmt(topNext.captainScore) : '—'}</div></div>
      <div class="card"><div class="stat-label">Top 4GW</div><div class="stat-value">${top4 ? fmt(top4.xp4) : '—'}</div><div class="stat-note">${top4 ? esc(top4.web_name) : '—'}</div></div>
      ${accuracyMarkup()}
    </div>

    ${gw1BacktestMarkup()}

    <div class="section grid two">
      <div class="card">
        <div class="section-head"><h2>Captaincy</h2><button class="link-button" data-go="players">All players</button></div>
        ${captains.map((p,i)=>`<div class="list-row">
          <div class="rank">${i+1}</div>
          <div class="list-main"><b>${esc(p.web_name)}</b><div>${p.teamCode} · ${p.pos} · ${p.xmins} xMins · ${esc(p.confidence)}</div></div>
          <div class="list-score">${fmt(p.xp[0])}</div>
        </div>`).join('')}
      </div>

      <div class="card">
        <div class="section-head"><h2>4GW Value</h2><span class="stat-note">xP per £m</span></div>
        ${values.map((p,i)=>`<div class="list-row">
          <div class="rank">${i+1}</div>
          <div class="list-main"><b>${esc(p.web_name)}</b><div>${p.teamCode} · ${money(p.now_cost)} · ${fmt(p.xp4)} xP</div></div>
          <div class="list-score">${fmt(p.value4,2)}</div>
        </div>`).join('')}
      </div>
    </div>

    <div class="section grid two">
      <div class="card">
        <div class="section-head"><h2>Injury & Availability</h2><span class="stat-note">${injuryCount} flagged</span></div>
        ${state.players.filter(p=>p.news || p.status!=='a').sort((a,b)=>a.xmins-b.xmins).slice(0,6).map(p=>`
          <div class="alert-item">
            <div class="alert-copy"><b>${esc(p.web_name)} · ${p.teamCode}</b><span>${esc(p.news || 'Availability flag')}</span></div>
            <span class="badge ${p.xmins<45?'sell':'watch'}">${p.xmins} xMins</span>
          </div>`).join('') || '<div class="empty">No current flags.</div>'}
      </div>

      <div class="card">
        <div class="section-head"><h2>SZxP 2.1</h2><span class="stat-note">${state.players.length} players</span></div>
        <p class="subtext">Expected minutes + shrunk xG/xA + team attack/defence strength + clean-sheet probability + saves + bonus + defensive contributions when available + next-GW official FPL calibration.</p>
        <div class="notice">Penalty and set-piece bonuses are deliberately excluded until the role is independently verified. We would rather under-model than invent data.</div>
        <div class="model-note">Before every deadline, GitHub saves the latest projection snapshot. After that Gameweek finishes, the model records MAE, bias and correlation so we can calibrate SZxP using actual evidence.</div>
      </div>
    </div>`;
}

function getFilteredPlayers() {
  let rows = [...state.players];
  const f = state.filters;
  if (f.q) rows = rows.filter(p =>
    `${p.web_name} ${p.first_name} ${p.second_name} ${p.teamCode}`.toLowerCase().includes(f.q.toLowerCase())
  );
  if (f.pos !== 'ALL') rows = rows.filter(p => p.pos === f.pos);
  if (f.club !== 'ALL') rows = rows.filter(p => p.teamCode === f.club);

  if (f.horizon === '1') rows.sort((a,b)=>b.xp[0]-a.xp[0]);
  else if (f.horizon === 'value') rows.sort((a,b)=>b.value4-a.value4);
  else if (f.horizon === 'captain') rows.sort((a,b)=>b.captainScore-a.captainScore);
  else rows.sort((a,b)=>b.xp4-a.xp4);
  return rows;
}

function renderPlayers() {
  const clubOptions = state.teams.map(t=>`<option value="${t.short_name}">${t.short_name}</option>`).join('');
  const gwLabels = state.nextEvents.map(e=>`GW${e.id}`);
  while (gwLabels.length < 4) gwLabels.push('—');

  $('#players').innerHTML = `
    <div class="hero">
      <div class="eyebrow">Player Szentre</div>
      <h1>Every player. One projection table.</h1>
      <p class="subtext">Full FPL pool ranked by SZxP 2.1. Switch between next-GW, four-GW, value and captaincy views.</p>
    </div>
    <div class="controls">
      <input class="input" id="playerSearch" placeholder="Search player or club…" value="${esc(state.filters.q)}">
      <select class="select" id="posFilter">
        <option value="ALL">All positions</option>
        ${['GKP','DEF','MID','FWD'].map(x=>`<option value="${x}" ${state.filters.pos===x?'selected':''}>${x}</option>`).join('')}
      </select>
      <select class="select" id="clubFilter">
        <option value="ALL">All clubs</option>${clubOptions}
      </select>
      <select class="select" id="horizonFilter">
        <option value="4">Sort: 4GW SZxP</option>
        <option value="1" ${state.filters.horizon==='1'?'selected':''}>Sort: Next GW</option>
        <option value="captain" ${state.filters.horizon==='captain'?'selected':''}>Sort: Captain</option>
        <option value="value" ${state.filters.horizon==='value'?'selected':''}>Sort: 4GW Value</option>
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>#</th><th>Player</th><th>Price</th><th>Own</th><th>xMins</th><th>Conf</th>
          <th>${gwLabels[0]}</th><th>${gwLabels[1]}</th><th>${gwLabels[2]}</th><th>${gwLabels[3]}</th>
          <th>4GW</th><th>xP/£m</th><th>Verdict</th><th>Price</th><th>Status</th>
        </tr></thead>
        <tbody id="playerRows"></tbody>
      </table>
    </div>
    <p class="model-note">Projected points are estimates. Price risk is a transfer-momentum heuristic because FPL does not publish its exact price-change threshold.</p>`;

  renderPlayerRows();
  $('#playerSearch').addEventListener('input', e=>{state.filters.q=e.target.value;renderPlayerRows();});
  $('#posFilter').addEventListener('change', e=>{state.filters.pos=e.target.value;renderPlayerRows();});
  $('#clubFilter').addEventListener('change', e=>{state.filters.club=e.target.value;renderPlayerRows();});
  $('#horizonFilter').addEventListener('change', e=>{state.filters.horizon=e.target.value;renderPlayerRows();});
}

function renderPlayerRows() {
  $('#playerRows').innerHTML = getFilteredPlayers().map((p,i)=>playerRow(p,i+1)).join('');
}

async function loadPortfolio() {
  const gw = state.publishedGW;
  state.teamData = await Promise.all(portfolio.map(async t => {
    try {
      const [entry,picks,history,transfers] = await Promise.all([
        fetchJSON(`/entry/${t.id}/`),
        fetchJSON(`/entry/${t.id}/event/${gw}/picks/`),
        fetchJSON(`/entry/${t.id}/history/`),
        fetchJSON(`/entry/${t.id}/transfers/`)
      ]);
      return {...t, entry, picks, history, transfers, ok:true};
    } catch(e) {
      return {...t, ok:false,error:e.message};
    }
  }));
}

function legalBestXI(players) {
  const groups = {
    GKP: players.filter(p=>p.pos==='GKP').sort((a,b)=>b.xp[0]-a.xp[0]),
    DEF: players.filter(p=>p.pos==='DEF').sort((a,b)=>b.xp[0]-a.xp[0]),
    MID: players.filter(p=>p.pos==='MID').sort((a,b)=>b.xp[0]-a.xp[0]),
    FWD: players.filter(p=>p.pos==='FWD').sort((a,b)=>b.xp[0]-a.xp[0]),
  };
  let best = null;
  for (let d=3; d<=5; d++) {
    for (let m=2; m<=5; m++) {
      for (let f=1; f<=3; f++) {
        if (d+m+f !== 10) continue;
        if (groups.DEF.length<d || groups.MID.length<m || groups.FWD.length<f || !groups.GKP.length) continue;
        const xi = [groups.GKP[0], ...groups.DEF.slice(0,d), ...groups.MID.slice(0,m), ...groups.FWD.slice(0,f)];
        const total = xi.reduce((s,p)=>s+p.xp[0],0);
        if (!best || total > best.total) best = {xi,total,formation:`${d}-${m}-${f}`};
      }
    }
  }
  return best || {xi:players.slice(0,11), total:0, formation:'—'};
}

function teamProjection(td) {
  if (!td.ok) return {xp1:0,captain:null,vice:null,players:[],xi:[]};
  const ids = td.picks.picks.map(x=>x.element);
  const players = ids.map(id=>state.players.find(p=>p.id===id)).filter(Boolean);
  const best = legalBestXI(players);
  const captainRank = [...best.xi].sort((a,b)=>b.captainScore-a.captainScore);
  const captain = captainRank[0];
  const vice = captainRank[1];
  return {
    players,
    xi:best.xi,
    formation:best.formation,
    captain,
    vice,
    xp1:best.total + (captain?.xp[0]||0)
  };
}

function pickMetaMap(td) {
  return Object.fromEntries((td.picks?.picks || []).map(x=>[x.element,x]));
}

function halfEventIds() {
  return state.projectionData?.first_half_event_ids || state.nextEvents.map(e=>e.id);
}

function xpAt(p, gw) {
  const ids = halfEventIds();
  const idx = ids.indexOf(Number(gw));
  if (idx >= 0 && p.xpFirstHalf?.[idx] != null) return Number(p.xpFirstHalf[idx] || 0);
  const nextIdx = state.nextEvents.findIndex(e=>e.id===Number(gw));
  return nextIdx >= 0 ? Number(p.xp[nextIdx] || 0) : 0;
}

function fixtureAt(p, gw) {
  const ids = halfEventIds();
  const idx = ids.indexOf(Number(gw));
  return idx >= 0 ? (p.fixturesFirstHalf?.[idx] || '—') : '—';
}

function legalBestXIAt(players, gw) {
  const groups = {
    GKP: players.filter(p=>p.pos==='GKP').sort((a,b)=>xpAt(b,gw)-xpAt(a,gw)),
    DEF: players.filter(p=>p.pos==='DEF').sort((a,b)=>xpAt(b,gw)-xpAt(a,gw)),
    MID: players.filter(p=>p.pos==='MID').sort((a,b)=>xpAt(b,gw)-xpAt(a,gw)),
    FWD: players.filter(p=>p.pos==='FWD').sort((a,b)=>xpAt(b,gw)-xpAt(a,gw)),
  };
  let best = null;
  for (let d=3; d<=5; d++) {
    for (let m=2; m<=5; m++) {
      for (let f=1; f<=3; f++) {
        if (d+m+f !== 10) continue;
        if (groups.DEF.length<d || groups.MID.length<m || groups.FWD.length<f || !groups.GKP.length) continue;
        const xi = [groups.GKP[0], ...groups.DEF.slice(0,d), ...groups.MID.slice(0,m), ...groups.FWD.slice(0,f)];
        const total = xi.reduce((sum,p)=>sum+xpAt(p,gw),0);
        if (!best || total > best.total) best={xi,total,formation:`${d}-${m}-${f}`};
      }
    }
  }
  return best || {xi:players.slice(0,11),total:0,formation:'—'};
}

function teamSquad(td) {
  const ids = td.picks?.picks?.map(x=>x.element) || [];
  return ids.map(id=>state.players.find(p=>p.id===id)).filter(Boolean);
}

function teamProjection(td) {
  if (!td.ok) return {xp1:0,captain:null,vice:null,players:[],xi:[]};
  const players = teamSquad(td);
  const gw = state.nextEvents[0]?.id;
  const best = legalBestXIAt(players,gw);
  const captainRank = [...best.xi].sort((a,b)=>xpAt(b,gw)-xpAt(a,gw));
  const captain = captainRank[0];
  const vice = captainRank[1];
  return {
    players,
    xi:best.xi,
    formation:best.formation,
    captain,
    vice,
    xp1:best.total + (captain?xpAt(captain,gw):0)
  };
}

function chipAlias(name='') {
  const n=String(name).toLowerCase();
  if (['bboost','bench_boost','benchboost'].includes(n)) return 'BB';
  if (['3xc','triple_captain','triplecaptain'].includes(n)) return 'TC';
  if (['freehit','free_hit'].includes(n)) return 'FH';
  if (['wildcard','wc'].includes(n)) return 'WC';
  return n.toUpperCase();
}

function usedFirstHalfChips(td) {
  const out={};
  for (const c of (td.history?.chips || [])) {
    const gw=Number(c.event || c.gameweek || 0);
    if (gw>=1 && gw<=19) out[chipAlias(c.name)] = gw;
  }
  return out;
}

function globalBestXIAt(gw) {
  const pool=state.players.filter(p=>p.xmins>=50 && p.status!=='u');
  return legalBestXIAt(pool,gw);
}

function wildcardDebtAt(players, gw) {
  const ids=halfEventIds();
  const start=ids.indexOf(Number(gw));
  if (start<0) return 0;
  const window=ids.slice(start,start+4);
  let debt=0;
  for (const out of players) {
    const outScore=window.reduce((s,g)=>s+xpAt(out,g),0);
    const priceCap=Number(out.now_cost||0)+5; // allow £0.5m structural reshuffle
    const best=state.players
      .filter(p=>p.element_type===out.element_type && p.id!==out.id && p.now_cost<=priceCap && p.xmins>=55 && p.status!=='u')
      .sort((a,b)=>window.reduce((s,g)=>s+xpAt(b,g),0)-window.reduce((s,g)=>s+xpAt(a,g),0))[0];
    if (best) {
      const inScore=window.reduce((s,g)=>s+xpAt(best,g),0);
      debt += Math.max(0,inScore-outScore);
    }
  }
  return debt;
}

function firstHalfChipPlan(td) {
  const players=teamSquad(td);
  const used=usedFirstHalfChips(td);
  const gws=halfEventIds().filter(g=>g<=19);
  const plan={used};

  if (!used.BB) {
    const opts=gws.map(gw=>{
      const xi=legalBestXIAt(players,gw);
      const total15=players.reduce((s,p)=>s+xpAt(p,gw),0);
      const bench=Math.max(0,total15-xi.total);
      const risky=players.filter(p=>p.xmins<50).length;
      return {chip:'BB',gw,benefit:bench-risky*.35,raw:bench,detail:`bench +${fmt(bench)} xP`};
    }).sort((a,b)=>b.benefit-a.benefit);
    plan.BB=opts[0];
  }

  if (!used.TC) {
    const opts=[];
    for (const gw of gws) {
      for (const p of players) {
        const x=xpAt(p,gw);
        opts.push({chip:'TC',gw,benefit:x,raw:x,player:p,detail:`${p.web_name} +${fmt(x)} xP`});
      }
    }
    opts.sort((a,b)=>b.benefit-a.benefit);
    plan.TC=opts[0];
  }

  if (!used.FH) {
    const opts=gws.map(gw=>{
      const current=legalBestXIAt(players,gw);
      const ideal=globalBestXIAt(gw);
      const gap=Math.max(0,ideal.total-current.total);
      const blanks=players.filter(p=>fixtureAt(p,gw)==='BLANK').length;
      return {chip:'FH',gw,benefit:gap+blanks*2.5,raw:gap,detail:`one-week gap ${fmt(gap)} xP${blanks?` · ${blanks} blanks`:''}`};
    }).sort((a,b)=>b.benefit-a.benefit);
    plan.FH=opts[0];
  }

  if (!used.WC) {
    const reviewGws=[4,6,10,14,18].filter(g=>gws.includes(g));
    const source=reviewGws.length?reviewGws:gws;
    const opts=source.map(gw=>{
      const debt=wildcardDebtAt(players,gw);
      const flags=players.filter(p=>p.xmins<50 || p.status!=='a').length;
      return {chip:'WC',gw,benefit:debt+flags*1.5,raw:debt,detail:`4GW transfer debt ${fmt(debt)} xP`};
    }).sort((a,b)=>b.benefit-a.benefit);
    plan.WC=opts[0];
  }

  const multipliers = td.type.includes('Weekly') ? {TC:1.18,FH:1.15,BB:1.05,WC:.90}
    : td.type.includes('Cup') ? {TC:1.12,FH:1.15,BB:1.00,WC:.95}
    : td.type.includes('Monthly') ? {TC:1.10,FH:1.00,BB:1.10,WC:.95}
    : {TC:1.00,FH:.92,BB:1.03,WC:1.06};

  const options=['BB','TC','FH','WC'].map(k=>plan[k]).filter(Boolean);
  options.forEach(x=>x.portfolioScore=x.benefit*(multipliers[x.chip]||1));
  options.sort((a,b)=>b.portfolioScore-a.portfolioScore);
  plan.best=options[0] || null;
  return plan;
}

function latestPurchasePrice(td,p) {
  const ins=(td.transfers||[])
    .filter(t=>Number(t.element_in)===Number(p.id))
    .sort((a,b)=>Number(b.event||0)-Number(a.event||0));
  if (ins.length && ins[0].element_in_cost != null) return Number(ins[0].element_in_cost);
  return Number(p.now_cost||0)-Number(p.cost_change_start||0);
}

function sellingPrice(td,p) {
  const cp=Number(p.now_cost||0);
  const pp=latestPurchasePrice(td,p);
  if (cp<=pp) return cp;
  return pp + Math.floor((cp-pp)/2);
}

function inferredFreeTransfers(td) {
  const nextGw=Number(state.nextEvents[0]?.id || 2);
  let ft=1;
  const transfers=td.transfers||[];
  const chips=td.history?.chips||[];

  for (let gw=2; gw<nextGw; gw++) {
    const chip=chips.find(c=>Number(c.event)===gw);
    const alias=chipAlias(chip?.name||'');
    const n=transfers.filter(t=>Number(t.event)===gw).length;
    if (alias==='WC' || alias==='FH') {
      ft=Math.min(5,ft); // current-GW FT is consumed by WC/FH; previously banked FTs are retained
    } else {
      ft=Math.min(5,Math.max(0,ft-n)+1);
    }
  }
  return ft;
}

function squadScore(ids, mode='4gw') {
  const players=ids.map(id=>state.players.find(p=>p.id===id)).filter(Boolean);
  const gws=state.nextEvents.slice(0,4).map(e=>e.id);
  const weights=mode==='gw1'?[1]:[1,.92,.84,.76];
  let score=0;
  gws.slice(0,weights.length).forEach((gw,i)=>{
    const best=legalBestXIAt(players,gw);
    const cap=[...best.xi].sort((a,b)=>xpAt(b,gw)-xpAt(a,gw))[0];
    score += (best.total + (cap?xpAt(cap,gw):0))*weights[i];
  });
  return score;
}

function clubCountIds(ids) {
  const out={};
  ids.forEach(id=>{
    const p=state.players.find(x=>x.id===id);
    if(p) out[p.team]=(out[p.team]||0)+1;
  });
  return out;
}

function optimiseTransferScenarios(td, mode='4gw') {
  const squad=teamSquad(td);
  const originalIds=squad.map(p=>p.id);
  const bank=Number(td.picks?.entry_history?.bank||0);
  const ft=inferredFreeTransfers(td);
  const baselineScore=squadScore(originalIds,mode);
  const scoreCache=new Map();
  const scoreIds=ids=>{
    const key=ids.slice().sort((a,b)=>a-b).join(',');
    if(!scoreCache.has(key)) scoreCache.set(key,squadScore(ids,mode));
    return scoreCache.get(key);
  };

  let beam=[{
    ids:originalIds,
    bank,
    moves:[],
    remaining:new Set(originalIds),
    gross:baselineScore
  }];
  const scenarios=[{k:0,hit:0,gross:baselineScore,gain:0,netGain:0,moves:[],bank,ft}];
  const BEAM=18;

  for(let k=1;k<=15;k++){
    const children=[];
    for(const st of beam){
      const owned=new Set(st.ids);
      const clubs=clubCountIds(st.ids);
      const sellable=[...st.remaining]
        .map(id=>state.players.find(p=>p.id===id))
        .filter(Boolean)
        .sort((a,b)=>(a.xp4 + a.xmins/100)-(b.xp4 + b.xmins/100))
        .slice(0,5);

      for(const out of sellable){
        const sp=sellingPrice(td,out);
        const budget=st.bank+sp;
        const candidates=state.players.filter(inc=>
          inc.element_type===out.element_type &&
          !owned.has(inc.id) &&
          inc.now_cost<=budget &&
          inc.xmins>=45 &&
          inc.status!=='u' &&
          ((clubs[inc.team]||0) - (inc.team===out.team?1:0)) < 3
        ).sort((a,b)=>{
          const av=mode==='gw1'?a.xp[0]:a.xp4;
          const bv=mode==='gw1'?b.xp[0]:b.xp4;
          return bv-av;
        }).slice(0,8);

        for(const inc of candidates){
          const ids=st.ids.map(id=>id===out.id?inc.id:id);
          const remaining=new Set(st.remaining);
          remaining.delete(out.id);
          const gross=scoreIds(ids);
          children.push({
            ids,
            bank:budget-inc.now_cost,
            moves:[...st.moves,{out,inc,sell:sp,buy:inc.now_cost}],
            remaining,
            gross
          });
        }
      }
    }

    if(!children.length) break;
    const dedup=new Map();
    for(const c of children){
      const key=c.ids.slice().sort((a,b)=>a-b).join(',');
      const prev=dedup.get(key);
      if(!prev || c.gross>prev.gross) dedup.set(key,c);
    }
    beam=[...dedup.values()].sort((a,b)=>b.gross-a.gross).slice(0,BEAM);
    const best=beam[0];
    const hit=4*Math.max(0,k-ft);
    const gain=best.gross-baselineScore;
    scenarios.push({
      k,hit,gross:best.gross,gain,netGain:gain-hit,moves:best.moves,bank:best.bank,ft
    });
  }

  const best=[...scenarios].sort((a,b)=>b.netGain-a.netGain)[0];
  return {scenarios,best,ft,baselineScore};
}

function scenarioLabel(s) {
  if(s.k===0) return `ROLL → ${Math.min(5,s.ft+1)} FT next GW`;
  if(s.hit===0) return `${s.k} transfer${s.k>1?'s':''} · FREE`;
  return `${s.k} transfers · -${s.hit}`;
}

function movesText(moves) {
  if(!moves?.length) return 'Hold squad';
  return moves.map(m=>`${m.out.web_name} → ${m.inc.web_name}`).join(' · ');
}

function renderTeams() {
  const cards = state.teamData.map(td => {
    if (!td.ok) return `<div class="card team-card"><div class="team-title">${esc(td.name)}</div><div class="team-meta">Entry ${td.id}</div><div class="notice warn" style="margin-top:14px">Could not load entry: ${esc(td.error)}</div></div>`;

    const p = teamProjection(td);
    const chips=firstHalfChipPlan(td);
    const gwPts = td.picks?.entry_history?.points ?? '—';
    const or = td.picks?.entry_history?.overall_rank;
    const ft=inferredFreeTransfers(td);
    const bestChip=chips.best;
    const used=chips.used;

    const chipLines=['BB','TC','FH','WC'].map(k=>{
      if(used[k]) return `<strong>${k}:</strong> USED GW${used[k]}`;
      const x=chips[k];
      return x ? `<strong>${k}:</strong> GW${x.gw} · ${esc(x.detail)}` : `<strong>${k}:</strong> —`;
    }).join('<br>');

    return `<div class="card team-card">
      <div class="team-title">${esc(td.name)}</div>
      <div class="team-meta">${esc(td.type)} · Entry ${td.id}</div>
      <div class="team-numbers">
        <div class="mini"><span>GW${state.publishedGW}</span><b>${gwPts}</b></div>
        <div class="mini"><span>Next XI xP</span><b>${fmt(p.xp1)}</b></div>
        <div class="mini"><span>Baseline FT</span><b>${ft}</b></div>
      </div>
      <div class="action-line">
        <strong>CAPTAIN:</strong> ${p.captain ? `${esc(p.captain.web_name)} ${fmt(xpAt(p.captain,state.nextEvents[0]?.id))}` : '—'}<br>
        <strong>VC:</strong> ${p.vice ? `${esc(p.vice.web_name)} ${fmt(xpAt(p.vice,state.nextEvents[0]?.id))}` : '—'}<br>
        <strong>BEST FIRST-HALF CHIP:</strong> ${bestChip ? `${bestChip.chip} · GW${bestChip.gw} · ${esc(bestChip.detail)}` : 'All modelled chips used'}<br>
        ${chipLines}<br>
        <strong>OR:</strong> ${or ? Number(or).toLocaleString() : '—'}<br>
        <strong>OBJECTIVE:</strong> ${esc(td.objective)}
      </div>
    </div>`;
  }).join('');

  $('#teams').innerHTML = `
    <div class="hero">
      <div class="eyebrow">My TeamSZ</div>
      <h1>Nine teams, one control room.</h1>
      <p class="subtext">Legal XI projections, baseline free-transfer reconstruction and a first-half chip plan tailored to each team's objective.</p>
    </div>
    <div class="notice">Chip planner respects chips already used. 2026/27 has one Wildcard, Free Hit, Triple Captain and Bench Boost in GW1–19, then a fresh set from GW20. Only one chip can be used in a Gameweek. Current-GW private transfers remain invisible until the deadline.</div>
    <div class="section grid three">${cards}</div>`;
}

function renderTransfers() {
  const okTeams=state.teamData.filter(td=>td.ok);
  if(!okTeams.length) return;
  const selectedId=Number(localStorage.getItem('fs:transferTeam') || okTeams[0].id);
  const td=okTeams.find(t=>t.id===selectedId) || okTeams[0];
  const result=optimiseTransferScenarios(td,'4gw');
  const best=result.best;
  const used=usedFirstHalfChips(td);
  const nextGw=state.nextEvents[0]?.id;

  const rows=result.scenarios.map(s=>`
    <tr class="${s===best?'best-row':''}">
      <td>${s.k}</td>
      <td>${scenarioLabel(s)}</td>
      <td>${s.hit?`-${s.hit}`:'0'}</td>
      <td class="${s.netGain>0?'xp':''}">${s.gain>=0?'+':''}${fmt(s.gain)}</td>
      <td class="${s.netGain>0?'xp':''}">${s.netGain>=0?'+':''}${fmt(s.netGain)}</td>
      <td style="white-space:normal;min-width:300px">${esc(movesText(s.moves))}</td>
    </tr>`).join('');

  const chipPlan=firstHalfChipPlan(td);
  const wildcard=chipPlan.WC && !used.WC ? `WC window: GW${chipPlan.WC.gw} · ${chipPlan.WC.detail}` : `WC used GW${used.WC||'—'}`;
  const freehit=chipPlan.FH && !used.FH ? `FH window: GW${chipPlan.FH.gw} · ${chipPlan.FH.detail}` : `FH used GW${used.FH||'—'}`;

  $('#transfers').innerHTML = `
    <div class="hero">
      <div class="eyebrow">Transfer Szentre</div>
      <h1>Every legal transfer-count route.</h1>
      <p class="subtext">The optimiser evaluates 0 through 15 squad transfers, free-transfer usage, every -4 hit step, plus Wildcard and Free Hit as separate chip routes.</p>
    </div>

    <div class="controls">
      <select class="select" id="transferTeamSelect">
        ${okTeams.map(t=>`<option value="${t.id}" ${t.id===td.id?'selected':''}>${esc(t.name)}</option>`).join('')}
      </select>
    </div>

    <div class="grid stats">
      <div class="card"><div class="stat-label">Baseline FT</div><div class="stat-value">${result.ft}</div><div class="stat-note">Reconstructed from public locked transfer history</div></div>
      <div class="card"><div class="stat-label">Bank</div><div class="stat-value">£${fmt(Number(td.picks?.entry_history?.bank||0)/10)}m</div><div class="stat-note">At last locked deadline</div></div>
      <div class="card"><div class="stat-label">Best Route</div><div class="stat-value">${best.k===0?'ROLL':best.k+'T'}</div><div class="stat-note">${scenarioLabel(best)} · net ${best.netGain>=0?'+':''}${fmt(best.netGain)} xP</div></div>
      <div class="card"><div class="stat-label">Next GW</div><div class="stat-value">GW${nextGw}</div><div class="stat-note">${esc(td.objective)}</div></div>
    </div>

    <div class="notice">${esc(wildcard)}. ${esc(freehit)}. Bench Boost and Triple Captain do not remove normal transfer costs and are handled in My Teams chip planning.</div>
    <div class="notice warn">The public API cannot see transfers you make before the current deadline. These are exact for the latest publicly locked squad; if you have already made a private GW${nextGw} transfer, refresh the baseline manually after the deadline or use your latest squad screenshot with the copilot.</div>

    <div class="section table-wrap">
      <table>
        <thead><tr><th>#T</th><th>Legal route</th><th>Hit</th><th>Gross 4GW gain</th><th>Net gain</th><th>Best modelled moves</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="model-note">FPL allows up to five stored free transfers. Extra transfers cost four points each. Selling prices use the public transfer history plus the FPL sell-on rule; Wildcard/Free Hit retain banked free transfers. Beam search is used to evaluate multi-transfer combinations without brute-forcing millions of squads.</p>`;

  $('#transferTeamSelect').addEventListener('change',e=>{
    localStorage.setItem('fs:transferTeam',e.target.value);
    renderTransfers();
  });
}

function renderMarket() {
  const rises = [...state.players].sort((a,b)=>b.netTransfers-a.netTransfers).slice(0,20);
  const falls = [...state.players].sort((a,b)=>a.netTransfers-b.netTransfers).slice(0,20);
  const injured = state.players.filter(p=>p.news || p.status!=='a').sort((a,b)=>a.xmins-b.xmins).slice(0,30);

  const marketRows = (arr,up) => arr.map((p,i)=>`<div class="list-row">
    <div class="rank">${i+1}</div>
    <div class="list-main"><b>${esc(p.web_name)}</b><div>${p.teamCode} · ${p.pos} · ${money(p.now_cost)} · ${fmt(p.selected_by_percent)}% owned</div></div>
    <div class="${up?'delta-up':'delta-down'}">${p.netTransfers>0?'+':''}${p.netTransfers.toLocaleString()}</div>
  </div>`).join('');

  $('#market').innerHTML = `
    <div class="hero"><div class="eyebrow">Market Watch</div><h1>Price pressure, injuries and availability.</h1><p class="subtext">Current FPL prices plus transfer momentum and SZxP impact.</p></div>
    <div class="grid two">
      <div class="card"><div class="section-head"><h2>Most Bought</h2><span class="stat-note">GW transfers</span></div>${marketRows(rises,true)}</div>
      <div class="card"><div class="section-head"><h2>Most Sold</h2><span class="stat-note">GW transfers</span></div>${marketRows(falls,false)}</div>
    </div>
    <div class="section card">
      <div class="section-head"><h2>Injury / News Szentre</h2><span class="stat-note">Latest FPL flags</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Player</th><th>Price</th><th>Chance</th><th>xMins</th><th>Next xP</th><th>4GW xP</th><th>News</th></tr></thead>
        <tbody>${injured.map(p=>`<tr>
          <td><b>${esc(p.web_name)}</b><div class="team-code">${p.teamCode} · ${p.pos}</div></td>
          <td>${money(p.now_cost)}</td>
          <td>${p.chance_of_playing_next_round == null ? '—' : p.chance_of_playing_next_round+'%'}</td>
          <td>${p.xmins}</td><td class="xp">${fmt(p.xp[0])}</td><td>${fmt(p.xp4)}</td>
          <td style="white-space:normal;min-width:280px">${esc(p.news || p.status)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="model-note">Confirmed price is official FPL data. Rise/fall risk remains a heuristic because the exact price algorithm is unpublished.</p>
    </div>`;
}

function wireNavigation() {
  $$('.nav-item').forEach(btn => btn.addEventListener('click', ()=>openView(btn.dataset.view)));
  document.body.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go) openView(go.dataset.go);
  });
}
function openView(name) {
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===name));
  $$('.nav-item').forEach(v=>v.classList.toggle('active',v.dataset.view===name));
  window.scrollTo({top:0,behavior:'smooth'});
}

function renderLoading() {
  $('#overview').innerHTML = `<div class="hero"><div class="eyebrow">Fantaszy Szentre</div><h1>Updating SZxP intelligence…</h1></div><div class="grid stats">${'<div class="skeleton"></div>'.repeat(4)}</div>`;
}

async function init(force=false) {
  renderLoading();
  setApiStatus(false,'Connecting');
  if (force) Object.keys(localStorage).filter(k=>k.startsWith('fs')).forEach(k=>localStorage.removeItem(k));

  try {
    const [bootstrap,fixtures,projectionData,accuracy,backtest,meta] = await Promise.all([
      fetchJSON('/bootstrap-static/',!force),
      fetchJSON('/fixtures/',!force),
      fetchLocal('./data/szxp.json',null,!force),
      fetchLocal('./data/accuracy.json',null,!force),
      fetchLocal('./data/backtests/gw1.json',null,!force),
      fetchLocal('./data/meta.json',null,!force)
    ]);

    state.bootstrap=bootstrap;
    state.fixtures=fixtures;
    state.projectionData=projectionData;
    state.accuracy=accuracy;
    state.backtest=backtest;
    state.meta=meta;
    state.events=bootstrap.events;
    state.teams=bootstrap.teams;

    currentContext();
    enrichPlayers();
    renderOverview();
    renderPlayers();
    renderMarket();

    const version = projectionData?.model_version || 'FPL data';
    setApiStatus(true,version);

    await loadPortfolio();
    renderTeams();
    renderTransfers();
    toast(`${version} updated`);
  } catch(e) {
    console.error(e);
    setApiStatus(false,'Data error');
    $('#overview').innerHTML = `<div class="hero"><div class="eyebrow">Fantaszy Szentre</div><h1>Could not load Fantaszy Szentre data.</h1><p class="subtext">Run the GitHub data workflow and refresh.</p></div><div class="notice warn">${esc(e.message)}</div>`;
  }
}

$('#refreshBtn').addEventListener('click',()=>init(true));
wireNavigation();
init();
