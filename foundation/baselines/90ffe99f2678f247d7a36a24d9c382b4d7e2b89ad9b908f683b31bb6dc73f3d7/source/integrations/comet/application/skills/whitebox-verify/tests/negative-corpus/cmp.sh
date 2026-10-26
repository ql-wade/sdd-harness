#!/bin/bash
# 负路径双入口等价 + 目标检测器命中断言（自包含：路径由环境变量或脚本相对位置推导；输出不一致或目标串缺失→非零退出）
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
NEW="${WB_NEW_ENTRY:-$HERE/new_pkg/validate_journey_evidence.py}"
OLD="${WB_OLD_ENTRY:-$HERE/old_pkg/validate_journey_evidence.py}"
target() {
  case "$1" in
    f1-schema-mismatch) echo "schema_version: must be '3.0'";;
    f8-hash-mismatch) echo "hash does not match evidence file";;
    f7-secret-scan) echo "possible AWS access key found";;
    f9-correlation-absent) echo "does not contain declared correlation";;
    f10-tdd-same-fingerprint) echo "pre-fix RED and GREEN require distinct source fingerprints";;
    f11-mtime-window) echo "file mtime is outside the run window";;
    f12-duplicate-artifact) echo "byte-identical to independent artifact";;
    f13-route-scan-interception) echo "scanned source contains browser interception/replay behavior";;
    f14-noncanonical-browser-assertion) echo "must contain canonical machine-readable browser assertions";;
    f15-dimension-authority) echo "does not satisfy required authority";;
    f16-missing-evidence-file) echo "plan.evidence: scope artifact file does not exist";;
    *) echo "";;
  esac
}
# f10-f15 以 green-fixture ledger 为基底：先把共享工件 mtime 归位到冻结 run 窗口
# （仿 tests/green-fixture/run.py；scope.json 提前到 00:45），再把 f11 的 stale.log
# 推到窗口外，让 mtime 检测器可复现地命中。幂等，可重复执行。
prep_green_artifacts() {
python3 - <<'PREP'
import datetime, os
win_start = datetime.datetime(2025, 1, 1, 0, 30, tzinfo=datetime.timezone.utc)
win_end = datetime.datetime(2025, 1, 1, 1, 30, tzinfo=datetime.timezone.utc)
mid = win_start + (win_end - win_start) / 2
green = "fixtures/green"
if not os.path.isdir(green):
    raise SystemExit("missing fixtures/green: green-derived fixtures are unavailable")
for name in os.listdir(green):
    os.utime(os.path.join(green, name), (mid.timestamp(), mid.timestamp()))
scope_mtime = win_start + (mid - win_start) / 2
os.utime(os.path.join(green, "scope.json"), (scope_mtime.timestamp(), scope_mtime.timestamp()))
stale = os.path.join(green, "stale.log")
if os.path.isfile(stale):
    out = win_start - datetime.timedelta(days=365)
    os.utime(stale, (out.timestamp(), out.timestamp()))
PREP
}
cd "$HERE"; prep_green_artifacts || exit 1
PASS=0; FAIL=0
for f in fixtures/*.json; do
  o1=$(python3 "$NEW" --all-errors "$f" 2>&1); e1=$?
  o2=$(python3 "$OLD" --all-errors "$f" 2>&1); e2=$?
  ok=1; key=$(basename "$f" .json); tgt=$(target "$key")
  if ! { [ "$o1" = "$o2" ] && [ "$e1" = "$e2" ]; }; then ok=0; FAIL=$((FAIL+1)); echo "MISMATCH-OUTPUT $f"; fi
  if [ -n "$tgt" ] && ! grep -qF "$tgt" <<<"$o1"; then ok=0; FAIL=$((FAIL+1)); echo "TARGET-MISS $f want='$tgt'"; fi
  [ "$ok" = 1 ] && PASS=$((PASS+1))
  hit=n/a; [ -n "$tgt" ] && { hit=NO; grep -qF "$tgt" <<<"$o1" && hit=YES; }
  echo "===== $f [exit=$e1 errors=$(grep -c '^- ' <<<"$o1")] target_hit=$hit"
  echo "$o1"
done
echo "SUMMARY: $PASS ok / $FAIL fail"
[ "$FAIL" -eq 0 ] || exit 1
