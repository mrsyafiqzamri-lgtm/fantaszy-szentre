#!/usr/bin/env python3
"""
SZxP 2.2 Challenger
-------------------
Runs beside SZxP 2.1. It does NOT replace production projections.

2.2 keeps the same football scoring primitives as 2.1, but adds a stronger
role/availability layer:
- recent starts/minutes
- official FPL availability
- timestamped lineup/news/social intelligence signals
- optional cross-competition workload signals
- captain safety gate

Historical 2.2 snapshots are stored separately in data/predictions-2.2/.
"""

import math
from datetime import datetime, timezone
from pathlib import Path

from update_fpl_data import (
    DATA,
    clamp,
    num,
    get_json,
    read_json,
    write_json,
    parse_dt,
    get_context,
    team_games_played,
    availability_factor,
    player_rates,
    team_strength_maps,
    predict_fixture,
)

MODEL_VERSION = "SZxP 2.2 Challenger"
PRED_DIR_22 = DATA / "predictions-2.2"
INTEL_DIR = DATA / "intelligence"
LINEUP_INTEL_PATH = INTEL_DIR / "lineup-intel.json"
PLAYER_LOAD_PATH = INTEL_DIR / "player-load.json"

SOURCE_TIER_WEIGHT = {
    "A": 0.95,  # official club / manager / official injury information
    "B": 0.80,  # trusted club reporter / established journalist
    "C": 0.60,  # reliable aggregator / established fantasy news account
    "D": 0.35,  # unverified / anonymous / low-confidence leak
}


def utcnow():
    return datetime.now(timezone.utc)


def safe_dt(value):
    if not value:
        return None
    try:
        return parse_dt(value)
    except Exception:
        return None


def recent_event_stats(published_gw):
    """Fetch up to the last three completed/published FPL live datasets."""
    out = {}
    first = max(1, int(published_gw) - 2)
    for gw in range(first, int(published_gw) + 1):
        try:
            live = get_json(f"/event/{gw}/live/")
        except Exception as exc:
            print(f"2.2 recent live warning GW{gw}: {exc}")
            continue

        for item in live.get("elements", []):
            pid = int(item["id"])
            stats = item.get("stats", {}) or {}
            mins = int(num(stats.get("minutes")))
            raw_starts = stats.get("starts")
            started = None if raw_starts in (None, "") else bool(int(num(raw_starts)))
            out.setdefault(pid, []).append({
                "gw": gw,
                "minutes": mins,
                "started": started,
            })
    return out


def start_like_score(event):
    if event.get("started") is True:
        return 1.0
    if event.get("started") is False:
        return 0.0

    # Fallback for API seasons where the live endpoint does not expose starts.
    mins = int(num(event.get("minutes")))
    if mins >= 45:
        return 0.95
    if mins >= 30:
        return 0.72
    if mins > 0:
        return 0.12
    return 0.03


def recency_weighted_start_rate(events):
    if not events:
        return None
    ordered = sorted(events, key=lambda x: int(x.get("gw", 0)))
    weights = [0.20, 0.30, 0.50][-len(ordered):]
    vals = [start_like_score(e) for e in ordered]
    denom = sum(weights)
    return sum(v * w for v, w in zip(vals, weights)) / max(0.001, denom)


def recent_started_minutes(events):
    vals = []
    for e in events or []:
        mins = int(num(e.get("minutes")))
        started = e.get("started")
        if started is True or (started is None and mins >= 45):
            vals.append(mins)
    if not vals:
        return None
    # Recent games matter more.
    vals = vals[-3:]
    weights = [0.20, 0.30, 0.50][-len(vals):]
    return sum(v * w for v, w in zip(vals, weights)) / sum(weights)


