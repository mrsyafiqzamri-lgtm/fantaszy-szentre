#!/usr/bin/env python3
"""
Build lightweight browser bundles for Fantaszy Szentre personal owner app.

Why this exists
---------------
The model/workflow still keeps the full official FPL bootstrap and model JSONs
for analytics, backtesting and future rebuilds. The browser does not need all
of those fields on every open. This script creates two compact files:

- data/web-core.json   -> global player/model/fixture data used by the UI
- data/portfolio.json  -> all nine owner teams in one request, with a canonical
                          permanent squad reconstructed across Free Hit and
                          already-made current/future transfers.

The important trust rule is that a Free Hit squad is never allowed to become
next-Gameweek planning ownership. We restore the last permanent squad, then
apply only permanent transfers made after that baseline (including transfers
for the current upcoming Gameweek when the FPL transfer history already shows
them). Wildcard transfers are permanent and therefore remain applied.
"""

from __future__ import annotations

import copy
from datetime import datetime, timezone
from pathlib import Path

from update_fpl_data import DATA, ENTRY_IDS, read_json, write_json

ROOT = Path(__file__).resolve().parents[1]

PLAYER_FIELDS = [
    "id", "first_name", "second_name", "web_name", "team", "element_type",
    "now_cost", "selected_by_percent", "transfers_in_event",
    "transfers_out_event", "status", "news", "chance_of_playing_next_round",
    "ep_next", "points_per_game", "minutes", "cost_change_start",
]

MODEL_PLAYER_FIELDS = [
    "id", "model_version", "xp", "xp4", "xmins", "ceiling_gw1",
    "captain_score", "captain_sentre", "captain_eligible", "lineup_score",
    "sentre_score", "sentre_label", "fixture_quality_score",
    "minutes_security_score", "risk_score", "role_set_pieces_score",
    "sentre_components", "captain_components", "lineup_components",
    "confidence", "value_4gw", "fixtures", "fixtures_first_half",
    "xp_first_half", "components_gw1",
]

TEAM_FIELDS = [
    "id", "name", "short_name", "strength_attack_home",
    "strength_attack_away", "strength_defence_home", "strength_defence_away",
]

EVENT_FIELDS = ["id", "name", "deadline_time", "finished"]
FIXTURE_FIELDS = ["id", "event", "kickoff_time", "team_h", "team_a"]


def keep(obj, fields):
    return {k: obj.get(k) for k in fields if k in obj}


def chip_key(value):
    text = str(value or "").lower().replace("_", "").replace("-", "")
    if "free" in text and "hit" in text:
        return "FH"
    if "wildcard" in text:
        return "WC"
    if text in {"3xc", "triplecaptain", "triplecaptainchip"}:
        return "TC"
    if text in {"bboost", "benchboost"}:
        return "BB"
    return text.upper()


def free_hit_events(history):
    return {
        int(c.get("event") or 0)
        for c in (history or {}).get("chips", [])
        if chip_key(c.get("name") or c.get("chip")) == "FH"
    }


def wildcard_events(history):
    return {
        int(c.get("event") or 0)
        for c in (history or {}).get("chips", [])
        if chip_key(c.get("name") or c.get("chip")) == "WC"
    }


def valid_picks(payload):
    return isinstance(payload, dict) and len(payload.get("picks") or []) == 15


def picks_path(entry_id, gw):
    return DATA / "entry" / str(entry_id) / "event" / str(gw) / "picks.json"


def find_canonical_base(entry_id, published_gw, history):
    """Return (base_gw, payload, reverted_free_hit_event_or_none)."""
    current = read_json(picks_path(entry_id, published_gw), {})
    if not valid_picks(current):
        return None, None, None

    fh_events = free_hit_events(history)
    current_is_fh = (
        int(published_gw) in fh_events
        or chip_key(current.get("active_chip")) == "FH"
    )
    if not current_is_fh:
        return int(published_gw), current, None

    for gw in range(int(published_gw) - 1, 0, -1):
        if gw in fh_events:
            continue
        prior = read_json(picks_path(entry_id, gw), {})
        if valid_picks(prior) and chip_key(prior.get("active_chip")) != "FH":
            return gw, prior, int(published_gw)

    return None, None, int(published_gw)


def selling_price(purchase, now_cost):
    purchase = int(purchase or 0)
    current = int(now_cost or 0)
    if purchase <= 0:
        return current
    if current <= 0:
        return purchase
    if current <= purchase:
        return current
    return purchase + (current - purchase) // 2


def transfer_time_key(row):
    return str(row.get("time") or "")


