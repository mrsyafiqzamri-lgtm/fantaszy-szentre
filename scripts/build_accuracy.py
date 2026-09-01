#!/usr/bin/env python3
from datetime import datetime, timezone

from update_fpl_data import (
    DATA,
    PRED_DIR,
    ENTRY_IDS,
    get_json,
    read_json,
    write_json,
    num,
)

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


def locked_player_xp(snapshot):
    out = {}
    for p in snapshot.get("players", []):
        xp = p.get("xp") or [0]
        out[int(p["id"])] = num(xp[0])
    return out


def enrich_gameweek(gw_row):
    gw = int(gw_row["gw"])
    snap_path = PRED_DIR / f"gw{gw}.json"
    snapshot = read_json(snap_path, {})
    if not snapshot:
        gw_row["team_mae"] = None
        gw_row["teams"] = []
        gw_row["team_predictions_evaluated"] = 0
        gw_row["team_projection_note"] = (
            "No locked pre-deadline snapshot exists for this Gameweek."
        )
        return gw_row

    xp_map = locked_player_xp(snapshot)
    teams = []

    for entry_id in ENTRY_IDS:
        try:
            # These picks only become public after the deadline, but they are the
            # immutable lineup/captain/chip selections that were locked at deadline.
            picks = get_json(f"/entry/{entry_id}/event/{gw}/picks/")
            expected = 0.0
            for pick in picks.get("picks", []):
                expected += (
                    xp_map.get(int(pick["element"]), 0.0)
                    * num(pick.get("multiplier"))
                )

            hist = picks.get("entry_history", {}) or {}
            actual = num(hist.get("points"))
            transfer_cost = num(hist.get("event_transfers_cost"))

            teams.append({
                "entry_id": entry_id,
                "team_name": TEAM_NAMES.get(entry_id, str(entry_id)),
                "locked_szxp": round(expected, 2),
                "actual_points": round(actual, 2),
                "actual_minus_szxp": round(actual - expected, 2),
                "active_chip": picks.get("active_chip"),
                "transfer_cost": round(transfer_cost, 2),
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
    team_mae = None
    if valid:
        team_mae = round(
            sum(
                abs(t["actual_points"] - t["locked_szxp"])
                for t in valid
            ) / len(valid),
            3,
        )

    gw_row["teams"] = teams
    gw_row["team_mae"] = team_mae
    gw_row["team_predictions_evaluated"] = len(valid)
    gw_row["locked_snapshot_at_utc"] = (
        snapshot.get("snapshot_at_utc")
        or snapshot.get("generated_at_utc")
    )
    gw_row["deadline_time"] = snapshot.get("deadline_time")
    gw_row["team_projection_note"] = (
        "Team SZxP uses the pre-deadline locked player projection snapshot "
        "applied to the FPL picks that became public after the deadline. "
        "No post-match player projection data is used."
    )
    return gw_row


def weighted_metric(rows, metric, n_key):
    pairs = []
    for row in rows:
        value = row.get(metric)
        n = row.get(n_key)
        if value is None or not n:
            continue
        pairs.append((float(value), int(n)))
    if not pairs:
        return None
    total_n = sum(n for _, n in pairs)
    return round(
        sum(value * n for value, n in pairs) / total_n,
        3,
    )


def main():
    accuracy_path = DATA / "accuracy.json"
    accuracy = read_json(accuracy_path, {"gameweeks": []})
    bootstrap = read_json(DATA / "bootstrap-static.json", {})

    # This is the automatic confirmation gate:
    # a GW is only eligible when Official FPL marks event.finished == true.
    finished = {
        int(e["id"])
        for e in bootstrap.get("events", [])
        if e.get("finished") is True
    }

    genuine = []
    for row in sorted(
        accuracy.get("gameweeks", []),
        key=lambda x: int(x.get("gw", 0)),
    ):
        gw = int(row.get("gw", 0))
        if gw < 2 or gw not in finished:
            continue
        genuine.append(enrich_gameweek(row))

    accuracy["gameweeks"] = genuine

    player_n = sum(
        int((g.get("relevant") or {}).get("n") or 0)
        for g in genuine
    )
    team_n = sum(
        int(g.get("team_predictions_evaluated") or 0)
        for g in genuine
    )

    cumulative_player_mae = weighted_metric(
        [{
            "value": (g.get("relevant") or {}).get("mae"),
            "n": (g.get("relevant") or {}).get("n"),
        } for g in genuine],
        "value",
        "n",
    )
    cumulative_bias = weighted_metric(
        [{
            "value": (g.get("relevant") or {}).get("bias"),
            "n": (g.get("relevant") or {}).get("n"),
        } for g in genuine],
        "value",
        "n",
    )
    cumulative_team_mae = weighted_metric(
        [{
            "value": g.get("team_mae"),
            "n": g.get("team_predictions_evaluated"),
        } for g in genuine],
        "value",
        "n",
    )

    latest = max(
        (int(g["gw"]) for g in genuine),
        default=None,
    )
    latest_model = None
    if latest is not None:
        latest_row = next(
            g for g in genuine
            if int(g["gw"]) == latest
        )
        latest_model = latest_row.get("model_version")

    accuracy["summary"] = {
        "model_version": latest_model or "SZxP 2.1",
        "gameweeks_scored": len(genuine),
        "last_scored_gw": latest,
        "latest_completed_gw": latest,
        "cumulative_player_mae": cumulative_player_mae,
        "cumulative_team_mae": cumulative_team_mae,
        "cumulative_mean_bias": cumulative_bias,
        "player_predictions_evaluated": player_n,
        "team_predictions_evaluated": team_n,
        "updated_at_utc": datetime.now(timezone.utc).isoformat(),
    }

    write_json(accuracy_path, accuracy)


if __name__ == "__main__":
    main()
