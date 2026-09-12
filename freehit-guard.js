(() => {
  'use strict';

  /*
   * Fantaszy Szentre — Free Hit Reversion Guard
   *
   * Purpose:
   * FPL's public picks endpoint shows the one-week Free Hit squad for the
   * Gameweek in which the chip was played. When planning the following GW,
   * that is NOT the manager's permanent squad. This guard replaces the
   * temporary FH squad with the most recent non-Free-Hit public squad before
   * the rest of Fantaszy Szentre consumes it.
   *
   * It works in two layers:
   *  1) intercept public FPL picks fetches before data-adapter.js sees them;
   *  2) repair state.teamData later as a safety net if data came from cache.
   */

  const VERSION = '20260912-freehit-reversion-1';
  const nativeFetch = window.fetch.bind(window);
  const pickCache = new Map();
  const resolvingTeams = new Map();
  const MAX_LOOKBACK = 38;

  const n = v => Number(v || 0);

  function chipName(v) {
    return String(v || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  }

  function isFreeHit(data) {
    const c = chipName(data?.active_chip);
    return c === 'freehit' || c === 'freehitchip' || c === 'fh';
  }

  function parsePicksUrl(raw) {
    try {
      const url = typeof raw === 'string' ? raw : raw?.url;
      if (!url) return null;
      const u = new URL(url, window.location.href);
      const m = u.pathname.match(/\/api\/entry\/(\d+)\/event\/(\d+)\/picks\/?$/i);
      if (!m) return null;
      return {
        entryId: Number(m[1]),
        gw: Number(m[2]),
        url: u,
        original: url,
      };
    } catch {
      return null;
    }
  }

  function buildPreviousUrl(parsed, gw) {
    const u = new URL(parsed.url.href);
    u.pathname = u.pathname.replace(
      /\/api\/entry\/\d+\/event\/\d+\/picks\/?$/i,
      `/api/entry/${parsed.entryId}/event/${gw}/picks/`
    );
    u.search = '';
    return u.href;
  }

  async function jsonFromResponse(response) {
    try {
      return await response.clone().json();
    } catch {
      return null;
    }
  }

  async function getHistoricalPicks(parsed, gw, init) {
    const key = `${parsed.entryId}:${gw}`;
    if (pickCache.has(key)) return pickCache.get(key);

    const promise = (async () => {
      try {
        const response = await nativeFetch(buildPreviousUrl(parsed, gw), {
          ...(init || {}),
          cache: 'no-store',
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (!Array.isArray(data?.picks) || data.picks.length !== 15) return null;
        return data;
      } catch {
        return null;
      }
    })();

    pickCache.set(key, promise);
    return promise;
  }

  async function findPermanentSquad(parsed, init) {
    let gw = parsed.gw - 1;
    let checked = 0;

    while (gw >= 1 && checked < MAX_LOOKBACK) {
      const data = await getHistoricalPicks(parsed, gw, init);
      if (data && !isFreeHit(data)) {
        return { gw, data };
      }
      gw -= 1;
      checked += 1;
    }
    return null;
  }

  function effectiveEntryHistory(current, previous, requestedGw) {
    const currentHistory = current?.entry_history || {};
    const previousHistory = previous?.entry_history || {};

    // Keep the latest completed-GW performance fields, but restore permanent
    // squad finance and discard temporary FH transfer counts.
    return {
      ...previousHistory,
      ...currentHistory,
      event: n(currentHistory.event) || requestedGw,
      bank: previousHistory.bank ?? currentHistory.bank ?? 0,
      value: previousHistory.value ?? currentHistory.value ?? 0,
      event_transfers: 0,
      event_transfers_cost: 0,
    };
  }

  function makeEffectivePayload(current, source, parsed) {
    const meta = {
      type: 'freehit-reversion',
      freehit_event: parsed.gw,
      permanent_source_event: source.gw,
      public_baseline: true,
      resolved_at: new Date().toISOString(),
      version: VERSION,
    };

    return {
      ...current,
      active_chip: null,
      picks: (source.data.picks || []).map(p => ({ ...p })),
      entry_history: effectiveEntryHistory(current, source.data, parsed.gw),
      _fs_freehit_reversion: meta,
      _fs_original_active_chip: current?.active_chip || 'freehit',
    };
  }

  function responseFromJson(data, originalResponse) {
    const headers = new Headers();
    headers.set('content-type', 'application/json; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    const status = originalResponse?.status >= 200 && originalResponse?.status < 300
      ? originalResponse.status
      : 200;
    return new Response(JSON.stringify(data), {
      status,
      statusText: originalResponse?.statusText || 'OK',
      headers,
    });
  }

  async function resolveFreeHitResponse(parsed, currentData, originalResponse, init) {
    const source = await findPermanentSquad(parsed, init);
    if (!source) {
      const unresolved = {
        ...currentData,
        _fs_freehit_unresolved: {
          type: 'freehit-unresolved',
          freehit_event: parsed.gw,
          version: VERSION,
        },
      };
      return responseFromJson(unresolved, originalResponse);
    }
    return responseFromJson(makeEffectivePayload(currentData, source, parsed), originalResponse);
  }

  // Install BEFORE data-adapter.js.
  window.fetch = async function fsFreeHitAwareFetch(input, init) {
    const response = await nativeFetch(input, init);
    const parsed = parsePicksUrl(input);
    if (!parsed || !response.ok) return response;

    const data = await jsonFromResponse(response);
    if (!data || !isFreeHit(data)) return response;

    return resolveFreeHitResponse(parsed, data, response, init);
  };

  function currentSellingPrice(purchasePrice, currentPrice) {
    const purchase = n(purchasePrice);
    const current = n(currentPrice);
    if (!purchase || !current) return n(currentPrice || purchasePrice);
    if (current <= purchase) return current;
    return purchase + Math.floor((current - purchase) / 2);
  }

  function refreshFinance(td) {
    const meta = td?.picks?._fs_freehit_reversion;
    if (!meta || !Array.isArray(td?.picks?.picks) || !Array.isArray(window.state?.players)) return;

    let squadSellingValue = 0;
    td.picks.picks = td.picks.picks.map(pick => {
      const player = state.players.find(p => Number(p.id) === Number(pick.element));
      if (!player) {
        squadSellingValue += n(pick.selling_price);
        return pick;
      }
      const selling = currentSellingPrice(pick.purchase_price, player.now_cost);
      squadSellingValue += selling;
      return { ...pick, selling_price: selling };
    });

    const bank = n(td.picks?.entry_history?.bank);
    if (td.picks.entry_history) {
      td.picks.entry_history.value = squadSellingValue + bank;
    }
  }

  async function resolveTeamData(td) {
    if (!td?.ok || !td?.picks || !isFreeHit(td.picks)) return false;
    const entryId = Number(td.id || td.entry?.id || td.entry?.entry);
    const gw = Number(td.picks?.entry_history?.event || window.state?.publishedGW || 0);
    if (!entryId || !gw) return false;

    const key = `${entryId}:${gw}`;
    if (resolvingTeams.has(key)) return resolvingTeams.get(key);

    const promise = (async () => {
      const parsed = parsePicksUrl(
        `https://fantasy.premierleague.com/api/entry/${entryId}/event/${gw}/picks/`
      );
      if (!parsed) return false;

      const source = await findPermanentSquad(parsed, { cache: 'no-store' });
      if (!source) {
        td.picks._fs_freehit_unresolved = {
          type: 'freehit-unresolved',
          freehit_event: gw,
          version: VERSION,
        };
        return false;
      }

      if (!td._fs_public_freehit_picks) td._fs_public_freehit_picks = td.picks;
      td.picks = makeEffectivePayload(td.picks, source, parsed);
      refreshFinance(td);
      return true;
    })();

    resolvingTeams.set(key, promise);
    try {
      return await promise;
    } finally {
      resolvingTeams.delete(key);
    }
  }

  async function repairLoadedState() {
    const list = window.state?.teamData;
    if (!Array.isArray(list) || !list.length) return false;

    let changed = false;
    for (const td of list) {
      if (td?.picks?._fs_freehit_reversion) {
        refreshFinance(td);
        continue;
      }
      if (isFreeHit(td?.picks)) {
        const fixed = await resolveTeamData(td);
        changed = changed || fixed;
      }
    }

    if (changed) {
      try { window.FSOwner30?.render?.(); } catch {}
    }
    return changed;
  }

  function selectedTeamData() {
    const list = window.state?.teamData;
    if (!Array.isArray(list)) return null;
    const picker = document.getElementById('fs30TeamPicker');
    const id = Number(picker?.value || 0);
    return list.find(x => Number(x.id) === id) || null;
  }

  function injectSourceNote() {
    const hub = document.getElementById('fsTeamHub');
    if (!hub) return;

    const old = hub.querySelector('.fs-fh-source-note');
    const td = selectedTeamData();
    const meta = td?.picks?._fs_freehit_reversion;
    const unresolved = td?.picks?._fs_freehit_unresolved;

    if (!meta && !unresolved) {
      old?.remove();
      return;
    }

    const note = old || document.createElement('div');
    note.className = 'fs-fh-source-note';

    if (meta) {
      note.innerHTML =
        `<b>Free Hit reversion applied</b>` +
        `<span>GW${meta.freehit_event} temporary squad ignored · ` +
        `using permanent GW${meta.permanent_source_event} squad as the public baseline.</span>`;
    } else {
      note.innerHTML =
        `<b>Free Hit squad not used for recommendations</b>` +
        `<span>Permanent squad could not be verified yet. Refresh before acting on transfers.</span>`;
    }

    if (!old) {
      const picker = hub.querySelector('#fs30TeamPicker');
      if (picker?.parentNode) {
        picker.insertAdjacentElement('afterend', note);
      } else {
        hub.prepend(note);
      }
    }
  }

  function audit() {
    return (window.state?.teamData || []).map(td => ({
      id: td.id,
      name: td.name,
      activeChip: td.picks?.active_chip || null,
      reversion: td.picks?._fs_freehit_reversion || null,
      unresolved: td.picks?._fs_freehit_unresolved || null,
      squad: (td.picks?.picks || []).map(p => Number(p.element)),
    }));
  }

  // Safety-net loop for cached/bundled team data and finance refresh.
  let cycles = 0;
  const timer = setInterval(async () => {
    cycles += 1;
    try {
      await repairLoadedState();
      injectSourceNote();
    } catch {}
    if (cycles > 120) clearInterval(timer);
  }, 500);

  window.FSFreeHitGuard = {
    version: VERSION,
    isFreeHit,
    resolveTeamData,
    repairLoadedState,
    refreshFinance,
    audit,
  };
})();
