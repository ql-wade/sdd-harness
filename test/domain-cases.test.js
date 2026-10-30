import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { compileDomainCases, verifyDomainCaseProjection } from '../lib/delivery/domain-cases.js';
import { parseContract } from '../contracts/delivery/index.js';
import { evaluate } from '../lib/delivery/gate.js';

const validator = path.resolve('.agents/skills/test-authoring/scripts/validate_test_pack.py');
const cli = path.resolve('tools/test-cases/compile-domain-cases.mjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'domain-cases-')));
  fs.writeFileSync(path.join(root, 'requirements.md'), '# Requirement\nA permitted user can read the item.\n');
  fs.writeFileSync(path.join(root, 'design.md'), '# Design\nRead is performed through the public API.\n');
  fs.writeFileSync(path.join(root, 'cases.md'), `<!-- domain-cases/v1 -->\n# Domain cases\n\n### TC-READ-1 — Read item\n\n- **Requirement IDs**: REQ-1\n- **Acceptance**: AC-1\n- **Dimensions**: Journey-A\n- **Level**: api\n- **Priority**: P1\n- **Precondition**: User is permitted\n- **Input**: Item exists\n- **Step**: Request the item\n- **Expected**: The item is returned\n- **Oracle basis**: REQ-1\n- **Oracle authority**: Public API response\n- **Cleanup**: Remove fixture data\n- **Evidence**: Request and response\n- **Check ID**: read-item\n`);
  const dimensions = Object.fromEntries('ABCDEFGHIJ'.split('').map(c => [`Journey-${c}`, {
    required: c === 'A', reason: c === 'A' ? 'Required by REQ-1' : 'Not applicable to this case', basis_ids: ['REQ-1'],
  }]));
  const config = {
    project: 'fixture', change: 'fixture-change', mode: 'design', design_basis_id: 'DESIGN-1',
    basis: [{ id: 'REQ-1', kind: 'requirement', path: 'requirements.md' }, { id: 'DESIGN-1', kind: 'source', path: 'design.md' }],
    dimensions, checks: [{ id: 'read-item', level: 'api', capability: 'api:read', command: 'node --test read.test.js' }],
    cleanup: { environment: 'Dispose isolated process', data: 'Remove fixture data' },
  };
  return { root, config, dispose: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('a Markdown case produces an existing valid TestPack and a traced Comet test contract', () => {
  const f = fixture();
  try {
    const result = compileDomainCases({ projectRoot: f.root, caseFile: 'cases.md', config: f.config });
    assert.equal(result.testPack.cases[0].id, 'TC-READ-1');
    assert.equal(result.testPack.cases[0].oracle.expected, 'The item is returned');
    assert.equal(result.testContract.cases[0].ac, 'AC-1');
    assert.equal(parseContract('SDD.Delivery.TestContract', result.testContract).ok, true);
    const verdict = evaluate({ testContract: result.testContract, inputDigest: 'a'.repeat(64), builderExecution: 'builder' },
      [], { ref: 'policy', digest: 'b'.repeat(64) }, { requireManaged: true, currentRunId: 'run-1', currentGate: 'V' });
    assert.equal(verdict.verdict, 'blocked', 'a valid projection is not independent source or acceptance evidence');
    assert.ok(verdict.receipt.blocked.some(reason => reason.includes('TEST_DESIGN_ONLY_NOT_EXECUTABLE')));
    const pack = path.join(f.root, 'pack.json');
    fs.writeFileSync(pack, JSON.stringify(result.testPack));
    const validated = spawnSync('python3', [validator, pack, '--project-root', f.root], { encoding: 'utf8' });
    assert.equal(validated.status, 0, validated.stderr);
    assert.match(validated.stdout, /PACK_STRUCTURE_VALID/);
  } finally { f.dispose(); }
});

test('manual intent is retained in the design contract but is not an acceptance claim', () => {
  const f=fixture();
  try {
    const config={...f.config,checks:[{...f.config.checks[0],mode:'manual'}]};
    const result=compileDomainCases({projectRoot:f.root,caseFile:'cases.md',config});
    assert.equal(result.testContract.requiredChecks[0].mode,'manual');
    assert.equal(result.testContract.sourceReadiness,'design_only');
    assert.equal(result.managedClosureEligible,false);
    assert.equal(parseContract('SDD.Delivery.TestContract',result.testContract).ok,true);
    assert.throws(()=>compileDomainCases({projectRoot:f.root,caseFile:'cases.md',
      config:{...f.config,checks:[{...f.config.checks[0],mode:'unknown'}]}}),/invalid check mode/);
  } finally { f.dispose(); }
});

test('a Markdown projection requires an explicit supported format version', () => {
  const f = fixture();
  try {
    const file = path.join(f.root, 'cases.md'), original = fs.readFileSync(file, 'utf8');
    for (const replacement of ['', '<!-- domain-cases/v2 -->']) {
      fs.writeFileSync(file, original.replace('<!-- domain-cases/v1 -->', replacement));
      assert.throws(() => compileDomainCases({ projectRoot: f.root, caseFile: 'cases.md', config: f.config }), /format.*version/i);
    }
  } finally { f.dispose(); }
});

test('multiple acceptance IDs are rejected rather than silently packed into v1', () => {
  const f = fixture();
  try {
    const file = path.join(f.root, 'cases.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Acceptance**: AC-1', 'Acceptance**: AC-1, AC-2'));
    assert.throws(() => compileDomainCases({ projectRoot: f.root, caseFile: 'cases.md', config: f.config }), /acceptance.*single/i);
  } finally { f.dispose(); }
});

test('unknown requirement, oracle basis and dimensions cannot produce a projection', () => {
  const f = fixture();
  try {
    const file = path.join(f.root, 'cases.md');
    const valid = fs.readFileSync(file, 'utf8');
    for (const [before, after] of [
      ['Requirement IDs**: REQ-1', 'Requirement IDs**: REQ-MISSING'],
      ['Oracle basis**: REQ-1', 'Oracle basis**: REQ-MISSING'],
      ['Dimensions**: Journey-A', 'Dimensions**: Journey-Z'],
    ]) {
      fs.writeFileSync(file, valid.replace(before, after));
      assert.throws(() => compileDomainCases({ projectRoot: f.root, caseFile: 'cases.md', config: f.config }), /DOMAIN_CASES_INVALID/);
    }
  } finally { f.dispose(); }
});

test('unrecognized configuration is rejected instead of silently discarded', () => {
  const f = fixture();
  try {
    const compile = config => compileDomainCases({ projectRoot: f.root, caseFile: 'cases.md', config });
    assert.throws(() => compile({ ...f.config, required: false }), /DOMAIN_CASES_INVALID/);
    assert.throws(() => compile({ ...f.config, checks: [{ ...f.config.checks[0], mandatory: false }] }), /DOMAIN_CASES_INVALID/);
    assert.throws(() => compile({ ...f.config, basis: [{ ...f.config.basis[0], sha256: 'unverified' }, f.config.basis[1]] }), /DOMAIN_CASES_INVALID/);
  } finally { f.dispose(); }
});

test('the design basis is required and must resolve to an actual source', () => {
  const f = fixture();
  try {
    fs.linkSync(path.join(f.root, 'cases.md'), path.join(f.root, 'hardlinked-design.md'));
    for (const config of [
      { ...f.config, basis: [f.config.basis[0]] },
      { ...f.config, design_basis_id: 'REQ-1' },
      { ...f.config, design_basis_id: 'MISSING' },
      { ...f.config, basis: [f.config.basis[0], { id: 'DESIGN-1', kind: 'source', path: 'cases.md' }] },
      { ...f.config, basis: [f.config.basis[0], { id: 'DESIGN-1', kind: 'source', path: 'requirements.md' }] },
      { ...f.config, basis: [f.config.basis[0], { id: 'DESIGN-1', kind: 'source', path: 'hardlinked-design.md' }] },
    ]) {
      assert.throws(() => compileDomainCases({ projectRoot: f.root, caseFile: 'cases.md', config }), /DOMAIN_CASES_INVALID/);
    }
  } finally { f.dispose(); }
});

test('a Markdown-projected TestContract cannot omit its source readiness', () => {
  const f = fixture();
  try {
    const contract = compileDomainCases({ projectRoot: f.root, caseFile: 'cases.md', config: f.config }).testContract;
    delete contract.sourceReadiness;
    assert.equal(parseContract('SDD.Delivery.TestContract', contract).ok, false);
    contract.sourceReadiness = null;
    assert.equal(parseContract('SDD.Delivery.TestContract', contract).ok, false);
    contract.sourceReadiness = 'ready_for_acceptance';
    assert.equal(parseContract('SDD.Delivery.TestContract', contract).ok, false, 'a JSON edit cannot upgrade an unqualified Markdown source');
  } finally { f.dispose(); }
});

test('dimensions and requirement coverage must agree with the projected cases', () => {
  const f = fixture();
  try {
    const compile = config => compileDomainCases({ projectRoot: f.root, caseFile: 'cases.md', config });
    assert.throws(() => compile({ ...f.config, dimensions: { ...f.config.dimensions,
      'Journey-A': { ...f.config.dimensions['Journey-A'], required: false } } }), /DOMAIN_CASES_INVALID/);
    assert.throws(() => compile({ ...f.config, dimensions: { ...f.config.dimensions,
      'Journey-B': { ...f.config.dimensions['Journey-B'], basis_ids: ['NOT-A-BASIS'] } } }), /DOMAIN_CASES_INVALID/);
    assert.throws(() => compile({ ...f.config, basis: [...f.config.basis,
      { id: 'REQ-2', kind: 'requirement', path: 'requirements.md' }] }), /DOMAIN_CASES_INVALID/);
  } finally { f.dispose(); }
});

test('case references cannot escape the trusted project, even through a symlink', () => {
  const f = fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'domain-cases-outside-'));
  try {
    fs.writeFileSync(path.join(outside, 'outside.md'), '# external');
    fs.symlinkSync(path.join(outside, 'outside.md'), path.join(f.root, 'linked.md'));
    for (const file of ['../outside.md', 'linked.md', path.join(outside, 'outside.md')]) {
      assert.throws(() => compileDomainCases({ projectRoot: f.root, caseFile: file, config: f.config }), /DOMAIN_CASES_INVALID/);
    }
  } finally { f.dispose(); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('duplicate case IDs and unsupported case content are rejected', () => {
  const f = fixture();
  try {
    const file = path.join(f.root, 'cases.md'), original = fs.readFileSync(file, 'utf8');
    for (const invalid of [original + '\n### TC-READ-1 — Again\n', original + '- **Unparsed rule**: must fail\n',
      original.replace('# Domain cases\n', '# Domain cases\nAll cases inherit an unparsed rule.\n')]) {
      fs.writeFileSync(file, invalid);
      assert.throws(() => compileDomainCases({ projectRoot: f.root, caseFile: 'cases.md', config: f.config }), /DOMAIN_CASES_INVALID/);
    }
  } finally { f.dispose(); }
});

test('a frozen projection becomes stale after case, requirement, design or check changes', () => {
  const f = fixture();
  try {
    const input = { projectRoot: f.root, caseFile: 'cases.md', config: f.config };
    const projection = compileDomainCases(input);
    assert.equal(verifyDomainCaseProjection({ ...input, projection }).ok, true);
    for (const filename of ['cases.md', 'requirements.md', 'design.md']) {
      const file = path.join(f.root, filename), before = fs.readFileSync(file, 'utf8');
      fs.writeFileSync(file, before.replace('returned', 'returned only to the permitted user') + '\n');
      assert.equal(verifyDomainCaseProjection({ ...input, projection }).ok, false, filename);
      fs.writeFileSync(file, before);
    }
    const config = { ...f.config, checks: [{ ...f.config.checks[0], command: 'node --test different.test.js' }] };
    assert.equal(verifyDomainCaseProjection({ ...input, config, projection }).ok, false);
    assert.equal(verifyDomainCaseProjection({ ...input, projection }).managedClosureEligible, false);
  } finally { f.dispose(); }
});

test('the Comet contract binds the complete TestPack, including dimension decisions', () => {
  const f = fixture();
  try {
    const input = { projectRoot: f.root, caseFile: 'cases.md', config: f.config };
    const before = compileDomainCases(input);
    const config = { ...f.config, dimensions: { ...f.config.dimensions,
      'Journey-B': { ...f.config.dimensions['Journey-B'], reason: 'A newly reviewed applicability decision' } } };
    const after = compileDomainCases({ ...input, config });
    assert.notDeepEqual(before.testContract, after.testContract);
  } finally { f.dispose(); }
});

test('a shared Markdown section is expanded into the case and binds its source bytes', () => {
  const f = fixture();
  try {
    const file = path.join(f.root, 'cases.md');
    fs.writeFileSync(path.join(f.root, 'common.md'), '## common-setup\n- **Precondition**: Tenant is active\n');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('- **Precondition**:', '- **Inherit**: common.md#common-setup\n- **Precondition**:'));
    const input = { projectRoot: f.root, caseFile: 'cases.md', config: f.config };
    const projection = compileDomainCases(input);
    assert.deepEqual(projection.testPack.cases[0].preconditions, ['Tenant is active', 'User is permitted']);
    assert.ok(projection.testPack.basis.some(b => b.path === 'common.md'));
    fs.writeFileSync(path.join(f.root, 'common.md'), '## common-setup\n- **Precondition**: Tenant is suspended\n');
    assert.equal(verifyDomainCaseProjection({ ...input, projection }).ok, false);
  } finally { f.dispose(); }
});

test('cyclic, ambiguous and escaping shared references are refused', () => {
  const f = fixture();
  try {
    const file = path.join(f.root, 'cases.md');
    const source = fs.readFileSync(file, 'utf8').replace('- **Precondition**:', '- **Inherit**: common.md#setup\n- **Precondition**:');
    fs.writeFileSync(file, source);
    for (const shared of [
      '## setup\n- **Inherit**: common.md#setup\n',
      '## setup\n- **Precondition**: One\n## setup\n- **Precondition**: Two\n',
      '## setup\n- **Inherit**: ../outside.md#setup\n',
    ]) {
      fs.writeFileSync(path.join(f.root, 'common.md'), shared);
      assert.throws(() => compileDomainCases({ projectRoot: f.root, caseFile: 'cases.md', config: f.config }), /DOMAIN_CASES_INVALID/);
    }
  } finally { f.dispose(); }
});

test('internal CLI emits a deterministic projection and detects source drift', () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.root, 'config.json'), JSON.stringify(f.config));
    const args = [cli, '--project', f.root, '--cases', 'cases.md', '--config', 'config.json'];
    const run = extra => spawnSync(process.execPath, [...args, ...(extra ?? [])], { encoding: 'utf8' });
    const first = run(), second = run();
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, second.stdout, 'projection serialization must be reproducible');
    const projection = JSON.parse(first.stdout);
    assert.equal(projection.managedClosureEligible, false);
    assert.ok(projection.testPack.basis.some(item => item.path === 'config.json'));
    fs.writeFileSync(path.join(f.root, 'projection.json'), first.stdout);
    assert.equal(run(['--verify', 'projection.json']).status, 0);
    const frozenPack = run(['--verify', 'projection.json', '--view', 'testpack']);
    assert.equal(frozenPack.status, 0, frozenPack.stderr);
    assert.equal(JSON.parse(frozenPack.stdout).schema_version, 'test-authoring/v1');
    fs.appendFileSync(path.join(f.root, 'requirements.md'), '\nChanged requirement.\n');
    const stale = run(['--verify', 'projection.json']);
    assert.equal(stale.status, 2);
    assert.equal(JSON.parse(stale.stdout).ok, false);
    assert.equal(run(['--verify', 'projection.json', '--view', 'testpack']).status, 2);
  } finally { f.dispose(); }
});

