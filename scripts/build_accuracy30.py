#!/usr/bin/env python3
"""
Genuine out-of-sample accuracy tracking for SZxP 3.0 Commercial Core.

Only pre-deadline snapshots in data/predictions-3.0/ are eligible.
Raw 2.2 values are also scored when present so calibration can be audited.
"""

import math
import re
from datetime import datetime, timezone

from update_fpl_data import (
    DATA,
    ENTRY_IDS,
    get_json,
    read_json,
    write_json,
    num,
)

PRED_DIR = DATA / "predictions-3.0"
ACCURACY_PATH = DATA / "accuracy-3.0.json"
MODEL_VERSION = "SZxP 3.0 Commercial Core"

TEAM_NAMES = {
    113200: "Joaoassic Park",
    119375: "Permas Jaya FC",
    114940: "KK Old Boys FC",
    139195: "Toastin Adarabioyo",
    131073: "Enzopreneur",
    132558: "Colwill of Fortune",
    128817: "Palmerlaysia Boleh!",
    137607: "Roger and Out",
    130090: "Petrol Neto",
}


def pearson(xs, ys):
    n = min(len(xs), len(ys))
    if n < 2:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    if vx <= 0 or vy <= 0:
        return None
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    return cov / math.sqrt(vx * vy)


def metrics(rows):
    if not rows:
        return {}
    errs = [abs(pred - actual) for _, pred, actual in rows]
    signed = [pred - actual for _, pred, actual in rows]
    xs = [pred for _, pred, _ in rows]
    ys = [actual for _, _, actual in rows]
    corr = pearson(xs, ys)
    return {
        "n": len(rows),
        "mae": round(sum(errs) / len(errs), 3),
        "bias": round(sum(signed) / len(signed), 3),
        "within_2": round(sum(1 for e in errs if e <= 2) / len(errs), 4),
        "correlation": None if corr is None else round(corr, 4),
    }


def score_players(gw, snapshot):
    live = get_json(f"/event/{gw}/live/")
    actual = {
        int(e["id"]): num((e.get("stats") or {}).get("total_points"))
        for e in live.get("elements", [])
    }

    calibrated = []
    raw = []
    sentre_rows = []
    captain_rows = []

    for p in snapshot.get("players", []):
        pid = int(p["id"])
        pred = num((p.get("xp") or [0])[0])
        raw_pred = num((p.get("raw_xp") or [pred])[0])
        act = actual.get(pid, 0.0)

        calibrated.append((pid, pred, act))
        raw.append((pid, raw_pred, act))
        sentre_rows.append((pid, num(p.get("sentre_score")), act))
        if p.get("captain_eligible"):
            captain_rows.append((pid, num(p.get("captain_sentre")), act))

    relevant = [r for r in calibrated if r[1] >= 1.5 or r[2] >= 3]
    raw_relevant = [r for r in raw if r[1] >= 1.5 or r[2] >= 3]
    top100 = sorted(calibrated, key=lambda r: r[1], reverse=True)[:100]
    raw_top100 = sorted(raw, key=lambda r: r[1], reverse=True)[:100]

    top_sentre = sorted(sentre_rows, key=lambda r: r[1], reverse=True)[:50]
    top_captains = sorted(captain_rows, key=lambda r: r[1], reverse=True)[:10]

    audit = {
        "top50_sentre_actual_avg": (
            round(sum(r[2] for r in top_sentre) / len(top_sentre), 3)
            if top_sentre else None
        ),
        "top10_captain_actual_avg": (
            round(sum(r[2] for r in top_captains) / len(top_captains), 3)
            if top_captains else None
        ),
        "captain_rank1_actual": top_captains[0][2] if top_captains else None,
    }

    return (
        metrics(relevant),
        metrics(top100),
        metrics(raw_relevant),
        metrics(raw_top100),
        audit,
    )


def score_teams(gw, snapshot):
    xp_map = {
        int(p["id"]): num((p.get("xp") or [0])[0])
        for p in snapshot.get("players", [])
    }
    raw_map = {
        int(p["id"]): num((p.get("raw_xp") or p.get("xp") or [0])[0])
        for p in snapshot.get("players", [])
    }

    teams = []
    for entry_id in ENTRY_IDS:
        try:
            picks = get_json(f"/entry/{entry_id}/event/{gw}/picks/")
            expected = 0.0
            raw_expected = 0.0
            for pick in picks.get("picks", []):
                mult = num(pick.get("multiplier"))
                pid = int(pick["element"])
                expected += xp_map.get(pid, 0.0) * mult
                raw_expected += raw_map.get(pid, 0.0) * mult

            history = picks.get("entry_history", {}) or {}
            actual = num(history.get("points"))
            teams.append({
                "entry_id": entry_id,
                "team_name": TEAM_NAMES.get(entry_id, str(entry_id)),
                "locked_szxp": round(expected, 2),
                "raw_locked_szxp": round(raw_expected, 2),
                "actual_points": round(actual, 2),
                "actual_minus_szxp": round(actual - expected, 2),
                "active_chip": picks.get("active_chip"),
            })
        except Exception as exc:
            teams.append({
                "entry_id": entry_id,
                "team_name": TEAM_NAMES.get(entry_id, str(entry_id)),
                "error": str(exc),
            })

    valid = [
        t for t in teams if "locked_szxp" in t and "actual_points" in t
    ]
    team_mae = None
    raw_team_mae = None
    if valid:
        team_mae = round(
            sum(abs(t["actual_points"] - t["locked_szxp"]) for t in valid)
            / len(valid),
            3,
        )
        raw_team_mae = round(
            sum(abs(t["actual_points"] - t["raw_locked_szxp"]) for t in valid)
            / len(valid),
            3,
        )
    return teams, team_mae, raw_team_mae, len(valid)


