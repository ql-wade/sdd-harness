#!/bin/bash
# PreCompact hook — context 压缩前 flush findings/progress 到磁盘
# 防止 context 丢失

# Resolve project dir (platform-agnostic: Claude Code / Codex / OpenCode)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/_resolve-project-dir.sh"

SDD_DIR="${SDD_PROJECT_DIR}/.sdd"
ACTIVE_RUN_FILE="${SDD_DIR}/active-run"

if [ ! -f "$ACTIVE_RUN_FILE" ]; then
  exit 0
fi

CHANGE_ID=$(cat "$ACTIVE_RUN_FILE" 2>/dev/null)

echo "---"
echo "SDD Harness: PreCompact — 当前 change=${CHANGE_ID}"
echo "请确保以下文件已更新（agent 在压缩前最后确认）:"
echo "  openspec/changes/${CHANGE_ID}/progress.md"
echo "  openspec/changes/${CHANGE_ID}/findings.md"
echo "  .sdd/runs/${CHANGE_ID}/workflow-frame.yaml"
echo "---"
exit 0
