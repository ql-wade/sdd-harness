from pathlib import Path
import subprocess,json,sys,os,datetime,re,time
root=Path(__file__).resolve().parents[2];local=Path(__file__).parent;label=sys.argv[1];target=local/(label+'-guard');target.mkdir(exist_ok=False);now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
guard=subprocess.Popen(['/usr/bin/caffeinate','-i'],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
def proof():
 p=subprocess.run(['/usr/bin/pmset','-g','assertions'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True);active=False;rows=[]
 for line in p.stdout.decode(errors='replace').splitlines():
  if re.search(r'\bpid\s+\d+\(',line):active=bool(re.search(r'\bpid\s+'+str(guard.pid)+r'\(caffeinate\)',line))
  if active:rows.append(line)
 text='\n'.join(rows);return {'at':now(),'ownPid':guard.pid,'present':'PreventUserIdleSystemSleep' in text,'projection':text}
receipt={'guardPid':guard.pid,'guardArgv':['/usr/bin/caffeinate','-i'],'startedAt':now(),'testDispatched':False}
try:
 until=time.monotonic()+5
 while True:
  before=proof()
  if before['present']:break
  assert guard.poll() is None and time.monotonic()<until,'owned guard unavailable; no tests dispatched'
  time.sleep(.05)
 receipt['before']=before;argv=['python3',str(local/'capture.py'),label,*sys.argv[2:]];receipt['captureArgv']=argv;receipt['testDispatched']=True
 env=dict(os.environ);env['P1_3_ACCEPTED_ARTIFACT_ROOT']='/Users/mac/Code/sdd-harness';p=subprocess.run(argv,cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE);(target/'stdout.raw.txt').write_bytes(p.stdout);(target/'stderr.raw.txt').write_bytes(p.stderr);receipt['exitCode']=p.returncode;receipt['beforeStop']=proof();receipt['aliveUntilTerminal']=guard.poll() is None
 print(p.stdout.decode(errors='replace'),end='');print(p.stderr.decode(errors='replace'),end='',file=sys.stderr)
finally:
 if guard.poll() is None:guard.terminate()
 try:guard.wait(timeout=5)
 except subprocess.TimeoutExpired:guard.kill();guard.wait()
 receipt['guardExitCode']=guard.returncode;receipt['afterStop']=proof();receipt['endedAt']=now();(target/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
raise SystemExit(receipt.get('exitCode',1))