def weighted_average(gameweeks, value_getter, n_getter):
    vals = []
    for row in gameweeks:
        value = value_getter(row)
        n = n_getter(row)
        if value is None or not n:
            continue
        vals.append((float(value), int(n)))
    if not vals:
        return None
    total_n = sum(n for _, n in vals)
    return round(sum(v * n for v, n in vals) / total_n, 3)


def main():
    bootstrap = read_json(DATA / "bootstrap-static.json", {})
    finished = {
        int(e["id"])
        for e in bootstrap.get("events", [])
        if e.get("finished") is True
    }

    accuracy = read_json(ACCURACY_PATH, {"gameweeks": []}) or {"gameweeks": []}
    existing = {
        int(x["gw"]): x for x in accuracy.get("gameweeks", [])
    }

    if PRED_DIR.exists():
        for snap_path in sorted(PRED_DIR.glob("gw*.json")):
            match = re.match(r"gw(\d+)\.json$", snap_path.name)
            if not match:
                continue

            gw = int(match.group(1))
            if gw not in finished or gw in existing:
                continue

            snapshot = read_json(snap_path, {})
            if not snapshot:
                continue

            try:
                relevant, top100, raw_rel, raw_top100, decision_audit = score_players(gw, snapshot)
                teams, team_mae, raw_team_mae, team_n = score_teams(gw, snapshot)
                existing[gw] = {
                    "gw": gw,
                    "model_version": snapshot.get("model_version") or MODEL_VERSION,
                    "scored_at_utc": datetime.now(timezone.utc).isoformat(),
                    "locked_snapshot_at_utc": (
                        snapshot.get("snapshot_at_utc")
                        or snapshot.get("generated_at_utc")
                    ),
                    "deadline_time": snapshot.get("deadline_time"),
                    "calibration": snapshot.get("calibration"),
                    "relevant": relevant,
                    "top100": top100,
                    "raw_relevant": raw_rel,
                    "raw_top100": raw_top100,
                    "team_mae": team_mae,
                    "raw_team_mae": raw_team_mae,
                    "team_predictions_evaluated": team_n,
                    "decision_audit": decision_audit,
                    "teams": teams,
                }
            except Exception as exc:
                print(f"3.0 accuracy warning GW{gw}: {exc}")

    gameweeks = [
        existing[gw] for gw in sorted(existing)
        if gw in finished
    ]

    player_n = sum(int((g.get("relevant") or {}).get("n") or 0) for g in gameweeks)
    team_n = sum(int(g.get("team_predictions_evaluated") or 0) for g in gameweeks)

    accuracy = {
        "gameweeks": gameweeks,
        "summary": {
            "model_version": MODEL_VERSION,
            "mode": "production",
            "gameweeks_scored": len(gameweeks),
            "last_scored_gw": max((g["gw"] for g in gameweeks), default=None),
            "cumulative_player_mae": weighted_average(
                gameweeks,
                lambda g: (g.get("relevant") or {}).get("mae"),
                lambda g: (g.get("relevant") or {}).get("n"),
            ),
            "cumulative_raw_player_mae": weighted_average(
                gameweeks,
                lambda g: (g.get("raw_relevant") or {}).get("mae"),
                lambda g: (g.get("raw_relevant") or {}).get("n"),
            ),
            "cumulative_team_mae": weighted_average(
                gameweeks,
                lambda g: g.get("team_mae"),
                lambda g: g.get("team_predictions_evaluated"),
            ),
            "cumulative_raw_team_mae": weighted_average(
                gameweeks,
                lambda g: g.get("raw_team_mae"),
                lambda g: g.get("team_predictions_evaluated"),
            ),
            "cumulative_mean_bias": weighted_average(
                gameweeks,
                lambda g: (g.get("relevant") or {}).get("bias"),
                lambda g: (g.get("relevant") or {}).get("n"),
            ),
            "player_predictions_evaluated": player_n,
            "team_predictions_evaluated": team_n,
            "updated_at_utc": datetime.now(timezone.utc).isoformat(),
            "first_eligible_gw": min((g["gw"] for g in gameweeks), default=None),
        },
    }

    write_json(ACCURACY_PATH, accuracy)
    print(accuracy["summary"])


if __name__ == "__main__":
    main()