def base_role_start_probability(p, games_played, recent):
    starts = int(num(p.get("starts")))
    season_rate = starts / max(1, int(games_played))
    recent_rate = recency_weighted_start_rate(recent)

    if games_played <= 0:
        ep = num(p.get("ep_next"))
        selected = num(p.get("selected_by_percent"))
        if ep >= 4.0:
            return 0.84
        if ep >= 3.0 or selected >= 5:
            return 0.72
        return 0.42

    if recent_rate is None:
        role = 0.12 + 0.84 * season_rate
    elif games_played <= 2:
        role = 0.58 * recent_rate + 0.42 * season_rate
    else:
        role = 0.66 * recent_rate + 0.34 * season_rate

    # A player starting every league match should still carry a small rotation risk.
    if starts >= games_played and games_played > 0:
        role = max(role, 0.90 if games_played <= 3 else 0.88)

    # Official ep_next is only weak role evidence in 2.2, never an override.
    ep = num(p.get("ep_next"))
    if ep >= 4.5 and starts > 0:
        role = max(role, 0.82)
    elif ep >= 3.0 and starts > 0:
        role = max(role, 0.72)

    return clamp(role, 0.03, 0.97)


def load_lineup_signals(target_gw=None):
    payload = read_json(LINEUP_INTEL_PATH, {"signals": []}) or {"signals": []}
    by_player = {}
    for signal in payload.get("signals", []):
        pid = signal.get("player_id")
        if pid in (None, ""):
            continue
        signal_gw = signal.get("gameweek")
        if target_gw is not None and signal_gw not in (None, ""):
            if int(num(signal_gw)) != int(target_gw):
                continue
        by_player.setdefault(int(pid), []).append(signal)
    return by_player


def load_player_load(target_gw=None):
    payload = read_json(PLAYER_LOAD_PATH, {"players": []}) or {"players": []}
    out = {}
    for x in payload.get("players", []):
        if x.get("player_id") in (None, ""):
            continue
        load_gw = x.get("gameweek")
        if target_gw is not None and load_gw not in (None, ""):
            if int(num(load_gw)) != int(target_gw):
                continue
        out[int(x["player_id"])] = x
    return out


def signal_recency_factor(signal, now):
    published = safe_dt(signal.get("published_at_utc") or signal.get("observed_at_utc"))
    expires = safe_dt(signal.get("expires_at_utc"))
    if expires and now > expires:
        return 0.0
    if not published:
        return 0.55

    age_hours = max(0.0, (now - published).total_seconds() / 3600)
    if age_hours <= 2:
        return 1.00
    if age_hours <= 6:
        return 0.90
    if age_hours <= 12:
        return 0.75
    if age_hours <= 24:
        return 0.55
    if age_hours <= 48:
        return 0.30
    return 0.12


def signal_target_probability(signal):
    if signal.get("start_probability") not in (None, ""):
        return clamp(num(signal.get("start_probability")), 0.0, 1.0)

    direction = str(signal.get("direction") or "").lower()
    return {
        "strong_positive": 0.95,
        "positive": 0.86,
        "neutral": 0.55,
        "negative": 0.22,
        "strong_negative": 0.05,
        "out": 0.01,
    }.get(direction)


def combine_lineup_intel(base_probability, signals, now):
    usable = []
    for signal in signals or []:
        target = signal_target_probability(signal)
        if target is None:
            continue

        tier = str(signal.get("source_tier") or "D").upper()
        tier_w = SOURCE_TIER_WEIGHT.get(tier, 0.35)
        recency_w = signal_recency_factor(signal, now)
        sources = max(1, int(num(signal.get("corroborating_sources"), 1)))
        corroboration = 1.0 if sources == 1 else min(1.20, 1.0 + 0.10 * (sources - 1))
        specificity = clamp(num(signal.get("specificity"), 1.0), 0.50, 1.00)

        weight = clamp(tier_w * recency_w * corroboration * specificity, 0.0, 0.96)
        if weight <= 0:
            continue

        usable.append({
            "target": target,
            "weight": weight,
            "tier": tier,
            "source_type": signal.get("source_type"),
            "source_name": signal.get("source_name"),
            "note": signal.get("note"),
        })

    if not usable:
        return base_probability, {
            "applied": False,
            "signal_count": 0,
            "risk": "none",
            "summary": None,
        }

    # Combine several independent pieces of evidence while preventing a single
    # low-quality rumour from fully overriding the statistical prior.
    weighted_target = sum(x["target"] * x["weight"] for x in usable) / sum(x["weight"] for x in usable)
    combined_weight = 1.0
    for x in usable:
        combined_weight *= (1.0 - x["weight"])
    combined_weight = clamp(1.0 - combined_weight, 0.0, 0.97)

    adjusted = clamp(
        base_probability * (1.0 - combined_weight) + weighted_target * combined_weight,
        0.01,
        0.99,
    )

    lowest_target = min(x["target"] for x in usable)
    risk = "high" if adjusted < 0.45 or lowest_target <= 0.20 else "medium" if adjusted < 0.70 else "low"
    summary_bits = []
    for x in sorted(usable, key=lambda z: z["weight"], reverse=True)[:2]:
        label = x.get("source_name") or x.get("source_type") or f"Tier {x['tier']}"
        if x.get("note"):
            summary_bits.append(f"{label}: {x['note']}")
        else:
            summary_bits.append(str(label))

    return adjusted, {
        "applied": True,
        "signal_count": len(usable),
        "combined_weight": round(combined_weight, 3),
        "target_start_probability": round(weighted_target, 3),
        "risk": risk,
        "summary": " | ".join(summary_bits) if summary_bits else None,
    }


