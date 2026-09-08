
// Fantaszy Szentre — Weekly UX Clean Layer
// Presentation-only. Does not modify SZxP, transfer maths, lineup maths or chip maths.
(() => {
  'use strict';

  const VERSION = '20260908-weeklyux1';
  const MODE_KEY = 'fsux:mode';
  let renderTimer = null;
  let mutationLock = false;

  const q = (s, root=document) => root.querySelector(s);
  const qa = (s, root=document) => [...root.querySelectorAll(s)];
  const fmt = (n,d=1) => Number(n || 0).toFixed(d);
  const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
  }[c]));

  function mode() {
    return localStorage.getItem(MODE_KEY) === 'detail' ? 'detail' : 'simple';
  }

  function setMode(next) {
    const value = next === 'detail' ? 'detail' : 'simple';
    localStorage.setItem(MODE_KEY, value);
    document.body.dataset.fsMode = value;
    syncModeButton();
    scheduleRender();
  }

  function syncModeButton() {
    const btn = q('#fsModeToggle');
    if (!btn) return;
    const simple = mode() === 'simple';
    btn.innerHTML = `<span class="fs-mode-dot"></span>${simple ? 'Simple' : 'Detail'}`;
    btn.title = simple
      ? 'Simple mode: weekly decisions only'
      : 'Detail mode: show deeper model data';
    btn.setAttribute('aria-pressed', simple ? 'true' : 'false');
  }

  function installModeToggle() {
    if (q('#fsModeToggle')) return;
    const actions = q('.top-actions');
    if (!actions) return;

    const btn = document.createElement('button');
    btn.id = 'fsModeToggle';
    btn.className = 'fs-mode-toggle';
    btn.type = 'button';
    btn.addEventListener('click', () => {
      setMode(mode() === 'simple' ? 'detail' : 'simple');
    });

    actions.insertBefore(btn, q('#refreshBtn'));
    syncModeButton();
  }

  function appReady() {
    try {
      return !!(
        typeof state !== 'undefined' &&
        state?.players?.length &&
        state?.teamData?.some?.(x => x.ok) &&
        state?.nextEvents?.length
      );
    } catch {
      return false;
    }
  }

  function nextGw() {
    try { return Number(state?.nextEvents?.[0]?.id || 0); }
    catch { return 0; }
  }

  function deadlineInfo() {
    try {
      const gw = nextGw();
      const event = state?.events?.find?.(e => Number(e.id) === gw);
      if (!event?.deadline_time) return {label:'Deadline —', sub:''};

      const d = new Date(event.deadline_time);
      const ms = d.getTime() - Date.now();
      const abs = Math.abs(ms);
      const hours = Math.floor(abs / 3600000);
      const mins = Math.floor((abs % 3600000) / 60000);

      const local = d.toLocaleString(undefined, {
        weekday:'short', day:'numeric', month:'short',
        hour:'2-digit', minute:'2-digit'
      });

      if (ms <= 0) return {label:'Deadline passed', sub:local};
      if (hours < 24) return {label:`${hours}h ${mins}m left`, sub:local};

      const days = Math.floor(hours / 24);
      return {label:`${days}d ${hours % 24}h left`, sub:local};
    } catch {
      return {label:'Deadline —', sub:''};
    }
  }

  function captainPool() {
    try {
      return [...state.players]
        .filter(p =>
          Number(p.captainScore || 0) > 0 &&
          Number(p.xmins || 0) >= 60 &&
          p.status !== 'u'
        )
        .sort((a,b) => Number(b.captainScore||0) - Number(a.captainScore||0))
        .slice(0,3);
    } catch {
      return [];
    }
  }

  function ownedIds() {
    const ids = new Set();
    try {
      for (const td of state.teamData.filter(x => x.ok)) {
        for (const pick of (td.picks?.picks || [])) ids.add(Number(pick.element));
      }
    } catch {}
    return ids;
  }

  function ownedAlerts() {
    try {
      const ids = ownedIds();
      return state.players
        .filter(p => ids.has(Number(p.id)))
        .filter(p =>
          p.status !== 'a' ||
          Number(p.xmins || 0) < 58 ||
          (p.news && String(p.news).trim())
        )
        .sort((a,b) =>
          Number(a.xmins||0) - Number(b.xmins||0) ||
          Number(b.xp?.[0]||0) - Number(a.xp?.[0]||0)
        )
        .slice(0,6);
    } catch {
      return [];
    }
  }

  function teamAlertCount(td) {
    try {
      const ids = new Set((td.picks?.picks || []).map(x => Number(x.element)));
      return state.players.filter(p =>
        ids.has(Number(p.id)) &&
        (
          p.status !== 'a' ||
          Number(p.xmins || 0) < 58 ||
          (p.news && String(p.news).trim())
        )
      ).length;
    } catch {
      return 0;
    }
  }

  function teamPlan(td) {
    try {
      const p = teamProjection(td);
      const ft = inferredFreeTransfers(td);
      const cp = firstHalfChipPlan(td);
      const gw = nextGw();
      const bestChip = cp?.best;
      const chipNow = bestChip && Number(bestChip.gw) === gw ? bestChip.chip : null;
      const xiIds = new Set((p.xi || []).map(x => Number(x.id)));
      const bench = (p.players || [])
        .filter(x => !xiIds.has(Number(x.id)))
        .sort((a,b) => Number(b.xp?.[0]||0) - Number(a.xp?.[0]||0));

      return {
        td,
        projection:p,
        ft,
        chipNow,
        alerts:teamAlertCount(td),
        bench,
      };
    } catch {
      return null;
    }
  }

  function cockpitMarkup() {
    const gw = nextGw();
    const deadline = deadlineInfo();
    const captains = captainPool();
    const alerts = ownedAlerts();
    const top = captains[0];
    const model = state?.projectionData?.model_version || 'SZxP';
    const teamsOk = state.teamData.filter(x => x.ok).length;

    return `
      <div class="fs-week-head">
        <div class="fs-week-title">
          <div class="eyebrow">Weekly Control</div>
          <h1>GW${gw} Plan</h1>
        </div>
        <div class="fs-deadline">
          <b>${esc(deadline.label)}</b>
          <span>${esc(deadline.sub)}</span>
        </div>
      </div>

      <div class="fs-focus-grid">
        <div class="fs-focus-card primary">
          <div class="fs-focus-label">Captain lead</div>
          <div class="fs-focus-value">${top ? esc(top.web_name) : '—'}</div>
          <div class="fs-focus-note">${top ? `${fmt(top.xp?.[0])} xP · ${Math.round(Number(top.xmins||0))} xMins` : 'Waiting for projection data'}</div>
        </div>

        <div class="fs-focus-card">
          <div class="fs-focus-label">Squad alerts</div>
          <div class="fs-focus-value">${alerts.length}</div>
          <div class="fs-focus-note">${alerts.length ? 'Owned players to review' : 'No urgent owned-player flags'}</div>
        </div>

        <div class="fs-focus-card">
          <div class="fs-focus-label">Teams loaded</div>
          <div class="fs-focus-value">${teamsOk}/9</div>
          <div class="fs-focus-note">Latest public locked squads</div>
        </div>

        <div class="fs-focus-card">
          <div class="fs-focus-label">Model</div>
          <div class="fs-focus-value" style="font-size:18px">${esc(model.replace(' Commercial Core',''))}</div>
          <div class="fs-focus-note">Production feed · deeper audit in Detail mode</div>
        </div>
      </div>

      <div class="fs-actions">
        <button class="fs-action-button" data-fs-go="transfers">
          <b>1 · Transfers</b><span>What should each team do?</span>
        </button>
        <button class="fs-action-button" data-fs-go="teams">
          <b>2 · XI & Bench</b><span>Starting XI, bench, C & VC</span>
        </button>
        <button class="fs-action-button" data-fs-go="players">
          <b>3 · Players</b><span>Search only when needed</span>
        </button>
        <button class="fs-action-button" data-fs-go="weekly">
          <b>4 · Weekly Builds</b><span>Best 15 & prize-team tools</span>
        </button>
      </div>

      <div class="fs-home-two">
        <div class="fs-mini-panel">
          <div class="fs-mini-head">
            <h2>Captain shortlist</h2>
            <span class="fs-pill good">Top 3</span>
          </div>
          ${captains.map((p,i)=>`
            <div class="fs-shortlist-row">
              <div class="fs-number">${i+1}</div>
              <div class="fs-row-main">
                <b>${esc(p.web_name)}</b>
                <span>${esc(p.teamCode)} · ${esc(p.pos)} · ${Math.round(Number(p.xmins||0))} xMins</span>
              </div>
              <div class="fs-row-score">${fmt(p.xp?.[0])}</div>
            </div>
          `).join('') || '<div class="fs-empty-friendly">No captain shortlist yet.</div>'}
        </div>

        <div class="fs-mini-panel">
          <div class="fs-mini-head">
            <h2>Owned-player alerts</h2>
            <span class="fs-pill">${alerts.length}</span>
          </div>
          ${alerts.map(p=>`
            <div class="fs-alert-row">
              <div class="fs-number">!</div>
              <div class="fs-row-main">
                <b>${esc(p.web_name)}</b>
                <span>${esc(p.news || `${Math.round(Number(p.xmins||0))} xMins`)} </span>
              </div>
              <div class="fs-row-score">${Math.round(Number(p.xmins||0))}</div>
            </div>
          `).join('') || '<div class="fs-empty-friendly">Nothing urgent in your nine locked squads.</div>'}
        </div>
      </div>
    `;
  }

  function renderCockpit() {
    if (!appReady()) return;
    const overview = q('#overview');
    if (!overview) return;

    let el = q('#fsWeeklyCockpit', overview);
    if (!el) {
      el = document.createElement('div');
      el.id = 'fsWeeklyCockpit';
      overview.prepend(el);
    }
    el.innerHTML = cockpitMarkup();
  }

  function lineupPlayerChip(p, captainId, viceId) {
    const cls = Number(p.id) === Number(captainId) ? ' captain' : '';
    const suffix = Number(p.id) === Number(captainId)
      ? ' · C'
      : Number(p.id) === Number(viceId)
        ? ' · VC'
        : '';
    return `<span class="fs-player-chip${cls}">${esc(p.web_name)}${suffix}</span>`;
  }

  function teamBoardMarkup() {
    const plans = state.teamData
      .filter(x => x.ok)
      .map(teamPlan)
      .filter(Boolean);

    return `
      <div class="fs-team-board-head">
        <div>
          <div class="eyebrow">My Teams</div>
          <h1>9-team weekly board</h1>
        </div>
        <div class="fs-simple-hint">Tap a team to expand</div>
      </div>

      <div class="fs-team-list">
        ${plans.map(plan => {
          const p = plan.projection;
          const gw = nextGw();
          const cap = p.captain;
          const vice = p.vice;
          const capId = cap?.id;
          const viceId = vice?.id;

          return `
            <details class="fs-team-item" data-entry="${plan.td.id}">
              <summary>
                <div class="fs-team-summary">
                  <div class="fs-team-name">
                    <b>${esc(plan.td.name)}</b>
                    <span>${esc(plan.td.type)}</span>
                  </div>
                  <div class="fs-team-kpi">
                    <span>GW xP</span>
                    <b>${fmt(p.xp1)}</b>
                  </div>
                  <div class="fs-team-kpi fs-ft-kpi">
                    <span>FT</span>
                    <b>${plan.ft}</b>
                  </div>
                  <div class="fs-team-kpi">
                    <span>Captain</span>
                    <b>${cap ? esc(cap.web_name) : '—'}</b>
                  </div>
                  <div class="fs-team-chip ${plan.chipNow ? 'live' : ''}">
                    ${plan.chipNow ? `${esc(plan.chipNow)} WATCH` : 'NO CHIP'}
                  </div>
                  <div class="fs-chevron">⌄</div>
                </div>
              </summary>

              <div class="fs-team-detail">
                <div class="fs-line-label">Start these 11 · ${esc(p.formation || '—')}</div>
                <div class="fs-player-chips">
                  ${(p.xi || [])
                    .slice()
                    .sort((a,b) => Number(a.element_type)-Number(b.element_type))
                    .map(x => lineupPlayerChip(x, capId, viceId))
                    .join('')}
                </div>

                <div class="fs-team-detail-grid">
                  <div>
                    <div class="fs-line-label">Bench</div>
                    <div class="fs-player-chips">
                      ${plan.bench.map(x=>`<span class="fs-player-chip">${esc(x.web_name)}</span>`).join('') || '—'}
                    </div>
                  </div>
                  <div>
                    <div class="fs-line-label">This week</div>
                    <div class="fs-player-chips">
                      <span class="fs-player-chip">VC ${vice ? esc(vice.web_name) : '—'}</span>
                      <span class="fs-player-chip">${plan.alerts} alert${plan.alerts===1?'':'s'}</span>
                      <span class="fs-player-chip">${plan.chipNow ? `${esc(plan.chipNow)} review` : 'No chip signal'}</span>
                    </div>
                  </div>
                </div>

                <div class="fs-team-detail-actions">
                  <button class="fs-small-button primary" data-fs-transfer-team="${plan.td.id}">Transfer plan</button>
                  <button class="fs-small-button" data-fs-go="players">Player search</button>
                </div>
              </div>
            </details>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderTeamBoard() {
    if (!appReady()) return;
    const teams = q('#teams');
    if (!teams) return;

    let board = q('#fsTeamBoard', teams);
    if (!board) {
      board = document.createElement('div');
      board.id = 'fsTeamBoard';
      teams.prepend(board);
    }
    board.innerHTML = teamBoardMarkup();
  }

  function simplifyVisibleCopy() {
    const playerH1 = q('#players .hero h1');
    if (playerH1) playerH1.textContent = 'Player Szentre';

    const transferH1 = q('#transfers .hero h1');
    if (transferH1 && !/Building|could not/i.test(transferH1.textContent || '')) {
      transferH1.textContent = 'Transfer Plan';
    }

    const marketH1 = q('#market .hero h1');
    if (marketH1) marketH1.textContent = 'Market & Injuries';

    const teamH1 = q('#teams .hero h1');
    if (teamH1) teamH1.textContent = 'My Teams';

    // Current legacy copy can still mention 2.1 even though canonical feed is 3.0.
    qa('#overview h2, #overview p, #players p').forEach(el => {
      if (el.textContent?.includes('SZxP 2.1')) {
        el.textContent = el.textContent.replace(/SZxP 2\.1/g, state?.projectionData?.model_version || 'SZxP');
      }
    });
  }

  function markAdvancedTransferParts() {
    const transfer = q('#transfers');
    if (!transfer) return;

    qa('.section.card', transfer).forEach(section => {
      const heading = q('.section-head h2', section)?.textContent?.trim() || '';
      if (/Best alternatives/i.test(heading)) {
        section.classList.add('fs-transfer-alternatives', 'fs-advanced-only');
      }
    });

    qa('.notice', transfer).forEach(n => {
      const text = n.textContent || '';
      if (/Portfolio exposure/i.test(text)) {
        n.classList.add('fs-transfer-exposure', 'fs-advanced-only');
      }
    });

    qa('.model-note', transfer).forEach(n => n.classList.add('fs-advanced-only'));
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      if (mutationLock) return;
      mutationLock = true;
      try {
        installModeToggle();
        if (appReady()) {
          renderCockpit();
          renderTeamBoard();
          simplifyVisibleCopy();
          markAdvancedTransferParts();
        }
      } finally {
        setTimeout(() => { mutationLock = false; }, 40);
      }
    }, 90);
  }

  function go(view) {
    try {
      if (typeof openView === 'function') openView(view);
      else {
        qa('.view').forEach(v => v.classList.toggle('active', v.id === view));
        qa('.nav-item').forEach(v => v.classList.toggle('active', v.dataset.view === view));
      }
    } catch {}
  }

  document.body.addEventListener('click', e => {
    const goBtn = e.target.closest('[data-fs-go]');
    if (goBtn) {
      go(goBtn.dataset.fsGo);
      return;
    }

    const transferBtn = e.target.closest('[data-fs-transfer-team]');
    if (transferBtn) {
      const id = String(transferBtn.dataset.fsTransferTeam);
      localStorage.setItem('fs:portfolioTransferTeam', id);
      localStorage.setItem('fs:transferTeam', id);
      go('transfers');
      setTimeout(() => {
        // portfolio-transfer.js builds when Transfers is opened.
        const select = q('#portfolioTransferTeamSelect');
        if (select && String(select.value) !== id) {
          select.value = id;
          select.dispatchEvent(new Event('change', {bubbles:true}));
        }
      }, 180);
    }
  });

  const observer = new MutationObserver(() => scheduleRender());
  observer.observe(document.body, {childList:true, subtree:true});

  document.body.dataset.fsMode = mode();
  installModeToggle();
  scheduleRender();

  window.addEventListener('load', () => {
    scheduleRender();
    setInterval(() => {
      if (q('#fsWeeklyCockpit') && mode() === 'simple') renderCockpit();
    }, 60000);
  });

  window.FSWeeklyUX = {
    version: VERSION,
    setMode,
    render: scheduleRender,
  };
})();
