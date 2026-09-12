(() => {
  'use strict';

  /*
   * Fantaszy Szentre — Free Hit Reversion Guard v2
   *
   * v2 fixes the important case where the app's normalized/cached picks object
   * no longer contains active_chip. We now verify the chip from the official
   * entry history, then mutate the already-loaded teamData IN PLACE so every
   * consumer (XI, captain, bench, transfer, chip and warnings) sees the same
   * permanent squad.
   */

  const VERSION = '20260912-freehit-reversion-2';
  const FPL = 'https://fantasy.premierleague.com/api';
  const nativeFetch = window.fetch.bind(window);

  const historyCache = new Map();
  const picksCache = new Map();
  const resolving = new Map();

  const n = v => Number(v || 0);
  const norm = v => String(v || '').trim().toLowerCase().replace(/[\s_-]+/g, '');

  function isFreeHitName(name) {
    const x = norm(name);
    return x === 'freehit' || x === 'freehitchip' || x === 'fh';
  }

  function validPicksPayload(x) {
    return Boolean(x && Array.isArray(x.picks) && x.picks.length === 15);
  }

  function responseJson(data, original) {
    const headers = new Headers();
    headers.set('content-type', 'application/json; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    return new Response(JSON.stringify(data), {
      status: original?.ok ? original.status : 200,
      statusText: original?.statusText || 'OK',
      headers
    });
  }

  function parseEntryPicks(input) {
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      if (!raw) return null;
      const u = new URL(raw, location.href);
      const m = u.pathname.match(/\/api\/entry\/(\d+)\/event\/(\d+)\/picks\/?$/i);
      return m ? {entryId:Number(m[1]), gw:Number(m[2])} : null;
    } catch {
      return null;
    }
  }

  async function fetchOfficialJson(url, init={}) {
    try {
      const r = await nativeFetch(url, {...init, cache:'no-store'});
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  async function officialHistory(entryId) {
    entryId = Number(entryId);
    if (!entryId) return null;
    if (!historyCache.has(entryId)) {
      historyCache.set(entryId, fetchOfficialJson(`${FPL}/entry/${entryId}/history/`));
    }
    return historyCache.get(entryId);
  }

  async function officialPicks(entryId, gw) {
    entryId = Number(entryId); gw = Number(gw);
    if (!entryId || !gw) return null;
    const key = `${entryId}:${gw}`;
    if (!picksCache.has(key)) {
      picksCache.set(key, fetchOfficialJson(`${FPL}/entry/${entryId}/event/${gw}/picks/`));
    }
    return picksCache.get(key);
  }

  function localChipArrays(td) {
    return [
      td?.history?.chips,
      td?.entry_history?.chips,
      td?.entry?.history?.chips,
      td?.entry?.chips,
      td?.chips,
      td?.picks?.chips
    ].filter(Array.isArray);
  }

  function localFreeHitEvent(td, gw) {
    for (const chips of localChipArrays(td)) {
      const hit = chips.find(c => Number(c?.event) === Number(gw) && isFreeHitName(c?.name || c?.chip));
      if (hit) return Number(gw);
    }
    return 0;
  }

  async function verifiedFreeHitEvent(td, entryId, gw) {
    if (isFreeHitName(td?.picks?.active_chip)) return Number(gw);

    const local = localFreeHitEvent(td, gw);
    if (local) return local;

    const history = await officialHistory(entryId);
    const hit = (history?.chips || []).find(c =>
      Number(c?.event) === Number(gw) && isFreeHitName(c?.name)
    );
    return hit ? Number(gw) : 0;
  }

  async function previousPermanentPicks(entryId, beforeGw) {
    for (let gw = Number(beforeGw) - 1; gw >= 1; gw--) {
      const [picks, history] = await Promise.all([
        officialPicks(entryId, gw),
        officialHistory(entryId)
      ]);
      if (!validPicksPayload(picks)) continue;

      const fh = (history?.chips || []).some(c =>
        Number(c?.event) === gw && isFreeHitName(c?.name)
      ) || isFreeHitName(picks?.active_chip);

      if (!fh) return {gw, data:picks};
    }
    return null;
  }

  function currentSellingPrice(purchase, current) {
    purchase = n(purchase);
    current = n(current);
    if (!purchase) return current;
    if (!current) return purchase;
    if (current <= purchase) return current;
    return purchase + Math.floor((current - purchase) / 2);
  }

  function playerNowCost(id) {
    const p = (window.state?.players || []).find(x => Number(x.id) === Number(id));
    return n(p?.now_cost);
  }

  function restoreFinance(current, source) {
    const bank = source?.entry_history?.bank ?? current?.entry_history?.bank ?? 0;

    let sellingTotal = 0;
    for (const p of current.picks || []) {
      const now = playerNowCost(p.element);
      const selling = currentSellingPrice(p.purchase_price, now || p.selling_price);
      p.selling_price = selling;
      sellingTotal += selling;
    }

    current.entry_history = {
      ...(current.entry_history || {}),
      bank: n(bank),
      value: sellingTotal ? sellingTotal + n(bank) : (source?.entry_history?.value ?? current?.entry_history?.value ?? 0),
      event_transfers: 0,
      event_transfers_cost: 0
    };
  }

  function applyInPlace(td, freeHitGw, source) {
    const current = td?.picks;
    if (!current || !validPicksPayload(source?.data)) return false;

    if (!td._fs_public_freehit_snapshot) {
      try { td._fs_public_freehit_snapshot = JSON.parse(JSON.stringify(current)); }
      catch { td._fs_public_freehit_snapshot = current; }
    }

    // Important: mutate the EXISTING array/object instead of replacing it.
    // Any function that already kept a reference to td.picks now sees the fix.
    const arr = Array.isArray(current.picks) ? current.picks : [];
    arr.splice(0, arr.length, ...source.data.picks.map(p => ({...p})));
    current.picks = arr;

    current.active_chip = null;
    current._fs_original_active_chip = 'freehit';
    current._fs_freehit_reversion = {
      type:'freehit-reversion',
      freehit_event:Number(freeHitGw),
      permanent_source_event:Number(source.gw),
      verified_from:'entry-history',
      resolved_at:new Date().toISOString(),
      version:VERSION
    };
    delete current._fs_freehit_unresolved;

    // Keep latest GW identity for UI/rank context, but use permanent-squad finance.
    current.entry_history = {
      ...(source.data.entry_history || {}),
      ...(current.entry_history || {}),
      event: Number(current.entry_history?.event || freeHitGw)
    };

    restoreFinance(current, source.data);

    td._fs_effective_squad_event = Number(source.gw);
    td._fs_freehit_event = Number(freeHitGw);
    return true;
  }

  function teamEntryId(td) {
    return Number(td?.id || td?.entry?.id || td?.entry?.entry || 0);
  }

  function snapshotGw(td) {
    return Number(
      td?.picks?.entry_history?.event ||
      window.state?.publishedGW ||
      td?.entry?.current_event ||
      0
    );
  }

  async function resolveTeam(td) {
    if (!td?.ok || !td?.picks) return false;
    if (td.picks._fs_freehit_reversion?.version === VERSION) return true;

    const entryId = teamEntryId(td);
    const gw = snapshotGw(td);
    if (!entryId || !gw) return false;

    const key = `${entryId}:${gw}`;
    if (resolving.has(key)) return resolving.get(key);

    const task = (async () => {
      const fhGw = await verifiedFreeHitEvent(td, entryId, gw);
      if (!fhGw) {
        td._fs_squad_source_verified = true;
        return false;
      }

      const source = await previousPermanentPicks(entryId, fhGw);
      if (!source) {
        td.picks._fs_freehit_unresolved = {
          type:'freehit-unresolved',
          freehit_event:fhGw,
          version:VERSION
        };
        td._fs_squad_source_verified = false;
        return false;
      }

      const changed = applyInPlace(td, fhGw, source);
      td._fs_squad_source_verified = changed;
      return changed;
    })();

    resolving.set(key, task);
    try { return await task; }
    finally { resolving.delete(key); }
  }

  async function repairAll() {
    const list = window.state?.teamData;
    if (!Array.isArray(list) || !list.length) return false;

    let changed = false;
    for (const td of list) {
      try {
        const x = await resolveTeam(td);
        changed = changed || x;
      } catch {}
    }

    if (changed) {
      // Re-render every owner recommendation surface after the mutation.
      try { window.FSOwner30?.render?.(); } catch {}
      try { window.FSWeekly30?.render?.(); } catch {}
      try { window.renderTeams?.(); } catch {}
    }
    return changed;
  }

  function selectedTeam() {
    const list = window.state?.teamData || [];
    const id = Number(document.getElementById('fs30TeamPicker')?.value || 0);
    return list.find(x => Number(x.id) === id) || null;
  }

  function injectNote() {
    const hub = document.getElementById('fsTeamHub');
    if (!hub) return;
    const td = selectedTeam();
    const meta = td?.picks?._fs_freehit_reversion;
    const unresolved = td?.picks?._fs_freehit_unresolved;
    let note = hub.querySelector('.fs-fh-source-note');

    if (!meta && !unresolved) {
      note?.remove();
      return;
    }

    if (!note) {
      note = document.createElement('div');
      note.className = 'fs-fh-source-note';
      const picker = hub.querySelector('#fs30TeamPicker');
      if (picker) picker.insertAdjacentElement('afterend', note);
      else hub.prepend(note);
    }

    if (meta) {
      note.innerHTML =
        `<b>Free Hit reversion verified</b>` +
        `<span>GW${meta.freehit_event} temporary squad ignored · ` +
        `permanent GW${meta.permanent_source_event} squad used for planning.</span>`;
    } else {
      note.innerHTML =
        `<b>Squad source not verified</b>` +
        `<span>Free Hit detected but permanent squad could not be loaded. ` +
        `Do not act on transfer advice yet.</span>`;
    }
  }

  /*
   * Fetch interception remains as an EARLY fast-path. Unlike v1, v2 does not
   * depend on it because the post-load history audit above is authoritative.
   */
  window.fetch = async function freeHitAwareFetch(input, init) {
    const response = await nativeFetch(input, init);
    const parsed = parseEntryPicks(input);
    if (!parsed || !response.ok) return response;

    let data = null;
    try { data = await response.clone().json(); } catch {}
    if (!validPicksPayload(data)) return response;

    let fh = isFreeHitName(data.active_chip);
    if (!fh) {
      const history = await officialHistory(parsed.entryId);
      fh = (history?.chips || []).some(c =>
        Number(c?.event) === parsed.gw && isFreeHitName(c?.name)
      );
    }
    if (!fh) return response;

    const source = await previousPermanentPicks(parsed.entryId, parsed.gw);
    if (!source) return response;

    const effective = JSON.parse(JSON.stringify(data));
    effective.picks = source.data.picks.map(p => ({...p}));
    effective.active_chip = null;
    effective._fs_original_active_chip = data.active_chip || 'freehit';
    effective._fs_freehit_reversion = {
      type:'freehit-reversion',
      freehit_event:parsed.gw,
      permanent_source_event:source.gw,
      verified_from:'entry-history',
      version:VERSION
    };
    effective.entry_history = {
      ...(source.data.entry_history || {}),
      ...(data.entry_history || {}),
      event:Number(data.entry_history?.event || parsed.gw),
      bank:source.data.entry_history?.bank ?? data.entry_history?.bank ?? 0,
      event_transfers:0,
      event_transfers_cost:0
    };
    return responseJson(effective, response);
  };

  function audit() {
    return (window.state?.teamData || []).map(td => ({
      id: teamEntryId(td),
      name: td?.name,
      snapshotGw: snapshotGw(td),
      activeChip: td?.picks?.active_chip || null,
      reversion: td?.picks?._fs_freehit_reversion || null,
      unresolved: td?.picks?._fs_freehit_unresolved || null,
      verified: td?._fs_squad_source_verified ?? null,
      elements: (td?.picks?.picks || []).map(p => Number(p.element))
    }));
  }

  // Run long enough to cover slow mobile/API hydration.
  let cycles = 0;
  const timer = setInterval(async () => {
    cycles++;
    try {
      await repairAll();
      injectNote();
    } catch {}
    if (cycles >= 240) clearInterval(timer); // 2 minutes
  }, 500);

  document.addEventListener('change', e => {
    if (e.target?.id === 'fs30TeamPicker') setTimeout(injectNote, 0);
  });

  window.FSFreeHitGuard = {
    version:VERSION,
    resolveTeam,
    repairAll,
    audit,
    officialHistory,
    officialPicks
  };
})();
