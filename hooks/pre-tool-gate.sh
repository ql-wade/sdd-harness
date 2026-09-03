#!/usr/bin/env bash
# PreToolUse hook — 策略来源 hooks.yaml（经 adapter 编译为 hooks/.compiled.env）
#
# Claude Code 退出码语义（实证）：
#   0 = 放行；1 = 非阻塞错误（工具照跑）；2 = 硬性拦截（stderr 反馈给模型）。
# 拦截原因必须输出到 stderr（exit 2 的反馈通道）。
#
# stdin JSON: {tool_name, tool_input:{file_path|notebook_path|command, ...}}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/_resolve-project-dir.sh"

COMPILED="${SCRIPT_DIR}/.compiled.env"
if [ -f "$COMPILED" ]; then
  # shellcheck disable=SC1090
  source "$COMPILED"
else
  # 无编译产物时用内置默认（与 hooks.yaml 保持一致）
  KB_PROTECT_PATHS="llmwiki/wiki/"
  DENY_PATTERNS="git push --force|git push -f |git reset --hard|rm -rf /|DROP TABLE|DROP DATABASE"
  DENY_MESSAGE="破坏性命令在团队禁入清单"
fi

INPUT=$(cat)

# Fail closed：JSON 解析依赖 python3。解析器不可用时拒绝工具调用，
# 而不是静默放行（deny 策略失效比误拦截更危险）。
if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ pre-tool-gate: python3 不可用，deny 策略无法求值 — 拦截本次调用（fail closed）。修复：安装 python3 或移除 hooks.yaml deny 策略" >&2
  exit 2
fi

TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_name',''))" 2>/dev/null || echo "")

# Fail closed：非空输入解析失败 → 无法判定策略 → 拒绝（不能静默放行）
if [ -z "$TOOL_NAME" ] && [ -n "$INPUT" ]; then
  echo "❌ pre-tool-gate: hook 输入 JSON 解析失败，deny 策略无法求值 — 拦截本次调用（fail closed）" >&2
  exit 2
fi

case "$TOOL_NAME" in
  Write|Edit|MultiEdit)
    TARGET_PATH=$(echo "$INPUT" | python3 -c "import sys,json; ti=json.load(sys.stdin).get('tool_input',{}); print(ti.get('file_path','') or ti.get('notebook_path','') or '')" 2>/dev/null || echo "")
    if [ -n "$TARGET_PATH" ]; then
      # 按 IFS=: 拆分保护路径前缀
      OLDIFS="$IFS"; IFS=":"
      for prefix in $KB_PROTECT_PATHS; do
        IFS="$OLDIFS"
        [ -z "$prefix" ] && continue
        if [[ "$TARGET_PATH" == *"$prefix"* ]]; then
          echo "❌ 禁止直接写入 ${prefix}*：${DENY_KB_MESSAGE:-直接写 wiki 会绕过索引，必须走 mcp__llmwiki__create / edit / append}" >&2
          exit 2
        fi
      done
      IFS="$OLDIFS"
    fi
    ;;

  Bash)
    COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null || echo "")
    if [ -n "$COMMAND" ]; then
      IFS="|"
      for pattern in $DENY_PATTERNS; do
        IFS="|"
        [ -z "$pattern" ] && continue
        if [[ "$COMMAND" == *"$pattern"* ]]; then
          echo "❌ 禁止执行「${pattern}」：${DENY_MESSAGE}（hooks.yaml dangerous-command-blocklist）" >&2
          exit 2
        fi
      done
      IFS="$OLDIFS"
    fi
    ;;
esac

exit 0
