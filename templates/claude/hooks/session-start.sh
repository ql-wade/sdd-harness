#!/bin/bash
# SessionStart hook — 加载 active run、stage、goal、产出状态
# 每个 session 启动时执行
#
# 注入内容：
#   1. active run + stage + goal（工作流上下文）
#   2. 当前阶段产出状态摘要（deliverable-audit 摘要）
#   3. 缺失产出提示（如有）

SDD_DIR="${CLAUDE_PROJECT_DIR}/.sdd"
ACTIVE_RUN_FILE="${SDD_DIR}/active-run"

if [ ! -f "$ACTIVE_RUN_FILE" ]; then
  exit 0
fi

CHANGE_ID=$(cat "$ACTIVE_RUN_FILE" 2>/dev/null)
WF_FILE="${SDD_DIR}/runs/${CHANGE_ID}/workflow-frame.yaml"

if [ ! -f "$WF_FILE" ]; then
  exit 0
fi

CURRENT_STAGE=$(grep -E '^\s+current:' "$WF_FILE" | head -1 | awk '{print $2}')
GOAL=$(grep -E '^\s+goal:' "$WF_FILE" | head -1 | cut -d'"' -f2)

echo "---"
echo "SDD Harness active run: ${CHANGE_ID}"
echo "Stage: ${CURRENT_STAGE}"
echo "Goal: ${GOAL}"
echo "Workflow frame: ${WF_FILE}"

# ── 产出状态摘要（内联检查，不依赖 CLI）──────────────────
DELIVERABLE_SUMMARY=$(CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR}" CHANGE_ID="${CHANGE_ID}" CURRENT_STAGE="${CURRENT_STAGE}" python3 -c "
import os, json, sys

project_dir = os.environ.get('CLAUDE_PROJECT_DIR', '')
change_id = os.environ.get('CHANGE_ID', '')
stage = os.environ.get('CURRENT_STAGE', '')

runs_dir = os.path.join(project_dir, '.sdd', 'runs', change_id)
change_dir = os.path.join(project_dir, 'openspec', 'changes', change_id)
if not os.path.isdir(change_dir):
    archive_base = os.path.join(project_dir, 'openspec', 'changes', 'archive')
    if os.path.isdir(archive_base):
        for entry in os.listdir(archive_base):
            if entry == change_id or entry.endswith('-' + change_id):
                change_dir = os.path.join(archive_base, entry)
                break
wiki_dir = os.path.join(project_dir, 'llmwiki', 'wiki', '')

CHECKS = {
    'grill': [('findings.md', os.path.join(change_dir, 'findings.md'), 'size>50')],
    'product': [
        ('proposal.md', os.path.join(change_dir, 'proposal.md'), 'size>50'),
        ('acceptance-criteria.md', os.path.join(change_dir, 'acceptance-criteria.md'), 'size>50'),
    ],
    'dev': [
        ('design.md', os.path.join(change_dir, 'design.md'), 'exists'),
        ('tasks.md', os.path.join(change_dir, 'tasks.md'), 'exists'),
        ('specs/', os.path.join(change_dir, 'specs'), 'has_md_files'),
    ],
    'test': [('TC-*.md', os.path.join(wiki_dir, 'testing', 'cases'), 'has_files')],
    'review': [('review-notes.md', os.path.join(runs_dir, 'review-notes.md'), 'has_verdict')],
    'verify': [
        ('probe-report.json', os.path.join(runs_dir, 'probe-report.json'), 'json_pass'),
        ('evidence-audit.json', os.path.join(runs_dir, 'evidence-audit-report.json'), 'json_pass'),
    ],
    'archive': [('openspec/specs/', os.path.join(project_dir, 'openspec', 'specs'), 'has_md_files')],
}

def check(path, mode):
    if mode == 'exists': return os.path.isfile(path)
    if mode == 'size>50': return os.path.isfile(path) and os.path.getsize(path) > 50
    if mode == 'has_files': return os.path.isdir(path) and len([f for f in os.listdir(path) if f.endswith('.md')]) > 0
    if mode == 'has_md_files':
        if not os.path.isdir(path): return False
        for r, d, fs in os.walk(path):
            if any(f.endswith('.md') for f in fs): return True
        return False
    if mode == 'has_verdict':
        return os.path.isfile(path) and 'verdict' in open(path).read().lower()
    if mode == 'json_pass':
        if not os.path.isfile(path): return False
        try: return json.load(open(path)).get('pass') == True
        except: return False
    return False

checks = CHECKS.get(stage, [])
missing = [label for label, path, mode in checks if not check(path, mode)]

if missing:
    print(f'Deliverable: {len(checks) - len(missing)}/{len(checks)} present, missing: {', '.join(missing)}')
else:
    print(f'Deliverable: {len(checks)}/{len(checks)} present ✅')
" 2>/dev/null)

if [ -n "$DELIVERABLE_SUMMARY" ]; then
  echo "$DELIVERABLE_SUMMARY"
fi

echo "---"
exit 0
