// Fantaszy Szentre — Portfolio Transfer Decision Layer
// Replaces the old 0–15 transfer-count-first view with objective-aware portfolio calls.
(() => {
  let cache = null;
  let building = false;

  const objectiveProfile = td => {
    const type = String(td.type || '');
    const name = String(td.name || '');

    if (type.includes('Weekly Prize')) {
      if (name === 'Petrol Neto') return {label:'Weekly ceiling', now:1.00, future:0.00, hit:1.00, risk:0.10, diversity:0.14, ceiling:0.18, hold:0.15};
      return {label:'Weekly prize', now:1.00, future:0.00, hit:1.00, risk:0.18, diversity:0.08, ceiling:0.10, hold:0.20};
    }
    if (type.includes('Cup')) return {label:'Knockout survival', now:1.45, future:0.28, hit:1.35, risk:0.65, diversity:0.00, ceiling:0.00, hold:0.85};
    if (type.includes('H2H')) return {label:'Weekly floor', now:1.30, future:0.35, hit:1.25, risk:0.55, diversity:0.00, ceiling:0.00, hold:0.75};
    if (type.includes('Monthly')) return {label:'Monthly push', now:1.12, future:0.82, hit:1.00, risk:0.28, diversity:0.04, ceiling:0.05, hold:0.45};
    if (type.includes('ANSARA')) return {label:'Weekly upside + OR', now:1.18, future:0.72, hit:1.00, risk:0.25, diversity:0.05, ceiling:0.06, hold:0.40};
    if (type.includes('Second')) return {label:'Controlled diversification', now:1.00, future:0.96, hit:1.00, risk:0.25, diversity:0.12, ceiling:0.03, hold:0.55};
    if (type.includes('Third')) return {label:'Alternative season route', now:1.05, future:0.90, hit:1.00, risk:0.22, diversity:0.15, ceiling:0.05, hold:0.50};
    return {label:'Long-term OR', now:1.00, future:1.00, hit:1.00, risk:0.30, diversity:0.00, ceiling:0.00, hold:0.65};
  };

  const exposureMap = () => {
    const exp = {};
    for (const td of state.teamData.filter(x => x.ok)) {
      for (const p of teamSquad(td)) exp[p.id] = (exp[p.id] || 0) + 1;
    }
    return exp;
  };

  const clubCounts = ids => {
    const out = {};
    for (const id of ids) {
      const p = state.players.find(x => x.id === id);
      if (p) out[p.team] = (out[p.team] || 0) + 1;
    }
    return out;
  };

  const routeIds = (td, moves) => {
    let ids = teamSquad(td).map(p => p.id);
    for (const m of (moves || [])) ids = ids.map(id => id === m.out.id ? m.inc.id : id);
    return ids;
  };

  const riskCost = (moves, profile) => (moves || []).reduce((s, m) => {
    const p = m.inc;
    let r = Math.max(0, 70 - Number(p.xmins || 0)) / 22;
    if (p.confidence === 'Low') r += 0.8;
    else if (p.confidence === 'Medium') r += 0.2;
    if (p.status !== 'a') r += 1.2;
    return s + r * profile.risk;
  }, 0);

  const diversityValue = (moves, profile, exposure) => (moves || []).reduce((s, m) => {
    const e = Number(exposure[m.inc.id] || 0);
    return s + Math.max(-2, 3 - e) * profile.diversity * 0.12;
  }, 0);

  const ceilingValue = (moves, profile) => (moves || []).reduce((s, m) => {
    const p = m.inc;
    const ceilingGap = Math.max(0, Number(p.ceiling || 0) - Number(p.xp?.[0] || 0));
    const diff = Math.max(0, 8 - Number(p.selected_by_percent || 0)) / 8;
    return s + profile.ceiling * (ceilingGap + diff);
  }, 0);

  function fastRoutes(td, exposure) {
    const squad = teamSquad(td);
    const originalIds = squad.map(p => p.id);
    const bank = Number(td.picks?.entry_history?.bank || 0);
    const ft = inferredFreeTransfers(td);
    const base1 = squadScore(originalIds, 'gw1');
    const base4 = squadScore(originalIds, '4gw');
    const profile = objectiveProfile(td);
    const maxK = Math.min(5, Math.max(2, ft + 2));
    const scoreCache = new Map();

    const scoreIds = (ids, mode) => {
      const key = `${mode}:${ids.slice().sort((a,b)=>a-b).join(',')}`;
      if (!scoreCache.has(key)) scoreCache.set(key, squadScore(ids, mode));
      return scoreCache.get(key);
    };

    const evaluate = st => {
      const gross1 = scoreIds(st.ids, 'gw1');
      const gross4 = scoreIds(st.ids, '4gw');
      const hit = 4 * Math.max(0, st.moves.length - ft);
      const gw1GrossGain = gross1 - base1;
      const fourGrossGain = gross4 - base4;
      const futureGrossGain = fourGrossGain - gw1GrossGain;
      const gw1Net = gw1GrossGain - hit;
      const fourNet = fourGrossGain - hit;
      const risk = riskCost(st.moves, profile);
      const div = diversityValue(st.moves, profile, exposure);
      const ceil = ceilingValue(st.moves, profile);
      const objectiveScore = profile.now * gw1GrossGain + profile.future * futureGrossGain - profile.hit * hit - risk + div + ceil;
      return {...st, hit, gross1, gross4, gw1GrossGain, futureGrossGain, fourGrossGain, gw1Net, fourNet, objectiveScore, risk, div, ceil};
    };

    const zero = evaluate({ids:originalIds, bank, moves:[], remaining:new Set(originalIds)});
    let beam = [zero];
    let all = [zero];
    const BEAM = 10;

    for (let k = 1; k <= maxK; k++) {
      const children = [];
      for (const st of beam) {
        const owned = new Set(st.ids);
        const clubs = clubCounts(st.ids);
        const sellable = [...st.remaining]
          .map(id => state.players.find(p => p.id === id))
          .filter(Boolean)
          .sort((a,b) => (Number(a.xp4||0) + 1.15*Number(a.xp?.[0]||0) + Number(a.xmins||0)/100) - (Number(b.xp4||0) + 1.15*Number(b.xp?.[0]||0) + Number(b.xmins||0)/100))
          .slice(0,4);

        for (const out of sellable) {
          const sp = sellingPrice(td, out);
          const budget = st.bank + sp;
          const candidates = state.players.filter(inc =>
            inc.element_type === out.element_type &&
            !owned.has(inc.id) &&
            inc.now_cost <= budget &&
            inc.xmins >= 48 &&
            inc.status !== 'u' &&
            ((clubs[inc.team] || 0) - (inc.team === out.team ? 1 : 0)) < 3
          ).sort((a,b) => {
            const av = 1.45*Number(a.xp?.[0]||0) + Number(a.xp4||0) + Number(a.ceiling||0)*0.12;
            const bv = 1.45*Number(b.xp?.[0]||0) + Number(b.xp4||0) + Number(b.ceiling||0)*0.12;
            return bv-av;
          }).slice(0,6);

          for (const inc of candidates) {
            const ids = st.ids.map(id => id === out.id ? inc.id : id);
            const remaining = new Set(st.remaining);
            remaining.delete(out.id);
            children.push(evaluate({
              ids,
              bank: budget - inc.now_cost,
              moves: [...st.moves, {out, inc, sell:sp, buy:inc.now_cost}],
              remaining
            }));
          }
        }
      }

      if (!children.length) break;
      const dedup = new Map();
      for (const c of children) {
        const key = c.ids.slice().sort((a,b)=>a-b).join(',');
        const prev = dedup.get(key);
        if (!prev || c.objectiveScore > prev.objectiveScore) dedup.set(key,c);
      }
      beam = [...dedup.values()].sort((a,b)=>b.objectiveScore-a.objectiveScore).slice(0,BEAM);
      all.push(...beam.slice(0,5));
    }

    const unique = new Map();
    for (const r of all) {
      const key = r.ids.slice().sort((a,b)=>a-b).join(',');
      const prev = unique.get(key);
      if (!prev || r.objectiveScore > prev.objectiveScore) unique.set(key,r);
    }
    let routes = [...unique.values()].sort((a,b)=>b.objectiveScore-a.objectiveScore);

    // Do not burn a transfer for a tiny model edge. Banked FT has option value.
    const roll = routes.find(r => r.moves.length === 0) || zero;
    let best = routes[0] || roll;
    if (best.moves.length && best.objectiveScore - roll.objectiveScore < profile.hold) best = roll;

    // Weekly-prize teams are judged on next-GW net points after hits.
    if (td.type.includes('Weekly Prize')) {
      routes = routes.sort((a,b) => (b.gw1Net + b.ceil + b.div - b.risk) - (a.gw1Net + a.ceil + a.div - a.risk));
      best = routes[0] || roll;
      if (best.moves.length && best.gw1Net < profile.hold) best = roll;
    }

    const alternatives = routes.filter(r => r !== best).slice(0,5);
    const second = alternatives[0];
    const gap = second ? best.objectiveScore - second.objectiveScore : 9;
    const confidence = gap >= 1.8 ? 'HIGH' : gap >= 0.65 ? 'MEDIUM' : 'LOW';

    return {td, profile, ft, bank, base1, base4, best, alternatives, confidence};
  }

  const actionLabel = rec => {
    const r = rec.best;
    if (!r.moves.length) return 'ROLL';
    if (r.hit <= 0) return `${r.moves.length} FT`;
    return `${r.moves.length} TRANSFERS · -${r.hit}`;
  };

  const nextFt = rec => {
    const k = rec.best.moves.length;
    return Math.min(5, Math.max(0, rec.ft - k) + 1);
  };

  const routeText = r => !r.moves.length ? 'Hold squad' : r.moves.map(m => `${m.out.web_name} → ${m.inc.web_name}`).join(' · ');

  const reasonText = rec => {
    const r = rec.best;
    const p = rec.profile;
    if (!r.moves.length) return `${p.label}: no transfer clears the model's action threshold, so preserving the FT has more option value.`;
    const parts = [`${p.label}`];
    parts.push(`${r.gw1Net >= 0 ? '+' : ''}${fmt(r.gw1Net)} xP next GW net`);
    parts.push(`${r.fourNet >= 0 ? '+' : ''}${fmt(r.fourNet)} xP over 4GW net`);
    if (r.hit) parts.push(`includes -${r.hit}`);
    if (r.risk > 0.6) parts.push('availability risk noted');
    return parts.join(' · ');
  };

  const chipNote = rec => {
    const cp = firstHalfChipPlan(rec.td);
    const used = usedFirstHalfChips(rec.td);
    const gw = Number(state.nextEvents[0]?.id || 0);
    const live = ['WC','FH','BB','TC'].map(k => cp[k]).filter(Boolean).filter(x => Number(x.gw) === gw && !used[x.chip]);
    if (!live.length) return 'No chip is being forced by the transfer call.';
    const x = live.sort((a,b)=>b.benefit-a.benefit)[0];
    return `Chip watch: ${x.chip} also rates well for GW${gw} (${x.detail}). Treat this as a review flag, not an automatic activation.`;
  };

  const recommendedIds = rec => routeIds(rec.td, rec.best.moves);

  function buildPortfolio() {
    const teams = state.teamData.filter(td => td.ok);
    const exposure = exposureMap();
    const recs = teams.map(td => fastRoutes(td, exposure));

    const postExposure = {};
    for (const rec of recs) {
      for (const id of recommendedIds(rec)) postExposure[id] = (postExposure[id] || 0) + 1;
    }
    const exposureRows = Object.entries(postExposure)
      .map(([id,n]) => ({p:state.players.find(x=>x.id===Number(id)), n}))
      .filter(x=>x.p)
      .sort((a,b)=>b.n-a.n || b.p.xp4-a.p.xp4)
      .slice(0,6);

    const moveCount = recs.filter(r=>r.best.moves.length).length;
    const rollCount = recs.length - moveCount;
    const hitCount = recs.filter(r=>r.best.hit>0).length;
    const priority = [...recs].filter(r=>r.best.moves.length).sort((a,b)=>b.best.objectiveScore-a.best.objectiveScore)[0] || recs[0];

    return {recs, exposureRows, moveCount, rollCount, hitCount, priority, stamp:state.meta?.updated_at_utc || Date.now()};
  }

  function summaryCards(data) {
    const priority = data.priority;
    const pMove = priority ? routeText(priority.best) : '—';
    return `
      <div class="grid stats">
        <div class="card"><div class="stat-label">Portfolio Calls</div><div class="stat-value">${data.moveCount} MOVE</div><div class="stat-note">${data.rollCount} roll · ${data.hitCount} hit route${data.hitCount===1?'':'s'}</div></div>
        <div class="card"><div class="stat-label">Priority Team</div><div class="stat-value" style="font-size:1.45rem">${priority?esc(priority.td.name):'—'}</div><div class="stat-note">${priority?esc(actionLabel(priority)):'—'}</div></div>
        <div class="card"><div class="stat-label">Priority Move</div><div class="stat-value" style="font-size:1.15rem;line-height:1.25">${esc(pMove)}</div><div class="stat-note">model-weighted by that team's objective</div></div>
        <div class="card"><div class="stat-label">Next GW</div><div class="stat-value">GW${state.nextEvents[0]?.id || '—'}</div><div class="stat-note">all gains below are net of hits</div></div>
      </div>`;
  }

  function portfolioTable(data) {
    return `<div class="section card">
      <div class="section-head"><h2>What I should do</h2><span class="stat-note">all nine teams</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Team</th><th>Call</th><th>Transfers</th><th>Next GW net</th><th>4GW net</th><th>Confidence</th></tr></thead>
        <tbody>${data.recs.map(rec=>`<tr>
          <td><b>${esc(rec.td.name)}</b><div class="team-code">${esc(rec.profile.label)}</div></td>
          <td><span class="badge ${rec.best.moves.length?'buy':'keep'}">${esc(actionLabel(rec))}</span></td>
          <td style="white-space:normal;min-width:260px">${esc(routeText(rec.best))}</td>
          <td class="${rec.best.gw1Net>0?'xp':''}">${rec.best.gw1Net>=0?'+':''}${fmt(rec.best.gw1Net)}</td>
          <td class="${rec.best.fourNet>0?'xp':''}">${rec.best.fourNet>=0?'+':''}${fmt(rec.best.fourNet)}</td>
          <td>${rec.confidence}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  }

  function exposureMarkup(data) {
    const items = data.exposureRows.map(x => `${x.p.web_name} ${x.n}/${data.recs.length}`).join(' · ');
    return `<div class="notice">Portfolio exposure after the modelled calls: ${esc(items || '—')}. Diversification is only a soft tie-break for teams designed to differ; Fantaszy Szentre will not reject a clearly superior move just to make the portfolio look different.</div>`;
  }

  function selectedDetail(data, selectedId) {
    const rec = data.recs.find(r => r.td.id === Number(selectedId)) || data.recs[0];
    if (!rec) return '';
    const r = rec.best;
    const alternatives = rec.alternatives.slice(0,4);
    const chip = chipNote(rec);
    return `
      <div class="controls">
        <select class="select" id="portfolioTransferTeamSelect">
          ${data.recs.map(x=>`<option value="${x.td.id}" ${x.td.id===rec.td.id?'selected':''}>${esc(x.td.name)}</option>`).join('')}
        </select>
      </div>

      <div class="grid stats">
        <div class="card"><div class="stat-label">Recommended Now</div><div class="stat-value" style="font-size:1.45rem">${esc(actionLabel(rec))}</div><div class="stat-note">${esc(routeText(r))}</div></div>
        <div class="card"><div class="stat-label">Next GW Net Gain</div><div class="stat-value">${r.gw1Net>=0?'+':''}${fmt(r.gw1Net)}</div><div class="stat-note">after ${r.hit?'-'+r.hit:'0'} hit points</div></div>
        <div class="card"><div class="stat-label">4GW Net Gain</div><div class="stat-value">${r.fourNet>=0?'+':''}${fmt(r.fourNet)}</div><div class="stat-note">same transfer route, hit counted once</div></div>
        <div class="card"><div class="stat-label">FT Position</div><div class="stat-value">${rec.ft} → ${nextFt(rec)}</div><div class="stat-note">current baseline → projected next GW</div></div>
      </div>

      <div class="notice"><strong>${esc(rec.td.name)}:</strong> ${esc(reasonText(rec))}<br>${esc(chip)}</div>

      <div class="section card">
        <div class="section-head"><h2>Best alternatives</h2><span class="stat-note">not random transfer counts</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Route</th><th>Moves</th><th>Hit</th><th>Next GW net</th><th>4GW net</th></tr></thead>
          <tbody>${alternatives.map(a=>`<tr>
            <td>${a.moves.length?`${a.moves.length}T`:'ROLL'}</td>
            <td style="white-space:normal;min-width:280px">${esc(routeText(a))}</td>
            <td>${a.hit?'-'+a.hit:'0'}</td>
            <td class="${a.gw1Net>0?'xp':''}">${a.gw1Net>=0?'+':''}${fmt(a.gw1Net)}</td>
            <td class="${a.fourNet>0?'xp':''}">${a.fourNet>=0?'+':''}${fmt(a.fourNet)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>
      <p class="model-note">Recommendation logic is objective-aware: season teams value sustained 4GW gain, H2H/Cup teams prioritise next-GW floor and punish hits more, ANSARA/Monthly teams blend immediate and medium-term gain, and Weekly Prize teams optimise next-GW net score. Current-GW private transfers remain invisible until the deadline.</p>`;
  }

  function renderShell() {
    const el = document.querySelector('#transfers');
    if (!el) return;
    el.innerHTML = `
      <div class="hero">
        <div class="eyebrow">Portfolio Transfer Szentre</div>
        <h1>Tell me what to do, not just the maths.</h1>
        <p class="subtext">Objective-aware transfer calls for all nine teams, with next-GW gain and 4GW gain shown separately.</p>
      </div>
      <div class="notice">Open the Transfers tab to build the portfolio plan from the latest locked squads and current SZxP snapshot.</div>`;
  }

  function renderBuilt(data) {
    const el = document.querySelector('#transfers');
    if (!el) return;
    const selectedId = Number(localStorage.getItem('fs:portfolioTransferTeam') || data.recs[0]?.td.id || 0);
    el.innerHTML = `
      <div class="hero">
        <div class="eyebrow">Portfolio Transfer Szentre</div>
        <h1>What should I actually do?</h1>
        <p class="subtext">One recommended action per team. Next-GW net gain is shown separately from the four-GW case, and each team is judged against its own purpose.</p>
      </div>
      ${summaryCards(data)}
      ${portfolioTable(data)}
      ${exposureMarkup(data)}
      ${selectedDetail(data, selectedId)}`;

    const select = document.querySelector('#portfolioTransferTeamSelect');
    if (select) select.addEventListener('change', e => {
      localStorage.setItem('fs:portfolioTransferTeam', e.target.value);
      renderBuilt(data);
    });
  }

  function buildAndRender() {
    if (building) return;
    if (!state?.teamData?.some?.(x=>x.ok)) {
      setTimeout(buildAndRender, 350);
      return;
    }
    const stamp = `${state.meta?.updated_at_utc || ''}:${state.publishedGW}`;
    if (cache?.stampKey === stamp) {
      renderBuilt(cache.data);
      return;
    }
    building = true;
    const el = document.querySelector('#transfers');
    if (el) el.innerHTML = `<div class="hero"><div class="eyebrow">Portfolio Transfer Szentre</div><h1>Building your nine-team transfer plan…</h1><p class="subtext">Comparing roll, free-transfer and hit routes against each team's actual objective.</p></div><div class="grid stats">${'<div class="skeleton"></div>'.repeat(4)}</div>`;

    setTimeout(() => {
      try {
        const data = buildPortfolio();
        cache = {stampKey:stamp, data};
        renderBuilt(data);
      } catch (e) {
        console.error('Portfolio transfer planner failed', e);
        if (el) el.innerHTML = `<div class="hero"><div class="eyebrow">Portfolio Transfer Szentre</div><h1>Transfer plan could not be built.</h1><p class="subtext">${esc(e.message || String(e))}</p></div>`;
      } finally {
        building = false;
      }
    }, 30);
  }

  // Replace the old transfer renderer. The initial app render stays lightweight;
  // the heavier nine-team optimisation runs only when Transfers is opened.
  renderTransfers = renderShell;

  document.addEventListener('click', e => {
    const btn = e.target.closest('.nav-item[data-view="transfers"], [data-go="transfers"]');
    if (btn) setTimeout(buildAndRender, 20);
  });

  // If app.js already rendered before this layer loaded, replace it now.
  setTimeout(() => {
    if (document.querySelector('#transfers')) renderShell();
  }, 100);
})();
