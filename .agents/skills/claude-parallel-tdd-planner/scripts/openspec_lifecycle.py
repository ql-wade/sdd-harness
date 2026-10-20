#!/usr/bin/env python3
"""Repo-local OpenSpec closeout. Evidence receipt is a controller-reviewed binding,
not an attestation. No test execution, git merge, or silent recovery is implied."""
from __future__ import annotations
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from zoneinfo import ZoneInfo

EXCLUDED = {'.git', '.local', '.whitebox', 'openspec', '__pycache__'}

def sha(data): return hashlib.sha256(data).hexdigest()
def read(path): return json.loads(Path(path).read_text(encoding='utf-8'))
def write(path, value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name(path.name+'.tmp')
    temporary.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    temporary.replace(path)
def rel(repo,path): return str(Path(path).resolve().relative_to(repo.resolve()))
def safe(repo,name):
    p=Path(name)
    if p.is_absolute() or '..' in p.parts: raise ValueError('PATH_ESCAPE: '+str(name))
    result=repo/p
    if not result.resolve().is_relative_to(repo.resolve()): raise ValueError('PATH_ESCAPE: '+str(name))
    # Symlink aliases create ambiguous snapshots and ownership.
    if any(p.is_symlink() for p in (result,*list(result.parents)[:len(Path(name).parts)])):
        raise ValueError('PATH_SYMLINK: '+str(name))
    return result

def change_root(repo,change):
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]*',change) or change=='archive': raise ValueError('CHANGE_ID: invalid repo-local change')
    return safe(repo,'openspec/changes/'+change)

def implementation_baseline(repo):
    repo=Path(repo).resolve()
    files={}
    for p in sorted(repo.rglob('*')):
        r=p.relative_to(repo)
        if r.parts[0] in EXCLUDED or '__pycache__' in r.parts: continue
        if p.is_symlink(): raise ValueError('BASELINE: symlink requires explicit external adapter: '+str(r))
        if p.is_file(): files[str(r)]=sha(p.read_bytes())
    revision=subprocess.run(['git','rev-parse','HEAD'],cwd=repo,capture_output=True,text=True).stdout.strip() or None
    return {'revision':revision,'files':files,'digest':sha(json.dumps(files,sort_keys=True).encode())}

def prose(text):
    out=[];fence=None
    for line in text.splitlines():
        m=re.match(r'^\s*(`{3,}|~{3,})',line)
        if fence:
            if m and m[1][0]==fence[0] and len(m[1])>=len(fence): fence=None
            continue
        if m: fence=m[1];continue
        out.append(line)
    return '\n'.join(out)

def blocks(text):
    """Conservative Markdown reader for named requirements/scenarios, not a merger."""
    result={};section=None;req=None
    for line in prose(text).splitlines():
        m=re.match(r'^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements\s*$',line)
        if m: section=m[1];req=None;continue
        m=re.match(r'^### Requirement:\s*(.+?)\s*$',line)
        if m:
            req=m[1]
            if req in result: raise ValueError('SPEC_AMBIGUOUS: duplicate requirement '+req)
            result[req]={'operation':section,'scenarios':[]}
        m=re.match(r'^#### Scenario:\s*(.+?)\s*$',line)
        if m and req:
            if m[1] in result[req]['scenarios']: raise ValueError('SPEC_AMBIGUOUS: duplicate scenario')
            result[req]['scenarios'].append(m[1])
    return result

def validate_openspec_tree(repo):
    root=repo/'openspec'
    if root.is_symlink() or any(p.is_symlink() for p in root.rglob('*')):
        raise ValueError('OPENSPEC_SYMLINK: preview/backup must not dereference outside source tree')

def sources(repo,root):
    validate_openspec_tree(repo)
    paths={root/'proposal.md',root/'design.md',root/'tasks.md',root/'.openspec.yaml',repo/'openspec/config.yaml',repo/'.openspec.yaml'}
    paths.update((root/'specs').rglob('*.md'))
    paths.update((repo/'openspec/schemas').rglob('*'))
    for p in (root/'specs').rglob('*.md'): paths.add(repo/'openspec/specs'/p.relative_to(root/'specs'))
    result={}
    for p in sorted(paths):
        if p.is_dir(): continue
        safe(repo,str(p.relative_to(repo)))
        data=p.read_bytes() if p.exists() else None
        if p==root/'tasks.md' and data is not None:
            from plan_guard import prose_and_normalized
            data=prose_and_normalized(data.decode())[1].encode()
        result[str(p.relative_to(repo))]=sha(data) if data is not None else None
    return result

