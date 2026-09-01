#!/usr/bin/env python3
"""
Genuine out-of-sample accuracy tracking for SZxP 2.2 Challenger.

Only pre-deadline snapshots in data/predictions-2.2/ are eligible.
Therefore GW2 can never be scored as 2.2 if 2.2 did not exist before GW2.
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

PRED_DIR_22 = DATA / "predictions-2.2"
ACCURACY_PATH = DATA / "accuracy-2.2.json"
MODEL_VERSION = "SZxP 2.2 Challenger"

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

    rows = []
    for p in snapshot.get("players", []):
        pred = num((p.get("xp") or [0])[0])
        act = actual.get(int(p["id"]), 0.0)
        rows.append((int(p["id"]), pred, act))

    relevant = [r for r in rows if r[1] >= 1.5 or r[2] >= 3]
    top100 = sorted(rows, key=lambda r: r[1], reverse=True)[:100]
    return metrics(relevant), metrics(top100)


def score_teams(gw, snapshot):
    xp_map = {
        int(p["id"]): num((p.get("xp") or [0])[0])
        for p in snapshot.get("players", [])
    }

    teams = []
    for entry_id in ENTRY_IDS:
        try:
            picks = get_json(f"/entry/{entry_id}/event/{gw}/picks/")
            expected = 0.0
            for pick in picks.get("picks", []):
                expected += (
                    xp_map.get(int(pick["element"]), 0.0)
                    * num(pick.get("multiplier"))
                )

            history = picks.get("entry_history", {}) or {}
            actual = num(history.get("points"))
            teams.append({
                "entry_id": entry_id,
                "team_name": TEAM_NAMES.get(entry_id, str(entry_id)),
                "locked_szxp": round(expected, 2),
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
        t for t in teams
        if "locked_szxp" in t and "actual_points" in t
    ]
    mae = None
    if valid:
        mae = round(
            sum(abs(t["actual_points"] - t["locked_szxp"]) for t in valid)
            / len(valid),
            3,
        )
    return teams, mae, len(valid)


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
        int(x["gw"]): x
        for x in accuracy.get("gameweeks", [])
    }

    if PRED_DIR_22.exists():
        for snap_path in sorted(PRED_DIR_22.glob("gw*.json")):
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
                relevant, top100 = score_players(gw, snapshot)
                teams, team_mae, team_n = score_teams(gw, snapshot)
                existing[gw] = {
                    "gw": gw,
                    "model_version": snapshot.get("model_version") or MODEL_VERSION,
                    "scored_at_utc": datetime.now(timezone.utc).isoformat(),
                    "locked_snapshot_at_utc": (
                        snapshot.get("snapshot_at_utc")
                        or snapshot.get("generated_at_utc")
                    ),
                    "deadline_time": snapshot.get("deadline_time"),
                    "relevant": relevant,
                    "top100": top100,
                    "team_mae": team_mae,
                    "team_predictions_evaluated": team_n,
                    "teams": teams,
                }
            except Exception as exc:
                print(f"2.2 accuracy warning GW{gw}: {exc}")

    gameweeks = [
        existing[gw]
        for gw in sorted(existing)
        if gw in finished and gw >= 2
    ]

    player_n = sum(int((g.get("relevant") or {}).get("n") or 0) for g in gameweeks)
    team_n = sum(int(g.get("team_predictions_evaluated") or 0) for g in gameweeks)

    player_mae = weighted_average(
        gameweeks,
        lambda g: (g.get("relevant") or {}).get("mae"),
        lambda g: (g.get("relevant") or {}).get("n"),
    )
    bias = weighted_average(
        gameweeks,
        lambda g: (g.get("relevant") or {}).get("bias"),
        lambda g: (g.get("relevant") or {}).get("n"),
    )
    team_mae = weighted_average(
        gameweeks,
        lambda g: g.get("team_mae"),
        lambda g: g.get("team_predictions_evaluated"),
    )

    accuracy = {
        "gameweeks": gameweeks,
        "summary": {
            "model_version": MODEL_VERSION,
            "mode": "challenger_shadow",
            "gameweeks_scored": len(gameweeks),
            "last_scored_gw": max((g["gw"] for g in gameweeks), default=None),
            "cumulative_player_mae": player_mae,
            "cumulative_team_mae": team_mae,
            "cumulative_mean_bias": bias,
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
