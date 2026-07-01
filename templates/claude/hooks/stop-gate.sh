#!/bin/bash
# Stop hook — 阻止在 artifact/evidence/writeback 缺失时提前完成
# session 结束时执行
#
# 三层检查：
#   1. workflow-frame gate status（agent 自声明）
#   2. deliverable-audit 独立验证（系统证明，不信自声明）
#   3. expected gap 提醒（非阻断）
#
# ★ 退出码语义：
#   0 = 放行
#   1 = 非阻塞警告
#   2 = 硬性拦截（stderr 反馈给模型）

# Resolve project dir (platform-agnostic: Claude Code / Codex / OpenCode)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/_resolve-project-dir.sh"

SDD_DIR="${SDD_PROJECT_DIR}/.sdd"
ACTIVE_RUN_FILE="${SDD_DIR}/active-run"

if [ ! -f "$ACTIVE_RUN_FILE" ]; then
  exit 0
fi

CHANGE_ID=$(cat "$ACTIVE_RUN_FILE" 2>/dev/null)
WF_FILE="${SDD_DIR}/runs/${CHANGE_ID}/workflow-frame.yaml"

if [ ! -f "$WF_FILE" ]; then
  exit 0
fi

# bypass 检查
if [ -f "${SDD_DIR}/hooks/bypass" ]; then
  exit 0
fi

CURRENT_STAGE=$(grep -E '^\s+current:' "$WF_FILE" | head -1 | awk '{print $2}')
GATE_STATUS=$(grep -E '^\s+status:' "$WF_FILE" | head -1 | awk '{print $2}')

# ── 检查 1: workflow-frame gate status ──────────────────

if [ "$GATE_STATUS" = "failed" ]; then
  echo "⚠️ SDD Harness: 当前 stage=${CURRENT_STAGE} 的 gate 未通过 (status=failed)" >&2
  echo "   请先完成当前阶段要求再结束 session。" >&2
  echo "   详见: ${SDD_DIR}/runs/${CHANGE_ID}/workflow-frame.yaml" >&2
  exit 2
fi

if [ "$GATE_STATUS" = "pending" ] && [ "$CURRENT_STAGE" != "grill" ]; then
  echo "⚠️ SDD Harness: 当前 stage=${CURRENT_STAGE} 的 gate 尚未检查 (status=pending)" >&2
  echo "   建议跑完 gate 检查再结束。" >&2
fi

# ── 检查 2: deliverable 独立验证（内联，不依赖 CLI）─────
# 不信 agent 自声明的 gate status——独立检查产出真实存在。