def reconstruct_team(entry_id, published_gw, next_gw, bootstrap):
    entry = read_json(DATA / "entry" / f"{entry_id}.json", {})
    history = read_json(DATA / "entry" / str(entry_id) / "history.json", {})
    transfers = read_json(DATA / "entry" / str(entry_id) / "transfers.json", []) or []

    base_gw, base_payload, reverted_fh = find_canonical_base(
        entry_id, published_gw, history
    )
    if not base_gw or not valid_picks(base_payload):
        return {
            "entry": entry,
            "history": history,
            "transfers": transfers,
            "picks": None,
            "squad_source": {
                "ok": False,
                "reason": "CANONICAL_SQUAD_UNAVAILABLE",
                "published_gw": published_gw,
                "next_gw": next_gw,
            },
        }

    payload = copy.deepcopy(base_payload)
    picks = payload["picks"]
    by_id = {int(p["id"]): p for p in bootstrap.get("elements", [])}
    names = {int(p["id"]): p.get("web_name") or str(p["id"]) for p in bootstrap.get("elements", [])}
    fh_events = free_hit_events(history)
    wc_events = wildcard_events(history)

    # Apply every permanent transfer after the canonical base through the
    # upcoming Gameweek. This is what makes the personal owner view reflect
    # already-made transfers even when the latest picks endpoint is still an
    # older locked or temporary Free Hit squad.
    relevant = [
        t for t in transfers
        if base_gw < int(t.get("event") or 0) <= int(next_gw or base_gw)
        and int(t.get("event") or 0) not in fh_events
    ]
    relevant.sort(key=lambda t: (int(t.get("event") or 0), transfer_time_key(t)))

    bank = int((payload.get("entry_history") or {}).get("bank") or 0)
    applied = []

    for tr in relevant:
        out_id = int(tr.get("element_out") or 0)
        in_id = int(tr.get("element_in") or 0)
        if not out_id or not in_id:
            continue

        idx = next((i for i, pk in enumerate(picks) if int(pk.get("element") or 0) == out_id), None)
        if idx is None:
            # A chained transfer can occasionally reference a player already
            # replaced earlier in the same event. If we cannot reconcile the
            # ownership sequence, do not invent a squad mutation.
            continue

        out_cost = int(tr.get("element_out_cost") or picks[idx].get("selling_price") or 0)
        in_cost = int(tr.get("element_in_cost") or by_id.get(in_id, {}).get("now_cost") or 0)
        bank += out_cost - in_cost

        old = picks[idx]
        picks[idx] = {
            **old,
            "element": in_id,
            "purchase_price": in_cost,
            "selling_price": in_cost,
            "multiplier": 1,
            "is_captain": False,
            "is_vice_captain": False,
        }

        applied.append({
            "event": int(tr.get("event") or 0),
            "element_out": out_id,
            "element_in": in_id,
            "out": names.get(out_id, str(out_id)),
            "in": names.get(in_id, str(in_id)),
            "time": tr.get("time"),
        })

    # Refresh current selling prices for every permanent owned player.
    squad_value = 0
    for pk in picks:
        pid = int(pk.get("element") or 0)
        now_cost = int(by_id.get(pid, {}).get("now_cost") or pk.get("selling_price") or 0)
        sp = selling_price(pk.get("purchase_price"), now_cost)
        pk["selling_price"] = sp
        squad_value += sp

    payload["active_chip"] = None
    payload["entry_history"] = {
        **(payload.get("entry_history") or {}),
        "bank": max(0, bank),
        "value": squad_value + max(0, bank),
        "event_transfers": 0,
        "event_transfers_cost": 0,
    }

    latest_applied_event = max((x["event"] for x in applied), default=base_gw)
    source = {
        "ok": True,
        "published_gw": int(published_gw),
        "next_gw": int(next_gw or 0),
        "base_gw": int(base_gw),
        "free_hit_reverted": reverted_fh is not None,
        "free_hit_event": reverted_fh,
        "applied_transfer_count": len(applied),
        "latest_transfer_event": int(latest_applied_event),
        "applied_moves": applied,
        "wildcard_events": sorted(wc_events),
        "strategy": "last permanent picks + permanent transfer history",
    }

    return {
        "entry": entry,
        "history": history,
        "transfers": transfers,
        "picks": payload,
        "squad_source": source,
    }


def build_web_core():
    bootstrap = read_json(DATA / "bootstrap-static.json", {}) or {}
    fixtures = read_json(DATA / "fixtures.json", []) or []
    projections = read_json(DATA / "szxp.json", {}) or {}
    meta = read_json(DATA / "meta.json", {}) or {}

    next_gw = int(meta.get("next_gw") or 0)
    if next_gw:
        keep_fixture_events = set(range(next_gw, min(38, next_gw + 3) + 1))
        slim_fixtures = [
            keep(f, FIXTURE_FIELDS)
            for f in fixtures
            if int(f.get("event") or 0) in keep_fixture_events
        ]
    else:
        slim_fixtures = [keep(f, FIXTURE_FIELDS) for f in fixtures[-40:]]

    core = {
        "bundle_version": "20260913-webbundle1",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "bootstrap": {
            "events": [keep(e, EVENT_FIELDS) for e in bootstrap.get("events", [])],
            "teams": [keep(t, TEAM_FIELDS) for t in bootstrap.get("teams", [])],
            "element_types": bootstrap.get("element_types", []),
            "total_players": bootstrap.get("total_players"),
            "elements": [keep(p, PLAYER_FIELDS) for p in bootstrap.get("elements", [])],
        },
        "fixtures": slim_fixtures,
        "projectionData": {
            "model_version": projections.get("model_version"),
            "first_half_event_ids": projections.get("first_half_event_ids", []),
            "players": [keep(p, MODEL_PLAYER_FIELDS) for p in projections.get("players", [])],
        },
        "meta": meta,
    }
    write_json(DATA / "web-core.json", core)
    return bootstrap, meta, core


def build_portfolio(bootstrap, meta):
    published_gw = int(meta.get("published_gw") or 0)
    next_gw = int(meta.get("next_gw") or (published_gw + 1))

    teams = {}
    for entry_id in ENTRY_IDS:
        teams[str(entry_id)] = reconstruct_team(
            int(entry_id), published_gw, next_gw, bootstrap
        )

    payload = {
        "bundle_version": "20260913-portfolio1",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "published_gw": published_gw,
        "next_gw": next_gw,
        "teams": teams,
    }
    write_json(DATA / "portfolio.json", payload)
    return payload


def main():
    bootstrap, meta, core = build_web_core()
    portfolio = build_portfolio(bootstrap, meta)
    print({
        "web_core_players": len(core["bootstrap"]["elements"]),
        "web_core_fixtures": len(core["fixtures"]),
        "portfolio_teams": len(portfolio["teams"]),
        "published_gw": portfolio["published_gw"],
        "next_gw": portfolio["next_gw"],
    })


if __name__ == "__main__":
    main()
