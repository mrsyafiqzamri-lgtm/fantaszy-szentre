#!/usr/bin/env python3
"""
SZxP 3.0 Commercial Core
========================

Commercial-grade production layer for Fantaszy Szentre.

Architecture:
- SZxP 2.2 remains the raw football projection/reference engine.
- SZxP 3.0 reads the fresh 2.2 output, applies conservative adaptive
  calibration using ONLY completed genuine historical benchmarks, then adds
  the commercial scoring layers defined by the Fantaszy Szentre Launch
  Season specification.
- It keeps raw projections beside calibrated projections for auditability.
- It does not use ownership to alter raw player/captain projections.
- Risk mode changes decision tolerance later; it never changes raw xP.
- Historical 3.0 snapshots are stored separately and are never backfilled.

Commercial outputs added per player:
- Player Szentre Score (0–100)
- Captain Szentre Score (0–100)
- Lineup Score (0–100)
- component breakdowns
- calibrated xP + raw xP
- transparent calibration metadata

The first fair out-of-sample test for 3.0 is the first Gameweek that receives
a pre-deadline snapshot after this file is deployed.
"""

from __future__ import annotations

import bisect
import math
from datetime import datetime, timezone
from pathlib import Path

from update_fpl_data import (
    DATA,
    clamp,
    num,
    read_json,
    write_json,
    parse_dt,
    get_context,
)

MODEL_VERSION = "SZxP 3.0 Commercial Core"
RAW_MODEL_VERSION = "SZxP 2.2"
PRED_DIR = DATA / "predictions-3.0"
OUTPUT = DATA / "szxp-3.0.json"
META = DATA / "meta-3.0.json"
ACC30 = DATA / "accuracy-3.0.json"
ACC22 = DATA / "accuracy-2.2.json"

PLAYER_WEIGHTS = {
    "expected_points": 0.30,
    "fixture_quality": 0.20,
    "form_underlying": 0.20,
    "minutes_security": 0.15,
    "value": 0.10,
    "risk_adjustment": 0.05,
}
CAPTAIN_WEIGHTS = {
    "projected_points": 0.35,
    "ceiling": 0.25,
    "fixture_quality": 0.15,
    "minutes_security": 0.15,
    "role_set_pieces": 0.05,
    "risk_adjustment": 0.05,
}
LINEUP_WEIGHTS = {
    "projected_points": 0.45,
    "expected_minutes": 0.25,
    "fixture_matchup": 0.10,
    "ceiling": 0.10,
    "reliability_risk": 0.10,
}

DECISION_PROFILES = {
    "safe": {
        "label": "Safe",
        "roll_threshold": 74,
        "hit_threshold": 88,
        "close_call_tolerance": 1.00,
        "ownership_tiebreak_only": True,
    },
    "balanced": {
        "label": "Balanced",
        "roll_threshold": 70,
        "hit_threshold": 82,
        "close_call_tolerance": 0.60,
        "ownership_tiebreak_only": True,
    },
    "aggressive": {
        "label": "Aggressive",
        "roll_threshold": 66,
        "hit_threshold": 78,
        "close_call_tolerance": 0.35,
        "ownership_tiebreak_only": True,
    },
}


def utcnow():
    return datetime.now(timezone.utc)


def safe_float(value, default=0.0):
    try:
        return float(value)
    except Exception:
        return float(default)


def weighted_average(rows, getter, ngetter):
    vals = []
    for row in rows:
        value = getter(row)
        n = ngetter(row)
        if value is None or not n:
            continue
        vals.append((float(value), int(n)))
    if not vals:
        return None
    total = sum(n for _, n in vals)
    return sum(v * n for v, n in vals) / max(1, total)


