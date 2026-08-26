#!/usr/bin/env python3
import json
import math
import re
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://fantasy.premierleague.com/api"
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PRED_DIR = DATA / "predictions"

ENTRY_IDS = [
    113200, 119375, 114940, 139195, 131073,
    132558, 128817, 137607, 130090
]

MODEL_VERSION = "SZxP 2.1"

# Conservative positional priors used to shrink tiny early-season samples.
# They are not player ratings; observed xG/xA gradually takes over as minutes build.
PRIORS = {
    1: {"xg90": 0.005, "xa90": 0.010, "bonus90": 0.10},  # GK
    2: {"xg90": 0.055, "xa90": 0.060, "bonus90": 0.18},  # DEF
    3: {"xg90": 0.205, "xa90": 0.165, "bonus90": 0.25},  # MID
    4: {"xg90": 0.330, "xa90": 0.135, "bonus90": 0.28},  # FWD
}

GOAL_POINTS = {1: 6, 2: 6, 3: 5, 4: 4}
CS_POINTS = {1: 4, 2: 4, 3: 1, 4: 0}


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def num(v, default=0.0):
    try:
        if v in (None, ""):
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def get_json(path, retries=3):
    url = API + path
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 Fantaszy-Szentre/2.0",
        },
    )
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Failed {url}: {last}")


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    tmp.replace(path)


