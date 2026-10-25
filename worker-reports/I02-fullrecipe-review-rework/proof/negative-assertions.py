import pathlib,json,sys,hashlib
out=pathlib.Path(__file__).parent;raw=(out/'receipt.json').read_bytes();assert hashlib.sha256(raw).hexdigest()=='9c0b5c2c41e18902c889383fb5d5643bfd43674dda2564f6fbbd0fc6744222d8';records=json.loads(raw)['records'];assert records[0]['exit']==0
results=[{'case':r['label'],'expectedExit':2,'actualExit':r['exit'],'passed':r['exit']==2,'argvEmitted':r['argvEmitted']} for r in records[1:]]
value={'scope':'assertions over sealed actual public CLI captures; no re-execution','results':results,'passed':sum(r['passed'] for r in results),'failed':sum(not r['passed'] for r in results)};(out/'negative-assertions.json').write_text(json.dumps(value,indent=2)+'\n');print(json.dumps(value));sys.exit(0 if all(r['passed'] for r in results) else 1)
