#!/bin/bash
# PreToolUse hook — 阻止越界写入和 wrong-phase 写入
# Claude Code 通过 JSON stdin 传 {tool_name, tool_input}（非位置参数）
# 仅对 Edit/Write/MultiEdit/Bash 生效
#
# ★ 关键修复（2026-06-29 hook 实证发现）：
#   exit 1 是非阻塞错误（工具仍执行）；exit 2 才是硬性拦截。
#   Claude Code 的 PreToolUse 退出码语义：
#     0 = 放行
#     1 = 非阻塞错误（记录但不拦截，工具照跑）← 旧版误用
#     2 = 硬性拦截（工具中止，stderr 反馈给模型）← 正确
#   拦截原因必须输出到 stderr（exit 2 的反馈通道）。

# 从 stdin 读 JSON（Claude Code 的 hook 输入格式）
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null)
# 从 tool_input.file_path（Write/Edit）或 tool_input.command（Bash）提取路径
TARGET_PATH=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); ti=d.get('tool_input',{}); print(ti.get('file_path','') or ti.get('notebook_path','') or ti.get('path','') or '')" 2>/dev/null)

SDD_DIR="${CLAUDE_PROJECT_DIR}/.sdd"
ACTIVE_RUN_FILE="${SDD_DIR}/active-run"

# 无 active run，不拦（SessionStart 已提示）
if [ ! -f "$ACTIVE_RUN_FILE" ]; then
  exit 0
fi

CHANGE_ID=$(cat "$ACTIVE_RUN_FILE" 2>/dev/null)

WF_FILE="${SDD_DIR}/runs/${CHANGE_ID}/workflow-frame.yaml"
if [ -f "$WF_FILE" ]; then
  CURRENT_STAGE=$(grep -E '^\s+current:' "$WF_FILE" | head -1 | awk '{print $2}')

  # 支持绝对路径和相对路径
  # 阻止在非 dev/code/review 阶段对 src/ 的写入
  if [[ "$TARGET_PATH" == *"/src/"* ]] || [[ "$TARGET_PATH" == "src/"* ]]; then
    if [[ "$CURRENT_STAGE" != "code" ]] && [[ "$CURRENT_STAGE" != "review" ]]; then
      # bypass 检查
      if [ -f "${SDD_DIR}/hooks/bypass" ]; then
        exit 0
      fi
      echo "⚠️ SDD Harness: 当前 stage=${CURRENT_STAGE}，不允许写入 ${TARGET_PATH}" >&2
      echo "   只有 code/review 阶段允许修改源码。如需绕过: touch ${SDD_DIR}/hooks/bypass" >&2
      exit 2
    fi
  fi
fi

exit 0
