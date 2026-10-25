from pathlib import Path
import datetime, hashlib, json, os, re, subprocess, sys, time
repo=Path.cwd()
out=Path(__file__).resolve().parent
label=sys.argv[1]
argv=sys.argv[2:]
env=dict(os.environ)
env.pop('NODE_TEST_CONTEXT',None)
if Path(argv[0]).name == 'node':
    env['PATH']=str(Path(argv[0]).parent)+os.pathsep+env.get('PATH','')
started=datetime.datetime.now(datetime.timezone.utc).isoformat()
t0=time.monotonic()
run=subprocess.run(argv,cwd=repo,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
ended=datetime.datetime.now(datetime.timezone.utc).isoformat()
raw=run.stdout+b'\n# STDERR\n'+run.stderr
rawfile=out/'raw'/f'{label}.log'
rawfile.write_bytes(raw)
display=raw.decode('utf8',errors='replace')
display=display.replace(str(repo),'<worker-tree>')
display=re.sub(r'/(?:private/)?var/folders/[^\s"\']+', '<temp-path>', display)
display=re.sub(r'/Users/[^\s"\']+', '<host-path>', display)
display=re.sub(r'/Volumes/[^\s"\']+', '<host-path>', display)
display='\n'.join(line.rstrip() for line in display.splitlines()).rstrip()+'\n'
displayfile=out/'display'/f'{label}.tap'
displayfile.write_text(display)
entry={'label':label,'started_at_utc':started,'ended_at_utc':ended,'duration_seconds':time.monotonic()-t0,'cwd':str(repo),'argv':argv,'exit_code':run.returncode,'raw_file':str(rawfile.relative_to(repo)),'raw_sha256':hashlib.sha256(raw).hexdigest(),'display_file':str(displayfile.relative_to(repo)),'display_sha256':hashlib.sha256(display.encode()).hexdigest(),'source_hashes':{name:hashlib.sha256((repo/name).read_bytes()).hexdigest() for name in ['tools/verify/delivery-journey.mjs','tools/verify/delivery-case-schema.json','test/comet-flow-acceptance.test.js','test/delivery-cases/3_1.mjs']}}
(out/'raw'/f'{label}.metadata.log').write_text(json.dumps(entry,indent=2)+'\n')
entry['cwd']='<worker-tree>'
entry['argv']=[value.replace(str(repo),'<worker-tree>').replace(str(Path.home()),'<user-home>') for value in argv]
with (out/'runs.jsonl').open('a') as file:file.write(json.dumps(entry)+'\n')
print(json.dumps({key:entry[key] for key in ['label','exit_code','duration_seconds','raw_sha256','display_sha256']}))
print('\n'.join(display.splitlines()[-15:]))
