import datetime, hashlib, json, os, pathlib, subprocess, sys

root = pathlib.Path('/Users/mac/Code/sdd-harness')
base = root / '.local/comet-reset/host-components-preflight'
node = '/Users/mac/.nvm/versions/node/v24.15.0/bin/node'
guard = base / 'offline-bin'
guard.mkdir(exist_ok=True)
for name in ['docker', 'gh', 'codex', 'claude', 'zcode', 'curl']:
    file = guard / name
    file.write_text('#!/opt/homebrew/bin/python3\nimport os,sys\nwith open(os.environ["SDD_ROOT_GUARD_TRACE"],"a") as f:f.write(' + repr(name + '\n') + ')\nraise SystemExit(97)\n')
    file.chmod(0o755)
label, *args = sys.argv[1:]
assert label and '/' not in label and '..' not in label
out = base / label
out.mkdir(exist_ok=False)
trace = out / 'external-guard.log'
env = {'PATH': str(guard) + ':' + str(pathlib.Path(node).parent) + ':/opt/homebrew/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC', 'TMPDIR': '/private/tmp', 'SDD_ROOT_GUARD_TRACE': str(trace), 'PYTHONDONTWRITEBYTECODE': '1', 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'}
if 'HOME' in os.environ:
    env['HOME'] = os.environ['HOME']
trace.write_text('')
for name in ['docker', 'gh', 'codex', 'claude', 'zcode', 'curl']:
    calibration = subprocess.run([str(guard / name), '--version'], env=env, capture_output=True)
    assert calibration.returncode == 97
assert trace.read_text().splitlines() == ['docker', 'gh', 'codex', 'claude', 'zcode', 'curl']
trace.write_text('')
preflight = json.loads((base / 'preflight.json').read_text())
inputs = list(dict.fromkeys(preflight['codePaths'] + list(preflight['protectedBefore']) + ['integrations/comet/upstream.lock.json','infra/delivery/qualification-policy.json','infra/delivery/registry.json','infra/delivery/secrets.refs.example.json','openspec/changes/delivery-foundation-rearchitecture/execution-contract.json']))
def hashes():
    return {p: hashlib.sha256((root / p).read_bytes()).hexdigest() if (root / p).is_file() else None for p in inputs}
before = hashes()
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
argv = ['/bin/bash', 'scripts/check.sh'] if args == ['--shell-check'] else [node, *args]
with (out / 'stdout.txt').open('wb') as stdout, (out / 'stderr.txt').open('wb') as stderr:
    result = subprocess.run(argv, cwd=root, env=env, stdout=stdout, stderr=stderr, timeout=300)
after = hashes()
record = {'startedAt': started, 'endedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'cwd': str(root), 'argv': argv, 'exitCode': result.returncode, 'inputBefore': before, 'inputAfter': after, 'inputsUnchanged': before == after, 'guardCalibration': '6/6 exit97', 'guardInvocations': trace.read_text().splitlines(), 'scope': 'Root main construction regression only;not real Docker/role/ACL qualification'}
record['captureSha256'] = hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
record['homePolicy'] = 'Inherited existing HOME unchanged; not repurposed. Required by login-shell fixture.'
record['logs'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in out.iterdir() if p.is_file()}
(out / 'metadata.json').write_text(json.dumps(record, indent=2) + '\n')
assert before == after
print(json.dumps({'label': label, 'exitCode': result.returncode, 'inputsUnchanged': True, 'guardInvocations': record['guardInvocations'], 'stdoutTail': (out / 'stdout.txt').read_text()[-1800:]}))
raise SystemExit(result.returncode)
