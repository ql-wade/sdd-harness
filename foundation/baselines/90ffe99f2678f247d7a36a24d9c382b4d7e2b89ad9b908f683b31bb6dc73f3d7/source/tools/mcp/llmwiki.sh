#!/usr/bin/env bash
# LLMWiki MCP launcher — 运行时解析路径，零硬编码绝对路径。
# 覆盖默认值：export SDD_HOME=... / LLMWIKI_PYTHON=...
#
# Canonical wiki root（P4_4 4.4.a：修复 CLI/MCP/worktree 路径分叉）：
# 本 launcher 与 CLI（lib/sdd-paths.js getWikiHome）必须解析到同一 wiki 根——
#   $SDD_WIKI_HOME 优先，否则 $SDD_HOME/wiki/<project-slug>；
#   slug 取 git common-dir 主仓库目录名（worktree-safe：同一 repo 的所有
#   worktree 共享同一 wiki），小写并折叠到 [a-z0-9_-]。
# 每个 project 只有一个 wiki 根；per-worktree 副本永不是 wiki 根（ProjectRoot.v1）。
set -euo pipefail
SDD_HOME="${SDD_HOME:-$HOME/.sdd}"
LLMWIKI_DIR="$SDD_HOME/repos/llmwiki"
# 项目根: CLAUDE_PROJECT_DIR (Claude Code 注入) > 脚本相对推导
PROJ="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
# Canonical wiki root — 与 lib/sdd-paths.js getWikiHome 同一推导（单一语义源）。
if [ -n "${SDD_WIKI_HOME:-}" ]; then
  WIKI_HOME="$SDD_WIKI_HOME"
else
  COMMON_DIR="$(git -C "$PROJ" rev-parse --git-common-dir 2>/dev/null || true)"
  if [ -n "$COMMON_DIR" ]; then
    MAIN_DIR="$(cd "$PROJ" && cd "$(dirname "$COMMON_DIR")" && pwd)"
    SLUG="$(basename "$MAIN_DIR")"
  else
    SLUG="$(basename "$PROJ")"
  fi
  SLUG="$(printf '%s' "$SLUG" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g')"
  if [ -z "$SLUG" ] || [ "$SLUG" = "." ]; then SLUG="default"; fi
  WIKI_HOME="$SDD_HOME/wiki/$SLUG"
fi
# Python: 显式覆盖 > venv python > 报错（venv 缺失时输出解析出的 canonical
# wiki 根，供 CLI/launcher 同根性的可核验对照）。
if [ -n "${LLMWIKI_PYTHON:-}" ]; then
  PY="$LLMWIKI_PYTHON"
elif [ -x "$LLMWIKI_DIR/.venv/bin/python" ]; then
  PY="$LLMWIKI_DIR/.venv/bin/python"
else
  echo "❌ LLMWiki venv 未找到: $LLMWIKI_DIR/.venv/bin/python" >&2
  echo "   wiki workspace: $WIKI_HOME" >&2
  echo "   跑 bash tools/bootstrap.sh --with-llmwiki 安装，或 export LLMWIKI_PYTHON=<path-to-python-with-mcp-pkg>" >&2
  exit 1
fi
export PYTHONPATH="$LLMWIKI_DIR/mcp"
exec "$PY" -m local_server --workspace "$WIKI_HOME"
