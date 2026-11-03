#!/usr/bin/env python3
"""Self-contained GREEN fixture runner: sets run-window mtimes per the frozen ledger,
then validates through the bundled validator. Single command, no manual prep.

Usage: python3 tests/green-fixture/run.py [--entry PATH_TO_validate_journey_evidence.py]
Exit 0 + STRUCTURE_PASS == GREEN path reproducible from any fresh checkout/copy."""
import os, sys, json, subprocess, datetime
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT = os.path.join(HERE, "..", "..", "scripts", "validate_journey_evidence.py")
candidates = [DEFAULT,
    os.path.expanduser("~/.cc-switch/skills/whitebox-verify/scripts/validate_journey_evidence.py")]
explicit = "--entry" in sys.argv
entry = sys.argv[sys.argv.index("--entry") + 1] if explicit else next(
    (c for c in candidates if os.path.isfile(c)), DEFAULT)
ledger = json.load(open(os.path.join(HERE, "ledger.json")))
run = ledger["run"]
win_start = datetime.datetime.fromisoformat(run["started_at"])
win_end = datetime.datetime.fromisoformat(run["completed_at"])
mid = win_start + (win_end - win_start) / 2
for f in os.listdir(os.path.join(HERE, "artifacts")):
    os.utime(os.path.join(HERE, "artifacts", f), (mid.timestamp(), mid.timestamp()))
scope_mtime = win_start + (mid - win_start) / 2  # frozen-scope artifact predates earliest command
os.utime(os.path.join(HERE, "artifacts", "scope.json"), (scope_mtime.timestamp(), scope_mtime.timestamp()))
env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
r = subprocess.run([sys.executable, os.path.abspath(entry), os.path.join(HERE, "ledger.json")], env=env)
sys.exit(r.returncode)
