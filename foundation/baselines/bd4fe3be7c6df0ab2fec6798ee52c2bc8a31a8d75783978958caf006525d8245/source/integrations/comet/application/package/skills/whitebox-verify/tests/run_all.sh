#!/bin/bash
# 单命令自测入口：GREEN 回归 + 负语料等价/命中断言 + 兄弟工具可选 selftest
# + 确定性不变量 + SKILL.md 预算闸门。任一失败非零退出。用法：bash tests/run_all.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail() { echo "RUN_ALL_FAIL: $*" >&2; exit 1; }

echo "== [1/6] green fixture (STRUCTURE_PASS) =="
out=$(python3 "$ROOT/tests/green-fixture/run.py" --entry "$ROOT/scripts/validate_journey_evidence.py" 2>&1) \
  || fail "green-fixture runner exited non-zero"
grep -q "STRUCTURE_PASS" <<<"$out" || fail "green-fixture output missing STRUCTURE_PASS"
echo "$out"

echo "== [2/6] negative corpus (old/new equivalence + detector hits) =="
# WB_NEW_ENTRY: cmp.sh 的 NEW 是被测入口（默认冻结 new_pkg 副本）。这里显式指向在用
# scripts/ 入口，确保真正跑的是当前代码而非快照；OLD 保持冻结参照不变。
export WB_NEW_ENTRY="$ROOT/scripts/validate_journey_evidence.py"
out=$(bash "$ROOT/tests/negative-corpus/cmp.sh" 2>&1) || fail "cmp.sh exited non-zero"
grep -Eq 'SUMMARY: [0-9]+ ok / 0 fail' <<<"$out" || fail "cmp.sh SUMMARY reports failures"
echo "$out"

echo "== [3/6] lint_debug_verdicts --selftest (skipped when absent) =="
if [ -f "$ROOT/scripts/lint_debug_verdicts.py" ]; then
  python3 "$ROOT/scripts/lint_debug_verdicts.py" --selftest || fail "lint_debug_verdicts --selftest failed"
else
  echo "skip: scripts/lint_debug_verdicts.py not present"
fi

echo "== [4/6] render_journey_summary --selftest (skipped when absent) =="
if [ -f "$ROOT/scripts/render_journey_summary.py" ]; then
  python3 "$ROOT/scripts/render_journey_summary.py" --selftest || fail "render_journey_summary --selftest failed"
else
  echo "skip: scripts/render_journey_summary.py not present"
fi

echo "== [5/6] deterministic invariants (green seed, 3 mutations) =="
if [ -f "$ROOT/tests/invariants/run.py" ]; then
  out=$(python3 "$ROOT/tests/invariants/run.py" 2>&1) \
    || fail "invariants runner exited non-zero"
  grep -q "INVARIANTS_ALL_PASS" <<<"$out" || fail "invariants output missing INVARIANTS_ALL_PASS"
  echo "$out"
else
  fail "tests/invariants/run.py not present"
fi

echo "== [6/6] SKILL.md budget gate =="
SKILL_BYTES=$(wc -c < "$ROOT/SKILL.md" | tr -d ' ')
SKILL_LINES=$(wc -l < "$ROOT/SKILL.md" | tr -d ' ')
[ "$SKILL_BYTES" -le 17500 ] || fail "SKILL.md exceeds 17500-byte budget"
[ "$SKILL_LINES" -le 500 ] || fail "SKILL.md exceeds 500-line budget"
echo "SKILL.md budget OK: ${SKILL_BYTES} bytes / ${SKILL_LINES} lines"

echo "RUN_ALL_PASS"
