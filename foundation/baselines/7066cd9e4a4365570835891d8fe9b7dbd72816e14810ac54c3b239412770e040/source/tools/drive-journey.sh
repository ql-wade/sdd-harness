#!/usr/bin/env bash
# drive-journey.sh — sdd-managed-delivery 全程驱动（可重复运行、断点续跑）
# 用法: HUMAN_AUTO=approved bash tools/drive-journey.sh <change-name> [project-root]
#   人类模式（无 HUMAN_AUTO）在每个审批点从 /dev/tty 读 approved。
# 行为: 每次运行把旅程推进到下一个需要"人"或"门证据"的位置后退出；
#       重新运行自动从当前状态继续。
set -euo pipefail

CHANGE="${1:?usage: drive-journey.sh <change-name> [project-root]}"
ROOT="${2:-$PWD}"
SESSION_ID="${SDD_SESSION_ID:?usage: export SDD_SESSION_ID=<本次任务的稳定 UUID，断点续跑保持一致>}"

# ── node 锚定：优先用 $HOME/.nvm 的新 node；没有则要求调用方自行导出 PATH ──
NVBIN=$(ls -d "$HOME"/.nvm/versions/node/v2*/bin 2>/dev/null | sort -V | tail -1)
if [ -n "$NVBIN" ]; then export PATH="$NVBIN:$PATH"; fi
command -v node >/dev/null 2>&1 || { echo "❌ 未找到 node：请安装 node>=20 或先 export PATH=<node>/bin"; exit 1; }
echo "▶ node $(node --version)"

