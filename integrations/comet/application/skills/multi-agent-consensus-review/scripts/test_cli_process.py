"""Regression checks for non-interactive execution and owned-tree cleanup."""
import json
import os
from pathlib import Path
import shlex
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

from cli_process import check_silent_command, run

SCRIPTS = Path(__file__).resolve().parent


def wait_for(path, timeout=8):
    deadline = time.monotonic() + timeout
    while not path.exists() and time.monotonic() < deadline:
        time.sleep(0.02)
    if not path.exists():
        raise AssertionError(f"fixture did not become ready: {path}")


class CliProcessTests(unittest.TestCase):
    def test_no_tty_and_closed_stdin_or_explicit_prompt(self):
        code = "import os,sys;print(os.isatty(0),os.isatty(1),repr(sys.stdin.read()))"
        for prompt in (None, "review prompt"):
            with self.subTest(prompt=prompt):
                result = run([sys.executable, "-c", code], input=prompt, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=3)
                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stdout.strip(), f"False False {repr(prompt or '')}")

    def test_every_adapter_is_noninteractive_and_keeps_failure_logs(self):
        from dispatch_round import run_agent
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rounds = root / "round-00"; rounds.mkdir()
            logs = root / "logs"; logs.mkdir()
            fixture = root / "reviewer.py"
            fixture.write_text("import os,sys,json;print(json.dumps({'argv':sys.argv[1:],'stdin_tty':os.isatty(0),'stdout_tty':os.isatty(1)}),flush=True);print('reviewer failed',file=sys.stderr,flush=True);sys.exit(7)")
            models = {agent: {"model": "test-model", "effort": "max"} for agent in ("claude-code", "zcode", "codex-agent")}
            for agent in models:
                with self.subTest(agent=agent), mock.patch("dispatch_round.agent_command", return_value=[sys.executable, str(fixture)]), mock.patch("dispatch_round.resolve_zcode_api_key", return_value=None):
                    name, error = run_agent(agent, "synthetic prompt", {"artifact": str(root)}, rounds, logs, root, SCRIPTS.parent, root / "schema.json", models)
                    self.assertEqual(name, agent)
                    self.assertIn("exited 7", error)
                    output = json.loads((logs / f"round-00-{agent}.stdout").read_text())
                    self.assertFalse(output['stdin_tty']);self.assertFalse(output['stdout_tty'])
                    self.assertIn('reviewer failed', (logs / f"round-00-{agent}.stderr").read_text())
                    self.assertIn({'claude-code': '-p', 'zcode': '--prompt', 'codex-agent': 'exec'}[agent], output['argv'])

    def test_timeout_preserves_partial_reviewer_output(self):
        from dispatch_round import run_agent
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rounds = root / "round-00"; rounds.mkdir()
            logs = root / "logs"; logs.mkdir()
            fixture = root / "reviewer.py"
            fixture.write_text("import sys,time;print('partial output',flush=True);print('partial error',file=sys.stderr,flush=True);time.sleep(60)")
            with mock.patch("dispatch_round.agent_command", return_value=[sys.executable, str(fixture)]), mock.patch.dict(os.environ, {"CAR_AGENT_TIMEOUT": "0.2"}):
                _, error = run_agent("claude-code", "synthetic prompt", {"artifact": str(root)}, rounds, logs, root, SCRIPTS.parent, root / "schema.json", {"claude-code": {"model": "test-model", "effort": "max"}})
            self.assertIn("timed out", error)
            self.assertIn("partial output", (logs / "round-00-claude-code.stdout").read_text())
            self.assertIn("partial error", (logs / "round-00-claude-code.stderr").read_text())

    def test_rejects_gui_launchers_and_foreground_app(self):
        for command in (["open", "-a", "Terminal"], ["osascript", "-e", "anything"]):
            with self.subTest(command=command), self.assertRaises(OSError):
                check_silent_command(command)
        with tempfile.TemporaryDirectory() as tmp:
            import plistlib
            executable = Path(tmp) / "Example.app/Contents/MacOS/Example"
            executable.parent.mkdir(parents=True)
            (executable.parent.parent / "Info.plist").write_bytes(plistlib.dumps({"CFBundleExecutable": "Example"}))
            with self.assertRaises(OSError):
                check_silent_command([str(executable)])

    def test_success_and_failure_reap_children_even_after_parent_exits(self):
        for exit_code in (0, 7):
            with self.subTest(exit_code=exit_code), tempfile.TemporaryDirectory() as tmp:
                marker = Path(tmp) / "child.pid"
                child = "import os,signal,time;from pathlib import Path;signal.signal(signal.SIGTERM,signal.SIG_IGN);Path(" + repr(str(marker)) + ").write_text(str(os.getpid()));time.sleep(60)"
                parent = "import subprocess,sys,time;from pathlib import Path;p=subprocess.Popen([sys.executable,'-c'," + repr(child) + "],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);marker=Path(" + repr(str(marker)) + ")\nwhile not marker.exists():time.sleep(.01)\nsys.exit(" + str(exit_code) + ")"
                result = run([sys.executable, "-c", parent], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5)
                self.assertEqual(result.returncode, exit_code)
                pid = int(marker.read_text())
                self.assert_dead(pid)

    def assert_dead(self, pid):
        # macOS can briefly retain an orphan zombie after its group was killed.
        result = subprocess.run(["ps", "-p", str(pid), "-o", "stat="], capture_output=True, text=True)
        self.assertTrue(result.returncode == 1 or result.stdout.strip().startswith("Z"), result.stdout)

    def test_controller_timeout_cancel_and_stop_file_clean_nested_groups(self):
        for action in ("timeout", "cancel", "stop-file"):
            with self.subTest(action=action), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                manifest = root / "manifest.json"
                manifest.write_text(json.dumps({"max_rounds": 1, "review_id": "cleanup-test", "artifact": str(root)}))
                dispatch = root / "dispatch.py"
                dispatch.write_text(
                    "import sys,os,time,json\nfrom pathlib import Path\n"
                    f"sys.path.insert(0,{str(SCRIPTS)!r})\n"
                    "from cli_process import spawn,install_signal_handlers\n"
                    "install_signal_handlers()\n"
                    "p=spawn([sys.executable,'-c',\"import time,signal;from pathlib import Path;signal.signal(signal.SIGTERM,signal.SIG_IGN);Path('child-ready').touch();time.sleep(60)\"])\n"
                    "while not Path('child-ready').exists():time.sleep(.01)\n"
                    "Path('ready.json').write_text(json.dumps([os.getpid(),p.pid]))\n"
                    "time.sleep(60)\n"
                )
                sibling = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(60)"], start_new_session=True)
                controller = subprocess.Popen([sys.executable, str(SCRIPTS / "ralph_loop.py"), "--manifest", str(manifest), "--dispatch-command", shlex.join([sys.executable, str(dispatch)]), "--dispatch-timeout", "1.5" if action == "timeout" else "30"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                try:
                    wait_for(root / "ready.json")
                    pids = json.loads((root / "ready.json").read_text())
                    if action == "cancel":
                        controller.send_signal(signal.SIGTERM)
                    elif action == "stop-file":
                        (root / "stop.md").touch()
                    stdout, stderr = controller.communicate(timeout=15)
                    self.assertNotEqual(controller.returncode, 0, stdout + stderr)
                    state = json.loads((root / "ralph-state.json").read_text())
                    self.assertEqual(state["status"], "BLOCKED" if action == "timeout" else "STOPPED", (state, stdout, stderr))
                    for pid in pids:
                        self.assert_dead(pid)
                    self.assertIsNone(sibling.poll(), "cleanup killed an unrelated CLI session")
                finally:
                    if controller.poll() is None:
                        controller.terminate();controller.wait(timeout=8)
                    sibling.terminate();sibling.wait()


if __name__ == "__main__":
    unittest.main()
