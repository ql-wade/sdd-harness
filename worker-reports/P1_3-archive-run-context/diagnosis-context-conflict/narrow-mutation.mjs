import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {performance} from 'node:perf_hooks';
const repoRoot="/Volumes/mac-extend/codex/worktrees/comet-delivery-contracts/sdd-harness", runnerDir=path.join(repoRoot,'infra/delivery/runner'), upstreamLockPath=path.join(repoRoot,'integrations/comet/upstream.lock.json');
const DOMAIN_FILES=['compose.yaml','Dockerfile','image.lock.json','role-policy.json','workspace-mounts.json','authority-registration.example.json'];
const roots=[];const privateTmp=(prefix)=>{const p=fs.mkdtempSync(path.join(os.tmpdir(),prefix));roots.push(p);return p;};
const sha256File=(file)=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readDomainJson=(name)=>JSON.parse(fs.readFileSync(path.join(runnerDir,name)));
const parseJsonOut=(result)=>JSON.parse(result.stdout);
function makeBuildContextFixture() {
  const fixture = privateTmp('i02-context-export-');
  const copy = (relative, sourceRoot = repoRoot) => {
    const target = path.join(fixture, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(sourceRoot, relative), target);
  };
  const lock = JSON.parse(fs.readFileSync(upstreamLockPath));
  const sources = ['tools/infra/runner.mjs', 'tools/infra/secret-refs.mjs', 'lib/delivery/evidence.js',
    'infra/delivery/registry.json', 'infra/delivery/secrets.refs.example.json', 'infra/delivery/qualification-policy.json',
    'integrations/comet/upstream.lock.json', ...lock.patches.map((item) => item.path),
    'tools/comet/build.mjs', 'tools/comet/source.js', 'tools/comet/prepare-source.mjs',
    ...DOMAIN_FILES.map((name) => 'infra/delivery/runner/' + name),
    ...fs.readdirSync(path.join(repoRoot, 'contracts/delivery')).filter((name) => name.endsWith('.js')).map((name) => 'contracts/delivery/' + name)];
  const runtime = readDomainJson('image.lock.json').sourceInputs.runtime;
  // Extend legitimate prerequisites; every old context/materialization oracle stays unchanged.
  for (const file of new Set([...sources, ...runtime.bootstrap.files])) copy(file);
  for (const descriptor of [...Object.values(runtime.projects).flatMap(project => Object.values(project)),
    ...runtime.dependencies.flatMap(group => group.files)]) {
    const source = path.join(repoRoot, descriptor.path), bytes = fs.readFileSync(source);
    assert.equal(bytes.length, descriptor.bytes, 'SETUP: exact approved public prerequisite size');
    assert.equal(sha256File(source), descriptor.sha256, 'SETUP: exact approved public prerequisite SHA');
    if (descriptor.integrity) assert.equal('sha512-' + crypto.createHash('sha512').update(bytes).digest('base64'), descriptor.integrity);
    copy(descriptor.path);
  }
  const artifacts = process.env.I02_ACCEPTED_ARTIFACT_ROOT ?? repoRoot;
  for (const [file, digest] of [['.sdd/cache/runner-build/comet-source.tar.gz', lock.source.sha256],
    ['.sdd/cache/runner-build/openspec-1.11.0.tgz', '84820b173b57204bd7582a47ddae65e85fd492724172acc8e434e97ea1c05c3f']]) {
    assert.equal(sha256File(path.join(artifacts, file)), digest, 'UNVERIFIED: actual integrity-locked public input must exist; no synthetic digest substitution');
    copy(file, artifacts);
  }
  const invoke = (exportContext = true) => spawnSync(process.execPath, [path.join(fixture, 'tools/infra/runner.mjs'), 'build-plan', ...(exportContext ? ['--export-context'] : []), '--json'],
    { cwd: fixture, encoding: 'utf8', timeout: 60_000 });
  return { fixture, invoke };
}

const observations=[];
try{for(let index=0;index<3;index++){
 const {fixture,invoke}=makeBuildContextFixture();let started=performance.now();const initial=invoke();assert.equal(initial.status,0,initial.stdout);const preflightMs=performance.now()-started;
 const plan=parseJsonOut(initial),exported=path.join(fixture,plan.dockerBuild.context),declared=path.join(exported,'infra/delivery/runner/Dockerfile'),backup=path.join(fixture,'private-file-backup');
 fs.renameSync(declared,backup);
 try{for(const exportContext of [false,true]){started=performance.now();const result=invoke(exportContext);const report=parseJsonOut(result);const ms=performance.now()-started;observations.push({index,preflightMs,exportContext,ms,status:result.status,code:report.code,findings:report.findings??[],missingStillMissing:!fs.existsSync(declared)});console.log(JSON.stringify(observations.at(-1)));assert.equal(result.status,2);assert.equal(report.code,'CONTEXT_CONFLICT',JSON.stringify({code:report.code,findings:report.findings}));}}
 finally{fs.renameSync(backup,declared);}
 started=performance.now();const reused=invoke();assert.equal(reused.status,0,reused.stdout);assert.equal(parseJsonOut(reused).dockerBuild.materialized,true);console.log(JSON.stringify({index,restored:true,ms:performance.now()-started}));
}}finally{for(const r of roots)fs.rmSync(r,{recursive:true,force:true});}
