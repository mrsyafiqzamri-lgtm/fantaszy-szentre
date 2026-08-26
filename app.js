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
      <div class="stat-note">First pre-deadline SZxP 2.0 snapshot is being tracked.</div>
    </div>`;
  }
  return `<div class="card">
    <div class="stat-label">Model MAE</div>
    <div class="stat-value">${fmt(summary.average_relevant_mae,2)}</div>
    <div class="stat-note">${summary.gameweeks_scored} GW scored · lower is better</div>
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
        <div class="section-head"><h2>SZxP 2.0</h2><span class="stat-note">${state.players.length} players</span></div>
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
      <p class="subtext">Full FPL pool ranked by SZxP 2.0. Switch between next-GW, four-GW, value and captaincy views.</p>
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
      const [entry,picks,history] = await Promise.all([
        fetchJSON(`/entry/${t.id}/`),
        fetchJSON(`/entry/${t.id}/event/${gw}/picks/`),
        fetchJSON(`/entry/${t.id}/history/`)
      ]);
      return {...t, entry, picks, history, ok:true};
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

function clubCounts(players, excludeId=null) {
  const counts = {};
  players.filter(p=>p.id!==excludeId).forEach(p=>counts[p.team]=(counts[p.team]||0)+1);
  return counts;
}

function bestCandidateMove(td) {
  if (!td.ok) return null;
  const proj = teamProjection(td);
  const owned = new Set(proj.players.map(p=>p.id));
  const pickMap = pickMetaMap(td);
  const bank = Number(td.picks?.entry_history?.bank || 0);
  let best = null;

  for (const out of proj.players) {
    const selling = Number(pickMap[out.id]?.selling_price ?? out.now_cost);
    const budget = selling + bank;
    const counts = clubCounts(proj.players, out.id);

    const candidates = state.players.filter(p =>
      p.element_type === out.element_type &&
      !owned.has(p.id) &&
      p.now_cost <= budget &&
      p.xmins >= 55 &&
      p.status !== 'u' &&
      (counts[p.team] || 0) < 3
    );

    for (const incoming of candidates) {
      const gain4 = incoming.xp4 - out.xp4;
      const gain1 = incoming.xp[0] - out.xp[0];
      const urgent = out.xmins < 45 || ['i','s','u'].includes(out.status);
      const score = gain4 + (urgent ? 3.0 : 0) + Math.max(0,gain1)*0.25;
      if (!best || score > best.score) {
        best = {out,incoming,gain4,gain1,budget,urgent,score};
      }
    }
  }
  return best;
}

function actionForMove(move) {
  if (!move) return 'ROLL';
  if (move.urgent) return 'TRANSFER';
  if (move.gain4 >= 4.0) return 'TRANSFER';
  return 'ROLL';
}

function renderTeams() {
  const cards = state.teamData.map(td => {
    if (!td.ok) return `<div class="card team-card"><div class="team-title">${esc(td.name)}</div><div class="team-meta">Entry ${td.id}</div><div class="notice warn" style="margin-top:14px">Could not load entry: ${esc(td.error)}</div></div>`;

    const p = teamProjection(td);
    const move = bestCandidateMove(td);
    const gwPts = td.picks?.entry_history?.points ?? '—';
    const or = td.picks?.entry_history?.overall_rank;
    const action = actionForMove(move);

    return `<div class="card team-card">
      <div class="team-title">${esc(td.name)}</div>
      <div class="team-meta">${esc(td.type)} · Entry ${td.id}</div>
      <div class="team-numbers">
        <div class="mini"><span>GW${state.publishedGW}</span><b>${gwPts}</b></div>
        <div class="mini"><span>Next XI xP</span><b>${fmt(p.xp1)}</b></div>
        <div class="mini"><span>Formation</span><b>${p.formation}</b></div>
      </div>
      <div class="action-line">
        <strong>CAPTAIN:</strong> ${p.captain ? `${esc(p.captain.web_name)} ${fmt(p.captain.xp[0])}` : '—'}<br>
        <strong>VC:</strong> ${p.vice ? `${esc(p.vice.web_name)} ${fmt(p.vice.xp[0])}` : '—'}<br>
        <strong>MODEL MOVE:</strong> ${move ? `${action} · ${esc(move.out.web_name)} → ${esc(move.incoming.web_name)} (${move.gain4>=0?'+':''}${fmt(move.gain4)} 4GW xP)` : 'ROLL'}<br>
        <strong>OR:</strong> ${or ? Number(or).toLocaleString() : '—'}<br>
        <strong>OBJECTIVE:</strong> ${esc(td.objective)}
      </div>
    </div>`;
  }).join('');

  $('#teams').innerHTML = `
    <div class="hero">
      <div class="eyebrow">My TeamSZ</div>
      <h1>Nine teams, one control room.</h1>
      <p class="subtext">The model optimises a legal starting XI and captain from the latest publicly locked squad.</p>
    </div>
    <div class="notice">Pre-deadline transfers remain private. Treat this as the current public baseline until your latest squad is confirmed.</div>
    <div class="section grid three">${cards}</div>`;
}

function renderTransfers() {
  const rows = state.teamData.map(td => {
    const move = bestCandidateMove(td);
    if (!td.ok || !move) return null;
    const action = actionForMove(move);
    const urgency = move.urgent || move.gain4>=6 ? 'High' : move.gain4>=3 ? 'Medium' : 'Low';
    return {td,move,action,urgency};
  }).filter(Boolean).sort((a,b)=>b.move.score-a.move.score);

  $('#transfers').innerHTML = `
    <div class="hero">
      <div class="eyebrow">Transfer Szentre</div>
      <h1>Projected gain, not last-week chasing.</h1>
      <p class="subtext">The engine uses each locked squad's public selling price, bank, position and three-per-club constraint.</p>
    </div>
    <div class="notice warn">Free transfers and private moves made after the last deadline are not publicly visible. “Net after -4” is shown only as a break-even reference, not an instruction to take a hit.</div>
    <div class="section table-wrap">
      <table>
        <thead><tr><th>Team</th><th>Action</th><th>Out</th><th>In</th><th>GW+1 Gain</th><th>4GW Gain</th><th>After -4</th><th>Urgency</th></tr></thead>
        <tbody>${rows.map(r=>`<tr>
          <td><b>${esc(r.td.name)}</b><div class="team-code">${esc(r.td.objective)}</div></td>
          <td><span class="badge ${r.action==='ROLL'?'watch':'buy'}">${r.action}</span></td>
          <td>${esc(r.move.out.web_name)} · ${money(r.move.out.now_cost)}</td>
          <td>${esc(r.move.incoming.web_name)} · ${money(r.move.incoming.now_cost)}</td>
          <td class="${r.move.gain1>0?'xp':''}">${r.move.gain1>=0?'+':''}${fmt(r.move.gain1)}</td>
          <td class="xp">${r.move.gain4>=0?'+':''}${fmt(r.move.gain4)}</td>
          <td>${fmt(r.move.gain4-4)}</td>
          <td><span class="badge ${r.urgency.toLowerCase()}">${r.urgency}</span></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
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
    const [bootstrap,fixtures,projectionData,accuracy,meta] = await Promise.all([
      fetchJSON('/bootstrap-static/',!force),
      fetchJSON('/fixtures/',!force),
      fetchLocal('./data/szxp.json',null,!force),
      fetchLocal('./data/accuracy.json',null,!force),
      fetchLocal('./data/meta.json',null,!force)
    ]);

    state.bootstrap=bootstrap;
    state.fixtures=fixtures;
    state.projectionData=projectionData;
    state.accuracy=accuracy;
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
