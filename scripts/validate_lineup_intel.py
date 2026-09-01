#!/usr/bin/env python3
"""Safety validator for SZxP 2.2 lineup intelligence.

Removes context-reversal false positives from automatic RSS extraction before
build_szxp22.py consumes lineup-intel.json.

Examples that MUST be rejected as negative signals:
- "Arteta downplays Mosquera injury concerns"
- "Manager plays down Saka fitness concerns"
- "No concern over Palmer injury"
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

REASSURING_PATTERNS = (
    r"\bdownplays?\b.{0,90}\b(?:injury|fitness)\s+concerns?\b",
    r"\bplays?\s+down\b.{0,90}\b(?:injury|fitness)\s+concerns?\b",
    r"\bno\s+concerns?\b",
    r"\bnot\s+concerned\b",
    r"\bnothing\s+serious\b",
    r"\bnot\s+serious\b",
    r"\bminor\s+(?:issue|knock)\b",
    r"\bshould\s+be\s+fine\b",
    r"\bexpected\s+to\s+be\s+fine\b",
    r"\bno\s+(?:injury|fitness)\s+concerns?\b",
    r"\ballays?\b.{0,70}\b(?:injury|fitness)\s+fears?\b",
    r"\beases?\b.{0,70}\b(?:injury|fitness)\s+fears?\b",
)

STRONG_NEGATIVE_PATTERNS = (
    r"\bruled\s+out\b",
    r"\bwill\s+miss\b",
    r"\bset\s+to\s+miss\b",
    r"\bnot\s+available\b",
    r"\bunavailable\b",
    r"\bsuspended\b",
    r"\bnot\s+expected\s+to\s+start\b",
    r"\bexpected\s+to\s+be\s+benched\b",
    r"\bset\s+to\s+be\s+benched\b",
    r"\bdropped\s+to\s+the\s+bench\b",
    r"\bfails?\s+fitness\s+test\b",
)


def normalize(value):
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    text = re.sub(r"[^a-z0-9' -]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def matches_any(patterns, text):
    return any(re.search(pattern, text) for pattern in patterns)


def main():
    if not INPUT.exists():
        print("No lineup-intel.json; validator skipped")
        return

    payload = json.loads(INPUT.read_text(encoding="utf-8"))
    kept = []
    rejected = []

    for signal in payload.get("signals", []):
        direction = str(signal.get("direction") or "").lower()
        text = normalize(
            f"{signal.get('note', '')} "
            f"{signal.get('source_name', '')} "
            f"{signal.get('player_name', '')}"
        )

        reassuring = matches_any(REASSURING_PATTERNS, text)
        explicit_out = matches_any(STRONG_NEGATIVE_PATTERNS, text)

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
