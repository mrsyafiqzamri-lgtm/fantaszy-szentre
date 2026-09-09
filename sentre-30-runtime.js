
(() => {
  'use strict';

  const EXPECTED = 'SZxP 3.0 Commercial Core';
  const CAPTAIN_CLOSE_XP = 0.30;
  const n = v => Number(v || 0);
  const clamp = (v, lo=0, hi=100) => Math.max(lo, Math.min(hi, n(v)));
  const xpAt = (p, h=0) => n(p?.xp?.[h]);
  const pos = p => Number(p?.element_type || 0);

  function contract() {
    try {
      const projection = state?.projectionData;
      const meta = state?.meta;
      if (!projection || !meta) {
        return {ok:false, reason:'Production data is still loading.'};
      }
      if (projection.model_version !== EXPECTED || meta.production_model !== EXPECTED) {
        return {
          ok:false,
          reason:`3.0 contract failed. Feed=${projection.model_version || 'missing'} · production=${meta.production_model || 'missing'}`
        };
      }
      return {ok:true, reason:'SZxP 3.0 production verified.'};
    } catch {
      return {ok:false, reason:'3.0 production state is unavailable.'};
    }
  }

  function ensure() {
    const c = contract();
    if (!c.ok || !Array.isArray(state?.players) || !Array.isArray(state?.projectionData?.players)) return false;

    const map = new Map(state.projectionData.players.map(p => [Number(p.id), p]));
    let valid = 0;

    state.players.forEach(p => {
      const m = map.get(Number(p.id));
      p._sz30Valid = false;
      if (!m || m.model_version !== EXPECTED || !Array.isArray(m.xp)) return;

      const x = m.xp.slice(0,4).map(Number);
      while (x.length < 4) x.push(0);

      p.xp = x;
      p.xp4 = n(m.xp4 ?? x.reduce((a,b)=>a+b,0));
      p.xmins = n(m.xmins);
      p.ceiling = n(m.ceiling_gw1 ?? x[0]);
      p.captainScore = n(m.captain_score);
      p.captainSentre = n(m.captain_sentre);
      p.captainEligible = Boolean(m.captain_eligible);
      p.lineupScore = n(m.lineup_score);
      p.sentreScore = n(m.sentre_score);
      p.sentreLabel = m.sentre_label || '';
      p.fixtureQualityScore = n(m.fixture_quality_score);
      p.minutesSecurityScore = n(m.minutes_security_score);
      p.riskScore = n(m.risk_score);
      p.roleSetPiecesScore = n(m.role_set_pieces_score);
      p.modelVersion = m.model_version;
      p.modelComponents = {
        player: m.sentre_components || {},
        captain: m.captain_components || {},
        lineup: m.lineup_components || {},
      };
      p._sz30Valid = true;
      valid += 1;
    });

    return valid > 0;
  }

  function strictPlayers() {
    if (!ensure()) return [];
    return state.players.filter(p => p._sz30Valid);
  }

  function squadFromTeam(td) {
    if (!ensure() || !td?.picks?.picks) return [];
    const map = new Map(state.players.map(p => [Number(p.id), p]));
    return td.picks.picks
      .map(pk => {
        const p = map.get(Number(pk.element));
        return p ? {...p, _pick: pk} : null;
      })
      .filter(Boolean);
  }

  function lineupMetric(p, horizon=0) {
    if (horizon === 0) return n(p.lineupScore) + xpAt(p,0) * 0.001;
    return xpAt(p,horizon);
  }

  function bestXI(players, horizon=0) {
    const pool = (players || []).filter(p => p?._sz30Valid && p.status !== 'u');
    const by = {
      1: pool.filter(p => pos(p)===1).sort((a,b)=>lineupMetric(b,horizon)-lineupMetric(a,horizon)),
      2: pool.filter(p => pos(p)===2).sort((a,b)=>lineupMetric(b,horizon)-lineupMetric(a,horizon)),
      3: pool.filter(p => pos(p)===3).sort((a,b)=>lineupMetric(b,horizon)-lineupMetric(a,horizon)),
      4: pool.filter(p => pos(p)===4).sort((a,b)=>lineupMetric(b,horizon)-lineupMetric(a,horizon)),
    };
    if (!by[1].length) return {xi:[], formation:'—', projected:0, decisionScore:0, captain:null, vice:null};

    let best = null;
    for (let d=3; d<=5; d++) {
      for (let m=2; m<=5; m++) {
        for (let f=1; f<=3; f++) {
          if (d+m+f !== 10) continue;
          if (by[2].length<d || by[3].length<m || by[4].length<f) continue;
          const xi = [by[1][0], ...by[2].slice(0,d), ...by[3].slice(0,m), ...by[4].slice(0,f)];
          const decisionScore = xi.reduce((s,p)=>s+lineupMetric(p,horizon),0);
          const projected = xi.reduce((s,p)=>s+xpAt(p,horizon),0);
          if (!best || decisionScore > best.decisionScore + 1e-9 ||
              (Math.abs(decisionScore-best.decisionScore)<1e-9 && projected>best.projected)) {
            best = {xi, formation:`${d}-${m}-${f}`, projected, decisionScore};
          }
        }
      }
    }
    if (!best) return {xi:[], formation:'—', projected:0, decisionScore:0, captain:null, vice:null};
    const caps = selectCaptain(best.xi, horizon);
    return {...best, ...caps, projectedWithCaptain:best.projected + (caps.captain ? xpAt(caps.captain,horizon) : 0)};
  }

  function chooseCaptainFrom(pool, horizon=0) {
    if (!pool.length) return null;
    if (horizon > 0) {
      return [...pool].sort((a,b)=>xpAt(b,horizon)-xpAt(a,horizon) || n(b.xmins)-n(a.xmins))[0];
    }

    const eligible = pool.filter(p => p._sz30Valid && p.captainEligible && p.status !== 'u' && xpAt(p,0)>0);
    if (!eligible.length) return null;
    const maxXp = Math.max(...eligible.map(p=>xpAt(p,0)));
    const close = eligible.filter(p => maxXp - xpAt(p,0) <= CAPTAIN_CLOSE_XP + 1e-9);

    return close.sort((a,b)=>
      n(b.captainSentre)-n(a.captainSentre) ||
      xpAt(b,0)-xpAt(a,0) ||
      n(b.xmins)-n(a.xmins)
    )[0];
  }

  function selectCaptain(players, horizon=0) {
    const captain = chooseCaptainFrom(players || [], horizon);
    const remaining = (players || []).filter(p => !captain || Number(p.id)!==Number(captain.id));
    const vice = chooseCaptainFrom(remaining, horizon);

    let reason = 'No 3.0 captain-eligible player.';
    if (captain) {
      const maxXp = Math.max(...(players || []).filter(p => horizon>0 || p.captainEligible).map(p=>xpAt(p,horizon)));
      const gap = maxXp - xpAt(captain,horizon);
      reason = horizon > 0
        ? 'Highest projected points for this horizon.'
        : gap <= 1e-9
          ? 'Highest calibrated SZxP; Captain Szentre only resolves close ties.'
          : `Within ${CAPTAIN_CLOSE_XP.toFixed(2)} xP of the leader; Captain Szentre broke the close call.`;
    }
    return {captain, vice, captainReason:reason, closeXp:CAPTAIN_CLOSE_XP};
  }

  function benchOrder(squad, xi) {
    const ids = new Set((xi || []).map(p=>Number(p.id)));
    const bench = (squad || []).filter(p=>!ids.has(Number(p.id)));
    const gk = bench.filter(p=>pos(p)===1);
    const out = bench.filter(p=>pos(p)!==1).sort((a,b)=>
      n(b.lineupScore)-n(a.lineupScore) || xpAt(b,0)-xpAt(a,0)
    );
    return [...out, ...gk];
  }

  function fourGwProjection(players) {
    let total = 0;
    for (let h=0; h<4; h++) {
      const x = bestXI(players,h);
      total += n(x.projectedWithCaptain);
    }
    return total;
  }

  function riskProfileForTeam(td) {
    const type = String(td?.type || '');
    if (/Weekly Prize/i.test(type)) return 'aggressive';
    if (/H2H|Cup/i.test(type)) return 'safe';
    return 'balanced';
  }

  function routeSquad(base, moves) {
    let result = [...base];
    for (const move of moves || []) {
      result = result.map(p => Number(p.id)===Number(move.out.id) ? move.inc : p);
    }
    return result;
  }

  function commercialTransferPlan(td) {
    if (!ensure()) return {action:'UNAVAILABLE', reason:contract().reason, alternatives:[]};
    if (typeof optimiseTransferScenarios !== 'function' || typeof inferredFreeTransfers !== 'function') {
      return {action:'UNAVAILABLE', reason:'Transfer search engine is unavailable.', alternatives:[]};
    }

    try {
      const base = squadFromTeam(td);
      const baseNext = bestXI(base,0);
      const base4 = fourGwProjection(base);
      const raw = optimiseTransferScenarios(td,'4gw');
      const core = window.SzentreCommercialCore;
      const ft = inferredFreeTransfers(td);
      const risk = riskProfileForTeam(td);

      const rows = (raw?.scenarios || [])
        .filter(r => n(r.k) > 0 && n(r.k) <= Math.max(3, n(ft)+1))
        .map(r => {
          const moves = (r.moves || []).map(m => ({
            out: base.find(p=>Number(p.id)===Number(m.out.id)) || m.out,
            inc: state.players.find(p=>Number(p.id)===Number(m.inc.id)) || m.inc,
          }));
          const after = routeSquad(base,moves);
          const next = bestXI(after,0);
          const nextGain = n(next.projectedWithCaptain)-n(baseNext.projectedWithCaptain);
          const fourGain = fourGwProjection(after)-base4;
          const hit = 4*Math.max(0,moves.length-n(ft));
          const fixtureSwing = moves.reduce((s,m)=>s+n(m.inc.fixtureQualityScore)-n(m.out.fixtureQualityScore),0)/Math.max(1,moves.length);
          const mins = moves.reduce((s,m)=>s+n(m.inc.xmins)-n(m.out.xmins),0);
          const bankAfter = n(r.bank ?? td.picks?.entry_history?.bank);
          const structure = clamp(50 + bankAfter*1.5, 35, 85);

          const scored = core?.transferSzentre
            ? core.transferSzentre({
                nextGain, fourGain, hit,
                fixtureSwing: fixtureSwing/20,
                minutesAvailabilityImprovement: mins,
                structureFlexibility: structure
              })
            : {score:0, verdict:'UNAVAILABLE'};

          const urgent = moves.some(m => m.out.status!=='a' || n(m.out.xmins)<45);
          const decision = core?.transferDecision
            ? core.transferDecision({score:scored.score, hit, urgent, risk})
            : {action:'ROLL', threshold:999, profile:risk};

          return {
            moves, nextGain, fourGain, hit,
            score:n(scored.score), verdict:scored.verdict,
            decision, urgent,
            route:moves.map(m=>`${m.out.web_name} → ${m.inc.web_name}`).join(' · ')
          };
        })
        .sort((a,b)=>b.score-a.score || b.nextGain-a.nextGain);

      const move = rows.find(r => r.decision.action !== 'ROLL');
      if (!move) {
        return {
          action:'ROLL', ft, risk,
          reason:'No searched route clears the SZxP 3.0 Commercial Transfer threshold.',
          alternatives:rows.slice(0,3)
        };
      }
      return {
        action:move.hit ? `MOVE · -${move.hit}` : 'MOVE',
        ft, risk, best:move,
        reason:`${move.verdict} · ${move.decision.profile} threshold ${move.decision.threshold}`,
        alternatives:rows.filter(r=>r!==move).slice(0,3)
      };
    } catch (e) {
      console.warn('SZxP 3.0 transfer plan failed',e);
      return {action:'UNAVAILABLE', reason:'Could not build a strict 3.0 transfer plan.', alternatives:[]};
    }
  }

  function gainScore(gain, full=12) {
    return clamp(n(gain)/full*100);
  }

  function chipPlan(td) {
    const core = window.SzentreCommercialCore;
    if (!ensure() || !core) return {action:'NO CHIP', reason:'3.0 chip engine unavailable.', scores:{}};

    const squad = squadFromTeam(td);
    const current = bestXI(squad,0);
    const bench = benchOrder(squad,current.xi);
    const benchXp = bench.reduce((s,p)=>s+xpAt(p,0),0);
    const benchMins = bench.length ? bench.reduce((s,p)=>s+n(p.xmins),0)/bench.length : 0;
    const squadProblems = squad.filter(p=>p.status!=='a' || n(p.xmins)<55).length;
    const captain = current.captain;
    const currentCaptainXp = captain ? xpAt(captain,0) : 0;
    const currentCeiling = captain ? n(captain.ceiling) : 0;
    const currentFixture = captain ? n(captain.fixtureQualityScore) : 0;
    const futureCap = Math.max(0, ...[1,2,3].map(h=>Math.max(0,...strictPlayers().map(p=>xpAt(p,h)))));
    const tcFutureCost = clamp(100 - Math.max(0,futureCap-currentCaptainXp)*18);

    let best15 = null;
    let best154 = null;
    try {
      best15 = window.FSWeekly30?.getBest15?.('next') || null;
      best154 = window.FSWeekly30?.getBest15?.('4gw') || null;
    } catch {}

    const current4 = squad.reduce((s,p)=>s+n(p.xp4),0);
    const ideal4 = best154?.players?.reduce((s,p)=>s+n(p.xp4),0) || current4;
    const wcGain4 = ideal4-current4;
    const fhGain = best15 ? n(best15.projected)-n(current.projectedWithCaptain) : 0;
    const idealCaptain = best15?.captain;
    const capImprove = idealCaptain ? xpAt(idealCaptain,0)-currentCaptainXp : 0;

    const fixtures = (state.fixtures || []).filter(f=>Number(f.event)===Number(state.nextEvents?.[0]?.id));
    const fixtureCount = fixtures.length;
    const blankDgw = fixtureCount !== 10 ? 90 : 15;

    const wc = core.wildcardOpportunity({
      optimisationGain: gainScore(wcGain4,28),
      problemPlayers: clamp(squadProblems/5*100),
      sixGwGain: gainScore(wcGain4,32),
      fixtureSwing: clamp(40 + squadProblems*10),
      structureBudget: 50,
      timingExpiry: 50
    });

    const fh = core.freeHitOpportunity({
      optimalVsCurrentGain: gainScore(fhGain,12),
      blankDgwAdvantage: blankDgw,
      unavailablePoorFixture: clamp(squadProblems/5*100),
      captainImprovement: gainScore(capImprove,3),
      futureOpportunityCost: 55
    });

    const bb = core.benchBoostOpportunity({
      benchPoints: clamp(benchXp/12*100),
      minutesSecurity: clamp(benchMins/90*100),
      fixtureQuality: bench.length ? bench.reduce((s,p)=>s+n(p.fixtureQualityScore),0)/bench.length : 0,
      futureOpportunityCost: 55,
      expiryPressure: 50
    });

    const tc = core.tripleCaptainOpportunity({
      captainProjection: clamp(currentCaptainXp/10*100),
      ceiling: clamp(currentCeiling/13*100),
      minutesCertainty: captain ? clamp(n(captain.xmins)/90*100) : 0,
      fixtureQuality: currentFixture,
      futureOpportunityCost: tcFutureCost
    });

    const scores = {WC:wc, FH:fh, BB:bb, TC:tc};
    const resolved = core.resolveChipConflict(scores,76);
    return {
      action:resolved.action,
      best:resolved.best,
      scores,
      reason:resolved.action==='NO CHIP'
        ? `No chip clears the 3.0 play threshold. Best current opportunity: ${resolved.best?.chip || '—'} ${resolved.best ? resolved.best.score.toFixed(0) : '—'}/100.`
        : `${resolved.best.chip} is the strongest 3.0 opportunity at ${resolved.best.score.toFixed(0)}/100.`
    };
  }

  window.FS30 = {
    expectedModel: EXPECTED,
    captainCloseXp: CAPTAIN_CLOSE_XP,
    contract,
    ensure,
    strictPlayers,
    squadFromTeam,
    bestXI,
    selectCaptain,
    benchOrder,
    fourGwProjection,
    commercialTransferPlan,
    chipPlan,
    riskProfileForTeam,
  };
})();
