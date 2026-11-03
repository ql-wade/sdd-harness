"""Regressions from PAV2 runs 40–43: root-turn finality and cleanup evidence."""
import errno
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from dispatch_round import _zcode_assistant_text, run_zcode_protocol, run_agent
import cli_process


def message(role, finish=None, parts=None):
    return {'info': {'role': role, 'finish': finish}, 'parts': parts or []}


def text(value, kind='text'):
    return {'type': kind, 'text': value}


class ZCodeResultTests(unittest.TestCase):
    def test_only_final_text_not_reasoning_or_tool_stage(self):
        value = {'snapshot': {'messages': [
            message('user', parts=[text('review request')]),
            message('assistant', 'tool-calls', [text('planning', 'reasoning'), text('reading artifact')]),
            message('assistant', 'stop', [text('private reasoning', 'reasoning'), text('{"ok":true}')]),
        ]}}
        self.assertEqual(_zcode_assistant_text(value), '{"ok":true}')

    def test_no_fallback_to_intermediate_or_previous_turn(self):
        for messages in [
            [message('assistant', 'tool-calls', [text('thinking', 'reasoning')])],
            [message('assistant', 'stop', [text('{"old":true}')]), message('user'), message('assistant', 'tool-calls', [text('reading')])],
        ]:
            with self.subTest(messages=messages):
                self.assertEqual(_zcode_assistant_text({'messages': messages}), '')

    def test_snapshot_must_match_root_session_and_current_user(self):
        for session_id,parent_id in [('other','user-current'),('main','user-old')]:
            snapshot={'messages':[{'info':{'role':'assistant','sessionId':session_id,'parentMessageId':parent_id,'finish':'stop'},'parts':[text('STALE')]}]}
            self.assertEqual(_zcode_assistant_text(snapshot,'main','user-current'),'')

    def protocol(self, fail=False, fail_receipt=False, fail_temp=False):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            script = root / 'server.py'
            script.write_text(r'''import json,sys,threading,time
finished=False
lock=threading.Lock()
def emit(messages):
 with lock:
  sys.stdout.write(''.join(json.dumps(m)+'\n' for m in messages));sys.stdout.flush()
def done():
 global finished
 finished=True
 emit([{'method':'session/event','params':{'type':'turn.failed' if FAIL else 'turn.completed','sessionId':'main','turnId':'current','payload':{'resultType':'success'}}}])
for line in sys.stdin:
 r=json.loads(line)
 if 'method' not in r:continue
 method=r['method'];result={}
 if method=='session/create':result={'session':{'sessionId':'main'}}
 if method=='session/send':
  emit([{'method':'session/event','params':{'type':'turn.started','sessionId':'main','turnId':'current','payload':{'inputId':r['params']['inputId'],'messageId':'user-current'}}},{'id':r['id'],'result':{}},{'method':'session/subagents','params':{'status':'success','childSessionId':'child'}},{'method':'session/event','params':{'kind':'turn-completed','sessionId':'child','turnId':'child-turn'}},{'method':'session/event','params':{'type':'turn.completed','sessionId':'main','turnId':'previous'}}])
  threading.Timer(.12,done).start()
  continue
 if method=='session/read':
  if not finished:print('EARLY_READ',file=sys.stderr,flush=True)
  result={'messages':[{'info':{'role':'user'},'parts':[]},{'info':{'role':'assistant','finish':'stop' if finished else 'tool-calls','sessionId':'main','parentMessageId':'user-current'},'parts':[{'type':'reasoning','text':'not final'},{'type':'text','text':'{"ok":true}' if finished else 'reading'}]}]}
 emit([{'id':r['id'],'result':result}])
'''.replace('FAIL', repr(fail)))
            compile(script.read_text(),str(script),'exec')
            runtime = mock.Mock()
            if fail_temp:
                runtime.cleanup.side_effect=PermissionError("temporary provider cleanup denied")
            original_write = Path.write_text
            def write(path,*args,**kwargs):
                if fail_receipt and path.name == 'round-00-zcode.cleanup.json':
                    raise PermissionError('receipt write denied')
                return original_write(path,*args,**kwargs)
            with mock.patch.object(Path,'write_text',write), mock.patch('dispatch_round.resolve_zcode_api_key',return_value='test-only'), mock.patch('dispatch_round._prepare_zcode_protocol_env',return_value=(runtime,{})):
                output,error=run_zcode_protocol([sys.executable,str(script)],'synthetic request',root,root/'round-00',root,{'model':'test-model'},2)
            stderr=(root/'round-00-zcode.stderr').read_text()
            self.assertNotIn('EARLY_READ',stderr)
            if fail_receipt:
                self.assertEqual((root/'round-00-zcode.last-message').read_text(),'{"ok":true}')
                self.assertEqual(json.loads((root/'round-00-zcode.cleanup.json').read_text())['status'],'running')
            if fail_temp:
                self.assertEqual((root/'round-00-zcode.last-message').read_text(),'{"ok":true}')
                self.assertEqual(json.loads((root/'round-00-zcode.cleanup.json').read_text())['status'],'unverified')
            return output,error

    def test_waits_for_exact_root_turn_not_subagent_success(self):
        output,error=self.protocol()
        self.assertIsNone(error,error)
        self.assertEqual(output,'{"ok":true}')

    def test_cleanup_receipt_write_cannot_mask_final_text(self):
        output,error=self.protocol(fail_receipt=True)
        self.assertEqual(output,'{"ok":true}')
        self.assertIsNone(error)

    def test_temporary_provider_cleanup_cannot_mask_final_text(self):
        output,error=self.protocol(fail_temp=True)
        self.assertEqual(output,'{"ok":true}')
        self.assertIsNone(error)

    def test_failed_root_turn_never_becomes_a_successful_ballot(self):
        output,error=self.protocol(fail=True)
        self.assertIsNone(output)
        self.assertIn('failed',error)