test('internal CLI can emit existing TestPack and TestContract views without advancing a gate', () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.root, 'config.json'), JSON.stringify(f.config));
    const args = [cli, '--project', f.root, '--cases', 'cases.md', '--config', 'config.json'];
    const run = view => spawnSync(process.execPath, [...args, '--view', view], { encoding: 'utf8' });
    const pack = run('testpack'), contract = run('contract');
    assert.equal(pack.status, 0, pack.stderr); assert.equal(contract.status, 0, contract.stderr);
    assert.equal(JSON.parse(pack.stdout).schema_version, 'test-authoring/v1');
    assert.equal(parseContract('SDD.Delivery.TestContract', JSON.parse(contract.stdout)).ok, true);
    assert.equal(run('unknown').status, 1);
  } finally { f.dispose(); }
});

test('internal CLI refuses duplicate configuration keys', () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.root, 'config.json'), '{"mode":"design","mode":"automate","basis":[]}');
    const run = spawnSync(process.execPath, [cli, '--project', f.root, '--cases', 'cases.md', '--config', 'config.json'], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(JSON.parse(run.stderr).message, /duplicate JSON key/);
  } finally { f.dispose(); }
});

test('unverified self-reported logs cannot declare an automated package ready', () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.root, 'read.test.js'), 'test fixture');
    fs.writeFileSync(path.join(f.root, 'author.log'), 'fabricated successful run');
    fs.appendFileSync(path.join(f.root, 'cases.md'), '- **Automation path**: read.test.js\n- **Automation test ID**: read-item-test\n- **Automation command**: ["node","--test","read.test.js"]\n');
    const config = { ...f.config, mode: 'automate', self_checks: [{ command: ['node', '--test', 'read.test.js'],
      exit_code: 0, expected: 'pass', log_path: 'author.log' }] };
    assert.throws(() => compileDomainCases({ projectRoot: f.root, caseFile: 'cases.md', config }), /SELF_CHECK_SOURCE_UNQUALIFIED/);
  } finally { f.dispose(); }
});

