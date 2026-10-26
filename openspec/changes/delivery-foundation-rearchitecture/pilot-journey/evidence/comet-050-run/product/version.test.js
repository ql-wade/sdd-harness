import crypto from 'node:crypto';
// add-journey-version acceptance suite (authored at the T stage; RED before
// implementation). Oracles are behavioral: real spawns, real exit codes, real
// captured stdout/stderr, real filesystem snapshots.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tool = path.join(projectRoot, 'tools/verify/delivery-journey.mjs');
const nodeBin = process.execPath;

// Every spawn runs in a throwaway cwd with its own TMPDIR; NODE_TEST_CONTEXT
// is stripped so the tool behaves exactly as a standalone invocation.
function runTool(args, { cwd } = {}) {
  const workdir = cwd ?? fs.mkdtempSync(path.join(os.tmpdir(), 'p32-version-case-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p32-version-tmp-'));
  const env = { ...process.env, TMPDIR: tmp };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(nodeBin, [tool, ...args], { cwd: workdir, encoding: 'utf8', timeout: 60_000, env });
  return { run, workdir, tmp };
}
const snapshot = (dir) => {
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      out.push(child);
      if (entry.isDirectory()) walk(child);
    }
  };
  walk('');
  return out.join('\n');
};

test('c1 (AC1+AC2): --version alone exits 0 printing exactly 0.1.0 with zero filesystem side effects', () => {
  const { run, workdir, tmp } = runTool(['--version']);
  assert.equal(run.status, 0, `exit must be 0, got ${run.status}\nstderr: ${run.stderr}`);
  assert.equal(run.stdout, '0.1.0\n', `stdout must be exactly the version line, got ${JSON.stringify(run.stdout)}`);
  assert.equal(run.stderr, '', `stderr must stay silent on the version path (D4 nothing-else), got ${JSON.stringify((run.stderr || '').slice(0, 120))}`);
  // pinned filesystem oracle: cwd and TMPDIR listings byte-identical before/after
  assert.equal(snapshot(workdir), '', 'cwd started empty');
  assert.equal(snapshot(tmp), '', 'TMPDIR stayed empty (no side-effect writes)');
  assert.equal(fs.readdirSync(workdir).length, 0, 'no files created in cwd');
});

test('c2 (AC3): a known option after --version does not change the outcome', () => {
  const { run } = runTool(['--version', '--json']);
  assert.equal(run.status, 0);
  assert.equal(run.stdout, '0.1.0\n');
  assert.equal(run.stderr, '', 'stderr stays silent (D4)');
});

test('c3a (AC3): an unknown option BEFORE --version still yields the version (order independence)', () => {
  const { run } = runTool(['--definitely-not-a-flag', '--version']);
  assert.equal(run.status, 0, `unknown-before-version must still exit 0, got ${run.status}\nstderr: ${run.stderr}`);
  assert.equal(run.stdout, '0.1.0\n');
  assert.equal(run.stderr, '', 'stderr stays silent even with an unknown option present (D4)');
});

test('c1b (AC2): an explicitly passed evidence dir is never created by the version path', () => {
  const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'p32-version-c1b-'));
  fs.rmdirSync(evidence);
  const { run } = runTool(['--version', '--evidence-dir', evidence]);
  assert.equal(run.status, 0);
  assert.equal(run.stdout, '0.1.0\n');
  assert.equal(run.stderr, '', 'stderr stays silent with an explicit evidence dir (D4)');
  assert.equal(fs.existsSync(evidence), false, 'the version path must not create the evidence directory');
});

test('c5 (AC4): the pre-existing NOT-EXERCISED exit-2 entrance is preserved verbatim', () => {
  const plan = path.join(os.tmpdir(), `p32-synth-plan-${process.pid}.json`);
  fs.writeFileSync(plan, '{"schema_version":1,"status":"probe","cases":{}}\n');
  const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'p32-version-c5-'));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(nodeBin, [tool, '--scenario', 'Z99', '--profile', 'comet-managed-v2', '--evidence-dir', evidence, '--case-plan', plan], { cwd: projectRoot, encoding: 'utf8', timeout: 60_000, env });
  assert.equal(run.status, 2, `the unregistered-scenario entrance must stay exit 2, got ${run.status}`);
  assert.equal(run.stderr, '', 'the non-JSON NOT-EXERCISED line is stdout, stderr stays empty');
  assert.match(run.stdout, /NOT-EXERCISED \(scenario-not-registered-in-case-plan\) exit=2/, 'the refusal verdict is on stdout');
});

test('c3b (AC3): near-miss tokens never trigger the version path (exact-token matching)', () => {
  const { run } = runTool(['--version-extra']);
  assert.equal(run.status, 1, `--version-extra alone must stay INVALID_INPUT exit 1, got ${run.status}`);
  assert.match(run.stderr, /Unknown option '--version-extra'/);
});

test('c4a (AC4): no arguments remains the exact invalid-input exit 1', () => {
  const { run } = runTool([]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /--scenario \(or --journey\), --profile and --evidence-dir are required/);
});

test('c4b (AC4): mutually exclusive journey+scenario remains the exact invalid-input exit 1', () => {
  const { run } = runTool(['--journey', 'same-run-delivery', '--scenario', 'A01']);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /--journey and --scenario are mutually exclusive/);
});

