from pathlib import Path
import subprocess,os,sys,time,json,hashlib,datetime
r=Path('/private/tmp/P2_4-knowledge-native-r3/mirror');label=sys.argv[1];lock=r/sys.argv[2];argv=sys.argv[3:];out=r/'knowledge-runs'/label;out.mkdir(parents=True,exist_ok=False)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
inputs=[lock,r/'test/delivery-cases/2_4.mjs']+[r/x['path'] for x in json.loads(lock.read_text())['patches']]
before={str(p.relative_to(r)):sha(p) for p in inputs};env=dict(os.environ);env.update(PATH='/Users/mac/.nvm/versions/node/v24.15.0/bin:/opt/homebrew/bin:/usr/bin:/bin',COMET_UPSTREAM_LOCK=str(lock),PYTHONDONTWRITEBYTECODE='1',CI='true');env.pop('NODE_TEST_CONTEXT',None)
t=time.monotonic();start=datetime.datetime.now(datetime.timezone.utc).isoformat();p=subprocess.run(argv,cwd=r,env=env,capture_output=True,timeout=1500)
(out/'stdout.raw.txt').write_bytes(p.stdout);(out/'stderr.raw.txt').write_bytes(p.stderr);after={str(p.relative_to(r)):sha(p) for p in inputs}
m={'label':label,'startedAt':start,'endedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':p.returncode,'seconds':time.monotonic()-t,'inputBefore':before,'inputAfter':after,'inputsStable':before==after,'stdoutSha256':sha(out/'stdout.raw.txt'),'stderrSha256':sha(out/'stderr.raw.txt'),'scope':'isolated Node CODE Native mechanism; no role/OS/model/MCP/service qualification'};(out/'metadata.json').write_text(json.dumps(m,indent=2)+'\n');print(json.dumps(m));print(p.stdout.decode()[-5000:]);print(p.stderr.decode()[-1000:]);sys.exit(p.returncode)