def calibration_history():
    """
    Use genuine 3.0 history once available.
    Before that, bootstrap conservatively from the genuine 2.2 benchmark.
    Current/future Gameweek actuals are never read here.
    """
    sources = [
        ("SZxP 3.0 history", read_json(ACC30, {"gameweeks": []})),
        ("SZxP 2.2 bootstrap", read_json(ACC22, {"gameweeks": []})),
    ]

    for label, payload in sources:
        rows = (payload or {}).get("gameweeks", [])[-4:]
        if not rows:
            continue

        relevant_bias = weighted_average(
            rows,
            lambda g: (g.get("relevant") or {}).get("bias"),
            lambda g: (g.get("relevant") or {}).get("n"),
        )
        top_bias = weighted_average(
            rows,
            lambda g: (g.get("top100") or {}).get("bias"),
            lambda g: (g.get("top100") or {}).get("n"),
        )

        n_gw = len(rows)
        # Conservative learning rate. One completed GW informs the next one,
        # but cannot overhaul the projection on its own.
        strength = min(0.38, 0.22 + 0.04 * max(0, n_gw - 1))
        return {
            "source": label,
            "gameweeks": n_gw,
            "relevant_bias": round(relevant_bias or 0.0, 4),
            "top100_bias": round(top_bias or 0.0, 4),
            "strength": round(strength, 4),
        }

    return {
        "source": "none",
        "gameweeks": 0,
        "relevant_bias": 0.0,
        "top100_bias": 0.0,
        "strength": 0.0,
    }


def calibrate_xp(raw_xp, history, horizon_index=0):
    raw_xp = max(0.0, float(raw_xp))
    if history["gameweeks"] <= 0:
        return raw_xp, 0.0

    global_bias = clamp(history["relevant_bias"], -0.75, 0.75)
    top_bias = clamp(history["top100_bias"], -1.50, 1.50)

    # Only the high-end of the projection distribution receives the stronger
    # top-100 correction. This directly targets the GW3 issue without pushing
    # down ordinary players whose global bias was already close to neutral.
    elite_weight = clamp((raw_xp - 3.5) / 3.0, 0.0, 1.0)
    global_adjust = 0.18 * global_bias
    top_adjust = history["strength"] * top_bias * elite_weight

    # Evidence is only one-GW-ahead. Apply weaker correction farther out.
    horizon_factor = [1.00, 0.72, 0.60, 0.52][min(3, max(0, horizon_index))]
    adjustment = clamp((global_adjust + top_adjust) * horizon_factor, -0.60, 0.60)
    calibrated = clamp(raw_xp - adjustment, 0.0, 18.0)
    return calibrated, adjustment


def percentile(values, value):
    vals = sorted(float(v) for v in values if v is not None and math.isfinite(float(v)))
    if not vals:
        return 50.0
    if len(vals) == 1:
        return 50.0
    left = bisect.bisect_left(vals, float(value))
    right = bisect.bisect_right(vals, float(value))
    mid_rank = (left + right - 1) / 2
    return clamp(100.0 * mid_rank / max(1, len(vals) - 1), 0.0, 100.0)


def fixture_difficulty_score(player, fixtures, next_gw):
    team_id = int(player.get("team") or 0)
    fx = [
        f for f in fixtures
        if int(f.get("event") or 0) == int(next_gw)
        and (int(f.get("team_h") or 0) == team_id or int(f.get("team_a") or 0) == team_id)
    ]
    if not fx:
        return 0.0

    mapping = {1: 100.0, 2: 84.0, 3: 64.0, 4: 40.0, 5: 20.0}
    scores = []
    for f in fx:
        home = int(f.get("team_h") or 0) == team_id
        raw = f.get("team_h_difficulty") if home else f.get("team_a_difficulty")
        d = int(num(raw) or 3)
        scores.append(mapping.get(d, 64.0))
    return sum(scores) / len(scores)


