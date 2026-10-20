#!/usr/bin/env python3
"""Read-only TestPack v1 structural validation; never run pack commands."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys


class InvalidPack(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise InvalidPack(message)


def obj(value, fields, label):
    require(isinstance(value, dict), f'{label}: expected object')
    require(set(fields) <= value.keys(), f'{label}: missing required fields')
    return value


def string(value, label):
    require(isinstance(value, str) and bool(value.strip()), f'{label}: expected nonempty string')
    return value


def array(value, label, nonempty=False):
    require(isinstance(value, list), f'{label}: expected array')
    require(not nonempty or bool(value), f'{label}: must not be empty')
    return value


def strings(value, label, nonempty=True, unique=False):
    array(value, label, nonempty)
    for item in value:
        string(item, label)
    require(not unique or len(set(value)) == len(value), f'{label}: duplicate references')
    return value


def refs(value, allowed, label, nonempty=True):
    strings(value, label, nonempty, unique=True)
    require(set(value) <= allowed, f'{label}: unknown reference')
    return set(value)


def hashed_file(root, relative, digest, label):
    string(relative, label)
    path = Path(relative)
    require(not path.is_absolute(), f'{label}: path must be relative')
    resolved = (root / path).resolve(strict=True)
    require(resolved == root or root in resolved.parents, f'{label}: path escapes trusted root')
    require(resolved.is_file(), f'{label}: expected regular file')
    require(isinstance(digest, str) and re.fullmatch(r'[0-9a-f]{64}', digest) is not None,
            f'{label}: expected lowercase SHA256')
    require(hashlib.sha256(resolved.read_bytes()).hexdigest() == digest, f'{label}: SHA256 mismatch')


def indexed(rows, label, fields):
    array(rows, label)
    result = {}
    for row in rows:
        obj(row, fields, label)
        identifier = string(row['id'], f'{label}.id')
        require(identifier not in result, f'{label}: duplicate ID {identifier}')
        result[identifier] = row
    return result


def validate(pack, trusted_root):
    root = Path(trusted_root).resolve(strict=True)
    require(root.is_dir(), 'trusted project root must be an existing directory')
    obj(pack, ['schema_version', 'mode', 'status', 'project_root', 'basis', 'requirements',
               'dimensions', 'cases', 'unresolved', 'self_checks'], 'pack')
    require(not {'acceptance_verdict', 'verdict', 'overall_passed', 'accepted'} & pack.keys(),
            'pack: acceptance verdict fields are forbidden')
    require(pack['schema_version'] == 'test-authoring/v1', 'unsupported schema_version')
    require(pack['mode'] in ('design', 'automate'), 'invalid mode')
    design = pack['mode'] == 'design'
    require(pack['status'] == ('design_only' if design else 'ready_for_acceptance'),
            'status does not match mode')
    project = Path(string(pack['project_root'], 'project_root'))
    require(project.is_absolute(), 'project_root must be absolute')
    require(project.resolve(strict=True) == root, 'project_root differs from trusted CLI root')

    basis = indexed(pack['basis'], 'basis', ['id', 'kind', 'path', 'sha256'])
    require(bool(basis), 'basis must not be empty')
    for row in basis.values():
        require(row['kind'] in ('requirement', 'source'), 'basis: invalid kind')
        hashed_file(root, row['path'], row['sha256'], 'basis')
    requirements = refs(pack['requirements'], set(basis), 'requirements')
    require(requirements == {key for key, row in basis.items() if row['kind'] == 'requirement'},
            'requirements must list every requirement basis ID exactly')

    dimension_ids = {f'Journey-{c}' for c in 'ABCDEFGHIJ'}
    dimensions = obj(pack['dimensions'], dimension_ids, 'dimensions')
    require(set(dimensions) == dimension_ids, 'dimensions must be exactly Journey-A through Journey-J')
    cases = indexed(pack['cases'], 'cases', ['id', 'requirement_ids', 'dimensions', 'level',
                    'priority', 'preconditions', 'inputs', 'steps', 'oracle', 'cleanup',
                    'evidence_plan', 'automation'])
    memberships = {key: set() for key in dimension_ids}
    covered = set()
    for key, case in cases.items():
        case_requirements = refs(case['requirement_ids'], requirements, 'case.requirement_ids')
        covered |= case_requirements
        for dimension in refs(case['dimensions'], dimension_ids, 'case.dimensions'):
            memberships[dimension].add(key)
        require(case['level'] in ('unit', 'integration', 'api', 'contract', 'property', 'e2e'),
                'case: invalid level')
        require(case['priority'] in ('P0', 'P1', 'P2'), 'case: invalid priority')
        for field in ('preconditions', 'steps', 'cleanup', 'evidence_plan'):
            strings(case[field], f'case.{field}')
        obj(case['inputs'], [], 'case.inputs')
        oracle = obj(case['oracle'], ['basis_id', 'expected', 'authority'], 'case.oracle')
        string(oracle['basis_id'], 'oracle.basis_id')
        require(oracle['basis_id'] in case_requirements,
                'oracle basis must belong to this case requirement_ids')
        expected = oracle['expected']
        require(type(expected) in (str, int, float, bool), 'oracle.expected must be scalar')
        if isinstance(expected, str):
            string(expected, 'oracle.expected')
        if isinstance(expected, float):
            require(math.isfinite(expected), 'oracle.expected must be finite')
        string(oracle['authority'], 'oracle.authority')
        automation = case['automation']
        if design:
            require(automation is None, 'design cases must have automation:null')
        else:
            obj(automation, ['path', 'sha256', 'test_id', 'command'], 'case.automation')
            hashed_file(root, automation['path'], automation['sha256'], 'automation')
            string(automation['test_id'], 'automation.test_id')
            strings(automation['command'], 'automation.command')

    unresolved = array(pack['unresolved'], 'unresolved')
    pending = set()
    for row in unresolved:
        obj(row, ['requirement_ids', 'question'], 'unresolved')
        pending |= refs(row['requirement_ids'], requirements, 'unresolved.requirement_ids')
        string(row['question'], 'unresolved.question')
    require(requirements <= covered | pending, 'requirement neither covered nor explicitly unresolved')
    for key, dimension in dimensions.items():
        obj(dimension, ['required', 'reason', 'basis_ids', 'case_ids'], key)
        require(type(dimension['required']) is bool, f'{key}.required must be boolean')
        string(dimension['reason'], f'{key}.reason')
        dimension_basis = refs(dimension['basis_ids'], set(basis), f'{key}.basis_ids')
        linked = refs(dimension['case_ids'], set(cases), f'{key}.case_ids', nonempty=False)
        if dimension['required']:
            require(bool(linked) or (design and bool(dimension_basis & pending)),
                    f'{key}: required needs cases or explicit unresolved requirement basis in design')
        else:
            require(not linked, f'{key}: N/A forbids cases')
        require(linked == memberships[key], f'{key}: case dimension memberships differ')

    checks = array(pack['self_checks'], 'self_checks')
    if design:
        require(not checks, 'design self_checks must be empty')
    else:
        require(not unresolved, 'automate cannot have unresolved requirements')
        require(bool(checks), 'automate requires self_checks')
    for check in checks:
        obj(check, ['command', 'exit_code', 'expected', 'log_path', 'log_sha256'], 'self_check')
        strings(check['command'], 'self_check.command')
        require(type(check['exit_code']) is int, 'self_check.exit_code must be integer, not bool')
        require(check['expected'] in ('pass', 'expected_failure'), 'self_check: invalid expected')
        require((check['exit_code'] == 0) == (check['expected'] == 'pass'),
                'self_check exit_code does not match expected')
        hashed_file(root, check['log_path'], check['log_sha256'], 'self_check log')


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f'duplicate JSON key: {key}')
        result[key] = value
    return result


def reject_constant(value):
    raise InvalidPack(f'non-JSON numeric constant: {value}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pack')
    parser.add_argument('--project-root', required=True)
    args = parser.parse_args()
    try:
        with open(args.pack, encoding='utf-8') as stream:
            pack = json.load(stream, object_pairs_hook=unique_object,
                             parse_constant=reject_constant)
        validate(pack, args.project_root)
    except (InvalidPack, OSError, ValueError, RuntimeError) as error:
        print(f'PACK_STRUCTURE_INVALID: {error}', file=sys.stderr)
        return 1
    print('PACK_STRUCTURE_VALID')
    return 0


if __name__ == '__main__':
    sys.exit(main())
