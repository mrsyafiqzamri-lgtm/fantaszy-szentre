(() => {
  'use strict';

  /*
   * Fantaszy Szentre — Canonical Squad / Free Hit Reversion Guard v3
   *
   * Key change from v1/v2:
   * - My Team is NOT allowed to initialise until this guard finishes.
   * - Entry ID resolution no longer depends on one td.id field.
   * - Owner team names are mapped to their known FPL Entry IDs as a fallback.
   * - Free Hit is verified from official entry history.
   * - The temporary FH 15 is replaced IN PLACE with the last permanent 15.
   */

  const VERSION = '20260912-freehit-reversion-3';
  const FPL = 'https://fantasy.premierleague.com/api';
  const nativeFetch = window.fetch.bind(window);

  const OWNER_IDS = new Map([
    ['joaoassic park', 113200],
    ['kk old boys fc', 114940],
    ['permas jaya fc', 119375],
    ['toastin adarabioyo', 139195],
    ['enzopreneur', 131073],
    ['colwill of fortune', 132558],
    ['palmerlaysia boleh', 128817],
    ['roger and out', 137607],
  ]);

  const historyCache = new Map();
  const picksCache = new Map();

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const num = v => Number(v || 0);
  const cleanName = v => String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  function isFreeHitName(value) {
    const x = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    // Covers freehit, free_hit, freehit1/freehit2, etc.
    return x.includes('free') && x.includes('hit');
  }

  async function getJSON(url) {
    try {
      const r = await nativeFetch(url, {cache:'no-store'});
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  async function history(entryId) {
    entryId = num(entryId);
    if (!entryId) return null;
    if (!historyCache.has(entryId)) {
      historyCache.set(entryId, getJSON(`${FPL}/entry/${entryId}/history/`));
    }
    return historyCache.get(entryId);
  }

  async function picks(entryId, gw) {
    entryId = num(entryId); gw = num(gw);
    if (!entryId || !gw) return null;
    const key = `${entryId}:${gw}`;
    if (!picksCache.has(key)) {
      picksCache.set(key, getJSON(`${FPL}/entry/${entryId}/event/${gw}/picks/`));
    }
    return picksCache.get(key);
  }

  function validPicks(x) {
    return Boolean(x && Array.isArray(x.picks) && x.picks.length === 15);
  }

  function entryIdFromObject(td) {
    if (!td || typeof td !== 'object') return 0;

    const direct = [
      td.entryId, td.entry_id, td.fplEntryId, td.fpl_entry_id,
      td.managerEntryId, td.manager_entry_id,
      td.id,
      typeof td.entry === 'number' ? td.entry : 0,
      td.entry?.id, td.entry?.entry, td.entry?.entryId, td.entry?.entry_id,
      td.meta?.entryId, td.meta?.entry_id
    ];

    for (const v of direct) {
      const n = num(v);
      if (n >= 10000) return n;
    }

    const names = [
      td.name, td.teamName, td.team_name,
      td.entry?.name, td.entry?.team_name,
      td.meta?.name
    ].filter(Boolean);

    for (const name of names) {
      const mapped = OWNER_IDS.get(cleanName(name));
      if (mapped) return mapped;
    }
    return 0;
  }

  function publicGwFromObject(td) {
    const candidates = [
      td?.picks?.entry_history?.event,
      td?.entry_history?.event,
      td?.latestGW, td?.latest_gw,
      td?.publishedGW, td?.published_gw,
      window.state?.publishedGW,
      window.state?.latestFinishedGW
    ];
    for (const v of candidates) {
      const n = num(v);
      if (n >= 1 && n <= 38) return n;
    }

    // UI is "GW4 Plan" => public baseline is normally GW3.
    const title = document.querySelector('#teams')?.textContent || document.body?.textContent || '';
    const m = title.match(/GW\s*(\d+)\s*Plan/i);
    if (m) return Math.max(1, Number(m[1]) - 1);

    return 0;
  }

  function chipEventIsFH(hist, gw) {
    return Boolean((hist?.chips || []).some(c =>
      num(c?.event) === num(gw) && isFreeHitName(c?.name || c?.chip)
    ));
  }

  async function latestUsablePublicGw(entryId, preferredGw) {
    // First trust the GW already used by the app.
    if (preferredGw) {
      const p = await picks(entryId, preferredGw);
      if (validPicks(p)) return preferredGw;
    }

    // Otherwise walk backwards from the latest event in history.
    const h = await history(entryId);
    const maxHistGw = Math.max(0, ...(h?.current || []).map(x => num(x.event)));
    for (let gw = Math.min(38, maxHistGw || 38); gw >= 1; gw--) {
      const p = await picks(entryId, gw);
      if (validPicks(p)) return gw;
    }
    return 0;
  }

  async function canonicalSquad(entryId, preferredGw) {
    const h = await history(entryId);
    const publicGw = await latestUsablePublicGw(entryId, preferredGw);
    if (!publicGw) return {ok:false, reason:'no-public-picks', entryId};

    const current = await picks(entryId, publicGw);
    if (!validPicks(current)) return {ok:false, reason:'invalid-public-picks', entryId, publicGw};

    const isFH = chipEventIsFH(h, publicGw) || isFreeHitName(current.active_chip);

    if (!isFH) {
      return {
        ok:true, entryId, publicGw,
        sourceGw:publicGw,
        freeHitGw:0,
        current,
        source:current,
        reverted:false
      };
    }

    for (let gw = publicGw - 1; gw >= 1; gw--) {
      const p = await picks(entryId, gw);
      if (!validPicks(p)) continue;
      if (chipEventIsFH(h, gw) || isFreeHitName(p.active_chip)) continue;

      return {
        ok:true, entryId, publicGw,
        sourceGw:gw,
        freeHitGw:publicGw,
        current,
        source:p,
        reverted:true
      };
    }

    return {
      ok:false,
      reason:'freehit-detected-but-no-permanent-squad',
      entryId, publicGw, freeHitGw:publicGw
    };
  }

  function overlapElements(a, b) {
    const A = new Set((a || []).map(x => num(x?.element ?? x?.id ?? x)));
    const B = new Set((b || []).map(x => num(x?.element ?? x?.id ?? x)));
    let k = 0;
    for (const x of A) if (x && B.has(x)) k++;
    return k;
  }

  function replacePickArrayInPlace(target, source) {
    if (!Array.isArray(target) || !Array.isArray(source)) return false;
    target.splice(0, target.length, ...source.map(x => ({...x})));
    return true;
  }

  function currentSellingPrice(purchase, now) {
    purchase = num(purchase); now = num(now);
    if (!purchase) return now;
    if (!now) return purchase;
    if (now <= purchase) return now;
    return purchase + Math.floor((now - purchase) / 2);
  }

  function nowCost(element) {
    const p = (window.state?.players || []).find(x => num(x.id) === num(element));
    return num(p?.now_cost);
  }

  function fixFinance(picksObj, sourceObj) {
    if (!picksObj || !Array.isArray(picksObj.picks)) return;

    let total = 0;
    for (const p of picksObj.picks) {
      const selling = currentSellingPrice(p.purchase_price, nowCost(p.element) || p.selling_price);
      if (selling) p.selling_price = selling;
      total += num(p.selling_price);
    }

    const sourceBank = sourceObj?.entry_history?.bank;
    const bank = sourceBank ?? picksObj?.entry_history?.bank ?? 0;

    picksObj.entry_history = {
      ...(sourceObj?.entry_history || {}),
      ...(picksObj.entry_history || {}),
      bank:num(bank),
      value: total ? total + num(bank) : num(sourceObj?.entry_history?.value || picksObj?.entry_history?.value),
      event_transfers:0,
      event_transfers_cost:0
    };
  }

  function applyCanonicalToTeamObject(td, canon) {
    if (!td || !canon?.ok || !canon.reverted) return false;

    const temp = canon.current?.picks || [];
    const permanent = canon.source?.picks || [];

    // Locate any picks holder shape inside this team object.
    const holders = [];
    if (td.picks && typeof td.picks === 'object') holders.push(td.picks);
    if (td.teamPicks && typeof td.teamPicks === 'object') holders.push(td.teamPicks);
    if (td.team_picks && typeof td.team_picks === 'object') holders.push(td.team_picks);
    if (td.squad && typeof td.squad === 'object' && Array.isArray(td.squad.picks)) holders.push(td.squad);
    if (td.data?.picks && typeof td.data.picks === 'object') holders.push(td.data.picks);

    let changed = false;

    for (const holder of holders) {
      if (!Array.isArray(holder.picks)) continue;
      const ov = overlapElements(holder.picks, temp);
      // Temporary FH 15 should heavily overlap the official FH 15.
      if (ov >= 10 || holder.picks.length === 15) {
        replacePickArrayInPlace(holder.picks, permanent);
        holder.active_chip = null;
        holder._fs_original_active_chip = 'freehit';
        holder._fs_freehit_reversion = {
          version:VERSION,
          freehit_event:canon.freeHitGw,
          permanent_source_event:canon.sourceGw,
          entry_id:canon.entryId,
          verified_from:'official-entry-history'
        };
        fixFinance(holder, canon.source);
        changed = true;
      }
    }

    // Common shape: td.picks is directly an array rather than payload object.
    if (Array.isArray(td.picks) && td.picks.length === 15) {
      const ov = overlapElements(td.picks, temp);
      if (ov >= 10) {
        replacePickArrayInPlace(td.picks, permanent);
        changed = true;
      }
    }

    if (changed) {
      td._fs_canonical_entry_id = canon.entryId;
      td._fs_effective_squad_event = canon.sourceGw;
      td._fs_freehit_event = canon.freeHitGw;
      td._fs_squad_source_verified = true;
    }
    return changed;
  }

  function allCandidateTeamObjects() {
    const out = [];
    const seen = new Set();

    function add(x) {
      if (!x || typeof x !== 'object' || seen.has(x)) return;
      seen.add(x);
      out.push(x);
    }

    const s = window.state || {};
    for (const key of ['teamData','teams','ownerTeams','owner_teams','myTeams','my_teams']) {
      const arr = s[key];
      if (Array.isArray(arr)) arr.forEach(add);
    }

    // Also inspect one level of state arrays. This catches custom adapter naming.
    for (const v of Object.values(s)) {
      if (Array.isArray(v)) {
        for (const x of v) {
          if (x && typeof x === 'object') add(x);
        }
      }
    }
    return out;
  }

  async function resolveAndApply(td) {
    const entryId = entryIdFromObject(td);
    if (!entryId) return {ok:false, reason:'entry-id-not-found', td};

    const preferredGw = publicGwFromObject(td);
    const canon = await canonicalSquad(entryId, preferredGw);
    if (!canon.ok) {
      td._fs_squad_source_verified = false;
      td._fs_canonical_error = canon.reason;
      return canon;
    }

    if (canon.reverted) applyCanonicalToTeamObject(td, canon);
    else {
      td._fs_squad_source_verified = true;
      td._fs_effective_squad_event = canon.sourceGw;
    }

    window.__FS_CANONICAL_SQUADS__ ||= {};
    window.__FS_CANONICAL_SQUADS__[entryId] = canon;
    return canon;
  }

  async function preflightAll() {
    // Wait for app hydration, but do not initialise My Team before the audit.
    let candidates = [];
    for (let i = 0; i < 80; i++) { // up to 8s
      candidates = allCandidateTeamObjects();
      if (candidates.length) break;
      await sleep(100);
    }

    const results = [];
    for (const td of candidates) {
      try { results.push(await resolveAndApply(td)); }
      catch (e) { results.push({ok:false, reason:String(e)}); }
    }

    window.__FS_SQUAD_PREFLIGHT__ = {
      version:VERSION,
      finished:true,
      at:new Date().toISOString(),
      results:results.map(x => ({
        ok:x?.ok,
        entryId:x?.entryId,
        publicGw:x?.publicGw,
        sourceGw:x?.sourceGw,
        freeHitGw:x?.freeHitGw,
        reverted:x?.reverted,
        reason:x?.reason
      }))
    };

    return window.__FS_SQUAD_PREFLIGHT__;
  }

  /*
   * Network safety net: any direct request for an FH picks endpoint receives
   * the permanent squad payload instead. This protects later code paths too.
   */
  window.fetch = async function fsCanonicalFetch(input, init) {
    const response = await nativeFetch(input, init);

    let raw = '';
    try { raw = typeof input === 'string' ? input : input?.url || ''; } catch {}
    const m = raw.match(/\/api\/entry\/(\d+)\/event\/(\d+)\/picks\/?/i);
    if (!m || !response.ok) return response;

    const entryId = num(m[1]), gw = num(m[2]);
    const h = await history(entryId);
    if (!chipEventIsFH(h, gw)) return response;

    const canon = await canonicalSquad(entryId, gw);
    if (!canon?.ok || !canon.reverted) return response;

    let original = null;
    try { original = await response.clone().json(); } catch {}
    if (!validPicks(original)) return response;

    const effective = {
      ...original,
      picks:canon.source.picks.map(x => ({...x})),
      active_chip:null,
      _fs_original_active_chip:original.active_chip || 'freehit',
      _fs_freehit_reversion:{
        version:VERSION,
        freehit_event:canon.freeHitGw,
        permanent_source_event:canon.sourceGw,
        entry_id:entryId,
        verified_from:'official-entry-history'
      },
      entry_history:{
        ...(canon.source.entry_history || {}),
        ...(original.entry_history || {}),
        event:gw,
        bank:canon.source.entry_history?.bank ?? original.entry_history?.bank ?? 0,
        event_transfers:0,
        event_transfers_cost:0
      }
    };

    return new Response(JSON.stringify(effective), {
      status:200,
      headers:{
        'content-type':'application/json; charset=utf-8',
        'cache-control':'no-store, max-age=0'
      }
    });
  };

  function audit() {
    return {
      version:VERSION,
      preflight:window.__FS_SQUAD_PREFLIGHT__ || null,
      canonical:window.__FS_CANONICAL_SQUADS__ || {},
      candidates:allCandidateTeamObjects().map(td => ({
        name:td.name || td.teamName || td.team_name || td.entry?.name,
        entryId:entryIdFromObject(td),
        preferredGw:publicGwFromObject(td),
        verified:td._fs_squad_source_verified,
        effectiveGw:td._fs_effective_squad_event,
        freeHitGw:td._fs_freehit_event,
        error:td._fs_canonical_error || null
      }))
    };
  }

  window.FSFreeHitGuard = {
    version:VERSION,
    preflightAll,
    resolveAndApply,
    canonicalSquad,
    entryIdFromObject,
    audit
  };
})();
