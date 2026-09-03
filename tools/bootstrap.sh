#!/usr/bin/env bash
# bootstrap.sh — scaffold 初始化（幂等，可重复运行）
#
# 用法：
#   bash tools/bootstrap.sh                  # 基础初始化（hooks + skills + check）
#   bash tools/bootstrap.sh --with-llmwiki   # 额外安装 LLMWiki MCP（clone + venv）
#
# 步骤：环境检测 → hooks 策略落地（CC adapter）→ MCP 注册（按 mcp-capabilities.yaml）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

WITH_LLMWIKI=false
while [ $# -gt 0 ]; do
  case "$1" in
    --with-llmwiki) WITH_LLMWIKI=true ;;
    *) echo "❌ 未知参数: $1（支持: --with-llmwiki）" >&2; exit 1 ;;
  esac
  shift
done

say()  { printf '%s\n' "$*"; }
fail() { printf '❌ %s\n' "$*" >&2; exit 1; }

say "🚀 scaffold bootstrap"
say "   root: $ROOT"

# ---- 1. 环境检测 ----
say ""
say "── 1/4 环境检测 ─────────────────────────────"
node --version >/dev/null 2>&1 || fail "node 未安装（需 >=18）：brew install node / apt install nodejs"
say "✅ node $(node --version)"
git --version >/dev/null 2>&1 || fail "git 未安装"
say "✅ git $(git --version | awk '{print $3}')"
bash --version | head -1 | grep -q bash || fail "bash 不可用"
say "✅ bash"
if command -v python3 >/dev/null 2>&1; then
  say "✅ python3 $(python3 --version | awk '{print $2}')"
else
  say "⚠️  python3 不可用：hooks JSON 解析与 CC adapter 需要（brew install python3）"
fi

# npm 依赖（lib/ 验证工具需要 commander/fs-extra/chalk）
if [ ! -d node_modules ]; then
  say "📦 安装 npm 依赖…"
  npm install --no-audit --no-fund
fi

# ---- 2. hooks 策略落地（Claude Code adapter）----
say ""
say "── 2/4 hooks 控制平面（Claude Code adapter）──"
bash "$SCRIPT_DIR/adapters/claude-code.sh"

# ---- 3. MCP 注册 ----
say ""
say "── 3/4 MCP 注册（按 mcp-capabilities.yaml）──"
node "$SCRIPT_DIR/register-mcps.mjs"

# ---- 4. LLMWiki（可选）----
if [ "$WITH_LLMWIKI" = true ]; then
  say ""
  say "── 4/4 LLMWiki MCP 安装 ────────────────────"
  SDD_HOME="${SDD_HOME:-$HOME/.sdd}"
  LLMWIKI_DIR="$SDD_HOME/repos/llmwiki"
  if [ ! -x "$LLMWIKI_DIR/.venv/bin/python" ]; then
    say "📦 clone lucasastorian/llmwiki → $LLMWIKI_DIR"
    git clone https://github.com/lucasastorian/llmwiki "$LLMWIKI_DIR"
    # 供应链 pin：固定到已验证 commit（升级 = 显式改这里 + 重跑 bootstrap）
    git -C "$LLMWIKI_DIR" checkout 075c5b4996ff4e07f9d3c57c1f14fd2b54a955db
    say "🐍 创建 venv + 安装 mcp 包（pinned）…"
    python3 -m venv "$LLMWIKI_DIR/.venv"
    "$LLMWIKI_DIR/.venv/bin/pip" install --quiet "mcp[cli]==1.27.0"
  fi
  say "✅ LLMWiki venv 就绪：$LLMWIKI_DIR/.venv"
  node "$SCRIPT_DIR/register-mcps.mjs" --with-llmwiki
else
  say ""
  say "── 4/4 LLMWiki（跳过；需要时加 --with-llmwiki）──"
fi

# ---- 校验 ----
say ""
say "── 校验 ─────────────────────────────────────"
bash "$ROOT/scripts/agent-instructions-check.sh"
bash "$ROOT/scripts/agent-skill-check.sh"

say ""
say "✅ bootstrap 完成。下一步："
say "   1. 填 AGENTS.md / openspec/project.md 的 TODO(team) 内容"
say "   2. bash scripts/check.sh 确认骨架完整"
say "   3. 重启 Claude Code 会话使 hooks/skills 生效"
