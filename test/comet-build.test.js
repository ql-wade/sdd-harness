import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { prepareCometSource } from '../tools/comet/source.js';
import { buildCometDistribution } from '../tools/comet/build.mjs';

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
      toolchain: { node: alternateNode, pnpm: '10.18.3', pythonMinimum: '3.12' },
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
  const lock={schemaVersion:1,package:{name:'@rpamis/comet',version:'0.4.5'},source:{commit,directory:'comet-'+commit,sha256:hash(archive),bytes:archive.length},toolchain:{node:process.versions.node,pnpm:'10.18.3'},patches:[]};
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
