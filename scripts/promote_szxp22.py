#!/usr/bin/env python3
"""
Promote SZxP 2.2 to the website's canonical production feed while retaining
the just-generated SZxP 2.1 files as a shadow benchmark.

Order matters:
1) update_fpl_data.py generates current 2.1 -> data/szxp.json + data/meta.json
2) build_szxp22.py generates current 2.2 -> data/szxp-2.2.json + data/meta-2.2.json
3) accuracy jobs score each model from its own locked snapshot directory
4) this script archives current 2.1 as szxp-2.1/meta-2.1, then points the
   canonical website files at 2.2.
"""

from datetime import datetime, timezone

from update_fpl_data import DATA, read_json, write_json


def main():
    p21 = read_json(DATA / "szxp.json", {})
    m21 = read_json(DATA / "meta.json", {})
    p22 = read_json(DATA / "szxp-2.2.json", {})
    m22 = read_json(DATA / "meta-2.2.json", {})

    if not p21 or not p22:
        raise RuntimeError("Both SZxP 2.1 and SZxP 2.2 outputs must exist before promotion.")

    if not str(p21.get("model_version", "")).startswith("SZxP 2.1"):
        raise RuntimeError(f"Expected 2.1 shadow source, found {p21.get('model_version')}")

    if not str(p22.get("model_version", "")).startswith("SZxP 2.2"):
        raise RuntimeError(f"Expected 2.2 production source, found {p22.get('model_version')}")

    # Preserve the current 2.1 generation as the shadow feed.
    shadow_projection = dict(p21)
    shadow_projection["mode"] = "shadow"
    write_json(DATA / "szxp-2.1.json", shadow_projection)

    shadow_meta = dict(m21)
    shadow_meta["mode"] = "shadow"
    shadow_meta["production_model"] = "SZxP 2.2"
    write_json(DATA / "meta-2.1.json", shadow_meta)

    # Canonical feed consumed by app.js is now 2.2.
    production_projection = dict(p22)
    production_projection["model_version"] = "SZxP 2.2"
    production_projection["mode"] = "production"
    write_json(DATA / "szxp.json", production_projection)

    # Keep existing useful metadata from the main refresh, but label the active
    # model correctly and carry 2.2 intelligence counts.
    production_meta = dict(m21)
    production_meta.update({
        "updated_at_utc": m22.get("updated_at_utc") or datetime.now(timezone.utc).isoformat(),
        "published_gw": m22.get("published_gw", m21.get("published_gw")),
        "next_gw": m22.get("next_gw", m21.get("next_gw")),
        "model_version": "SZxP 2.2",
        "mode": "production",
        "production_model": "SZxP 2.2",
        "shadow_model": "SZxP 2.1",
        "lineup_intel_signals": m22.get("lineup_intel_signals", 0),
        "player_load_records": m22.get("player_load_records", 0),
    })
    write_json(DATA / "meta.json", production_meta)

    print({
        "production": production_projection.get("model_version"),
        "shadow": shadow_projection.get("model_version"),
        "published_gw": production_meta.get("published_gw"),
        "next_gw": production_meta.get("next_gw"),
    })


if __name__ == "__main__":
    main()
