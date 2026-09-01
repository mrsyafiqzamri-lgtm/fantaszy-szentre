(() => {
  'use strict';

  const VERSION = '20260901-accuracy1';
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
    return ({
      bboost: 'BB',
      '3xc': 'TC',
      wildcard: 'WC',
      freehit: 'FH',
    })[chip] || String(chip).toUpperCase();
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
    const [accuracy, backcast] = await Promise.all([
      fetchJSON('data/accuracy.json'),
      fetchJSON('data/backtests/gw1.json').catch(() => null),
    ]);
    return {accuracy, backcast};
  }

  function removeOldGw1Card(overview) {
    [...overview.querySelectorAll('.section.card')].forEach(section => {
      if (section.id === 'predictionAccuracyUpgrade') return;
      const title = section.querySelector('h2')?.textContent?.trim() || '';
      if (title === 'GW1 SZxP vs Actual') section.remove();
    });
  }

  function updateTopAccuracyCard(overview, latest) {
    if (!latest) return;
    const cards = [...overview.querySelectorAll('.grid.stats > .card')];
    const card = cards.find(c =>
      (c.querySelector('.stat-label')?.textContent || '').includes('Model')
    );
    if (!card) return;

    const mae = latest.relevant?.mae;
    const n = latest.relevant?.n;
    card.innerHTML = `
      <div class="stat-label">Prediction Accuracy</div>
      <div class="stat-value">GW${latest.gw}</div>
      <div class="stat-note">Player MAE ${fmt(mae)} · ${n ?? 0} predictions · final FPL data</div>
    `;
  }

  function teamRows(latest) {
    const teams = latest?.teams || [];
    if (!teams.length) {
      return `<tr><td colspan="5">Team-level locked comparison is not available for this Gameweek.</td></tr>`;
    }

    return teams.map(t => {
      if (t.error) {
        return `<tr>
          <td><b>${esc(t.team_name || TEAM_NAMES[t.entry_id] || t.entry_id)}</b></td>
          <td colspan="4">N/A</td>
        </tr>`;
      }
      const delta = Number(t.actual_minus_szxp || 0);
      return `<tr>
        <td><b>${esc(t.team_name || TEAM_NAMES[t.entry_id] || t.entry_id)}</b></td>
        <td>${fmt(t.locked_szxp, 1)}</td>
        <td class="xp">${fmt(t.actual_points, 0)}</td>
        <td class="${delta >= 0 ? 'delta-up' : 'delta-down'}">${delta >= 0 ? '+' : ''}${fmt(delta, 1)}</td>
        <td>${esc(chipName(t.active_chip))}</td>
      </tr>`;
    }).join('');
  }

  function seasonRows(gameweeks) {
    if (!gameweeks?.length) return '<tr><td colspan="6">No genuine Gameweek scored yet.</td></tr>';
    return [...gameweeks]
      .sort((a,b) => Number(b.gw) - Number(a.gw))
      .map(g => `<tr>
        <td><b>GW${g.gw}</b></td>
        <td>${esc(g.model_version || '—')}</td>
        <td>${fmt(g.relevant?.mae)}</td>
        <td>${fmt(g.team_mae)}</td>
        <td>${fmt(g.relevant?.bias)}</td>
        <td>${g.relevant?.n ?? 0}</td>
      </tr>`).join('');
  }

  function gw1Markup(bt) {
    if (!bt?.teams?.length) return '';
    const rows = bt.teams.filter(x => !x.error).map(x => {
      const delta = Number(x.actual_minus_szxp || 0);
      return `<tr>
        <td><b>${esc(TEAM_NAMES[x.entry_id] || x.entry_id)}</b></td>
        <td>${fmt(x.retrospective_szxp, 1)}</td>
        <td>${fmt(x.actual_points, 0)}</td>
        <td class="${delta >= 0 ? 'delta-up' : 'delta-down'}">${delta >= 0 ? '+' : ''}${fmt(delta, 1)}</td>
        <td>${esc(chipName(x.active_chip))}</td>
      </tr>`;
    }).join('');

    return `
      <details style="margin-top:16px">
        <summary><b>GW1 Backcast Reference</b></summary>
        <div class="notice warn" style="margin-top:12px">
          GW1 was generated retrospectively using post-GW1 information. It contains hindsight leakage and is NOT included in genuine season prediction accuracy.
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Team</th><th>GW1 SZxP</th><th>Actual</th><th>Actual − SZxP</th><th>Chip</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <p class="model-note">Retrospective player MAE: ${fmt(bt.player_relevant_mae)} · reference only.</p>
      </details>
    `;
  }

  function buildMarkup(payload) {
    const accuracy = payload?.accuracy || {};
    const gameweeks = accuracy.gameweeks || [];
    const latest = [...gameweeks].sort((a,b) => Number(a.gw) - Number(b.gw)).at(-1);
    const summary = accuracy.summary || {};

    if (!latest) {
      return `
        <div class="section-head"><h2>Prediction Accuracy</h2><span class="stat-note">waiting for final FPL data</span></div>
        <div class="notice">The first genuine locked comparison begins from GW2.</div>
        ${gw1Markup(payload?.backcast)}
      `;
    }

    return `
      <div class="section-head">
        <h2>GW${latest.gw} SZxP vs Actual</h2>
        <span class="stat-note">${esc(latest.model_version || '')} · locked pre-deadline</span>
      </div>

      <div class="grid stats">
        <div class="card">
          <div class="stat-label">Player MAE</div>
          <div class="stat-value">${fmt(latest.relevant?.mae)}</div>
          <div class="stat-note">${latest.relevant?.n ?? 0} player predictions</div>
        </div>
        <div class="card">
          <div class="stat-label">Team MAE</div>
          <div class="stat-value">${fmt(latest.team_mae)}</div>
          <div class="stat-note">${latest.team_predictions_evaluated ?? 0} teams evaluated</div>
        </div>
        <div class="card">
          <div class="stat-label">Mean Bias</div>
          <div class="stat-value">${fmt(latest.relevant?.bias)}</div>
          <div class="stat-note">${esc(biasText(latest.relevant?.bias))}</div>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Team</th>
              <th>Locked SZxP</th>
              <th>Actual</th>
              <th>Actual − SZxP</th>
              <th>Chip</th>
            </tr>
          </thead>
          <tbody>${teamRows(latest)}</tbody>
        </table>
      </div>

      <p class="model-note">
        This card changes automatically only after Official FPL marks the Gameweek finished.
        Historical projection snapshots are read-only and are never regenerated after the deadline.
      </p>

      <div class="section-head" style="margin-top:18px">
        <h2>Season Accuracy</h2>
        <span class="stat-note">GW2 → GW${latest.gw}</span>
      </div>

      <div class="grid stats">
        <div class="card">
          <div class="stat-label">Cumulative Player MAE</div>
          <div class="stat-value">${fmt(summary.cumulative_player_mae ?? summary.average_relevant_mae)}</div>
          <div class="stat-note">${summary.player_predictions_evaluated ?? latest.relevant?.n ?? 0} predictions</div>
        </div>
        <div class="card">
          <div class="stat-label">Cumulative Team MAE</div>
          <div class="stat-value">${fmt(summary.cumulative_team_mae)}</div>
          <div class="stat-note">${summary.team_predictions_evaluated ?? 0} team-GWs</div>
        </div>
        <div class="card">
          <div class="stat-label">Cumulative Bias</div>
          <div class="stat-value">${fmt(summary.cumulative_mean_bias)}</div>
          <div class="stat-note">${esc(biasText(summary.cumulative_mean_bias))}</div>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>GW</th><th>Model</th><th>Player MAE</th><th>Team MAE</th><th>Bias</th><th>N</th></tr>
          </thead>
          <tbody>${seasonRows(gameweeks)}</tbody>
        </table>
      </div>

      ${gw1Markup(payload?.backcast)}
    `;
  }

  async function render(forceFetch=false) {
    if (rendering) return;
    const overview = document.querySelector('#overview');
    if (!overview || !overview.children.length) return;

    rendering = true;
    try {
      if (!lastPayload || forceFetch) lastPayload = await getPayload();
      const accuracy = lastPayload?.accuracy || {};
      const latest = [...(accuracy.gameweeks || [])]
        .sort((a,b) => Number(a.gw) - Number(b.gw))
        .at(-1);

      removeOldGw1Card(overview);
      updateTopAccuracyCard(overview, latest);

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
