import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {parseTapPoints, evaluateAssertionId} from './delivery-journey.mjs';
import {parseTapSummary, classifyRunOutcome} from '../../lib/delivery/test-contract.js';
function missingRegisteredLeaves(points, names) {
  const required = new Set(names);
  const missing = [];
  const isParent = (index) => index > 0 && points[index - 1].indent > points[index].indent;
  for (let i = 0; i < points.length; i++) {
    if (!required.has(points[i].name) || !isParent(i)) continue;
    for (let j = i - 1; j >= 0 && points[j].indent > points[i].indent; j--) {
      if (!isParent(j) && !required.has(points[j].name)) missing.push(points[j].name);
    }
  }
  return [...new Set(missing)];
}
const [flag,id,...extra]=process.argv.slice(2);
try {
  if(flag!=='--check-id' || !id || extra.length || !/^[A-Za-z0-9_:-]{1,128}$/.test(id)) throw Error('invalid check id');
  const root=fs.realpathSync(process.cwd());
  const dir=path.join(root,'openspec/changes/delivery-foundation-rearchitecture');
  const raw=fs.readFileSync(path.join(dir,'execution-contract.json'));
  const lockFile=path.join(dir,'drift-lock.json');const lockRaw=fs.readFileSync(lockFile);
  const lockHash=crypto.createHash('sha256').update(lockRaw).digest('hex');const lock=JSON.parse(lockRaw);
  const contractHash=crypto.createHash('sha256').update(raw).digest('hex');
  if(lock.execution_contract_sha256!==contractHash) throw Error('contract drift');
  const contract=JSON.parse(raw);const matches=contract.checks.filter(check=>check.id===id);
  if(matches.length!==1 || matches[0].required!==true) throw Error('required check not uniquely registered');
  const t=matches[0].testTarget;
  if(!t || typeof t.file!=='string' || path.isAbsolute(t.file) || t.file.split(/[\\/]/).includes('..') || !/^[A-Za-z0-9_:-]{1,128}$/.test(t.pattern??'') || !Array.isArray(t.requiredNames) || !t.requiredNames.length || t.requiredNames.some(name=>typeof name!=='string'||!name.trim()||/[\r\n]/.test(name)) || new Set(t.requiredNames).size!==t.requiredNames.length || t.minimumPerName!==1 || t.uniquePerName!==true) throw Error('invalid frozen test target');
  const target=fs.realpathSync(path.resolve(root,t.file));if(!target.startsWith(root+path.sep)||!fs.statSync(target).isFile()) throw Error('test file must stay in workspace');
  const sourceBefore=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const result=spawnSync(process.execPath,['--test','--test-reporter=tap',`--test-name-pattern=${t.pattern}`,target],{encoding:'utf8',env,timeout:600000,maxBuffer:32*1024*1024});
  if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
  let sourceAfter=null, contractAfter=null, lockAfter=null;try {sourceAfter=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');contractAfter=crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,'execution-contract.json'))).digest('hex');lockAfter=crypto.createHash('sha256').update(fs.readFileSync(lockFile)).digest('hex');} catch {}
  const stable=sourceAfter===sourceBefore && contractAfter===contractHash && lockAfter===lockHash;
  const points=parseTapPoints(result.stdout);const observed=t.requiredNames.map(name=>evaluateAssertionId(name,points.filter(point=>point.name===name)));
  const missingLeaves=missingRegisteredLeaves(points,t.requiredNames);
  const summary=parseTapSummary(result.stdout);const complete=summary&&summary.tests>0&&summary.tests===summary.pass&&summary.fail===0&&summary.skipped===0&&summary.todo===0&&summary.cancelled===0;
  const outcome=classifyRunOutcome({exitCode:result.status,output:`${result.stdout??''}\n${result.stderr??''}`,spawnError:result.error});
  const signalled=result.signal!==null || /^\s*signal:\s*['\"]?SIG[A-Z0-9]+/m.test(result.stdout??'');
  const pass=!result.error&&result.status===0&&!signalled&&outcome.kind==='pass'&&stable&&complete&&missingLeaves.length===0&&observed.every(v=>v.status==='satisfied'&&v.matchedPoints===1&&v.ok===1);
  const fail=stable && Number.isInteger(result.status) && result.status>0 && !signalled && outcome.kind==='behavior-red' && observed.some(v=>v.failed>0);
  const verdict=pass?'PASS':fail?'FAIL':'NOT-EXERCISED';
  process.stdout.write(`# target-verdict ${JSON.stringify({id,verdict,scope:'component',contractHash,lockHash,testFileSha256:sourceBefore,stable,missingLeaves,rawTapSha256:crypto.createHash('sha256').update(result.stdout??'').digest('hex'),assertions:observed,childExit:result.status,childSignal:result.signal??null})}\n`);
  process.exitCode=pass?0:2;
} catch(error) {console.error(error.message);process.stdout.write(`# target-verdict ${JSON.stringify({id:id??null,verdict:'NOT-EXERCISED',reason:'INVALID_INPUT'})}\n`);process.exitCode=1;}