class BallotPreservationTests(unittest.TestCase):
    def run_review(self, concurrent=False, existing=False):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);round_dir=root/'round-00';round_dir.mkdir();logs=root/'logs';logs.mkdir()
            path=round_dir/'ballot-zcode.json';prior='EXISTING BALLOT'
            if existing:path.write_text(prior)
            ballot={'review_id':'test','round':0,'agent':'zcode','artifact_sha256':'0'*64,'verdict':'APPROVE','score':{'overall':9,'criteria':{}},'findings':[],'assumptions':[],'confidence':1,'summary':'test'}
            def provider(*args,**kwargs):
                if concurrent:path.write_text(prior)
                (logs/'round-00-zcode.cleanup.json').write_text(json.dumps({'status':'unverified'}))
                return json.dumps(ballot),None
            with mock.patch('dispatch_round.agent_command',return_value=['zcode.cjs']), mock.patch('dispatch_round.run_zcode_protocol',side_effect=provider) as invoked, mock.patch('dispatch_round.subprocess.run',return_value=subprocess.CompletedProcess([],0,'','')):
                _,error=run_agent('zcode','synthetic',{'artifact':str(root)},round_dir,logs,root,root,root/'schema.json',{'zcode':{'model':'test'}})
            self.assertIsNotNone(error)
            if existing or concurrent:
                self.assertEqual(path.read_text(),prior)
                if existing:invoked.assert_not_called()
                else:self.assertIn('refusing to overwrite',error)
            else:
                self.assertEqual(json.loads(path.read_text()),ballot)
                self.assertIn('ballot retained',error)

    def test_existing_ballot_is_never_relaunched_or_overwritten(self):self.run_review(existing=True)
    def test_concurrent_ballot_is_not_overwritten(self):self.run_review(concurrent=True)
    def test_cleanup_failure_keeps_valid_ballot_and_returns_failure(self):self.run_review()


class CleanupPermissionTests(unittest.TestCase):
    def process(self):
        proc=mock.Mock(pid=424242)
        proc.poll.return_value=0
        proc.wait.return_value=0
        proc.returncode=0
        return proc

    def test_denied_cleanup_is_reported_not_silently_counted_as_clean(self):
        proc=self.process()
        with mock.patch('cli_process.os.killpg',side_effect=PermissionError(errno.EPERM,'denied')), mock.patch('cli_process.subprocess.run',side_effect=PermissionError(errno.EPERM,'ps denied')):
            result=cli_process.finish(proc)
        self.assertIsInstance(result,dict)
        self.assertEqual(result['status'],'unverified')
        self.assertTrue(result['errors'])

    def test_denied_group_probe_with_no_live_members_is_clean(self):
        proc=self.process()
        ps=subprocess.CompletedProcess(['ps'],1,'','')
        with mock.patch('cli_process.os.killpg',side_effect=PermissionError(errno.EPERM,'gone')), mock.patch('cli_process.subprocess.run',return_value=ps):
            result=cli_process.finish(proc)
        self.assertEqual(result['status'],'complete')


if __name__=='__main__':unittest.main()
