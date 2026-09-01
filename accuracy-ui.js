(() => {
  'use strict';

  const VERSION = '20260901-accuracy2';
  const TEAM_NAMES = {
    113200: 'Joaoassic Park',
    119375: 'Permas Jaya FC',
    114940: 'KK Old Boys FC',
    139195: 'Toastin Adarabioyo',
    131073: 'Enzopreneur',
    132558: 'Colwill of Fortune',
    128817: 'Palmerlaysia Boleh!',
    137607: 'Roger and Out',
    130090: 'Petrol Neto',
  };

  let rendering = false;
  let lastPayload = null;

  const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
  }[c]));

  const fmt = (n, d=2) =>
    n === null || n === undefined || Number.isNaN(Number(n))
      ? 'N/A'
      : Number(n).toFixed(d);

  function chipName(chip) {
    if (!chip) return '—';
    return ({bboost:'BB','3xc':'TC',wildcard:'WC',freehit:'FH'})[chip]
      || String(chip).toUpperCase();
  }

  function biasText(v) {
    if (v === null || v === undefined) return 'N/A';
    const n = Number(v);
    if (Math.abs(n) < 0.005) return `${fmt(n)} · neutral`;
    return `${fmt(n)} · ${n > 0 ? 'overpredicted' : 'underpredicted'}`;
  }

  async function fetchJSON(path) {
    const res = await fetch(`${path}?v=${Date.now()}`, {cache:'no-store'});
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return res.json();
  }

  async function getPayload() {
    const [prod, shadow, backcast] = await Promise.all([
      fetchJSON('data/accuracy-2.2.json').catch(() => ({gameweeks:[],summary:{}})),
      fetchJSON('data/accuracy.json').catch(() => ({gameweeks:[],summary:{}})),
      fetchJSON('data/backtests/gw1.json').catch(() => null),
    ]);
    return {prod, shadow, backcast};
  }

  const gwMap = acc => Object.fromEntries(
    (acc?.gameweeks || []).map(g => [Number(g.gw), g])
  );

  function latestRow(payload) {
    const prodRows = payload?.prod?.gameweeks || [];
    if (prodRows.length) {
      return [...prodRows].sort((a,b)=>Number(a.gw)-Number(b.gw)).at(-1);
    }
    const shadowRows = payload?.shadow?.gameweeks || [];
    return [...shadowRows].sort((a,b)=>Number(a.gw)-Number(b.gw)).at(-1) || null;
  }

  function updateTopAccuracyCard(overview, payload) {
    const latest = latestRow(payload);
    if (!latest) return;
    const isProd = (payload?.prod?.gameweeks || []).some(g => Number(g.gw) === Number(latest.gw));
    const cards = [...overview.querySelectorAll('.grid.stats > .card')];
    const card = cards.find(c =>
      (c.querySelector('.stat-label')?.textContent || '').includes('Model') ||
      (c.querySelector('.stat-label')?.textContent || '').includes('Prediction Accuracy')
    );
    if (!card) return;

    card.innerHTML = `
      <div class="stat-label">Prediction Accuracy</div>
      <div class="stat-value">GW${latest.gw}</div>
      <div class="stat-note">${isProd ? 'SZxP 2.2' : 'SZxP 2.1 baseline'} · Player MAE ${fmt(latest.relevant?.mae)}</div>
    `;
  }

  function removeOldGw1Card(overview) {
    [...overview.querySelectorAll('.section.card')].forEach(section => {
      if (section.id === 'predictionAccuracyUpgrade') return;
      const title = section.querySelector('h2')?.textContent?.trim() || '';
      if (title === 'GW1 SZxP vs Actual') section.remove();
    });
  }

  function pairTeams(prod, shadow) {
    const pm = Object.fromEntries((prod?.teams || []).map(t => [Number(t.entry_id), t]));
    const sm = Object.fromEntries((shadow?.teams || []).map(t => [Number(t.entry_id), t]));
    const ids = [...new Set([...Object.keys(pm), ...Object.keys(sm)].map(Number))];

    if (!ids.length) {
      return `<tr><td colspan="6">Team-level locked comparison is not available for this Gameweek.</td></tr>`;
    }

    return ids.map(id => {
      const p = pm[id];
      const s = sm[id];
      const actual = p?.actual_points ?? s?.actual_points;
      const delta = p?.actual_minus_szxp;
      const chip = p?.active_chip ?? s?.active_chip;
      return `<tr>
        <td><b>${esc(p?.team_name || s?.team_name || TEAM_NAMES[id] || id)}</b></td>
        <td>${fmt(p?.locked_szxp,1)}</td>
        <td>${fmt(s?.locked_szxp,1)}</td>
        <td class="xp">${fmt(actual,0)}</td>
        <td class="${delta == null ? '' : Number(delta)>=0 ? 'delta-up':'delta-down'}">${delta == null ? 'N/A' : `${Number(delta)>=0?'+':''}${fmt(delta,1)}`}</td>
        <td>${esc(chipName(chip))}</td>
      </tr>`;
    }).join('');
  }

  function gw1Markup(bt) {
    if (!bt?.teams?.length) return '';
    const rows = bt.teams.filter(x => !x.error).map(x => {
      const delta = Number(x.actual_minus_szxp || 0);
      return `<tr>
        <td><b>${esc(TEAM_NAMES[x.entry_id] || x.entry_id)}</b></td>
        <td>${fmt(x.retrospective_szxp,1)}</td>
        <td>${fmt(x.actual_points,0)}</td>
        <td class="${delta>=0?'delta-up':'delta-down'}">${delta>=0?'+':''}${fmt(delta,1)}</td>
        <td>${esc(chipName(x.active_chip))}</td>
      </tr>`;
    }).join('');

    return `<details style="margin-top:16px">
      <summary><b>GW1 Backcast Reference</b></summary>
      <div class="notice warn" style="margin-top:12px">
        GW1 was generated retrospectively using post-GW1 information. It contains hindsight leakage and is NOT included in genuine season prediction accuracy.
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Team</th><th>GW1 SZxP</th><th>Actual</th><th>Actual − SZxP</th><th>Chip</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="model-note">Retrospective player MAE: ${fmt(bt.player_relevant_mae)} · reference only.</p>
    </details>`;
  }

  function seasonRows(payload) {
    const pm = gwMap(payload.prod);
    const sm = gwMap(payload.shadow);
    const gws = [...new Set([...Object.keys(pm), ...Object.keys(sm)].map(Number))]
      .sort((a,b)=>b-a);

    if (!gws.length) return '<tr><td colspan="7">No genuine Gameweek scored yet.</td></tr>';

    return gws.map(gw => {
      const p = pm[gw];
      const s = sm[gw];
      return `<tr>
        <td><b>GW${gw}</b></td>
        <td>${fmt(p?.relevant?.mae)}</td>
        <td>${fmt(s?.relevant?.mae)}</td>
        <td>${fmt(p?.team_mae)}</td>
        <td>${fmt(s?.team_mae)}</td>
        <td>${fmt(p?.relevant?.bias)}</td>
        <td>${p?.relevant?.n ?? s?.relevant?.n ?? 0}</td>
      </tr>`;
    }).join('');
  }

  function comparableSummary(payload) {
    const pm = gwMap(payload.prod);
    const sm = gwMap(payload.shadow);
    const common = Object.keys(pm).map(Number).filter(gw => sm[gw]);

    const avg = (arr, getter, ngetter) => {
      const vals = arr.map(gw => [getter(gw), ngetter(gw)])
        .filter(([v,n]) => v != null && n);
      if (!vals.length) return null;
      const n = vals.reduce((a,[,w])=>a+Number(w),0);
      return vals.reduce((a,[v,w])=>a+Number(v)*Number(w),0)/n;
    };

    return {
      common,
      pMae: avg(common, gw=>pm[gw]?.relevant?.mae, gw=>pm[gw]?.relevant?.n),
      sMae: avg(common, gw=>sm[gw]?.relevant?.mae, gw=>sm[gw]?.relevant?.n),
      pTeam: avg(common, gw=>pm[gw]?.team_mae, gw=>pm[gw]?.team_predictions_evaluated),
      sTeam: avg(common, gw=>sm[gw]?.team_mae, gw=>sm[gw]?.team_predictions_evaluated),
      pBias: avg(common, gw=>pm[gw]?.relevant?.bias, gw=>pm[gw]?.relevant?.n),
    };
  }

  function buildMarkup(payload) {
    const prodRows = payload?.prod?.gameweeks || [];
    const shadowRows = payload?.shadow?.gameweeks || [];
    const prodLatest = [...prodRows].sort((a,b)=>Number(a.gw)-Number(b.gw)).at(-1);
    const shadowMap = gwMap(payload.shadow);

    // Until the first genuine 2.2 GW is completed, retain GW2 2.1 as the main
    // historical card and explicitly state where production benchmarking begins.
    if (!prodLatest) {
      const latest21 = [...shadowRows].sort((a,b)=>Number(a.gw)-Number(b.gw)).at(-1);
      if (!latest21) {
        return `<div class="section-head"><h2>Prediction Accuracy</h2></div>
          <div class="notice">Waiting for the first final genuine prediction Gameweek.</div>
          ${gw1Markup(payload.backcast)}`;
      }
      return `
        <div class="section-head">
          <h2>GW${latest21.gw} SZxP vs Actual</h2>
          <span class="stat-note">SZxP 2.1 · genuine baseline</span>
        </div>
        <div class="grid stats">
          <div class="card"><div class="stat-label">Player MAE</div><div class="stat-value">${fmt(latest21.relevant?.mae)}</div><div class="stat-note">${latest21.relevant?.n ?? 0} predictions</div></div>
          <div class="card"><div class="stat-label">Team MAE</div><div class="stat-value">${fmt(latest21.team_mae)}</div><div class="stat-note">${latest21.team_predictions_evaluated ?? 0} teams</div></div>
          <div class="card"><div class="stat-label">Mean Bias</div><div class="stat-value">${fmt(latest21.relevant?.bias)}</div><div class="stat-note">${esc(biasText(latest21.relevant?.bias))}</div></div>
        </div>
        <div class="notice">SZxP 2.2 is now the production model. Its first genuine accuracy comparison begins with GW3 after final FPL points are confirmed. GW2 remains a 2.1-only baseline.</div>
        ${gw1Markup(payload.backcast)}
      `;
    }

    const gw = Number(prodLatest.gw);
    const shadow = shadowMap[gw];
    const cmp = comparableSummary(payload);
    const diff = (prodLatest.relevant?.mae != null && shadow?.relevant?.mae != null)
      ? Number(prodLatest.relevant.mae) - Number(shadow.relevant.mae)
      : null;

    return `
      <div class="section-head">
        <h2>GW${gw} SZxP 2.2 vs Actual</h2>
        <span class="stat-note">2.2 production · 2.1 shadow</span>
      </div>

      <div class="grid stats">
        <div class="card">
          <div class="stat-label">2.2 Player MAE</div>
          <div class="stat-value">${fmt(prodLatest.relevant?.mae)}</div>
          <div class="stat-note">${prodLatest.relevant?.n ?? 0} predictions · lower is better</div>
        </div>
        <div class="card">
          <div class="stat-label">2.1 Shadow MAE</div>
          <div class="stat-value">${fmt(shadow?.relevant?.mae)}</div>
          <div class="stat-note">${diff == null ? 'comparison pending' : `${diff < 0 ? '2.2 better by' : diff > 0 ? '2.1 better by' : 'tied'} ${fmt(Math.abs(diff))}`}</div>
        </div>
        <div class="card">
          <div class="stat-label">2.2 Team MAE</div>
          <div class="stat-value">${fmt(prodLatest.team_mae)}</div>
          <div class="stat-note">${prodLatest.team_predictions_evaluated ?? 0} teams evaluated</div>
        </div>
        <div class="card">
          <div class="stat-label">2.2 Mean Bias</div>
          <div class="stat-value">${fmt(prodLatest.relevant?.bias)}</div>
          <div class="stat-note">${esc(biasText(prodLatest.relevant?.bias))}</div>
        </div>
      </div>

      <div class="table-wrap"><table>
        <thead><tr><th>Team</th><th>2.2 Locked</th><th>2.1 Shadow</th><th>Actual</th><th>Actual − 2.2</th><th>Chip</th></tr></thead>
        <tbody>${pairTeams(prodLatest, shadow)}</tbody>
      </table></div>

      <p class="model-note">
        Main recommendations use SZxP 2.2. SZxP 2.1 continues to generate its own pre-deadline shadow snapshot so both models are compared against the same final FPL Gameweek.
      </p>

      <div class="section-head" style="margin-top:18px">
        <h2>Production vs Shadow Accuracy</h2>
        <span class="stat-note">${cmp.common.length ? `common GWs: ${cmp.common.map(g=>`GW${g}`).join(', ')}` : 'waiting for first common completed GW'}</span>
      </div>

      <div class="grid stats">
        <div class="card"><div class="stat-label">2.2 Comparable MAE</div><div class="stat-value">${fmt(cmp.pMae)}</div><div class="stat-note">production · common GWs only</div></div>
        <div class="card"><div class="stat-label">2.1 Comparable MAE</div><div class="stat-value">${fmt(cmp.sMae)}</div><div class="stat-note">shadow · common GWs only</div></div>
        <div class="card"><div class="stat-label">2.2 Comparable Team MAE</div><div class="stat-value">${fmt(cmp.pTeam)}</div><div class="stat-note">same Gameweeks</div></div>
        <div class="card"><div class="stat-label">2.2 Comparable Bias</div><div class="stat-value">${fmt(cmp.pBias)}</div><div class="stat-note">${esc(biasText(cmp.pBias))}</div></div>
      </div>

      <div class="table-wrap"><table>
        <thead><tr><th>GW</th><th>2.2 Player MAE</th><th>2.1 Player MAE</th><th>2.2 Team MAE</th><th>2.1 Team MAE</th><th>2.2 Bias</th><th>N</th></tr></thead>
        <tbody>${seasonRows(payload)}</tbody>
      </table></div>

      ${gw1Markup(payload.backcast)}
    `;
  }

  async function render(forceFetch=false) {
    if (rendering) return;
    const overview = document.querySelector('#overview');
    if (!overview || !overview.children.length) return;

    rendering = true;
    try {
      if (!lastPayload || forceFetch) lastPayload = await getPayload();
      removeOldGw1Card(overview);
      updateTopAccuracyCard(overview, lastPayload);

      let holder = document.querySelector('#predictionAccuracyUpgrade');
      if (!holder) {
        holder = document.createElement('div');
        holder.id = 'predictionAccuracyUpgrade';
        holder.className = 'section card';
        const stats = overview.querySelector('.grid.stats');
        if (stats?.parentNode) stats.insertAdjacentElement('afterend', holder);
        else overview.prepend(holder);
      }
      holder.innerHTML = buildMarkup(lastPayload);
    } catch (err) {
      console.warn('Accuracy UI:', err);
    } finally {
      rendering = false;
    }
  }

  const overview = document.querySelector('#overview');
  if (overview) {
    const observer = new MutationObserver(() => {
      if (!rendering) setTimeout(() => render(false), 50);
    });
    observer.observe(overview, {childList:true});
  }

  document.addEventListener('click', e => {
    if (e.target?.closest?.('#refreshBtn')) {
      lastPayload = null;
      setTimeout(() => render(true), 900);
    }
    if (e.target?.closest?.('[data-view="overview"]')) {
      setTimeout(() => render(false), 80);
    }
  });

  window.addEventListener('load', () => setTimeout(() => render(true), 150));
  setTimeout(() => render(true), 500);

  window.FSAccuracyUI = {version: VERSION, render: () => render(true)};
})();