def check_mapping(repo,root,bindings,dispositions):
    actual=set();lost=set()
    for p in sorted((root/'specs').rglob('*.md')):
        path=str(p.relative_to(root));delta=blocks(p.read_text())
        base_path=repo/'openspec/specs'/p.relative_to(root/'specs')
        base=blocks(base_path.read_text()) if base_path.exists() else {}
        text=prose(p.read_text())
        renames=dict(re.findall(r'FROM:\s*`?### Requirement:\s*([^`\n]+)`?\s*\n[^\n]*TO:\s*`?### Requirement:\s*([^`\n]+)',text))
        renamed_from={v.strip():k.strip() for k,v in renames.items()}
        for new,old in renamed_from.items():
            if old not in base or (new in base and new!=old):
                raise ValueError('RENAME_CONFLICT: source absent or target already exists')
            if new not in delta: actual.add((path,new,None))
        for name,item in delta.items():
            scenarios=item['scenarios']
            if scenarios: actual.update((path,name,s) for s in scenarios)
            else: actual.add((path,name,None))
            if item['operation']=='MODIFIED':
                old=base.get(renamed_from.get(name,name),{}).get('scenarios',[])
                lost.update((path,name,s) for s in set(old)-set(scenarios))
    declared=set()
    if not isinstance(bindings,dict) or not bindings: raise ValueError('SCENARIO_COVERAGE: acceptance bindings required')
    for ac,rows in bindings.items():
        if not isinstance(ac,str) or not ac or not isinstance(rows,list) or not rows: raise ValueError('SCENARIO_COVERAGE: empty binding')
        for row in rows: declared.add((row['path'],row['requirement'],row.get('scenario')))
    if declared!=actual: raise ValueError('SCENARIO_COVERAGE: missing or nonexistent delta requirement/scenario binding')
    allowed={(r['path'],r['requirement'],r.get('scenario')) for r in dispositions if isinstance(r.get('reason'),str) and r['reason'].strip()}
    if lost-allowed: raise ValueError('SCENARIO_REMOVED: MODIFIED drops existing scenarios without reviewed disposition: '+repr(sorted(lost-allowed)))

def cli(repo,args,log):
    command=['openspec',*args]
    env=dict(os.environ,OPENSPEC_TELEMETRY='0',DO_NOT_TRACK='1',CI='1')
    p=subprocess.run(command,cwd=repo,capture_output=True,text=True,env=env,timeout=90)
    Path(log).parent.mkdir(parents=True,exist_ok=True)
    Path(log).write_text(json.dumps({'command':command,'cwd':str(repo),'exit_code':p.returncode,'stdout':p.stdout,'stderr':p.stderr},indent=2))
    if p.returncode: raise ValueError('OPENSPEC_COMMAND_FAILED: '+str(log))
    return p.stdout

def freeze(repo,change,bindings,policy='in-change',target_ref=None,dispositions=None):
    repo=Path(repo).resolve();root=change_root(repo,change);path=root/'spec-baseline.json'
    if path.exists(): raise ValueError('SOURCE_ALREADY_FROZEN: reviewed replan must preserve previous baseline first')
    if policy not in ('in-change','after-merge') or (policy=='after-merge' and not target_ref): raise ValueError('CLOSEOUT_POLICY: target ref required')
    if not (root/'proposal.md').is_file() or not (root/'tasks.md').is_file(): raise ValueError('SOURCE_MISSING: proposal/tasks required by repo-local adapter')
    if not list((root/'specs').rglob('*.md')): raise ValueError('SPEC_UNAVAILABLE: no delta specs; use a reviewed no-spec closeout adapter')
    check_mapping(repo,root,bindings,dispositions or [])
    value={'schema_version':1,'change_id':change,'policy':policy,'target_ref':target_ref,
           'bindings':bindings,'dispositions':dispositions or [],'sources':sources(repo,root)}
    write(path,value)
    return {'baseline_path':rel(repo,path),'sha256':sha(path.read_bytes())}

def check_sources(repo,root):
    baseline=read(root/'spec-baseline.json')
    if sources(repo,root)!=baseline['sources']: raise ValueError('SOURCE_DRIFT: HALT_AND_REPLAN')
    check_mapping(repo,root,baseline['bindings'],baseline['dispositions'])
    return baseline

def evidence_ref(repo,ref):
    p=safe(repo,ref['path'])
    if not p.is_file() or sha(p.read_bytes())!=ref['sha256']: raise ValueError('EVIDENCE: missing or changed '+str(ref))
    return p

