#!/usr/bin/env python3
import json
import os
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://fantasy.premierleague.com/api"
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
ENTRY_IDS = [113200, 119375, 114940, 139195, 131073, 132558, 128817, 137607, 130090]


def get_json(path, retries=3):
    url = API + path
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 Fantaszy-Szentre/1.0",
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
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    tmp.replace(path)


def published_gw(events):
    finished = [e["id"] for e in events if e.get("finished")]
    if finished:
        return max(finished)
    now = datetime.now(timezone.utc)
    future = []
    for e in events:
        deadline = e.get("deadline_time")
        if not deadline:
            continue
        dt = datetime.fromisoformat(deadline.replace("Z", "+00:00"))
        if dt > now:
            future.append(e["id"])
    nxt = min(future) if future else 1
    return max(1, nxt - 1)


def main():
    DATA.mkdir(parents=True, exist_ok=True)

    bootstrap = get_json("/bootstrap-static/")
    fixtures = get_json("/fixtures/")
    gw = published_gw(bootstrap.get("events", []))

    write_json(DATA / "bootstrap-static.json", bootstrap)
    write_json(DATA / "fixtures.json", fixtures)

    errors = []
    for entry_id in ENTRY_IDS:
        try:
            entry = get_json(f"/entry/{entry_id}/")
            history = get_json(f"/entry/{entry_id}/history/")
            picks = get_json(f"/entry/{entry_id}/event/{gw}/picks/")
            write_json(DATA / "entry" / f"{entry_id}.json", entry)
            write_json(DATA / "entry" / str(entry_id) / "history.json", history)
            write_json(DATA / "entry" / str(entry_id) / "event" / str(gw) / "picks.json", picks)
        except Exception as e:
            errors.append({"entry_id": entry_id, "error": str(e)})
            print(f"Warning: {entry_id}: {e}")

    meta = {
        "updated_at_utc": datetime.now(timezone.utc).isoformat(),
        "published_gw": gw,
        "entry_ids": ENTRY_IDS,
        "errors": errors,
    }
    write_json(DATA / "meta.json", meta)
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