def read_json(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def parse_dt(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def get_context(events):
    now = datetime.now(timezone.utc)
    future = [e for e in events if e.get("deadline_time") and parse_dt(e["deadline_time"]) > now]
    next_event = min(future, key=lambda e: e["id"]) if future else None

    finished = [e for e in events if e.get("finished")]
    last_finished = max(finished, key=lambda e: e["id"]) if finished else None

    if next_event:
        next_events = [e for e in events if e["id"] >= next_event["id"]][:4]
        half_end = 19 if next_event["id"] <= 19 else 38
        first_half_events = [e for e in events if next_event["id"] <= e["id"] <= half_end]
    else:
        next_events = events[-4:]
        first_half_events = next_events

    published = last_finished["id"] if last_finished else max(1, (next_event["id"] - 1 if next_event else 1))
    return {
        "now": now,
        "next_event": next_event,
        "next_events": next_events,
        "first_half_events": first_half_events,
        "published_gw": published,
        "last_finished": last_finished,
    }


def team_games_played(team_id, fixtures):
    return sum(
        1 for f in fixtures
        if f.get("finished")
        and (f.get("team_h") == team_id or f.get("team_a") == team_id)
    )


def availability_factor(p):
    chance = p.get("chance_of_playing_next_round")
    if chance is not None:
        return clamp(num(chance) / 100.0, 0.0, 1.0)
    status = str(p.get("status") or "a")
    if status == "a":
        return 1.0
    if status in {"d"}:
        return 0.70
    if status in {"i", "s", "u"}:
        return 0.0
    return 0.85


def expected_minutes(p, games_played):
    starts = int(num(p.get("starts")))
    minutes = num(p.get("minutes"))
    avail = availability_factor(p)

    if games_played <= 0:
        # Early preseason/new-player fallback. ep_next is used only as weak evidence of role.
        ep = num(p.get("ep_next"))
        selected = num(p.get("selected_by_percent"))
        if ep >= 3.0:
            base = 78
        elif selected >= 5:
            base = 68
        else:
            base = 42
        return int(round(base * avail))

    start_rate = starts / max(1, games_played)

    if starts >= games_played:
        start_prob = 0.94 if games_played <= 3 else clamp(0.82 + 0.15 * start_rate, 0.82, 0.97)
    elif starts == 0:
        if minutes >= 45:
            start_prob = 0.38
        elif minutes > 0:
            start_prob = 0.20
        else:
            start_prob = 0.08
    else:
        # Smooth partial starter history.
        start_prob = clamp(0.10 + 0.82 * start_rate, 0.15, 0.92)

    avg_start_mins = 82.0
    if starts > 0:
        # Total minutes include any substitute appearances, so cap at 90.
        avg_start_mins = clamp(minutes / starts, 58, 90)

    cameo_mins = 14.0 if minutes > 0 else 8.0
    base = start_prob * avg_start_mins + (1 - start_prob) * cameo_mins

    # Very strong official next-GW expectation is a small role stabiliser, not the model itself.
    ep = num(p.get("ep_next"))
    if ep >= 4.5 and starts > 0:
        base = max(base, 80)
    elif ep >= 3.0 and starts > 0:
        base = max(base, 74)

    return int(round(clamp(base * avail, 0, 90)))


def shrink_rate(observed, prior, minutes, half_life=450):
    w = clamp(minutes / (minutes + half_life), 0, 0.82)
    return prior * (1 - w) + observed * w


def observed_per90(p, direct_key, total_key=None):
    direct = p.get(direct_key)
    if direct not in (None, ""):
        return num(direct)
    if total_key and num(p.get("minutes")) > 0:
        return num(p.get(total_key)) * 90 / num(p.get("minutes"))
    return 0.0


def player_rates(p):
    pos = int(p["element_type"])
    prior = PRIORS[pos]
    mins = num(p.get("minutes"))

    xg_obs = observed_per90(p, "expected_goals_per_90", "expected_goals")
    xa_obs = observed_per90(p, "expected_assists_per_90", "expected_assists")

    # Some API seasons expose only xGI/90 reliably. Use a position-aware split as fallback.
    if xg_obs <= 0 and xa_obs <= 0:
        xgi = observed_per90(p, "expected_goal_involvements_per_90", "expected_goal_involvements")
        if xgi > 0:
            split = {1: 0.20, 2: 0.45, 3: 0.57, 4: 0.72}[pos]
            xg_obs, xa_obs = xgi * split, xgi * (1 - split)

    bonus_obs = observed_per90(p, "bonus_per_90", "bonus")

    xg90 = shrink_rate(xg_obs, prior["xg90"], mins)
    xa90 = shrink_rate(xa_obs, prior["xa90"], mins)
    bonus90 = shrink_rate(bonus_obs, prior["bonus90"], mins, half_life=540)

    saves90 = 0.0
    if pos == 1:
        saves90 = observed_per90(p, "saves_per_90", "saves")
        # A neutral GK prior until enough sample exists.
        saves90 = shrink_rate(saves90, 3.0, mins, half_life=360)

    # Defensive-contribution field naming can change between FPL seasons.
    dc90 = 0.0
    for key in (
        "defensive_contribution_per_90",
        "defensive_contributions_per_90",
        "def_contribution_per_90",
    ):
        if p.get(key) not in (None, ""):
            dc90 = num(p.get(key))
            break

    return {
        "xg90": max(0, xg90),
        "xa90": max(0, xa90),
        "bonus90": max(0, bonus90),
        "saves90": max(0, saves90),
        "dc90": max(0, dc90),
    }


def team_strength_maps(teams):
    def avg(key):
        vals = [num(t.get(key), 1000) for t in teams]
        return sum(vals) / max(1, len(vals))

    keys = [
        "strength_attack_home", "strength_attack_away",
        "strength_defence_home", "strength_defence_away",
    ]
    avgs = {k: avg(k) for k in keys}
    return {t["id"]: t for t in teams}, avgs


def fixture_for_team(f, team_id):
    home = f["team_h"] == team_id
    return {
        "home": home,
        "opp": f["team_a"] if home else f["team_h"],
        "difficulty": f.get("team_h_difficulty") if home else f.get("team_a_difficulty"),
    }


def fixture_attack_multiplier(team_id, opp_id, home, team_map, avgs, difficulty):
    own = team_map[team_id]
    opp = team_map[opp_id]

    own_key = "strength_attack_home" if home else "strength_attack_away"
    opp_def_key = "strength_defence_away" if home else "strength_defence_home"

    own_attack = num(own.get(own_key), avgs[own_key]) / max(1, avgs[own_key])
    opp_def = num(opp.get(opp_def_key), avgs[opp_def_key]) / max(1, avgs[opp_def_key])

    strength = math.sqrt(max(0.35, own_attack) * max(0.35, 1 / max(0.45, opp_def)))
    fdr = {1: 1.14, 2: 1.07, 3: 1.00, 4: 0.93, 5: 0.86}.get(int(num(difficulty, 3)), 1.0)

    return clamp((0.72 * strength + 0.28 * fdr) * (1.025 if home else 0.985), 0.72, 1.34)


def clean_sheet_probability(team_id, opp_id, home, team_map, avgs, difficulty):
    own = team_map[team_id]
    opp = team_map[opp_id]

    own_def_key = "strength_defence_home" if home else "strength_defence_away"
    opp_att_key = "strength_attack_away" if home else "strength_attack_home"

    own_def = num(own.get(own_def_key), avgs[own_def_key]) / max(1, avgs[own_def_key])
    opp_att = num(opp.get(opp_att_key), avgs[opp_att_key]) / max(1, avgs[opp_att_key])

    base = 0.34 if home else 0.28
    ratio = max(0.40, own_def) / max(0.45, opp_att)
    p = base * (ratio ** 0.88)

    fdr_adj = {1: 1.15, 2: 1.08, 3: 1.00, 4: 0.91, 5: 0.82}.get(int(num(difficulty, 3)), 1.0)
    return clamp(p * fdr_adj, 0.07, 0.64)


def appearance_points(xmins):
    play_prob = clamp(xmins / 62.0, 0, 1)
    sixty_prob = clamp((xmins - 22) / 50.0, 0, 1)
    return play_prob + sixty_prob, sixty_prob


def defensive_contribution_points(pos, dc90, xmins):
    if dc90 <= 0 or pos == 1:
        return 0.0
    threshold = 10 if pos == 2 else 12
    expected = dc90 * xmins / 90.0
    # Smooth probability approximation around the FPL threshold.
    prob = 1 / (1 + math.exp(-(expected - threshold) / 2.25))
    return 2.0 * prob


def predict_fixture(p, f, xmins, rates, team_map, avgs):
    pos = int(p["element_type"])
    ctx = fixture_for_team(f, p["team"])
    home, opp, diff = ctx["home"], ctx["opp"], ctx["difficulty"]

    attack_mult = fixture_attack_multiplier(p["team"], opp, home, team_map, avgs, diff)
    pcs = clean_sheet_probability(p["team"], opp, home, team_map, avgs, diff)

    appearance, sixty_prob = appearance_points(xmins)
    minutes_share = xmins / 90.0

    goal = rates["xg90"] * minutes_share * attack_mult * GOAL_POINTS[pos]
    assist = rates["xa90"] * minutes_share * attack_mult * 3.0
    cs = pcs * CS_POINTS[pos] * sixty_prob

    saves = 0.0
    if pos == 1:
        saves = rates["saves90"] * minutes_share / 3.0
        # Small save-volume lift away / versus harder attacks.
        saves *= (1.04 if not home else 0.98) * ({1:0.90, 2:0.95, 3:1.0, 4:1.06, 5:1.12}.get(int(num(diff,3)), 1.0))

    bonus = rates["bonus90"] * minutes_share * (0.88 + 0.12 * attack_mult)
    defensive = defensive_contribution_points(pos, rates["dc90"], xmins)

    raw = appearance + goal + assist + cs + saves + bonus + defensive

    return {
        "raw": max(0.0, raw),
        "appearance": appearance,
        "goal": goal,
        "assist": assist,
        "clean_sheet": cs,
        "saves": saves,
        "bonus": bonus,
        "defensive": defensive,
        "attack_multiplier": attack_mult,
        "clean_sheet_probability": pcs,
        "home": home,
        "opponent": opp,
        "difficulty": diff,
    }


def confidence_label(p, xmins, games_played):
    avail = availability_factor(p)
    starts = int(num(p.get("starts")))
    if avail < 0.75 or xmins < 50:
        return "Low"
    if games_played >= 3 and starts / max(1, games_played) >= 0.8 and xmins >= 74:
        return "High"
    if xmins >= 76 and starts > 0:
        return "High"
    return "Medium"


def build_projections(bootstrap, fixtures, context):
    teams = bootstrap.get("teams", [])
    elements = bootstrap.get("elements", [])
    team_map, avgs = team_strength_maps(teams)

    planning_events = context.get("first_half_events") or context["next_events"]
    event_ids = [e["id"] for e in planning_events]
    fixtures_by_event = {
        event_id: [f for f in fixtures if f.get("event") == event_id]
        for event_id in event_ids
    }

    players = []

    for p in elements:
        games = team_games_played(p["team"], fixtures)
        xmins = expected_minutes(p, games)
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
                "appearance":0.0, "goal":0.0, "assist":0.0, "clean_sheet":0.0,
                "saves":0.0, "bonus":0.0, "defensive":0.0
            }
            labels = []

            for f in event_fixtures:
                pred = predict_fixture(p, f, xmins, rates, team_map, avgs)
                total += pred["raw"]
                for key in parts:
                    parts[key] += pred[key]
                opp = team_map[pred["opponent"]].get("short_name", str(pred["opponent"]))
                labels.append(("H " if pred["home"] else "A ") + opp)

            # Official FPL ep_next is only a calibration prior for the immediately upcoming GW.
            if horizon_idx == 0 and len(event_fixtures) == 1:
                ep = num(p.get("ep_next"))
                if ep > 0:
                    early_season = context["published_gw"] <= 3
                    official_weight = 0.38 if early_season else 0.25
                    total = (1 - official_weight) * total + official_weight * ep

            if availability_factor(p) <= 0:
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
        confidence = confidence_label(p, xmins, games)

        attack_component = 0.0
        if component_gw1:
            attack_component = component_gw1["goal"] + component_gw1["assist"] + component_gw1["bonus"]

        ceiling = round(xp[0] + 1.15 * math.sqrt(max(0.0, attack_component * 3.2)), 2)
        conf_factor = {"High":1.00, "Medium":0.97, "Low":0.90}[confidence]
        captain_score = round((0.82 * xp[0] + 0.18 * ceiling) * conf_factor, 2)
        price = max(3.5, num(p.get("now_cost")) / 10.0)
        value4 = round(total4 / price, 2)

        players.append({
            "id": p["id"],
            "web_name": p.get("web_name"),
            "team": p["team"],
            "element_type": p["element_type"],
            "xmins": xmins,
            "confidence": confidence,
            "xp": xp,
            "xp4": total4,
            "xp_first_half": xp_half,
            "ceiling_gw1": ceiling,
            "captain_score": captain_score,
            "value_4gw": value4,
            "fixtures": fixture_labels,
            "fixtures_first_half": fixture_labels_half,
            "rates": {k: round(v, 4) for k, v in rates.items()},
            "components_gw1": component_gw1 or {},
        })

    return {
        "model_version": MODEL_VERSION,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "next_event_ids": [e["id"] for e in context["next_events"]],
        "first_half_event_ids": event_ids,
        "published_gw": context["published_gw"],
        "players": players,
        "notes": [
            "Model estimates, not guarantees.",
            "SZxP 2.1 adds first-half projections for chip planning and transfer scenario analysis.",
            "SZxP uses xMins, shrunk xG/xA, FPL team attack/defence strength, venue, clean-sheet probability, saves, bonus and defensive-contribution data when exposed by the FPL API.",
            "Official FPL ep_next is used only as a calibration prior for the next Gameweek.",
            "Penalty and set-piece role bonuses are not added unless a role is independently verified."
        ]
    }


def build_gw1_backcast(bootstrap, fixtures):
    """Retrospective GW1 backcast.

    IMPORTANT: This is not a genuine pre-deadline forecast because it uses the
    current post-GW1 season data to estimate rates/xMins. It is useful as a
    model-fit diagnostic only. Genuine accuracy tracking begins with locked
    pre-deadline snapshots (GW2 onward for this project).
    """
    teams = bootstrap.get("teams", [])
    elements = bootstrap.get("elements", [])
    team_map, avgs = team_strength_maps(teams)
    gw1_fixtures = [f for f in fixtures if f.get("event") == 1]
    element_map = {p["id"]: p for p in elements}
    predicted = {}

    for p in elements:
        games = team_games_played(p["team"], fixtures)
        xmins = expected_minutes(p, games)
        rates = player_rates(p)
        fx = [f for f in gw1_fixtures if f.get("team_h") == p["team"] or f.get("team_a") == p["team"]]
        total = 0.0
        for f in fx:
            total += predict_fixture(p, f, xmins, rates, team_map, avgs)["raw"]
        if availability_factor(p) <= 0:
            total = 0.0
        predicted[p["id"]] = round(clamp(total, 0, 18 * max(1, len(fx))), 2)

    live = get_json("/event/1/live/")
    actual_player = {
        e["id"]: num(e.get("stats", {}).get("total_points"))
        for e in live.get("elements", [])
    }

    player_rows = []
    for pid, pred in predicted.items():
        p = element_map[pid]
        player_rows.append({
            "id": pid,
            "web_name": p.get("web_name"),
            "predicted": pred,
            "actual": actual_player.get(pid, 0.0),
            "delta": round(actual_player.get(pid, 0.0) - pred, 2),
        })

    relevant = [r for r in player_rows if r["predicted"] >= 1.5 or r["actual"] >= 3]
    mae = round(sum(abs(r["delta"]) for r in relevant) / max(1, len(relevant)), 3)

    teams_out = []
    for entry_id in ENTRY_IDS:
        try:
            picks = get_json(f"/entry/{entry_id}/event/1/picks/")
            model_points = 0.0
            player_detail = []
            for pick in picks.get("picks", []):
                pid = pick["element"]
                mult = num(pick.get("multiplier"))
                xp = predicted.get(pid, 0.0)
                model_points += xp * mult
                player_detail.append({
                    "element": pid,
                    "web_name": element_map.get(pid, {}).get("web_name"),
                    "multiplier": mult,
                    "szxp": xp,
                    "actual": actual_player.get(pid, 0.0),
                })
            actual = num(picks.get("entry_history", {}).get("points"))
            teams_out.append({
                "entry_id": entry_id,
                "retrospective_szxp": round(model_points, 2),
                "actual_points": actual,
                "actual_minus_szxp": round(actual - model_points, 2),
                "active_chip": picks.get("active_chip"),
                "players": player_detail,
            })
        except Exception as e:
            teams_out.append({"entry_id": entry_id, "error": str(e)})

    return {
        "model_version": MODEL_VERSION,
        "gameweek": 1,
        "type": "retrospective_backcast",
        "valid_for_accuracy": False,
        "warning": "Created after GW1 using post-GW1 player data. This contains hindsight leakage and must not be presented as a true pre-deadline prediction.",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "player_relevant_mae": mae,
        "teams": teams_out,
    }

def pearson(xs, ys):
    n = min(len(xs), len(ys))
    if n < 2:
        return None
    mx, my = sum(xs)/n, sum(ys)/n
    vx = sum((x-mx)**2 for x in xs)
    vy = sum((y-my)**2 for y in ys)
    if vx <= 0 or vy <= 0:
        return None
    cov = sum((x-mx)*(y-my) for x,y in zip(xs,ys))
    return cov / math.sqrt(vx*vy)


def score_prediction_gw(gw, snapshot):
    live = get_json(f"/event/{gw}/live/")
    actual_map = {
        e["id"]: num(e.get("stats", {}).get("total_points"))
        for e in live.get("elements", [])
    }
    rows = []
    for p in snapshot.get("players", []):
        pred = num((p.get("xp") or [0])[0])
        actual = actual_map.get(p["id"], 0.0)
        rows.append((p["id"], pred, actual))

    relevant = [r for r in rows if r[1] >= 1.5 or r[2] >= 3]
    top100 = sorted(rows, key=lambda r: r[1], reverse=True)[:100]

    def metrics(rows_):
        if not rows_:
            return {}
        errs = [abs(p-a) for _,p,a in rows_]
        signed = [p-a for _,p,a in rows_]
        xs = [p for _,p,a in rows_]
        ys = [a for _,p,a in rows_]
        return {
            "n": len(rows_),
            "mae": round(sum(errs)/len(errs), 3),
            "bias": round(sum(signed)/len(signed), 3),
            "within_2": round(sum(1 for e in errs if e <= 2)/len(errs), 4),
            "correlation": None if pearson(xs,ys) is None else round(pearson(xs,ys), 4),
        }

    return {
        "gw": gw,
        "model_version": snapshot.get("model_version"),
        "scored_at_utc": datetime.now(timezone.utc).isoformat(),
        "relevant": metrics(relevant),
        "top100": metrics(top100),
    }


def update_accuracy(context):
    accuracy_path = DATA / "accuracy.json"
    accuracy = read_json(accuracy_path, {"gameweeks": []})
    scored = {int(x["gw"]) for x in accuracy.get("gameweeks", [])}

    for snap_path in sorted(PRED_DIR.glob("gw*.json")):
        m = re.match(r"gw(\d+)\.json$", snap_path.name)
        if not m:
            continue
        gw = int(m.group(1))
        if gw > context["published_gw"] or gw in scored:
            continue
        try:
            snapshot = read_json(snap_path, {})
            score = score_prediction_gw(gw, snapshot)
            accuracy.setdefault("gameweeks", []).append(score)
            scored.add(gw)
        except Exception as e:
            print(f"Accuracy scoring warning GW{gw}: {e}")

    gws = accuracy.get("gameweeks", [])
    if gws:
        vals = [g["relevant"]["mae"] for g in gws if g.get("relevant", {}).get("mae") is not None]
        accuracy["summary"] = {
            "model_version": MODEL_VERSION,
            "gameweeks_scored": len(gws),
            "average_relevant_mae": round(sum(vals)/len(vals), 3) if vals else None,
            "last_scored_gw": max(g["gw"] for g in gws),
        }
    else:
        accuracy["summary"] = {
            "model_version": MODEL_VERSION,
            "gameweeks_scored": 0,
            "average_relevant_mae": None,
            "last_scored_gw": None,
        }

    write_json(accuracy_path, accuracy)


def maybe_snapshot_prediction(projections, context):
    nxt = context.get("next_event")
    if not nxt:
        return
    deadline = parse_dt(nxt["deadline_time"])
    now = context["now"]
    if now >= deadline:
        return

    PRED_DIR.mkdir(parents=True, exist_ok=True)
    # Overwrite until deadline. The last hourly run before deadline becomes the locked benchmark.
    snap = dict(projections)
    snap["snapshot_for_gw"] = nxt["id"]
    snap["deadline_time"] = nxt["deadline_time"]
    snap["snapshot_at_utc"] = datetime.now(timezone.utc).isoformat()
    write_json(PRED_DIR / f"gw{nxt['id']}.json", snap)


def main():
    DATA.mkdir(parents=True, exist_ok=True)

    bootstrap = get_json("/bootstrap-static/")
    fixtures = get_json("/fixtures/")
    context = get_context(bootstrap.get("events", []))
    gw = context["published_gw"]

    write_json(DATA / "bootstrap-static.json", bootstrap)
    write_json(DATA / "fixtures.json", fixtures)

    errors = []
    for entry_id in ENTRY_IDS:
        try:
            entry = get_json(f"/entry/{entry_id}/")
            history = get_json(f"/entry/{entry_id}/history/")
            transfers = get_json(f"/entry/{entry_id}/transfers/")
            picks = get_json(f"/entry/{entry_id}/event/{gw}/picks/")
            write_json(DATA / "entry" / f"{entry_id}.json", entry)
            write_json(DATA / "entry" / str(entry_id) / "history.json", history)
            write_json(DATA / "entry" / str(entry_id) / "transfers.json", transfers)
            write_json(DATA / "entry" / str(entry_id) / "event" / str(gw) / "picks.json", picks)
        except Exception as e:
            errors.append({"entry_id": entry_id, "error": str(e)})
            print(f"Warning: {entry_id}: {e}")

    projections = build_projections(bootstrap, fixtures, context)
    write_json(DATA / "szxp.json", projections)
    maybe_snapshot_prediction(projections, context)
    update_accuracy(context)

    # GW1 is a transparent retrospective fit check only. Genuine locked
    # prediction accuracy starts with the first pre-deadline snapshot.
    try:
        gw1_backcast = build_gw1_backcast(bootstrap, fixtures)
        write_json(DATA / "backtests" / "gw1.json", gw1_backcast)
    except Exception as e:
        print(f"GW1 backcast warning: {e}")

    meta = {
        "updated_at_utc": datetime.now(timezone.utc).isoformat(),
        "published_gw": gw,
        "next_gw": context["next_event"]["id"] if context.get("next_event") else None,
        "model_version": MODEL_VERSION,
        "entry_ids": ENTRY_IDS,
        "errors": errors,
    }
    write_json(DATA / "meta.json", meta)
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
