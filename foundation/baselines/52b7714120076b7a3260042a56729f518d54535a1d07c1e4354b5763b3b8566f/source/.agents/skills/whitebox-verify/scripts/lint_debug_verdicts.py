#!/usr/bin/env python3
"""Lint VERDICT microformat lines in a whitebox-verify report.

Each dimension verdict must be one single line:
    VERDICT|<mode>-<dim>|STATUS|<evidence-ref>
- <mode>-<dim>: 'Debug-A'..'Debug-H' or 'Journey-A'..'Journey-J'
- STATUS: PASS | FAIL | UNVERIFIED | EVIDENCE_UNSTABLE, or 'planned'
- 'planned' is forbidden in final reports unless --allow-planned
- every dimension of each mode present in the report appears exactly once
Usage: python3 lint_debug_verdicts.py <report.md> [--allow-planned]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

MODE_DIMS = {"Debug": "ABCDEFGH", "Journey": "ABCDEFGHIJ"}
FINAL_STATUSES = ("PASS", "FAIL", "UNVERIFIED", "EVIDENCE_UNSTABLE")
PLANNED = "planned"


def lint_lines(lines: list[str], allow_planned: bool = False) -> list[str]:
    problems: list[str] = []
    seen: dict[str, int] = {}
    modes: set[str] = set()
    for lineno, raw in enumerate(lines, 1):
        line = raw.strip()
        if not line.startswith("VERDICT|"):
            continue
        parts = line.split("|")
        if len(parts) != 4 or parts[0] != "VERDICT":
            problems.append(f"line {lineno}: format error, expected 4 pipe-separated fields: {line}")
            continue
        _, key, status, evidence = parts
        mode, sep, dim = key.partition("-")
        if mode not in MODE_DIMS or not sep or dim not in MODE_DIMS[mode]:
            problems.append(f"line {lineno}: invalid dimension key '{key}'")
            continue
        modes.add(mode)
        if status != PLANNED and status not in FINAL_STATUSES:
            problems.append(
                f"line {lineno}: illegal verb '{status}' "
                f"(allowed: {', '.join(FINAL_STATUSES)}, planned)"
            )
            continue
        if status == PLANNED and not allow_planned:
            problems.append(f"line {lineno}: 'planned' is forbidden in a final report: {line}")
        elif not evidence:
            problems.append(f"line {lineno}: empty evidence ref: {line}")
        if key in seen:
            problems.append(f"line {lineno}: duplicate dimension '{key}' (first at line {seen[key]})")
            continue
        seen[key] = lineno
    for mode in sorted(modes):
        for dim in MODE_DIMS[mode]:
            key = f"{mode}-{dim}"
            if key not in seen:
                problems.append(f"missing verdict line for '{key}'")
    if not modes and not problems:
        problems.append("no VERDICT lines found")
    return problems


GOOD = [f"VERDICT|Debug-{dim}|PASS|EV_DEBUG_{dim}" for dim in "ABCDEFGH"]


def _selftest() -> int:
    assert lint_lines(GOOD) == [], "good sample must lint clean"
    assert any("missing" in p for p in lint_lines(GOOD[:7])), "missing dimension must be flagged"
    assert any(
        "illegal verb" in p for p in lint_lines(GOOD[:7] + ["VERDICT|Debug-H|OKAY|EV_DEBUG_H"])
    ), "illegal verb must be flagged"
    planned = GOOD[:7] + ["VERDICT|Debug-H|planned|TODO"]
    assert any(
        "'planned' is forbidden" in p for p in lint_lines(planned)
    ), "planned must be rejected in final reports"
    assert lint_lines(planned, allow_planned=True) == [], "planned allowed with --allow-planned"
    assert any(
        "format error" in p for p in lint_lines(GOOD[:7] + ["VERDICT|Debug-H|PASS"])
    ), "format error must be flagged"
    assert lint_lines(["no verdicts here"]) != [], "report without verdict lines must be flagged"
    print("SELFTEST_PASS: 1 good sample clean; missing-dim / illegal-verb / planned / format-error rejected")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path, nargs="?", help="Path to the report markdown")
    parser.add_argument(
        "--allow-planned", action="store_true", help="Accept 'planned' verdicts (interim reports)"
    )
    parser.add_argument("--selftest", action="store_true", help="Run built-in sample assertions")
    args = parser.parse_args(argv)
    if args.selftest:
        return _selftest()
    if args.report is None:
        parser.error("report is required unless --selftest")
    try:
        lines = args.report.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 2
    problems = lint_lines(lines, allow_planned=args.allow_planned)
    if problems:
        print(f"FAIL: {len(problems)} verdict problem(s)")
        for problem in problems:
            print(f"- {problem}")
        return 1
    count = sum(1 for line in lines if line.strip().startswith("VERDICT|"))
    print(f"LINT_PASS: {count} verdict line(s), every present dimension exactly once")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
