import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createManagedSpecAdapter} from '/Volumes/mac-extend/codex/worktrees/comet-delivery-contracts/sdd-harness/lib/adapters/spec.js';
const root=fs.mkdtempSync('/private/tmp/p13-archive-spec-'),active=path.join(root,'openspec/changes/demo'),archive=path.join(root,'openspec/changes/archive/2026-10-26-demo');
const writeRun=(directory,runId='original')=>{fs.mkdirSync(path.join(directory,'.comet'),{recursive:true});fs.writeFileSync(path.join(directory,'.comet/run-state.json'),JSON.stringify({runId,status:'running'}));};
let calls=0;const seen=[];let mutation=()=>{};
const runtime={runClassicCli(){throw Error('No CLI is permitted in this probe');},async ensureClassicRuntimeRun(directory){calls++;seen.push(directory);const context={run:JSON.parse(fs.readFileSync(path.join(directory,'.comet/run-state.json'))),classic:{phase:'open'}};mutation(directory);return context;}};
const adapter=createManagedSpecAdapter({projectRoot:root,runtime}),request={change:'demo',expectedRunId:'original'};const passed=[];
try{
writeRun(active);const first=await adapter.readRunContext(request);assert.equal(first.changeDir,active);assert.equal(first.archived,false);assert.equal(first.assertCurrent().run.runId,'original');passed.push('active original');
fs.mkdirSync(path.dirname(archive),{recursive:true});fs.renameSync(active,archive);assert.throws(()=>first.assertCurrent(),e=>e.code==='RUN_LOCATION_CHANGED');passed.push('old closure refuses archive movement');
const current=await adapter.readRunContext(request);assert.equal(current.archived,true);assert.equal(current.changeDir,archive);assert.equal(current.classic.phase,'open');assert.equal(fs.existsSync(active),false);assert.deepEqual(seen,[active,archive]);passed.push('archive reader consumes original directory without replacement');
current.run.runId='mutated-view';request.expectedRunId='mutated-request';assert.equal(current.assertCurrent().run.runId,'original');request.expectedRunId='original';passed.push('view and request cannot redirect closure');
writeRun(archive,'foreign');assert.throws(()=>current.assertCurrent(),e=>e.code==='RUN_MISMATCH');writeRun(archive);passed.push('foreign on-disk run refused');
const outside=path.join(root,'ordinary-file');fs.writeFileSync(outside,'public fixture');fs.symlinkSync(outside,path.join(archive,'.comet-state.lock'));assert.throws(()=>current.assertCurrent(),e=>e.code==='PROJECT_PATH_UNSAFE');fs.unlinkSync(path.join(archive,'.comet-state.lock'));passed.push('linked lock refused');
const priorCalls=calls;writeRun(active);await assert.rejects(adapter.readRunContext(request),e=>e.code==='AMBIGUOUS_ARCHIVE');assert.equal(calls,priorCalls);fs.rmSync(active,{recursive:true});passed.push('active plus archive refused before Native reader');
mutation=directory=>{const preserved=directory+'-preserved';fs.renameSync(directory,preserved);fs.cpSync(preserved,directory,{recursive:true});fs.rmSync(preserved,{recursive:true});};await assert.rejects(adapter.readRunContext(request),e=>e.code==='RUN_LOCATION_CHANGED');passed.push('replacement inode during reader refused');
console.log(JSON.stringify({node:process.version,passed:passed.length,cases:passed,nativeReaderKind:'private injected CODE fixture',cliCalls:0,networkCalls:0},null,2));
}finally{fs.rmSync(root,{recursive:true,force:true});}
