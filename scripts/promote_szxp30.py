#!/usr/bin/env python3
"""
Promote SZxP 3.0 Commercial Core to the canonical website feed.

Workflow order:
1) update_fpl_data.py builds current 2.1 legacy baseline -> data/szxp.json
2) build_szxp22.py builds 2.2 shadow -> data/szxp-2.2.json
3) build_szxp30.py builds 3.0 production -> data/szxp-3.0.json
4) all accuracy jobs score their own immutable snapshot folders
5) this file makes 3.0 canonical while retaining 2.2 and 2.1 for audit
"""

from datetime import datetime, timezone
from update_fpl_data import DATA, read_json, write_json


def main():
    p21 = read_json(DATA / "szxp.json", {})
    m21 = read_json(DATA / "meta.json", {})
    p22 = read_json(DATA / "szxp-2.2.json", {})
    m22 = read_json(DATA / "meta-2.2.json", {})
    p30 = read_json(DATA / "szxp-3.0.json", {})
    m30 = read_json(DATA / "meta-3.0.json", {})

    if not p21 or not p22 or not p30:
        raise RuntimeError("2.1, 2.2 and 3.0 outputs must exist before promotion.")

    if not str(p21.get("model_version", "")).startswith("SZxP 2.1"):
        raise RuntimeError(f"Expected 2.1 legacy source, found {p21.get('model_version')}")
    if not str(p22.get("model_version", "")).startswith("SZxP 2.2"):
        raise RuntimeError(f"Expected 2.2 shadow source, found {p22.get('model_version')}")
    if not str(p30.get("model_version", "")).startswith("SZxP 3.0"):
        raise RuntimeError(f"Expected 3.0 production source, found {p30.get('model_version')}")

    legacy = dict(p21)
    legacy["mode"] = "legacy_shadow"
    write_json(DATA / "szxp-2.1.json", legacy)

    legacy_meta = dict(m21)
    legacy_meta.update({
        "mode": "legacy_shadow",
        "production_model": "SZxP 3.0 Commercial Core",
    })
    write_json(DATA / "meta-2.1.json", legacy_meta)

    shadow22 = dict(p22)
    shadow22["mode"] = "shadow"
    write_json(DATA / "szxp-2.2.json", shadow22)

    shadow22_meta = dict(m22)
    shadow22_meta.update({
        "mode": "shadow",
        "production_model": "SZxP 3.0 Commercial Core",
    })
    write_json(DATA / "meta-2.2.json", shadow22_meta)

    prod = dict(p30)
    prod["mode"] = "production"
    write_json(DATA / "szxp.json", prod)

    prod_meta = dict(m21)
    prod_meta.update({
        "updated_at_utc": m30.get("updated_at_utc") or datetime.now(timezone.utc).isoformat(),
        "published_gw": m30.get("published_gw", m21.get("published_gw")),
        "next_gw": m30.get("next_gw", m21.get("next_gw")),
        "model_version": "SZxP 3.0 Commercial Core",
        "mode": "production",
        "production_model": "SZxP 3.0 Commercial Core",
        "shadow_model": "SZxP 2.2",
        "legacy_shadow_model": "SZxP 2.1",
        "calibration": m30.get("calibration"),
        "lineup_intel_signals": m30.get("lineup_intel_signals", 0),
        "player_load_records": m30.get("player_load_records", 0),
    })
    write_json(DATA / "meta.json", prod_meta)

    print({
        "production": "SZxP 3.0 Commercial Core",
        "shadow": "SZxP 2.2",
        "legacy": "SZxP 2.1",
        "next_gw": prod_meta.get("next_gw"),
    })


if __name__ == "__main__":
    main()
