from pathlib import Path
import subprocess,os,tempfile,json,hashlib,time,selectors,signal,shutil
r=Path(__file__).resolve().parents[2];base=Path(tempfile.mkdtemp(prefix='fdn-cold-'));project=base/'project';project.mkdir();home=base/'home';home.mkdir();(home/'codex').mkdir();stubs=base/'bin';stubs.mkdir();raw=r/'.local/distribution-current/raw';node=shutil.which('node');lock=json.loads((r/'integrations/comet/upstream.lock.json').read_text());fingerprint=hashlib.sha256(json.dumps({'archive':lock['source']['sha256'],'patches':lock['patches'],'toolchain':lock['toolchain']},separators=(',',':')).encode()).hexdigest();cli=r/'.sdd/vendor/comet'/lock['source']['commit']/'builds'/fingerprint/'work/bin/comet.js'
files=subprocess.run(['git','ls-files','-z'],capture_output=True,check=True).stdout.decode().split('\0')
for rel in files:
 p=r/rel
 if not rel or not p.is_file():continue
 dest=project/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,dest)
for name in ['npm','npx']:(stubs/name).write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$FDN_INSTALL_LOG"\nexit 0\n');(stubs/name).chmod(0o755)
(stubs/'openspec').write_text('#!/bin/sh\nexec "$FDN_NODE" "$FDN_OPENSPEC" "$@"\n');(stubs/'openspec').chmod(0o755)
env={**os.environ,'HOME':str(home),'CODEX_HOME':str(home/'codex'),'PATH':str(stubs)+':'+str(Path(node).parent)+':'+os.environ['PATH'],'FDN_INSTALL_LOG':str(base/'installs.txt'),'FDN_NODE':node,'FDN_OPENSPEC':str(r/'.sdd/tools/openspec-1.11.0/node_modules/@fission-ai/openspec/bin/openspec.js'),'OPENSPEC_TELEMETRY':'0','PYTHONDONTWRITEBYTECODE':'1','GIT_CEILING_DIRECTORIES':str(base)}
input_files=['tools/foundation-export.mjs','tools/bootstrap.sh','tools/adapters/claude-code.sh','hooks.yaml','foundation/profiles/comet-managed.json','integrations/comet/upstream.lock.json','openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json']
input_hashes={p:hashlib.sha256((r/p).read_bytes()).hexdigest() for p in input_files}
events=[{'label':'input-snapshot','sha256':input_hashes,'source_head':subprocess.run(['git','rev-parse','HEAD'],cwd=r,capture_output=True,text=True).stdout.strip()}]
def run(label,args,extra=None,expected=(0,)):
 t=time.time();p=subprocess.run(args,cwd=project,env={**env,**(extra or {})},stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=120);(raw/(label+'.txt')).write_bytes(p.stdout);events.append({'label':label,'argv':args,'cwd':str(project),'started_unix':t,'ended_unix':time.time(),'exit':p.returncode,'sha256':hashlib.sha256(p.stdout).hexdigest()});assert p.returncode in expected,(label,p.stdout[-1500:]);return p
# Real opposite-order installation, repeated update/pull, preserving a user's independent entries.
settings=project/'.claude/settings.json'
settings.parent.mkdir(exist_ok=True)
settings.write_text(json.dumps({'permissions':{'allow':['Bash(echo user-keep)']},'hooks':{'SessionStart':[{'matcher':'startup','hooks':[{'type':'command','command':'echo user-keep'}]}]},'userMarker':'preserve'}))
run('cold-bootstrap-first',['bash',str(r/'tools/bootstrap.sh')],{'SDD_TARGET_ROOT':str(project)})
run('cold-comet-init',[node,str(cli),'init',str(project),'--yes','--json','--scope','project','--platform','codex','--workflow','classic','--codegraph','skip','--language','en'])
run('cold-bootstrap-after-init',['bash',str(r/'tools/bootstrap.sh')],{'SDD_TARGET_ROOT':str(project)})
lock_before=(project/'foundation/foundation-lock.json').read_bytes()
run('cold-comet-update',[node,str(cli),'update',str(project),'--current-project','--skip-self-update','--scope','project','--json'])
run('cold-repeat-pull',['bash',str(r/'tools/bootstrap.sh')],{'SDD_TARGET_ROOT':str(project)})
assert (project/'foundation/foundation-lock.json').read_bytes()==lock_before
assert json.loads(settings.read_text())['userMarker']=='preserve'
# A new native host process: initialize + skills/list only, never a thread/turn/provider request.
proc=subprocess.Popen([shutil.which('codex'),'app-server'],cwd=project,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,text=True,bufsize=1)
sel=selectors.DefaultSelector();sel.register(proc.stdout,selectors.EVENT_READ);sel.register(proc.stderr,selectors.EVENT_READ);messages=[];errors=[]
def send(msg):proc.stdin.write(json.dumps(msg)+'\n');proc.stdin.flush()
def response(ident):
 until=time.monotonic()+35
 while time.monotonic()<until:
  if proc.poll() is not None:raise RuntimeError('native host exited: '+''.join(errors))
  for key,_ in sel.select(1):
   line=key.fileobj.readline()
   if not line:continue
   if key.fileobj is proc.stderr:errors.append(line);continue
   msg=json.loads(line);messages.append(msg)
   if msg.get('id')==ident:return msg
 raise RuntimeError('native discovery timeout; owned process state inspected in finally, no duplicate launch')
