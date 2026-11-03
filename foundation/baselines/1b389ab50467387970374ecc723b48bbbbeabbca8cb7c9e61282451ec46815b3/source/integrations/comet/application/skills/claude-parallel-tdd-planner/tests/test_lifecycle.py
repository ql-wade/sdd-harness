"""Real CLI archive; Whitebox receipt is a marked adapter fixture, not product evidence."""
import hashlib,json,sys,tempfile,unittest
from unittest.mock import patch
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
try: import openspec_lifecycle as life
except ImportError: life=None
MAIN='''# Login Specification
## Purpose
Define password authentication and rate limiting behavior.
## Requirements
### Requirement: Login
The system SHALL authenticate valid credentials and reject invalid credentials.
#### Scenario: Valid password
- **WHEN** a valid password is supplied
- **THEN** login succeeds
#### Scenario: Invalid password
- **WHEN** an invalid password is supplied
- **THEN** login fails
'''
DELTA='## MODIFIED Requirements\n'+MAIN.split('## Requirements\n')[1].replace('authenticate valid credentials','authenticate valid credentials with a second factor')
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
class LifecycleTests(unittest.TestCase):
 def setUp(self):
  self.assertIsNotNone(life,'Missing lifecycle gate: source freeze, Whitebox handoff, archive readback')
  stub=patch.object(life,'validate_whitebox_ledger',return_value=None,create=True);stub.start();self.addCleanup(stub.stop)
  t=tempfile.TemporaryDirectory();self.addCleanup(t.cleanup);self.repo=Path(t.name);self.change='add-second-factor'
  self.root=self.repo/'openspec/changes'/self.change
  (self.root/'specs/auth').mkdir(parents=True);(self.repo/'openspec/specs/auth').mkdir(parents=True)
  (self.repo/'openspec/specs/auth/spec.md').write_text(MAIN);(self.root/'specs/auth/spec.md').write_text(DELTA)
  (self.root/'proposal.md').write_text('# Add second factor\n## Why\nStrengthen authentication.\n## What Changes\n- Add a second factor.\n## Impact\n- Affected specs: auth\n- Affected code: auth.py\n')
  (self.root/'design.md').write_text('Check second factor after password.\n');(self.root/'tasks.md').write_text('- [ ] 1.1 Implement and verify\n')
  (self.root/'.openspec.yaml').write_text('schema: spec-driven\n');(self.repo/'auth.py').write_text('def auth(): return True\n')
  self.bindings={'AC1':[{'path':'specs/auth/spec.md','requirement':'Login','scenario':s} for s in ('Valid password','Invalid password')]}
  (self.repo/'.whitebox').mkdir();self.receipt_path=self.repo/'.whitebox/receipt.json'
 def freeze(self,**kw): return life.freeze(self.repo,self.change,self.bindings,**kw)
 def accept(self):
  (self.root/'tasks.md').write_text('- [x] 1.1 Implement and verify\n')
  for name in ('whitebox.log','whitebox-report.md','ledger.json'): (self.repo/'.whitebox'/name).write_text('Adapter fixture ONLY\n')
  ref=lambda n:{'path':'.whitebox/'+n,'sha256':digest(self.repo/'.whitebox'/n)}
  r={'skill':'whitebox-verify','mode':'Slice','status':'PASS','run_id':'fixture-run','inspected_by':'test-observer',
   'evidence_review':'PASS','baseline':life.implementation_baseline(self.repo),
   'validator':{'exit_code':0,'log':ref('whitebox.log')},'ledger':ref('ledger.json'),'report':ref('whitebox-report.md'),
   'checks':[{'id':'V1','acceptance_ids':['AC1'],'status':'PASS','evidence':[ref('whitebox.log')]}],'findings':[]}
  self.save(r);return r
 def save(self,r):self.receipt_path.write_text(json.dumps(r))
 def prepare(self):return life.prepare(self.repo,self.change,self.receipt_path)
 def close(self):
  p=self.prepare();return life.finalize(self.repo,self.change,self.receipt_path,p['preflight_path'])
 def test_full_real_cli_archive_and_audit(self):
  self.freeze();self.accept();r=self.close();self.assertEqual('ARCHIVED',r['status']);self.assertFalse(self.root.exists())
  self.assertTrue((self.repo/r['archive_path']/'spec-baseline.json').is_file())
  text=(self.repo/'openspec/specs/auth/spec.md').read_text();self.assertIn('second factor',text);self.assertIn('Invalid password',text)
  self.assertEqual('ARCHIVED',life.audit(self.repo,r['state_path'])['status'])
 def test_incomplete_tasks_block_without_mutation(self):
  self.freeze();self.accept();(self.root/'tasks.md').write_text('- [ ] 1.1 Implement and verify\n')
  with self.assertRaisesRegex(ValueError,'TASKS_INCOMPLETE'):self.prepare()
  self.assertEqual(MAIN,(self.repo/'openspec/specs/auth/spec.md').read_text())
 def test_source_and_main_drift_block(self):
  self.freeze();self.accept()
  for target in ('specs/auth/spec.md','MAIN'):
   with self.subTest(target=target):
    p=self.repo/'openspec/specs/auth/spec.md' if target=='MAIN' else self.root/target
    original=p.read_text();p.write_text(original+'\nchanged\n')
    with self.assertRaisesRegex(ValueError,'SOURCE_DRIFT'):self.prepare()
    p.write_text(original)
 def test_mapping_must_cover_real_scenarios(self):
  self.bindings['AC1'].pop()
  with self.assertRaisesRegex(ValueError,'SCENARIO_COVERAGE'):self.freeze()
 def test_fake_scenario_mapping_blocks(self):
  self.bindings['AC1'][0]['scenario']='Nonexistent'
  with self.assertRaisesRegex(ValueError,'SCENARIO_COVERAGE'):self.freeze()
 def test_modified_preserves_old_scenarios(self):
  (self.root/'specs/auth/spec.md').write_text(DELTA.split('#### Scenario: Invalid password')[0]);self.bindings['AC1'].pop()
  with self.assertRaisesRegex(ValueError,'SCENARIO_REMOVED'):self.freeze()
 def test_explicit_scenario_removal_disposition(self):
  (self.root/'specs/auth/spec.md').write_text(DELTA.split('#### Scenario: Invalid password')[0]);self.bindings['AC1'].pop()
  self.assertTrue(self.freeze(dispositions=[{'path':'specs/auth/spec.md','requirement':'Login','scenario':'Invalid password','reason':'Explicit approved scope removes this behavior'}]))
 def test_failed_unverified_structural_whitebox_block(self):
  self.freeze();r=self.accept()
  for status in ('FAIL','UNVERIFIED','STRUCTURE_PASS','EVIDENCE_UNSTABLE'):
   r['status']=status;self.save(r)
   with self.assertRaisesRegex(ValueError,'WHITEBOX'):self.prepare()
 def test_debug_is_not_acceptance(self):
  self.freeze();r=self.accept();r['mode']='Debug';self.save(r)
  with self.assertRaisesRegex(ValueError,'WHITEBOX'):self.prepare()
 def test_structure_pass_is_not_evidence_review(self):
  self.freeze();r=self.accept();r['evidence_review']='STRUCTURE_PASS';self.save(r)
  with self.assertRaisesRegex(ValueError,'WHITEBOX'):self.prepare()
 def test_tampered_evidence_blocks(self):
  self.freeze();self.accept();(self.repo/'.whitebox/whitebox.log').write_text('tampered')
  with self.assertRaisesRegex(ValueError,'EVIDENCE'):self.prepare()
 def test_missing_acceptance_blocks(self):
  self.freeze();r=self.accept();r['checks'][0]['acceptance_ids']=[];self.save(r)
  with self.assertRaisesRegex(ValueError,'ACCEPTANCE'):self.prepare()
 def test_implementation_change_invalidates_whitebox(self):
  self.freeze();self.accept();(self.repo/'auth.py').write_text('changed')
  with self.assertRaisesRegex(ValueError,'BASELINE'):self.prepare()
 def test_open_p1_blocks(self):
  self.freeze();r=self.accept();r['findings']=[{'id':'F1','severity':'P1','status':'open'}];self.save(r)
  with self.assertRaisesRegex(ValueError,'FINDING'):self.prepare()
 def test_archive_collision_before_writes(self):
  self.freeze();self.accept();p=self.prepare();(self.repo/p['archive_path']).mkdir(parents=True)
  with self.assertRaisesRegex(ValueError,'ARCHIVE_EXISTS'):life.finalize(self.repo,self.change,self.receipt_path,p['preflight_path'])
  self.assertEqual(MAIN,(self.repo/'openspec/specs/auth/spec.md').read_text())
 def test_changes_after_preflight_block(self):
  self.freeze();self.accept();p=self.prepare();(self.repo/'auth.py').write_text('changed')
  with self.assertRaisesRegex(ValueError,'BASELINE'):life.finalize(self.repo,self.change,self.receipt_path,p['preflight_path'])
 def test_post_archive_tampering_detected(self):
  self.freeze();self.accept();r=self.close();(self.repo/'openspec/specs/auth/spec.md').write_text('tampered')
  with self.assertRaisesRegex(ValueError,'POST_ARCHIVE'):life.audit(self.repo,r['state_path'])
 def test_after_merge_requires_target_ancestry(self):
  self.freeze(policy='after-merge',target_ref='refs/heads/main');self.accept()
  with self.assertRaisesRegex(ValueError,'MERGE_REQUIRED'):self.prepare()
 def test_partial_state_never_blindly_replayed(self):
  self.freeze();self.accept();p=self.prepare();s=self.repo/p['state_path'];v=json.loads(s.read_text());v['status']='FINALIZING';s.write_text(json.dumps(v))
  with self.assertRaisesRegex(ValueError,'RECOVERY_REQUIRED'):life.finalize(self.repo,self.change,self.receipt_path,p['preflight_path'])
 def test_repeat_finalize_is_audited(self):
  self.freeze();self.accept();p=self.prepare();a=life.finalize(self.repo,self.change,self.receipt_path,p['preflight_path']);b=life.finalize(self.repo,self.change,self.receipt_path,p['preflight_path'])
  self.assertEqual(a['archive_path'],b['archive_path'])
 def test_real_whitebox_validator_rejects_fixture_ledger(self):
  self.assertTrue(callable(getattr(life,'REAL_WHITEBOX_VALIDATOR',None)), 'Real Whitebox validator gate is missing')
  self.freeze();r=self.accept()
  with self.assertRaisesRegex(ValueError,'WHITEBOX_VALIDATOR'):
   life.REAL_WHITEBOX_VALIDATOR(self.repo,r)
 def test_required_check_ids_cannot_be_omitted(self):
  self.freeze();self.accept()
  (self.root/'execution-contract.json').write_text(json.dumps({'checks':[
   {'id':'V1','required':True,'acceptance_ids':['AC1']},
   {'id':'V2','required':True,'acceptance_ids':['AC1']}]}))
  with self.assertRaisesRegex(ValueError,'CHECK_COVERAGE'):self.prepare()
 def test_new_delta_file_invalidates_source_freeze(self):
  self.freeze();self.accept();(self.root/'specs/new').mkdir();(self.root/'specs/new/spec.md').write_text(DELTA)
  with self.assertRaisesRegex(ValueError,'SOURCE_DRIFT'):self.prepare()
 def test_config_change_invalidates_source_freeze(self):
  self.freeze();self.accept();(self.repo/'openspec/config.yaml').write_text('schema: different-schema\n')
  with self.assertRaisesRegex(ValueError,'SOURCE_DRIFT'):self.prepare()
 def test_archive_partial_failure_retains_backup_and_recovery_state(self):
  self.freeze();self.accept();p=self.prepare()
  original=life.cli
  def fail_archive(repo,args,log):
   if args[0]=='archive':
    (self.repo/'openspec/specs/auth/spec.md').write_text('partial mutation')
    raise ValueError('injected write failure')
   return original(repo,args,log)
  with patch.object(life,'cli',side_effect=fail_archive):
   with self.assertRaisesRegex(ValueError,'injected'):life.finalize(self.repo,self.change,self.receipt_path,p['preflight_path'])
  state=json.loads((self.repo/p['state_path']).read_text());self.assertEqual('RECOVERY_REQUIRED',state['status'])
  backup=self.repo/'.local/planner-lifecycle'/self.change/'before-openspec/specs/auth/spec.md'
  self.assertEqual(MAIN,backup.read_text())
 def test_rename_only_delta_has_acceptance_identity(self):
  (self.root/'specs/auth/spec.md').write_text('## RENAMED Requirements\n- FROM: `### Requirement: Login`\n- TO: `### Requirement: Password Login`\n')
  self.bindings={'AC1':[{'path':'specs/auth/spec.md','requirement':'Password Login','scenario':None}]}
  self.freeze();self.accept();self.close()
  self.assertIn('### Requirement: Password Login',(self.repo/'openspec/specs/auth/spec.md').read_text())
 def test_controller_lock_blocks_parallel_operation(self):
  import fcntl
  self.freeze();self.accept();lock=self.repo/'.local/planner-lifecycle/closeout.lock';lock.parent.mkdir(parents=True)
  with lock.open('a') as stream:
   fcntl.flock(stream.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
   with self.assertRaisesRegex(ValueError,'CONTROLLER_BUSY'):self.prepare()
 def test_post_archive_receipt_metadata_tampering_blocked(self):
  self.freeze();self.accept();r=self.close();receipt=json.loads(self.receipt_path.read_text());receipt['run_id']='different-run';self.save(receipt)
  with self.assertRaisesRegex(ValueError,'POST_ARCHIVE_RECEIPT'):life.audit(self.repo,r['state_path'])
 def test_unrelated_openspec_symlink_blocks_preview(self):
  self.freeze();self.accept();external=self.repo/'outside.txt';external.write_text('outside')
  # This unrelated symlink must never be dereferenced into a preview or backup.
  link=self.repo/'openspec/specs/other';link.symlink_to(external)
  # Reaccept implementation, isolating this test to the OpenSpec tree boundary.
  self.accept()
  with self.assertRaisesRegex(ValueError,'OPENSPEC_SYMLINK'):self.prepare()
 def test_partial_planner_bundle_cannot_bypass_guard(self):
  self.freeze();self.accept()
  (self.root/'execution-contract.json').write_text(json.dumps({'checks':[{'id':'V1','required':True,'acceptance_ids':['AC1']}]}))
  with self.assertRaisesRegex(ValueError,'PLAN_BUNDLE'):self.prepare()
 def test_escaping_change_rejected(self):
  with self.assertRaisesRegex(ValueError,'CHANGE_ID'):life.freeze(self.repo,'../escape',self.bindings)
if __name__=='__main__':unittest.main()
