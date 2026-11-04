#!/usr/bin/env node
// Stateless presentation adapter; Comet owns all phase transitions and gates.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classicCompositionStartRequest } from '../../lib/adapters/comet-start.js';
import { buildCodexOpenConfirmation, locateCodexHumanChoice, readCodexHumanChoice, deriveCodexOpenDecision } from '../../lib/adapters/codex-host-source.js';

const stages = new Map([
  ['/comet', null], ['/comet-open', 'open'], ['/comet-design', 'design'],
  ['/comet-build', 'build'], ['/comet-verify', 'verify'], ['/comet-archive', 'archive'],
]);
const fail = (code, detail, current) => { const error = new Error(detail); error.code = code; error.current = current; throw error; };

function selectedCometRoot() {
  const location=spawnSync('which',['comet'],{encoding:'utf8',timeout:10000});
  if(location.status!==0 || !location.stdout.trim()) fail('COMET_CONFIG_UNAVAILABLE','Cannot locate the selected Comet installation.');
  try {
    const cli=fs.realpathSync(location.stdout.trim());const packageRoot=path.dirname(path.dirname(cli));
    const metadata=JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'),'utf8'));
    if(metadata.name!=='@rpamis/comet' || metadata.version!=='0.5.1') throw new Error('wrong Comet package');
    return packageRoot;
  } catch { fail('COMET_CONFIG_UNAVAILABLE','Cannot verify the selected Comet 0.5.1 installation.'); }
}

async function projectLanguage(projectRoot, packageRoot) {
  try {
    const reader=await import(pathToFileURL(path.join(packageRoot,'dist/domains/workflow-contract/project-config-reader.js')).href);
    const config=await reader.readWorkflowProjectConfig(projectRoot);
    if(!config || !['en','zh-CN'].includes(config.classic?.language)) throw new Error('missing Classic language');
    return config.classic.language;
  } catch { fail('COMET_CONFIG_UNAVAILABLE','Cannot read a valid Classic language from the selected Comet project configuration.'); }
}

function assertNoCurrentSelection(projectRoot) {
  try { fs.lstatSync(path.join(projectRoot,'.comet/current-change.json')); }
  catch (error) {
    if (error.code==='ENOENT') return;
    fail('CURRENT_SELECTION_UNAVAILABLE','Cannot verify the current Comet selection.');
  }
  fail('CURRENT_SELECTION_EXISTS','A Comet Run is already selected; inspect or resume it before creating another.');
}

function assertInheritedLock(lockFile) {
  const fd=Number(process.env.SDD_START_LOCK_FD);let held;
  try {const opened=fs.fstatSync(fd),named=fs.lstatSync(lockFile);held=Number.isSafeInteger(fd)&&fd>=3&&fd<=64&&opened.isFile()&&named.isFile()&&opened.dev===named.dev&&opened.ino===named.ino;}
  catch {held=false;}
  if(!held)fail('START_LOCK_UNAVAILABLE','The start lock was not inherited from its supervisor.');
  const stdio=['ignore','ignore','ignore'];while(stdio.length<=fd)stdio.push('ignore');stdio[fd]=fd;
  const claim=spawnSync('python3',[path.join(path.dirname(fileURLToPath(import.meta.url)),'start-lock.py'),'--claim-fd',String(fd)],{stdio,timeout:5000});
  if(claim.error || claim.status!==0)fail('START_LOCK_UNAVAILABLE','The operating-system start lock is already held or unavailable.');
}

function selectionMatches(projectRoot,runId) {
  const directory=path.join(projectRoot,'.comet');const file=path.join(directory,'current-change.json');let selection;
  if(typeof fs.constants.O_NOFOLLOW!=='number')fail('CURRENT_SELECTION_UNAVAILABLE','Safe selection read is unavailable.');
  try{const info=fs.lstatSync(directory);if(!info.isDirectory()||info.isSymbolicLink())fail('CURRENT_SELECTION_UNAVAILABLE','Comet configuration directory is not safe.');}
  catch(error){if(error.code==='ENOENT')return false;if(error.code==='CURRENT_SELECTION_UNAVAILABLE')throw error;fail('CURRENT_SELECTION_UNAVAILABLE','Cannot inspect the Comet configuration directory.');}
  try { selection=JSON.parse(fs.readFileSync(file,{encoding:'utf8',flag:fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW})); }
  catch(error) { if(error.code==='ENOENT')return false;fail('CURRENT_SELECTION_UNAVAILABLE','Cannot read the current Comet selection.'); }
  if(selection?.workflow!=='application' || selection.applicationId!=='sdd-managed-delivery' || selection.change!==runId)
    fail('CURRENT_SELECTION_EXISTS','Another Comet Run is selected; inspect it before continuing.');
  return true;
}

