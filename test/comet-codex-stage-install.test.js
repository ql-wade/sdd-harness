import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const installer=path.join(root,'integrations/comet/application/phase-entries/install.py');
const names=['comet','comet-open','comet-design','comet-build','comet-verify','comet-archive'];
function fixture(t){
 const base=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'comet-stage-install-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const project=path.join(base,'project'),config=path.join(base,'home/.codex/config.toml');fs.mkdirSync(path.dirname(config),{recursive:true});fs.writeFileSync(config,'model = "fixture"\n');
 for(const name of names){const d=path.join(project,'.agents/skills',name);fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'SKILL.md'),`---\nname: ${name}\ndescription: original fixture\n---\n`);}
 const run=(args)=>{const p=spawnSync('python3',[installer,'--project',project,'--codex-config',config,...args],{encoding:'utf8',timeout:20000});let body;try{body=JSON.parse(p.stdout);}catch{body=null;}return {p,body};};
 return {project,config,run};
}

test('stage routing preview is read-only and apply preserves originals and unrelated config',t=>{
 const f=fixture(t),before=fs.readFileSync(f.config,'utf8'),preview=f.run(['--preview']);
 assert.equal(preview.p.status,0,preview.p.stderr);assert.equal(preview.body.entries.length,6);assert.equal(fs.readFileSync(f.config,'utf8'),before);
 const applied=f.run(['--apply',preview.body.confirmationHash]);assert.equal(applied.p.status,0,applied.p.stderr);assert.equal(applied.body.applied,true);
 const after=fs.readFileSync(f.config,'utf8');assert.ok(after.startsWith(before));
 for(const name of names){assert.match(fs.readFileSync(path.join(f.project,'.agents/skills',name,'SKILL.md'),'utf8'),/original fixture/);assert.match(fs.readFileSync(path.join(f.project,'.codex/skills',`${name}-managed`,'SKILL.md'),'utf8'),new RegExp(`name: ${name}(?:\\n|\\r)`));assert.ok(after.includes(path.join(f.project,'.agents/skills',name,'SKILL.md')));}
 const again=f.run(['--preview']);assert.equal(again.p.status,0,again.p.stderr);assert.equal(again.body.changesNeeded,false);
 const againApplied=f.run(['--apply',again.body.confirmationHash]);assert.equal(againApplied.p.status,0,againApplied.p.stderr);assert.equal(fs.readFileSync(f.config,'utf8'),after);
});

test('stale preview and existing foreign target fail without overwriting anything',t=>{
 const f=fixture(t),preview=f.run(['--preview']);assert.equal(preview.p.status,0,preview.p.stderr);
 fs.appendFileSync(f.config,'# another setting\n');const before=fs.readFileSync(f.config,'utf8');
 assert.notEqual(f.run(['--apply',preview.body.confirmationHash]).p.status,0);assert.equal(fs.readFileSync(f.config,'utf8'),before);
 for(const name of names)assert.equal(fs.existsSync(path.join(f.project,'.codex/skills',`${name}-managed`)),false);
 const target=path.join(f.project,'.codex/skills/comet-open-managed');fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'SKILL.md'),'foreign');
 assert.notEqual(f.run(['--preview']).p.status,0);assert.equal(fs.readFileSync(path.join(target,'SKILL.md'),'utf8'),'foreign');
});

test('malformed configuration and conflicting enablement are rejected before writes',t=>{
 const f=fixture(t);fs.writeFileSync(f.config,'[bad\n');assert.notEqual(f.run(['--preview']).p.status,0);
 const original=path.join(f.project,'.agents/skills/comet-open/SKILL.md');fs.writeFileSync(f.config,`[[skills.config]]\npath = ${JSON.stringify(original)}\nenabled = true\n`);
 assert.notEqual(f.run(['--preview']).p.status,0);assert.equal(fs.existsSync(path.join(f.project,'.codex/skills/comet-open-managed')),false);
});

test('an existing legacy managed entry blocks installation rather than exposing duplicate stages',t=>{
 const f=fixture(t),legacy=path.join(f.project,'.agents/skills/comet-managed');
 fs.mkdirSync(legacy);fs.writeFileSync(path.join(legacy,'SKILL.md'),'preserve existing entry');
 const result=f.run(['--preview']);assert.notEqual(result.p.status,0);
 assert.match(result.p.stderr,/legacy stage entry requires safe migration/);
 assert.equal(fs.readFileSync(path.join(legacy,'SKILL.md'),'utf8'),'preserve existing entry');
 assert.equal(fs.existsSync(path.join(f.project,'.codex/skills/comet-managed')),false);
});

test('a partially created stage set is rolled back when an installation write fails',t=>{
 const f=fixture(t),preview=f.run(['--preview']);assert.equal(preview.p.status,0,preview.p.stderr);const before=fs.readFileSync(f.config,'utf8');
 const script=`import importlib.util,pathlib,sys\ns=importlib.util.spec_from_file_location('stage_install',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\noriginal=m.os.open\ndef failing(path,*args,**kwargs):\n if str(path).endswith('comet-design-managed/SKILL.md'): raise OSError('synthetic write failure')\n return original(path,*args,**kwargs)\nm.os.open=failing\ntry: m.apply(pathlib.Path(sys.argv[2]),pathlib.Path(sys.argv[3]),sys.argv[4])\nexcept OSError: sys.exit(0)\nsys.exit(1)`;
 const run=spawnSync('python3',['-c',script,installer,f.project,f.config,preview.body.confirmationHash],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
 assert.equal(fs.readFileSync(f.config,'utf8'),before);
 for(const name of names)assert.equal(fs.existsSync(path.join(f.project,'.codex/skills',`${name}-managed`)),false);
});

test('stage routing refuses symlinked sources, targets and ambiguous config aliases',t=>{
 const f=fixture(t),original=path.join(f.project,'.agents/skills/comet-open/SKILL.md');
 const alias=path.join(f.project,'alias-skill');fs.symlinkSync(original,alias);fs.writeFileSync(f.config,`[[skills.config]]\npath = ${JSON.stringify(alias)}\nenabled = false\n`);
 assert.notEqual(f.run(['--preview']).p.status,0);
 fs.writeFileSync(f.config,'model = "fixture"\n');fs.mkdirSync(path.join(f.project,'.codex/skills'),{recursive:true});fs.symlinkSync(path.dirname(original),path.join(f.project,'.codex/skills/comet-open-managed'));
 assert.notEqual(f.run(['--preview']).p.status,0);
});
