#!/usr/bin/env python3
"""Safety validator for SZxP 2.2 lineup intelligence.

Removes context-reversal false positives from automatic RSS extraction before
build_szxp22.py consumes lineup-intel.json. Example: a headline saying a
manager "downplays injury concerns" must not become a negative availability
signal just because it contains the words "injury concern".
"""

import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INTEL = ROOT / "data" / "intelligence"
INPUT = INTEL / "lineup-intel.json"
REJECTED = INTEL / "rejected-signals.json"

REASSURING = (
    "downplays injury concern",
    "downplays injury concerns",
    "downplays fitness concern",
    "downplays fitness concerns",
    "plays down injury concern",
    "plays down injury concerns",
    "plays down fitness concern",
    "plays down fitness concerns",
    "not concerned",
    "no concern",
    "no concerns",
    "nothing serious",
    "not serious",
    "minor issue",
    "minor knock",
    "should be fine",
    "expected to be fine",
    "no injury concern",
    "no fitness concern",
    "allays injury fears",
    "allays fitness fears",
    "eases injury fears",
    "eases fitness fears",
)

STRONG_NEGATIVE = (
    "ruled out",
    "will miss",
    "set to miss",
    "not available",
    "unavailable",
    "suspended",
    "not expected to start",
    "expected to be benched",
    "set to be benched",
    "dropped to the bench",
    "fails fitness test",
)


def normalize(value):
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    text = re.sub(r"[^a-z0-9' -]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def main():
    if not INPUT.exists():
        print("No lineup-intel.json; validator skipped")
        return

    payload = json.loads(INPUT.read_text(encoding="utf-8"))
    kept = []
    rejected = []

    for signal in payload.get("signals", []):
        direction = str(signal.get("direction") or "").lower()
        text = normalize(f"{signal.get('note', '')} {signal.get('source_name', '')}")
        reassuring = any(p in text for p in REASSURING)
        explicit_out = any(p in text for p in STRONG_NEGATIVE)

        if "negative" in direction and reassuring and not explicit_out:
            item = dict(signal)
            item["rejected_reason"] = (
                "reassuring/negating context reverses generic negative phrase"
            )
            rejected.append(item)
            continue

        kept.append(signal)

    payload["signals"] = kept
    payload["validated_at_utc"] = datetime.now(timezone.utc).isoformat()
    payload["validation_rejected"] = len(rejected)
    INPUT.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    REJECTED.write_text(
        json.dumps(
            {
                "updated_at_utc": payload["validated_at_utc"],
                "count": len(rejected),
                "signals": rejected,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )

    print({"kept": len(kept), "rejected": len(rejected)})


if __name__ == "__main__":
    main()