def set_piece_score(p):
    # Role/set-piece evidence only; ownership is intentionally absent.
    score = 38.0

    pen = int(num(p.get("penalties_order")))
    if pen == 1:
        score += 40
    elif pen == 2:
        score += 24
    elif pen == 3:
        score += 12

    dfk = int(num(p.get("direct_freekicks_order")))
    if dfk == 1:
        score += 12
    elif dfk == 2:
        score += 7

    corners = int(num(p.get("corners_and_indirect_freekicks_order")))
    if corners == 1:
        score += 12
    elif corners == 2:
        score += 7

    return clamp(score, 0.0, 100.0)


def risk_score(model):
    sp = clamp(num(model.get("start_probability")), 0.0, 1.0)
    xmins = clamp(num(model.get("xmins")) / 90.0, 0.0, 1.0)
    avail = clamp(num(model.get("availability_factor")), 0.0, 1.0)
    intel = model.get("lineup_intelligence") or {}
    workload = model.get("workload_intelligence") or {}

    base = 100.0 * (0.50 * sp + 0.30 * xmins + 0.20 * avail)
    if intel.get("risk") == "high":
        base -= 28
    elif intel.get("risk") == "medium":
        base -= 12

    base -= 45.0 * clamp(num(workload.get("penalty")), 0.0, 0.25)
    return clamp(base, 0.0, 100.0)


def minutes_score(model):
    sp = clamp(num(model.get("start_probability")), 0.0, 1.0)
    xm = clamp(num(model.get("xmins")) / 90.0, 0.0, 1.0)
    return 100.0 * (0.60 * sp + 0.40 * xm)


def player_label(score):
    if score >= 90:
        return "ELITE"
    if score >= 80:
        return "STRONG"
    if score >= 70:
        return "GOOD"
    if score >= 60:
        return "WATCH"
    if score >= 50:
        return "NEUTRAL"
    return "AVOID"


def captain_gap_confidence(gap):
    if gap < 3:
        return "Toss-up"
    if gap < 6:
        return "Medium"
    if gap < 10:
        return "High"
    return "Very High"


