#!/usr/bin/env bash
# agent-instructions-check.sh — 规则层完整性校验
# 校验：AGENTS.md 存在且非空、CLAUDE.md 为兼容软链、docs/agent 协作层齐全、
#       控制平面（hooks.yaml + hooks 脚本）、MCP 能力清单存在。

set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

fail() { echo "❌ agent-instructions: $1" >&2; exit 1; }

[ -s "AGENTS.md" ] || fail "AGENTS.md missing or empty"
[ -L "CLAUDE.md" ] || fail "CLAUDE.md must be a symlink"
[ "$(readlink CLAUDE.md)" = "AGENTS.md" ] || fail "CLAUDE.md must point to AGENTS.md (got $(readlink CLAUDE.md))"

for f in docs/agent/skill-architecture.md docs/agent/task-template.md; do
  [ -s "$f" ] || fail "missing协作层文件: $f"
done

[ -s "hooks.yaml" ] || fail "hooks.yaml missing（控制平面策略源）"
[ -x "hooks/pre-tool-gate.sh" ] || fail "hooks/pre-tool-gate.sh missing or not executable"
[ -x "hooks/session-context.sh" ] || fail "hooks/session-context.sh missing or not executable"
[ -x "hooks/stop-reminder.sh" ] || fail "hooks/stop-reminder.sh missing or not executable"

[ -s "mcp-capabilities.yaml" ] || fail "mcp-capabilities.yaml missing"
[ -s "openspec/project.md" ] || fail "openspec/project.md missing"

# 必填段落（骨架完整性——内容可以还是 TODO，但段落不能删）
for section in "## 0. 指令语义" "## 6. 任务执行循环" "## 7. 高风险与安全红线"; do
  grep -q "^${section}$" AGENTS.md || fail "AGENTS.md 缺少必需段落: ${section}"
done

echo "✅ agent-instructions: 规则层完整（AGENTS.md / CLAUDE.md 软链 / docs/agent / hooks / capabilities）"
