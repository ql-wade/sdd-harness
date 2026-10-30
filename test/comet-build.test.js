import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { prepareCometSource, SOURCE_EXTRACTION_POLICY } from '../tools/comet/source.js';
import { buildCometDistribution, verifyCometDistribution } from '../tools/comet/build.mjs';

test('rejects an exact Node pin mismatch before reading source or writing project state', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-comet-build-node-'));
  try {
    // Fixed upstream identity from integrations/comet/upstream.lock.json.
    const alternateNode = process.versions.node === '24.13.0' ? '24.15.0' : '24.13.0';
    const lock = {
      schemaVersion: 1,
      package: {
        name: '@rpamis/comet',
        version: '0.4.5',
        integrity: 'sha512-zUs13Rq6Lk1mDgKGk/K3kbdiRLqv1j0DSw9oswwljIrVPiJ+NvfTYlKp2eLpIaIAzMA34RDx6KpenFC39qbR3A==',
      },
      source: {
        url: 'https://codeload.github.com/rpamis/comet/tar.gz/c90af44a4474662d7853aae76ce785404974fb0a',
        commit: 'c90af44a4474662d7853aae76ce785404974fb0a',
        sha256: '28a7e2faefa7817244bdc1e54fdca3443fb9e16d947f89df9d51391e45faaa1f',
        bytes: 40474019,
        directory: 'comet-c90af44a4474662d7853aae76ce785404974fb0a',
      },
      toolchain: { node: alternateNode, pnpm: '10.18.3', pythonMinimum: '3.12', sourceExtractionPolicy: SOURCE_EXTRACTION_POLICY },
      patches: [],
    };
    const archivePath = path.join(projectRoot, 'nonexistent-source.tar.gz');
    await assert.rejects(
      buildCometDistribution({ projectRoot, lock, archivePath }),
      { code: 'TOOLCHAIN_MISMATCH' },
    );
    assert.deepEqual(await fs.readdir(projectRoot), []);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});


// Tiny integrity-prepared source fixtures exercise only the build CLI exit
// contract. They are not a Comet distribution or production qualification.
async function verificationFixture(t, observed) {
  const projectRoot=await fs.mkdtemp(path.join(os.tmpdir(),'comet-build-cli-contract-'));
  t.after(()=>fs.rm(projectRoot,{recursive:true,force:true}));
  const commit='a'.repeat(40);
  const archivePath=path.join(projectRoot,'source.tar.gz');
  const fixturePath=path.join(projectRoot,'fixture','comet-'+commit);
  await fs.mkdir(path.join(fixturePath,'scripts/build'),{recursive:true});
  await fs.writeFile(path.join(fixturePath,'package.json'),JSON.stringify({name:'@rpamis/comet',version:'0.4.5',type:'module'}));
  await fs.writeFile(path.join(fixturePath,'observed.json'),JSON.stringify({value:observed}));
  for(const family of ['classic','native','entry']) await fs.writeFile(path.join(fixturePath,'scripts/build/build-'+family+'-runtime.mjs'),
    "import assert from 'node:assert/strict';import fs from 'node:fs';assert.equal(JSON.parse(fs.readFileSync('observed.json','utf8')).value,2);\n");
  const tar=spawnSync(process.env.COMET_SECURITY_PYTHON??'python3',['-c',
    'import tarfile,sys;from pathlib import Path\nwith tarfile.open(sys.argv[2],"w:gz") as out:out.add(sys.argv[1],arcname=Path(sys.argv[1]).name)',fixturePath,archivePath],{encoding:'utf8'});
  assert.equal(tar.status,0,'SETUP tar fixture: '+tar.stderr);
  const hash=(bytes)=>createHash('sha256').update(bytes).digest('hex');
  const archive=await fs.readFile(archivePath);
  const lock={schemaVersion:1,package:{name:'@rpamis/comet',version:'0.4.5'},source:{commit,directory:'comet-'+commit,sha256:hash(archive),bytes:archive.length},toolchain:{node:process.versions.node,pnpm:'10.18.3',pythonMinimum:'3.12',sourceExtractionPolicy:SOURCE_EXTRACTION_POLICY},patches:[]};
  const prepared=await prepareCometSource({projectRoot,lock,archivePath});
  const fingerprint=hash(JSON.stringify({archive:lock.source.sha256,patches:[],toolchain:lock.toolchain}));
  const buildRoot=path.join(projectRoot,'.sdd/vendor/comet',commit,'builds',fingerprint);
  const work=path.join(buildRoot,'work');await fs.cp(prepared.sourceDir,work,{recursive:true});
  const files={};
  async function inventory(directory,prefix='') {
    for(const entry of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:1)) {
      const name=prefix?prefix+'/'+entry.name:entry.name;const file=path.join(directory,entry.name);const stat=await fs.lstat(file);
      files[name]=entry.isDirectory()?{kind:'directory',executeBits:stat.mode&0o111}:{kind:'file',sha256:hash(await fs.readFile(file)),executeBits:stat.mode&0o111};
      if(entry.isDirectory()) await inventory(file,name);
    }
  }
  await inventory(work);await fs.writeFile(path.join(buildRoot,'distribution.json'),JSON.stringify({schemaVersion:1,fingerprint,sourceCommit:commit,files}));
  await fs.writeFile(path.join(projectRoot,'lock.json'),JSON.stringify(lock));return projectRoot;
}

