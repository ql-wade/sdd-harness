#!/bin/bash
# SubagentStop hook — subagent 返回时检查输出契约
# 基于消息文本检测，非结构性强制（prompt 约束 + 关键词解析）

# Resolve project dir (platform-agnostic: Claude Code / Codex / OpenCode)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/_resolve-project-dir.sh"

SUBAEGNT_OUTPUT="$1"

SDD_DIR="${SDD_PROJECT_DIR}/.sdd"
ACTIVE_RUN_FILE="${SDD_DIR}/active-run"

if [ ! -f "$ACTIVE_RUN_FILE" ]; then
  exit 0
fi

CHANGE_ID=$(cat "$ACTIVE_RUN_FILE" 2>/dev/null)

# 启发式检测：检查 subagent 输出是否包含必要字段
# domain / subfeature / artifacts / evidence / risks
MISSING=""

echo "$SUBAEGNT_OUTPUT" | grep -qiE "domain|领域" || MISSING="$MISSING domain"
echo "$SUBAEGNT_OUTPUT" | grep -qiE "subfeature|sub-feature|子功能|变更" || MISSING="$MISSING subfeature"
echo "$SUBAEGNT_OUTPUT" | grep -qiE "artifact|产出|文件" || MISSING="$MISSING artifacts"

if [ -n "$MISSING" ]; then
  echo "⚠️ SDD Harness: Subagent 输出契约检测 — 可能缺失字段:$MISSING"
  echo "   (提示: 这是启发式检测，可能有误报。如确认完整请忽略。)"
fi

exit 0
