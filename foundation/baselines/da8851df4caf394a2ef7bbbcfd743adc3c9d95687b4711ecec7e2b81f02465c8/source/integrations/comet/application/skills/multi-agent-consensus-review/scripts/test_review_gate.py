#!/usr/bin/env python3
"""Smoke tests for the deterministic review gate and Ralph controller."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
GATE = ROOT / "review_gate.py"
RALPH = ROOT / "ralph_loop.py"


class ReviewGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.artifact = self.root / "artifact.txt"
        self.artifact.write_text("initial artifact\n", encoding="utf-8")
        self.run_dir = self.root / "run"
        command = [
            sys.executable,
            str(GATE),
            "init",
            "--run-dir",
            str(self.run_dir),
            "--review-type",
            "code",
            "--initiator",
            "codex-agent",
            "--participants",
            "claude-code,zcode,codex-agent",
            "--artifact",
            str(self.artifact),
            "--scope",
            "all",
            "--max-rounds",
            "2",
        ]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.manifest = json.loads((self.run_dir / "manifest.json").read_text(encoding="utf-8"))

    def tearDown(self) -> None:
        self.temp.cleanup()

    def ballot(self, agent: str, round_number: int, verdict: str = "APPROVE", overall: float = 8.5) -> dict:
        return {
            "review_id": self.manifest["review_id"],
            "round": round_number,
            "agent": agent,
            "artifact_sha256": self.manifest["artifact_sha256"],
            "verdict": verdict,
            "score": {
                "overall": overall,
                "criteria": {criterion: 8.0 for criterion in self.manifest["criteria"]},
            },
            "findings": [],
            "assumptions": [],
            "confidence": 0.9,
            "summary": f"{agent} reviewed the artifact",
        }

    def write_round(self, number: int, ballots: list[dict]) -> Path:
        round_dir = self.run_dir / f"round-{number:02d}"
        round_dir.mkdir(parents=True, exist_ok=True)
        for ballot in ballots:
            (round_dir / f"ballot-{ballot['agent']}.json").write_text(
                json.dumps(ballot), encoding="utf-8"
            )
        return round_dir

    def tally(self, round_dir: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(GATE), "tally", "--manifest", str(self.run_dir / "manifest.json"), "--round-dir", str(round_dir)],
            capture_output=True,
            text=True,
        )

    def test_unanimous_gate_passes(self) -> None:
        round_dir = self.write_round(0, [self.ballot(agent, 0) for agent in self.manifest["participants"]])
        result = self.tally(round_dir)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads((round_dir / "tally.json").read_text())["status"], "PASSED")

    def test_dissent_requires_debate(self) -> None:
        ballots = [self.ballot(agent, 0) for agent in self.manifest["participants"]]
        ballots[1]["verdict"] = "REJECT"
        ballots[1]["score"]["overall"] = 5.0
        round_dir = self.write_round(0, ballots)
        result = self.tally(round_dir)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads((round_dir / "tally.json").read_text())["status"], "DEBATE_REQUIRED")

    def test_missing_ballot_is_incomplete(self) -> None:
        ballots = [self.ballot(agent, 0) for agent in self.manifest["participants"][:2]]
        round_dir = self.write_round(0, ballots)
        result = self.tally(round_dir)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads((round_dir / "tally.json").read_text())["status"], "INCOMPLETE")

    def test_stale_ballot_is_rejected(self) -> None:
        ballot = self.ballot("claude-code", 0)
        ballot["artifact_sha256"] = "0" * 64
        path = self.run_dir / "round-00" / "ballot-claude-code.json"
        path.write_text(json.dumps(ballot), encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(GATE), "validate", "--manifest", str(self.run_dir / "manifest.json"), "--ballot", str(path), "--round", "0"],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("artifact_sha256", result.stdout)

    def test_ballot_schema_types_and_extra_fields_are_rejected(self) -> None:
        ballot = self.ballot("claude-code", 0)
        ballot["extra"] = "not allowed"
        ballot["findings"] = [{
            "id": "F-001", "severity": "NOTE", "claim": None,
            "evidence": "artifact.txt:1", "recommendation": [], "blocking": False,
        }]
        path = self.run_dir / "round-00" / "ballot-claude-code.json"
        path.write_text(json.dumps(ballot), encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(GATE), "validate", "--manifest", str(self.run_dir / "manifest.json"), "--ballot", str(path), "--round", "0"],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unexpected ballot fields", result.stdout)
        self.assertIn("claim must be", result.stdout)

    def test_invalid_utf8_ballot_becomes_incomplete(self) -> None:
        ballots = [self.ballot(agent, 0) for agent in self.manifest["participants"]]
        round_dir = self.write_round(0, ballots)
        (round_dir / "ballot-zcode.json").write_bytes(b"\xff\xfe")
        result = self.tally(round_dir)
        self.assertNotEqual(result.returncode, 0)
        tally = json.loads((round_dir / "tally.json").read_text())
        self.assertEqual(tally["status"], "INCOMPLETE")

    def test_init_rejects_reduced_quorum(self) -> None:
        reduced = self.root / "reduced-run"
        result = subprocess.run(
            [sys.executable, str(GATE), "init", "--run-dir", str(reduced), "--review-type", "code", "--initiator", "codex-agent", "--participants", "claude-code,codex-agent", "--artifact", str(self.artifact), "--scope", "all"],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("exactly claude-code,zcode,codex-agent", result.stderr)

    def test_changed_artifact_blocks_tally(self) -> None:
        round_dir = self.write_round(0, [self.ballot(agent, 0) for agent in self.manifest["participants"]])
        self.artifact.write_text("changed after manifest\n", encoding="utf-8")
        result = self.tally(round_dir)
        self.assertNotEqual(result.returncode, 0)
        tally = json.loads((round_dir / "tally.json").read_text())
        self.assertEqual(tally["status"], "BLOCKED")
        self.assertTrue(tally["artifact_changed"])

    def test_finalize_rechecks_ballots_instead_of_trusting_tally(self) -> None:
        round_dir = self.write_round(0, [self.ballot(agent, 0) for agent in self.manifest["participants"]])
        result = self.tally(round_dir)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        tally_path = round_dir / "tally.json"
        tally = json.loads(tally_path.read_text())
        tally["votes"]["REJECT"] = 99
        tally_path.write_text(json.dumps(tally), encoding="utf-8")
        conclusion = self.run_dir / "conclusion.md"
        next_plan = self.run_dir / "next-plan.md"
        conclusion.write_text("approved by all participants", encoding="utf-8")
        next_plan.write_text("run the verification command", encoding="utf-8")
        output = self.run_dir / "final-report.md"
        finalize = subprocess.run(
            [sys.executable, str(GATE), "finalize", "--manifest", str(self.run_dir / "manifest.json"), "--tally", str(tally_path), "--conclusion-file", str(conclusion), "--next-plan-file", str(next_plan), "--output", str(output)],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(finalize.returncode, 0)
        self.assertIn("integrity check", finalize.stderr)

    def test_ralph_loop_reaches_pass_only_after_second_round(self) -> None:
        dispatch = self.root / "dispatch.py"
        dispatch.write_text(
            textwrap.dedent(
                """
                import json, os
                from pathlib import Path
                manifest = json.loads(Path(os.environ['REVIEW_MANIFEST']).read_text())
                round_number = int(os.environ['REVIEW_ROUND'])
                output = Path(os.environ['REVIEW_ROUND_DIR'])
                output.mkdir(parents=True, exist_ok=True)
                for agent in manifest['participants']:
                    ballot = {
                        'review_id': manifest['review_id'],
                        'round': round_number,
                        'agent': agent,
                        'artifact_sha256': manifest['artifact_sha256'],
                        'verdict': 'REJECT' if round_number == 0 and agent == 'zcode' else 'APPROVE',
                        'score': {'overall': 5.0 if round_number == 0 and agent == 'zcode' else 8.5,
                                  'criteria': {key: 8.0 for key in manifest['criteria']}},
                        'findings': [], 'assumptions': [], 'confidence': 0.9,
                        'summary': 'test ballot'
                    }
                    (output / ('ballot-' + agent + '.json')).write_text(json.dumps(ballot))
                (output / 'dispatch-meta.json').write_text(json.dumps({
                    'round': round_number, 'participants': manifest['participants'],
                    'artifact_sha256': manifest['artifact_sha256'], 'prompt_sha256': '0' * 64,
                    'fresh_processes': True, 'read_only': True, 'artifact_edited': False,
                    'status': 'OK'
                }))
                """
            ),
            encoding="utf-8",
        )
        result = subprocess.run(
            [sys.executable, str(RALPH), "--manifest", str(self.run_dir / "manifest.json"), "--dispatch-command", f"{sys.executable} {dispatch}", "--max-rounds", "2"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("<promise>CONSENSUS_REVIEW_PASSED</promise>", result.stdout)
        state = json.loads((self.run_dir / "ralph-state.json").read_text())
        self.assertEqual(state["status"], "PASSED")
        self.assertEqual([item["status"] for item in state["rounds"]], ["DEBATE_REQUIRED", "PASSED"])

    def test_ralph_loop_stops_on_unchanged_dissent(self) -> None:
        dispatch = self.root / "stuck-dispatch.py"
        dispatch.write_text(
            textwrap.dedent(
                """
                import json, os
                from pathlib import Path
                manifest = json.loads(Path(os.environ['REVIEW_MANIFEST']).read_text())
                round_number = int(os.environ['REVIEW_ROUND'])
                output = Path(os.environ['REVIEW_ROUND_DIR'])
                output.mkdir(parents=True, exist_ok=True)
                for agent in manifest['participants']:
                    rejected = agent == 'zcode'
                    ballot = {
                        'review_id': manifest['review_id'], 'round': round_number,
                        'agent': agent, 'artifact_sha256': manifest['artifact_sha256'],
                        'verdict': 'REJECT' if rejected else 'APPROVE',
                        'score': {'overall': 5.0 if rejected else 8.5,
                                  'criteria': {key: 8.0 for key in manifest['criteria']}},
                        'findings': ([{'id': 'F-001', 'severity': 'MAJOR',
                                       'claim': 'unchanged concern', 'evidence': 'artifact.txt:1',
                                       'recommendation': 'provide evidence', 'blocking': False}] if rejected else []),
                        'assumptions': [], 'confidence': 0.9, 'summary': 'stuck ballot'
                    }
                    (output / ('ballot-' + agent + '.json')).write_text(json.dumps(ballot))
                (output / 'dispatch-meta.json').write_text(json.dumps({
                    'round': round_number, 'participants': manifest['participants'],
                    'artifact_sha256': manifest['artifact_sha256'], 'prompt_sha256': '0' * 64,
                    'fresh_processes': True, 'read_only': True, 'artifact_edited': False,
                    'status': 'OK'
                }))
                """
            ),
            encoding="utf-8",
        )
        result = subprocess.run(
            [sys.executable, str(RALPH), "--manifest", str(self.run_dir / "manifest.json"), "--dispatch-command", f"{sys.executable} {dispatch}", "--max-rounds", "2"],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unchanged dissent", result.stdout)
        state = json.loads((self.run_dir / "ralph-state.json").read_text())
        self.assertEqual(state["status"], "BLOCKED")

    def test_ralph_loop_does_not_overwrite_existing_state(self) -> None:
        state_path = self.run_dir / "ralph-state.json"
        state_path.write_text('{"status":"PREVIOUS"}\n', encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(RALPH), "--manifest", str(self.run_dir / "manifest.json"), "--dispatch-command", "false"],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("refusing to overwrite", result.stdout)
        self.assertEqual(state_path.read_text(), '{"status":"PREVIOUS"}\n')


if __name__ == "__main__":
    unittest.main()
