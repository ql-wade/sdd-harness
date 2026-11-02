import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import plan_guard as guard

PLAN = '''# Implementation Plan
**Goal:** Return a valid result
**Architecture:** One pure function
**Tech Stack:** Python
## Global Constraints
No external writes.
### Task T1: Validate input
**Files:** src/check.py
**Interfaces:** check(value)
**Dependencies:** none
**Owns:** src/check.py
**Parallel safe:** true
**Acceptance IDs:** AC1
- [ ] **Step 1 [3 min]: Test** invalid input, observe RED, implement GREEN.
- [ ] **Step 2 [2 min]: Commit** validated behavior.
### Task VERIFY: Final evidence verification
**Files:** verification-report.md, grill-report.md, verification-results.json
**Interfaces:** none
**Dependencies:** T1
**Owns:** verification-report.md, grill-report.md, verification-results.json
**Parallel safe:** false
**Acceptance IDs:** AC1
- [ ] **Step 1 [5 min]: Verify** Trinity results and data, screenshot applicability, logs.
- [ ] **Step 2 [2 min]: Commit** final reports after acceptance.
'''
DAG = {'schema_version': 2, 'plan_path': 'tasks.md', 'tasks': [
    {'id': 'T1', 'depends_on': [], 'owns': ['src/check.py'],
     'parallel_safe': True, 'acceptance_ids': ['AC1']},
    {'id': 'VERIFY', 'depends_on': ['T1'],
     'owns': ['verification-report.md', 'grill-report.md', 'verification-results.json'],
     'parallel_safe': False, 'acceptance_ids': ['AC1']}], 'waves': [['T1'], ['VERIFY']]}
CONTRACT = {'schema_version': 2,
    'verification': {'skill': 'whitebox-verify', 'mode': 'Slice'},
    'final_verification_task': 'VERIFY',
    'runtime': {'agent': 'any-agent', 'parallel_backend': 'native',
                'max_workers': 2, 'isolation': 'worktree',
                'capability_evidence': ['Current runtime exposes worker dispatch']},
    'goal': {'objective': 'AC1 verified with evidence', 'native_option': 'auto',
             'activation': 'on-execution', 'completion_acceptance_ids': ['AC1']},
    'monitor': {'interval_minutes': 20, 'backend': 'native',
                'activation': 'on-execution', 'timezone': 'Asia/Shanghai'},
    'checks': [{'id': 'V1', 'task_ids': ['T1'], 'acceptance_ids': ['AC1'],
                'command': 'python3 -m unittest', 'expected': 'All tests pass',
                'required': True,
                'evidence': {'data': 'required', 'screenshots': 'not-applicable',
                             'logs': 'required'},
                'not_applicable_reasons': {'screenshots': 'Pure CLI; no UI'}}]}


