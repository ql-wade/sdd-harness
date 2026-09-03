#!/usr/bin/env bash
# LLMWiki MCP launcher — 运行时解析路径，零硬编码绝对路径。
# 覆盖默认值：export SDD_HOME=... / LLMWIKI_PYTHON=...
set -euo pipefail
SDD_HOME="${SDD_HOME:-$HOME/.sdd}"
LLMWIKI_DIR="$SDD_HOME/repos/llmwiki"
# Python: 显式覆盖 > venv python > 报错
if [ -n "${LLMWIKI_PYTHON:-}" ]; then
  PY="$LLMWIKI_PYTHON"
elif [ -x "$LLMWIKI_DIR/.venv/bin/python" ]; then
  PY="$LLMWIKI_DIR/.venv/bin/python"
else
  echo "❌ LLMWiki venv 未找到: $LLMWIKI_DIR/.venv/bin/python" >&2
  echo "   跑 bash tools/bootstrap.sh --with-llmwiki 安装，或 export LLMWIKI_PYTHON=<path-to-python-with-mcp-pkg>" >&2
  exit 1
fi
# 项目根: CLAUDE_PROJECT_DIR (Claude Code 注入) > 脚本相对推导
PROJ="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
export PYTHONPATH="$LLMWIKI_DIR/mcp"
exec "$PY" -m local_server --workspace "$PROJ/llmwiki"