def workload_adjustment(role_probability, load):
    if not load:
        return role_probability, {"applied": False, "penalty": 0.0}

    mins7 = num(load.get("minutes_last_7d"))
    mins14 = num(load.get("minutes_last_14d"))
    travel = bool(load.get("long_travel") or load.get("travel_flag"))
    extra_match = bool(load.get("extra_time_last_7d"))

    penalty = 0.0
    if mins7 >= 240:
        penalty += 0.16
    elif mins7 >= 180:
        penalty += 0.10
    elif mins7 >= 135:
        penalty += 0.05

    if mins14 >= 420:
        penalty += 0.06
    if travel:
        penalty += 0.03
    if extra_match:
        penalty += 0.04

    penalty = clamp(penalty, 0.0, 0.25)
    return clamp(role_probability - penalty, 0.01, 0.99), {
        "applied": penalty > 0,
        "penalty": round(penalty, 3),
        "minutes_last_7d": mins7,
        "minutes_last_14d": mins14,
    }


def expected_minutes_22(p, games_played, recent, signals, load, now):
    base_role = base_role_start_probability(p, games_played, recent)
    intel_role, intel_meta = combine_lineup_intel(base_role, signals, now)
    role_after_load, load_meta = workload_adjustment(intel_role, load)

    starts = int(num(p.get("starts")))
    total_minutes = num(p.get("minutes"))

    avg_start = recent_started_minutes(recent)
    if avg_start is None:
        if starts > 0:
            avg_start = clamp(total_minutes / starts, 58, 90)
        else:
            avg_start = 80.0
    avg_start = clamp(avg_start, 58, 90)

    # Bench players do not always appear. More secure starters have lower
    # conditional cameo probability when they are unexpectedly benched.
    cameo_probability = clamp(0.58 - 0.32 * role_after_load, 0.18, 0.52)
    cameo_minutes = 14.0 if total_minutes > 0 else 9.0

    avail = availability_factor(p)
    xmins = avail * (
        role_after_load * avg_start
        + (1.0 - role_after_load) * cameo_probability * cameo_minutes
    )

    start_probability = clamp(role_after_load * avail, 0.0, 0.99)
    xmins = int(round(clamp(xmins, 0, 90)))

    return {
        "xmins": xmins,
        "start_probability": round(start_probability, 3),
        "role_start_probability": round(role_after_load, 3),
        "base_role_start_probability": round(base_role, 3),
        "availability_factor": round(avail, 3),
        "intel": intel_meta,
        "workload": load_meta,
    }


def confidence_22(meta):
    sp = num(meta.get("start_probability"))
    xmins = num(meta.get("xmins"))
    intel_risk = (meta.get("intel") or {}).get("risk", "none")

    if sp < 0.60 or xmins < 50 or intel_risk == "high":
        return "Low"
    if sp >= 0.84 and xmins >= 72 and intel_risk in {"none", "low"}:
        return "High"
    return "Medium"


