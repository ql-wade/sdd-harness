#!/usr/bin/env python3
"""Validate a typed, source-bound Trinity Journey evidence ledger."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from journey_validation.api import validate_document  # noqa: E402


def _structured_errors(errors: list[str]) -> list[dict[str, str]]:
    """Split 'path: message' closure errors into {path, message, rule} objects.

    Every emitter prefixes errors with a whitespace-free ledger path followed by
    ': '; global errors (e.g. dangling evidence references) carry no prefix and
    fall back to path=''. The rule is the top-level ledger section the path
    belongs to ('journeys', 'run', 'evidence_catalog', ...), or 'document'.
    """
    items: list[dict[str, str]] = []
    for error in errors:
        head, separator, tail = error.partition(": ")
        if separator and head and not any(character.isspace() for character in head):
            path, message = head, tail
        else:
            path, message = "", error
        rule = path.split(".", 1)[0].split("[", 1)[0] if path else "document"
        items.append({"path": path, "message": message, "rule": rule})
    return items


def _document_facts(document: Any) -> tuple[Any, int]:
    schema_version = document.get("schema_version") if isinstance(document, dict) else None
    journeys = document.get("journeys") if isinstance(document, dict) else None
    journey_count = len(journeys) if isinstance(journeys, list) else 0
    return schema_version, journey_count


def _emit_json(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, indent=2))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ledger", type=Path, help="Path to Journey evidence JSON")
    parser.add_argument(
        "--all-errors", action="store_true", help="Print every closure error instead of the first 50"
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit one machine-readable JSON verdict object instead of text "
        "(exit codes unchanged; errors[] is always complete)",
    )
    args = parser.parse_args(argv)
    try:
        document = json.loads(args.ledger.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        if args.json:
            _emit_json(
                {
                    "verdict": "INVALID",
                    "schema_version": None,
                    "journey_count": 0,
                    "error_count": 1,
                    "errors": [{"path": "", "message": str(exc), "rule": "document"}],
                }
            )
            return 2
        print(f"INVALID: {exc}", file=sys.stderr)
        return 2

    errors = validate_document(document, args.ledger.parent, verify_files=True)
    schema_version, journey_count = _document_facts(document)
    if errors:
        if args.json:
            _emit_json(
                {
                    "verdict": "FAIL",
                    "schema_version": schema_version,
                    "journey_count": journey_count,
                    "error_count": len(errors),
                    "errors": _structured_errors(errors),
                }
            )
            return 1
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
    if args.json:
        _emit_json(
            {
                "verdict": "STRUCTURE_PASS",
                "schema_version": schema_version,
                "journey_count": len(journeys),
                "error_count": 0,
                "errors": [],
            }
        )
        return 0
    print(
        f"STRUCTURE_PASS: {len(journeys)} Journey(s), {hop_count} mandatory hop(s), "
        f"{path_count} mandatory path(s) internally consistent "
        "(local-observed; execution and authenticity require independent verification)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