def validate_whitebox_ledger(repo,receipt):
    configured=os.environ.get('PLANNER_WHITEBOX_ROOT')
    candidates=([Path(configured)] if configured else []) + [
        Path(__file__).resolve().parents[2]/'whitebox-verify',
        Path.home()/'.agents/skills/whitebox-verify',Path.home()/'.codex/skills/whitebox-verify']
    script=next((p/'scripts/validate_journey_evidence.py' for p in candidates
                 if (p/'scripts/validate_journey_evidence.py').is_file()),None)
    if script is None: raise ValueError('WHITEBOX_VALIDATOR_UNAVAILABLE: discover installed skill or set PLANNER_WHITEBOX_ROOT')
    command=[sys.executable,str(script),str(evidence_ref(repo,receipt['ledger']))]
    p=subprocess.run(command,cwd=repo,capture_output=True,text=True,timeout=90)
    log=safe(repo,'.local/planner-lifecycle/whitebox-validator-latest.json')
    write(log,{'command':command,'exit_code':p.returncode,'stdout':p.stdout,'stderr':p.stderr})
    if p.returncode!=0 or 'STRUCTURE_PASS' not in p.stdout:
        raise ValueError('WHITEBOX_VALIDATOR: original ledger failed installed validator; '+str(log))

# Stable reference lets tests exercise the actual adapter separately from the
# explicitly mocked Whitebox boundary in archive integration tests.
REAL_WHITEBOX_VALIDATOR=validate_whitebox_ledger

def whitebox(repo,receipt_path,baseline):
    receipt=read(receipt_path)
    if (receipt.get('skill')!='whitebox-verify' or receipt.get('mode') not in ('Slice','Journey') or
        receipt.get('status')!='PASS' or receipt.get('evidence_review')!='PASS' or
        not receipt.get('run_id') or not receipt.get('inspected_by')): raise ValueError('WHITEBOX: actual acceptance and inspected evidence required')
    if receipt.get('baseline')!=implementation_baseline(repo): raise ValueError('BASELINE: Whitebox run does not match implementation')
    for field in ('ledger','report'): evidence_ref(repo,receipt[field])
    validator=receipt['validator']
    if validator.get('exit_code')!=0: raise ValueError('WHITEBOX: validator gate unsatisfied')
    evidence_ref(repo,validator['log'])
    covered=set();ids=set()
    for check in receipt['checks']:
        if check['id'] in ids or check['status']!='PASS' or not check.get('evidence'): raise ValueError('WHITEBOX: incomplete/duplicate checks')
        ids.add(check['id']);covered.update(check['acceptance_ids'])
        for ref in check['evidence']: evidence_ref(repo,ref)
    if covered!=set(baseline['bindings']): raise ValueError('ACCEPTANCE: Whitebox coverage differs from frozen acceptance')
    contract_path=change_root(repo,baseline['change_id'])/'execution-contract.json'
    if not contract_path.exists():
        matches=list((repo/'openspec/changes/archive').glob('*-'+baseline['change_id']+'/execution-contract.json'))
        if len(matches)==1: contract_path=matches[0]
    if contract_path.exists():
        checks={c['id']:set(c['acceptance_ids']) for c in read(contract_path)['checks'] if c['required']}
        observed={c['id']:set(c['acceptance_ids']) for c in receipt['checks']}
        if any(observed.get(key)!=value for key,value in checks.items()):
            raise ValueError('CHECK_COVERAGE: every required planner check must pass with exact acceptance binding')
    for finding in receipt['findings']:
        if finding.get('severity') in ('P0','P1'):
            if finding.get('status') not in ('fixed','resolved') or not finding.get('resolution_evidence'): raise ValueError('FINDING: unclosed P0/P1')
            for ref in finding['resolution_evidence']: evidence_ref(repo,ref)
    validate_whitebox_ledger(repo,receipt)
    return receipt

def validate_planner_bundle(repo,root):
    names=('architecture.md','task-dag.json','execution-contract.json','drift-lock.json')
    if not any((root/name).exists() for name in names): return
    if not all((root/name).is_file() for name in names):
        raise ValueError('PLAN_BUNDLE: partial planner bundle cannot bypass plan_guard')
    from plan_guard import validate_bundle
    try:
        issues=validate_bundle(root/'tasks.md',root/'task-dag.json',root/'drift-lock.json',
                               root/'architecture.md',root/'execution-contract.json',repo)
    except (ValueError,KeyError,TypeError) as error: raise ValueError('PLAN_BUNDLE: '+str(error))
    if issues: raise ValueError('PLAN_BUNDLE: '+repr([i.message for i in issues]))

