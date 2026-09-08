// Fantaszy Szentre — Commercial Decision Core
// Shared scoring rules for GW PASS / PRO / ULTIMATE.
// This file deliberately does not render a customer dashboard. It exposes the
// same decision logic so the paid layer can consume it without contaminating
// the private owner portfolio cockpit.
(() => {
  'use strict';

  const VERSION = '20260908-commercial1';
  const clamp = (v, lo=0, hi=100) => Math.max(lo, Math.min(hi, Number(v || 0)));

  const TRANSFER_WEIGHTS = {
    nextGain: .35,
    fourGain: .25,
    costHit: .15,
    fixtureSwing: .10,
    minutesAvailability: .10,
    structureFlexibility: .05,
  };

  const RISK = {
    safe:       {label:'Safe',       rollThreshold:74, hitThreshold:88, closeTolerance:1.00},
    balanced:   {label:'Balanced',   rollThreshold:70, hitThreshold:82, closeTolerance:.60},
    aggressive: {label:'Aggressive', rollThreshold:66, hitThreshold:78, closeTolerance:.35},
  };

  function transferComponentScores(input={}) {
    const nextGain = Number(input.nextGain || 0);
    const fourGain = Number(input.fourGain || 0);
    const hit = Math.max(0, Number(input.hit || 0));
    const fixtureSwing = Number(input.fixtureSwing || 0);
    const mins = Number(input.minutesAvailabilityImprovement || 0);
    const structure = Number(input.structureFlexibility || 50);

    return {
      nextGain: clamp(50 + nextGain * 11),
      fourGain: clamp(50 + fourGain * 4.5),
      costHit: hit <= 0 ? 100 : clamp(100 - hit * 13),
      fixtureSwing: clamp(50 + fixtureSwing * 18),
      minutesAvailability: clamp(50 + mins * 1.2),
      structureFlexibility: clamp(structure),
    };
  }

  function transferSzentre(input={}) {
    const c = transferComponentScores(input);
    const score = Object.entries(TRANSFER_WEIGHTS)
      .reduce((s,[k,w]) => s + w * c[k], 0);
    return {score:Number(score.toFixed(2)), components:c, verdict:transferVerdict(score)};
  }

  function transferVerdict(score) {
    score = Number(score || 0);
    if (score >= 90) return 'PRIORITY MOVE';
    if (score >= 80) return 'STRONG MOVE';
    if (score >= 70) return 'GOOD MOVE';
    if (score >= 60) return 'OPTIONAL';
    if (score >= 50) return 'HOLD PREFERRED';
    return 'AVOID';
  }

  function transferDecision({score=0, hit=0, urgent=false, risk='balanced'}={}) {
    const p = RISK[risk] || RISK.balanced;
    const threshold = hit > 0 ? p.hitThreshold : p.rollThreshold;

    // Injury/suspension/expiring FT can justify action below the normal edge,
    // but never turns a poor move into an automatic recommendation.
    const effective = urgent ? Math.max(64, threshold - 6) : threshold;

    if (Number(score) < effective) {
      return {action:'ROLL', threshold:effective, profile:p.label};
    }
    return {
      action: hit > 0 ? `MOVE · -${hit}` : 'MOVE',
      threshold:effective,
      profile:p.label,
    };
  }

  function captainConfidence(gap) {
    gap = Number(gap || 0);
    if (gap < 3) return 'Toss-up';
    if (gap < 6) return 'Medium';
    if (gap < 10) return 'High';
    return 'Very High';
  }

  function lineupConfidence(edge) {
    edge = Number(edge || 0);
    if (edge < .5) return 'Close Call';
    if (edge < 1) return 'Slight Edge';
    if (edge <= 2) return 'Clear Edge';
    return 'Strong Start';
  }

  const pct = v => clamp(Number(v || 0));

  function wildcardOpportunity(x={}) {
    return Number((
      .30*pct(x.optimisationGain) +
      .20*pct(x.problemPlayers) +
      .20*pct(x.sixGwGain) +
      .10*pct(x.fixtureSwing) +
      .10*pct(x.structureBudget) +
      .10*pct(x.timingExpiry)
    ).toFixed(2));
  }

  function freeHitOpportunity(x={}) {
    return Number((
      .45*pct(x.optimalVsCurrentGain) +
      .20*pct(x.blankDgwAdvantage) +
      .15*pct(x.unavailablePoorFixture) +
      .10*pct(x.captainImprovement) +
      .10*pct(x.futureOpportunityCost)
    ).toFixed(2));
  }

  function benchBoostOpportunity(x={}) {
    return Number((
      .50*pct(x.benchPoints) +
      .20*pct(x.minutesSecurity) +
      .15*pct(x.fixtureQuality) +
      .10*pct(x.futureOpportunityCost) +
      .05*pct(x.expiryPressure)
    ).toFixed(2));
  }

  function tripleCaptainOpportunity(x={}) {
    return Number((
      .40*pct(x.captainProjection) +
      .25*pct(x.ceiling) +
      .15*pct(x.minutesCertainty) +
      .10*pct(x.fixtureQuality) +
      .10*pct(x.futureOpportunityCost)
    ).toFixed(2));
  }

  function resolveChipConflict(scores={}, minPlay=76) {
    const rows = Object.entries(scores)
      .map(([chip,score])=>({chip,score:Number(score||0)}))
      .sort((a,b)=>b.score-a.score);

    if (!rows.length || rows[0].score < minPlay) {
      return {action:'NO CHIP', best:rows[0] || null};
    }
    return {action:`PLAY ${rows[0].chip}`, best:rows[0]};
  }

  // Ultimate risk strategy rule: ownership may only be a tiebreak when the
  // model projection/decision difference is genuinely close.
  function closeCallTiebreak(a, b, risk='balanced') {
    const p = RISK[risk] || RISK.balanced;
    const gap = Math.abs(Number(a?.score||0) - Number(b?.score||0));
    if (gap > p.closeTolerance) return null;

    if (risk === 'safe') {
      return Number(a?.ownership||0) >= Number(b?.ownership||0) ? a : b;
    }
    if (risk === 'aggressive') {
      return Number(a?.ownership||0) <= Number(b?.ownership||0) ? a : b;
    }
    return null;
  }

  window.SzentreCommercialCore = {
    version: VERSION,
    transferWeights: TRANSFER_WEIGHTS,
    riskProfiles: RISK,
    transferComponentScores,
    transferSzentre,
    transferVerdict,
    transferDecision,
    captainConfidence,
    lineupConfidence,
    wildcardOpportunity,
    freeHitOpportunity,
    benchBoostOpportunity,
    tripleCaptainOpportunity,
    resolveChipConflict,
    closeCallTiebreak,
  };
})();
