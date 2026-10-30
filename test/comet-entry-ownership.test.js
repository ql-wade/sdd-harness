import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classicCompositionStartRequest } from '../lib/adapters/comet.js';
import { resolveCometForTest } from './helpers/comet-cli.js';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const comet=resolveCometForTest();

test('real Comet keeps native and application Run ownership distinct and the phase entry uses the application Run', {timeout:120000}, (t)=>{
  const scratch=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'sdd-entry-ownership-'));
  t.after(()=>fs.rmSync(scratch,{recursive:true,force:true}));
  const root=path.join(scratch,'project'), home=path.join(scratch,'home');fs.mkdirSync(root);fs.mkdirSync(home);
  const env={...process.env,HOME:home,USERPROFILE:home,XDG_CONFIG_HOME:path.join(home,'config'),PATH:`${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`,CI:'true',DO_NOT_TRACK:'1'};
  delete env.NODE_OPTIONS;delete env.NODE_PATH;delete env.NODE_TEST_CONTEXT;
  const invoke=(program,args)=>{
    const p=spawnSync(program,args,{cwd:root,env,encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});
    let value;try{value=JSON.parse(p.stdout)}catch{value=null}
    return {status:p.status,value,stderr:p.stderr,stdout:p.stdout,error:p.error};
  };
  const git=(...args)=>{const p=invoke('git',args);assert.equal(p.status,0,p.stderr);};
  assert.equal(invoke(comet,['--version']).stdout.trim(),'0.5.1');
  git('init','-q');fs.writeFileSync(path.join(root,'.gitignore'),'home/\n');git('add','.gitignore');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');
  fs.mkdirSync(path.join(root,'.comet'));fs.writeFileSync(path.join(root,'.comet/config.yaml'),'schema: comet.project.v1\ndefault_workflow: classic\nworkflows:\n  - classic\nclassic:\n  artifact_layout: legacy\n  language: zh-CN\n');
  const changeDir=(name)=>{const dir=path.join(root,'openspec/changes',name);fs.mkdirSync(dir,{recursive:true});for(const file of ['proposal.md','design.md','tasks.md'])fs.writeFileSync(path.join(dir,file),`# ${file}\n\nSynthetic fixture.\n`);};
  const appFile=path.join(repo,'integrations/comet/application/package/application.json');
  const preview=invoke(comet,['application','install',appFile,'--project',root,'--preview','--json']);assert.equal(preview.status,0,preview.stderr);
  const install=invoke(comet,['application','install',appFile,'--project',root,'--confirmation-hash',preview.value.confirmationHash,'--json']);assert.equal(install.status,0,install.stderr);
  changeDir('phase-start-probe');
  const selected=path.join(root,'.comet/current-change.json');const originalSelection=JSON.stringify({schema:'comet.selection.v2',workflow:'application',applicationId:'sdd-managed-delivery',change:'existing-run',branch:null});fs.writeFileSync(selected,originalSelection);
  const blockedStart=invoke(process.execPath,[path.join(repo,'tools/comet/phase-entry.mjs'),'/comet-open','--run-id','phase-start-probe','--project-root',root,'--start']);
  assert.equal(blockedStart.status,2);assert.equal(JSON.parse(blockedStart.stderr).code,'CURRENT_SELECTION_EXISTS');assert.equal(fs.readFileSync(selected,'utf8'),originalSelection);
  fs.unlinkSync(selected);
  const phaseStart=invoke(process.execPath,[path.join(repo,'tools/comet/phase-entry.mjs'),'/comet-open','--run-id','phase-start-probe','--project-root',root,'--start']);
  assert.equal(phaseStart.status,0,phaseStart.stderr||phaseStart.stdout);assert.equal(phaseStart.value.runId,'phase-start-probe');assert.equal(phaseStart.value.phase,'open');
  const selectedRun=JSON.parse(fs.readFileSync(selected,'utf8'));assert.equal(selectedRun.workflow,'application');assert.equal(selectedRun.applicationId,'sdd-managed-delivery');assert.equal(selectedRun.change,'phase-start-probe');
  fs.unlinkSync(selected);changeDir('unselected-second');
  const unselected=invoke(process.execPath,[path.join(repo,'tools/comet/phase-entry.mjs'),'/comet-open','--run-id','unselected-second','--project-root',root,'--start']);
  assert.equal(unselected.status,2);assert.equal(JSON.parse(unselected.stderr).code,'UNSELECTED_RUN_EXISTS');
  fs.writeFileSync(selected,JSON.stringify(selectedRun));
  const languageRequest=path.join(root,'language-request.json');fs.writeFileSync(languageRequest,JSON.stringify({operation:'query',runId:'phase-start-probe',view:'current'}));
  const language=invoke(comet,['runtime','dispatch','--application','sdd-managed-delivery','--project-root',root,'--request',languageRequest,'--json']);
  assert.equal(language.status,0,language.stderr);assert.equal(language.value.data.state.language,'zh-CN','new Run follows project language');
  const phaseOwner=invoke(comet,['state','next','phase-start-probe','--json']);assert.notEqual(phaseOwner.status,0);
  assert.match(phaseOwner.value?.data?.issues?.[0]?.message ?? phaseOwner.value?.stderr ?? phaseOwner.stderr,/belongs to application sdd-managed-delivery/);
  changeDir('native-probe');const native=invoke(comet,['state','init','native-probe','full','--isolation','current','--json']);assert.equal(native.status,0,native.stderr);
  const requestFile=path.join(root,'request.json');
  const dispatch=(operation,runId)=>{fs.writeFileSync(requestFile,JSON.stringify({operation,runId}));return invoke(comet,['runtime','dispatch','--application','sdd-managed-delivery','--project-root',root,'--request',requestFile,'--json']);};
  const wrongOwner=dispatch('next','native-probe');assert.notEqual(wrongOwner.status,0);
  assert.ok(['RUN_NOT_FOUND','RUNTIME_ERROR'].includes(wrongOwner.value?.error?.code),JSON.stringify(wrongOwner.value));
  if(wrongOwner.value.error.code==='RUNTIME_ERROR')assert.match(wrongOwner.value.error.message,/original fixed Application package/);
  const nativeAfter=invoke(comet,['state','next','native-probe','--json']);assert.equal(nativeAfter.status,0,nativeAfter.stderr);assert.equal(nativeAfter.value.data.phase,'open');
  const name='composition-probe';changeDir(name);
  const start=classicCompositionStartRequest({change:name,changeDir:`openspec/changes/${name}`,workflowId:'comet-classic-full',workflowVersion:'1'});
  const input=path.join(root,'input.json'),state=path.join(root,'state.json');fs.writeFileSync(input,JSON.stringify(start.input));fs.writeFileSync(state,JSON.stringify(start.initialState));
  const runner=path.join(path.dirname(install.value.file),'scripts/comet-run.mjs');
  const created=invoke(process.execPath,[runner,'start','--project-root',root,'--run-id',name,'--workflow-id','comet-classic-full','--input-file',input,'--initial-state-file',state]);assert.equal(created.status,0,created.stderr||created.stdout);
  const builtin=invoke(comet,['state','next',name,'--json']);assert.notEqual(builtin.status,0);
  assert.match(builtin.value?.data?.issues?.[0]?.message ?? builtin.value?.stderr ?? builtin.stderr,/belongs to application sdd-managed-delivery/);
  const phase=(entry,extra=[])=>invoke(process.execPath,[path.join(repo,'tools/comet/phase-entry.mjs'),entry,'--run-id',name,'--project-root',root,...extra]);
  const wrongInitial=phase('/comet-design',['--continue']);assert.equal(wrongInitial.status,2);assert.equal(JSON.parse(wrongInitial.stderr).code,'PHASE_MISMATCH');
  const automatic=phase('/comet-open',['--continue']);assert.equal(automatic.status,0,automatic.stderr);assert.equal(automatic.value.runId,name);assert.equal(automatic.value.phase,'open');
  let open=phase('/comet-open');
  for(let n=0;open.status!==0 && n<3;n++){
    assert.match(open.stderr,/requires recovery/);
    const recovered=dispatch('next',name);assert.equal(recovered.status,0,recovered.stderr||recovered.stdout);
    open=phase('/comet-open');
  }
  assert.equal(open.status,0,open.stderr);assert.equal(open.value.runId,name);assert.equal(open.value.phase,'open');assert.equal(open.value.application.id,'sdd-managed-delivery');
  const wrong=phase('/comet-design',['--continue']);assert.equal(wrong.status,2);assert.equal(JSON.parse(wrong.stderr).code,'PHASE_MISMATCH');
  const after=phase('/comet-open');assert.equal(after.status,0,after.stderr);assert.equal(after.value.revision,open.value.revision,'wrong phase did not advance the original Run');
  t.diagnostic(JSON.stringify({scope:'isolated-no-model',runtime:'0.5.1',nativeRun:'native-probe',applicationRun:name,applicationVersion:install.value.version,phase:after.value.phase,revision:after.value.revision,wrongPhase:'PHASE_MISMATCH'}));
});
