#!/usr/bin/env python3
from __future__ import annotations

import re

TOKENS = {
    "PLAN_PATH": None,
    "ARCH_PATH": None,
    "DAG_PATH": None,
    "LOCK_PATH": None,
    "PLAN_SHA256": None,
    "ARCH_SHA256": None,
}
HASH_RE = re.compile(r"^[0-9a-f]{64}$")


def render_prompt(
    template: str,
    plan_path: str,
    architecture_path: str,
    dag_path: str,
    lock_path: str,
    plan_sha256: str,
    architecture_sha256: str,
) -> str:
    values = {
        "PLAN_PATH": plan_path,
        "ARCH_PATH": architecture_path,
        "DAG_PATH": dag_path,
        "LOCK_PATH": lock_path,
        "PLAN_SHA256": plan_sha256,
        "ARCH_SHA256": architecture_sha256,
    }
    for key in TOKENS:
        if "{{" + key + "}}" not in template:
            raise ValueError(f"missing token: {key}")
    for key in ("PLAN_SHA256", "ARCH_SHA256"):
        if not HASH_RE.fullmatch(values[key]):
            raise ValueError(f"{key} must be lowercase SHA-256")
    result = template
    for key, value in values.items():
        result = result.replace("{{" + key + "}}", value)
    if "{{" in result or "}}" in result:
        raise ValueError("unresolved template token")
    return result


def main() -> int:
    import argparse
    import json
    from pathlib import Path
    from plan_guard import validate_bundle

    parser = argparse.ArgumentParser(description='Validate and render a portable agent execution handoff')
    for name in ('plan', 'architecture', 'dag', 'lock', 'contract', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--repo-root', type=Path, required=True, help='Repository root for ownership checks and portable paths')
    args = parser.parse_args()
    try:
        inputs = (args.plan, args.dag, args.lock, args.architecture, args.contract)
        if any(args.output.resolve() == p.resolve() or
               (args.output.exists() and p.exists() and args.output.samefile(p)) for p in inputs):
            raise ValueError('Output must not overwrite or alias a frozen input')
        issues = validate_bundle(args.plan, args.dag, args.lock, args.architecture, args.contract, args.repo_root)
        if issues:
            from dataclasses import asdict
            print(json.dumps({'valid': False, 'issues': [asdict(i) for i in issues]}))
            return 1
        root = args.plan.resolve().parent
        paths = [args.plan, args.architecture, args.dag, args.lock, args.contract, args.output]
        if any(p.resolve().parent != root for p in paths):
            raise ValueError('All handoff files and output must share the canonical plan root')
        plan_root = str(root.relative_to(args.repo_root.resolve()))
        lock = json.loads(args.lock.read_text(encoding='utf-8'))
        references = Path(__file__).resolve().parents[1] / 'references'
        template = (references / 'execution-prompt-template.md').read_text(encoding='utf-8')
        # Resolve extra schema-2 fields before using the backward-compatible renderer.
        for name, value in {
            'PLAN_ROOT': plan_root,
            'CONTRACT_PATH': args.contract.name,
            'DAG_SHA256': lock['dag_sha256'],
            'CONTRACT_SHA256': lock['execution_contract_sha256'],
        }.items():
            template = template.replace('{{' + name + '}}', value)
        result = render_prompt(template, args.plan.name, args.architecture.name,
                               args.dag.name, args.lock.name,
                               lock['plan_sha256'], lock['architecture_sha256'])
        # Carry essential behavior across hosts even when the target lacks this skill.
        for name in ('parallel-execution.md', 'automation.md', 'completion-verification.md', 'openspec-closeout.md'):
            result += '\n\n' + (references / name).read_text(encoding='utf-8')
        args.output.write_text(result, encoding='utf-8')
        print(json.dumps({'valid': True, 'output': str(args.output), 'automation_status': 'PLANNED'}))
        return 0
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(json.dumps({'valid': False, 'error': str(error)}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