test('automation metadata is projected from Markdown without claiming execution or readiness',()=>{
  const f=fixture();
  try {
    const file=path.join(f.root,'cases.md'),testFile=path.join(f.root,'read.test.js');
    fs.writeFileSync(testFile,"test('read-item-test',()=>{});\n");
    fs.appendFileSync(file,'- **Automation path**: read.test.js\n- **Automation test ID**: read-item-test\n- **Automation command**: ["node","--test","read.test.js"]\n');
    const projection=compileDomainCases({projectRoot:f.root,caseFile:'cases.md',config:f.config});
    assert.equal(projection.testPack.status,'design_only');assert.equal(projection.testPack.cases[0].automation,null);
    assert.equal(projection.automationCandidate.scope,'unqualified-automation-map');
    assert.deepEqual(projection.automationCandidate.entries,[{caseId:'TC-READ-1',path:'read.test.js',sha256:hash(fs.readFileSync(testFile)),testId:'read-item-test',command:['node','--test','read.test.js'],checkIds:['read-item']}]);
    assert.equal(projection.managedClosureEligible,false);
    const pack=path.join(f.root,'pack.json');fs.writeFileSync(pack,JSON.stringify(projection.testPack));
    const validated=spawnSync('python3',[validator,pack,'--project-root',f.root],{encoding:'utf8'});assert.equal(validated.status,0,validated.stderr);
    fs.appendFileSync(testFile,'// changed\n');assert.equal(verifyDomainCaseProjection({projection,projectRoot:f.root,caseFile:'cases.md',config:f.config}).ok,false);
  } finally { f.dispose(); }
});