def tasks_complete(root):
    lines=prose((root/'tasks.md').read_text()).splitlines()
    tasks=[line for line in lines if re.match(r'^\s*[-*] \[[ xX]\]',line)]
    if not tasks or any(re.match(r'^\s*[-*] \[ \]',line) for line in tasks): raise ValueError('TASKS_INCOMPLETE: no complete evidence-backed task list')

def merge_gate(repo,baseline,receipt):
    if baseline['policy']!='after-merge': return
    rev=receipt['baseline'].get('revision');ref=baseline['target_ref']
    # Require the configured target checkout, not a branch merely descended from it.
    head=subprocess.run(['git','rev-parse','HEAD'],cwd=repo,capture_output=True,text=True)
    target=subprocess.run(['git','rev-parse','--verify',ref],cwd=repo,capture_output=True,text=True)
    ancestor=subprocess.run(['git','merge-base','--is-ancestor',rev or 'INVALID',ref],cwd=repo,capture_output=True)
    if not rev or head.returncode or target.returncode or head.stdout.strip()!=target.stdout.strip() or ancestor.returncode:
        raise ValueError('MERGE_REQUIRED: accepted revision must be in configured target checkout; no merge is performed')

def tree_manifest(root):
    return {str(p.relative_to(root)):sha(p.read_bytes()) for p in sorted(root.rglob('*')) if p.is_file()}

def paths(repo,change):
    state_dir=safe(repo,'.local/planner-lifecycle/'+change)
    return state_dir,state_dir/'state.json',state_dir/'preflight.json'

