import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'validate_test_pack.py'


class TestPackValidation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'repo'
        self.root.mkdir()
        for name, content in [('req.md', 'A requirement'), ('source.py', '# source'),
                              ('test_example.py', '# test'), ('red.log', 'assertion failed')]:
            (self.root / name).write_text(content)
        self.pack = {
            'schema_version': 'test-authoring/v1', 'mode': 'design', 'status': 'design_only',
            'project_root': str(self.root),
            'basis': [{'id': 'R1', 'kind': 'requirement', **self.file('req.md')},
                      {'id': 'S1', 'kind': 'source', **self.file('source.py')}],
            'requirements': ['R1'],
            'dimensions': {f'Journey-{c}': {'required': False, 'reason': 'Out of scope',
                           'basis_ids': ['S1'], 'case_ids': []} for c in 'ABCDEFGHIJ'},
            'cases': [], 'unresolved': [{'requirement_ids': ['R1'], 'question': 'Confirm expected behavior'}],
            'self_checks': []}

    def file(self, name):
        return {'path': name, 'sha256': hashlib.sha256((self.root / name).read_bytes()).hexdigest()}

    def add_case(self):
        self.pack['unresolved'] = []
        self.pack['dimensions']['Journey-A'].update(required=True, case_ids=['C1'])
        self.pack['cases'] = [{'id': 'C1', 'requirement_ids': ['R1'], 'dimensions': ['Journey-A'],
            'level': 'unit', 'priority': 'P0', 'preconditions': ['Fixture exists'], 'inputs': {},
            'steps': ['Check result'], 'oracle': {'basis_id': 'R1', 'expected': True,
            'authority': 'req.md'}, 'cleanup': ['Remove fixture'], 'evidence_plan': ['Capture result'],
            'automation': None}]

    def automated(self):
        self.add_case()
        self.pack.update(mode='automate', status='ready_for_acceptance')
        self.pack['cases'][0]['automation'] = {**self.file('test_example.py'), 'test_id': 'test_result',
                                               'command': ['python3', 'test_example.py']}
        log = self.file('red.log')
        self.pack['self_checks'] = [{'command': ['python3', 'test_example.py'], 'exit_code': 1,
            'expected': 'expected_failure', 'log_path': log['path'], 'log_sha256': log['sha256']}]

    def run_pack(self, valid=True, raw=None, root=None):
        self.assertTrue(SCRIPT.is_file(), 'TestPack validator has not been implemented')
        path = self.root / 'pack.json'
        path.write_text(json.dumps(self.pack) if raw is None else raw)
        result = subprocess.run([sys.executable, str(SCRIPT), str(path), '--project-root',
                                 str(root or self.root)], capture_output=True, text=True)
        if valid:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stdout.strip(), 'PACK_STRUCTURE_VALID')
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout)
            self.assertNotIn('PACK_STRUCTURE_VALID', result.stdout)
            self.assertNotIn('Traceback', result.stderr)
        return result

    def test_valid_design_all_unresolved(self):
        self.run_pack()

    def test_design_required_dimension_can_await_explicit_unresolved_basis(self):
        self.pack['dimensions']['Journey-A'].update(required=True, basis_ids=['R1'])
        self.run_pack()

    def test_design_required_empty_dimension_needs_unresolved_requirement_basis(self):
        self.pack['dimensions']['Journey-A']['required'] = True
        self.run_pack(False)

    def test_valid_design_case(self):
        self.add_case()
        self.run_pack()

    def test_valid_automated_expected_red(self):
        self.automated()
        self.run_pack()

    def test_valid_automated_pass(self):
        self.automated()
        self.pack['self_checks'][0].update(expected='pass', exit_code=0)
        self.run_pack()

    def test_commands_are_inert_and_files_unchanged(self):
        self.automated()
        marker = self.root / 'MUST_NOT_EXIST'
        command = [sys.executable, '-c', f'from pathlib import Path; Path({str(marker)!r}).write_text("executed")']
        self.pack['cases'][0]['automation']['command'] = command
        self.pack['self_checks'][0]['command'] = command
        before = {p.name: p.read_bytes() for p in self.root.iterdir()}
        self.run_pack()
        self.assertFalse(marker.exists())
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.root.iterdir() if p.name != 'pack.json'})

    def test_missing_oracle(self):
        self.add_case()
        del self.pack['cases'][0]['oracle']
        self.run_pack(False)

    def test_invalid_basis_and_requirement_references(self):
        for change in ['stale', 'missing', 'absolute', 'escape', 'duplicate_basis', 'namespace',
                       'dangling', 'duplicate_requirement', 'omitted_requirement', 'source_requirement']:
            with self.subTest(change=change):
                original = copy.deepcopy(self.pack)
                if change == 'stale': self.pack['basis'][0]['sha256'] = '0' * 64
                elif change == 'missing': self.pack['basis'][0]['path'] = 'fake.md'
                elif change == 'absolute': self.pack['basis'][0]['path'] = str(self.root / 'req.md')
                elif change == 'escape': self.pack['basis'][0]['path'] = '../outside.md'
                elif change == 'duplicate_basis': self.pack['basis'].append(copy.deepcopy(self.pack['basis'][0]))
                elif change == 'namespace':
                    self.pack['dimensions']['Debug-A'] = self.pack['dimensions'].pop('Journey-A')
                elif change == 'dangling': self.pack['dimensions']['Journey-A']['basis_ids'] = ['NOPE']
                elif change == 'duplicate_requirement': self.pack['requirements'].append('R1')
                elif change == 'omitted_requirement': self.pack['unresolved'] = []
                elif change == 'source_requirement': self.pack['requirements'] = ['S1']
                self.run_pack(False)
                self.pack = original

    def test_symlink_escaping_root_rejected_even_with_matching_hash(self):
        outside = self.root.parent / 'outside.md'
        outside.write_text('A requirement')
        (self.root / 'link.md').symlink_to(outside)
        self.pack['basis'][0]['path'] = 'link.md'
        self.run_pack(False)

    def test_in_root_symlink_allowed(self):
        (self.root / 'link.md').symlink_to(self.root / 'req.md')
        self.pack['basis'][0]['path'] = 'link.md'
        self.run_pack()

    def test_relative_path_resolving_inside_root_allowed(self):
        (self.root / 'sub').mkdir()
        self.pack['basis'][0]['path'] = 'sub/../req.md'
        self.run_pack()

    def test_directory_not_regular_file(self):
        self.pack['basis'][0]['path'] = '.'
        self.run_pack(False)

    def test_trusted_root_mismatch(self):
        self.run_pack(False, root=self.root.parent)

    def test_root_alias_resolved_equality(self):
        alias = self.root.parent / 'alias'
        alias.symlink_to(self.root, target_is_directory=True)
        self.pack['project_root'] = str(alias)
        self.run_pack()

    def test_dimension_and_case_consistency(self):
        self.add_case()
        for field, value in [('dimensions', []), ('dimensions', ['Journey-B']),
                             ('dimensions', ['Journey-A', 'Journey-A']), ('requirement_ids', ['S1']),
                             ('requirement_ids', ['R1', 'R1']), ('level', 'magic'), ('priority', 'P3')]:
            with self.subTest(field=field, value=value):
                old = self.pack['cases'][0][field]
                self.pack['cases'][0][field] = value
                self.run_pack(False)
                self.pack['cases'][0][field] = old
        self.pack['dimensions']['Journey-A']['required'] = False
        self.run_pack(False)

    def test_dimension_shape_and_boolean(self):
        for change in ['missing', 'extra', 'boolean', 'dangling_case', 'duplicate_case', 'required_empty']:
            with self.subTest(change=change):
                original = copy.deepcopy(self.pack)
                if change == 'missing': del self.pack['dimensions']['Journey-J']
                elif change == 'extra': self.pack['dimensions']['Journey-K'] = {}
                elif change == 'boolean': self.pack['dimensions']['Journey-A']['required'] = 1
                elif change == 'dangling_case': self.pack['dimensions']['Journey-A']['case_ids'] = ['C9']
                elif change == 'duplicate_case': self.pack['dimensions']['Journey-A']['case_ids'] = ['C9', 'C9']
                elif change == 'required_empty': self.pack['dimensions']['Journey-A']['required'] = True
                self.run_pack(False)
                self.pack = original

    def test_duplicate_case_ids(self):
        self.add_case()
        self.pack['cases'].append(copy.deepcopy(self.pack['cases'][0]))
        self.run_pack(False)

    def test_oracle_membership_and_scalar_types(self):
        self.add_case()
        for value in [None, '', [], {}, float('nan'), float('inf')]:
            with self.subTest(value=value):
                self.pack['cases'][0]['oracle']['expected'] = value
                self.run_pack(False)
        self.pack['cases'][0]['oracle'].update(expected=0, basis_id='S1')
        self.run_pack(False)

    def test_oracle_basis_belongs_to_case_requirements(self):
        self.add_case()
        self.pack['basis'].append({'id': 'R2', 'kind': 'requirement', **self.file('req.md')})
        self.pack['requirements'].append('R2')
        self.pack['unresolved'] = [{'requirement_ids': ['R2'], 'question': 'Pending'}]
        self.pack['cases'][0]['oracle']['basis_id'] = 'R2'
        self.run_pack(False)

    def test_design_cannot_claim_execution(self):
        self.automated()
        self.pack.update(mode='design', status='design_only')
        self.run_pack(False)

    def test_automation_invariants(self):
        self.automated()
        for change in ['no_checks', 'null_automation', 'stale_automation', 'unresolved', 'bad_status',
                       'stale_log', 'fake_log', 'bool_exit', 'pass_red', 'failure_green', 'bad_expected',
                       'string_command', 'empty_command', 'empty_argv']:
            with self.subTest(change=change):
                original = copy.deepcopy(self.pack)
                check = self.pack['self_checks'][0]
                if change == 'no_checks': self.pack['self_checks'] = []
                elif change == 'null_automation': self.pack['cases'][0]['automation'] = None
                elif change == 'stale_automation': self.pack['cases'][0]['automation']['sha256'] = '0' * 64
                elif change == 'unresolved': self.pack['unresolved'] = [{'requirement_ids': ['R1'], 'question': 'Pending'}]
                elif change == 'bad_status': self.pack['status'] = 'design_only'
                elif change == 'stale_log': check['log_sha256'] = '0' * 64
                elif change == 'fake_log': check['log_path'] = 'imagined.log'
                elif change == 'bool_exit': check['exit_code'] = True
                elif change == 'pass_red': check['expected'] = 'pass'
                elif change == 'failure_green': check['exit_code'] = 0
                elif change == 'bad_expected': check['expected'] = 'PASS'
                elif change == 'string_command': check['command'] = 'python3 test_example.py'
                elif change == 'empty_command': check['command'] = []
                elif change == 'empty_argv': check['command'] = ['']
                self.run_pack(False)
                self.pack = original

    def test_automation_and_log_paths_cannot_escape(self):
        self.automated()
        original = copy.deepcopy(self.pack)
        outside = self.root.parent / 'outside'
        outside.write_text('external file')
        digest = hashlib.sha256(outside.read_bytes()).hexdigest()
        (self.root / 'outside-link').symlink_to(outside)
        for location in ['automation', 'log']:
            for path in [str(outside), '../outside', 'outside-link']:
                with self.subTest(location=location, path=path):
                    self.pack = copy.deepcopy(original)
                    if location == 'automation':
                        self.pack['cases'][0]['automation'].update(path=path, sha256=digest)
                    else:
                        self.pack['self_checks'][0].update(log_path=path, log_sha256=digest)
                    self.run_pack(False)

    def test_nested_types_and_nonempty_fields(self):
        self.automated()
        original = copy.deepcopy(self.pack)
        changes = [
            (['cases', 0, 'preconditions'], []),
            (['cases', 0, 'steps'], ['']),
            (['cases', 0, 'cleanup'], 'cleanup'),
            (['cases', 0, 'evidence_plan'], [True]),
            (['cases', 0, 'inputs'], []),
            (['cases', 0, 'oracle', 'authority'], ''),
            (['cases', 0, 'automation', 'test_id'], ''),
            (['cases', 0, 'automation', 'command'], 'python3'),
            (['basis', 0, 'kind'], 'invented'),
            (['basis', 0, 'sha256'], True),
            (['basis', 0, 'id'], 1),
            (['requirements'], []),
            (['dimensions', 'Journey-A', 'reason'], ''),
            (['dimensions', 'Journey-A', 'basis_ids'], []),
            (['mode'], True), (['schema_version'], 'v0'),
            (['project_root'], '.'),
        ]
        for path, value in changes:
            with self.subTest(path=path, value=value):
                self.pack = copy.deepcopy(original)
                target = self.pack
                for part in path[:-1]:
                    target = target[part]
                target[path[-1]] = value
                self.run_pack(False)

    def test_unresolved_requires_real_unique_requirement_ids_and_question(self):
        original = copy.deepcopy(self.pack)
        for row in [{}, {'requirement_ids': ['S1'], 'question': 'Pending'},
                    {'requirement_ids': ['R1', 'R1'], 'question': 'Pending'},
                    {'requirement_ids': ['R1'], 'question': ''}]:
            with self.subTest(row=row):
                self.pack = copy.deepcopy(original)
                self.pack['unresolved'] = [row]
                self.run_pack(False)

    def test_same_id_in_basis_and_case_namespaces_allowed(self):
        self.add_case()
        self.pack['cases'][0]['id'] = 'R1'
        self.pack['dimensions']['Journey-A']['case_ids'] = ['R1']
        self.run_pack()

    def test_reserved_acceptance_fields(self):
        for key in ['acceptance_verdict', 'verdict', 'overall_passed', 'accepted']:
            self.pack[key] = False
            self.run_pack(False)
            del self.pack[key]

    def test_unknown_metadata_allowed(self):
        self.pack['notes'] = 'Review manually'
        self.run_pack()

    def test_malformed_json_and_duplicate_json_keys(self):
        self.run_pack(False, raw='{')
        self.run_pack(False, raw='{"mode":"design","mode":"automate"}')
        self.run_pack(False, raw='[]')

    def test_required_fields_and_collection_types(self):
        for field in list(self.pack):
            with self.subTest(field=field):
                value = self.pack.pop(field)
                self.run_pack(False)
                self.pack[field] = value
        for field in ['basis', 'requirements', 'dimensions', 'cases', 'unresolved', 'self_checks']:
            with self.subTest(field=field):
                value = self.pack[field]
                self.pack[field] = None
                self.run_pack(False)
                self.pack[field] = value


if __name__ == '__main__':
    unittest.main()
