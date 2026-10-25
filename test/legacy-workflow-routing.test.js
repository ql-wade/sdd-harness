// Construction discovery/assembly only; no model turn or business gate acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function writeJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));}
function makeFixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'foundation-routing-'));
 for(const name of ['alpha','beta']){fs.mkdirSync(path.join(root,'.agents/skills',name),{recursive:true});fs.writeFileSync(path.join(root,'.agents/skills',name,'SKILL.md'),'# '+name+'\n');}
 fs.writeFileSync(path.join(root,'hooks.yaml'),'policies:\n  - id: dangerous-command-blocklist\n    hook: PreToolUse\n    matcher: Bash\n    action: deny\n    patterns:\n      - "denied-vector"\n    message: "blocked"\n');
 return root;
}
function runAdapter(root,args=[]){return spawnSync('bash',[path.join(projectRoot,'tools/adapters/claude-code.sh'),...args],{cwd:projectRoot,env:{...process.env,SDD_TARGET_ROOT:root},encoding:'utf8'});}

test('managed discovery links only selected methods and preserves unrelated source directories', () => {
  const root = makeFixture();
  try {
    const manifest = path.join(root, 'openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json');
    writeJson(manifest, { snapshots: [{name: 'alpha'}] });
    assert.equal(runAdapter(root).status, 0);
    assert.ok(fs.lstatSync(path.join(root, '.claude/skills/alpha')).isSymbolicLink());
    assert.equal(fs.existsSync(path.join(root, '.claude/skills/beta')), false, 'not every source directory is a selected method');
    assert.ok(fs.existsSync(path.join(root, '.agents/skills/beta/SKILL.md')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('managed discovery refuses old command migration inputs without deleting user data', () => {
  const root = makeFixture();
  try {
    const command = path.join(root, '.claude/commands/sdd-code.md');
    fs.mkdirSync(path.dirname(command), {recursive: true}); fs.writeFileSync(command, 'user retained old command\n');
    const result = runAdapter(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr,/retired command/);
    assert.equal(fs.readFileSync(command, 'utf8'), 'user retained old command\n');
    assert.equal(fs.existsSync(path.join(root, 'hooks/.compiled.env')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('managed discovery refuses selected-name user directories before any configuration write', () => {
  const root = makeFixture();
  try {
    const dir = path.join(root, '.claude/skills/alpha'); fs.mkdirSync(dir, {recursive:true});
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '# user owned\n');
    const blocked=runAdapter(root);assert.notEqual(blocked.status,0);assert.match(blocked.stderr,/unowned selected method/);
    assert.equal(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), '# user owned\n');
    assert.equal(fs.existsSync(path.join(root, 'hooks/.compiled.env')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('managed configuration refuses malformed settings before creating compiled policy', () => {
  const root = makeFixture();
  try {
    const file = path.join(root, '.claude/settings.json');fs.mkdirSync(path.dirname(file), {recursive:true});fs.writeFileSync(file, '{broken');
    const blocked=runAdapter(root);assert.notEqual(blocked.status,0);assert.match(blocked.stderr,/settings.json unreadable/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
    assert.equal(fs.existsSync(path.join(root, 'hooks/.compiled.env')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// P1_2 review rework: caller-owned fixture and external sentinel, no live config.
function routingTree(root, prefix = '') {
  const result = [];
  for (const entry of fs.readdirSync(root, {withFileTypes: true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    const rel=prefix ? prefix+'/'+entry.name : entry.name;const file=path.join(root,entry.name);
    if(entry.isSymbolicLink()) result.push([rel,'link',fs.readlinkSync(file)]);
    else if(entry.isDirectory()) {result.push([rel,'directory']);result.push(...routingTree(file,rel));}
    else if(entry.isFile()) result.push([rel,'file',crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
    else result.push([rel,'special']);
  }
  return result;
}

test('managed policy output refuses an external compiled symlink without changing either tree', (t) => {
  const root=makeFixture();const external=fs.mkdtempSync(path.join(os.tmpdir(),'foundation-sentinel-'));
  try {
    const sentinel=path.join(external,'user.env');fs.writeFileSync(sentinel,'USER_SENTINEL=preserve-original-bytes\n');
    fs.mkdirSync(path.join(root,'hooks'));fs.symlinkSync(sentinel,path.join(root,'hooks/.compiled.env'));
    const before=routingTree(root),outside=routingTree(external);
    const run=runAdapter(root);
    t.diagnostic(JSON.stringify({exit:run.status,stderr:run.stderr,before:outside,after:routingTree(external)}));
    assert.notEqual(run.status,0,'unsafe output must fail before compilation');
    assert.deepEqual(routingTree(external),outside,'external user bytes must not change');
    assert.deepEqual(routingTree(root),before,'refusal must not leave settings, links or temporary outputs');
  } finally {fs.rmSync(root,{recursive:true,force:true});fs.rmSync(external,{recursive:true,force:true});}
});


test('managed I/O preflights every output and ancestor for install and uninstall', (t) => {
  for (const args of [[],['--uninstall']]) for (const rel of ['.claude','.claude/skills','.claude/settings.json','hooks','hooks/.compiled.env']) {
    const root=makeFixture();const external=fs.mkdtempSync(path.join(os.tmpdir(),'foundation-io-outside-'));
    try {
      fs.writeFileSync(path.join(external,'sentinel'),'unchanged outside fixture\n');
      const file=path.join(root,rel);fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.symlinkSync(rel.endsWith('.json') || rel.endsWith('.env') ? path.join(external,'sentinel') : external,file);
      const before=routingTree(root),outside=routingTree(external);const run=runAdapter(root,args);
      assert.notEqual(run.status,0,JSON.stringify({rel,args,stdout:run.stdout,stderr:run.stderr}));
      assert.deepEqual(routingTree(root),before,rel+' refusal leaves target untouched');
      assert.deepEqual(routingTree(external),outside,rel+' refusal leaves external bytes untouched');
      t.diagnostic(JSON.stringify({rel,args,exit:run.status,target:before,external:outside}));
    } finally {fs.rmSync(root,{recursive:true,force:true});fs.rmSync(external,{recursive:true,force:true});}
  }
});

test('managed I/O preserves unowned policy, special outputs and hardlinked user files', () => {
  for(const args of [[],['--uninstall']]) for(const kind of ['user-policy','directory-policy','fifo-policy','file-ancestor','hardlink-settings','hardlink-policy']) {
    const root=makeFixture();const external=fs.mkdtempSync(path.join(os.tmpdir(),'foundation-user-outside-'));
    try {
      const sentinel=path.join(external,'sentinel');fs.writeFileSync(sentinel,'USER_ORIGINAL=keep\n');
      fs.mkdirSync(path.join(root,'hooks'),{recursive:true});fs.mkdirSync(path.join(root,'.claude'),{recursive:true});
      const policy=path.join(root,'hooks/.compiled.env');
      if(kind==='user-policy')fs.writeFileSync(policy,'USER_CONTENT=unowned\n');
      if(kind==='directory-policy')fs.mkdirSync(policy);
      if(kind==='fifo-policy')assert.equal(spawnSync('mkfifo',[policy]).status,0);
      if(kind==='file-ancestor'){fs.rmdirSync(path.join(root,'hooks'));fs.writeFileSync(path.join(root,'hooks'),'user ancestor file\n');}
      if(kind==='hardlink-settings')fs.linkSync(sentinel,path.join(root,'.claude/settings.json'));
      if(kind==='hardlink-policy')fs.linkSync(sentinel,policy);
      const before=routingTree(root),outside=routingTree(external);const run=runAdapter(root,args);
      assert.notEqual(run.status,0,JSON.stringify({kind,args,stderr:run.stderr}));
      assert.deepEqual(routingTree(root),before,kind);assert.deepEqual(routingTree(external),outside,kind);
    }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(external,{recursive:true,force:true});}
  }
});

test('managed replacement is atomic and repeat install/uninstall preserves user settings and quoted policy', () => {
  const root=makeFixture();
  try{
    fs.appendFileSync(path.join(root,'hooks.yaml'),'  - id: kb-write-protection\n    hook: PreToolUse\n    matcher: Write|Edit\n    action: deny\n    target:\n      - "llmwiki/wiki/"\n    message: "user\'s quoted policy"\n');
    writeJson(path.join(root,'.claude/settings.json'),{permissions:{allow:['Bash(echo keep)']},hooks:{Stop:[{hooks:[{type:'command',command:'echo keep-hook'}]}]}});
    const settingsMode=fs.statSync(path.join(root,'.claude/settings.json')).mode;
    assert.equal(runAdapter(root).status,0);
    assert.equal(fs.statSync(path.join(root,'.claude/settings.json')).mode,settingsMode,'existing user settings mode is preserved');
    const policy=path.join(root,'hooks/.compiled.env');const inode=fs.statSync(policy).ino;
    fs.appendFileSync(path.join(root,'hooks.yaml'),'# changed policy source\n');
    let yaml=fs.readFileSync(path.join(root,'hooks.yaml'),'utf8');fs.writeFileSync(path.join(root,'hooks.yaml'),yaml.replace('denied-vector','changed-vector'));
    const updated=runAdapter(root);assert.equal(updated.status,0,updated.stderr);
    assert.notEqual(fs.statSync(policy).ino,inode,'policy replacement creates a staged inode, not truncate-in-place');
    const parsed=spawnSync('bash',['-c','source "$1"; printf "%s" "$DENY_KB_MESSAGE"','policy',policy],{encoding:'utf8'});
    assert.equal(parsed.status,0,parsed.stderr);assert.equal(parsed.stdout,"user's quoted policy");
    assert.equal(runAdapter(root).status,0,'generated quoted data remains owned');
    assert.equal(runAdapter(root,['--uninstall']).status,0);
    const user=JSON.parse(fs.readFileSync(path.join(root,'.claude/settings.json')));
    assert.deepEqual(user.permissions,{allow:['Bash(echo keep)']});assert.match(JSON.stringify(user.hooks),/keep-hook/);
    assert.equal(fs.existsSync(policy),false);assert.equal(runAdapter(root,['--uninstall']).status,0);
    assert.equal(routingTree(root).filter(([name])=>name.includes('.sdd-')).length,0,'no staging debris');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
