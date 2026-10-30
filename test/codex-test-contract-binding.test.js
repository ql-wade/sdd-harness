import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { envelopeDigest } from '../lib/delivery/evidence.js';
import { bindCodexTestContract } from '../lib/adapters/codex-test-observation.js';

const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const argv=['/bin/zsh','-lc','node --test --test-reporter=tap test/example.test.js'];
const cwd='file:///project';
const contract={schemaVersion:1,project:'project',change:'feature',commandBindingsRequired:true,
  sourceReadiness:'ready_for_acceptance',cases:[{id:'case-1',ac:'AC1',oracle:'observed value equals expected',checkIds:['check-1']}],
  requiredChecks:[{id:'check-1',mode:'automated',command:argv[2],caseIds:['case-1'],level:'unit',capability:'unit:node:test'}],
  executionDenominator:{totalCases:1},cleanup:{environment:'remove fixture',data:'none'},dependencyBaselines:[{kind:'product',digest:'a'.repeat(64)}]};
const observation={ok:true,scope:'codex-claimed-test-observation',sourceQualified:false,managedClosureEligible:false,
  runId:'feature',actionId:'feature:7',stepId:'classic.extension.verify-whitebox',revision:7,applicationHash:'b'.repeat(64),actionInputHash:'c'.repeat(64),
  commandDigest:hash(JSON.stringify({argv,cwd})),outputDigest:'d'.repeat(64),outcome:'pass',summary:{tests:1,pass:1,fail:0,skipped:0,cancelled:0,todo:0,suites:0}};
const input={observation,contract,contractDigest:envelopeDigest(contract),checkId:'check-1',argv,cwd,
  expectedRunId:'feature',expectedActionId:'feature:7',expectedActionInputHash:'c'.repeat(64),expectedApplicationHash:'b'.repeat(64)};

test('host test binds one frozen automated contract command and case without granting gate acceptance',()=>{
  const result=bindCodexTestContract(input);
  assert.equal(result.ok,true);assert.deepEqual(result.declaredCaseIds,['case-1']);assert.equal(Object.hasOwn(result,'caseIds'),false);assert.equal(result.checkId,'check-1');
  assert.equal(result.sourceQualified,false);assert.equal(result.managedClosureEligible,false);
  for (const bad of [
    {...input,expectedRunId:'other'}, {...input,expectedActionId:'feature:8'}, {...input,expectedActionInputHash:'e'.repeat(64)},
    {...input,expectedApplicationHash:'f'.repeat(64)}, {...input,contractDigest:'e'.repeat(64)},
    {...input,checkId:'other'}, {...input,cwd:'file:///other'}, {...input,argv:['/bin/zsh','-lc','echo fake']},
    {...input,observation:{...observation,stepId:'classic.extension.requirements-open'}},
    {...input,observation:{...observation,stepId:'full.verify.run'}},
    {...input,observation:{...observation,summary:{...observation.summary,tests:2}}},
    {...input,observation:{...observation,outputDigest:'not-a-hash'}},
    {...input,contract:{...contract,requiredChecks:[{...contract.requiredChecks[0],mode:'manual'}]}},
  ]) assert.equal(bindCodexTestContract(bad).ok,false);
});

test('design-only automated observations remain candidates until the gate qualifies author evidence',()=>{
  const design={...contract,sourceReadiness:'design_only'};
  const result=bindCodexTestContract({...input,contract:design,contractDigest:envelopeDigest(design)});
  assert.equal(result.ok,true);assert.equal(result.sourceQualified,false);assert.equal(result.managedClosureEligible,false);
});

test('one observed test does not claim execution of every case declared by its check',()=>{
  const multiple=structuredClone(contract);
  multiple.cases.push({id:'case-2',ac:'AC2',oracle:'second independent outcome',checkIds:['check-1']});
  multiple.requiredChecks[0].caseIds.push('case-2');multiple.executionDenominator.totalCases=2;
  const result=bindCodexTestContract({...input,contract:multiple,contractDigest:envelopeDigest(multiple)});
  assert.equal(result.ok,true);assert.deepEqual(result.declaredCaseIds,['case-1','case-2']);
  assert.equal(Object.hasOwn(result,'caseIds'),false);assert.equal(Object.hasOwn(result,'observedCaseIds'),false);
  assert.equal(result.summary.tests,1);assert.equal(result.managedClosureEligible,false);
});

test('legacy v1 contracts can bind automated checks without a readiness or mode field',()=>{
  const legacy=structuredClone(contract);delete legacy.sourceReadiness;delete legacy.requiredChecks[0].mode;
  const result=bindCodexTestContract({...input,contract:legacy,contractDigest:envelopeDigest(legacy)});
  assert.equal(result.ok,true);assert.equal(result.sourceQualified,false);
});
