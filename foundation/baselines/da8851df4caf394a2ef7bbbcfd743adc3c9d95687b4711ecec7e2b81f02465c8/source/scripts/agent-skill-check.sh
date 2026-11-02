#!/usr/bin/env bash
# agent-skill-check.sh — 技能层完整性校验
# 校验：基础层技能齐全且 SKILL.md 非空、frontmatter 含 name/description、
#       scripts 自身与 docs/agent 触发矩阵一致。

set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

fail() { echo "❌ agent-skills: $1" >&2; exit 1; }

required_skills=(
  ".agents/skills/grill-me/SKILL.md"
  ".agents/skills/grilling/SKILL.md"
  ".agents/skills/whitebox-verify/SKILL.md"
  ".agents/skills/claude-parallel-tdd-planner/SKILL.md"
  ".agents/skills/multi-agent-consensus-review/SKILL.md"
)

for f in "${required_skills[@]}"; do
  [ -s "$f" ] || fail "missing or empty skill file: $f"
  head -10 "$f" | grep -q "^name:" || fail "skill missing frontmatter name: $f"
  head -10 "$f" | grep -q "^description:" || fail "skill missing frontmatter description: $f"
done

# 可移植性红线：vendored 技能必须是真实目录，不允许符号链接（共识评审 F-002：
# symlink 会指向构建机特定路径，teammate 机器上断链）
if [ -n "$(find .agents/skills -type l -print -quit 2>/dev/null)" ]; then
  find .agents/skills -type l >&2
  fail "vendored skills must be real directories, not symlinks"
fi

# 触发矩阵引用的技能必须已 vendored（防矩阵与技能层漂移）
for s in grill-me whitebox-verify claude-parallel-tdd-planner; do
  grep -q "$s" docs/agent/skill-architecture.md || fail "触发矩阵缺少技能引用: $s"
done

echo "✅ agent-skills: ${#required_skills[@]} 个基础层技能齐全，触发矩阵一致"