def captain_gate(meta, confidence):
    sp = num(meta.get("start_probability"))
    xmins = num(meta.get("xmins"))
    avail = num(meta.get("availability_factor"))
    intel_risk = (meta.get("intel") or {}).get("risk", "none")

    reasons = []
    if sp < 0.78:
        reasons.append(f"start probability {round(sp * 100)}%")
    if xmins < 68:
        reasons.append(f"xMins {round(xmins)}")
    if avail < 0.90:
        reasons.append(f"availability {round(avail * 100)}%")
    if confidence == "Low":
        reasons.append("low confidence")
    if intel_risk == "high":
        reasons.append("negative lineup intelligence")

    return len(reasons) == 0, reasons


def build_projections_22(bootstrap, fixtures, context):
    teams = bootstrap.get("teams", [])
    elements = bootstrap.get("elements", [])
    team_map, avgs = team_strength_maps(teams)

    planning_events = context.get("first_half_events") or context["next_events"]
    event_ids = [e["id"] for e in planning_events]
    fixtures_by_event = {
        event_id: [f for f in fixtures if f.get("event") == event_id]
        for event_id in event_ids
    }

    recent_map = recent_event_stats(context["published_gw"])
    target_gw = context["next_event"]["id"] if context.get("next_event") else None
    signal_map = load_lineup_signals(target_gw)
    load_map = load_player_load(target_gw)
    now = context["now"]

    players = []

    for p in elements:
        games = team_games_played(p["team"], fixtures)
        role = expected_minutes_22(
            p,
            games,
            recent_map.get(int(p["id"]), []),
            signal_map.get(int(p["id"]), []),
            load_map.get(int(p["id"])),
            now,
        )
        xmins = role["xmins"]
        rates = player_rates(p)

        xp_half = []
        fixture_labels_half = []
        component_gw1 = None

        for horizon_idx, event_id in enumerate(event_ids):
            event_fixtures = [
                f for f in fixtures_by_event[event_id]
                if f.get("team_h") == p["team"] or f.get("team_a") == p["team"]
            ]

            if not event_fixtures:
                xp_half.append(0.0)
                fixture_labels_half.append("BLANK")
                continue

            total = 0.0
            parts = {
                "appearance": 0.0,
                "goal": 0.0,
                "assist": 0.0,
                "clean_sheet": 0.0,
                "saves": 0.0,
                "bonus": 0.0,
                "defensive": 0.0,
            }
            labels = []

            for f in event_fixtures:
                pred = predict_fixture(p, f, xmins, rates, team_map, avgs)
                total += pred["raw"]
                for key in parts:
                    parts[key] += pred[key]
                opp = team_map[pred["opponent"]].get("short_name", str(pred["opponent"]))
                labels.append(("H " if pred["home"] else "A ") + opp)

            # 2.2 deliberately lowers dependence on FPL ep_next because the live
            # role/intelligence layer should carry more of the minutes decision.
            if horizon_idx == 0 and len(event_fixtures) == 1:
                ep = num(p.get("ep_next"))
                if ep > 0:
                    official_weight = 0.20 if context["published_gw"] <= 3 else 0.12
                    total = (1 - official_weight) * total + official_weight * ep

            if role["availability_factor"] <= 0:
                total = 0.0

            total = clamp(total, 0, 18 * max(1, len(event_fixtures)))
            xp_half.append(round(total, 2))
            fixture_labels_half.append(" + ".join(labels))

            if horizon_idx == 0:
                component_gw1 = {k: round(v, 2) for k, v in parts.items()}

        xp = xp_half[:4]
        fixture_labels = fixture_labels_half[:4]
        while len(xp) < 4:
            xp.append(0.0)
            fixture_labels.append("—")

        total4 = round(sum(xp), 2)
        confidence = confidence_22(role)

        attack_component = 0.0
        if component_gw1:
            attack_component = (
                component_gw1["goal"]
                + component_gw1["assist"]
                + component_gw1["bonus"]
            )

        ceiling = round(
            xp[0] + 1.15 * math.sqrt(max(0.0, attack_component * 3.2)),
            2,
        )
        conf_factor = {"High": 1.00, "Medium": 0.96, "Low": 0.86}[confidence]
        captain_raw = round(
            (0.82 * xp[0] + 0.18 * ceiling) * conf_factor,
            2,
        )
        captain_eligible, captain_reasons = captain_gate(role, confidence)
        captain_score = captain_raw if captain_eligible else 0.0

        price = max(3.5, num(p.get("now_cost")) / 10.0)
        value4 = round(total4 / price, 2)

        players.append({
            "id": p["id"],
            "web_name": p.get("web_name"),
            "team": p["team"],
            "element_type": p["element_type"],
            "xmins": xmins,
            "start_probability": role["start_probability"],
            "role_start_probability": role["role_start_probability"],
            "availability_factor": role["availability_factor"],
            "confidence": confidence,
            "xp": xp,
            "xp4": total4,
            "xp_first_half": xp_half,
            "ceiling_gw1": ceiling,
            "captain_score": captain_score,
            "captain_score_raw": captain_raw,
            "captain_eligible": captain_eligible,
            "captain_risk_reasons": captain_reasons,
            "value_4gw": value4,
            "fixtures": fixture_labels,
            "fixtures_first_half": fixture_labels_half,
            "rates": {k: round(v, 4) for k, v in rates.items()},
            "components_gw1": component_gw1 or {},
            "lineup_intelligence": role["intel"],
            "workload_intelligence": role["workload"],
        })

    return {
        "model_version": MODEL_VERSION,
        "mode": "challenger_shadow",
        "generated_at_utc": utcnow().isoformat(),
        "next_event_ids": [e["id"] for e in context["next_events"]],
        "first_half_event_ids": event_ids,
        "published_gw": context["published_gw"],
        "players": players,
        "notes": [
            "SZxP 2.2 is a challenger and does not replace SZxP 2.1 production yet.",
            "First genuine 2.2 accuracy begins with the first pre-deadline 2.2 snapshot.",
            "2.2 adds recent-role modelling, timestamped lineup/social intelligence ingestion, optional cross-competition workload intelligence, and a captain safety gate.",
            "Social/news signals only affect the model when they are present in data/intelligence/lineup-intel.json or supplied by a future connected intel feed.",
            "Historical snapshots are stored separately and must never be rebuilt after a deadline.",
        ],
    }


