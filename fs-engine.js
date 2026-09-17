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

  const finite = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

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
  });
})();
