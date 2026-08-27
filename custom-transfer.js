// Fantaszy Szentre — Custom Transfer Lab
// Simulate your own transfers against the latest publicly locked squad.
(() => {
  const LAB_ID = 'customTransferLab';
  const MAX_CUSTOM_TRANSFERS = 5;
  let selectedTeamId = null;
  let rows = [{outId:'', inId:''}];
  let injecting = false;

  const getTeam = () => {
    const ok = (state.teamData || []).filter(t => t.ok);
    if (!ok.length) return null;
    const wanted = Number(selectedTeamId || localStorage.getItem('fs:customTransferTeam') || localStorage.getItem('fs:transferTeam') || ok[0].id);
    return ok.find(t => Number(t.id) === wanted) || ok[0];
  };

  const uniqueRows = () => rows.filter(r => r.outId && r.inId);

  const originalIds = td => teamSquad(td).map(p => p.id);

  function simulate(td, draftRows = rows) {
    const baseIds = originalIds(td);
    let ids = [...baseIds];
    let bank = Number(td.picks?.entry_history?.bank || 0);
    const ft = inferredFreeTransfers(td);
    const moves = [];
    const usedOut = new Set();
    const usedIn = new Set();
    let error = '';

    for (let i = 0; i < draftRows.length; i++) {
      const row = draftRows[i];
      if (!row.outId && !row.inId) continue;
      if (!row.outId || !row.inId) {
        error = `Transfer ${i+1}: choose both OUT and IN.`;
        break;
      }

      const outId = Number(row.outId);
      const inId = Number(row.inId);
      const out = state.players.find(p => p.id === outId);
      const inc = state.players.find(p => p.id === inId);
      if (!out || !inc) { error = `Transfer ${i+1}: player data unavailable.`; break; }
      if (!ids.includes(outId)) { error = `Transfer ${i+1}: ${out.web_name} is no longer in this simulated squad.`; break; }
      if (ids.includes(inId)) { error = `Transfer ${i+1}: ${inc.web_name} is already owned.`; break; }
      if (usedOut.has(outId)) { error = `Transfer ${i+1}: the same player cannot be sold twice.`; break; }
      if (usedIn.has(inId)) { error = `Transfer ${i+1}: the same player cannot be bought twice.`; break; }
      if (out.element_type !== inc.element_type) { error = `Transfer ${i+1}: replacement must be the same FPL position.`; break; }

      const sp = sellingPrice(td, out);
      const available = bank + sp;
      if (Number(inc.now_cost || 0) > available) {
        error = `Transfer ${i+1}: £${fmt(Number(inc.now_cost)/10)}m is over budget.`;
        break;
      }

      const nextIds = ids.map(id => id === outId ? inId : id);
      const clubs = clubCountIds(nextIds);
      if (Object.values(clubs).some(n => n > 3)) {
        error = `Transfer ${i+1}: this would exceed the three-player club limit.`;
        break;
      }

      bank = available - Number(inc.now_cost || 0);
      ids = nextIds;
      usedOut.add(outId);
      usedIn.add(inId);
      moves.push({out, inc, sell:sp, buy:Number(inc.now_cost || 0)});
    }

    const base1 = squadScore(baseIds, 'gw1');
    const base4 = squadScore(baseIds, '4gw');
    const custom1 = error ? base1 : squadScore(ids, 'gw1');
    const custom4 = error ? base4 : squadScore(ids, '4gw');
    const hit = 4 * Math.max(0, moves.length - ft);
    const gross1 = custom1 - base1;
    const gross4 = custom4 - base4;
    const net1 = gross1 - hit;
    const net4 = gross4 - hit;
    const nextFt = Math.min(5, Math.max(0, ft - moves.length) + 1);

    return {td, ids, bank, ft, nextFt, moves, error, base1, base4, custom1, custom4, hit, gross1, gross4, net1, net4};
  }

  function outOptions(td, rowIndex) {
    const squad = teamSquad(td);
    const used = new Set(rows.map((r,i) => i === rowIndex ? null : Number(r.outId)).filter(Boolean));
    return squad
      .filter(p => !used.has(p.id))
      .sort((a,b) => String(a.pos).localeCompare(String(b.pos)) || Number(a.now_cost)-Number(b.now_cost))
      .map(p => `<option value="${p.id}" ${Number(rows[rowIndex]?.outId)===p.id?'selected':''}>${esc(p.web_name)} · ${p.pos} · ${money(p.now_cost)} · ${fmt(p.xp?.[0])}/${fmt(p.xp4)} xP</option>`)
      .join('');
  }

  function legalInCandidates(td, rowIndex) {
    const row = rows[rowIndex];
    if (!row?.outId) return [];

    // Simulate only completed rows before this one so the available bank and club counts are correct.
    const priorRows = rows.slice(0,rowIndex).filter(r => r.outId && r.inId);
    const prior = simulate(td, priorRows);
    if (prior.error) return [];

    const outId = Number(row.outId);
    const out = state.players.find(p => p.id === outId);
    if (!out || !prior.ids.includes(outId)) return [];

    const sp = sellingPrice(td, out);
    const available = prior.bank + sp;
    const ownedAfterSale = prior.ids.filter(id => id !== outId);
    const clubBase = clubCountIds(ownedAfterSale);
    const usedIncoming = new Set(rows.map((r,i) => i === rowIndex ? null : Number(r.inId)).filter(Boolean));

    return state.players
      .filter(p =>
        p.element_type === out.element_type &&
        !ownedAfterSale.includes(p.id) &&
        !usedIncoming.has(p.id) &&
        Number(p.now_cost || 0) <= available &&
        (clubBase[p.team] || 0) < 3 &&
        p.status !== 'u'
      )
      .sort((a,b) => {
        const as = 1.35*Number(a.xp?.[0]||0) + Number(a.xp4||0) + Number(a.xmins||0)/200;
        const bs = 1.35*Number(b.xp?.[0]||0) + Number(b.xp4||0) + Number(b.xmins||0)/200;
        return bs-as;
      });
  }

  function inOptions(td, rowIndex) {
    const candidates = legalInCandidates(td,rowIndex);
    const selected = Number(rows[rowIndex]?.inId || 0);
    return candidates.map(p => `<option value="${p.id}" ${selected===p.id?'selected':''}>${esc(p.web_name)} · ${p.teamCode} · ${money(p.now_cost)} · GW ${fmt(p.xp?.[0])} · 4GW ${fmt(p.xp4)}</option>`).join('');
  }

  function metricCard(label, value, note='', positive=false, negative=false) {
    const cls = positive ? 'xp' : negative ? 'delta-down' : '';
    return `<div class="card"><div class="stat-label">${label}</div><div class="stat-value ${cls}">${value}</div><div class="stat-note">${note}</div></div>`;
  }

  function moveBreakdown(sim) {
    if (!sim.moves.length) return `<div class="notice">Choose a player OUT and a replacement IN to see the impact.</div>`;
    const rowsHtml = sim.moves.map((m,i) => {
      const n1 = Number(m.inc.xp?.[0]||0) - Number(m.out.xp?.[0]||0);
      const n4 = Number(m.inc.xp4||0) - Number(m.out.xp4||0);
      return `<tr>
        <td>${i+1}</td>
        <td><b>${esc(m.out.web_name)}</b> → <b>${esc(m.inc.web_name)}</b><div class="team-code">${m.out.pos} · sell ${money(m.sell)} · buy ${money(m.buy)}</div></td>
        <td class="${n1>=0?'xp':'delta-down'}">${n1>=0?'+':''}${fmt(n1)}</td>
        <td class="${n4>=0?'xp':'delta-down'}">${n4>=0?'+':''}${fmt(n4)}</td>
      </tr>`;
    }).join('');
    return `<div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Custom move</th><th>Player Δ Next GW</th><th>Player Δ 4GW</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>`;
  }

  function resultMarkup(sim) {
    if (sim.error) return `<div class="notice warn">${esc(sim.error)}</div>`;
    const sign = n => `${n>=0?'+':''}${fmt(n)}`;
    const verdict = sim.moves.length === 0 ? 'NO CUSTOM MOVE YET'
      : sim.net1 > 0 && sim.net4 > 0 ? 'POSITIVE BOTH HORIZONS'
      : sim.net1 > 0 ? 'SHORT-TERM GAIN'
      : sim.net4 > 0 ? 'LONGER-TERM GAIN'
      : 'MODEL PREFERS HOLD';

    return `
      <div class="grid stats">
        ${metricCard('Next GW Net Gain', sign(sim.net1), `gross ${sign(sim.gross1)} · hit -${sim.hit}`, sim.net1>0, sim.net1<0)}
        ${metricCard('4GW Net Gain', sign(sim.net4), `gross ${sign(sim.gross4)} · hit -${sim.hit}`, sim.net4>0, sim.net4<0)}
        ${metricCard('Projected Next GW', fmt(sim.custom1), `baseline ${fmt(sim.base1)}`)}
        ${metricCard('Projected 4GW', fmt(sim.custom4), `baseline ${fmt(sim.base4)}`)}
      </div>
      <div class="notice"><strong>${verdict}</strong> · ${sim.moves.length} transfer${sim.moves.length===1?'':'s'} · ${sim.ft} FT available · ${sim.hit?`-${sim.hit} hit`:'no hit'} · bank after £${fmt(sim.bank/10)}m · next-GW FT position ${sim.nextFt}.</div>
      ${moveBreakdown(sim)}
      <p class="model-note">Team-level gain recalculates the best legal XI and captain after your custom move, so it can differ from the simple player-vs-player delta shown above.</p>`;
  }

  function transferRowsMarkup(td) {
    return rows.map((r,i) => `
      <div class="card" style="margin-top:12px">
        <div class="section-head"><h2 style="font-size:1rem">Transfer ${i+1}</h2>${i>0?`<button class="link-button custom-remove-row" data-row="${i}">Remove</button>`:''}</div>
        <div class="controls" style="margin-bottom:0">
          <select class="select custom-out" data-row="${i}">
            <option value="">Player OUT…</option>
            ${outOptions(td,i)}
          </select>
          <select class="select custom-in" data-row="${i}" ${r.outId?'':'disabled'}>
            <option value="">Player IN…</option>
            ${inOptions(td,i)}
          </select>
        </div>
      </div>`).join('');
  }

  function labMarkup(td) {
    const sim = simulate(td);
    const teams = state.teamData.filter(t=>t.ok);
    const gw = state.nextEvents?.[0]?.id || '—';
    return `<div id="${LAB_ID}" class="section card">
      <div class="section-head"><h2>Custom Transfer Lab</h2><span class="stat-note">What if I make this move?</span></div>
      <p class="subtext">Build your own transfer and instantly compare the latest locked squad against your custom squad for GW${gw} and the next four Gameweeks.</p>
      <div class="controls">
        <select class="select" id="customTransferTeamSelect">
          ${teams.map(t=>`<option value="${t.id}" ${Number(t.id)===Number(td.id)?'selected':''}>${esc(t.name)}</option>`).join('')}
        </select>
      </div>
      <div id="customTransferRows">${transferRowsMarkup(td)}</div>
      <div class="controls" style="margin-top:12px">
        <button class="link-button" id="customAddTransfer" ${rows.length>=MAX_CUSTOM_TRANSFERS?'disabled':''}>+ Add another transfer</button>
        <button class="link-button" id="customResetTransfer">Reset</button>
      </div>
      <div id="customTransferResults" style="margin-top:16px">${resultMarkup(sim)}</div>
      <div class="notice warn" style="margin-top:16px">This simulator starts from the latest publicly locked FPL squad. Transfers you already made privately for the current Gameweek are not visible to the public API, but you can recreate them here as custom moves.</div>
    </div>`;
  }

  function renderLab(resetRows=false) {
    const td = getTeam();
    const root = document.querySelector('#transfers');
    if (!td || !root) return;
    if (resetRows) rows = [{outId:'',inId:''}];
    selectedTeamId = td.id;

    const old = document.getElementById(LAB_ID);
    if (old) old.remove();
    root.insertAdjacentHTML('beforeend', labMarkup(td));
    wireLab(td);
  }

  function refreshRowsAndResults(td) {
    const rowsEl = document.getElementById('customTransferRows');
    const resultsEl = document.getElementById('customTransferResults');
    if (rowsEl) rowsEl.innerHTML = transferRowsMarkup(td);
    if (resultsEl) resultsEl.innerHTML = resultMarkup(simulate(td));
    wireRowControls(td);
  }

  function wireRowControls(td) {
    document.querySelectorAll('.custom-out').forEach(sel => sel.addEventListener('change', e => {
      const i = Number(e.target.dataset.row);
      rows[i].outId = e.target.value;
      rows[i].inId = '';
      // Downstream rows may become illegal after the squad/bank changes; reset them.
      for (let j=i+1;j<rows.length;j++) rows[j] = {outId:'',inId:''};
      refreshRowsAndResults(td);
    }));

    document.querySelectorAll('.custom-in').forEach(sel => sel.addEventListener('change', e => {
      const i = Number(e.target.dataset.row);
      rows[i].inId = e.target.value;
      for (let j=i+1;j<rows.length;j++) rows[j] = {outId:'',inId:''};
      refreshRowsAndResults(td);
    }));

    document.querySelectorAll('.custom-remove-row').forEach(btn => btn.addEventListener('click', e => {
      const i = Number(e.currentTarget.dataset.row);
      rows.splice(i,1);
      if (!rows.length) rows=[{outId:'',inId:''}];
      refreshRowsAndResults(td);
    }));
  }

  function wireLab(td) {
    const teamSel = document.getElementById('customTransferTeamSelect');
    if (teamSel) teamSel.addEventListener('change', e => {
      selectedTeamId = Number(e.target.value);
      localStorage.setItem('fs:customTransferTeam', String(selectedTeamId));
      rows = [{outId:'',inId:''}];
      renderLab(false);
    });

    const add = document.getElementById('customAddTransfer');
    if (add) add.addEventListener('click', () => {
      if (rows.length >= MAX_CUSTOM_TRANSFERS) return;
      // Require the current last transfer to be complete before adding another.
      const last = rows[rows.length-1];
      if (!last.outId || !last.inId) {
        toast('Complete the current transfer first');
        return;
      }
      rows.push({outId:'',inId:''});
      refreshRowsAndResults(td);
    });

    const reset = document.getElementById('customResetTransfer');
    if (reset) reset.addEventListener('click', () => {
      rows = [{outId:'',inId:''}];
      refreshRowsAndResults(td);
    });

    wireRowControls(td);
  }

  function ensureLab() {
    if (injecting) return;
    const root = document.querySelector('#transfers');
    if (!root || !(state.teamData || []).some(t=>t.ok)) return;
    if (document.getElementById(LAB_ID)) return;
    injecting = true;
    try { renderLab(false); } finally { injecting = false; }
  }

  // portfolio-transfer.js rebuilds the Transfers view asynchronously. Watch that
  // container and append the lab only after the main recommendation layer exists.
  const root = document.querySelector('#transfers');
  if (root) {
    const observer = new MutationObserver(() => {
      if (document.getElementById(LAB_ID)) return;
      setTimeout(ensureLab, 80);
    });
    observer.observe(root, {childList:true});
  }

  document.addEventListener('click', e => {
    if (e.target.closest('.nav-item[data-view="transfers"], [data-go="transfers"]')) {
      setTimeout(ensureLab, 450);
      setTimeout(ensureLab, 1200);
    }
  });

  // If the user opens the site directly with portfolio data already loaded.
  setTimeout(ensureLab, 2500);
})();