DELIVERABLE_RESULT=$(python3 -c "
import os, sys, json

project_dir = os.environ.get('SDD_PROJECT_DIR', '')
change_id = os.environ.get('CHANGE_ID', '')
stage = os.environ.get('CURRENT_STAGE', '')

sdd_dir = os.path.join(project_dir, '.sdd')
runs_dir = os.path.join(sdd_dir, 'runs', change_id)

# 解析 changeDir（活跃或归档）
change_dir = os.path.join(project_dir, 'openspec', 'changes', change_id)
if not os.path.isdir(change_dir):
    archive_base = os.path.join(project_dir, 'openspec', 'changes', 'archive')
    if os.path.isdir(archive_base):
        for entry in os.listdir(archive_base):
            if entry == change_id or entry.endswith('-' + change_id):
                change_dir = os.path.join(archive_base, entry)
                break

wiki_dir = os.path.join(project_dir, 'llmwiki', 'wiki', '')

# 按 stage 定义 required 检查
CHECKS = {
    'grill': [
        ('findings.md', os.path.join(change_dir, 'findings.md'), 'size>50'),
    ],
    'product': [
        ('proposal.md', os.path.join(change_dir, 'proposal.md'), 'size>50'),
        ('acceptance-criteria.md', os.path.join(change_dir, 'acceptance-criteria.md'), 'size>50'),
    ],
    'dev': [
        ('design.md', os.path.join(change_dir, 'design.md'), 'exists'),
        ('tasks.md', os.path.join(change_dir, 'tasks.md'), 'exists'),
        ('specs/', os.path.join(change_dir, 'specs'), 'has_md_files'),
    ],
    'test': [
        ('TC-*.md', os.path.join(wiki_dir, 'testing', 'cases'), 'has_files'),
    ],
    'review': [
        ('review-notes.md', os.path.join(runs_dir, 'review-notes.md'), 'has_verdict'),
    ],
    'verify': [
        ('probe-report.json', os.path.join(runs_dir, 'probe-report.json'), 'json_pass'),
        ('evidence-audit-report.json', os.path.join(runs_dir, 'evidence-audit-report.json'), 'json_pass'),
    ],
    'release': [],
    'archive': [
        ('openspec/specs/', os.path.join(project_dir, 'openspec', 'specs'), 'has_md_files'),
    ],
}

# expected 检查（非阻断）
EXPECTED = {
    'archive': [
        ('concepts/', os.path.join(wiki_dir, 'concepts'), 'has_files'),
        ('entities/', os.path.join(wiki_dir, 'entities'), 'has_files'),
    ],
    'release': [
        ('RELEASE_NOTE.md', os.path.join(change_dir, 'RELEASE_NOTE.md'), 'exists'),
    ],
}

def check_file(path, mode):
    if mode == 'exists':
        return os.path.isfile(path)
    if mode == 'size>50':
        return os.path.isfile(path) and os.path.getsize(path) > 50
    if mode == 'has_files':
        return os.path.isdir(path) and len([f for f in os.listdir(path) if f.endswith('.md')]) > 0
    if mode == 'has_md_files':
        if not os.path.isdir(path):
            return False
        for root, dirs, files in os.walk(path):
            if any(f.endswith('.md') for f in files):
                return True
        return False
    if mode == 'has_verdict':
        if not os.path.isfile(path):
            return False
        content = open(path).read()
        return 'verdict' in content.lower()
    if mode == 'json_pass':
        if not os.path.isfile(path):
            return False
        try:
            return json.load(open(path)).get('pass') == True
        except:
            return False
    return False

required_fails = []
expected_fails = []

checks = CHECKS.get(stage, [])
for label, path, mode in checks:
    if not check_file(path, mode):
        required_fails.append(label)

exp_checks = EXPECTED.get(stage, [])
for label, path, mode in exp_checks:
    if not check_file(path, mode):
        expected_fails.append(label)

result = {
    'stage': stage,
    'required_fails': required_fails,
    'expected_fails': expected_fails,
}
print(json.dumps(result))
" 2>/dev/null)

if [ -z "$DELIVERABLE_RESULT" ]; then
  # Python 检查失败，跳过（兼容旧环境）
  exit 0
fi

# 解析结果
REQUIRED_FAILS=$(echo "$DELIVERABLE_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print('\n'.join(d['required_fails']))" 2>/dev/null)
REQUIRED_COUNT=$(echo "$DELIVERABLE_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['required_fails']))" 2>/dev/null)
EXPECTED_FAILS=$(echo "$DELIVERABLE_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print('\n'.join(d['expected_fails']))" 2>/dev/null)
EXPECTED_COUNT=$(echo "$DELIVERABLE_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['expected_fails']))" 2>/dev/null)

# required 缺失 → 硬性拦截
if [ "$REQUIRED_COUNT" -gt 0 ]; then
  echo "⚠️ SDD Harness: ${CURRENT_STAGE} 阶段有 ${REQUIRED_COUNT} 个 required 产出缺失：" >&2
  echo "$REQUIRED_FAILS" | while read -r line; do
    [ -n "$line" ] && echo "  ❌ $line" >&2
  done
  echo "" >&2
  echo "   补全产出后重试，或运行: sdd fill-deliverables --project . --run ${CHANGE_ID}" >&2
  exit 2
fi

# expected 缺失 → 非阻塞提醒
if [ "$EXPECTED_COUNT" -gt 0 ]; then
  echo "💡 SDD Harness: ${CURRENT_STAGE} 阶段有 ${EXPECTED_COUNT} 个 expected 产出缺失（不阻断）：" >&2
  echo "$EXPECTED_FAILS" | while read -r line; do
    [ -n "$line" ] && echo "  ⚠️ $line" >&2
  done
  echo "  运行 sdd fill-deliverables 可自动补全" >&2
fi

exit 0