test('c4c (AC4): the full-invocation input-contract shape is unchanged (live-observed on this copy)', () => {
  const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'p32-version-ev-'));
  const { run } = runTool(['--scenario', 'A01', '--profile', 'comet-managed-v2', '--evidence-dir', evidence]);
  assert.equal(run.status, 1, 'on the pilot copy (no case plan present) the entrance stays invalid-input exit 1');
  assert.match(run.stderr, /case-plan-unreadable/);
});

test('c6 (AC4): a minimal REAL journey execution still exits 0 (direct exit-0 preservation)', () => {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'p32-version-c6-'));
  const planFile = path.join(stage, 'plan.json');
  const defFile = path.join(stage, 'def.json');
  const contractFile = path.join(stage, 'pilot-contract.md');
  fs.writeFileSync(planFile, '{"schema_version":1,"status":"probe","cases":{"T01":{"case_module":"test/trivial-ok.test.js","required_assertions":["T01"]}}}\n');
  fs.writeFileSync(defFile, JSON.stringify({
    schemaVersion: 1, scenario: 'T01', acceptanceIds: ['T01'], requiredAssertions: ['T01'],
    caseModule: 'test/trivial-ok.test.js',
    actions: [{ type: 'spawn', command: 'node --test test/trivial-ok.test.js', expected: 'exit 0; T01 ok', expect: { kind: 'exitCode', value: 0 } }],
    evidence: { artifacts: ['case-definition.json', 'action-1-stdout.txt', 'action-1-stderr.txt', 'verdict.json'] },
    verdictSemantics: { PASS: 'actions executed and outcomes met', FAIL: 'contradicted', 'NOT-EXERCISED': 'prerequisite missing', 'NOT-APPLICABLE': 'out of scope' },
  }, null, 1));
  const artifactRel = {
    product: 'tools/verify/delivery-journey.mjs',
    design: 'openspec/changes/add-journey-version/design.md',
    testContract: 'openspec/changes/add-journey-version/test-intent.md',
    planBundle: 'openspec/changes/add-journey-version/tasks.md',
  };
  const shaFile = (rel) => hashlib_wrap(projectRoot, rel);
  const frozen = {};
  for (const [kind, rel] of Object.entries(artifactRel)) frozen[kind] = { path: rel, sha256: kind === 'planBundle' ? shaTaskNorm(projectRoot, rel) : shaFile(rel) };
  const contract = { profile: 'comet-managed-v2', frozenArtifacts: frozen, negativeAc: { ui: ['ui-neg-1'], api: ['api-neg-1'], persistence: ['per-neg-1'], permissions: ['prm-neg-1'] } };
  fs.writeFileSync(contractFile, '# synthetic pilot contract\n\n```pilot-contract\n' + JSON.stringify(contract, null, 1) + '\n```\n');
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(nodeBin, [tool, '--scenario', 'T01', '--profile', 'comet-managed-v2', '--evidence-dir', path.join(stage, 'ev'), '--case-plan', planFile, '--case-definition', defFile, '--pilot-contract', contractFile], { cwd: projectRoot, encoding: 'utf8', timeout: 120_000, env });
  assert.equal(run.status, 0, `the direct exit-0 journey path must be preserved, got ${run.status}: ${(run.stdout || '') + (run.stderr || '')}`.slice(0, 400));
  assert.match(run.stdout, /PASS \(expected outcomes met\) exit=0/);
});
function hashlib_wrap(root, rel) { return crypto.createHash('sha256').update((root + '/' + rel && fs.readFileSync(path.join(root, rel)))).digest('hex'); }
function shaTaskNorm(root, rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const norm = src.replace(/^(\s*[-*]\s+\[)[ xX](\])/gm, '$1 $2');
  return crypto.createHash('sha256').update(norm).digest('hex');
}

test('c7 (AC1+AC4, code-review r1): the version path follows the CALLER argv, not the host process.argv', async () => {
  const { runDeliveryJourney } = await import(path.join(projectRoot, 'tools/verify/delivery-journey.mjs'));
  // programmatic args carry the token -> version output, exit 0
  const out = [];
  const realLog = console.log;
  console.log = (...xs) => out.push(xs.join(' '));
  try {
    const rc = await runDeliveryJourney({ args: ['--version'] });
    assert.equal(rc, 0, `programmatic --version must exit 0, got ${rc}`);
  } finally { console.log = realLog; }
  assert.equal(out.join('\n'), '0.1.0', 'exactly the version line');
  // host argv containing --version must NOT leak into a call with different args
  const realArgv = process.argv;
  process.argv = [process.argv[0], 'host', '--version'];
  const errs = [];
  const realErr = console.error;
  console.error = (...xs) => errs.push(xs.join(' '));
  let rc2;
  try {
    rc2 = await runDeliveryJourney({ args: [] });
  } finally {
    process.argv = realArgv;
    console.error = realErr;
  }
  assert.equal(rc2, 1, 'a host --version token must not change a caller invocation without it (AC4)');
  assert.match(errs.join('\n'), /--scenario \(or --journey\), --profile and --evidence-dir are required/);
});
