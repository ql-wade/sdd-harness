#!/usr/bin/env python3
"""Property-based invariants for validate_journey_evidence (narrowed PBT).

Seed = tests/green-fixture, a frozen STRUCTURE_PASS ledger. Each mutator below
applies one deterministic, semantics-preserving transformation; the validator
verdict must remain STRUCTURE_PASS with zero errors:

  1. reorder  — run.commands / run.runner_reports / run.sources lists reversed
  2. unknown  — unknown keys inserted at the ledger root
  3. reserialize — ledger re-serialized with different key order/whitespace
     (digests anchor artifact bytes, never the ledger text itself)

Identity-changing mutations (ID renames, timestamp shifts) are deliberately
excluded: the semantic anchors correctly reject them. Zero dependencies,
fully deterministic (pure transformations, no RNG), reproducible from any
fresh checkout.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
GREEN = os.path.join(HERE, "..", "green-fixture")
ENTRY = os.path.join(HERE, "..", "..", "scripts", "validate_journey_evidence.py")


def stage_case(workdir, mutator, sort_keys):
    """Copy seed ledger+artifacts into a fresh case dir, mutate, fix mtimes."""
    case_dir = os.path.join(workdir, "case")
    os.mkdir(case_dir)
    shutil.copytree(os.path.join(GREEN, "artifacts"), os.path.join(case_dir, "artifacts"))
    with open(os.path.join(GREEN, "ledger.json"), encoding="utf-8") as handle:
        ledger = json.load(handle)
    mutator(ledger)
    with open(os.path.join(case_dir, "ledger.json"), "w", encoding="utf-8") as handle:
        json.dump(ledger, handle, sort_keys=sort_keys, indent=5 if sort_keys else 2)
        handle.write("\n")
    run = ledger["run"]
    win_start = datetime.fromisoformat(run["started_at"])
    win_end = datetime.fromisoformat(run["completed_at"])
    mid = win_start + (win_end - win_start) / 2
    artifacts = os.path.join(case_dir, "artifacts")
    for name in os.listdir(artifacts):
        os.utime(os.path.join(artifacts, name), (mid.timestamp(), mid.timestamp()))
    scope_mtime = win_start + (mid - win_start) / 2  # frozen scope predates commands
    os.utime(os.path.join(artifacts, "scope.json"), (scope_mtime.timestamp(), scope_mtime.timestamp()))
    return os.path.join(case_dir, "ledger.json")


def mutate_reorder(ledger):
    for key in ("commands", "runner_reports", "sources"):
        ledger["run"][key] = list(reversed(ledger["run"][key]))


def mutate_unknown_keys(ledger):
    ledger["zz_pbt_unknown_scalar"] = 42
    ledger["aa_pbt_unknown_note"] = {"note": "pbt invariant", "count": 1}


CASES = [
    ("reorder_run_lists", mutate_reorder, False),
    ("insert_unknown_root_keys", mutate_unknown_keys, False),
    ("reserialize_ledger", lambda ledger: None, True),
]


def check_case(workdir, name, mutator, sort_keys):
    ledger_path = stage_case(workdir, mutator, sort_keys)
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    result = subprocess.run(
        [sys.executable, ENTRY, ledger_path, "--json"],
        capture_output=True, text=True, env=env, check=False,
    )
    try:
        verdict = json.loads(result.stdout)
    except ValueError:
        sys.exit(f"INVARIANT_FAIL {name}: no JSON verdict (exit={result.returncode})\n{result.stderr}")
    if verdict.get("verdict") != "STRUCTURE_PASS" or verdict.get("error_count") != 0:
        sys.exit(f"INVARIANT_FAIL {name}: {json.dumps(verdict, ensure_ascii=False)}")
    print(f"INVARIANT_PASS {name}: STRUCTURE_PASS preserved")


def main():
    if not os.path.isfile(ENTRY):
        sys.exit(f"INVARIANT_FAIL entry missing: {ENTRY}")
    for name, mutator, sort_keys in CASES:
        workdir = tempfile.mkdtemp(prefix="wbv-invariants-")
        try:
            check_case(workdir, name, mutator, sort_keys)
        finally:
            shutil.rmtree(workdir, ignore_errors=True)
    print("INVARIANTS_ALL_PASS")


if __name__ == "__main__":
    main()
