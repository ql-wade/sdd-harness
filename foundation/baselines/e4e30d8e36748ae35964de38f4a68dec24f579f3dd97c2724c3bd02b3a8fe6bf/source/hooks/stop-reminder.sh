#!/usr/bin/env bash
# Stop hook — 会话结束提醒（stdout 进 agent 上下文）
# 检查"该写而没写"的沉淀项并提醒。只提醒，不阻塞。

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/_resolve-project-dir.sh"

ROOT="$SDD_PROJECT_DIR"
reminders=()

# 1. git 工作区有改动但无对应 openspec change（高风险变更走工件）时提醒
if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  changed=$(git -C "$ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  if [ "$changed" != "0" ]; then
    reminders+=("- 工作区有 ${changed} 个未提交变更：确认验证已跑（bash scripts/check.sh），关键决策已记录 findings/ADR")
  fi
fi

# 2. 有 openspec change 但 progress/findings 缺失
if [ -d "$ROOT/openspec/changes" ]; then
  for d in "$ROOT"/openspec/changes/*/; do
    [ -d "$d" ] || continue
    base=$(basename "$d")
    [ "$base" = "archive" ] || [ "$base" = ".gitkeep" ] && continue
    [ -f "$d/progress.md" ] || reminders+=("- openspec/changes/${base}：缺 progress.md（交接证据未落盘）")
  done
fi

if [ ${#reminders[@]} -eq 0 ]; then
  echo "✅ 会话收尾检查通过：无待沉淀项。"
  exit 0
fi

echo "🧹 会话收尾提醒："
printf '%s\n' "${reminders[@]}"
exit 0
