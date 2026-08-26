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
  players: [],
  events: [],
  teams: [],
  nextEvents: [],
  publishedGW: null,
  teamData: [],
  playerSort: { key: 'xp4', dir: -1 },
  filters: { q: '', pos: 'ALL', club: 'ALL', horizon: '4' },
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const fmt = (n, d = 1) => Number(n || 0).toFixed(d);
const money = (n) => `£${(Number(n || 0) / 10).toFixed(1)}m`;
const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}

function cacheGet(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    if (!v || Date.now() - v.t > CACHE_TTL) return null;
    return v.data;
  } catch { return null; }
}
function cacheSet(key, data) { try { localStorage.setItem(key, JSON.stringify({t:Date.now(),data})); } catch {} }

async function fetchJSON(path, useCache = true) {
  const key = `fs:${path}`;
  if (useCache) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }
  const res = await fetch(`${FPL}${path}`, { headers: { 'Accept':'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  const data = await res.json();
  cacheSet(key, data);
  return data;
}

function setApiStatus(ok, text) {
  const el = $('#apiStatus');
  el.className = `status-pill ${ok ? 'ok' : 'bad'}`;
  el.querySelector('span:last-child').textContent = text;
}

function currentContext() {
  const now = Date.now();
  const events = state.events;
  const next = events.find(e => new Date(e.deadline_time).getTime() > now) || events.find(e => !e.finished) || events.at(-1);
  const lastFinished = [...events].reverse().find(e => e.finished);
  state.nextEvents = events.filter(e => e.id >= next.id).slice(0,4);
  state.publishedGW = lastFinished?.id || Math.max(1, next.id - 1);
  return { next, lastFinished };
}

function fixtureFactor(diff) {
  return ({1:1.18,2:1.09,3:1.00,4:.91,5:.82})[Number(diff)] || 1;
}

function playerExpectedMinutes(p) {
  const chanceRaw = p.chance_of_playing_next_round;
  const chance = chanceRaw == null ? (['i','s','u'].includes(p.status) ? 0 : 1) : chanceRaw / 100;
  let base;
  if (Number(p.starts) > 0) base = Math.min(90, Number(p.minutes || 0) / Math.max(1, Number(p.starts)));
  else if (Number(p.minutes) > 0) base = Math.min(70, Number(p.minutes));
  else base = Number(p.selected_by_percent || 0) > 5 ? 70 : 55;
  base = Math.max(20, Math.min(90, base));
  return Math.round(base * chance);
}

function fixturesFor(teamId, eventId) {
  return state.fixtures.filter(f => Number(f.event) === Number(eventId) && (f.team_h === teamId || f.team_a === teamId));
}

function baseFutureXP(p) {
  const ppg = Number(p.points_per_game || 0);
  const form = Number(p.form || 0);
  const xgi90 = Number(p.expected_goal_involvements_per_90 || 0);
  const bonusPerStart = Number(p.starts || 0) ? Number(p.bonus || 0) / Number(p.starts) : 0;
  const xgiPoints = xgi90 * (p.element_type === 4 ? 4 : 5);
  const blended = .46 * ppg + .29 * form + .18 * xgiPoints + .07 * bonusPerStart;
  return Math.max(1.2, Math.min(11, blended || 2.2));
}

function calculateXP(p) {
  const mins = playerExpectedMinutes(p);
  const availability = Math.max(.05, mins / 90);
  const nextOfficial = Number(p.ep_next || 0);
  const futureBase = baseFutureXP(p);
  const vals = state.nextEvents.map((e, idx) => {
    const fx = fixturesFor(p.team, e.id);
    if (!fx.length) return 0;
    return fx.reduce((sum, f) => {
      const home = f.team_h === p.team;
      const diff = home ? f.team_h_difficulty : f.team_a_difficulty;
      const venue = home ? 1.025 : .985;
      let raw;
      if (idx === 0 && nextOfficial > 0 && fx.length === 1) {
        raw = nextOfficial * .84 + futureBase * .16;
      } else {
        raw = futureBase * fixtureFactor(diff) * venue;
      }
      return sum + raw * (.72 + .28 * availability);
    }, 0);
  });
  while (vals.length < 4) vals.push(0);
  return vals.map(v => Math.max(0, Math.round(v * 10) / 10));
}

function verdict(p) {
  const xp4 = p.xp.reduce((a,b)=>a+b,0);
  const mins = playerExpectedMinutes(p);
  if (mins < 35 || ['i','s','u'].includes(p.status)) return 'SELL';
  if (xp4 >= 22 && mins >= 70) return 'BUY';
  if (xp4 >= 16) return 'KEEP';
  return 'WATCH';
}

function enrichPlayers() {
  const teamMap = Object.fromEntries(state.teams.map(t => [t.id,t]));
  const posMap = Object.fromEntries((state.bootstrap.element_types || []).map(p => [p.id,p.singular_name_short]));
  state.players = state.bootstrap.elements.map(p => {
    const xp = calculateXP(p);
    return {
      ...p,
      teamObj: teamMap[p.team],
      teamCode: teamMap[p.team]?.short_name || '',
      pos: posMap[p.element_type] || '',
      xp,
      xp4: xp.reduce((a,b)=>a+b,0),
      xmins: playerExpectedMinutes(p),
      verdict: verdict({...p,xp}),
      netTransfers: Number(p.transfers_in_event || 0) - Number(p.transfers_out_event || 0),
    };
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

function playerRow(p, rank) {
  const risk = priceRisk(p);
  const news = p.news ? esc(p.news.slice(0,80)) : 'Available';
  return `<tr>
    <td>${rank ?? ''}</td>
    <td><div class="player-cell"><span class="pos">${p.pos}</span><div><b>${esc(p.web_name)}</b><div class="team-code">${p.teamCode}</div></div></div></td>
    <td>${money(p.now_cost)}</td>
    <td>${fmt(p.selected_by_percent)}%</td>
    <td>${p.xmins}</td>
    <td class="xp">${fmt(p.xp[0])}</td>
    <td>${fmt(p.xp[1])}</td><td>${fmt(p.xp[2])}</td><td>${fmt(p.xp[3])}</td>
    <td class="xp">${fmt(p.xp4)}</td>
    <td><span class="badge ${p.verdict.toLowerCase()}">${p.verdict}</span></td>
    <td><span class="badge ${risk.level}">${risk.label}</span></td>
    <td title="${news}">${p.status === 'a' ? '✓' : esc((p.news || p.status).slice(0,30))}</td>
  </tr>`;
}

function topPlayers(n=8, by='xp4') {
  return [...state.players].filter(p => p.status !== 'u').sort((a,b)=>Number(b[by])-Number(a[by])).slice(0,n);
}

function renderOverview() {
  const {next,lastFinished} = currentContext();
  const deadline = next ? new Date(next.deadline_time).toLocaleString(undefined,{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
  const top1 = topPlayers(1,'xp4')[0];
  const topNext = [...state.players].sort((a,b)=>b.xp[0]-a.xp[0])[0];
  const injuryCount = state.players.filter(p => p.status !== 'a' || p.news).length;
  const risers = [...state.players].sort((a,b)=>b.netTransfers-a.netTransfers).slice(0,5);
  const injuries = state.players.filter(p => p.news || p.status !== 'a').sort((a,b)=>a.xmins-b.xmins).slice(0,5);
  $('#overview').innerHTML = `
    <div class="hero">
      <div class="eyebrow">Fantaszy Szentre</div>
      <h1>Smarter Fantasy Decisions.</h1>
      <p class="subtext">Live FPL player data, SZxP projections, squad intelligence and market watch — built around your own fantasy workflow.</p>
    </div>
    <div class="grid stats">
      <div class="card"><div class="stat-label">Next Gameweek</div><div class="stat-value">GW${next?.id ?? '—'}</div><div class="stat-note">Deadline ${deadline}</div></div>
      <div class="card"><div class="stat-label">Players Tracked</div><div class="stat-value">${state.players.length}</div><div class="stat-note">Full FPL player pool</div></div>
      <div class="card"><div class="stat-label">Top Next GW</div><div class="stat-value">${topNext ? fmt(topNext.xp[0]) : '—'}</div><div class="stat-note">${topNext ? esc(topNext.web_name) : 'SZxP'}</div></div>
      <div class="card"><div class="stat-label">Top 4GW</div><div class="stat-value">${top1 ? fmt(top1.xp4) : '—'}</div><div class="stat-note">${top1 ? esc(top1.web_name) : 'SZxP total'}</div></div>
    </div>

    <div class="section grid two">
      <div class="card">
        <div class="section-head"><h2>Top SZxP</h2><button class="link-button" data-go="players">View all players</button></div>
        ${topPlayers(6).map((p,i)=>`<div class="list-row"><div class="rank">${i+1}</div><div class="list-main"><b>${esc(p.web_name)}</b><div>${p.teamCode} · ${p.pos} · ${money(p.now_cost)}</div></div><div class="list-score">${fmt(p.xp4)}</div></div>`).join('')}
        <div class="model-note">SZxP v0.1 blends official FPL expected points where available with form, points-per-game, xGI, expected minutes, availability and fixture difficulty.</div>
      </div>
      <div class="card">
        <div class="section-head"><h2>Injury & Availability</h2><span class="stat-note">${injuryCount} flagged</span></div>
        <div class="alert-list">${injuries.length ? injuries.map(p=>`<div class="alert-item"><div class="alert-copy"><b>${esc(p.web_name)} · ${p.teamCode}</b><span>${esc(p.news || 'Availability flag')}</span></div><span class="badge ${p.xmins < 45 ? 'sell':'watch'}">${p.xmins} xMins</span></div>`).join('') : '<div class="empty">No current flags.</div>'}</div>
      </div>
    </div>

    <div class="section grid two">
      <div class="card"><div class="section-head"><h2>Transfer Momentum</h2><button class="link-button" data-go="market">Market watch</button></div>${risers.map(p=>`<div class="list-row"><div class="list-main"><b>${esc(p.web_name)}</b><div>${p.teamCode} · ${money(p.now_cost)} · ${fmt(p.selected_by_percent)}% owned</div></div><div class="delta-up">+${p.netTransfers.toLocaleString()}</div></div>`).join('')}</div>
      <div class="card"><div class="section-head"><h2>Your Portfolio</h2><button class="link-button" data-go="teams">Open 9 teams</button></div><p class="subtext">Nine teams, nine objectives. The portfolio view keeps the main team sensible while allowing deliberate diversification for monthly, cup, ANSARA and weekly-prize formats.</p><div class="team-numbers"><div class="mini"><span>Teams</span><b>9</b></div><div class="mini"><span>Published GW</span><b>${lastFinished?.id ?? state.publishedGW}</b></div><div class="mini"><span>Next GW</span><b>${next?.id ?? '—'}</b></div></div></div>
    </div>`;
}

function getFilteredPlayers() {
  let rows = [...state.players];
  const f = state.filters;
  if (f.q) rows = rows.filter(p => `${p.web_name} ${p.first_name} ${p.second_name} ${p.teamCode}`.toLowerCase().includes(f.q.toLowerCase()));
  if (f.pos !== 'ALL') rows = rows.filter(p => p.pos === f.pos);
  if (f.club !== 'ALL') rows = rows.filter(p => p.teamCode === f.club);
  const key = f.horizon === '1' ? 'xp1' : 'xp4';
  if (key === 'xp1') rows.sort((a,b)=>b.xp[0]-a.xp[0]);
  else rows.sort((a,b)=>b.xp4-a.xp4);
  return rows;
}

function renderPlayers() {
  const clubOptions = state.teams.map(t=>`<option value="${t.short_name}">${t.short_name}</option>`).join('');
  $('#players').innerHTML = `
    <div class="hero"><div class="eyebrow">Player Szentre</div><h1>Every player. One projection table.</h1><p class="subtext">Search the full FPL pool and rank players by next-Gameweek or four-Gameweek SZxP.</p></div>
    <div class="controls">
      <input class="input" id="playerSearch" placeholder="Search player or club…" value="${esc(state.filters.q)}">
      <select class="select" id="posFilter"><option value="ALL">All positions</option>${['GKP','DEF','MID','FWD'].map(x=>`<option ${state.filters.pos===x?'selected':''}>${x}</option>`).join('')}</select>
      <select class="select" id="clubFilter"><option value="ALL">All clubs</option>${clubOptions}</select>
      <select class="select" id="horizonFilter"><option value="4">Sort: 4GW SZxP</option><option value="1" ${state.filters.horizon==='1'?'selected':''}>Sort: Next GW SZxP</option></select>
    </div>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>Player</th><th>Price</th><th>Own</th><th>xMins</th><th>GW+1</th><th>GW+2</th><th>GW+3</th><th>GW+4</th><th>4GW</th><th>Verdict</th><th>Price</th><th>Status</th></tr></thead><tbody id="playerRows"></tbody></table></div>
    <p class="model-note">Price “risk” is a transfer-momentum heuristic, not the unpublished official FPL price-change threshold. Projection values are estimates, not guarantees.</p>`;
  renderPlayerRows();
  $('#playerSearch').addEventListener('input', e=>{ state.filters.q=e.target.value; renderPlayerRows(); });
  $('#posFilter').addEventListener('change', e=>{ state.filters.pos=e.target.value; renderPlayerRows(); });
  $('#clubFilter').addEventListener('change', e=>{ state.filters.club=e.target.value; renderPlayerRows(); });
  $('#horizonFilter').addEventListener('change', e=>{ state.filters.horizon=e.target.value; renderPlayerRows(); });
}
function renderPlayerRows() {
  const rows = getFilteredPlayers();
  $('#playerRows').innerHTML = rows.map((p,i)=>playerRow(p,i+1)).join('');
}

async function loadPortfolio() {
  const gw = state.publishedGW;
  const teamData = await Promise.all(portfolio.map(async t => {
    try {
      const [entry,picks,history] = await Promise.all([
        fetchJSON(`/entry/${t.id}/`),
        fetchJSON(`/entry/${t.id}/event/${gw}/picks/`),
        fetchJSON(`/entry/${t.id}/history/`)
      ]);
      return {...t, entry, picks, history, ok:true};
    } catch (e) {
      return {...t, ok:false, error:e.message};
    }
  }));
  state.teamData = teamData;
}

function teamProjection(td) {
  if (!td.ok) return {xp1:0,xp4:0,captain:null,players:[]};
  const ids = td.picks.picks.map(x=>x.element);
  const players = ids.map(id=>state.players.find(p=>p.id===id)).filter(Boolean);
  const top11 = [...players].sort((a,b)=>b.xp[0]-a.xp[0]).slice(0,11);
  const cap = [...players].sort((a,b)=>b.xp[0]-a.xp[0])[0];
  return { players, xp1: top11.reduce((s,p)=>s+p.xp[0],0) + (cap?.xp[0]||0), xp4: players.reduce((s,p)=>s+p.xp4,0), captain:cap };
}

function bestCandidateMove(td) {
  if (!td.ok) return null;
  const proj = teamProjection(td);
  const owned = new Set(proj.players.map(p=>p.id));
  const bank = Number(td.picks?.entry_history?.bank || 0);
  let best = null;
  for (const out of proj.players) {
    const budget = Number(out.now_cost) + bank;
    const candidates = state.players.filter(p => p.element_type === out.element_type && !owned.has(p.id) && p.now_cost <= budget && p.xmins >= 60 && p.status === 'a');
    const incoming = candidates.sort((a,b)=>b.xp4-a.xp4)[0];
    if (!incoming) continue;
    const gain = incoming.xp4 - out.xp4;
    if (!best || gain > best.gain) best = {out,incoming,gain,budget};
  }
  return best;
}

function renderTeams() {
  const cards = state.teamData.map(td => {
    if (!td.ok) return `<div class="card team-card"><div class="team-title">${esc(td.name)}</div><div class="team-meta">Entry ${td.id}</div><div class="notice warn" style="margin-top:14px">Could not load this public entry yet: ${esc(td.error)}</div></div>`;
    const p = teamProjection(td);
    const move = bestCandidateMove(td);
    const gwPts = td.picks?.entry_history?.points ?? '—';
    const or = td.picks?.entry_history?.overall_rank;
    return `<div class="card team-card">
      <div class="team-title">${esc(td.name)}</div><div class="team-meta">${esc(td.type)} · Entry ${td.id}</div>
      <div class="team-numbers"><div class="mini"><span>GW${state.publishedGW}</span><b>${gwPts}</b></div><div class="mini"><span>OR</span><b>${or ? Number(or).toLocaleString() : '—'}</b></div><div class="mini"><span>Next XI xP</span><b>${fmt(p.xp1)}</b></div></div>
      <div class="action-line"><strong>CAPTAIN WATCH:</strong> ${p.captain ? esc(p.captain.web_name) + ' (' + fmt(p.captain.xp[0]) + ')' : '—'}<br><strong>TRANSFER WATCH:</strong> ${move && move.gain > 2.5 ? `${esc(move.out.web_name)} → ${esc(move.incoming.web_name)} (+${fmt(move.gain)} 4GW xP)` : 'ROLL / no obvious model upgrade'}<br><strong>OBJECTIVE:</strong> ${esc(td.objective)}</div>
    </div>`;
  }).join('');
  $('#teams').innerHTML = `<div class="hero"><div class="eyebrow">My TeamSZ</div><h1>Nine teams, one control room.</h1><p class="subtext">Public FPL data can show the latest locked Gameweek squad. Pre-deadline transfers are private, so treat transfer advice here as a baseline until the current squad is confirmed.</p></div><div class="notice">Current squad source: latest publicly available locked GW${state.publishedGW} picks. The app never asks for your FPL password.</div><div class="section grid three">${cards}</div>`;
}

function renderTransfers() {
  const rows = state.teamData.map(td => {
    const move = bestCandidateMove(td);
    if (!td.ok || !move) return null;
    const urgency = move.gain >= 6 ? 'High' : move.gain >= 3 ? 'Medium' : 'Low';
    return {td,move,urgency};
  }).filter(Boolean).sort((a,b)=>b.move.gain-a.move.gain);
  $('#transfers').innerHTML = `<div class="hero"><div class="eyebrow">Transfer Szentre</div><h1>Find the upgrade, not the hype.</h1><p class="subtext">Candidate transfers compare four-Gameweek SZxP within the same position and approximate public-squad budget.</p></div>
  <div class="notice warn">This is a candidate-move engine, not a final deadline recommendation. Selling price, free transfers and your private pre-deadline squad are not fully exposed by the public API.</div>
  <div class="section table-wrap"><table><thead><tr><th>Team</th><th>Out</th><th>Out 4GW</th><th>In</th><th>In 4GW</th><th>Gain</th><th>Urgency</th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>${esc(r.td.name)}</b><div class="team-code">${esc(r.td.objective)}</div></td><td>${esc(r.move.out.web_name)} · ${money(r.move.out.now_cost)}</td><td>${fmt(r.move.out.xp4)}</td><td>${esc(r.move.incoming.web_name)} · ${money(r.move.incoming.now_cost)}</td><td>${fmt(r.move.incoming.xp4)}</td><td class="xp">+${fmt(r.move.gain)}</td><td><span class="badge ${r.urgency.toLowerCase()}">${r.urgency}</span></td></tr>`).join('')}</tbody></table></div>`;
}

function renderMarket() {
  const rises = [...state.players].sort((a,b)=>b.netTransfers-a.netTransfers).slice(0,20);
  const falls = [...state.players].sort((a,b)=>a.netTransfers-b.netTransfers).slice(0,20);
  const injured = state.players.filter(p=>p.news || p.status!=='a').sort((a,b)=>a.xmins-b.xmins).slice(0,30);
  const marketRows = (arr,up) => arr.map((p,i)=>`<div class="list-row"><div class="rank">${i+1}</div><div class="list-main"><b>${esc(p.web_name)}</b><div>${p.teamCode} · ${p.pos} · ${money(p.now_cost)} · ${fmt(p.selected_by_percent)}% owned</div></div><div class="${up?'delta-up':'delta-down'}">${p.netTransfers>0?'+':''}${p.netTransfers.toLocaleString()}</div></div>`).join('');
  $('#market').innerHTML = `<div class="hero"><div class="eyebrow">Market Watch</div><h1>Price pressure, injuries and availability.</h1><p class="subtext">Track transfer momentum and player flags before they become deadline problems.</p></div>
  <div class="grid two"><div class="card"><div class="section-head"><h2>Most Bought</h2><span class="stat-note">GW transfers</span></div>${marketRows(rises,true)}</div><div class="card"><div class="section-head"><h2>Most Sold</h2><span class="stat-note">GW transfers</span></div>${marketRows(falls,false)}</div></div>
  <div class="section card"><div class="section-head"><h2>Injury / News Szentre</h2><span class="stat-note">Latest FPL flags</span></div><div class="table-wrap"><table><thead><tr><th>Player</th><th>Price</th><th>Chance</th><th>xMins</th><th>Next GW xP</th><th>News</th></tr></thead><tbody>${injured.map(p=>`<tr><td><b>${esc(p.web_name)}</b><div class="team-code">${p.teamCode} · ${p.pos}</div></td><td>${money(p.now_cost)}</td><td>${p.chance_of_playing_next_round == null ? '—' : p.chance_of_playing_next_round+'%'}</td><td>${p.xmins}</td><td class="xp">${fmt(p.xp[0])}</td><td style="white-space:normal;min-width:280px">${esc(p.news || p.status)}</td></tr>`).join('')}</tbody></table></div><p class="model-note">FPL price-change thresholds are not published. Fantaszy Szentre shows confirmed current price plus transfer pressure; use “rise/fall risk” as a warning signal, not a guarantee.</p></div>`;
}

function wireNavigation() {
  $$('.nav-item').forEach(btn => btn.addEventListener('click', () => openView(btn.dataset.view)));
  document.body.addEventListener('click', e => {
    const go = e.target.closest('[data-go]'); if (go) openView(go.dataset.go);
  });
}
function openView(name) {
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===name));
  $$('.nav-item').forEach(v=>v.classList.toggle('active',v.dataset.view===name));
  window.scrollTo({top:0,behavior:'smooth'});
}

function renderLoading() {
  $('#overview').innerHTML = `<div class="hero"><div class="eyebrow">Fantaszy Szentre</div><h1>Loading your football intelligence…</h1></div><div class="grid stats">${'<div class="skeleton"></div>'.repeat(4)}</div>`;
}

async function init(force=false) {
  renderLoading(); setApiStatus(false,'Connecting');
  if (force) Object.keys(localStorage).filter(k=>k.startsWith('fs:')).forEach(k=>localStorage.removeItem(k));
  try {
    const [bootstrap,fixtures] = await Promise.all([fetchJSON('/bootstrap-static/',!force),fetchJSON('/fixtures/',!force)]);
    state.bootstrap=bootstrap; state.fixtures=fixtures; state.events=bootstrap.events; state.teams=bootstrap.teams;
    currentContext(); enrichPlayers();
    renderOverview(); renderPlayers(); renderMarket();
    setApiStatus(true,'Live FPL data');
    await loadPortfolio();
    renderTeams(); renderTransfers();
    toast('Fantaszy Szentre updated');
  } catch (e) {
    console.error(e);
    setApiStatus(false,'API error');
    $('#overview').innerHTML = `<div class="hero"><div class="eyebrow">Fantaszy Szentre</div><h1>Could not reach the FPL API.</h1><p class="subtext">The app is ready, but this browser/network blocked the public FPL endpoint. Try refresh or deploy the files on GitHub Pages / another web host.</p></div><div class="notice warn">${esc(e.message)}</div>`;
  }
}

wireNavigation();
$('#refreshBtn').addEventListener('click',()=>init(true));
init();