function restoreSelection(projectRoot,runId,entry) {
  const root=fs.realpathSync(projectRoot),dir=path.join(root,'.comet'),stat=fs.lstatSync(dir);
  if(!stat.isDirectory() || stat.isSymbolicLink())fail('START_LOCK_UNAVAILABLE','Comet project directory must be a real directory.');
  try {fs.lstatSync(path.join(dir,'sdd-application-start.lock'));fail('START_LOCK_RECOVERY_REQUIRED','An older start lock exists; reconcile its original process before continuing.');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const args=[fileURLToPath(import.meta.url),entry,'--run-id',runId,'--project-root',projectRoot,'--continue','--locked-resume'];
  const result=spawnSync('python3',[path.join(path.dirname(fileURLToPath(import.meta.url)),'start-lock.py'),path.join(dir,'sdd-start.flock'),process.execPath,...args],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});
  if(result.error || result.status===null)fail('RESUME_OUTCOME_UNKNOWN','Comet resume outcome is unknown; inspect the original Run before retry.');
  if(result.status!==0){let error;try{error=JSON.parse(result.stderr);}catch{fail('RESUME_OUTCOME_UNKNOWN','Comet resume outcome is unknown; inspect the original Run before retry.');}const e=new Error(error.message);e.code=error.code;e.current=error.current;throw e;}
  let response;try{response=JSON.parse(result.stdout);}catch{fail('RESUME_OUTCOME_UNKNOWN','Comet resume readback failed; inspect the original Run before retry.');}
  if(response.runId!==runId || response.continuation!=='selection-restored')fail('RESUME_OUTCOME_UNKNOWN','Comet resume returned an unexpected Run.');
  return response;
}

