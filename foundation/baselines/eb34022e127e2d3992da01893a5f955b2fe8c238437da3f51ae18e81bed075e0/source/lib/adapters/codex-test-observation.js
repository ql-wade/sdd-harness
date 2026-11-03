import { classifyRunOutcome } from '../delivery/test-contract.js';
import { validateTestContract } from '../../contracts/delivery/test-contract.schema.js';
import { envelopeDigest } from '../delivery/evidence.js';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function completeTapGroups(output) {
  const frames=[{indent:0,count:0,planned:false,pending:null}];
  for (const line of output.split(/\r?\n/)) {
    const subtest=/^([ \t]*)# Subtest: ([^\r\n]+)$/.exec(line);
    const point=/^([ \t]*)(?:ok|not ok) (\d+) - ([^\r\n]+)$/.exec(line);
    const plan=/^([ \t]*)1\.\.(\d+)(?:[ \t]+#.*)?$/.exec(line);
    if (!subtest && !point && !plan) continue;
    const indent=(subtest ?? point ?? plan)[1].replace(/\t/g,'    ').length;
    while (frames.length>1 && indent<frames.at(-1).indent) {
      if (!frames.pop().planned) return false;
    }
    if (indent>frames.at(-1).indent) {
      if (!frames.at(-1).pending) return false;
      frames.push({indent,count:0,planned:false,pending:null});
    }
    if (indent!==frames.at(-1).indent) return false;
    const frame=frames.at(-1);
    if (subtest) {
      if (frame.planned || frame.pending!==null) return false;
      frame.pending=subtest[2];
    } else if (point) {
      const name=point[3].replace(/\s+#\s*(?:SKIP|TODO)\b.*$/i,'');
      if (frame.planned || Number(point[2])!==frame.count+1 || frame.pending!==name) return false;
      frame.count++;frame.pending=null;
    } else {
      if (frame.planned || frame.pending!==null || Number(plan[2])!==frame.count) return false;
      frame.planned=true;
    }
  }
  return frames.every(frame=>frame.planned);
}

// An observed execution is evidence, not an authorization or gate decision.
export function measureCodexTestOutput(exitCode, output) {
  if (typeof output!=='string') return null;
  const headers=[...output.matchAll(/^TAP version (?:13|14)\r?$/gm)];
  const plans=[...output.matchAll(/^1\.\.(\d+)(?:[ \t]+#.*)?\r?$/gm)];
  const results=[...output.matchAll(/^(not ok|ok) (\d+) - [^\r\n]+\r?$/gm)];
  const tests=[...output.matchAll(/^# tests \d+\r?$/gm)];
  const passes=[...output.matchAll(/^# pass \d+\r?$/gm)];
  const failures=[...output.matchAll(/^# fail \d+\r?$/gm)];
  const allResults=[...output.matchAll(/^[ \t]*(not ok|ok) (\d+) - [^\r\n]+\r?$/gm)];
  if (headers.length!==1 || plans.length!==1 || tests.length!==1 || passes.length!==1 || failures.length!==1
    || !results.length || Number(plans[0][1])!==results.length || results.some((item,i)=>Number(item[2])!==i+1) || !completeTapGroups(output)
    || /^[ \t]*Bail out!/m.test(output) || headers[0].index>results[0].index
    || plans[0].index<results.at(-1).index || tests[0].index<plans[0].index) return null;
  const result=classifyRunOutcome({exitCode,output});
  const skipped=allResults.filter(item=>/(?<!\\)#\s*SKIP\b/i.test(item[0])).length;
  const todo=allResults.filter(item=>/(?<!\\)#\s*TODO\b/i.test(item[0])).length;
  if (result.summary && (result.summary.skipped<skipped || result.summary.todo<todo)) return null;
  if (result.summary && result.summary.tests>allResults.length) return null;
  if (result.kind==='pass' && allResults.some(item=>item[1]==='not ok' && !/(?<!\\)#\s*TODO\b/i.test(item[0]))) return null;
  if (result.kind==='behavior-red' && !results.some(item=>item[1]==='not ok')) return null;
  return ['pass','behavior-red'].includes(result.kind) ? result : null;
}

// This correlates observations with a declared contract. Its inputs are not
// authenticated here; a protected caller must establish their authority.
export function bindCodexTestContract({observation,contract,contractDigest,checkId,argv,cwd,
  expectedRunId,expectedActionId,expectedActionInputHash,expectedApplicationHash} = {}) {
  const no=()=>({ok:false,scope:'codex-test-contract-observation',sourceQualified:false,managedClosureEligible:false});
  const sha=value=>/^[a-f0-9]{64}$/.test(value ?? '');
  try {
    if (observation?.ok!==true || observation.scope!=='codex-claimed-test-observation'
      || observation.sourceQualified!==false || observation.managedClosureEligible!==false
      || observation.stepId!=='classic.extension.verify-whitebox' || observation.runId!==expectedRunId || observation.actionId!==expectedActionId
      || !sha(expectedActionInputHash) || observation.actionInputHash!==expectedActionInputHash
      || !sha(expectedApplicationHash) || observation.applicationHash!==expectedApplicationHash
      || !sha(observation.commandDigest) || !sha(observation.outputDigest)
      || !Number.isSafeInteger(observation.revision) || observation.revision<0
      || !['pass','behavior-red'].includes(observation.outcome)) return no();
    const summary=observation.summary;
    if (!summary || ['tests','pass','fail','cancelled','skipped','todo'].some(key=>!Number.isSafeInteger(summary[key]) || summary[key]<0)
      || summary.tests<1 || summary.tests!==summary.pass+summary.fail+summary.cancelled+summary.skipped+summary.todo
      || summary.cancelled!==0 || (observation.outcome==='pass' && (summary.pass<1 || summary.fail!==0))
      || (observation.outcome==='behavior-red' && summary.fail<1)) return no();
    if (!sha(contractDigest) || envelopeDigest(contract)!==contractDigest || !validateTestContract(contract).ok
      || contract.commandBindingsRequired!==true || contract.change!==expectedRunId) return no();
    const checks=contract.requiredChecks.filter(check=>check.id===checkId);
    if (checks.length!==1 || checks[0].mode==='manual' || !Array.isArray(argv) || argv.length!==3
      || !['/bin/zsh','/bin/bash','/bin/sh'].includes(argv[0]) || argv[1]!=='-lc' || argv[2]!==checks[0].command) return no();
    let validCwd=typeof cwd==='string' && path.isAbsolute(cwd);
    if (!validCwd && typeof cwd==='string') {
      const url=new URL(cwd);validCwd=url.protocol==='file:' && !url.search && !url.hash && path.isAbsolute(fileURLToPath(url));
    }
    if (!validCwd || createHash('sha256').update(JSON.stringify({argv,cwd})).digest('hex')!==observation.commandDigest) return no();
    return {ok:true,scope:'codex-test-contract-observation',sourceQualified:false,managedClosureEligible:false,
      runId:observation.runId,actionId:observation.actionId,revision:observation.revision,actionInputHash:observation.actionInputHash,
      contractDigest,checkId,capability:checks[0].capability,declaredCaseIds:[...checks[0].caseIds],outputDigest:observation.outputDigest,
      outcome:observation.outcome,summary:structuredClone(summary)};
  } catch { return no(); }
}
