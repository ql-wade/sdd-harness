#!/bin/bash
# 负路径双入口等价 + 目标检测器命中断言（自包含：路径由环境变量或脚本相对位置推导；输出不一致或目标串缺失→非零退出）
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
NEW="${WB_NEW_ENTRY:-$HERE/new_pkg/validate_journey_evidence.py}"
OLD="${WB_OLD_ENTRY:-$HERE/old_pkg/validate_journey_evidence.py}"
target() {
  case "$1" in
    f1-schema-mismatch) echo "schema_version: must be '3.0'";;
    f6-hash-mismatch|f8-hash-mismatch) echo "hash does not match evidence file";;
    f7-secret-scan) echo "possible AWS access key found";;
    f9-correlation-absent) echo "does not contain declared correlation";;
    *) echo "";;
  esac
}
cd "$HERE"; PASS=0; FAIL=0
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