class PlannerTests(unittest.TestCase):
    def test_neutral_plan_does_not_require_superpowers(self):
        self.assertEqual([], guard.validate_plan_text(PLAN))

    def test_empty_plan_is_rejected(self):
        self.assertTrue(guard.validate_plan_text(PLAN.split('### Task')[0]))

    def test_duplicate_task_is_rejected(self):
        dag = copy.deepcopy(DAG)
        dag['tasks'].append(copy.deepcopy(dag['tasks'][0]))
        self.assertTrue(guard.validate_dag(dag))

    def test_missing_wave_is_rejected(self):
        dag = copy.deepcopy(DAG)
        dag['waves'] = []
        self.assertTrue(guard.validate_dag(dag))

    def test_unknown_wave_task_is_rejected_without_crash(self):
        dag = copy.deepcopy(DAG)
        dag['waves'] = [['unknown']]
        self.assertTrue(guard.validate_dag(dag))

    def test_parent_path_cannot_escape_ownership(self):
        dag = copy.deepcopy(DAG)
        dag['tasks'][0]['owns'] = ['../outside']
        self.assertTrue(guard.validate_dag(dag))

    def test_shared_path_is_not_parallel_safe(self):
        dag = copy.deepcopy(DAG)
        second = copy.deepcopy(dag['tasks'][0])
        second['id'] = 'T2'
        dag['tasks'].append(second)
        dag['waves'] = [['T1', 'T2']]
        self.assertTrue(guard.validate_dag(dag))

    def make_bundle(self, root, contract=None, plan=PLAN):
        contract = copy.deepcopy(CONTRACT if contract is None else contract)
        files = {'tasks.md': plan, 'architecture.md': 'One pure function.\n',
                 'task-dag.json': json.dumps(DAG),
                 'execution-contract.json': json.dumps(contract)}
        for name, value in files.items():
            (root / name).write_text(value)
        digest = lambda s: hashlib.sha256(s.encode()).hexdigest()
        lock = {'schema_version': 2, 'hash_mode': 'checkbox-normalized-v1',
                'feature': 'input-check', 'plan_sha256': digest(PLAN),
                'architecture_sha256': digest(files['architecture.md']),
                'dag_sha256': digest(files['task-dag.json']),
                'execution_contract_sha256': digest(files['execution-contract.json']),
                'acceptance_ids': ['AC1'], 'allowed_paths_by_task': {t['id']:t['owns'] for t in DAG['tasks']},
                'frozen_interfaces': ['check(value)'], 'global_constraints': ['No external writes'],
                'assumptions': [], 'change_policy': 'halt-and-replan'}
        (root / 'drift-lock.json').write_text(json.dumps(lock))

    def run_guard(self, root):
        return subprocess.run([sys.executable, str(ROOT/'scripts/plan_guard.py'),
            '--plan', str(root/'tasks.md'), '--dag', str(root/'task-dag.json'),
            '--lock', str(root/'drift-lock.json'), '--architecture', str(root/'architecture.md'),
            '--contract', str(root/'execution-contract.json'), '--repo-root', str(root)], capture_output=True, text=True)

    def check_contract(self, mutate, valid=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            contract = copy.deepcopy(CONTRACT)
            mutate(contract)
            self.make_bundle(root, contract)
            result = self.run_guard(root)
            self.assertEqual(0 if valid else 1, result.returncode, result.stdout + result.stderr)

    def test_full_bundle_accepted(self):
        self.check_contract(lambda c: None, valid=True)

    def test_whitebox_is_required_acceptance_adapter(self):
        self.check_contract(lambda c: c.pop('verification'))
        self.check_contract(lambda c: c['verification'].update(skill='trinity-verify'))
        self.check_contract(lambda c: c['verification'].update(mode='Debug'))

    def test_missing_final_verification_rejected(self):
        self.check_contract(lambda c: c.pop('final_verification_task'))

    def test_implementation_task_cannot_replace_final_verification(self):
        self.check_contract(lambda c: c.update(final_verification_task='T1'))

    def test_frozen_but_contradictory_prose_is_rejected(self):
        for old, new in [('**Dependencies:** none', '**Dependencies:** T999'),
                         ('**Owns:** src/check.py', '**Owns:** secrets/config.env'),
                         ('**Parallel safe:** true', '**Parallel safe:** false'),
                         ('**Interfaces:** check(value)', '**Interfaces:** write_secret(value)')]:
            with self.subTest(field=old), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                plan = PLAN.replace(old,new)
                self.make_bundle(root,plan=plan)
                lock = json.loads((root/'drift-lock.json').read_text())
                lock['plan_sha256'] = hashlib.sha256(plan.encode()).hexdigest()
                (root/'drift-lock.json').write_text(json.dumps(lock))
                self.assertEqual(1,self.run_guard(root).returncode)

    def test_final_verification_must_depend_on_other_work(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plan = PLAN.replace('**Dependencies:** T1','**Dependencies:** none')
            self.make_bundle(root,plan=plan)
            dag = copy.deepcopy(DAG)
            dag['tasks'][1]['depends_on'] = []
            dag_text = json.dumps(dag)
            (root/'task-dag.json').write_text(dag_text)
            lock = json.loads((root/'drift-lock.json').read_text())
            lock['plan_sha256'] = hashlib.sha256(plan.encode()).hexdigest()
            lock['dag_sha256'] = hashlib.sha256(dag_text.encode()).hexdigest()
            (root/'drift-lock.json').write_text(json.dumps(lock))
            self.assertEqual(1,self.run_guard(root).returncode)

    def test_goal_coverage_required(self):
        self.check_contract(lambda c: c['goal'].update(completion_acceptance_ids=[]))

    def test_required_check_cannot_omit_command_logs(self):
        self.check_contract(lambda c: c['checks'][0].update(
            evidence={'data':'not-applicable','screenshots':'not-applicable','logs':'not-applicable'},
            not_applicable_reasons={'data':'No data captured','screenshots':'No UI','logs':'Logger unavailable'}))

    def test_runtime_agent_must_be_text(self):
        self.check_contract(lambda c: c['runtime'].update(agent={'name':'test-agent'}))

    def test_monitor_timezone_must_exist(self):
        self.check_contract(lambda c: c['monitor'].update(timezone='Mars/Olympus'))

    def test_duplicate_task_fields_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            plan=PLAN.replace('**Owns:** src/check.py','**Owns:** secrets/config.env\n**Owns:** src/check.py')
            self.make_bundle(root,plan=plan)
            lock=json.loads((root/'drift-lock.json').read_text())
            lock['plan_sha256']=hashlib.sha256(plan.encode()).hexdigest()
            (root/'drift-lock.json').write_text(json.dumps(lock))
            self.assertEqual(1,self.run_guard(root).returncode)

    def test_final_reports_must_belong_to_plan_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            self.make_bundle(root)
            plan=PLAN
            dag=copy.deepcopy(DAG)
            for name in ['verification-report.md','grill-report.md','verification-results.json']:
                plan=plan.replace(name,'unrelated/'+name)
            dag['tasks'][1]['owns']=['unrelated/'+x for x in dag['tasks'][1]['owns']]
            (root/'tasks.md').write_text(plan)
            dag_text=json.dumps(dag);(root/'task-dag.json').write_text(dag_text)
            lock=json.loads((root/'drift-lock.json').read_text())
            lock.update(plan_sha256=hashlib.sha256(plan.encode()).hexdigest(),
                        dag_sha256=hashlib.sha256(dag_text.encode()).hexdigest(),
                        allowed_paths_by_task={t['id']:t['owns'] for t in dag['tasks']})
            (root/'drift-lock.json').write_text(json.dumps(lock))
            self.assertEqual(1,self.run_guard(root).returncode)

    def test_renderer_cannot_overwrite_frozen_inputs(self):
        for output in ['tasks.md','architecture.md','task-dag.json','drift-lock.json','execution-contract.json']:
            with self.subTest(output=output),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);self.make_bundle(root)
                before=(root/output).read_bytes()
                command=[sys.executable,str(ROOT/'scripts/render_execution_prompt.py')]
                for key,name in {'plan':'tasks.md','architecture':'architecture.md','dag':'task-dag.json','lock':'drift-lock.json','contract':'execution-contract.json','output':output}.items():
                    command.extend(['--'+key,str(root/name)])
                command.extend(['--repo-root',str(root)])
                result=subprocess.run(command,capture_output=True,text=True)
                self.assertNotEqual(0,result.returncode,result.stdout)
                self.assertEqual(before,(root/output).read_bytes())

    def test_screenshot_omission_needs_reason(self):
        self.check_contract(lambda c: c['checks'][0].update(not_applicable_reasons={}))

    def test_unchecked_acceptance_cannot_pass(self):
        self.check_contract(lambda c: c.update(checks=[]))

    def test_zero_monitor_interval_rejected(self):
        self.check_contract(lambda c: c['monitor'].update(interval_minutes=0))

    def test_serial_backend_cannot_claim_multiple_workers(self):
        self.check_contract(lambda c: c['runtime'].update(parallel_backend='serial'))

    def test_missing_logs_policy_rejected(self):
        self.check_contract(lambda c: c['checks'][0]['evidence'].pop('logs'))

    def test_checked_steps_do_not_trigger_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_bundle(root, plan=PLAN.replace('- [ ]', '- [x]'))
            result = self.run_guard(root)
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)

    def test_changed_plan_triggers_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_bundle(root, plan=PLAN.replace('Return a valid result', 'Change the scope'))
            result = self.run_guard(root)
            self.assertEqual(1, result.returncode, result.stdout + result.stderr)

    def test_changed_frozen_files_trigger_drift(self):
        for name in ('architecture.md', 'task-dag.json', 'execution-contract.json'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.make_bundle(root)
                path = root/name
                path.write_text(path.read_text() + '\n')
                self.assertEqual(1, self.run_guard(root).returncode)

    def test_code_checkbox_is_frozen(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plan = PLAN + '\n```markdown\n- [ ] sample\n```\n'
            self.make_bundle(root, plan=plan)
            lock = json.loads((root/'drift-lock.json').read_text())
            lock['plan_sha256'] = hashlib.sha256(plan.encode()).hexdigest()
            (root/'drift-lock.json').write_text(json.dumps(lock))
            self.assertEqual(0, self.run_guard(root).returncode)
            (root/'tasks.md').write_text(plan.replace('- [ ] sample', '- [x] sample'))
            self.assertEqual(1, self.run_guard(root).returncode)

    def test_unknown_acceptance_rejected(self):
        self.check_contract(lambda c: c['checks'][0].update(acceptance_ids=['AC2']))

    def test_unknown_check_task_rejected(self):
        self.check_contract(lambda c: c['checks'][0].update(task_ids=['T2']))

    def test_optional_check_cannot_close_required_acceptance(self):
        self.check_contract(lambda c: c['checks'][0].update(required=False))

    def test_legacy_validation_cannot_claim_handoff_ready(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_bundle(root)
            result = subprocess.run([sys.executable, str(ROOT/'scripts/plan_guard.py'),
                                    '--plan', str(root/'tasks.md')], capture_output=True, text=True)
            self.assertEqual(0, result.returncode)
            self.assertFalse(json.loads(result.stdout)['handoff_ready'])

    def test_installed_copy_can_render_handoff(self):
        import install_global
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            install_global.install(ROOT, root/'skills', dry_run=False)
            installed = root/'skills'/install_global.SKILL_NAME
            bundle = root/'bundle'
            bundle.mkdir()
            self.make_bundle(bundle)
            command = [sys.executable, str(installed/'scripts/render_execution_prompt.py'), '--repo-root', str(bundle)]
            for key, value in {'plan':'tasks.md', 'dag':'task-dag.json', 'lock':'drift-lock.json',
                               'architecture':'architecture.md', 'contract':'execution-contract.json',
                               'output':'execution-prompt.md'}.items():
                command.extend(['--' + key, str(bundle/value)])
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            self.assertTrue((bundle/'execution-prompt.md').is_file())

    def test_malformed_json_returns_input_error(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_bundle(root)
            (root/'task-dag.json').write_text('{')
            self.assertEqual(2, self.run_guard(root).returncode)

    def test_cli_renders_and_blocks_invalid_handoff(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_bundle(root)
            command = [sys.executable, str(ROOT/'scripts/render_execution_prompt.py'),
                '--plan', str(root/'tasks.md'), '--dag', str(root/'task-dag.json'),
                '--lock', str(root/'drift-lock.json'), '--architecture', str(root/'architecture.md'),
                '--contract', str(root/'execution-contract.json'), '--output', str(root/'prompt.md'), '--repo-root', str(root)]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertTrue((root/'prompt.md').is_file(), 'Renderer must produce the handoff')
            (root/'tasks.md').write_text(PLAN + '\nExtra scope\n')
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(1, result.returncode, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
