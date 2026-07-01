#!/bin/bash
# PostToolUse hook — 工具执行后追踪阶段产出进度
# 每次 Write/Edit/MultiEdit/Bash 执行后触发
#
# 作用：
#   1. 追踪当前阶段产出完成度（写入 .sdd/runs/<id>/deliverable-status.json）
#   2. 产出全完成时提示 agent 可推进到下一阶段
#   3. 不拦截（exit 0），只追踪和提示

# Resolve project dir (platform-agnostic: Claude Code / Codex / OpenCode)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/_resolve-project-dir.sh"

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null)
TARGET_PATH=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); ti=d.get('tool_input',{}); print(ti.get('file_path','') or ti.get('path','') or '')" 2>/dev/null)

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

CURRENT_STAGE=$(grep -E '^\s*current:' "$WF_FILE" | head -1 | awk '{print $2}')

# 只在有文件写入时追踪
if [ -z "$TARGET_PATH" ]; then
  exit 0
fi

# 跑产出检查（内联，复用 stop-gate 的检查逻辑）
RESULT=$(SDD_PROJECT_DIR="${SDD_PROJECT_DIR}" CHANGE_ID="${CHANGE_ID}" CURRENT_STAGE="${CURRENT_STAGE}" python3 -c "
import os, json, sys

project_dir = os.environ.get('SDD_PROJECT_DIR', '')
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
    try:
        if mode == 'exists': return os.path.isfile(path)
        if mode == 'size>50': return os.path.isfile(path) and os.path.getsize(path) > 50
        if mode == 'has_files': return os.path.isdir(path) and len([f for f in os.listdir(path) if f.endswith('.md')]) > 0
        if mode == 'has_md_files':
            if not os.path.isdir(path): return False
            for r, d, fs in os.walk(path):
                if any(f.endswith('.md') for f in fs): return True
            return False
        if mode == 'has_verdict': return os.path.isfile(path) and 'verdict' in open(path).read().lower()
        if mode == 'json_pass':
            if not os.path.isfile(path): return False
            try: return json.load(open(path)).get('pass') == True
            except: return False
    except: return False
    return False

checks = CHECKS.get(stage, [])
present = [label for label, path, mode in checks if check(path, mode)]
missing = [label for label, path, mode in checks if not check(path, mode)]

# 写状态文件
status = {'stage': stage, 'total': len(checks), 'present': len(present), 'missing': missing}
status_path = os.path.join(runs_dir, 'deliverable-status.json')
with open(status_path, 'w') as f:
    json.dump(status, f, ensure_ascii=False, indent=2)

# 输出摘要（给 agent 看）
if len(checks) > 0:
    ratio = f'{len(present)}/{len(checks)}'
    if len(missing) == 0:
        print(f'✅ {stage} 产出完整 ({ratio})，可推进到下一阶段')
    else:
        print(f'📊 {stage} 产出进度: {ratio}，还缺: {', '.join(missing)}')
" 2>/dev/null)

if [ -n "$RESULT" ]; then
  echo "$RESULT" >&2
fi

exit 0
