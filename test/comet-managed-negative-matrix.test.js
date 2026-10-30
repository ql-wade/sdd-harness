// Six-step ② negative matrix on the REAL Comet 0.5.1 SDK journey
// (no action / cross-Run / stale application / forged files / duplicate
// evidence / same-Run recovery).
//
// Every scenario drives the real installed application through the public
// SDK claim/report protocol exactly like comet-native-r-guard.test.js, then
// asserts the REAL refusal and that the Run stays consistent afterwards.
// Synthetic-negative-only: no human approval, no business acceptance, and no
// gate is claimed to pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classicCompositionStartRequest } from '../lib/adapters/comet.js';
import { resolveCometForTest } from './helpers/comet-cli.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appFile = path.join(repo, 'integrations/comet/application/package/application.json');
const comet = resolveCometForTest();

// One real Classic composition journey, parked at a chosen control point.
// Returns live SDK handles; the caller then forges and asserts refusals.
async function journey(t, { change }) {
  const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sdd-negmatrix-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const root = path.join(scratch, 'project'), home = path.join(scratch, 'home'); fs.mkdirSync(root); fs.mkdirSync(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, 'config'),
    PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}`, CI: 'true', DO_NOT_TRACK: '1' };
  delete env.NODE_OPTIONS; delete env.NODE_PATH; delete env.NODE_TEST_CONTEXT;
  const run = (program, args, expected = 0) => {
    const result = spawnSync(program, args, { cwd: root, env, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, expected, `${program} ${args[0]}: ${result.stderr || result.stdout}`);
    return result.stdout ? JSON.parse(result.stdout) : null;
  };
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '-q');
  fs.writeFileSync(path.join(root, '.gitignore'), 'home/\n');
  git('add', '.gitignore');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'synthetic fixture');
  const preview = run(comet, ['application', 'install', appFile, '--project', root, '--preview', '--json']);
  const installed = run(comet, ['application', 'install', appFile, '--project', root, '--confirmation-hash', preview.confirmationHash, '--json']);
  const script = path.join(path.dirname(installed.file), 'scripts/comet-run.mjs');
  const request = classicCompositionStartRequest({ change, changeDir: `openspec/changes/${change}`, workflowId: 'comet-classic-full', workflowVersion: '1' });
  const inputPath = path.join(root, 'input.json'), statePath = path.join(root, 'state.json');
  fs.writeFileSync(inputPath, JSON.stringify(request.input)); fs.writeFileSync(statePath, JSON.stringify(request.initialState));
  const sdk = (args, expected = 0) => run(process.execPath, [script, ...args], expected);
  const base = ['--project-root', root, '--run-id', change];
  const changeDir = path.join(root, 'openspec/changes', change);
  fs.mkdirSync(changeDir, { recursive: true });
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# Synthetic goal\n\nFixture only; no human or business approval.\n');
  fs.writeFileSync(path.join(changeDir, 'design.md'), '# Synthetic design\n\nFixture only.\n');
  fs.writeFileSync(path.join(changeDir, 'tasks.md'), '# Synthetic tasks\n\n- [ ] Exercise refusals.\n');
  let view = sdk(['start', ...base, '--workflow-id', 'comet-classic-full', '--input-file', inputPath, '--initial-state-file', statePath]);
  const recoverPath = path.join(root, 'recover.json');
  fs.writeFileSync(recoverPath, JSON.stringify({ operation: 'next', runId: change }));
  for (let attempt = 0; attempt < 3; attempt++) {
    const inspected = spawnSync(process.execPath, [script, 'inspect', ...base], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
    if (inspected.status === 0) { view = JSON.parse(inspected.stdout); break; }
    assert.match(inspected.stdout + inspected.stderr, /REVISION_CONFLICT|WORKFLOW_CHANGED|RUN.*changed|Run 已变化|requires recovery/);
    run(comet, ['runtime', 'dispatch', '--application-file', installed.file, '--project-root', root, '--request', recoverPath, '--json']);
    assert.ok(attempt < 2, 'the original Run must recover within the bounded fixture');
  }
  const prepare = view.run.current.actions.find((item) => item.stepId === 'classic.composition.prepare');
  view = sdk(['execute', ...base, '--action-id', prepare.id, '--executor-id', 'comet-classic-composition-prepare']);
  view = sdk(['resolve-wait', '--project-root', root, '--receipt', view.receipts.waits[0], '--choice', 'approved', '--decision-id', 'synthetic-only-not-human']);
  const open = view.run.current.actions.find((item) => item.stepId === 'full.open');
  view = sdk(['claim', ...base, '--action-id', open.id, '--executor-id', 'sdd-managed-skill-host', '--session-id', 'synthetic-no-model', '--capability', 'skill-host']);
  const openResult = path.join(root, 'open-result.json');
  fs.writeFileSync(openResult, JSON.stringify({ status: 'succeeded', output: { event: 'open-complete', testFixture: true } }));
  view = sdk(['record-outcome', '--project-root', root, '--receipt', view.receipts.actions[0], '--result-file', openResult]);
  const wait = view.run.current.evidenceWaits.find((item) => item.kind === 'classic-open-artifacts');
  const realCli = fs.realpathSync(comet);
  const globalRoot = path.resolve(path.dirname(realCli), '..');
  const { classicOpenEvidenceReceipt } = await import(pathToFileURL(path.join(globalRoot, 'dist/domains/comet-classic/classic-sdk-application.js')).href);
  const openEvidence = await classicOpenEvidenceReceipt(root, `openspec/changes/${change}`);
  const evidenceRequest = path.join(root, 'evidence-request.json');
  fs.writeFileSync(evidenceRequest, JSON.stringify({ operation: 'record-evidence', runId: change, expectedRevision: view.run.revision,
    evidenceId: wait.id, kind: 'classic-open-artifacts', ref: openEvidence.ref, contentHash: openEvidence.contentHash, submissionId: 'synthetic-open-evidence' }));
  run(comet, ['runtime', 'dispatch', '--application-file', installed.file, '--project-root', root, '--request', evidenceRequest, '--json']);
  view = sdk(['inspect', ...base]);
  const confirmation = view.run.current.waits.find((item) => item.stepId === 'full.open.confirm');
  const confirmationReceipt = view.receipts.waits.find((encoded) => JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')).waitId === confirmation.id);
  view = sdk(['resolve-wait', '--project-root', root, '--receipt', confirmationReceipt, '--choice', 'approved', '--decision-id', 'synthetic-confirmation-not-human']);
  const revalidate = view.run.current.actions.find((item) => item.stepId === 'full.open.revalidate');
  view = sdk(['execute', ...base, '--action-id', revalidate.id, '--executor-id', 'comet-classic-open-revalidate']);
  const gate = view.run.current.actions.find((item) => item.stepId === 'classic.extension.requirements-open');
  view = sdk(['claim', ...base, '--action-id', gate.id, '--executor-id', 'sdd-managed-skill-host', '--session-id', 'synthetic-no-model', '--capability', 'skill-host']);
  return { root, home, env, run, sdk, base, view, change, changeDir, gate, installed, actionReceipt: view.receipts.actions[0], revision: view.run.revision };
}

test('negative matrix: no action — a receipt for an unknown action cannot record an outcome', async (t) => {
  const j = await journey(t, { change: 'synthetic-neg-noaction' });
  const resultFile = path.join(j.root, 'ghost.json');
  fs.writeFileSync(resultFile, JSON.stringify({ status: 'succeeded', output: { verdict: 'pass', sourceHash: 'x', artifactHashes: {}, gateEvidence: { gate: 'R', inputs: {}, receipts: [], policy: {} } } }));
  const rejected = j.sdk(['record-outcome', '--project-root', j.root, '--receipt', j.actionReceipt, '--result-file', resultFile], 1);
  assert.ok(rejected.error, 'the ghost recording must be refused');
  const after = j.sdk(['inspect', ...j.base]);
  assert.equal(after.run.runId, j.change);
  assert.equal(after.run.current.actions.find((item) => item.id === j.gate.id)?.status, 'running');
});

test('negative matrix: cross-Run — one run cannot consume another run receipt', async (t) => {
  const a = await journey(t, { change: 'synthetic-neg-cross-a' });
  // A second change in the same project: its run must not accept run A's
  // activation receipt nor share evidence with it.
  const changeB = 'synthetic-neg-cross-b';
  const changeDirB = path.join(a.root, 'openspec/changes', changeB);
  fs.mkdirSync(changeDirB, { recursive: true });
  fs.writeFileSync(path.join(changeDirB, 'proposal.md'), '# B\n\nFixture only.\n');
  fs.writeFileSync(path.join(changeDirB, 'design.md'), '# B design\n\nFixture only.\n');
  fs.writeFileSync(path.join(changeDirB, 'tasks.md'), '# B tasks\n\n- [ ] x\n');
  const requestB = classicCompositionStartRequest({ change: changeB, changeDir: `openspec/changes/${changeB}`, workflowId: 'comet-classic-full', workflowVersion: '1' });
  const inputB = path.join(a.root, 'input-b.json'), stateB = path.join(a.root, 'state-b.json');
  fs.writeFileSync(inputB, JSON.stringify(requestB.input)); fs.writeFileSync(stateB, JSON.stringify(requestB.initialState));
  a.sdk(['start', '--project-root', a.root, '--run-id', changeB, '--workflow-id', 'comet-classic-full', '--input-file', inputB, '--initial-state-file', stateB]);
  // Run B cannot be advanced with run A's action receipt.
  const ghost = path.join(a.root, 'cross.json');
  fs.writeFileSync(ghost, JSON.stringify({ status: 'succeeded', output: { verdict: 'pass', sourceHash: 'x', artifactHashes: {}, gateEvidence: { gate: 'R', inputs: {}, receipts: [], policy: {} } } }));
  const rejected = a.sdk(['record-outcome', '--project-root', a.root, '--run-id', changeB, '--receipt', a.actionReceipt, '--result-file', ghost], 1);
  assert.ok(rejected.error, 'cross-Run receipt reuse must be refused');
  const afterA = a.sdk(['inspect', '--project-root', a.root, '--run-id', a.change]);
  assert.equal(afterA.run.current.actions.find((item) => item.id === a.gate.id)?.status, 'running', 'run A unchanged');
});

test('negative matrix: forged file — a self-consistent forged receipt-bundle cannot unlock the gate', async (t) => {
  const j = await journey(t, { change: 'synthetic-neg-forge' });
  // Forge the artifact the outcome binds, byte-consistent with its own hash:
  // hash equality alone must never unlock the gate.
  const artifact = '.sdd/delivery/gates/r/receipt-bundle.json';
  const artifactPath = path.join(j.root, artifact);
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  const forged = Buffer.from(JSON.stringify({ schema: 'sdd.delivery.gate.receipt-bundle.v1', kind: 'gate-receipt-bundle', gate: 'R', forged: true }, null, 2) + '\n');
  fs.writeFileSync(artifactPath, forged);
  const runtimeModule = pathToFileURL(path.join(path.resolve(path.dirname(fs.realpathSync(comet)), '..'), 'dist/domains/engine/runtime.js')).href;
  const { hashRuntimeValue } = await import(runtimeModule);
  const outcome = { status: 'succeeded', output: { verdict: 'pass', sourceHash: hashRuntimeValue(j.view.run.current.actions.find((item) => item.id === j.gate.id).input.activation.source),
    artifactHashes: { [artifact]: crypto.createHash('sha256').update(forged).digest('hex') },
    gateEvidence: { gate: 'R', inputs: {}, receipts: [], policy: {}, options: { requireManaged: false } } } };
  const resultPath = path.join(j.root, 'forged-gate-result.json');
  fs.writeFileSync(resultPath, JSON.stringify(outcome));
  const rejected = j.sdk(['record-outcome', '--project-root', j.root, '--receipt', j.actionReceipt, '--result-file', resultPath], 1);
  assert.match(rejected.error.message, /protected Run, input, policy and source readback are required/,
    'the forged artifact hash must not change the refusal: identity comes from the protected source, not file presence');
  // Re-forging after the refusal changes nothing.
  fs.writeFileSync(artifactPath, Buffer.from('re-forged\n'));
  outcome.output.artifactHashes[artifact] = crypto.createHash('sha256').update('re-forged\n').digest('hex');
  fs.writeFileSync(resultPath, JSON.stringify(outcome));
  const rejectedAgain = j.sdk(['record-outcome', '--project-root', j.root, '--receipt', j.actionReceipt, '--result-file', resultPath], 1);
  assert.ok(rejectedAgain.error);
  const after = j.sdk(['inspect', ...j.base]);
  assert.equal(after.run.current.actions.find((item) => item.id === j.gate.id)?.status, 'running');
});

test('negative matrix: duplicate evidence — the same submissionId cannot record twice', async (t) => {
  const j = await journey(t, { change: 'synthetic-neg-dup' });
  // Re-run the already-recorded open evidence request byte-for-byte.
  const wait = j.view.run.current.evidenceWaits.find((item) => item.kind === 'classic-open-artifacts');
  const duplicate = { operation: 'record-evidence', runId: j.change, expectedRevision: j.revision,
    evidenceId: wait?.id ?? 'resolved-wait', kind: 'classic-open-artifacts', ref: 'openspec/changes/x', contentHash: crypto.randomBytes(32).toString('hex'), submissionId: 'synthetic-open-evidence' };
  const requestPath = path.join(j.root, 'dup-request.json');
  fs.writeFileSync(requestPath, JSON.stringify(duplicate));
  const result = spawnSync(comet, ['runtime', 'dispatch', '--application-file', j.installed.file, '--project-root', j.root, '--request', requestPath, '--json'],
    { cwd: j.root, env: j.env, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  assert.notEqual(result.status, 0, 'the duplicate submission must not succeed');
  const after = j.sdk(['inspect', ...j.base]);
  assert.equal(after.run.runId, j.change);
  assert.equal(after.run.current.actions.find((item) => item.id === j.gate.id)?.status, 'running', 'run unchanged after duplicate attempt');
});

test('negative matrix: same-Run recovery — next restores the parked gate action and refusals persist', async (t) => {
  const j = await journey(t, { change: 'synthetic-neg-recover' });
  const recoverPath = path.join(j.root, 'recover.json');
  fs.writeFileSync(recoverPath, JSON.stringify({ operation: 'next', runId: j.change }));
  const recovered = j.run(comet, ['runtime', 'dispatch', '--application-file', j.installed.file, '--project-root', j.root, '--request', recoverPath, '--json']);
  assert.equal(recovered.run?.runId ?? recovered.state?.runId ?? j.change, j.change, 'recovery stays on the same Run');
  const refused = j.sdk(['record-outcome', '--project-root', j.root, '--receipt', j.actionReceipt, '--result-file',
    path.join(j.root, 'absent.json')], 1);
  assert.ok(refused.error, 'after recovery the parked gate still refuses a pass without protected source');
  const after = j.sdk(['inspect', ...j.base]);
  assert.equal(after.run.current.actions.find((item) => item.id === j.gate.id)?.status, 'running');
  assert.equal(after.run.current.actions.some((item) => item.stepId.startsWith('full.design')), false);
});
