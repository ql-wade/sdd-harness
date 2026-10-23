#!/bin/bash
# VERIFY rework Phase A batch runner. Executes each contract check command
# serially, saves sanitized raw output, appends one JSONL line per check.
cd /Users/mac/Code/sdd-harness/.claude/worktrees/rw-p4-4 || exit 1
EVID=worker-reports/VERIFY-rework/evidence
RES="$EVID/checks-results.jsonl"
LIST="$1"
[ -f "$LIST" ] || { echo "usage: run-checks.sh <ids-file>"; exit 1; }
sanitize() {
  perl -pe 's{/Users/mac/Code/sdd-harness/.claude/worktrees/rw-p4-4}{<repo>}g; s{/Users/mac/[^ ]*}{<host-path-redacted>}g; s{/private/tmp/[^ ]*}{<host-path-redacted>}g; s{/var/folders/[^ ]*}{<host-path-redacted>}g'
}
while read -r ID; do
  [ -z "$ID" ] && continue
  CMD=$(node -e "
    const c=JSON.parse(require('fs').readFileSync('openspec/changes/delivery-foundation-rearchitecture/execution-contract.json','utf8'));
    const k=c.checks.find(x=>x.id===process.argv[1]);
    process.stdout.write(k?k.command:'');
  " "$ID")
  if [ -z "$CMD" ]; then echo "{\"id\":\"$ID\",\"error\":\"no such check\"}" >> "$RES"; continue; fi
  START=$(date +%s)
  bash -c "$CMD" > "$EVID/$ID.raw.txt" 2>&1
  EXIT=$?
  END=$(date +%s)
  sanitize < "$EVID/$ID.raw.txt" > "$EVID/$ID.txt"
  rm -f "$EVID/$ID.raw.txt"
  printf '{"id":"%s","exit":%d,"seconds":%d,"at":"%s"}\n' "$ID" "$EXIT" "$((END-START))" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$RES"
  echo "$ID exit=$EXIT" >> "$EVID/progress.txt"
done < "$LIST"
echo "BATCH-DONE" >> "$EVID/progress.txt"
