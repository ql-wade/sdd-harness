# GREEN Regression Fixture (schema 3.0)

Synthetic, clearly-labeled positive-path fixture for `scripts/validate_journey_evidence.py`.
Proves the validator's GREEN path is reachable and stable across refactors/relocations.

Run (from this directory):
```bash
python3 ../../scripts/validate_journey_evidence.py ledger.json
# expect: STRUCTURE_PASS ... exit 0
```
Note: artifact mtimes must stay within run window [2025-01-01T00:30, 01:30 UTC]
(scope.json: 00:45). If you copy this fixture, re-apply: `python3 - <<'EOF' ... os.utime ... EOF` (see build history in review-runs/whitebox-v22-*).
