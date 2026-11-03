#!/usr/bin/env python3
"""Tests for the ZCode 0.17.x Electron-node launch resolution."""

from __future__ import annotations

import os
import plistlib
from pathlib import Path
import unittest
import sys
import tempfile
import time
import json
from unittest import mock

from dispatch_round import ZCODE_BUNDLE_CLI, zcode_command, zcode_electron_binary, run_zcode_protocol


class ZcodeLaunchTest(unittest.TestCase):
    def test_bundle_cli_runs_under_electron_binary(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with mock.patch("dispatch_round.shutil.which", return_value=None):
                binary = zcode_electron_binary()
                if binary is None or not ZCODE_BUNDLE_CLI.is_file():
                    self.skipTest("ZCode app bundle not installed")
                command = zcode_command()
        self.assertEqual(command, [str(binary), str(ZCODE_BUNDLE_CLI)])
        self.assertNotEqual(command[0], "node")
        info = plistlib.loads((Path(binary).parent.parent / "Info.plist").read_bytes())
        self.assertTrue(info.get("LSUIElement") or info.get("LSBackgroundOnly"),
                        "reviewer and inherited MCP runtime must not register Dock applications")

    def test_path_zcode_wins_over_bundle(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with mock.patch("dispatch_round.shutil.which", return_value="/usr/local/bin/zcode"):
                self.assertEqual(zcode_command(), ["/usr/local/bin/zcode"])

    def test_missing_hidden_helper_blocks_instead_of_using_main_app(self):
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch("dispatch_round.shutil.which", return_value=None), mock.patch("dispatch_round.zcode_electron_binary", return_value=None), mock.patch.object(Path, "is_file", return_value=True):
            with self.assertRaisesRegex(OSError, "silent execution is required"):
                zcode_command()

    def test_protocol_timeout_handles_partial_line_without_hanging(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); script = root / "partial.py"
            script.write_text("import sys,time;sys.stdin.readline();sys.stdout.write('{');sys.stdout.flush();time.sleep(60)")
            runtime = mock.Mock();runtime.cleanup = mock.Mock()
            started = time.monotonic()
            with mock.patch("dispatch_round.resolve_zcode_api_key", return_value="test-only"), mock.patch("dispatch_round._prepare_zcode_protocol_env", return_value=(runtime, {})):
                output, error = run_zcode_protocol([sys.executable, str(script)], "synthetic prompt", root, root / "round-00", root, {"model": "test-model"}, 0.2)
            self.assertIsNone(output)
            self.assertIn("timed out", error)
            self.assertLess(time.monotonic() - started, 3)
            runtime.cleanup.assert_called_once()

    def test_protocol_timeout_when_server_stops_reading_large_prompt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); script = root / "backpressure.py"
            script.write_text(r"""import json,sys,time
for line in sys.stdin:
 request=json.loads(line);method=request['method'];result={}
 if method=='session/create':result={'session':{'sessionId':'test-session'}}
 print(json.dumps({'id':request['id'],'result':result}),flush=True)
 if method=='session/subscribe':time.sleep(60)
""")
            runtime = mock.Mock();runtime.cleanup = mock.Mock()
            started = time.monotonic()
            with mock.patch("dispatch_round.resolve_zcode_api_key", return_value="test-only"), mock.patch("dispatch_round._prepare_zcode_protocol_env", return_value=(runtime, {})):
                output, error = run_zcode_protocol([sys.executable, str(script)], "x" * 1000000, root, root / "round-00", root, {"model": "test-model"}, 0.3)
            self.assertIsNone(output)
            self.assertIn("timed out writing", error)
            self.assertLess(time.monotonic() - started, 3)

    def test_protocol_accepts_multiple_frames_in_one_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); script = root / "protocol.py"
            script.write_text(r"""import json,sys
for line in sys.stdin:
 request=json.loads(line)
 if 'method' not in request:continue
 method=request['method'];result={}
 if method=='session/create':result={'session':{'sessionId':'test-session'}}
 if method=='session/read':result={'messages':[{'info':{'role':'assistant','finish':'stop','sessionId':'test-session','parentMessageId':'user-current'},'parts':[{'type':'text','text':'{\"ok\":true}'}]}]}
 messages=[{'id':request['id'],'result':result}]
 if method=='session/send':messages=[{'method':'session/event','params':{'type':'turn.started','sessionId':'test-session','turnId':'turn-1','payload':{'inputId':request['params']['inputId'],'messageId':'user-current'}}}]+messages+[{'method':'session/event','params':{'type':'turn.completed','sessionId':'test-session','turnId':'turn-1','payload':{'resultType':'success'}}}]
 sys.stdout.write(''.join(json.dumps(message)+'\n' for message in messages));sys.stdout.flush()
""")
            compile(script.read_text(), str(script), "exec")
            runtime = mock.Mock();runtime.cleanup = mock.Mock()
            with mock.patch("dispatch_round.resolve_zcode_api_key", return_value="test-only"), mock.patch("dispatch_round._prepare_zcode_protocol_env", return_value=(runtime, {})):
                output, error = run_zcode_protocol([sys.executable, str(script)], "synthetic prompt", root, root / "round-00", root, {"model": "test-model"}, 2)
            self.assertIsNone(error, error)
            self.assertEqual(json.loads(output), {"ok": True})

    def test_override_wins(self):
        with mock.patch.dict(os.environ, {"CAR_ZCODE_COMMAND": "my-zcode --flag"}, clear=True):
            self.assertEqual(zcode_command(), ["my-zcode", "--flag"])


if __name__ == "__main__":
    unittest.main()