# ── 解析最新已安装应用 ──────────────────────────────────────────────
VDIR=""; BEST=-1
for d in "$ROOT"/.comet/applications/sdd-managed-delivery/versions/*/; do
  v=$(node -e "try{console.log(JSON.parse(require('node:fs').readFileSync(process.argv[1]+'/application.json','utf8')).version)}catch{console.log(0)}" "$d" 2>/dev/null)
  if [ "${v:-0}" -gt "$BEST" ]; then BEST=$v; VDIR=$d; fi
done
[ -z "$VDIR" ] && { echo "❌ 项目未安装 sdd-managed-delivery（见使用指南 §3）"; exit 1; }
APP="${VDIR}application.json"
SDK="${VDIR}scripts/comet-run.mjs"
BASE=(--project-root "$ROOT" --run-id "$CHANGE")
JDIR="$ROOT/.journey-$CHANGE"
mkdir -p "$JDIR"
echo "▶ 应用 v$BEST | Run $CHANGE | $(basename "$SDK")"

# ── 函数 ────────────────────────────────────────────────────────────
insp() {
  node "$SDK" inspect "${BASE[@]}" > "$JDIR/view.json" 2> "$JDIR/err.txt" && return 0
  if grep -qiE 'recovery|REVISION_CONFLICT|requires recovery|Run 已变化' "$JDIR/view.json" "$JDIR/err.txt"; then
    printf '{"operation":"next","runId":"%s"}' "$CHANGE" > "$JDIR/next.json"
    comet runtime dispatch --application-file "$APP" --project-root "$ROOT" --request "$JDIR/next.json" --json > /dev/null 2>&1 || true
    node "$SDK" inspect "${BASE[@]}" > "$JDIR/view.json" 2> "$JDIR/err.txt" && return 0
  fi
  echo "❌ inspect 失败："; head -c 400 "$JDIR/view.json" "$JDIR/err.txt" 2>/dev/null; echo; return 1
}
aid() { jq -r "[.run.current.actions[]? | select(.stepId==\"$1\")][0].id" "$JDIR/view.json"; }
step() {
  node "$SDK" "$@" > "$JDIR/step.json" 2> "$JDIR/step-err.txt" || {
    echo "❌ step 失败: $*"; head -c 300 "$JDIR/step-err.txt"; echo; exit 1; }
}
claim() {
  step claim "${BASE[@]}" --action-id "$1" --executor-id sdd-managed-skill-host \
    --session-id "$SESSION_ID" --capability skill-host
  cp "$JDIR/step.json" "$JDIR/last-claim-receipt.json" 2>/dev/null || true
}
record() {
  local rc="$JDIR/last-claim-receipt.json"
  [ -f "$rc" ] || rc="$JDIR/step.json"
  step record-outcome --project-root "$ROOT" --receipt "$(jq -r '.receipts.actions[0]' "$rc")" --result-file "$1";
}
HUMAN_MODE="${HUMAN_AUTO:-interactive}"
human() {
  echo "── ★ 人类审批点：$1"
  if [ "$HUMAN_MODE" = "approved" ]; then echo "   （自动批准 HUMAN_AUTO=approved）"; return 0; fi
  read -r -p "   输入 approved 继续: " a </dev/tty
  [ "$a" = "approved" ] || { echo "已中止"; exit 1; }
}

# ── S0 启动（幂等） ─────────────────────────────────────────────────
if ! node "$SDK" inspect "${BASE[@]}" > "$JDIR/view.json" 2>/dev/null; then
  node -e "
const fs = require('node:fs');
const argv1 = process.argv[1];
const input = { change: argv1, changeDir: 'openspec/changes/' + argv1,
  checkCommands: { build: { argv: ['node', '--test', '--test-reporter=tap', 'tests/' + argv1 + '.logic.test.mjs'], cwd: '.', reusable: false },
                   verify: { argv: ['node', '--test', '--test-reporter=tap', 'tests/' + argv1 + '.logic.test.mjs'], cwd: '.', reusable: false } } };
const state = { workflow:'full', language:'zh-CN', phase:'open', contextCompression:'off', buildMode:null, buildPause:null, subagentDispatch:null, tddMode:null, reviewMode:'standard', isolation:'current', boundBranch:null, verifyMode:null, autoTransition:true, baseRef:null, designDoc:null, plan:null, verifyResult:'pending', verifyFailures:0, checkEpoch:0, verificationReport:null, branchStatus:'pending', createdAt:null, verifiedAt:null, archiveConfirmation:null, archived:false, directOverride:null, handoffContext:null, handoffHash:null, classicProfile:'full', classicMigration:1 };
fs.writeFileSync(process.argv[2], JSON.stringify(input));
fs.writeFileSync(process.argv[3], JSON.stringify(state));" "$CHANGE" "$JDIR/input.json" "$JDIR/state.json"
  node "$SDK" start "${BASE[@]}" --workflow-id comet-classic-full \
    --input-file "$JDIR/input.json" --initial-state-file "$JDIR/state.json" > "$JDIR/start.json" \
    || { echo "❌ start 失败:"; head -c 250 "$JDIR/start.json"; echo; exit 1; }
  echo "▶ Run 已启动"
fi

# ── 主循环：按 stepId 分发（可重复运行） ────────────────────────────
for round in $(seq 1 40); do
  insp
  STATUS=$(jq -r '.run.status // "?"' "$JDIR/view.json")
  PHASE=$(jq -r '.run.current.phase // ""' "$JDIR/view.json" 2>/dev/null)
  NEXT=$(jq -c '[.run.current.actions[]? | select(.status=="pending" or .status=="ready")][0]' "$JDIR/view.json")
  NWAIT=$(jq -r '[.run.current.waits[]? | select(.status=="pending")][0].stepId // empty' "$JDIR/view.json")
  NEVID=$(jq -c '[.run.current.evidenceWaits[]? | select(.status=="pending")][0]' "$JDIR/view.json")

  # 已认领未记录的动作：需要认领回执（claim 时已持久化 last-claim-receipt）
  RUNACT=$(jq -c '[.run.current.actions[]? | select(.status=="running")][0]' "$JDIR/view.json")
  if [ "$RUNACT" != "null" ] && [ -f "$JDIR/last-claim-receipt.json" ]; then
    RST=$(echo "$RUNACT" | jq -r '.stepId')
    EVENT="$RST"; [ "$RST" = "full.open" ] && EVENT="open-complete"
    [ "$RST" = "full.build.execute" ] && EVENT="build-complete"
    printf '{"status":"succeeded","output":{"event":"%s","performedBy":"host-agent"}}' "$EVENT" > "$JDIR/resume-out.json"
    step record-outcome --project-root "$ROOT" --receipt "$(jq -r '.receipts.actions[0]' "$JDIR/last-claim-receipt.json")" --result-file "$JDIR/resume-out.json"
    echo "▶ 断点续记录 $RST"; continue
  fi
  if [ -n "$NWAIT" ]; then
    C=$(jq -r '[.receipts.waits[]?][0]' "$JDIR/view.json")
    human "确认等待 [$NWAIT]（阶段 $PHASE）"
    step resolve-wait --project-root "$ROOT" --receipt "$C" --choice approved --decision-id "human-$(date +%s)"
    echo "▶ 已批准 [$NWAIT]"; continue
  fi
  if [ -n "$NEVID" ] && [ "$(echo "$NEVID" | jq -r '.kind')" = "classic-open-artifacts" ]; then
    WID=$(echo "$NEVID" | jq -r '.id'); REV=$(jq -r '.run.revision' "$JDIR/view.json")
    EV=$(node "$ROOT/tools/journey-helpers/open-evidence.mjs" "$ROOT" "$CHANGE")
    REF=$(echo "$EV" | jq -r '.ref'); CH=$(echo "$EV" | jq -r '.contentHash')
    node "$ROOT/tools/journey-helpers/make-evidence-request.mjs" "$REF" "$CH" "$CHANGE" "$REV" "$WID" "$JDIR/evreq.json"
    comet runtime dispatch --application sdd-managed-delivery --project-root "$ROOT" --request "$JDIR/evreq.json" --json | jq -c '{status}'
    continue
  fi
  STEP=$(echo "$NEXT" | jq -r '.stepId // empty'); AID=$(echo "$NEXT" | jq -r '.id // empty')
  if [ -z "$STEP" ]; then
    echo "▶ 无待办动作（status=$STATUS phase=$PHASE）"
    [ "$STATUS" = "waiting" ] && { echo "── 门证据点：按 VERIFY-JOURNEY 清单构造该门证据后重跑"; exit 2; }
    exit 0
  fi
  case "$STEP" in
    classic.composition.prepare)
      step execute "${BASE[@]}" --action-id "$AID" --executor-id comet-classic-composition-prepare
      echo "▶ prepare 完成"; continue;;
    full.open)
      human "Open 工作就绪（proposal 已按你的意图完成）"
      claim "$AID"
      printf '{"status":"succeeded","output":{"event":"open-complete"}}' > "$JDIR/open.json"
      record "$JDIR/open.json"; echo "▶ full.open 完成"; continue;;
    full.open.revalidate)
      step execute "${BASE[@]}" --action-id "$AID" --executor-id comet-classic-open-revalidate
      echo "▶ revalidate 完成"; continue;;
    classic.extension.requirements-open)
      human "R 门（需求确认）前提就绪"
      claim "$AID"
      cat << 'GATE_EOF'
━━ R 门证据构造 ━━
按 docs/user/RUNBOOK.md「R 门证据」清单：
 1. 孵化作者子代理（读 proposal 执行确认命令）+ 独立审查者子代理；
 2. 驱动器构造 evidence chain（authority→ActionBinding→dispatch→
    collection→managed admission）；
 3. 写 .sdd/delivery/gates/r/receipt-bundle.json + result 文件后重跑本脚本。
GATE_EOF
      exit 2;;
    full.design.handoff|full.design.document|full.build.configure|full.build.plan|full.build.execute|full.verify.run|full.archive.prepare|full.archive.deliver)
      human "阶段工作 [$STEP]——确认代理已按固定 SKILL.md 完成该步"
      claim "$AID"
      printf '{"status":"succeeded","output":{"event":"%s-complete","performedBy":"host-agent"}}' "$STEP" > "$JDIR/out.json"
      record "$JDIR/out.json"; echo "▶ $STEP 完成"; continue;;
    classic.extension.architecture-consensus|classic.extension.test-design-review|classic.extension.build-plan-unique|classic.extension.verify-whitebox|classic.extension.knowledge-project-closeout)
      echo "━━ 门证据点 [$STEP] ━━"
      echo "  按门构造证据链（worker+独立审查者+收据束）后 record-outcome；"
      echo "  清单见 docs/user/RUNBOOK.md 对应门证据节；构造完成后重跑本脚本继续。"
      exit 2;;
    *)
      echo "未知步骤 $STEP（$AID）"; exit 1;;
  esac
done
echo "（循环轮次用尽——再次运行继续）"
