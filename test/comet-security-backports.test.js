import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { verifyCometDistribution } from '../tools/comet/build.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
// A private pre-build RED seam only. Formal replay uses the complete pinned
// distribution and cannot qualify a product source through this override.
const privateSource = process.env.COMET_SECURITY_SOURCE;
const python = process.env.COMET_SECURITY_PYTHON ?? 'python3';
const lock = JSON.parse(await fs.readFile(process.env.COMET_SECURITY_LOCK ?? path.join(repository,'integrations/comet/upstream.lock.json'),'utf8'));
const fingerprint = sha(JSON.stringify({archive:lock.source.sha256,patches:lock.patches.map(({path,sha256})=>({path,sha256})),toolchain:lock.toolchain}));
const source = privateSource ? await fs.realpath(privateSource) : path.join(repository,'.sdd/vendor/comet',lock.source.commit,'builds',fingerprint,'work');
assert.equal(process.versions.node,'24.15.0','SETUP: use the exact pinned Node');
assert.equal(JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8')).version,'0.4.5');
const cleanEnvironment = () => {
  const env={PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH ?? ''),LANG:'en_US.UTF-8',TZ:'UTC',TMPDIR:os.tmpdir(),CI:'true',NPM_CONFIG_USERCONFIG:'/dev/null',NPM_CONFIG_GLOBALCONFIG:'/dev/null',PYTHONDONTWRITEBYTECODE:'1',PYTHON_DOTENV_DISABLED:'1',PYTEST_DISABLE_PLUGIN_AUTOLOAD:'1'};
  if(process.env.HOME!==undefined) env.HOME=process.env.HOME;
  return env;
};
if(!privateSource) test('security backports belong to the exact complete distribution',async()=>{
  const security=lock.patches.find(p=>p.path==='integrations/comet/patches/0004-upstream-security-backports.patch');
  assert.ok(security,'SETUP: security patch must be registered in the selected candidate lock');
  assert.equal(sha(await fs.readFile(path.join(repository,security.path))),security.sha256);
  assert.equal((await verifyCometDistribution({projectRoot:repository,lock})).status,'PASS');
});

test('Hook shell form preserves the literal project path and argv',async()=>{
  const {buildHookCommand}=await import(pathToFileURL(path.join(source,'dist/domains/skill/platform-install.js')).href);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'comet-security-argv-'));
  try {
    const literal=path.join(root,'project-$COMET_LITERAL_DATA');
    const expanded=path.join(root,'project-expanded');
    // Both are ordinary existing programs. The RED is wrong literal binding,
    // never a missing-file/dependency or an executable shell payload.
    for(const project of [literal,expanded]) {
      const file=path.join(project,'.agents/skills/comet/scripts/comet-hook-router.mjs');
      await fs.mkdir(path.dirname(file),{recursive:true});
      await fs.writeFile(file,'console.log(JSON.stringify(process.argv.slice(2)));\n');
    }
    const command=buildHookCommand(literal,'.agents','comet/scripts/comet-hook-router.mjs',{platformId:'codex',scope:'project'});
    const result=spawnSync('/bin/sh',['-c',command],{encoding:'utf8',timeout:10000,env:{...cleanEnvironment(),COMET_LITERAL_DATA:'expanded'}});
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(result.stdout),['--platform','codex','--project-root',literal]);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('Eval collector excludes an external ordinary file link',()=>{
  const code=`import sys,tempfile,pathlib,unittest\nsys.path.insert(0,sys.argv[1])\nfrom scaffold.python.generic_llm_judge import _collect_workspace_artifacts\nwith tempfile.TemporaryDirectory(prefix='comet-security-artifacts-') as scratch:\n root=pathlib.Path(scratch); workspace=root/'workspace';workspace.mkdir(); marker='outside ordinary fixture marker';outside=root/'outside.txt';outside.write_text(marker);(workspace/'linked.txt').symlink_to(outside);(workspace/'normal.txt').write_text('normal fixture')\n collected=_collect_workspace_artifacts(workspace)\n unittest.TestCase().assertIn('normal fixture',collected)\n unittest.TestCase().assertNotIn(marker,collected)\n`;
  const result=spawnSync(python,['-c',code,path.join(source,'eval')],{encoding:'utf8',timeout:15000,env:cleanEnvironment(),cwd:source});
  assert.equal(result.status,0,result.stdout+result.stderr);
});

test('Eval report persistence excludes an external ordinary file link',()=>{
  const code=`import sys,tempfile,pathlib,unittest\nsys.path.insert(0,sys.argv[1]);sys.path.insert(0,str(pathlib.Path(sys.argv[1])/'local/tests'))\nimport conftest\ndef no_container(*args,**kwargs):\n raise AssertionError('no external command permitted')\nconftest.run_python_in_docker=no_container\nwith tempfile.TemporaryDirectory(prefix='comet-security-save-') as scratch:\n root=pathlib.Path(scratch); workspace=root/'workspace';workspace.mkdir();outside=root/'outside.txt';outside.write_text('outside ordinary save marker');(workspace/'linked.txt').symlink_to(outside);(workspace/'normal.txt').write_text('normal fixture')\n conftest._save_artifacts(root/'evidence','TEXT_ONLY',1,workspace)\n saved=root/'evidence/artifacts/text_only_rep1/claude'\n unittest.TestCase().assertFalse((saved/'linked.txt').exists())\n unittest.TestCase().assertEqual((saved/'normal.txt').read_text(),'normal fixture')\n`;
  const result=spawnSync(python,['-c',code,path.join(source,'eval')],{encoding:'utf8',timeout:15000,env:cleanEnvironment(),cwd:source});
  assert.equal(result.status,0,result.stdout+result.stderr);
});