def serialized(function):
    def run(repo,*args,**kwargs):
        try: import fcntl
        except ImportError: raise ValueError('CLOSEOUT_UNAVAILABLE: POSIX advisory locking required')
        repo=Path(repo).resolve()
        lock=safe(repo,'.local/planner-lifecycle/closeout.lock')
        lock.parent.mkdir(parents=True,exist_ok=True)
        with lock.open('a') as stream:
            try: fcntl.flock(stream.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError: raise ValueError('CONTROLLER_BUSY: another closeout helper owns repository')
            return function(repo,*args,**kwargs)
    return run

@serialized
def prepare(repo,change,receipt_path):
    repo=Path(repo).resolve();root=change_root(repo,change);directory,state_path,preflight_path=paths(repo,change)
    if state_path.exists() and read(state_path).get('status') in ('FINALIZING','RECOVERY_REQUIRED','ARCHIVED'):
        raise ValueError('RECOVERY_REQUIRED: audit existing operation before starting another')
    baseline=check_sources(repo,root);tasks_complete(root);receipt=whitebox(repo,receipt_path,baseline);validate_planner_bundle(repo,root);merge_gate(repo,baseline,receipt)
    directory.mkdir(parents=True,exist_ok=True)
    cli(repo,['validate',change,'--type','change','--strict','--no-interactive'],directory/'validate-change.log')
    date=datetime.now(ZoneInfo('UTC')).strftime('%Y-%m-%d')  # installed CLI uses ISO UTC archive date
    archive_path='openspec/changes/archive/'+date+'-'+change
    if safe(repo,archive_path).exists(): raise ValueError('ARCHIVE_EXISTS: '+archive_path)
    # Use the installed merger as authority. Do not implement a competing spec merger.
    with tempfile.TemporaryDirectory(prefix='planner-archive-preview-') as temp:
        preview=Path(temp)
        shutil.copytree(repo/'openspec',preview/'openspec',symlinks=False)
        cli(preview,['archive',change,'--yes'],directory/'preview-archive.log')
        archived=preview/archive_path
        if not archived.is_dir() or (preview/'openspec/changes'/change).exists(): raise ValueError('PREVIEW_FAILED: archive postconditions absent')
        cli(preview,['validate','--specs','--strict','--no-interactive'],directory/'preview-specs.log')
        expected=tree_manifest(preview/'openspec/specs')
    value={'schema_version':1,'change_id':change,'status':'READY','archive_path':archive_path,
           'source_baseline_sha256':sha((root/'spec-baseline.json').read_bytes()),
           'receipt_path':rel(repo,receipt_path),'receipt_sha256':sha(Path(receipt_path).read_bytes()),
           'archive_manifest':tree_manifest(root),'expected_specs':expected,
           'specs_before':tree_manifest(repo/'openspec/specs'),
           'preflight_path':rel(repo,preflight_path),'state_path':rel(repo,state_path)}
    write(preflight_path,value);write(state_path,value)
    return value

@serialized
def finalize(repo,change,receipt_path,preflight_path):
    repo=Path(repo).resolve();root=change_root(repo,change);directory,state_path,canonical=paths(repo,change)
    if Path(preflight_path).is_absolute(): preflight_path=rel(repo,preflight_path)
    if safe(repo,preflight_path).resolve()!=canonical.resolve(): raise ValueError('PREFLIGHT_SCOPE: wrong change operation')
    value=read(canonical);state=read(state_path)
    if state.get('status')=='ARCHIVED': return audit(repo,rel(repo,state_path))
    if state.get('status')!='READY': raise ValueError('RECOVERY_REQUIRED: operation may have partially applied; no blind retry')
    baseline=check_sources(repo,root);tasks_complete(root);receipt=whitebox(repo,receipt_path,baseline);validate_planner_bundle(repo,root);merge_gate(repo,baseline,receipt)
    if not Path(value['archive_path']).name.startswith(datetime.now(ZoneInfo('UTC')).strftime('%Y-%m-%d')+'-'):
        raise ValueError('PREFLIGHT_EXPIRED: archive date changed; rerun preflight')
    if value['change_id']!=change or sha(Path(receipt_path).read_bytes())!=value['receipt_sha256'] or sha((root/'spec-baseline.json').read_bytes())!=value['source_baseline_sha256']:
        raise ValueError('PREFLIGHT_DRIFT: rerun preflight after reviewed change')
    if tree_manifest(root)!=value['archive_manifest'] or tree_manifest(repo/'openspec/specs')!=value['specs_before']:
        raise ValueError('PREFLIGHT_DRIFT: source or target changed')
    if safe(repo,value['archive_path']).exists(): raise ValueError('ARCHIVE_EXISTS: refuse before writing specs')
    backup=directory/'before-openspec'
    if backup.exists(): raise ValueError('RECOVERY_REQUIRED: preserved backup already exists')
    shutil.copytree(repo/'openspec',backup)
    value['status']='FINALIZING';write(state_path,value)
    try:
        cli(repo,['archive',change,'--yes'],directory/'archive.log')
        cli(repo,['validate','--specs','--strict','--no-interactive'],directory/'post-specs.log')
        value['status']='ARCHIVED';write(state_path,value)
        return audit(repo,rel(repo,state_path))
    except Exception:
        value['status']='RECOVERY_REQUIRED';write(state_path,value)
        raise

def audit(repo,state_path):
    repo=Path(repo).resolve();state=read(safe(repo,state_path));change=state['change_id'];root=change_root(repo,change)
    if state.get('status')!='ARCHIVED': raise ValueError('RECOVERY_REQUIRED: no verified archive state')
    validate_openspec_tree(repo)
    archive=safe(repo,state['archive_path'])
    if root.exists() or not archive.is_dir() or tree_manifest(archive)!=state['archive_manifest'] or tree_manifest(repo/'openspec/specs')!=state['expected_specs']:
        raise ValueError('POST_ARCHIVE: location/content/spec mismatch')
    # Receipt refs inside the moved change would be stale. Rebind explicitly before
    # preflight or keep raw evidence in .whitebox/ outside the relocating root.
    receipt_path=safe(repo,state['receipt_path'])
    if sha(receipt_path.read_bytes())!=state['receipt_sha256']:
        raise ValueError('POST_ARCHIVE_RECEIPT: accepted receipt metadata changed')
    baseline=read(archive/'spec-baseline.json')
    whitebox(repo,safe(repo,state['receipt_path']),baseline)
    return state

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('freeze','prepare','finalize','audit','baseline'))
    parser.add_argument('--repo-root',type=Path,required=True)
    parser.add_argument('--change');parser.add_argument('--bindings',type=Path)
    parser.add_argument('--dispositions',type=Path);parser.add_argument('--policy',choices=('in-change','after-merge'),default='in-change')
    parser.add_argument('--target-ref');parser.add_argument('--receipt',type=Path);parser.add_argument('--preflight',type=Path);parser.add_argument('--state')
    args=parser.parse_args()
    try:
        repo=args.repo_root.resolve()
        if args.action=='baseline': result=implementation_baseline(repo)
        elif args.action=='audit':result=audit(repo,args.state)
        elif args.action=='freeze':result=freeze(repo,args.change,read(args.bindings),args.policy,args.target_ref,read(args.dispositions) if args.dispositions else [])
        elif args.action=='prepare':result=prepare(repo,args.change,args.receipt.resolve())
        else:result=finalize(repo,args.change,args.receipt.resolve(),args.preflight)
        print(json.dumps(result,ensure_ascii=False));return 0
    except (ValueError,OSError,KeyError,TypeError,subprocess.TimeoutExpired) as error:
        print(json.dumps({'status':'BLOCKED','error':str(error)},ensure_ascii=False));return 1
if __name__=='__main__':sys.exit(main())
