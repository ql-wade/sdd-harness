#!/usr/bin/env python3
"""Validate a typed, source-bound Trinity Journey evidence ledger."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from journey_validation.api import validate_document  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ledger", type=Path, help="Path to Journey evidence JSON")
    parser.add_argument(
        "--all-errors", action="store_true", help="Print every closure error instead of the first 50"
    )
    args = parser.parse_args(argv)
    try:
        document = json.loads(args.ledger.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 2

    errors = validate_document(document, args.ledger.parent, verify_files=True)
    if errors:
        print(f"FAIL: {len(errors)} closure error(s)")
        shown = errors if args.all_errors else errors[:50]
        for error in shown:
            print(f"- {error}")
        if len(shown) < len(errors):
            print(f"- ... {len(errors) - len(shown)} more; rerun with --all-errors")
        return 1

    journeys = document["journeys"]
    hop_count = sum(
        1 for journey in journeys for hop in journey["expected_hops"] if hop["mandatory"] is True
    )
    path_count = sum(
        1 for journey in journeys for path in journey["required_paths"] if path["mandatory"] is True
    )
    print(
        f"STRUCTURE_PASS: {len(journeys)} Journey(s), {hop_count} mandatory hop(s), "
        f"{path_count} mandatory path(s) internally consistent "
        "(local-observed; execution and authenticity require independent verification)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
