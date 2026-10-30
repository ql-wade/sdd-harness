import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolveCometForTest} from './helpers/comet-cli.js';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('a killed lock supervisor cannot release exclusion while its child still works',{timeout:30000},async(t)=>{
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'sdd-os-lock-'));const children=[];
  t.after(async()=>{for(const c of children)if(c.exitCode===null && c.signalCode===null){const done=new Promise(r=>c.once('close',r));c.kill('SIGKILL');await done;}fs.rmSync(root,{recursive:true,force:true});});
  const lock=path.join(root,'start.lock'),log=path.join(root,'events'),ready=path.join(root,'ready');
  const worker=`const fs=require('fs');const [log,ready,id]=process.argv.slice(1);if(id==='1')fs.writeFileSync(ready,'ready');fs.appendFileSync(log,'ENTER '+id+'\\n');setTimeout(()=>fs.appendFileSync(log,'EXIT '+id+'\\n'),1200);`;
  const launch=(id)=>{const c=spawn('python3',[path.join(repo,'tools/comet/start-lock.py'),lock,process.execPath,'-e',worker,log,ready,id],{stdio:'ignore'});children.push(c);return c;};
  const a=launch('1');for(let n=0;n<100&&!fs.existsSync(ready);n++)await new Promise(r=>setTimeout(r,50));assert.ok(fs.existsSync(ready),'first child must hold the lock');
  const ended=new Promise(r=>a.once('close',r));a.kill('SIGKILL');await ended;
  const b=launch('2');const exit=await new Promise(r=>b.once('close',r));assert.equal(exit,0);
  assert.deepEqual(fs.readFileSync(log,'utf8').trim().split('\n'),['ENTER 1','EXIT 1','ENTER 2','EXIT 2']);
});
test('concurrent Open starts cannot replace another selected application Run', {timeout:120000}, async(t)=>{
  const scratch=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'sdd-entry-race-'));let holder;const children=[];
  t.after(async()=>{for(const child of [holder,...children])if(child && child.exitCode===null && child.signalCode===null){const stopped=new Promise((resolve)=>child.once('close',resolve));child.kill('SIGKILL');await stopped;}fs.rmSync(scratch,{recursive:true,force:true});});
  const root=path.join(scratch,'project'),home=path.join(scratch,'home');fs.mkdirSync(root);fs.mkdirSync(home);
  const env={...process.env,HOME:home,USERPROFILE:home,XDG_CONFIG_HOME:path.join(home,'config'),PATH:`${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`,CI:'true',DO_NOT_TRACK:'1'};
  delete env.NODE_OPTIONS;delete env.NODE_PATH;delete env.NODE_TEST_CONTEXT;
  const comet=resolveCometForTest();
  const run=(cmd,args)=>{const p=spawnSync(cmd,args,{cwd:root,env,encoding:'utf8',timeout:30000});assert.equal(p.status,0,p.stderr||p.stdout);try{return JSON.parse(p.stdout)}catch{return null}};
  assert.equal(spawnSync(comet,['--version'],{cwd:root,env,encoding:'utf8'}).stdout.trim(),'0.5.1');
  run('git',['init','-q']);fs.writeFileSync(path.join(root,'.gitignore'),'home/\n');run('git',['add','.gitignore']);run('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture']);
  fs.mkdirSync(path.join(root,'.comet'));fs.writeFileSync(path.join(root,'.comet/config.yaml'),'schema: comet.project.v1\ndefault_workflow: classic\nworkflows:\n  - classic\nclassic:\n  artifact_layout: legacy\n  language: zh-CN\n');
  for(const name of ['race-a','race-b']){const dir=path.join(root,'openspec/changes',name);fs.mkdirSync(dir,{recursive:true});for(const file of ['proposal.md','design.md','tasks.md'])fs.writeFileSync(path.join(dir,file),'# Synthetic fixture\n');}
  const app=path.join(repo,'integrations/comet/application/package/application.json');
  const preview=run(comet,['application','install',app,'--project',root,'--preview','--json']);run(comet,['application','install',app,'--project',root,'--confirmation-hash',preview.confirmationHash,'--json']);
  holder=spawn('python3',['-c','import fcntl,os,sys,time; fd=os.open(sys.argv[1],os.O_CREAT|os.O_RDWR,0o600); fcntl.flock(fd,fcntl.LOCK_EX); print("READY",flush=True); time.sleep(600)',path.join(root,'.comet/sdd-start.flock')],{cwd:root,env});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('lock holder did not start')),15000);holder.stdout.once('data',()=>{clearTimeout(timer);resolve();});holder.once('error',(error)=>{clearTimeout(timer);reject(error);});});
  const stopped=new Promise((resolve)=>holder.once('close',resolve));holder.kill('SIGKILL');await stopped;
  const start=(name)=>new Promise((resolve,reject)=>{const c=spawn(process.execPath,[path.join(repo,'tools/comet/phase-entry.mjs'),'/comet-open','--run-id',name,'--project-root',root,'--start'],{cwd:root,env});children.push(c);let out='',err='';c.stdout.on('data',(x)=>out+=x);c.stderr.on('data',(x)=>err+=x);c.on('error',reject);c.on('close',(code)=>resolve({name,code,out,err}));});
  const results=await Promise.all([start('race-a'),start('race-b')]);
  const success=results.filter((x)=>x.code===0),refused=results.filter((x)=>x.code!==0);
  assert.equal(success.length,1,JSON.stringify(results));assert.equal(refused.length,1);
  assert.equal(JSON.parse(refused[0].err).code,'CURRENT_SELECTION_EXISTS');
  const selection=JSON.parse(fs.readFileSync(path.join(root,'.comet/current-change.json'),'utf8'));
  assert.equal(selection.change,success[0].name);assert.equal(selection.applicationId,'sdd-managed-delivery');
  t.diagnostic(JSON.stringify({scope:'isolated-no-model',recoveredAfter:'SIGKILL',accepted:success[0].name,refused:refused[0].name}));
});

