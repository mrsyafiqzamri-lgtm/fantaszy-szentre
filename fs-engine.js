(() => {
  'use strict';

  // Fantaszy Szentre Engine — canonical captain / XI / bench / transfer decisions.
  // Keep this module free of Personal portfolio profiling and product/UI logic.

  const CAPTAIN_CLOSE_XP = 0.30;

  // Canonical transfer decision rules. Personal portfolio profiling stays
  // outside this module and only supplies the requested risk profile.
  const TRANSFER_WEIGHTS = Object.freeze({
    nextGain: .35,
    fourGain: .25,
    costHit: .15,
    fixtureSwing: .10,
    minutesAvailability: .10,
    structureFlexibility: .05,
  });

  const TRANSFER_RISK = Object.freeze({
    safe: Object.freeze({label:'Safe', rollThreshold:74, hitThreshold:88, closeTolerance:1.00}),
    balanced: Object.freeze({label:'Balanced', rollThreshold:70, hitThreshold:82, closeTolerance:.60}),
    aggressive: Object.freeze({label:'Aggressive', rollThreshold:66, hitThreshold:78, closeTolerance:.35}),
  });

  const CHIP_MIN_PLAY = 76;

  const CHIP_WEIGHTS = Object.freeze({
    WC: Object.freeze({optimisationGain:.30, problemPlayers:.20, sixGwGain:.20, fixtureSwing:.10, structureBudget:.10, timingExpiry:.10}),
    FH: Object.freeze({optimalVsCurrentGain:.45, blankDgwAdvantage:.20, unavailablePoorFixture:.15, captainImprovement:.10, futureOpportunityCost:.10}),
    BB: Object.freeze({benchPoints:.50, minutesSecurity:.20, fixtureQuality:.15, futureOpportunityCost:.10, expiryPressure:.05}),
    TC: Object.freeze({captainProjection:.40, ceiling:.25, minutesCertainty:.15, fixtureQuality:.10, futureOpportunityCost:.10}),
  });

  const LEGAL_FORMATIONS = Object.freeze([
    Object.freeze({ DEF: 3, MID: 4, FWD: 3 }),
    Object.freeze({ DEF: 3, MID: 5, FWD: 2 }),
    Object.freeze({ DEF: 4, MID: 3, FWD: 3 }),
    Object.freeze({ DEF: 4, MID: 4, FWD: 2 }),
    Object.freeze({ DEF: 4, MID: 5, FWD: 1 }),
    Object.freeze({ DEF: 5, MID: 2, FWD: 3 }),
    Object.freeze({ DEF: 5, MID: 3, FWD: 2 }),
    Object.freeze({ DEF: 5, MID: 4, FWD: 1 }),
  ]);

  const SQUAD_POSITION_COUNTS = Object.freeze({ GKP:2, DEF:5, MID:5, FWD:3 });
  const SQUAD_SLOT_ORDER = Object.freeze([
    'GKP','GKP',
    'DEF','DEF','DEF','DEF','DEF',
    'MID','MID','MID','MID','MID',
    'FWD','FWD','FWD',
  ]);
  const DEFAULT_SQUAD_BUDGET = 1000;
  const DEFAULT_FREE_HIT_BEAM = 140;

  const finite = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  const clamp = (value, low = 0, high = 100) =>
    Math.max(low, Math.min(high, finite(value)));

  const optionalFinite = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  function playerId(player) {
    return Number(player?.id ?? player?.element ?? 0);
  }

  function position(player) {
    const numeric = Number(player?.element_type ?? 0);
    if (numeric === 1) return 'GKP';
    if (numeric === 2) return 'DEF';
    if (numeric === 3) return 'MID';
    if (numeric === 4) return 'FWD';

    const raw = String(
      player?.position ??
      player?.pos ??
      player?.position_short ??
      ''
    ).toUpperCase();

    return raw === 'GK' ? 'GKP' : raw;
  }

  function projectedAt(player, horizon = 0) {
    const h = Number(horizon) || 0;

    if (Array.isArray(player?.horizonPoints)) {
      const value = optionalFinite(player.horizonPoints[h]);
      if (value != null) return value;
    }

    if (Array.isArray(player?.xp)) {
      const value = optionalFinite(player.xp[h]);
      if (value != null) return value;
    }

    if (h === 0) {
      for (const key of ['projectedPoints', 'xP', 'nextGwXp', 'next_gw_xp']) {
        const value = optionalFinite(player?.[key]);
        if (value != null) return value;
      }
    }

    return 0;
  }

  function statusUnavailable(player) {
    return String(player?.status ?? '').toLowerCase() === 'u';
  }

  function hasCanonicalSignals(player) {
    return (
      player?.canonicalDecisionSource === true ||
      optionalFinite(player?.lineupScore) != null ||
      optionalFinite(player?.captainSentre) != null ||
      typeof player?.captainEligible === 'boolean' ||
      optionalFinite(player?.sentreScore) != null
    );
  }

  function lineupMetric(player, horizon = 0) {
    if (Number(horizon) > 0) return projectedAt(player, horizon);

    const source = optionalFinite(player?.lineupScore);
    if (source != null) {
      // Source lineup score is authoritative; xP only breaks an exact tie.
      return source + projectedAt(player, 0) * 0.001;
    }

    return projectedAt(player, 0);
  }


  function applyProjectionSnapshot({players = [], projectionData = {}, expectedModel = ''} = {}) {
    if (!Array.isArray(players) || !Array.isArray(projectionData?.players)) {
      return {ok:false, validCount:0, reason:'Projection data is unavailable.'};
    }

    if (expectedModel && projectionData?.model_version !== expectedModel) {
      return {ok:false, validCount:0, reason:'Projection contract mismatch.'};
    }

    const map = new Map(projectionData.players.map(player => [Number(player?.id), player]));
    let validCount = 0;

    for (const player of players) {
      const source = map.get(Number(player?.id));
      player._sz30Valid = false;
      if (!source || !Array.isArray(source?.xp)) continue;
      if (expectedModel && source?.model_version !== expectedModel) continue;

      const xp = source.xp.slice(0, 4).map(value => finite(value));
      while (xp.length < 4) xp.push(0);

      player.xp = xp;
      player.xp4 = finite(source.xp4, xp.reduce((sum, value) => sum + value, 0));
      player.xmins = finite(source.xmins);
      player.ceiling = finite(source.ceiling_gw1, xp[0]);
      player.captainScore = finite(source.captain_score);
      player.captainSentre = finite(source.captain_sentre);
      player.captainEligible = Boolean(source.captain_eligible);
      player.lineupScore = finite(source.lineup_score);
      player.sentreScore = finite(source.sentre_score);
      player.sentreLabel = source.sentre_label || '';
      player.fixtureQualityScore = finite(source.fixture_quality_score);
      player.minutesSecurityScore = finite(source.minutes_security_score);
      player.riskScore = finite(source.risk_score);
      player.roleSetPiecesScore = finite(source.role_set_pieces_score);
      player.modelVersion = source.model_version;
      player.modelComponents = {
        player: source.sentre_components || {},
        captain: source.captain_components || {},
        lineup: source.lineup_components || {},
      };
      player._sz30Valid = true;
      validCount += 1;
    }

    return {
      ok: validCount > 0,
      validCount,
      totalPlayers: players.length,
      reason: validCount > 0 ? 'Projection snapshot verified.' : 'No verified projection rows are available.',
    };
  }

  function captainConfidence(gap) {
    const value = Math.abs(finite(gap));
    if (value < 3) return 'Toss-up';
    if (value < 6) return 'Medium';
    if (value < 10) return 'High';
    return 'Very High';
  }

  function lineupConfidence(edge) {
    const value = Math.abs(finite(edge));
    if (value < 0.5) return 'Close Call';
    if (value < 1) return 'Slight Edge';
    if (value <= 2) return 'Clear Edge';
    return 'Strong Start';
  }

  function closeCallTiebreak(a, b, risk = 'balanced') {
    const profile = TRANSFER_RISK[risk] || TRANSFER_RISK.balanced;
    const gap = Math.abs(finite(a?.score) - finite(b?.score));
    if (gap > profile.closeTolerance) return null;

    if (risk === 'safe') {
      return finite(a?.ownership) >= finite(b?.ownership) ? a : b;
    }
    if (risk === 'aggressive') {
      return finite(a?.ownership) <= finite(b?.ownership) ? a : b;
    }
    return null;
  }

  function captainPool(players = [], horizon = 0) {
    const h = Number(horizon) || 0;

    if (h > 0) {
      return players
        .filter(player => !statusUnavailable(player) && projectedAt(player, h) > 0)
        .slice()
        .sort((a, b) =>
          projectedAt(b, h) - projectedAt(a, h) ||
          finite(b?.xMins ?? b?.xmins) - finite(a?.xMins ?? a?.xmins) ||
          playerId(a) - playerId(b)
        );
    }

    return players.filter(player => (
      !statusUnavailable(player) &&
      player?.captainEligible === true &&
      projectedAt(player, 0) > 0
    ));
  }

  function chooseCaptain(players = [], horizon = 0) {
    const h = Number(horizon) || 0;
    const pool = captainPool(players, h);
    if (!pool.length) return null;
    if (h > 0) return pool[0];

    const maxXp = Math.max(...pool.map(player => projectedAt(player, 0)));
    const close = pool.filter(
      player => maxXp - projectedAt(player, 0) <= CAPTAIN_CLOSE_XP + 1e-9
    );

    return close
      .slice()
      .sort((a, b) =>
        finite(b?.captainSentre) - finite(a?.captainSentre) ||
        projectedAt(b, 0) - projectedAt(a, 0) ||
        finite(b?.xMins ?? b?.xmins) - finite(a?.xMins ?? a?.xmins) ||
        playerId(a) - playerId(b)
      )[0] ?? null;
  }

  function selectCaptain(players = [], horizon = 0) {
    const captain = chooseCaptain(players, horizon);
    const remaining = players.filter(
      player => !captain || playerId(player) !== playerId(captain)
    );
    const vice = chooseCaptain(remaining, horizon);

    let reason = 'No captain-eligible player.';
    if (captain) {
      const comparisonPool = players.filter(
        player => Number(horizon) > 0 || player?.captainEligible === true
      );
      const maxXp = comparisonPool.length
        ? Math.max(...comparisonPool.map(player => projectedAt(player, horizon)))
        : projectedAt(captain, horizon);
      const gap = maxXp - projectedAt(captain, horizon);

      reason = Number(horizon) > 0
        ? 'Highest projected points for this horizon.'
        : gap <= 1e-9
          ? 'Highest projected points; Captain Szentre only resolves close ties.'
          : `Within ${CAPTAIN_CLOSE_XP.toFixed(2)} xP of the leader; Captain Szentre broke the close call.`;
    }

    return {
      captain,
      vice,
      captainReason: reason,
      closeXp: CAPTAIN_CLOSE_XP,
    };
  }

  function bestXI(players = [], horizon = 0) {
    const pool = players.filter(player => !statusUnavailable(player));

    const byPosition = {
      GKP: pool.filter(player => position(player) === 'GKP'),
      DEF: pool.filter(player => position(player) === 'DEF'),
      MID: pool.filter(player => position(player) === 'MID'),
      FWD: pool.filter(player => position(player) === 'FWD'),
    };

    for (const list of Object.values(byPosition)) {
      list.sort((a, b) =>
        lineupMetric(b, horizon) - lineupMetric(a, horizon) ||
        projectedAt(b, horizon) - projectedAt(a, horizon) ||
        finite(b?.xMins ?? b?.xmins) - finite(a?.xMins ?? a?.xmins) ||
        playerId(a) - playerId(b)
      );
    }

    if (!byPosition.GKP.length) {
      return {
        xi: [], formation: '—', projected: 0, decisionScore: 0,
        captain: null, vice: null, captainReason: 'No legal XI.', projectedWithCaptain: 0,
      };
    }

    let best = null;

    for (const formation of LEGAL_FORMATIONS) {
      if (
        byPosition.DEF.length < formation.DEF ||
        byPosition.MID.length < formation.MID ||
        byPosition.FWD.length < formation.FWD
      ) continue;

      const xi = [
        byPosition.GKP[0],
        ...byPosition.DEF.slice(0, formation.DEF),
        ...byPosition.MID.slice(0, formation.MID),
        ...byPosition.FWD.slice(0, formation.FWD),
      ];

      const decisionScore = xi.reduce(
        (sum, player) => sum + lineupMetric(player, horizon), 0
      );
      const projected = xi.reduce(
        (sum, player) => sum + projectedAt(player, horizon), 0
      );

      if (
        !best ||
        decisionScore > best.decisionScore + 1e-9 ||
        (
          Math.abs(decisionScore - best.decisionScore) < 1e-9 &&
          projected > best.projected
        )
      ) {
        best = {
          xi,
          formation: `${formation.DEF}-${formation.MID}-${formation.FWD}`,
          projected,
          decisionScore,
        };
      }
    }

    if (!best) {
      return {
        xi: [], formation: '—', projected: 0, decisionScore: 0,
        captain: null, vice: null, captainReason: 'No legal XI.', projectedWithCaptain: 0,
      };
    }

    const captainResult = selectCaptain(best.xi, horizon);

    return {
      ...best,
      ...captainResult,
      projectedWithCaptain:
        best.projected +
        (captainResult.captain ? projectedAt(captainResult.captain, horizon) : 0),
    };
  }

  function isLegalXI(players = []) {
    if (!Array.isArray(players) || players.length !== 11) return false;

    const counts = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const player of players) {
      const pos = position(player);
      if (Object.hasOwn(counts, pos)) counts[pos] += 1;
    }

    return (
      counts.GKP === 1 &&
      counts.DEF >= 3 && counts.DEF <= 5 &&
      counts.MID >= 2 && counts.MID <= 5 &&
      counts.FWD >= 1 && counts.FWD <= 3
    );
  }

  function transferComponentScores(input = {}) {
    const nextGain = finite(input.nextGain);
    const fourGain = finite(input.fourGain);
    const hit = Math.max(0, finite(input.hit));
    const fixtureSwing = finite(input.fixtureSwing);
    const mins = finite(input.minutesAvailabilityImprovement);
    const structure = finite(input.structureFlexibility, 50);

    return {
      nextGain: Math.max(0, Math.min(100, 50 + nextGain * 11)),
      fourGain: Math.max(0, Math.min(100, 50 + fourGain * 4.5)),
      costHit: hit <= 0 ? 100 : Math.max(0, Math.min(100, 100 - hit * 13)),
      fixtureSwing: Math.max(0, Math.min(100, 50 + fixtureSwing * 18)),
      minutesAvailability: Math.max(0, Math.min(100, 50 + mins * 1.2)),
      structureFlexibility: Math.max(0, Math.min(100, structure)),
    };
  }

  function transferVerdict(score) {
    const value = finite(score);
    if (value >= 90) return 'PRIORITY MOVE';
    if (value >= 80) return 'STRONG MOVE';
    if (value >= 70) return 'GOOD MOVE';
    if (value >= 60) return 'OPTIONAL';
    if (value >= 50) return 'HOLD PREFERRED';
    return 'AVOID';
  }

  function scoreTransfer(input = {}) {
    const components = transferComponentScores(input);
    const score = Object.entries(TRANSFER_WEIGHTS)
      .reduce((sum, [key, weight]) => sum + weight * components[key], 0);

    return {
      score: Number(score.toFixed(2)),
      components,
      verdict: transferVerdict(score),
    };
  }

  function transferDecision({score = 0, hit = 0, urgent = false, risk = 'balanced'} = {}) {
    const profile = TRANSFER_RISK[risk] || TRANSFER_RISK.balanced;
    const threshold = finite(hit) > 0 ? profile.hitThreshold : profile.rollThreshold;

    // Availability urgency may lower the action bar, but it never makes a weak
    // route automatically acceptable. This preserves the current Personal rule.
    const effective = urgent ? Math.max(64, threshold - 6) : threshold;

    if (finite(score) < effective) {
      return {action:'ROLL', threshold:effective, profile:profile.label};
    }

    return {
      action: finite(hit) > 0 ? `MOVE · -${finite(hit)}` : 'MOVE',
      threshold:effective,
      profile:profile.label,
    };
  }


  function pct(value) {
    return Math.max(0, Math.min(100, finite(value)));
  }

  function weightedOpportunity(input = {}, weights = {}) {
    const score = Object.entries(weights)
      .reduce((sum, [key, weight]) => sum + weight * pct(input?.[key]), 0);
    return Number(score.toFixed(2));
  }

  function wildcardOpportunity(input = {}) {
    return weightedOpportunity(input, CHIP_WEIGHTS.WC);
  }

  function freeHitOpportunity(input = {}) {
    return weightedOpportunity(input, CHIP_WEIGHTS.FH);
  }

  function benchBoostOpportunity(input = {}) {
    return weightedOpportunity(input, CHIP_WEIGHTS.BB);
  }

  function tripleCaptainOpportunity(input = {}) {
    return weightedOpportunity(input, CHIP_WEIGHTS.TC);
  }

  function resolveChipConflict(scores = {}, minPlay = CHIP_MIN_PLAY) {
    const rows = Object.entries(scores)
      .map(([chip, score]) => ({chip, score:finite(score)}))
      .sort((a, b) => b.score - a.score);

    if (!rows.length || rows[0].score < finite(minPlay, CHIP_MIN_PLAY)) {
      return {action:'NO CHIP', best:rows[0] || null};
    }
    return {action:`PLAY ${rows[0].chip}`, best:rows[0]};
  }

  function evaluateChips({wildcard = {}, freeHit = {}, benchBoost = {}, tripleCaptain = {}, minPlay = CHIP_MIN_PLAY} = {}) {
    const scores = {
      WC: wildcardOpportunity(wildcard),
      FH: freeHitOpportunity(freeHit),
      BB: benchBoostOpportunity(benchBoost),
      TC: tripleCaptainOpportunity(tripleCaptain),
    };
    const resolved = resolveChipConflict(scores, minPlay);
    return {...resolved, scores};
  }


  function validateSquad15(players = [], {budget = DEFAULT_SQUAD_BUDGET} = {}) {
    const issues = [];
    if (!Array.isArray(players) || players.length !== 15) {
      issues.push('SQUAD_SIZE');
      return {ok:false, issues};
    }

    const ids = players.map(player => playerId(player));
    if (new Set(ids).size !== 15) issues.push('DUPLICATE_PLAYER');

    const positionCounts = {GKP:0, DEF:0, MID:0, FWD:0};
    const clubCounts = new Map();
    let cost = 0;

    for (const player of players) {
      const pos = position(player);
      if (Object.hasOwn(positionCounts, pos)) positionCounts[pos] += 1;
      const club = Number(player?.team || 0);
      if (club) clubCounts.set(club, (clubCounts.get(club) || 0) + 1);
      cost += finite(player?.now_cost ?? player?.price);
    }

    for (const [pos, required] of Object.entries(SQUAD_POSITION_COUNTS)) {
      if (positionCounts[pos] !== required) issues.push(`POSITION_${pos}`);
    }
    if ([...clubCounts.values()].some(count => count > 3)) issues.push('CLUB_LIMIT');
    if (cost > finite(budget, DEFAULT_SQUAD_BUDGET)) issues.push('BUDGET');

    return {ok:issues.length === 0, issues, cost, positionCounts};
  }

  function freeHitProfileScore(player, mode = 'next') {
    if (mode === '4gw') return finite(player?.xp4);
    const base = projectedAt(player, 0);
    const ceilingGap = Math.max(0, finite(player?.ceiling, base) - base);
    const safety = Math.max(0, Math.min(1, finite(player?.xmins ?? player?.xMins) / 90));
    return base + 0.065 * ceilingGap + 0.035 * safety;
  }

  function freeHitCorrelationPenalty(xi = [], fixtures = [], nextGw = 0) {
    const isAttack = player => ['MID','FWD'].includes(position(player));
    const isDefence = player => ['GKP','DEF'].includes(position(player));
    const rows = (fixtures || []).filter(fixture => !nextGw || Number(fixture?.event) === Number(nextGw));
    let penalty = 0;

    for (const fixture of rows) {
      const home = xi.filter(player => Number(player?.team) === Number(fixture?.team_h));
      const away = xi.filter(player => Number(player?.team) === Number(fixture?.team_a));
      if (!home.length || !away.length) continue;
      const homeAttack = home.filter(isAttack).length;
      const awayAttack = away.filter(isAttack).length;
      const homeDefence = home.filter(isDefence).length;
      const awayDefence = away.filter(isDefence).length;
      penalty += 0.62 * (homeAttack * awayDefence + awayAttack * homeDefence);
      if (homeAttack >= 2 && awayDefence >= 1) penalty += 0.55;
      if (awayAttack >= 2 && homeDefence >= 1) penalty += 0.55;
    }
    return penalty;
  }

  function optimizeFreeHitSquad({
    players = [], fixtures = [], nextGw = 0, mode = 'next',
    budget = DEFAULT_SQUAD_BUDGET, beamWidth = DEFAULT_FREE_HIT_BEAM,
  } = {}) {
    const legal = (players || []).filter(player => (
      !statusUnavailable(player) &&
      finite(player?.xmins ?? player?.xMins) >= 20 &&
      projectedAt(player, 0) > 0 &&
      finite(player?.now_cost ?? player?.price) > 0
    ));

    for (const [pos, count] of Object.entries(SQUAD_POSITION_COUNTS)) {
      if (legal.filter(player => position(player) === pos).length < count) {
        return {error:'Not enough eligible players for a legal 15.'};
      }
    }

    const pools = {};
    for (const pos of Object.keys(SQUAD_POSITION_COUNTS)) {
      const row = legal.filter(player => position(player) === pos);
      const best = row.slice().sort((a, b) => freeHitProfileScore(b, mode) - freeHitProfileScore(a, mode)).slice(0, 24);
      const cheap = row.slice().sort((a, b) =>
        finite(a?.now_cost ?? a?.price) - finite(b?.now_cost ?? b?.price) ||
        freeHitProfileScore(b, mode) - freeHitProfileScore(a, mode)
      ).slice(0, 9);
      const unique = new Map();
      [...best, ...cheap].forEach(player => unique.set(playerId(player), player));
      pools[pos] = [...unique.values()];
    }

    const minRemainingCost = slot => {
      let total = 0;
      for (const pos of SQUAD_SLOT_ORDER.slice(slot)) {
        const row = pools[pos] || [];
        if (!row.length) return Infinity;
        total += Math.min(...row.map(player => finite(player?.now_cost ?? player?.price)));
      }
      return total;
    };

    let beam = [{ids:[], cost:0, clubs:{}, score:0}];

    for (let slot = 0; slot < SQUAD_SLOT_ORDER.length; slot++) {
      const pos = SQUAD_SLOT_ORDER[slot];
      const children = [];
      const minimumRemaining = minRemainingCost(slot + 1);

      for (const state of beam) {
        const owned = new Set(state.ids);
        for (const player of pools[pos]) {
          const id = playerId(player);
          const club = Number(player?.team || 0);
          if (owned.has(id)) continue;
          if ((state.clubs[club] || 0) >= 3) continue;
          const newCost = state.cost + finite(player?.now_cost ?? player?.price);
          if (newCost > budget || newCost + minimumRemaining > budget) continue;
          children.push({
            ids:[...state.ids, id],
            cost:newCost,
            clubs:{...state.clubs, [club]:(state.clubs[club] || 0) + 1},
            score:state.score + freeHitProfileScore(player, mode),
          });
        }
      }

      if (!children.length) return {error:'No legal squad found within budget.'};

      const dedup = new Map();
      for (const child of children) {
        const key = child.ids.slice().sort((a, b) => a - b).join(',');
        const previous = dedup.get(key);
        if (!previous || child.score > previous.score) dedup.set(key, child);
      }
      beam = [...dedup.values()].sort((a, b) => b.score - a.score).slice(0, beamWidth);
    }

    const byId = new Map(players.map(player => [playerId(player), player]));
    const evaluated = beam.map(state => {
      const squad = state.ids.map(id => byId.get(id)).filter(Boolean);
      if (!validateSquad15(squad, {budget}).ok) return null;

      if (mode === '4gw') {
        const score = squad.reduce((sum, player) => sum + finite(player?.xp4), 0);
        return {
          players:squad, ids:state.ids, objective:score, projected:score,
          cost:squad.reduce((sum, player) => sum + finite(player?.now_cost ?? player?.price), 0),
        };
      }

      const lineup = bestXI(squad, 0);
      if (lineup.xi.length !== 11 || !lineup.captain || !isLegalXI(lineup.xi)) return null;
      const bench = benchOrder(squad, lineup.xi);
      const projected = finite(lineup.projectedWithCaptain);
      const ceilingLift = lineup.xi.reduce((sum, player) =>
        sum + Math.max(0, finite(player?.ceiling, projectedAt(player, 0)) - projectedAt(player, 0)), 0
      );
      const correlationPenalty = freeHitCorrelationPenalty(lineup.xi, fixtures, nextGw);
      const objective = projected + 0.055 * ceilingLift - correlationPenalty;

      return {
        players:squad, ids:state.ids, xi:lineup.xi, bench,
        captain:lineup.captain, vice:lineup.vice,
        captainReason:lineup.captainReason,
        formation:lineup.formation,
        projected, objective, maxOverlap:0,
        scenarioFit:0, correlationPenalty,
        cost:squad.reduce((sum, player) => sum + finite(player?.now_cost ?? player?.price), 0),
      };
    }).filter(Boolean);

    const result = evaluated.sort((a, b) => b.objective - a.objective)[0] || null;
    if (!result) return {error:'Could not evaluate the squad.'};

    const validation = validateSquad15(result.players, {budget});
    if (!validation.ok) return {error:`Invalid optimized squad: ${validation.issues.join(', ')}`};
    return result;
  }

  function normalizeChipName(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function isFreeHitName(value) {
    const normalized = normalizeChipName(value);
    return normalized.includes('free') && normalized.includes('hit');
  }

  function freeHitEvents(history = {}) {
    const events = new Set();
    for (const chip of history?.chips || []) {
      if (!isFreeHitName(chip?.name || chip?.chip)) continue;
      const gw = Number(chip?.event);
      if (gw) events.add(gw);
    }
    return events;
  }

  function validSquadPicks(payload) {
    return Boolean(payload && Array.isArray(payload.picks) && payload.picks.length === 15);
  }

  function isFreeHitEvent(history = {}, gw = 0, activeChip = '') {
    return freeHitEvents(history).has(Number(gw)) || isFreeHitName(activeChip);
  }

  function resolveCanonicalSquad({entryId = 0, requestedGw = 0, current = null, history = {}, priorCandidates = []} = {}) {
    const gw = Number(requestedGw) || 0;
    const id = Number(entryId) || 0;

    if (!validSquadPicks(current)) {
      return {ok:false, reason:'INVALID_CURRENT_SQUAD', entryId:id, requestedGw:gw};
    }

    if (!isFreeHitEvent(history, gw, current?.active_chip)) {
      return {
        ok:true, entryId:id, requestedGw:gw, sourceGw:gw,
        freeHitGw:0, reverted:false, current, source:current
      };
    }

    const candidates = (priorCandidates || [])
      .filter(row => row && validSquadPicks(row.data))
      .slice()
      .sort((a, b) => Number(b.gw || 0) - Number(a.gw || 0));

    for (const candidate of candidates) {
      const sourceGw = Number(candidate.gw) || 0;
      if (!sourceGw || sourceGw >= gw) continue;
      if (isFreeHitEvent(history, sourceGw, candidate.data?.active_chip)) continue;
      return {
        ok:true, entryId:id, requestedGw:gw, sourceGw,
        freeHitGw:gw, reverted:true, current, source:candidate.data
      };
    }

    return {
      ok:false, reason:'FREE_HIT_PERMANENT_SQUAD_UNAVAILABLE',
      entryId:id, requestedGw:gw, freeHitGw:gw
    };
  }

  function benchOrder(squad = [], xi = []) {
    const ids = new Set(xi.map(player => playerId(player)));
    const bench = squad.filter(player => !ids.has(playerId(player)));

    const outfield = bench
      .filter(player => position(player) !== 'GKP')
      .sort((a, b) =>
        lineupMetric(b, 0) - lineupMetric(a, 0) ||
        projectedAt(b, 0) - projectedAt(a, 0) ||
        finite(b?.xMins ?? b?.xmins) - finite(a?.xMins ?? a?.xmins) ||
        playerId(a) - playerId(b)
      );

    const keepers = bench
      .filter(player => position(player) === 'GKP')
      .sort((a, b) =>
        lineupMetric(b, 0) - lineupMetric(a, 0) ||
        projectedAt(b, 0) - projectedAt(a, 0) ||
        playerId(a) - playerId(b)
      );

    // Personal UI historically renders the three outfield substitutes first,
    // then the backup goalkeeper. Preserve that contract.
    return [...outfield, ...keepers];
  }

  window.FantaszySzentreEngine = Object.freeze({
    captainCloseXp: CAPTAIN_CLOSE_XP,
    legalFormations: LEGAL_FORMATIONS,
    projectedAt,
    hasCanonicalSignals,
    applyProjectionSnapshot,
    captainConfidence,
    lineupConfidence,
    closeCallTiebreak,
    lineupMetric,
    chooseCaptain,
    selectCaptain,
    bestXI,
    benchOrder,
    isLegalXI,
    transferWeights: TRANSFER_WEIGHTS,
    transferRiskProfiles: TRANSFER_RISK,
    transferComponentScores,
    transferVerdict,
    scoreTransfer,
    transferDecision,
    chipMinPlay: CHIP_MIN_PLAY,
    chipWeights: CHIP_WEIGHTS,
    wildcardOpportunity,
    freeHitOpportunity,
    benchBoostOpportunity,
    tripleCaptainOpportunity,
    resolveChipConflict,
    evaluateChips,
    validateSquad15,
    optimizeFreeHitSquad,
    normalizeChipName,
    isFreeHitName,
    freeHitEvents,
    isFreeHitEvent,
    resolveCanonicalSquad,
  });
})();