test('incomplete or inconsistent Markdown automation mappings are refused',()=>{
  const f=fixture();
  try {
    const file=path.join(f.root,'cases.md'),before=fs.readFileSync(file,'utf8');fs.writeFileSync(path.join(f.root,'read.test.js'),'test fixture');
    for(const fields of [
      '- **Automation path**: read.test.js\n',
      '- **Automation path**: missing.test.js\n- **Automation test ID**: test-id\n- **Automation command**: ["node","--test","missing.test.js"]\n',
      '- **Automation path**: read.test.js\n- **Automation test ID**: test-id\n- **Automation command**: ["node","--test","other.test.js"]\n',
    ]) {fs.writeFileSync(file,before+fields);assert.throws(()=>compileDomainCases({projectRoot:f.root,caseFile:'cases.md',config:f.config}),/DOMAIN_CASES_INVALID/);}
    fs.writeFileSync(file,before+'- **Automation path**: read.test.js\n- **Automation test ID**: test-id\n- **Automation command**: ["UNREGISTERED_OVERRIDE=1","/usr/bin/printf","hello"]\n');
    const ambiguous={...f.config,checks:[{...f.config.checks[0],command:'UNREGISTERED_OVERRIDE=1 /usr/bin/printf hello'}]};
    assert.throws(()=>compileDomainCases({projectRoot:f.root,caseFile:'cases.md',config:ambiguous}),/DOMAIN_CASES_INVALID/);
    fs.writeFileSync(file,before+'- **Automation path**: read.test.js\n- **Automation test ID**: test-id\n- **Automation command**: ["node","--test","other.test.js"]\n');
    const wrongSource={...f.config,checks:[{...f.config.checks[0],command:'node --test other.test.js'}]};
    assert.throws(()=>compileDomainCases({projectRoot:f.root,caseFile:'cases.md',config:wrongSource}),/DOMAIN_CASES_INVALID/);
  } finally { f.dispose(); }
});

test('unresolved design remains a valid design-only pack but cannot generate a runnable contract', () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.root, 'cases.md'), '<!-- domain-cases/v1 -->\n# Domain cases\n');
    const config = { ...f.config, unresolved: [{ requirement_ids: ['REQ-1'], question: 'Which identity is permitted?' }] };
    const result = compileDomainCases({ projectRoot: f.root, caseFile: 'cases.md', config });
    assert.equal(result.testPack.cases.length, 0);
    assert.equal(result.testContract, null);
    assert.equal(result.testPack.unresolved[0].question, 'Which identity is permitted?');
    const file = path.join(f.root, 'pack.json'); fs.writeFileSync(file, JSON.stringify(result.testPack));
    const validated = spawnSync('python3', [validator, file, '--project-root', f.root], { encoding: 'utf8' });
    assert.equal(validated.status, 0, validated.stderr);
    assert.throws(() => compileDomainCases({ projectRoot: f.root, caseFile: 'cases.md', config: { ...config, mode: 'automate' } }), /DOMAIN_CASES_INVALID/);
  } finally { f.dispose(); }
});