test('direct internal starts with unlocked descriptors cannot bypass exclusion',{timeout:120000},async(t)=>{
  const scratch=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'sdd-entry-direct-'));const children=[];
  t.after(async()=>{for(const c of children)if(c.exitCode===null && c.signalCode===null){const done=new Promise(r=>c.once('close',r));c.kill('SIGKILL');await done;}fs.rmSync(scratch,{recursive:true,force:true});});
  const root=path.join(scratch,'project'),home=path.join(scratch,'home');fs.mkdirSync(root);fs.mkdirSync(home);
  const env={...process.env,HOME:home,USERPROFILE:home,XDG_CONFIG_HOME:path.join(home,'config'),PATH:`${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`,CI:'true',DO_NOT_TRACK:'1'};delete env.NODE_OPTIONS;delete env.NODE_PATH;delete env.NODE_TEST_CONTEXT;
  const comet=resolveCometForTest();
  const run=(cmd,args)=>{const p=spawnSync(cmd,args,{cwd:root,env,encoding:'utf8',timeout:30000});assert.equal(p.status,0,p.stderr||p.stdout);try{return JSON.parse(p.stdout)}catch{return null}};
  run('git',['init','-q']);fs.writeFileSync(path.join(root,'.gitignore'),'home/\n');run('git',['add','.gitignore']);run('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture']);
  fs.mkdirSync(path.join(root,'.comet'));fs.writeFileSync(path.join(root,'.comet/config.yaml'),'schema: comet.project.v1\ndefault_workflow: classic\nworkflows:\n  - classic\nclassic:\n  artifact_layout: legacy\n  language: zh-CN\n');
  for(const name of ['race-a','race-b']){const dir=path.join(root,'openspec/changes',name);fs.mkdirSync(dir,{recursive:true});for(const file of ['proposal.md','design.md','tasks.md'])fs.writeFileSync(path.join(dir,file),'# Synthetic fixture\n');}
  const app=path.join(repo,'integrations/comet/application/package/application.json');const preview=run(comet,['application','install',app,'--project',root,'--preview','--json']);run(comet,['application','install',app,'--project',root,'--confirmation-hash',preview.confirmationHash,'--json']);
  const start=(name)=>new Promise((resolve,reject)=>{const fd=fs.openSync(path.join(root,'.comet/sdd-start.flock'),'a+');const c=spawn(process.execPath,[path.join(repo,'tools/comet/phase-entry.mjs'),'/comet-open','--run-id',name,'--project-root',root,'--start','--locked-start'],{cwd:root,env:{...env,SDD_START_LOCK_FD:'3'},stdio:['ignore','pipe','pipe',fd]});fs.closeSync(fd);children.push(c);let out='',err='';c.stdout.on('data',(x)=>out+=x);c.stderr.on('data',(x)=>err+=x);c.on('error',reject);c.on('close',(code)=>resolve({name,code,out,err}));});
  const results=await Promise.all([start('race-a'),start('race-b')]);const success=results.filter(x=>x.code===0),refused=results.filter(x=>x.code!==0);
  assert.equal(success.length,1,JSON.stringify(results));assert.equal(refused.length,1);assert.ok(['START_LOCK_UNAVAILABLE','CURRENT_SELECTION_EXISTS'].includes(JSON.parse(refused[0].err).code));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'.comet/current-change.json'),'utf8')).change,success[0].name);
});
