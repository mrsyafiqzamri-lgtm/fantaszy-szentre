#!/usr/bin/env python3
"""
Szentre Lineup Intelligence Collector
=====================================

Zero-key, fail-safe pre-deadline collector for SZxP 2.2.

Automatic sources:
- Google News RSS search, one query per current Premier League club
- BBC Sport Premier League RSS

Only trusted/known publications are allowed to affect the model automatically.
Unknown sources are written to intel-candidates.json for audit but are NOT fed
to SZxP 2.2.

Trusted social-media / reporter information can be entered in
data/intelligence/manual-signals.json. Manual signals are merged into the same
lineup-intel.json consumed by build_szxp22.py.

Important:
- Signals are Gameweek-scoped.
- News is filtered to recent pre-deadline items.
- Player names must be mentioned close to a directional lineup/fitness phrase.
- The collector never rewrites historical prediction snapshots.
"""

from __future__ import annotations

import html
import json
import re
import time
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
INTEL = DATA / "intelligence"
BOOTSTRAP_PATH = DATA / "bootstrap-static.json"
OUTPUT_PATH = INTEL / "lineup-intel.json"
MANUAL_PATH = INTEL / "manual-signals.json"
CANDIDATES_PATH = INTEL / "intel-candidates.json"
META_PATH = INTEL / "collector-meta.json"

BBC_PL_RSS = "https://feeds.bbci.co.uk/sport/football/premier-league/rss.xml"
GOOGLE_NEWS_SEARCH = "https://news.google.com/rss/search"

USER_AGENT = (
    "Mozilla/5.0 (compatible; FantaszySzentreIntel/1.0; "
    "+https://github.com/mrsyafiqzamri-lgtm/fantaszy-szentre)"
)

MAX_AGE_HOURS = 48
REQUEST_TIMEOUT = 12

# Publication-level source policy. Unknown sources do not affect xMins.
TIER_B = (
    "bbc sport",
    "sky sports",
    "the athletic",
    "reuters",
    "associated press",
    "the guardian",
    "the telegraph",
    "the independent",
    "evening standard",
    "espn",
)
TIER_C = (
    "fantasy football scout",
    "talksport",
    "football365",
)

# Phrase score, direction, target start probability, specificity.
PHRASES = [
    # Strong negative
    ("not expected to start", "strong_negative", 0.08, 1.00),
    ("expected to be benched", "strong_negative", 0.08, 1.00),
    ("set to be benched", "strong_negative", 0.08, 1.00),
    ("ruled out", "strong_negative", 0.02, 1.00),
    ("will miss", "strong_negative", 0.03, 1.00),
    ("set to miss", "strong_negative", 0.03, 1.00),
    ("not available", "strong_negative", 0.03, 1.00),
    ("unavailable", "strong_negative", 0.03, 1.00),
    ("suspended", "strong_negative", 0.02, 1.00),
    ("dropped to the bench", "strong_negative", 0.08, 1.00),
    ("dropped from the side", "strong_negative", 0.08, 1.00),
    ("fails fitness test", "strong_negative", 0.05, 1.00),
    # Normal negative
    ("could miss", "negative", 0.30, 0.90),
    ("may miss", "negative", 0.34, 0.88),
    ("major doubt", "negative", 0.25, 0.92),
    ("doubtful", "negative", 0.34, 0.88),
    ("injury doubt", "negative", 0.32, 0.90),
    ("fitness doubt", "negative", 0.34, 0.90),
    ("fitness concern", "negative", 0.42, 0.82),
    ("injury concern", "negative", 0.42, 0.82),
    ("rotation risk", "negative", 0.46, 0.86),
    ("touch and go", "negative", 0.44, 0.84),
    ("late fitness test", "negative", 0.46, 0.84),
    ("picked up a knock", "negative", 0.52, 0.76),
    ("carrying a knock", "negative", 0.48, 0.78),
    ("illness", "negative", 0.48, 0.75),
    # Strong positive
    ("expected to start", "strong_positive", 0.94, 1.00),
    ("set to start", "strong_positive", 0.94, 1.00),
    ("will start", "strong_positive", 0.96, 1.00),
    ("passed fit", "strong_positive", 0.90, 0.96),
    ("cleared to play", "strong_positive", 0.90, 0.96),
    # Normal positive
    ("back in training", "positive", 0.80, 0.84),
    ("available for selection", "positive", 0.84, 0.90),
    ("available again", "positive", 0.82, 0.86),
    ("declared fit", "positive", 0.88, 0.92),
    ("fit to play", "positive", 0.86, 0.90),
    ("returns to training", "positive", 0.78, 0.82),
    ("return to training", "positive", 0.78, 0.82),
    ("recovered", "positive", 0.80, 0.80),
]


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def utcnow():
    return datetime.now(timezone.utc)


