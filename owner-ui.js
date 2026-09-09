(() => {
  'use strict';

  const VERSION = '20260909-ownerfinal1';
  const KEYS = {
    homeTeam: 'fsux:homeTeam',
    hubTeam: 'fsux:hubTeam',
    showAll: 'fsux:showAllLeagues',
    positions: 'fsux:positions',
    clubs: 'fsux:clubs',
  };

  let rendering = false;
  let renderTimer = null;
  let accuracyCache = null;

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const n = v => Number(v || 0);
  const fmt = (v, d = 1) => n(v).toFixed(d);
  const int = v => n(v) > 0 ? n(v).toLocaleString() : '—';
  const price = v => `£${(n(v) / 10).toFixed(1)}m`;
  const esc = (s = '') => String(s).replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[c]));

  function ready() {
    try {
      return !!(
        state?.players?.length &&
        state?.teamData?.some?.(x => x.ok) &&
        state?.nextEvents?.length
      );
    } catch {
      return false;
    }
  }

  function availableTeams() {
    return state.teamData.filter(x => x.ok);
  }

  function selectedTeam(key) {
    const list = availableTeams();
    if (!list.length) return null;
    const saved = Number(localStorage.getItem(key) || list[0].id);
    return list.find(x => Number(x.id) === saved) || list[0];
  }

  function loadArray(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return Array.isArray(value) ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function saveArray(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function pickerMarkup(td, id) {
    return `
      <label class="fs-label" for="${id}">Choose team</label>
      <select class="fs-picker" id="${id}">
        ${availableTeams().map(t => `
          <option value="${t.id}" ${Number(t.id) === Number(td.id) ? 'selected' : ''}>
            ${esc(t.name)}
          </option>`).join('')}
      </select>`;
  }

  function rankMovement(rank, last) {
    rank = n(rank);
    last = n(last);
    if (!rank || !last) return { text: '—', cls: '' };
    const diff = last - rank;
    if (diff > 0) return { text: `↑ ${int(diff)}`, cls: 'fs-up' };
    if (diff < 0) return { text: `↓ ${int(Math.abs(diff))}`, cls: 'fs-down' };
    return { text: '—', cls: '' };
  }

  function leagueRows(td) {
    const normalize = (league, scoring) => ({
      name: league.name || `League ${league.id}`,
      type: league.league_type === 'x' ? 'Private' : 'Official',
      scoring,
      rank: n(league.entry_rank || league.rank),
      last: n(league.entry_last_rank),
      count: n(league.rank_count),
    });

    return [
      ...(td.entry?.leagues?.classic || []).map(x => normalize(x, 'Classic')),
      ...(td.entry?.leagues?.h2h || []).map(x => normalize(x, 'H2H')),
    ]
      .filter(x => x.rank > 0)
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  }

  function homeMarkup(td) {
    const entry = td.entry || {};
    const gw = Number(state.publishedGW || entry.current_event || 0);
    const rows = leagueRows(td);
    const showAll = localStorage.getItem(KEYS.showAll) === '1';
    const visible = showAll ? rows : rows.slice(0, 8);

    return `
      <div class="fs-head">
        <div><div class="eyebrow">My FPL</div><h1>Current position</h1></div>
        <div class="fs-meta">After GW${gw || '—'}<br>latest public FPL rank</div>
      </div>

      ${pickerMarkup(td, 'fsHomePicker')}

      <div class="fs-ranks">
        <div class="fs-card fs-rank primary">
          <div class="fs-rank-label">Overall Rank <button class="fs-info" data-info="overall">i</button></div>
          <div class="fs-v">${int(entry.summary_overall_rank)}</div>
          <div class="fs-s">${int(entry.summary_overall_points)} total points</div>
        </div>
        <div class="fs-card fs-rank">
          <div class="fs-rank-label">GW${gw} Rank <button class="fs-info" data-info="gwrank">i</button></div>
          <div class="fs-v">${int(entry.summary_event_rank)}</div>
          <div class="fs-s">${int(entry.summary_event_points)} GW points</div>
        </div>
        <div class="fs-card fs-rank">
          <div class="fs-rank-label">Total Points</div>
          <div class="fs-v">${int(entry.summary_overall_points)}</div>
          <div class="fs-s">Season score</div>
        </div>
        <div class="fs-card fs-rank">
          <div class="fs-rank-label">GW Points</div>
          <div class="fs-v">${int(entry.summary_event_points)}</div>
          <div class="fs-s">Latest completed GW</div>
        </div>
      </div>

      <div class="fs-card">
        <div class="fs-sec-head"><h2>Best league positions</h2><span>best rank first</span></div>
        ${visible.map(l => {
          const mv = rankMovement(l.rank, l.last);
          return `
            <div class="fs-league-row">
              <div class="fs-ln"><b>${esc(l.name)}</b><span>${l.type} · ${l.scoring}</span></div>
              <div class="fs-ls"><span>Position</span><b>#${int(l.rank)}</b></div>
              <div class="fs-ls"><span>Movement</span><b class="${mv.cls}">${mv.text}</b></div>
              <div class="fs-ls fs-league-total"><span>Entries</span><b>${int(l.count)}</b></div>
            </div>`;
        }).join('') || '<div class="empty">No league ranking available.</div>'}
        ${rows.length > 8 ? `
          <button class="fs-show" id="fsShowLeagues">
            ${showAll ? 'Show best 8 only' : `Show all ${rows.length} leagues`}
          </button>` : ''}
      </div>`;
  }

  function renderHome() {
    if (!ready()) return;
    const host = $('#overview');
    let el = $('#fsOwnerHome', host);
    if (!el) {
      el = document.createElement('div');
      el.id = 'fsOwnerHome';
      host.prepend(el);
    }
    const td = selectedTeam(KEYS.homeTeam);
    el.innerHTML = homeMarkup(td);
    $('#fsHomePicker')?.addEventListener('change', e => {
      localStorage.setItem(KEYS.homeTeam, e.target.value);
      renderHome();
    });
    $('#fsShowLeagues')?.addEventListener('click', () => {
      const on = localStorage.getItem(KEYS.showAll) === '1';
      localStorage.setItem(KEYS.showAll, on ? '0' : '1');
      renderHome();
    });
  }

  function photoUrl(p) {
    return n(p.code)
      ? `https://resources.premierleague.com/premierleague/photos/players/110x140/p${p.code}.png`
      : '';
  }

  function photoMarkup(p, className = 'fs-photo') {
    const src = photoUrl(p);
    return `
      <div class="${className}">
        ${src ? `<img data-fsimg src="${src}" alt="${esc(p.web_name)}">` : ''}
        <div class="fs-shirt" ${src ? '' : 'style="display:block"'}></div>
      </div>`;
  }

  function installPhotoFallbacks(root = document) {
    $$('[data-fsimg]', root).forEach(img => {
      const fallback = img.nextElementSibling;
      const fail = () => {
        img.style.display = 'none';
        if (fallback) fallback.style.display = 'block';
      };
      img.addEventListener('error', fail, { once: true });
      if (img.complete && !img.naturalWidth) fail();
    });
  }

  function playerFilterState() {
    const allPositions = ['GKP', 'DEF', 'MID', 'FWD'];
    const allClubs = state.teams.map(t => t.short_name);
    return {
      positions: loadArray(KEYS.positions, allPositions),
      clubs: loadArray(KEYS.clubs, allClubs),
      search: ($('#fsSearch')?.value || '').trim().toLowerCase(),
    };
  }

  function playerRowsMarkup() {
    const f = playerFilterState();
    const rows = state.players
      .filter(p => f.positions.includes(p.pos))
      .filter(p => f.clubs.includes(p.teamCode))
      .filter(p => !f.search || `${p.web_name} ${p.first_name} ${p.second_name} ${p.teamCode}`.toLowerCase().includes(f.search))
      .sort((a, b) => n(b.xp?.[0]) - n(a.xp?.[0]) || n(b.xmins) - n(a.xmins));

    return `
      <div class="fs-prow fs-ph"><div></div><div>Player</div><div>Price</div><div>xMins</div><div>Next GW SZxP</div></div>
      ${rows.map(p => `
        <div class="fs-prow">
          ${photoMarkup(p)}
          <div class="fs-pname">
            <b>${esc(p.web_name)}</b>
            <span>${esc(p.teamCode)} · ${esc(p.pos)} · ${esc((p.fixturesXP || [])[0] || '')}</span>
          </div>
          <div class="fs-cell"><span>Price</span><b>${price(p.now_cost)}</b></div>
          <div class="fs-cell fs-mins"><span>xMins</span><b>${Math.round(n(p.xmins))}</b></div>
          <div class="fs-cell fs-xp"><span>GW${state.nextEvents[0].id} SZxP</span><b>${fmt(p.xp?.[0])}</b></div>
        </div>`).join('') || '<div class="empty">No players match.</div>'}`;
  }

  function playersMarkup() {
    const savedPositions = new Set(loadArray(KEYS.positions, ['GKP', 'DEF', 'MID', 'FWD']));
    const savedClubs = new Set(loadArray(KEYS.clubs, state.teams.map(t => t.short_name)));

    return `
      <div class="fs-head">
        <div><div class="eyebrow">Player Szentre</div><h1>GW${state.nextEvents[0].id} SZxP</h1></div>
        <div class="fs-meta">Next Gameweek only<br>highest SZxP first</div>
      </div>

      <div class="fs-pcontrols">
        <input class="fs-search" id="fsSearch" placeholder="Search player or club…">
        <div class="fs-card fs-filter">
          <div class="fs-filtertop"><b>Positions</b><button data-all="position">All</button></div>
          <div class="fs-checks">
            ${['GKP', 'DEF', 'MID', 'FWD'].map(x => `
              <label class="fs-check"><input data-pos type="checkbox" value="${x}" ${savedPositions.has(x) ? 'checked' : ''}><span>${x}</span></label>`).join('')}
          </div>
        </div>
        <div class="fs-card fs-filter">
          <div class="fs-filtertop"><b>Clubs</b><button data-all="club">All</button></div>
          <div class="fs-checks">
            ${state.teams.map(t => `
              <label class="fs-check"><input data-club type="checkbox" value="${t.short_name}" ${savedClubs.has(t.short_name) ? 'checked' : ''}><span>${esc(t.short_name)}</span></label>`).join('')}
          </div>
        </div>
      </div>
      <div class="fs-card" id="fsRows">${playerRowsMarkup()}</div>`;
  }

  function renderPlayerRows() {
    const box = $('#fsRows');
    if (!box) return;
    box.innerHTML = playerRowsMarkup();
    installPhotoFallbacks(box);
  }

  function renderPlayers() {
    if (!ready()) return;
    const host = $('#players');
    let el = $('#fsPlayerClean', host);
    if (!el) {
      el = document.createElement('div');
      el.id = 'fsPlayerClean';
      host.prepend(el);
    }
    el.innerHTML = playersMarkup();
    installPhotoFallbacks(el);

    $('#fsSearch')?.addEventListener('input', renderPlayerRows);
    $$('[data-pos]').forEach(x => x.addEventListener('change', () => {
      saveArray(KEYS.positions, $$('[data-pos]:checked').map(y => y.value));
      renderPlayerRows();
    }));
    $$('[data-club]').forEach(x => x.addEventListener('change', () => {
      saveArray(KEYS.clubs, $$('[data-club]:checked').map(y => y.value));
      renderPlayerRows();
    }));
    $$('[data-all]').forEach(btn => btn.addEventListener('click', () => {
      const boxes = btn.dataset.all === 'position' ? $$('[data-pos]') : $$('[data-club]');
      boxes.forEach(x => x.checked = true);
      saveArray(btn.dataset.all === 'position' ? KEYS.positions : KEYS.clubs, boxes.map(x => x.value));
      renderPlayerRows();
    }));
  }

  function squadIdsAfterMoves(td, moves) {
    let ids = teamSquad(td).map(p => p.id);
    for (const m of (moves || [])) {
      ids = ids.map(id => Number(id) === Number(m.out.id) ? m.inc.id : id);
    }
    return ids;
  }

  function transferPlan(td) {
    try {
      const result = optimiseTransferScenarios(td, '4gw');
      const baseIds = teamSquad(td).map(p => p.id);
      const base1 = squadScore(baseIds, 'gw1');
      const base4 = squadScore(baseIds, '4gw');
      const core = window.SzentreCommercialCore;

      const options = (result.scenarios || [])
        .filter(s => n(s.k) <= Math.max(3, n(result.ft) + 1))
        .map(s => {
          const ids = squadIdsAfterMoves(td, s.moves);
          const gain1 = squadScore(ids, 'gw1') - base1;
          const gain4 = squadScore(ids, '4gw') - base4;
          const hit = n(s.hit);
          const minsSwing = (s.moves || []).reduce((z, m) => z + n(m.inc.xmins) - n(m.out.xmins), 0);
          const fixtureSwing = (s.moves || []).reduce((z, m) => z + n(m.inc.xp?.[0]) - n(m.out.xp?.[0]), 0);

          let score = s.k ? 50 + gain1 * 8 + gain4 * 2 - hit * 5 : 0;
          if (core && s.k) {
            score = core.transferSzentre({
              nextGain: gain1,
              fourGain: gain4,
              hit,
              fixtureSwing,
              minutesAvailabilityImprovement: minsSwing,
              structureFlexibility: 50,
            }).score;
          }

          return {
            ...s,
            score,
            nextNet: gain1 - hit,
            fourNet: gain4 - hit,
            route: (s.moves || []).length
              ? s.moves.map(m => `${m.out.web_name} → ${m.inc.web_name}`).join(' · ')
              : 'Hold squad',
          };
        });

      const roll = options.find(x => n(x.k) === 0);
      const moves = options.filter(x => n(x.k) > 0).sort((a, b) => b.score - a.score);
      let best = roll;
      for (const option of moves) {
        const pass = core
          ? core.transferDecision({ score: option.score, hit: option.hit, risk: 'balanced' }).action !== 'ROLL'
          : option.score >= 70;
        if (pass) { best = option; break; }
      }

      return { best: best || roll, alternatives: moves.filter(x => x !== best).slice(0, 3) };
    } catch (e) {
      console.warn('Team transfer plan failed', e);
      return { best: null, alternatives: [] };
    }
  }

  function chipPlan(td) {
    try {
      const plan = firstHalfChipPlan(td);
      const best = plan?.best;
      const gw = Number(state.nextEvents[0].id);
      if (best && Number(best.gw) === gw) {
        return { call: best.chip, detail: best.detail || 'Best current window' };
      }
      return {
        call: 'NO CHIP',
        detail: best ? `${best.chip} currently rates better in GW${best.gw}` : 'No strong chip window detected',
      };
    } catch {
      return { call: 'NO CHIP', detail: 'No strong chip window detected' };
    }
  }

  function ownedAlerts(td) {
    const ids = new Set((td.picks?.picks || []).map(x => Number(x.element)));
    return state.players
      .filter(p => ids.has(Number(p.id)))
      .filter(p => p.status !== 'a' || n(p.xmins) < 58 || (p.news && String(p.news).trim()))
      .sort((a, b) => n(a.xmins) - n(b.xmins));
  }

  function pitchPlayer(p, captain, vice) {
    const role = p.id === captain?.id ? 'C' : p.id === vice?.id ? 'VC' : '';
    const src = photoUrl(p);
    return `
      <div class="fs-pp">
        <div class="fs-pph">
          ${src ? `<img data-fsimg src="${src}" alt="${esc(p.web_name)}">` : ''}
          <div class="fs-shirt" ${src ? '' : 'style="display:block;margin:15px auto"'}></div>
          ${role ? `<span class="fs-role ${role === 'VC' ? 'vc' : ''}">${role}</span>` : ''}
        </div>
        <span class="fs-ppn">${esc(p.web_name)}</span>
        <span class="fs-ppx">${fmt(p.xp?.[0])} xP</span>
      </div>`;
  }

  function pitchMarkup(projection) {
    const groups = ['GKP', 'DEF', 'MID', 'FWD'].map(pos =>
      (projection.xi || []).filter(p => p.pos === pos)
    );
    return `
      <div class="fs-pitch">
        ${groups.map(row => `<div class="fs-pitch-row">${row.map(p => pitchPlayer(p, projection.captain, projection.vice)).join('')}</div>`).join('')}
      </div>`;
  }

  function teamHubMarkup(td) {
    const projection = teamProjection(td);
    const ft = inferredFreeTransfers(td);
    const bank = n(td.picks?.entry_history?.bank);
    const transfers = transferPlan(td);
    const chip = chipPlan(td);
    const warnings = ownedAlerts(td);
    const xiIds = new Set((projection.xi || []).map(p => p.id));
    const bench = (projection.players || [])
      .filter(p => !xiIds.has(p.id))
      .sort((a, b) => n(b.xp?.[0]) - n(a.xp?.[0]));

    const t = transfers.best;
    const isMove = t && n(t.k) > 0;
    const transferLabel = isMove
      ? (t.hit ? `${t.k} TRANSFERS · -${t.hit}` : `${t.k} TRANSFER${t.k > 1 ? 'S' : ''}`)
      : 'ROLL';

    return `
      <div class="fs-head">
        <div><div class="eyebrow">My Team</div><h1>GW${state.nextEvents[0].id} Plan</h1></div>
        <div class="fs-meta">Everything for this team<br>on one page</div>
      </div>

      ${pickerMarkup(td, 'fsHubPicker')}

      <div class="fs-summary">
        <div class="fs-card"><div class="fs-k">Projected</div><div class="fs-v">${fmt(projection.xp1)}</div><div class="fs-s">XI + captain</div></div>
        <div class="fs-card"><div class="fs-k">Free Transfers</div><div class="fs-v">${ft}</div><div class="fs-s">locked baseline</div></div>
        <div class="fs-card"><div class="fs-k">Bank</div><div class="fs-v">${price(bank)}</div><div class="fs-s">locked baseline</div></div>
        <div class="fs-card"><div class="fs-k">Alerts</div><div class="fs-v">${warnings.length}</div><div class="fs-s">players to review</div></div>
      </div>

      <div class="fs-plan-grid">
        <div class="fs-card fs-plan">
          <div class="fs-plan-top"><div><div class="fs-k">Transfer suggestion</div><h2>${esc(transferLabel)}</h2></div><button class="fs-info" data-info="transfer">i</button></div>
          <div class="fs-plan-main"><b>${t ? esc(t.route) : 'No route available'}</b><span>${isMove ? 'This route clears the Commercial Core action threshold.' : 'No move clears the action threshold strongly enough.'}</span></div>
          <div class="fs-plan-stats">
            <span class="fs-badge ${isMove ? 'accent' : ''}">Next ${t ? `${t.nextNet >= 0 ? '+' : ''}${fmt(t.nextNet)} xP` : '—'}</span>
            <span class="fs-badge">4GW ${t ? `${t.fourNet >= 0 ? '+' : ''}${fmt(t.fourNet)} xP` : '—'}</span>
            ${t?.hit ? `<span class="fs-badge danger">-${t.hit} hit</span>` : ''}
          </div>
        </div>

        <div class="fs-card fs-plan">
          <div class="fs-plan-top"><div><div class="fs-k">Chip suggestion</div><h2>${esc(chip.call)}</h2></div><button class="fs-info" data-info="chip">i</button></div>
          <div class="fs-plan-main"><b>${chip.call === 'NO CHIP' ? 'Save the chip' : 'Review this chip now'}</b><span>${esc(chip.detail)}</span></div>
          <div class="fs-plan-stats"><span class="fs-badge ${chip.call === 'NO CHIP' ? '' : 'accent'}">GW${state.nextEvents[0].id}</span><span class="fs-badge">season-aware</span></div>
        </div>
      </div>

      <div class="fs-sec-head" style="padding-left:0;padding-right:0;border:0"><h2>Starting XI · ${esc(projection.formation || '—')}</h2><span>C ${esc(projection.captain?.web_name || '—')} · VC ${esc(projection.vice?.web_name || '—')}</span></div>
      ${pitchMarkup(projection)}

      <div class="fs-card fs-bench">
        <div class="fs-sec-head"><h2>Bench order</h2><span>next-GW SZxP</span></div>
        <div class="fs-benchgrid">
          ${bench.map((p, i) => `<div class="fs-bp"><div class="fs-k">${i + 1}</div><b>${esc(p.web_name)}</b><span>${fmt(p.xp?.[0])} xP · ${Math.round(n(p.xmins))} xMins</span></div>`).join('')}
        </div>
      </div>

      <div class="fs-card" style="margin-top:9px">
        <div class="fs-sec-head"><h2>Squad warnings</h2><span>${warnings.length}</span></div>
        ${warnings.map(p => `<div class="fs-alert"><div><b>${esc(p.web_name)} · ${esc(p.teamCode)}</b><span>${esc(p.news || `${Math.round(n(p.xmins))} expected minutes`)}</span></div><span class="fs-badge ${n(p.xmins) < 45 ? 'danger' : 'warn'}">${Math.round(n(p.xmins))} xMins</span></div>`).join('') || '<div class="empty" style="padding:18px">No urgent squad warning.</div>'}
      </div>

      ${transfers.alternatives.length ? `
        <details class="fs-card fs-details">
          <summary>Other transfer options</summary>
          ${transfers.alternatives.map(a => `<div class="fs-option"><b>${esc(a.route)}</b><span>${a.hit ? `-${a.hit}` : 'Free'}</span><span>${a.nextNet >= 0 ? '+' : ''}${fmt(a.nextNet)} next</span><span class="fs-four">${a.fourNet >= 0 ? '+' : ''}${fmt(a.fourNet)} 4GW</span></div>`).join('')}
        </details>` : ''}`;
  }

  function renderTeamHub() {
    if (!ready()) return;
    const host = $('#teams');
    let el = $('#fsTeamHub', host);
    if (!el) {
      el = document.createElement('div');
      el.id = 'fsTeamHub';
      host.prepend(el);
    }
    const td = selectedTeam(KEYS.hubTeam);
    el.innerHTML = teamHubMarkup(td);
    installPhotoFallbacks(el);
    $('#fsHubPicker')?.addEventListener('change', e => {
      localStorage.setItem(KEYS.hubTeam, e.target.value);
      renderTeamHub();
    });
  }

  async function fetchJSON(path) {
    const res = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  const latestAccuracy = a => [...(a?.gameweeks || [])].sort((x, y) => n(x.gw) - n(y.gw)).at(-1) || null;

  async function toggleAccuracy() {
    const panel = $('#fsAcc');
    if (!panel) return;
    if (!panel.hidden) { panel.hidden = true; return; }
    panel.hidden = false;
    panel.innerHTML = '<div class="fs-s">Loading comparison…</div>';

    if (!accuracyCache) {
      const [a30, a22, a21] = await Promise.all([
        fetchJSON('data/accuracy-3.0.json').catch(() => ({ gameweeks: [] })),
        fetchJSON('data/accuracy-2.2.json').catch(() => ({ gameweeks: [] })),
        fetchJSON('data/accuracy.json').catch(() => ({ gameweeks: [] })),
      ]);
      accuracyCache = { a30, a22, a21 };
    }

    const p = latestAccuracy(accuracyCache.a30);
    const s = latestAccuracy(accuracyCache.a22);
    panel.innerHTML = `
      <div class="fs-sec-head" style="padding:0 0 9px;border:0"><h2>Model comparison</h2><span>lower MAE is better</span></div>
      <div class="fs-accgrid">
        <div class="fs-card"><div class="fs-k">3.0 latest</div><div class="fs-v">${p ? `GW${p.gw}` : 'Waiting'}</div></div>
        <div class="fs-card"><div class="fs-k">3.0 Player MAE</div><div class="fs-v">${p?.relevant?.mae == null ? '—' : fmt(p.relevant.mae, 3)}</div></div>
        <div class="fs-card"><div class="fs-k">2.2 Shadow</div><div class="fs-v">${s?.relevant?.mae == null ? '—' : fmt(s.relevant.mae, 3)}</div></div>
        <div class="fs-card"><div class="fs-k">3.0 Team MAE</div><div class="fs-v">${p?.team_mae == null ? '—' : fmt(p.team_mae, 3)}</div></div>
      </div>`;
  }

  function moreMarkup() {
    return `
      <div class="fs-head"><div><div class="eyebrow">More</div><h1>Details & tools</h1></div></div>
      <div class="fs-more">
        <div class="fs-card"><h2>Model comparison</h2><p>3.0 production vs shadow benchmarks, away from your weekly Home.</p><button class="fs-morebtn" id="fsAccBtn">View comparison</button></div>
        <div class="fs-card"><h2>Portfolio transfers</h2><p>Advanced all-nine-team transfer control room.</p><button class="fs-morebtn" data-open="transfers">Open portfolio tool</button></div>
        <div class="fs-card"><h2>Market & injuries</h2><p>Most bought/sold players, price pressure and FPL flags.</p><button class="fs-morebtn" data-open="market">Open market</button></div>
        <div class="fs-card"><h2>About the numbers</h2><p>SZxP, xMins, Transfer Szentre and chip call explanations.</p><button class="fs-morebtn" data-info="numbers">Explain</button></div>
      </div>
      <div class="fs-card fs-acc" id="fsAcc" hidden></div>`;
  }

  function renderMore() {
    if (!ready()) return;
    const el = $('#more');
    if (!el) return;
    el.innerHTML = moreMarkup();
    $('#fsAccBtn')?.addEventListener('click', toggleAccuracy);
  }

  function infoContent(key) {
    return ({
      overall: ['Overall Rank', 'Your current season rank across all FPL managers. Lower is better.'],
      gwrank: ['Gameweek Rank', 'Your rank for the latest completed Gameweek only.'],
      transfer: ['Transfer suggestion', 'The team call compares ROLL against modelled legal routes. A hit needs a stronger edge than a free transfer.'],
      chip: ['Chip suggestion', 'The chip call is season-aware. If another Gameweek rates as the better window, the answer stays NO CHIP.'],
      numbers: ['About the numbers', 'SZxP is projected Fantasy points for the next Gameweek. xMins is expected playing time. Transfer Szentre scores a move using immediate gain, multi-Gameweek gain, hit cost, fixture swing and availability.'],
    }[key] || ['Fantaszy Szentre', 'Extra detail is hidden here so weekly pages stay clean.']);
  }

  function installModal() {
    if ($('#fsModal')) return;
    const modal = document.createElement('div');
    modal.id = 'fsModal';
    modal.className = 'fs-modal';
    modal.innerHTML = '<div class="fs-modalbox"><div class="fs-modalhead"><h2 id="fsMT"></h2><button class="fs-close" id="fsMC">×</button></div><p id="fsMB"></p></div>';
    document.body.appendChild(modal);
    $('#fsMC').addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
  }

  function showInfo(key) {
    const [title, body] = infoContent(key);
    $('#fsMT').textContent = title;
    $('#fsMB').textContent = body;
    $('#fsModal').classList.add('open');
  }

  function openPage(name) {
    if (typeof openView === 'function') openView(name);
    else {
      $$('.view').forEach(v => v.classList.toggle('active', v.id === name));
      $$('.nav-item').forEach(v => v.classList.toggle('active', v.dataset.view === name));
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      if (rendering) return;
      rendering = true;
      try {
        installModal();
        if (ready()) {
          renderHome();
          renderPlayers();
          renderTeamHub();
          renderMore();
        }
      } finally {
        setTimeout(() => { rendering = false; }, 50);
      }
    }, 100);
  }

  document.body.addEventListener('click', e => {
    const info = e.target.closest('[data-info]');
    if (info) { showInfo(info.dataset.info); return; }
    const open = e.target.closest('[data-open]');
    if (open) { openPage(open.dataset.open); return; }
  });

  new MutationObserver(scheduleRender).observe(document.body, { childList: true, subtree: true });
  installModal();
  scheduleRender();
  window.addEventListener('load', scheduleRender);
  window.FSOwnerUI = { version: VERSION, render: scheduleRender };
})();