function runtime(projectRoot, request) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-phase-request-'));
  try {
    const file = path.join(dir, 'request.json');
    fs.writeFileSync(file, JSON.stringify(request), { mode: 0o600 });
    const result = spawnSync('comet', ['runtime', 'dispatch', '--application', 'sdd-managed-delivery',
      '--project-root', projectRoot, '--request', file, '--json'], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    if (result.error) fail('RUNTIME_UNAVAILABLE', 'Comet runtime could not be invoked.');
    if (result.status === 2 && result.stdout.trim() === '' && result.stderr.trim() === 'Comet workflow commands are blocked until the managed gates are qualified.') {
      fail('LOCAL_DIAGNOSTIC_WRAPPER_BLOCKED', 'The project diagnostic wrapper blocked this command. After managed gates are qualified, configure PATH to put the external Comet 0.5.1 directory first.');
    }
    let packet;
    try { packet = JSON.parse(result.stdout); } catch { fail('RUNTIME_RESPONSE_INVALID', 'Comet returned an invalid response.'); }
    if (result.status !== 0 || packet.status !== 'succeeded') {
      const error = new Error(packet.error?.message ?? 'Comet refused the request; inspect the original Run before retrying.');
      error.code = 'RUNTIME_BLOCKED';
      error.runtimeCode = packet.error?.code;
      throw error;
    }
    if ((request.operation !== 'query' && packet.application?.id !== 'sdd-managed-delivery')
      || (request.operation === 'query' && packet.application !== undefined && packet.application?.id !== 'sdd-managed-delivery') || packet.data?.runId !== request.runId
      || packet.data?.workflow?.id !== 'comet-classic-full') fail('RUN_IDENTITY_MISMATCH', 'The response does not identify the requested composition Run.');
    return packet;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function view(packet) {
  const run = packet.data;
  const phases = ['open', 'design', 'build', 'verify', 'archive'];
  if (!phases.includes(run?.state?.phase) || !Number.isSafeInteger(run.revision) || run.revision < 0
    || !run.current || !Array.isArray(run.current.actions) || !Array.isArray(run.current.waits) || !Array.isArray(run.current.evidenceWaits)) {
    fail('RUN_STATE_INVALID', 'Comet did not return a current phase, revision and action/wait list.');
  }
  const actions = run.current.actions.map(a => ({ id:a.id, stepId:a.stepId, type:a.type, ref:a.ref, status:a.status }));
  const waits = run.current.waits.map(w => ({ id:w.id, stepId:w.stepId, status:w.status, choices:w.choices }));
  const evidenceWaits = run.current.evidenceWaits.map(w => ({ id:w.id, stepId:w.stepId, status:w.status }));
  const openWaits=run.current.waits.filter(w=>w?.stepId==='full.open.confirm' && w.status==='pending');
  let confirmationPrompt;
  if (openWaits.length) {
    if (openWaits.length!==1 || run.state.phase!=='open') fail('OPEN_CONFIRMATION_UNAVAILABLE','Comet returned an ambiguous Open confirmation.');
    const prompt=buildCodexOpenConfirmation({run,waitId:openWaits[0].id});
    if (!prompt.ok) fail('OPEN_CONFIRMATION_UNAVAILABLE','The native Open confirmation does not match the current frozen requirements.');
    confirmationPrompt={waitId:prompt.waitId,title:prompt.title,options:prompt.options,
      questionDigest:prompt.questionDigest,optionsDigest:prompt.optionsDigest};
  }
  const blockers = [];
  if (waits.length) blockers.push('AWAITING_DECISION');
  if (evidenceWaits.length) blockers.push('AWAITING_EVIDENCE');
  if (actions.some(a => a.status !== 'pending')) blockers.push('ACTION_NOT_PENDING');
  if (run.status !== 'running') blockers.push(`RUN_STATUS_${String(run.status).toUpperCase()}`);
  const skillWork = (Array.isArray(packet.skillWork) ? packet.skillWork : []).map(x => ({
    actionId:x.actionId, skillId:x.skill?.id, root:x.skill?.root, contentHash:x.skill?.contentHash,
  }));
  const recordedExtensions = (Array.isArray(run.actions) ? run.actions : [])
    .filter(a => typeof a.stepId === 'string' && a.stepId.startsWith('classic.extension.'))
    .map(a => ({ id:a.id, stepId:a.stepId, status:a.status, reportedVerdict:a.outcome?.output?.verdict, validity:'UNVERIFIED' }));
  return { runId:run.runId, revision:run.revision, phase:run.state.phase, status:run.status,
    application:{id:packet.application.id,contentHash:packet.application.contentHash,packageRoot:packet.application.packageRoot,runtimeVersion:packet.application.runtimeVersion},
    current:{actions, waits, evidenceWaits}, skillWork, recordedExtensions, blocked:blockers.length>0, blockers,
    ...(confirmationPrompt?{confirmationPrompt}:{}) };
}

function queryView(run, application) {
  if (!['open','design','build','verify','archive'].includes(run?.state?.phase) || !Number.isSafeInteger(run.revision) || run.revision<0
    || !Array.isArray(run.actions) || !Array.isArray(run.waits) || !Array.isArray(run.evidenceWaits)) fail('RUN_STATE_INVALID','Comet could not read the original Run.');
  const actions=run.actions.map((a)=>({id:a.id,stepId:a.stepId,type:a.type,ref:a.ref,status:a.status}));
  const waits=run.waits.map((w)=>({id:w.id,stepId:w.stepId,status:w.status,choices:w.choices}));
  const evidenceWaits=run.evidenceWaits.map((w)=>({id:w.id,stepId:w.stepId,status:w.status}));
  const blockers=[];
  if(waits.length)blockers.push('AWAITING_DECISION');if(evidenceWaits.length)blockers.push('AWAITING_EVIDENCE');
  if(actions.some((a)=>a.status!=='pending'))blockers.push('ACTION_NOT_PENDING');
  if(run.status!=='running')blockers.push(`RUN_STATUS_${String(run.status).toUpperCase()}`);
  return {runId:run.runId,revision:run.revision,phase:run.state.phase,status:run.status,application,current:{actions,waits,evidenceWaits},blocked:blockers.length>0,blockers};
}

function projectionRecoveryKind(error) {
  if (error.runtimeCode !== 'RUNTIME_ERROR') return null;
  return /^Classic SDK Run [^\n]+ requires recovery: (the state projection or portable checkpoint is missing or stale|the Git branch binding has not been recorded)\./.exec(error.message)?.[1] ?? null;
}

function recoverProjection(projectRoot, runId, wanted, initialError) {
  let previousRevision=null;let previousKind=null;let conflict=false;let currentKind=projectionRecoveryKind(initialError);
  for (let attempt=0;attempt<3;attempt++) {
    const packet=runtime(projectRoot,{operation:'query',runId,view:'current'});
    const run=packet.data;
    const current=queryView(run,packet.application);
    if (previousRevision!==null && run.revision<=previousRevision && (conflict || currentKind===previousKind)) fail('RECOVERY_BLOCKED','Comet recovery did not change the Run or the recovery reason; inspect it before recovery.',current);
    if (wanted && current.phase!==wanted) fail('PHASE_MISMATCH',`Current phase is ${current.phase}; the requested entry cannot advance it.`,current);
    if (run.status!=='running' || run.actions.some((action)=>action.status!=='pending') || run.waits.length || run.evidenceWaits.length) {
      fail('RECOVERY_BLOCKED','The original Run has active or waiting work; inspect it before recovery.',current);
    }
    try { runtime(projectRoot,{operation:'next',runId,expectedRevision:run.revision}); }
    catch (error) {
      if (error.runtimeCode==='REVISION_CONFLICT') { previousRevision=run.revision;conflict=true;continue; }
      const unknown=new Error('Comet recovery outcome is unknown; inspect the original Run before retry.');
      unknown.code='NEXT_OUTCOME_UNKNOWN';unknown.recovery={runId,beforeRevision:run.revision};throw unknown;
    }
    previousRevision=run.revision;previousKind=currentKind;conflict=false;
    try { return view(runtime(projectRoot,{operation:'inspect',runId})); }
    catch (error) {
      currentKind=projectionRecoveryKind(error);
      if (!currentKind) {
        const unknown=new Error('Comet recovery completed but its readback failed; inspect the original Run before retry.');
        unknown.code='NEXT_OUTCOME_UNKNOWN';unknown.recovery={runId,beforeRevision:run.revision};throw unknown;
      }
    }
  }
  fail('RECOVERY_REQUIRED','Comet still requires recovery; inspect the original Run before continuing.');
}

try {
  const {values,positionals} = parseArgs({allowPositionals:true, options:{'run-id':{type:'string'},'project-root':{type:'string'},'change-dir':{type:'string'},language:{type:'string'},continue:{type:'boolean'},start:{type:'boolean'},'locked-start':{type:'boolean'},'locked-resume':{type:'boolean'},'observe-open-call':{type:'string'},'session-path':{type:'string'},'question-index':{type:'string'},'scan-start':{type:'string'},answer:{type:'string'}}});
  if (positionals.length !== 1 || !stages.has(positionals[0]) || !values['run-id'] || !values['project-root']) {
    fail('INPUT_INVALID', 'Specify a Comet entry, --run-id and --project-root.');
  }
  const observe=values['observe-open-call']!==undefined;
  const observationFields=['session-path','question-index','scan-start','answer'];
  if ((!observe && observationFields.some(key=>values[key]!==undefined))
    || observe && (values.start || values.continue || values['locked-start'] || values['locked-resume'] || values['change-dir']!==undefined || values.language!==undefined
      || !['/comet','/comet-open'].includes(positionals[0]) || !/^call_[A-Za-z0-9]{8,128}$/.test(values['observe-open-call'])
      || !values['session-path'] || !path.isAbsolute(values['session-path']) || !['approved','rejected'].includes(values.answer)
      || values['question-index']!==undefined && !/^[0-2]$/.test(values['question-index'])
      || values['scan-start']!==undefined && (!/^(0|[1-9][0-9]*)$/.test(values['scan-start']) || !Number.isSafeInteger(Number(values['scan-start']))))) {
    fail('INPUT_INVALID','Open choice observation requires one call ID, rooted session path and answer, without progression.');
  }
  const version = spawnSync('comet', ['--version'], {encoding:'utf8',timeout:10000});
  if (version.error || version.status !== 0 || version.stdout.trim() !== '0.5.1') fail('COMET_VERSION_UNAVAILABLE', 'PATH must select external Comet 0.5.1.');
  const projectRoot=path.resolve(values['project-root']);
  const wanted=stages.get(positionals[0]);
  if(values['locked-start'] && !values.start) fail('INPUT_INVALID','Internal start requires a start request.');
  if(values['locked-resume'] && (!values.continue || values.start)) fail('INPUT_INVALID','Internal resume requires a continuation request.');
  if (values.start) {
    if (values.continue || (wanted!==null && wanted!=='open')) fail('INPUT_INVALID','Starting a Run requires the general or Open entry without --continue.');
    const packageRoot=selectedCometRoot();
    const cometDir=path.join(fs.realpathSync(projectRoot),'.comet');
    const stat=fs.lstatSync(cometDir);
    if(!stat.isDirectory() || stat.isSymbolicLink()) fail('START_LOCK_UNAVAILABLE','Comet project directory must be a real directory.');
    const legacyLock=path.join(cometDir,'sdd-application-start.lock');
    try { fs.lstatSync(legacyLock);fail('START_LOCK_RECOVERY_REQUIRED','An older start lock exists; reconcile its original process before continuing.'); }
    catch(error) { if(error.code!=='ENOENT') throw error; }
    const lockFile=path.join(cometDir,'sdd-start.flock');
    if(!values['locked-start']) {
      const args=[fileURLToPath(import.meta.url),positionals[0],'--run-id',values['run-id'],'--project-root',projectRoot,'--start','--locked-start'];
      if(values['change-dir'])args.push('--change-dir',values['change-dir']);if(values.language)args.push('--language',values.language);
      const supervisor=spawnSync('python3',[path.join(path.dirname(fileURLToPath(import.meta.url)),'start-lock.py'),lockFile,process.execPath,...args],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});
      if(supervisor.error || supervisor.status===null) { const unknown=new Error('Comet start outcome is unknown; inspect the original Run before retry.');unknown.code='START_OUTCOME_UNKNOWN';unknown.recovery={runId:values['run-id']};throw unknown; }
      if(supervisor.status!==0) {
        let error;try{error=JSON.parse(supervisor.stderr);}catch{const unknown=new Error('Comet start outcome is unknown; inspect the original Run before retry.');unknown.code='START_OUTCOME_UNKNOWN';unknown.recovery={runId:values['run-id']};throw unknown;}
        const failure=new Error(error.message??'Comet start failed.');failure.code=error.code??'START_OUTCOME_UNKNOWN';failure.recovery=error.recovery;failure.current=error.current;throw failure;
      }
      let result;try{result=JSON.parse(supervisor.stdout);}catch{result=null;}
      if(result?.runId!==values['run-id'] || result?.continuation!=='started') {const unknown=new Error('Comet start outcome is unknown; inspect the original Run before retry.');unknown.code='START_OUTCOME_UNKNOWN';unknown.recovery={runId:values['run-id']};throw unknown;}
      process.stdout.write(supervisor.stdout);
    } else {
    assertInheritedLock(lockFile);
    assertNoCurrentSelection(projectRoot);
    const language=values.language ?? await projectLanguage(projectRoot,packageRoot);
    const start=classicCompositionStartRequest({change:values['run-id'],changeDir:values['change-dir'] ?? `openspec/changes/${values['run-id']}`,workflowId:'comet-classic-full',workflowVersion:'1',language});
    let sdk,observations;
    try {
      sdk=await import(pathToFileURL(path.join(packageRoot,'dist/domains/workflow-application/index.js')).href);
      observations=await sdk.listWorkflowApplicationRunRecords(projectRoot,{applicationId:'sdd-managed-delivery',excludeClosed:true,excludeAbortedRegistrations:true});
    } catch { fail('RUN_RECORDS_UNAVAILABLE','Cannot verify the existing application Runs before starting.'); }
    if(!Array.isArray(observations) || observations.some((item)=>item.error || !item.record || !Array.isArray(item.record.run?.lineage)
      || typeof item.record.run?.status!=='string' || !['0.5.0','0.5.1'].includes(item.record.application?.runtimeVersion))) {
      fail('RUN_RECORDS_UNAVAILABLE','Existing application Run records are incomplete or use an unsupported Runtime.');
    }
    const unfinished=observations.filter((item)=>item.record.application.runtimeVersion==='0.5.1'
      && item.record.run.lineage.length===0 && !['completed','cancelled'].includes(item.record.run.status));
    if(unfinished.length) fail('UNSELECTED_RUN_EXISTS','An unfinished 0.5.1 application Run already exists; inspect or resume it before starting another.',
      {runs:unfinished.map((item)=>({runId:item.runId,status:item.record.run.status,applicationVersion:item.record.application.version}))});
    try {
      const file=await sdk.resolveWorkflowApplicationFile(projectRoot,'sdd-managed-delivery',values['run-id']);
      const result=await sdk.invokeWorkflowApplicationSkill({file,projectRoot,request:{operation:'start',runId:values['run-id'],workflowId:'comet-classic-full',input:start.input,initialState:start.initialState}});
      if(result.application?.id!=='sdd-managed-delivery' || result.run?.runId!==values['run-id']) throw new Error('Comet returned a different application or Run');
      const record=await sdk.readWorkflowApplicationRunRecord(projectRoot,'sdd-managed-delivery',values['run-id']);
      if(record?.runId!==values['run-id'] || record.application?.id!==result.application.id || record.application?.version!==result.application.version
        || record.application?.packageRoot!==result.application.packageRoot || record.application?.projectRoot!==fs.realpathSync(projectRoot)
        || record.application?.runtimeVersion!=='0.5.1' || !/^[a-f0-9]{64}$/.test(record.application?.contentHash ?? '')) throw new Error('Comet Run identity could not be verified');
      const readback=runtime(projectRoot,{operation:'query',runId:values['run-id'],view:'current'});
      const current=queryView(readback.data,record.application);
      process.stdout.write(JSON.stringify({...current,continuation:'started'})+'\n');
    } catch (error) {
      const denied=['EACCES','EPERM'].includes(error?.code);
      const unknown=new Error(denied
        ? 'Comet start was denied by filesystem permissions; inspect the original Run before retry and check the data directory and project permissions.'
        : 'Comet start outcome is unknown; inspect the original Run before retry.');
      unknown.code='START_OUTCOME_UNKNOWN';unknown.recovery={runId:values['run-id'],...(error.runtimeCode?{runtimeCode:error.runtimeCode}:{}),...(denied?{errorCategory:'PERMISSION_DENIED'}:{})};throw unknown;
    }
    }
  } else {
  if(values.continue) selectionMatches(projectRoot,values['run-id']);
  if(observe && !selectionMatches(projectRoot,values['run-id'])) fail('CURRENT_SELECTION_UNAVAILABLE','The original application Run is not selected.');
  if(values['locked-resume']) {
    const root=fs.realpathSync(projectRoot),lockFile=path.join(root,'.comet/sdd-start.flock');
    assertInheritedLock(lockFile);
    let current;
    try{current=view(runtime(projectRoot,{operation:'inspect',runId:values['run-id']}));}
    catch(error){if(!projectionRecoveryKind(error))throw error;current=recoverProjection(projectRoot,values['run-id'],wanted,error);}
    if(wanted && current.phase!==wanted)fail('PHASE_MISMATCH',`Current phase is ${current.phase}; the requested entry cannot advance it.`,current);
    if(!selectionMatches(projectRoot,values['run-id'])) {
      const sdk=await import(pathToFileURL(path.join(selectedCometRoot(),'dist/domains/workflow-application/index.js')).href);
      try{const file=await sdk.resolveWorkflowApplicationFile(projectRoot,'sdd-managed-delivery',values['run-id']);const result=await sdk.invokeWorkflowApplicationSkill({file,projectRoot,request:{operation:'resume',runId:values['run-id']}});if(result.application?.id!=='sdd-managed-delivery'||result.run?.runId!==values['run-id']||!selectionMatches(projectRoot,values['run-id']))throw new Error('resume identity mismatch');}
      catch{fail('RESUME_OUTCOME_UNKNOWN','Comet resume outcome is unknown; inspect the original Run before retry.');}
    }
    process.stdout.write(JSON.stringify({...current,continuation:'selection-restored'})+'\n');
  } else {
  let current,inspection; let recovered=false;
  try { inspection=runtime(projectRoot,{operation:'inspect',runId:values['run-id']});current=view(inspection); }
  catch (error) {
    if (!values.continue || !projectionRecoveryKind(error)) throw error;
    current=recoverProjection(projectRoot,values['run-id'],wanted,error);recovered=true;
  }
  if (wanted && current.phase !== wanted) fail('PHASE_MISMATCH', `Current phase is ${current.phase}; ${positionals[0]} cannot advance it.`, current);
  if (observe) {
    if (!inspection || !current.confirmationPrompt || current.phase!=='open') fail('OPEN_CHOICE_SOURCE_UNAVAILABLE','The original Run is not awaiting an inspectable Open confirmation.');
    const run=inspection.data,threadId=process.env.CODEX_THREAD_ID,index=Number(values['question-index']??0);
    const prompt=buildCodexOpenConfirmation({run,waitId:current.confirmationPrompt.waitId});
    if (!prompt.ok) fail('OPEN_CHOICE_SOURCE_UNAVAILABLE','The original Open confirmation cannot be reconstructed.');
    const locator=locateCodexHumanChoice({sessionPath:values['session-path'],threadId,callId:values['observe-open-call'],index,
      ...(values['scan-start']===undefined?{}:{scanStart:Number(values['scan-start'])})});
    if (!locator.ok) fail('OPEN_CHOICE_SOURCE_UNAVAILABLE','The rooted host question and user reply could not be located.');
    const choice=readCodexHumanChoice({sessionPath:values['session-path'],threadId,callId:values['observe-open-call'],index,
      question:locator.question,reply:locator.reply,turnId:locator.turnId,replyItemId:locator.replyItemId,
      questionDigest:prompt.questionDigest,optionsDigest:prompt.optionsDigest,
      answerDigest:values.answer==='approved'?prompt.approvedAnswerDigest:prompt.rejectedAnswerDigest});
    const decision=deriveCodexOpenDecision({run,waitId:prompt.waitId,choice});
    if (!choice.ok || !decision.ok || decision.nativeChoice!==values.answer) fail('OPEN_CHOICE_SOURCE_UNAVAILABLE','The host choice does not match the current frozen Open confirmation.');
    const after=view(runtime(projectRoot,{operation:'inspect',runId:values['run-id']}));
    if (!selectionMatches(projectRoot,values['run-id']) || after.revision!==current.revision || after.application.contentHash!==current.application.contentHash
      || after.confirmationPrompt?.waitId!==prompt.waitId || after.confirmationPrompt?.questionDigest!==prompt.questionDigest
      || after.confirmationPrompt?.optionsDigest!==prompt.optionsDigest) fail('OPEN_CHOICE_STALE','The original Run changed during source observation.');
    process.stdout.write(JSON.stringify({...after,continuation:'observed-choice-unqualified',confirmationObservation:{
      nativeChoice:decision.nativeChoice,decisionId:decision.decisionId,sourceQualified:false,managedClosureEligible:false}})+'\n');
  } else if(values.continue && !selectionMatches(projectRoot,values['run-id'])) {
    process.stdout.write(JSON.stringify(restoreSelection(projectRoot,values['run-id'],positionals[0]))+'\n');
  } else if (recovered) {
    process.stdout.write(JSON.stringify({...current,continuation:'projection-recovered'})+'\n');
  } else if (values.continue && !current.blocked) {
    let next;
    let nextSucceeded=false;
    try {
      runtime(projectRoot,{operation:'next',runId:current.runId,expectedRevision:current.revision});
      nextSucceeded=true;
      next=view(runtime(projectRoot,{operation:'inspect',runId:current.runId}));
    } catch (error) {
      if (!nextSucceeded && error.runtimeCode === 'REVISION_CONFLICT') throw error;
      let readback=null;
      try { readback=view(runtime(projectRoot,{operation:'inspect',runId:current.runId})); } catch { /* inspect remains required */ }
      const unknown=new Error('Comet next outcome is unknown; inspect the original Run before retry.');
      unknown.code='NEXT_OUTCOME_UNKNOWN';
      unknown.recovery={runId:current.runId,beforeRevision:current.revision,readback};
      throw unknown;
    }
    process.stdout.write(JSON.stringify({...next, continuation:'comet-next',transition:{from:current.phase,to:next.phase}})+'\n');
  } else {
    process.stdout.write(JSON.stringify({...current, continuation:current.blocked?'inspect-original-blocker':'inspect-current-action'})+'\n');
  }
  }
  }
} catch (error) {
  process.stderr.write(JSON.stringify({ok:false,code:error.code??'ENTRY_FAILED',message:error.message,...(error.runtimeCode?{runtimeCode:error.runtimeCode}:{}),...(error.current?{current:error.current}:{}),...(error.recovery?{recovery:error.recovery}:{})})+'\n');
  process.exitCode=2;
}