test('Hook update and uninstall preserve mixed user handlers and reject appended ownership',async()=>{
  const install=await import(pathToFileURL(path.join(source,'dist/domains/skill/platform-install.js')).href);
  const {removeCometHooksForPlatform}=await import(pathToFileURL(path.join(source,'dist/domains/skill/uninstall.js')).href);
  const {PLATFORMS}=await import(pathToFileURL(path.join(source,'dist/platform/install/platforms.js')).href);
  const {readNodeHookArguments}=await import(pathToFileURL(path.join(source,'dist/platform/process/hook-command.js')).href);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'comet-security-install-'));
  try {
    const configFile=path.join(root,'.codex/hooks.json');
    const script=path.join(root,'.agents/skills/comet/scripts/comet-hook-router.mjs');
    await fs.mkdir(path.dirname(script),{recursive:true});
    await fs.copyFile(path.join(source,'assets/skills/comet/scripts/comet-hook-router.mjs'),script);
    const user={type:'command',command:'echo user-owned',timeout:7};
    const other=[{matcher:'*',hooks:[{type:'command',command:'echo after-user'}]}];
    const initial={theme:'keep',hooks:{PreToolUse:[{matcher:'Write|Edit',note:'user metadata',hooks:[user]}],AfterTool:other}};
    await fs.mkdir(path.dirname(configFile),{recursive:true});await fs.writeFile(configFile,JSON.stringify(initial));
    const platform=PLATFORMS.find(p=>p.id==='codex');
    assert.equal((await install.installCometHooksForPlatform(root,platform,'project')).status,'installed');
    const first=JSON.parse(await fs.readFile(configFile,'utf8'));
    assert.equal(first.theme,'keep');assert.deepEqual(first.hooks.AfterTool,other);
    assert.deepEqual(first.hooks.PreToolUse[0],initial.hooks.PreToolUse[0]);
    const managed=first.hooks.PreToolUse.flatMap(group=>group.hooks).find(hook=>install.isManagedHookCommand(hook.command,['comet/scripts/comet-hook-router.mjs']));
    assert.ok(managed);assert.deepEqual(readNodeHookArguments(managed.command),[script,'--platform','codex','--project-root',root]);
    assert.equal((await install.installCometHooksForPlatform(root,platform,'project')).status,'installed');
    assert.deepEqual(JSON.parse(await fs.readFile(configFile,'utf8')),first);
    managed.command+='; echo user-owned';
    assert.equal(install.isManagedHookCommand(managed.command,['comet/scripts/comet-hook-router.mjs']),false);
    first.hooks.PreToolUse.push({matcher:'Other',hooks:[managed],note:'user-composite'});
    await fs.writeFile(configFile,JSON.stringify(first));
    await removeCometHooksForPlatform(root,platform,'project');
    const remaining=JSON.parse(await fs.readFile(configFile,'utf8'));
    assert.deepEqual(remaining.hooks.AfterTool,other);
    assert.ok(remaining.hooks.PreToolUse.some(group=>group.note==='user metadata' && JSON.stringify(group.hooks)===JSON.stringify([user])));
    assert.ok(remaining.hooks.PreToolUse.some(group=>group.note==='user-composite' && group.hooks[0].command===managed.command));
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('pinned Vite resolution is exactly 8.2.4 without a Comet upgrade',async()=>{
  const declared=JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8'));
  const installed=JSON.parse(await fs.readFile(path.join(source,'node_modules/vite/package.json'),'utf8'));
  assert.equal(declared.version,'0.4.5');assert.equal(declared.devDependencies.vite,'8.2.4');assert.equal(installed.version,'8.2.4');
});


test('Eval no-follow, report and unsupported-backend regression suite stays offline',()=>{
  const version=spawnSync(python,['-c','import sys;assert sys.version_info >= (3,12)'],{encoding:'utf8',env:cleanEnvironment(),timeout:10000});
  assert.equal(version.status,0,'SETUP: Python >=3.12 is required: '+version.stderr);
  const result=spawnSync(python,['-m','pytest','-q','local/tests/scaffold/test_workspace_artifacts.py','local/tests/scaffold/test_workspace_artifacts_windows.py','-p','no:cacheprovider'],{cwd:path.join(source,'eval'),encoding:'utf8',timeout:30000,env:cleanEnvironment()});
  assert.equal(result.status,0,result.stdout+result.stderr);
  // Native Windows cases remain separately visible as NOT-EXERCISED here;
  // a zero exit is only this platform's applicable suite, never a Windows claim.
  assert.match(result.stdout,/passed/);
  process.stdout.write(result.stdout);
});