def main():
    raw = read_json(DATA / "szxp-2.2.json", {})
    bootstrap = read_json(DATA / "bootstrap-static.json", {})
    fixtures = read_json(DATA / "fixtures.json", [])
    meta22 = read_json(DATA / "meta-2.2.json", {})

    if not raw or not bootstrap:
        raise RuntimeError(
            "Fresh SZxP 2.2 and bootstrap data are required. "
            "Run update_fpl_data.py and build_szxp22.py first."
        )

    events = bootstrap.get("events", [])
    context = get_context(events)
    next_event = context.get("next_event")
    next_gw = int(next_event["id"]) if next_event else None
    if next_gw is None:
        raise RuntimeError("No next FPL Gameweek found.")

    elem_map = {int(p["id"]): p for p in bootstrap.get("elements", [])}
    history = calibration_history()

    players = []
    for src in raw.get("players", []):
        p = elem_map.get(int(src["id"]), {})
        row = dict(src)

        raw_xp = [float(x) for x in (src.get("xp") or [0, 0, 0, 0])[:4]]
        while len(raw_xp) < 4:
            raw_xp.append(0.0)

        calibrated = []
        adjustments = []
        for i, value in enumerate(raw_xp):
            cal, adj = calibrate_xp(value, history, i)
            calibrated.append(round(cal, 2))
            adjustments.append(round(adj, 3))

        raw_xp4 = float(src.get("xp4") or sum(raw_xp))
        xp4 = round(sum(calibrated), 2)

        raw_ceiling = float(src.get("ceiling_gw1") or raw_xp[0])
        raw_gap = max(0.0, raw_ceiling - raw_xp[0])
        ceiling = round(calibrated[0] + 0.92 * raw_gap, 2)

        price = max(3.5, num(p.get("now_cost")) / 10.0)
        value4 = round(xp4 / price, 3)

        row.update({
            "model_version": MODEL_VERSION,
            "raw_model_version": RAW_MODEL_VERSION,
            "raw_xp": [round(x, 2) for x in raw_xp],
            "raw_xp4": round(raw_xp4, 2),
            "raw_ceiling_gw1": round(raw_ceiling, 2),
            "xp": calibrated,
            "xp4": xp4,
            "ceiling_gw1": ceiling,
            "value_4gw": value4,
            "calibration_adjustments": adjustments,
            "fixture_quality_score": round(fixture_difficulty_score(p, fixtures, next_gw), 2),
            "minutes_security_score": round(minutes_score(row), 2),
            "risk_score": round(risk_score(row), 2),
            "role_set_pieces_score": round(set_piece_score(p), 2),
        })

        rates = row.get("rates") or {}
        pos = int(p.get("element_type") or row.get("element_type") or 0)
        goal_points = {1: 6, 2: 6, 3: 5, 4: 4}.get(pos, 5)
        attack_rate = (
            num(rates.get("xg90")) * goal_points
            + num(rates.get("xa90")) * 3.0
        )
        if pos == 1:
            attack_rate += 0.35 * num(rates.get("saves90"))
        underlying = (
            0.45 * num(p.get("form"))
            + 0.30 * num(p.get("points_per_game"))
            + 0.20 * attack_rate
            + 0.05 * num(rates.get("bonus90"))
        )

        row["_pos"] = pos
        row["_xp_opportunity"] = 0.65 * calibrated[0] + 0.35 * (xp4 / 4.0)
        row["_underlying"] = underlying
        row["_value"] = value4
        row["_ceiling"] = ceiling
        players.append(row)

    all_xp = [x["_xp_opportunity"] for x in players]
    all_ceiling = [x["_ceiling"] for x in players]
    by_pos_under = {}
    by_pos_value = {}
    for x in players:
        by_pos_under.setdefault(x["_pos"], []).append(x["_underlying"])
        by_pos_value.setdefault(x["_pos"], []).append(x["_value"])

    for row in players:
        xp_component = percentile(all_xp, row["_xp_opportunity"])
        form_component = percentile(by_pos_under.get(row["_pos"], []), row["_underlying"])
        value_component = percentile(by_pos_value.get(row["_pos"], []), row["_value"])
        fixture_component = row["fixture_quality_score"]
        minute_component = row["minutes_security_score"]
        risk_component = row["risk_score"]

        player_components = {
            "expected_points": round(xp_component, 1),
            "fixture_quality": round(fixture_component, 1),
            "form_underlying": round(form_component, 1),
            "minutes_security": round(minute_component, 1),
            "value": round(value_component, 1),
            "risk_adjustment": round(risk_component, 1),
        }
        player_score = sum(
            PLAYER_WEIGHTS[k] * player_components[k] for k in PLAYER_WEIGHTS
        )

        ceiling_component = percentile(all_ceiling, row["_ceiling"])
        captain_components = {
            "projected_points": round(percentile(all_xp, row["xp"][0]), 1),
            "ceiling": round(ceiling_component, 1),
            "fixture_quality": round(fixture_component, 1),
            "minutes_security": round(minute_component, 1),
            "role_set_pieces": round(row["role_set_pieces_score"], 1),
            "risk_adjustment": round(risk_component, 1),
        }
        captain_score = sum(
            CAPTAIN_WEIGHTS[k] * captain_components[k] for k in CAPTAIN_WEIGHTS
        )

        eligible = bool(row.get("captain_eligible"))
        if not eligible:
            captain_output = 0.0
        else:
            captain_output = round(captain_score, 2)

        lineup_components = {
            "projected_points": round(percentile(all_xp, row["xp"][0]), 1),
            "expected_minutes": round(minute_component, 1),
            "fixture_matchup": round(fixture_component, 1),
            "ceiling": round(ceiling_component, 1),
            "reliability_risk": round(risk_component, 1),
        }
        lineup_score = sum(
            LINEUP_WEIGHTS[k] * lineup_components[k] for k in LINEUP_WEIGHTS
        )

        row.update({
            "sentre_score": round(player_score, 2),
            "sentre_label": player_label(player_score),
            "sentre_components": player_components,
            "captain_sentre": round(captain_score, 2),
            # Backward-compatible field consumed by current owner UI.
            "captain_score": captain_output,
            "captain_components": captain_components,
            "lineup_score": round(lineup_score, 2),
            "lineup_components": lineup_components,
        })

        for key in ["_pos", "_xp_opportunity", "_underlying", "_value", "_ceiling"]:
            row.pop(key, None)

    captain_board = sorted(
        [
            {
                "id": p["id"],
                "web_name": p.get("web_name"),
                "captain_sentre": p["captain_sentre"],
                "xp": p["xp"][0],
                "xmins": p.get("xmins"),
            }
            for p in players
            if p.get("captain_eligible")
        ],
        key=lambda x: x["captain_sentre"],
        reverse=True,
    )[:10]

    captain_confidence = None
    if captain_board:
        gap = (
            captain_board[0]["captain_sentre"] - captain_board[1]["captain_sentre"]
            if len(captain_board) > 1 else 10.0
        )
        captain_confidence = {
            "leader": captain_board[0],
            "runner_up": captain_board[1] if len(captain_board) > 1 else None,
            "gap": round(gap, 2),
            "confidence": captain_gap_confidence(gap),
        }

    output = {
        "model_version": MODEL_VERSION,
        "raw_model_version": RAW_MODEL_VERSION,
        "mode": "production",
        "generated_at_utc": utcnow().isoformat(),
        "published_gw": raw.get("published_gw"),
        "next_event_ids": raw.get("next_event_ids"),
        "first_half_event_ids": raw.get("first_half_event_ids"),
        "calibration": history,
        "commercial_weights": {
            "player_sentre": PLAYER_WEIGHTS,
            "captain_sentre": CAPTAIN_WEIGHTS,
            "lineup": LINEUP_WEIGHTS,
            "decision_profiles": DECISION_PROFILES,
        },
        "captain_board": captain_board,
        "captain_confidence": captain_confidence,
        "players": players,
        "notes": [
            "Player Szentre, Transfer Szentre and Captain Szentre are separate decision concepts.",
            "Player Szentre answers player attractiveness; it is not a team-specific BUY instruction.",
            "Raw xP is retained for audit while calibrated xP is used by the production customer decision layer.",
            "Calibration learns only from completed genuine historical snapshots and is deliberately conservative.",
            "Ownership does not alter raw player or captain scores; Ultimate risk strategy may use it only as a close-call tiebreak.",
            "Safe/Balanced/Aggressive changes decision tolerance, not raw xP.",
            "ROLL, HOLD and NO CHIP are valid outcomes; the commercial engine must never force action.",
        ],
    }

    write_json(OUTPUT, output)

    meta = {
        "model_version": MODEL_VERSION,
        "raw_model_version": RAW_MODEL_VERSION,
        "mode": "production",
        "updated_at_utc": utcnow().isoformat(),
        "published_gw": raw.get("published_gw"),
        "next_gw": next_gw,
        "calibration": history,
        "lineup_intel_signals": meta22.get("lineup_intel_signals", 0),
        "player_load_records": meta22.get("player_load_records", 0),
    }
    write_json(META, meta)

    deadline = parse_dt(next_event["deadline_time"])
    now = context["now"]
    if now < deadline:
        PRED_DIR.mkdir(parents=True, exist_ok=True)
        snapshot = dict(output)
        snapshot["snapshot_for_gw"] = next_gw
        snapshot["deadline_time"] = next_event["deadline_time"]
        snapshot["snapshot_at_utc"] = utcnow().isoformat()
        write_json(PRED_DIR / f"gw{next_gw}.json", snapshot)

    print({
        "model": MODEL_VERSION,
        "next_gw": next_gw,
        "calibration_source": history["source"],
        "calibration_gameweeks": history["gameweeks"],
        "players": len(players),
    })


if __name__ == "__main__":
    main()
