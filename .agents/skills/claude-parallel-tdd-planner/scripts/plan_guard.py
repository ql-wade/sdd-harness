#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

REQUIRED_HEADER_PARTS = ('Implementation Plan', '**Goal:**', '**Architecture:**',
                         '**Tech Stack:**', '## Global Constraints')
MARKERS = ('T' + 'BD', 'T' + 'ODO', 'implement ' + 'later', 'fill in ' + 'details', 'Similar ' + 'to Task')
STEP_RE = re.compile(r'^- \[[ xX]\] \*\*Step \d+ \[(\d+) min\]:')
TASK_RE = re.compile(r'^### Task ([A-Za-z0-9_-]+):', re.MULTILINE)
HASH_RE = re.compile(r'^[0-9a-f]{64}$')


@dataclass(frozen=True)
class Issue:
    code: str
    line: int
    message: str


def prose_and_normalized(text: str) -> tuple[str, str]:
    """Ignore code fences for prose checks; freeze code verbatim for plan hashing."""
    prose, normalized = [], []
    fence = None
    for line in text.replace('\r\n', '\n').splitlines(keepends=True):
        marker = re.match(r'^\s*(`{3,}|~{3,})', line)
        is_fence = bool(marker)
        if fence:
            if marker and marker[1][0] == fence[0] and len(marker[1]) >= len(fence):
                fence = None
            prose.append('\n' if line.endswith('\n') else '')
            normalized.append(line)
        elif is_fence:
            fence = marker[1]
            prose.append('\n' if line.endswith('\n') else '')
            normalized.append(line)
        else:
            prose.append(line)
            normalized.append(re.sub(r'^(\s*- )\[[xX]\]', r'\1[ ]', line))
    return ''.join(prose), ''.join(normalized)


def validate_plan_text(text: str) -> list[Issue]:
    issues = []
    prose, _ = prose_and_normalized(text)
    for part in REQUIRED_HEADER_PARTS:
        if part not in prose:
            issues.append(Issue('MISSING_HEADER', 1, f'Missing {part}'))
    for marker in MARKERS:
        offset = prose.find(marker)
        if offset >= 0:
            issues.append(Issue('UNRESOLVED_MARKER', prose.count('\n', 0, offset) + 1, f'Found {marker}'))
    for index, line in enumerate(prose.splitlines(), 1):
        if re.match(r'^- \[[ xX]\] \*\*Step ', line):
            match = STEP_RE.match(line)
            if not match or int(match[1]) not in range(2, 6):
                issues.append(Issue('STEP_DURATION', index, 'Step duration must be 2 through 5 minutes'))
    matches = list(TASK_RE.finditer(prose))
    if not matches:
        issues.append(Issue('NO_TASKS', 1, 'Plan must contain actionable tasks'))
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(prose)
        block = prose[match.start():end]
        line = prose.count('\n', 0, match.start()) + 1
        for section in ('Files', 'Interfaces', 'Dependencies', 'Owns', 'Parallel safe', 'Acceptance IDs'):
            count = len(re.findall(r'^\*\*' + re.escape(section) + r':\*\*', block, re.MULTILINE))
            if count != 1:
                issues.append(Issue('TASK_FIELD_COUNT', line, f'{section} must occur exactly once; found {count}'))
        if not re.search(r'^- \[[ xX]\] \*\*Step \d+ \[[2-5] min\]: (Commit|Record)\b', block, re.MULTILINE):
            issues.append(Issue('MISSING_COMMIT', line, 'Missing timed Commit or non-Git Record step'))
    return issues


def object_value(value, label):
    if not isinstance(value, dict):
        raise ValueError(f'{label} must be an object')
    return value


def list_value(value, label):
    if not isinstance(value, list):
        raise ValueError(f'{label} must be an array')
    return value


def strings(value, label):
    value = list_value(value, label)
    if not all(isinstance(x, str) and x.strip() for x in value):
        raise ValueError(f'{label} must contain nonempty strings')
    return value


def _paths_overlap(left: str, right: str) -> bool:
    a, b = PurePosixPath(left).parts, PurePosixPath(right).parts
    return a[:min(len(a), len(b))] == b[:min(len(a), len(b))]


