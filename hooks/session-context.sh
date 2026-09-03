#!/usr/bin/env bash
# SessionStart hook — 注入项目上下文（stdout 进 agent 上下文）
# 内容：规则入口提醒 + ADR 索引 + 验证入口。保持轻量，不做重活。

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/_resolve-project-dir.sh"

ROOT="$SDD_PROJECT_DIR"
lines=()

lines+=("📌 规则入口：$(basename "$ROOT")/AGENTS.md（开工先读；冲突时最近 AGENTS.md 优先）")

# 活跃 ADR 摘要（最多 5 条）
if [ -d "$ROOT/docs/architecture/adr" ]; then
  adrs=$(ls "$ROOT/docs/architecture/adr"/*.md 2>/dev/null | head -5)
  if [ -n "$adrs" ]; then
    lines+=("📚 ADR（不可逆决策需先有 ADR）：")
    while IFS= read -r f; do
      lines+=("   - $(basename "$f")")
    done <<< "$adrs"
  fi
fi

# 变更工件入口
if [ -d "$ROOT/openspec/changes" ]; then
  n=$(find "$ROOT/openspec/changes" -maxdepth 1 -type d ! -path "$ROOT/openspec/changes" ! -name "archive" 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" != "0" ] && lines+=("🔄 活跃 OpenSpec changes：${n} 个（openspec/changes/）")
fi

lines+=("✅ 提交前验证：bash scripts/check.sh")

printf '%s\n' "${lines[@]}"
exit 0