def maybe_snapshot_22(projections, context):
    nxt = context.get("next_event")
    if not nxt:
        return

    deadline = parse_dt(nxt["deadline_time"])
    now = context["now"]
    if now >= deadline:
        return

    PRED_DIR_22.mkdir(parents=True, exist_ok=True)
    snap = dict(projections)
    snap["snapshot_for_gw"] = nxt["id"]
    snap["deadline_time"] = nxt["deadline_time"]
    snap["snapshot_at_utc"] = utcnow().isoformat()

    # Exactly like 2.1: overwrite only before deadline. The final pre-deadline
    # hourly run becomes the immutable benchmark once the deadline passes.
    write_json(PRED_DIR_22 / f"gw{nxt['id']}.json", snap)


def main():
    bootstrap = read_json(DATA / "bootstrap-static.json", {})
    fixtures = read_json(DATA / "fixtures.json", [])

    if not bootstrap or not fixtures:
        raise RuntimeError(
            "Missing refreshed FPL data. Run scripts/update_fpl_data.py first."
        )

    context = get_context(bootstrap.get("events", []))
    projections = build_projections_22(bootstrap, fixtures, context)

    write_json(DATA / "szxp-2.2.json", projections)
    maybe_snapshot_22(projections, context)

    meta = {
        "model_version": MODEL_VERSION,
        "mode": "challenger_shadow",
        "updated_at_utc": utcnow().isoformat(),
        "published_gw": context["published_gw"],
        "next_gw": context["next_event"]["id"] if context.get("next_event") else None,
        "lineup_intel_signals": sum(
            len(v) for v in load_lineup_signals(
                context["next_event"]["id"] if context.get("next_event") else None
            ).values()
        ),
        "player_load_records": len(load_player_load(
            context["next_event"]["id"] if context.get("next_event") else None
        )),
    }
    write_json(DATA / "meta-2.2.json", meta)
    print(meta)


if __name__ == "__main__":
    main()