try:
 send({'id':1,'method':'initialize','params':{'clientInfo':{'name':'foundation_local_discovery','title':'Foundation local discovery','version':'1'},'capabilities':{'experimentalApi':True}}});init=response(1);assert 'result' in init,init
 send({'method':'initialized','params':{}});send({'id':2,'method':'skills/list','params':{'cwds':[str(project)],'forceReload':True}});result=response(2);assert 'result' in result,result
 (raw/'cold-native-skills-list.json').write_text(json.dumps({'messages':messages,'stderr':errors,'requested_methods':['initialize','initialized','skills/list']},ensure_ascii=False,indent=2)+'\n')
 skills=result['result']['data'][0]['skills'];names={x['name'] for x in skills};required={x['name'] for x in json.loads((r/'openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json').read_text())['snapshots']}
 assert required<=names,(required-names,names)
 for name in required:
  assert any(x['name']==name and Path(x['path']).resolve()==(project/'.agents/skills'/name/'SKILL.md').resolve() for x in skills),name
 for snapshot in json.loads((r/'openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json').read_text())['snapshots']:
  for relative,digest in snapshot['files'].items():assert hashlib.sha256((project/'.agents/skills'/relative).read_bytes()).hexdigest()==digest
 assert not any(n.startswith(('sdd-','source-command-sdd-','trinity-')) or n=='superpowers' for n in names),names
 events.append({'label':'native-cold-skills-list','status':'PASS_DISCOVERY_ONLY','names':sorted(names),'required_methods':sorted(required),'model_turns':0})
finally:
 (raw/'cold-native-skills-list.json').write_text(json.dumps({'messages':messages,'stderr':errors,'requested_methods':['initialize']+(['initialized','skills/list'] if any(m.get('id')==2 for m in messages) else [])},ensure_ascii=False,indent=2)+'\n')
 if proc.poll() is None:os.killpg(proc.pid,signal.SIGTERM)
 try:proc.wait(timeout=5)
 except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
 events.append({'label':'native-host-cleanup','pid':proc.pid,'exit':proc.returncode})
 (raw/'cold-native-events.json').write_text(json.dumps(events,ensure_ascii=False,indent=2)+'\n')
run('cold-comet-uninstall',[node,str(cli),'uninstall',str(project),'--scope','project','--json','--force'])
run('cold-foundation-uninstall',['bash',str(r/'tools/bootstrap.sh'),'--uninstall'],{'SDD_TARGET_ROOT':str(project)})
assert json.loads(settings.read_text())['userMarker']=='preserve'
assert 'pre-tool-gate' not in settings.read_text()
# Reinitialization in reverse order uses the current source, without aliases or source mutation.
run('cold-comet-reinit',[node,str(cli),'init',str(project),'--yes','--json','--scope','project','--platform','codex','--workflow','classic','--codegraph','skip','--language','en'])
run('cold-bootstrap-reverse',['bash',str(r/'tools/bootstrap.sh')],{'SDD_TARGET_ROOT':str(project)})
assert json.loads(settings.read_text())['userMarker']=='preserve'
assert 'obra/superpowers' not in (base/'installs.txt').read_text() if (base/'installs.txt').exists() else True
init=run('cold-native-state-init',[node,str(cli),'state','init','asset-pin-observation','full','--isolation','current','--json'])
change=Path(json.loads(init.stdout)['data']['changeDir'])
run('cold-native-preview-shape-only',[node,str(cli),'guard','asset-pin-observation','open','--json'],expected=(0,1,2))
run_dir=change/'.comet';state=run_dir/'run-state.json';before=state.read_bytes()
shutil.copy2(project/'foundation/foundation-lock.json',run_dir/'foundation-lock.json')
run('cold-frozen-asset-readback',[node,str(r/'tools/foundation-export.mjs'),'check-run','--root',str(project),'--run-dir',str(run_dir)])
assert state.read_bytes()==before
(raw/'cold-native-events.json').write_text(json.dumps(events,ensure_ascii=False,indent=2)+'\n');(r/'.local/distribution-current/cold-project-path.txt').write_text(str(project)+'\n');assert input_hashes=={p:hashlib.sha256((r/p).read_bytes()).hexdigest() for p in input_files}
print('actual cold installs/update/uninstall/native discovery passed; project remains private for evidence')