def validate_dag(dag: dict) -> list[Issue]:
    object_value(dag, 'DAG')
    rows = list_value(dag.get('tasks'), 'tasks')
    waves = list_value(dag.get('waves'), 'waves')
    issues = []
    tasks = {}
    for row in rows:
        object_value(row, 'task')
        task_id = row.get('id')
        if not isinstance(task_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', task_id):
            raise ValueError('task id must be a nonempty identifier')
        if task_id in tasks:
            issues.append(Issue('DAG_DUPLICATE', 0, task_id))
        tasks[task_id] = row
        strings(row.get('depends_on'), 'depends_on')
        strings(row.get('acceptance_ids'), 'acceptance_ids')
        if type(row.get('parallel_safe')) is not bool:
            issues.append(Issue('DAG_PARALLEL', 0, f'{task_id}: parallel_safe must be boolean'))
        for path in strings(row.get('owns'), 'owns'):
            if (path.startswith('/') or '\\' in path or ':' in path or
                any(x in path for x in '*?[]') or
                any(x in ('', '.', '..') for x in path.split('/'))):
                issues.append(Issue('DAG_PATH', 0, f'{task_id}: invalid literal ownership path {path}'))
    flattened = [x for wave in waves for x in strings(wave, 'wave')]
    if not tasks or Counter(flattened) != Counter(tasks.keys()):
        issues.append(Issue('DAG_WAVES', 0, 'Every task must occur in exactly one wave'))
    wave_of = {x: i for i, wave in enumerate(waves) for x in wave}
    for task_id, row in tasks.items():
        for dep in row['depends_on']:
            if dep not in tasks or wave_of.get(dep, 10**9) >= wave_of.get(task_id, -1):
                issues.append(Issue('DAG_DEPENDENCY', 0, f'{task_id}: dependency {dep} is not integrated earlier'))
    for wave in waves:
        known = [x for x in wave if x in tasks]
        if len(wave) > 1 and any(not tasks[x]['parallel_safe'] for x in known):
            issues.append(Issue('DAG_PARALLEL', 0, 'Serial task in concurrent wave'))
        for i, left in enumerate(known):
            for right in known[i + 1:]:
                if any(_paths_overlap(a, b) for a in tasks[left]['owns'] for b in tasks[right]['owns']):
                    issues.append(Issue('DAG_OWNERSHIP', 0, f'{left} and {right} overlap'))
    return issues


def validate_drift_lock(lock: dict) -> list[Issue]:
    object_value(lock, 'lock')
    issues = []
    for key in ('architecture_sha256', 'plan_sha256'):
        if not HASH_RE.fullmatch(str(lock.get(key, ''))):
            issues.append(Issue('LOCK_HASH', 0, f'{key} must be lowercase SHA-256'))
    if lock.get('change_policy') != 'halt-and-replan':
        issues.append(Issue('LOCK_POLICY', 0, 'change_policy must be halt-and-replan'))
    return issues


def validate_contract(contract: dict, dag: dict, lock: dict) -> list[Issue]:
    object_value(contract, 'contract')
    issues = []
    def need(condition, message):
        if not condition:
            issues.append(Issue('EXECUTION_CONTRACT', 0, message))
    verification = contract.get('verification', {})
    need(isinstance(verification, dict) and verification.get('skill') == 'whitebox-verify',
         'Acceptance requires the whitebox-verify adapter; Trinity is not a substitute')
    need(isinstance(verification, dict) and verification.get('mode') in ('Slice', 'Journey'),
         'Freeze Whitebox Slice or Journey acceptance; Debug is diagnosis only')
    runtime = object_value(contract.get('runtime'), 'runtime')
    goal = object_value(contract.get('goal'), 'goal')
    monitor = object_value(contract.get('monitor'), 'monitor')
    need(contract.get('schema_version') == 2, 'Contract requires schema_version 2')
    need(isinstance(runtime.get('agent'), str) and bool(runtime['agent'].strip()), 'Agent identity or portable label must be nonempty text')
    need(runtime.get('parallel_backend') in ('native', 'external', 'serial'), 'Invalid parallel backend')
    need(runtime.get('isolation') in ('worktree', 'copy', 'serial'), 'Invalid isolation')
    need(type(runtime.get('max_workers')) is int and runtime['max_workers'] > 0, 'max_workers must be positive')
    need(bool(strings(runtime.get('capability_evidence'), 'capability_evidence')), 'Record capability evidence')
    if runtime.get('parallel_backend') == 'serial' or runtime.get('isolation') == 'serial':
        need(runtime.get('max_workers') == 1 and all(len(w) == 1 for w in dag['waves']), 'Serial adapter requires singleton waves and one worker')
    required = set(strings(lock.get('acceptance_ids'), 'lock acceptance_ids'))
    need(bool(required), 'At least one acceptance ID required')
    need(isinstance(goal.get('objective'), str) and bool(goal['objective'].strip()), 'Goal objective required')
    need(goal.get('native_option') in ('auto', 'required', 'off'), 'Invalid native goal option')
    need(goal.get('activation') == 'on-execution', 'Goal activation must be on-execution')
    need(set(strings(goal.get('completion_acceptance_ids'), 'goal acceptance_ids')) == required, 'Goal must cover frozen acceptance IDs')
    if 'token_budget' in goal:
        need(type(goal['token_budget']) is int and goal['token_budget'] > 0, 'Token budget must be positive when explicitly supplied')
    need(monitor.get('activation') == 'on-execution', 'Monitor activation must be on-execution')
    need(monitor.get('backend') in ('native', 'external', 'manual'), 'Invalid monitor backend')
    need(type(monitor.get('interval_minutes')) is int and monitor['interval_minutes'] > 0, 'Monitor interval must be positive')
    need(isinstance(monitor.get('timezone'), str) and bool(monitor['timezone'].strip()), 'Monitor timezone required')
    if isinstance(monitor.get('timezone'), str) and monitor['timezone'].strip():
        try:
            ZoneInfo(monitor['timezone'])
        except (ZoneInfoNotFoundError, ValueError):
            try:
                ZoneInfo('UTC')
            except ZoneInfoNotFoundError as error:
                raise ValueError('Timezone database unavailable on this host') from error
            need(False, 'Monitor timezone must be a valid IANA timezone')
    tasks = {t['id']: set(t['acceptance_ids']) for t in dag['tasks']}
    final_id = contract.get('final_verification_task')
    final = next((t for t in dag['tasks'] if t['id'] == final_id), None)
    need(final is not None, 'A final_verification_task in the DAG is required')
    if final:
        need(set(final['acceptance_ids']) == required, 'Final verifier must cover all acceptance IDs')
        need(final['parallel_safe'] is False, 'Final verifier must run serially')
        predecessors, pending = set(), list(final['depends_on'])
        rows = {t['id']: t for t in dag['tasks']}
        while pending:
            task_id = pending.pop()
            if task_id not in predecessors and task_id in rows:
                predecessors.add(task_id)
                pending.extend(rows[task_id]['depends_on'])
        need(set(tasks) - {final_id} <= predecessors, 'Final verifier must depend transitively on all other tasks')
        reports = {'verification-report.md', 'grill-report.md', 'verification-results.json'}
        need(reports <= {PurePosixPath(p).name for p in final['owns']}, 'Final verifier must own the three report files')
    covered, ids = set(), set()
    for check in list_value(contract.get('checks'), 'checks'):
        object_value(check, 'check')
        check_id = check.get('id')
        need(isinstance(check_id, str) and bool(check_id.strip()), 'Check id required')
        if not isinstance(check_id, str):
            continue
        need(check_id not in ids, 'Check IDs must be unique')
        ids.add(check_id)
        for field in ('command', 'expected'):
            need(isinstance(check.get(field), str) and bool(check[field].strip()), f'{check_id}: {field} required')
        linked = set(strings(check.get('task_ids'), 'check task_ids'))
        acceptance = set(strings(check.get('acceptance_ids'), 'check acceptance_ids'))
        need(bool(linked) and linked <= tasks.keys(), f'{check_id}: unknown or missing task')
        need(bool(acceptance) and acceptance <= required, f'{check_id}: unknown or missing acceptance')
        need(acceptance <= set().union(*(tasks[t] for t in linked if t in tasks)), f'{check_id}: task does not own acceptance')
        need(type(check.get('required')) is bool, f'{check_id}: required must be boolean')
        if check.get('required') is True:
            covered.update(acceptance)
        evidence = object_value(check.get('evidence'), 'evidence')
        if check.get('required') is True:
            need(evidence.get('logs') == 'required', f'{check_id}: required executable checks must retain command logs')
        reasons = object_value(check.get('not_applicable_reasons', {}), 'not_applicable_reasons')
        for kind in ('data', 'screenshots', 'logs'):
            need(evidence.get(kind) in ('required', 'not-applicable'), f'{check_id}: missing {kind} evidence policy')
            if evidence.get(kind) == 'not-applicable':
                need(isinstance(reasons.get(kind), str) and bool(reasons[kind].strip()), f'{check_id}: {kind} omission needs reason')
    need(required <= covered, 'Required executable checks must cover every acceptance ID')
    return issues


def validate_bundle(plan: Path, dag_path: Path, lock_path: Path, architecture: Path, contract_path: Path, repo_root: Path) -> list[Issue]:
    repo_root = repo_root.resolve()
    plan_root = plan.resolve().parent
    if not plan_root.is_relative_to(repo_root):
        raise ValueError('Plan root must be within the explicit repository root')
    if any(p.resolve().parent != plan_root for p in (dag_path, lock_path, architecture, contract_path)):
        raise ValueError('All frozen inputs must share the canonical plan root')
    text = plan.read_text(encoding='utf-8')
    dag = json.loads(dag_path.read_text(encoding='utf-8'))
    lock = json.loads(lock_path.read_text(encoding='utf-8'))
    contract = json.loads(contract_path.read_text(encoding='utf-8'))
    issues = validate_plan_text(text) + validate_dag(dag) + validate_drift_lock(lock)
    issues += validate_contract(contract, dag, lock)
    final = next((t for t in dag['tasks'] if t['id'] == contract.get('final_verification_task')), None)
    if final:
        required_reports = {(plan_root / name).resolve() for name in
                            ('verification-report.md', 'grill-report.md', 'verification-results.json')}
        owned_paths = {(repo_root / path).resolve() for path in final['owns']}
        if not required_reports <= owned_paths:
            issues.append(Issue('REPORT_SCOPE', 0, 'Final report ownership must resolve to the three files in this plan root'))
    if lock.get('schema_version') != 2 or lock.get('hash_mode') != 'checkbox-normalized-v1' or dag.get('schema_version') != 2:
        issues.append(Issue('LOCK_SCHEMA', 0, 'Schema 2 and checkbox-normalized-v1 required for handoff'))
    hashes = {'plan_sha256': prose_and_normalized(text)[1].encode(),
              'architecture_sha256': architecture.read_bytes(), 'dag_sha256': dag_path.read_bytes(),
              'execution_contract_sha256': contract_path.read_bytes()}
    for key, data in hashes.items():
        if lock.get(key) != hashlib.sha256(data).hexdigest():
            issues.append(Issue('DRIFT', 0, f'HALT_AND_REPLAN: {key} mismatch'))
    prose, _ = prose_and_normalized(text)
    plan_ids = TASK_RE.findall(prose)
    dag_ids = [task['id'] for task in dag['tasks']]
    if Counter(plan_ids) != Counter(dag_ids):
        issues.append(Issue('TASK_COVERAGE', 0, 'Plan and DAG task IDs differ'))
    required = set(lock['acceptance_ids'])
    mapped = set().union(*(set(t['acceptance_ids']) for t in dag['tasks']))
    if mapped != required:
        issues.append(Issue('ACCEPTANCE_COVERAGE', 0, 'DAG and lock acceptance IDs differ'))
    for match in re.finditer(r'^### Task ([\w-]+):.*?(?=^### Task |\Z)', prose, re.M | re.S):
        found = re.search(r'^\*\*Acceptance IDs:\*\*\s*(.*)$', match[0], re.M)
        actual = set(re.findall(r'[A-Za-z0-9_-]+', found[1])) if found else set()
        expected = next((set(t['acceptance_ids']) for t in dag['tasks'] if t['id'] == match[1]), set())
        if actual != expected:
            issues.append(Issue('ACCEPTANCE_COVERAGE', 0, f'{match[1]} plan and DAG acceptance IDs differ'))
        row = next((t for t in dag['tasks'] if t['id'] == match[1]), None)
        if row:
            fields = dict(re.findall(r'^\*\*([^*]+):\*\*\s*([^\n]*)', match[0], re.M))
            for label, key in (('Dependencies', 'depends_on'), ('Owns', 'owns')):
                value = fields.get(label, '').strip().strip('`')
                declared = set() if value == 'none' else {x.strip().strip('`') for x in value.split(',')}
                if declared != set(row[key]):
                    issues.append(Issue('TASK_CONTRADICTION', 0, f'{match[1]}: {label} differs from DAG'))
            if fields.get('Parallel safe', '').strip().lower() != str(row['parallel_safe']).lower():
                issues.append(Issue('TASK_CONTRADICTION', 0, f'{match[1]}: Parallel safe differs from DAG'))
            interface_text = fields.get('Interfaces', '').strip()
            interfaces = set() if interface_text == 'none' else {x.strip().strip('`') for x in interface_text.split(';')}
            if not interfaces <= set(strings(lock.get('frozen_interfaces'), 'frozen_interfaces')):
                issues.append(Issue('TASK_CONTRADICTION', 0, f'{match[1]}: interface absent from frozen lock'))
    if lock.get('allowed_paths_by_task') != {t['id']: t['owns'] for t in dag['tasks']}:
        issues.append(Issue('LOCK_OWNERSHIP', 0, 'Lock and DAG ownership differ'))
    plan_ref = dag.get('plan_path')
    if not isinstance(plan_ref, str) or (plan.parent / plan_ref).resolve() != plan.resolve():
        issues.append(Issue('PLAN_PATH', 0, 'DAG must reference this canonical plan'))
    if 'openspec/changes/' in str(plan_root.relative_to(repo_root)):
        from openspec_lifecycle import check_sources, change_root
        lifecycle = contract.get('openspec', {})
        try:
            change_id = lifecycle['change_id']
            if change_root(repo_root, change_id) != plan_root:
                raise ValueError('Selected change must match canonical plan root')
            baseline_path = plan_root / 'spec-baseline.json'
            if lifecycle.get('baseline_sha256') != hashlib.sha256(baseline_path.read_bytes()).hexdigest():
                raise ValueError('OpenSpec baseline digest missing or changed')
            baseline = check_sources(repo_root, plan_root)
            if set(baseline['bindings']) != required:
                raise ValueError('OpenSpec scenario bindings and plan acceptance IDs differ')
            if lifecycle.get('policy') != baseline['policy']:
                raise ValueError('Closeout policy differs from frozen OpenSpec baseline')
        except (ValueError, OSError, KeyError, TypeError) as error:
            issues.append(Issue('OPENSPEC_LIFECYCLE', 0, str(error)))
    return issues


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', type=Path, required=True)
    for name in ('dag', 'lock', 'architecture', 'contract', 'repo-root'):
        parser.add_argument('--' + name, type=Path)
    args = parser.parse_args()
    full = all((args.dag, args.lock, args.architecture, args.contract))
    try:
        if args.contract or args.architecture:
            if not full:
                raise ValueError('Full handoff requires plan, dag, lock, architecture and contract')
            if not args.repo_root:
                raise ValueError('Full handoff requires --repo-root to validate report ownership')
            issues = validate_bundle(args.plan, args.dag, args.lock, args.architecture, args.contract, args.repo_root)
        else:
            issues = validate_plan_text(args.plan.read_text(encoding='utf-8'))
            if args.dag:
                issues += validate_dag(json.loads(args.dag.read_text(encoding='utf-8')))
            if args.lock:
                issues += validate_drift_lock(json.loads(args.lock.read_text(encoding='utf-8')))
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(json.dumps({'valid': False, 'handoff_ready': False, 'error': str(error)}, ensure_ascii=False))
        return 2
    print(json.dumps({'valid': not issues, 'handoff_ready': full and not issues,
                      'issues': [asdict(i) for i in issues]}, ensure_ascii=False))
    return 1 if issues else 0


if __name__ == '__main__':
    raise SystemExit(main())