def parse_iso(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


def normalize(text):
    text = html.unescape(str(text or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower()
    text = re.sub(r"[^a-z0-9' -]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def fetch_bytes(url):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/rss+xml, application/xml, text/xml, */*",
        },
    )
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as response:
        return response.read()


def parse_pubdate(value):
    if not value:
        return None
    try:
        dt = parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return parse_iso(value)


def rss_items(xml_bytes, feed_label):
    root = ET.fromstring(xml_bytes)
    rows = []
    for item in root.findall(".//item"):
        def txt(tag):
            node = item.find(tag)
            return (node.text or "").strip() if node is not None and node.text else ""

        source_node = item.find("source")
        source = (
            (source_node.text or "").strip()
            if source_node is not None and source_node.text
            else feed_label
        )
        rows.append({
            "title": txt("title"),
            "description": txt("description"),
            "link": txt("link"),
            "published_at": parse_pubdate(txt("pubDate")),
            "source": source,
            "feed": feed_label,
        })
    return rows


def current_target_event(events):
    now = utcnow()
    future = []
    for e in events:
        deadline = parse_iso(e.get("deadline_time"))
        if deadline and deadline > now:
            future.append((deadline, e))
    if future:
        return sorted(future, key=lambda x: x[0])[0][1]
    return None


def team_search_name(team):
    # FPL's current team name is generally the cleanest search term.
    return str(team.get("name") or team.get("short_name") or "").strip()


def source_tier(source, team_name):
    s = normalize(source)
    team = normalize(team_name)

    # Official club publication / Premier League source.
    official_variants = {
        team,
        f"{team} fc",
        f"{team} football club",
        "premier league",
    }
    if s in official_variants:
        return "A"

    if any(x in s for x in TIER_B):
        return "B"
    if any(x in s for x in TIER_C):
        return "C"
    return "D"


def player_aliases(player):
    raw = [
        player.get("web_name"),
        player.get("second_name"),
        f"{player.get('first_name', '')} {player.get('second_name', '')}",
    ]
    out = []
    for alias in raw:
        n = normalize(alias)
        if len(n) < 4:
            continue
        if n not in out:
            out.append(n)
    return sorted(out, key=len, reverse=True)


def alias_match(text, alias):
    return re.search(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", text)


def local_window(text, match, radius=150):
    start = max(0, match.start() - radius)
    end = min(len(text), match.end() + radius)
    return text[start:end]


def infer_direction(window):
    hits = []
    for phrase, direction, start_prob, specificity in PHRASES:
        pos = window.find(phrase)
        if pos >= 0:
            # Favour phrases closest to the player mention, then stronger specificity.
            distance_penalty = min(0.20, abs(pos - len(window) / 2) / 1000)
            score = specificity - distance_penalty
            hits.append((score, phrase, direction, start_prob, specificity))

    if not hits:
        return None

    hits.sort(reverse=True)
    best = hits[0]

    # If equally strong contradictory evidence appears in the same small window,
    # do not create an automatic signal.
    polarity = lambda d: -1 if "negative" in d else 1
    for other in hits[1:]:
        if polarity(other[2]) != polarity(best[2]) and abs(other[0] - best[0]) < 0.06:
            return None

    _, phrase, direction, start_prob, specificity = best
    return {
        "phrase": phrase,
        "direction": direction,
        "start_probability": start_prob,
        "specificity": specificity,
    }


def article_to_signals(article, team, players, target_gw, deadline, now):
    published = article.get("published_at")
    if not published:
        return [], []

    if published > now + timedelta(minutes=5):
        return [], []
    if now - published > timedelta(hours=MAX_AGE_HOURS):
        return [], []

    text = normalize(f"{article.get('title', '')} {article.get('description', '')}")
    if not text:
        return [], []

    tier = source_tier(article.get("source"), team.get("name"))
    accepted = []
    candidates = []

    for player in players:
        best_player_signal = None
        for alias in player_aliases(player):
            match = alias_match(text, alias)
            if not match:
                continue
            inferred = infer_direction(local_window(text, match))
            if not inferred:
                continue

            signal = {
                "gameweek": int(target_gw),
                "player_id": int(player["id"]),
                "player_name": player.get("web_name"),
                "source_tier": tier,
                "source_type": "public_news_rss",
                "source_name": article.get("source"),
                "published_at_utc": published.isoformat(),
                "observed_at_utc": now.isoformat(),
                "expires_at_utc": deadline.isoformat() if deadline else None,
                "direction": inferred["direction"],
                "start_probability": inferred["start_probability"],
                "specificity": inferred["specificity"],
                "corroborating_sources": 1,
                "note": (
                    f"{inferred['phrase']} · "
                    f"{re.sub(r'<[^>]+>', ' ', article.get('title', '')).strip()}"
                )[:320],
                "url": article.get("link"),
            }

            if (
                best_player_signal is None
                or signal["specificity"] > best_player_signal["specificity"]
            ):
                best_player_signal = signal

        if best_player_signal:
            if tier in {"A", "B", "C"}:
                accepted.append(best_player_signal)
            else:
                candidates.append(best_player_signal)

    return accepted, candidates


def deduplicate(signals):
    # Same publication may publish/update multiple near-identical stories.
    # Keep only its latest strongest signal per player + direction polarity.
    def polarity(direction):
        return "negative" if "negative" in str(direction) else "positive"

    best = {}
    for s in signals:
        key = (
            int(s.get("player_id", 0)),
            normalize(s.get("source_name")),
            polarity(s.get("direction")),
        )
        prev = best.get(key)
        if not prev:
            best[key] = s
            continue

        cur_spec = float(s.get("specificity") or 0)
        old_spec = float(prev.get("specificity") or 0)
        cur_dt = parse_iso(s.get("published_at_utc")) or datetime.min.replace(tzinfo=timezone.utc)
        old_dt = parse_iso(prev.get("published_at_utc")) or datetime.min.replace(tzinfo=timezone.utc)

        if (cur_spec, cur_dt) > (old_spec, old_dt):
            best[key] = s

    return list(best.values())


def manual_signals(target_gw, deadline, now):
    payload = read_json(MANUAL_PATH, {"signals": []})
    out = []
    for raw in payload.get("signals", []):
        gw = raw.get("gameweek")
        if gw not in (None, "") and int(gw) != int(target_gw):
            continue

        signal = dict(raw)
        signal["gameweek"] = int(target_gw)
        signal["source_type"] = signal.get("source_type") or "manual_trusted_intel"
        signal["source_tier"] = str(signal.get("source_tier") or "B").upper()
        signal["observed_at_utc"] = signal.get("observed_at_utc") or now.isoformat()
        signal["published_at_utc"] = signal.get("published_at_utc") or signal["observed_at_utc"]
        signal["expires_at_utc"] = signal.get("expires_at_utc") or (
            deadline.isoformat() if deadline else None
        )
        signal["corroborating_sources"] = max(
            1, int(signal.get("corroborating_sources") or 1)
        )
        signal["specificity"] = float(signal.get("specificity") or 1.0)

        if signal.get("player_id") in (None, ""):
            continue
        out.append(signal)
    return out


def build_google_url(team_name):
    query = (
        f'"{team_name}" '
        "(injury OR injured OR fitness OR team news OR lineup OR line-up OR "
        "benched OR dropped OR rotation OR available OR suspended OR training) "
        "when:2d"
    )
    params = {
        "q": query,
        "hl": "en-GB",
        "gl": "GB",
        "ceid": "GB:en",
    }
    return f"{GOOGLE_NEWS_SEARCH}?{urllib.parse.urlencode(params)}"


def main():
    now = utcnow()
    bootstrap = read_json(BOOTSTRAP_PATH, {})
    teams = bootstrap.get("teams", [])
    players = bootstrap.get("elements", [])
    target = current_target_event(bootstrap.get("events", []))

    if not target:
        print("No future FPL deadline found; collector skipped.")
        return

    target_gw = int(target["id"])
    deadline = parse_iso(target.get("deadline_time"))

    players_by_team = {}
    for p in players:
        players_by_team.setdefault(int(p["team"]), []).append(p)

    accepted = []
    candidates = []
    errors = []
    feeds_checked = 0
    items_scanned = 0

    # BBC Premier League RSS: one broad trusted feed.
    try:
        rows = rss_items(fetch_bytes(BBC_PL_RSS), "BBC Sport")
        feeds_checked += 1
        items_scanned += len(rows)
        for article in rows:
            # Try every team only for broad feed; player matching keeps this bounded.
            for team in teams:
                a, c = article_to_signals(
                    article,
                    team,
                    players_by_team.get(int(team["id"]), []),
                    target_gw,
                    deadline,
                    now,
                )
                accepted.extend(a)
                candidates.extend(c)
    except Exception as exc:
        errors.append({"source": "BBC Sport Premier League RSS", "error": str(exc)})

    # Google News RSS: one club-scoped query per FPL team.
    for team in teams:
        name = team_search_name(team)
        if not name:
            continue
        url = build_google_url(name)
        try:
            rows = rss_items(fetch_bytes(url), f"Google News · {name}")
            feeds_checked += 1
            items_scanned += len(rows)
            for article in rows:
                a, c = article_to_signals(
                    article,
                    team,
                    players_by_team.get(int(team["id"]), []),
                    target_gw,
                    deadline,
                    now,
                )
                accepted.extend(a)
                candidates.extend(c)
        except Exception as exc:
            errors.append({"source": f"Google News · {name}", "error": str(exc)})
        time.sleep(0.18)

    accepted = deduplicate(accepted)
    candidates = deduplicate(candidates)

    manual = manual_signals(target_gw, deadline, now)
    merged = deduplicate(accepted + manual)

    write_json(OUTPUT_PATH, {
        "schema_version": 2,
        "updated_at_utc": now.isoformat(),
        "target_gameweek": target_gw,
        "deadline_time": target.get("deadline_time"),
        "collector_mode": "automatic_public_news_plus_manual_trusted_social",
        "signals": sorted(
            merged,
            key=lambda s: (
                int(s.get("player_id", 0)),
                str(s.get("source_tier", "D")),
                str(s.get("published_at_utc", "")),
            ),
        ),
        "notes": [
            "Only Tier A/B/C automatic sources are allowed to affect SZxP 2.2.",
            "Unknown-source candidates are stored separately and never affect xMins automatically.",
            "Trusted social-media/reporter intelligence can be added through manual-signals.json.",
            "Signals are Gameweek-scoped and expire at the target deadline.",
        ],
    })

    write_json(CANDIDATES_PATH, {
        "updated_at_utc": now.isoformat(),
        "target_gameweek": target_gw,
        "count": len(candidates),
        "candidates": candidates[:300],
    })

    write_json(META_PATH, {
        "updated_at_utc": now.isoformat(),
        "target_gameweek": target_gw,
        "deadline_time": target.get("deadline_time"),
        "feeds_checked": feeds_checked,
        "items_scanned": items_scanned,
        "automatic_signals": len(accepted),
        "manual_signals": len(manual),
        "signals_written": len(merged),
        "unknown_source_candidates": len(candidates),
        "errors": errors,
    })

    print(json.dumps({
        "target_gameweek": target_gw,
        "feeds_checked": feeds_checked,
        "items_scanned": items_scanned,
        "automatic_signals": len(accepted),
        "manual_signals": len(manual),
        "signals_written": len(merged),
        "errors": len(errors),
    }, indent=2))


if __name__ == "__main__":
    main()
