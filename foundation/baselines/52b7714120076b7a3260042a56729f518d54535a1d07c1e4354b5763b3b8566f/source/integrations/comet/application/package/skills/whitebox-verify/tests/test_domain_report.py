import json
import importlib.util
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests' / 'green-fixture'
RENDERER = ROOT / 'scripts' / 'render_journey_summary.py'


class DomainReportTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.fixture = Path(self.temp.name) / 'fixture'
        shutil.copytree(FIXTURE, self.fixture)
        setup = subprocess.run([sys.executable, '-B', str(self.fixture / 'run.py'), '--entry',
                                str(ROOT / 'scripts' / 'validate_journey_evidence.py')], capture_output=True, text=True)
        self.assertEqual(setup.returncode, 0, setup.stderr)

    def test_zero_and_false_actual_values_are_not_erased(self):
        spec = importlib.util.spec_from_file_location('candidate_renderer', RENDERER)
        sys.path.insert(0, str(ROOT / 'scripts'))
        renderer = importlib.util.module_from_spec(spec); spec.loader.exec_module(renderer)
        for value in (0, False):
            document = json.loads((self.fixture / 'ledger.json').read_text())
            document['journeys'][0]['case_results'][0]['actual'] = value
            report = renderer.render_markdown(renderer.build_summary(document, 'fixture'))
            self.assertIn(f'| {value} |', report)

    def test_report_links_case_result_and_original_evidence(self):
        run = subprocess.run([sys.executable, '-B', str(RENDERER), str(self.fixture / 'ledger.json')], capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn('CASE_RED_GREEN', run.stdout)
        self.assertIn('EV_GREEN_RUNNER', run.stdout)
        self.assertIn('artifacts/', run.stdout)
        self.assertIn('不构成执行证据', run.stdout)

    def test_invalid_ledger_is_not_labeled_structurally_valid(self):
        ledger = self.fixture / 'ledger.json'; data = json.loads(ledger.read_text())
        data['journeys'][0]['case_results'][0]['evidence'] = ['missing-evidence']
        ledger.write_text(json.dumps(data))
        run = subprocess.run([sys.executable, '-B', str(RENDERER), str(ledger)], capture_output=True, text=True)
        self.assertNotEqual(run.returncode, 0)
        self.assertNotIn('STRUCTURE_PASS', run.stdout)

    def test_failed_case_remains_visible_without_claiming_closure(self):
        ledger = self.fixture / 'ledger.json'; data = json.loads(ledger.read_text())
        data['journeys'][0]['case_results'][0]['result'] = 'fail'
        ledger.write_text(json.dumps(data))
        run = subprocess.run([sys.executable, '-B', str(RENDERER), str(ledger)], capture_output=True, text=True)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('CASE_RED_GREEN', run.stdout)
        self.assertIn('fail', run.stdout)
        self.assertIn('EV_GREEN_RUNNER', run.stdout)
        self.assertNotIn('STRUCTURE_PASS', run.stdout)

    def test_repeated_results_cannot_hide_an_earlier_failure(self):
        ledger = self.fixture / 'ledger.json'; data = json.loads(ledger.read_text())
        result = data['journeys'][0]['case_results'][0]
        data['journeys'][0]['case_results'] = [{**result, 'result': 'fail'}, result]
        ledger.write_text(json.dumps(data))
        run = subprocess.run([sys.executable, '-B', str(RENDERER), str(ledger)], capture_output=True, text=True)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('fail', run.stdout)
        self.assertIn('pass', run.stdout)
        self.assertNotIn('STRUCTURE_PASS', run.stdout)


if __name__ == '__main__':
    unittest.main()