for(const [name,value,expected] of [['failed',1,2],['passed',2,0]]) test('verification CLI '+name+' real assertions preserve JSON and exit '+expected,async(t)=>{
  const root=await verificationFixture(t,value);
  const cli=fileURLToPath(new URL('../tools/comet/build.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[cli,'--project',root,'--lock','lock.json','--check-generated','--json'],{encoding:'utf8',timeout:20000});
  const receipt=JSON.parse(result.stdout);
  assert.equal(receipt.status,value===1?'FAIL':'PASS');
  assert.equal(receipt.steps.length,3);
  assert.ok(receipt.steps.every(step=>value===1?step.exitCode!==0:step.exitCode===0));
  if(value===1) assert.match(result.stderr,/AssertionError/);
  assert.equal(result.status,expected,result.stderr);
});

test('verification CLI invalid arguments keep input exit 1 and coded JSON',()=>{
  const cli=fileURLToPath(new URL('../tools/comet/build.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[cli,'--unknown','--json'],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,1);assert.equal(result.stdout,'');
  assert.equal(JSON.parse(result.stderr).code,'INPUT_INVALID');
});

test('P1_1: committed upstream identity pins Comet 0.5.1 and its reviewed source/patch', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const lock = JSON.parse(await fs.readFile(path.join(root, 'integrations/comet/upstream.lock.json'), 'utf8'));
  assert.equal(lock.package.name, '@rpamis/comet');
  assert.equal(lock.package.version, '0.5.1');
  assert.equal(lock.package.integrity, 'sha512-ECcvdrS/6ysrJLhtD7LVeTiRHO0HqOQsK0KEaF1XqgF6O4rNYE2sAnYrB4zuvG+Fj9t5eXn0nPj27qYJ31Vw9A==');
  assert.equal(lock.source.commit, '35c9860b77b42bafa0c2d80d8d695889f888a924');
  assert.equal(lock.source.sha256, 'c1b6d2ff009f0ae0bf542169b3b52ab69c41a8d6418d5ce0822ce786fe968137');
  assert.equal(lock.source.bytes, 57429570);
  assert.equal(lock.source.directory, `comet-${lock.source.commit}`);
  assert.equal(lock.toolchain.sourceExtractionPolicy, SOURCE_EXTRACTION_POLICY, 'active lock must pin the implemented source extraction policy');
  assert.equal(lock.patches.length, 1);
  const patch = lock.patches[0];
  assert.equal(patch.path, 'integrations/comet/patches/0005-comet-050-kt-closeout.patch');
  assert.equal(createHash('sha256').update(await fs.readFile(path.join(root, patch.path))).digest('hex'), patch.sha256);
});

test('P1_1: lock-only package version change refuses reuse and verify',async(t)=>{
  const root=await verificationFixture(t,2);const lock=JSON.parse(await fs.readFile(path.join(root,'lock.json'),'utf8'));lock.package.version='0.5.1';
  await assert.rejects(verifyCometDistribution({projectRoot:root,lock}),{code:'SOURCE_BASELINE_DRIFT'});
  await assert.rejects(buildCometDistribution({projectRoot:root,lock,archivePath:path.join(root,'source.tar.gz')}),{code:'SOURCE_IDENTITY_MISMATCH'});
});

test('P1_1: forged provenance and lock cannot re-label source package',async(t)=>{
  const root=await verificationFixture(t,2);const lock=JSON.parse(await fs.readFile(path.join(root,'lock.json'),'utf8'));lock.package.version='0.5.1';
  const provenance=path.join(root,'.sdd/vendor/comet',lock.source.commit,'provenance.json');const data=JSON.parse(await fs.readFile(provenance,'utf8'));data.package.version='0.5.1';await fs.writeFile(provenance,JSON.stringify(data));
  await assert.rejects(verifyCometDistribution({projectRoot:root,lock}),{code:'SOURCE_BASELINE_DRIFT'});
});

test('P1_1: rehashed build package cannot masquerade as locked identity',async(t)=>{
  const root=await verificationFixture(t,2);const lock=JSON.parse(await fs.readFile(path.join(root,'lock.json'),'utf8'));
  const builds=path.join(root,'.sdd/vendor/comet',lock.source.commit,'builds');const buildRoot=path.join(builds,(await fs.readdir(builds))[0]);const file=path.join(buildRoot,'work/package.json');
  const body=JSON.parse(await fs.readFile(file,'utf8'));body.version='0.5.1';const bytes=JSON.stringify(body);await fs.writeFile(file,bytes);
  const mf=path.join(buildRoot,'distribution.json');const record=JSON.parse(await fs.readFile(mf,'utf8'));record.files['package.json'].sha256=createHash('sha256').update(bytes).digest('hex');await fs.writeFile(mf,JSON.stringify(record));
  await assert.rejects(verifyCometDistribution({projectRoot:root,lock}),{code:'BUILD_IDENTITY_MISMATCH'});
  await assert.rejects(buildCometDistribution({projectRoot:root,lock,archivePath:path.join(root,'source.tar.gz')}),{code:'BUILD_IDENTITY_MISMATCH'});
});

test('P1_1: rehashed wrong build package is not reusable',async(t)=>{
  const root=await verificationFixture(t,2);const lock=JSON.parse(await fs.readFile(path.join(root,'lock.json'),'utf8'));
  const builds=path.join(root,'.sdd/vendor/comet',lock.source.commit,'builds');const buildRoot=path.join(builds,(await fs.readdir(builds))[0]);const file=path.join(buildRoot,'work/package.json');
  const body=JSON.parse(await fs.readFile(file,'utf8'));body.name='@wrong/comet';const bytes=JSON.stringify(body);await fs.writeFile(file,bytes);
  const mf=path.join(buildRoot,'distribution.json');const record=JSON.parse(await fs.readFile(mf,'utf8'));record.files['package.json'].sha256=createHash('sha256').update(bytes).digest('hex');await fs.writeFile(mf,JSON.stringify(record));
  await assert.rejects(buildCometDistribution({projectRoot:root,lock,archivePath:path.join(root,'source.tar.gz')}),{code:'BUILD_IDENTITY_MISMATCH'});
});

test('P1_1: matching source and build remain reusable and verifiable',async(t)=>{
  const root=await verificationFixture(t,2);const lock=JSON.parse(await fs.readFile(path.join(root,'lock.json'),'utf8'));
  assert.equal((await verifyCometDistribution({projectRoot:root,lock})).status,'PASS');
  assert.equal((await buildCometDistribution({projectRoot:root,lock,archivePath:path.join(root,'source.tar.gz')})).reused,true);
});

test('P1_1: malformed rehashed build package fails identity validation',async(t)=>{
  const root=await verificationFixture(t,2);const lock=JSON.parse(await fs.readFile(path.join(root,'lock.json'),'utf8'));
  const builds=path.join(root,'.sdd/vendor/comet',lock.source.commit,'builds');const buildRoot=path.join(builds,(await fs.readdir(builds))[0]);const file=path.join(buildRoot,'work/package.json');const bytes='{not json';await fs.writeFile(file,bytes);
  const mf=path.join(buildRoot,'distribution.json');const record=JSON.parse(await fs.readFile(mf,'utf8'));record.files['package.json'].sha256=createHash('sha256').update(bytes).digest('hex');await fs.writeFile(mf,JSON.stringify(record));
  await assert.rejects(verifyCometDistribution({projectRoot:root,lock}),{code:'BUILD_IDENTITY_MISMATCH'});
  await assert.rejects(buildCometDistribution({projectRoot:root,lock,archivePath:path.join(root,'source.tar.gz')}),{code:'BUILD_IDENTITY_MISMATCH'});
});

test('P1_1: missing build package is not accepted even when manifest is altered',async(t)=>{
  const root=await verificationFixture(t,2);const lock=JSON.parse(await fs.readFile(path.join(root,'lock.json'),'utf8'));
  const builds=path.join(root,'.sdd/vendor/comet',lock.source.commit,'builds');const buildRoot=path.join(builds,(await fs.readdir(builds))[0]);await fs.unlink(path.join(buildRoot,'work/package.json'));
  const mf=path.join(buildRoot,'distribution.json');const record=JSON.parse(await fs.readFile(mf,'utf8'));delete record.files['package.json'];await fs.writeFile(mf,JSON.stringify(record));
  await assert.rejects(verifyCometDistribution({projectRoot:root,lock}),{code:'BUILD_IDENTITY_MISMATCH'});
  await assert.rejects(buildCometDistribution({projectRoot:root,lock,archivePath:path.join(root,'source.tar.gz')}),{code:'BUILD_IDENTITY_MISMATCH'});
});

test('P1_1: build reuse and verify reject missing or unknown extraction policy',async(t)=>{
  const root=await verificationFixture(t,2);const current=JSON.parse(await fs.readFile(path.join(root,'lock.json'),'utf8'));
  for (const value of [undefined,'unrecognized-policy']) {
    const lock=structuredClone(current);if(value===undefined)delete lock.toolchain.sourceExtractionPolicy;else lock.toolchain.sourceExtractionPolicy=value;
    await assert.rejects(verifyCometDistribution({projectRoot:root,lock}),{code:'LOCK_INVALID'});
    await assert.rejects(buildCometDistribution({projectRoot:root,lock,archivePath:path.join(root,'source.tar.gz')}),{code:'LOCK_INVALID'});
  }
});

test('P1_1: active policy lives inside the unchanged fingerprint formula while retired image identity stays historical',async()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const lock=JSON.parse(await fs.readFile(path.join(root,'integrations/comet/upstream.lock.json'),'utf8'));
  const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  assert.equal(sha({archive:lock.source.sha256,patches:lock.patches.map(({path,sha256})=>({path,sha256})),toolchain:lock.toolchain}),'d6e72988122f4380124579dd4e3281e344d009f2ac280b29197f24011d7477c7');
  const retired=JSON.parse(await fs.readFile(path.join(root,'infra/delivery/runner/image.lock.json'),'utf8')).sourceInputs;
  assert.equal(Object.hasOwn(retired.toolchain,'sourceExtractionPolicy'),false);
  assert.equal(sha({archive:retired.archiveSha256,patches:retired.patches.map(({path,sha256})=>({path,sha256})),toolchain:retired.toolchain}),retired.hostBuildFingerprint);
});
