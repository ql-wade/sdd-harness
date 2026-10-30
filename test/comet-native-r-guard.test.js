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

async function exerciseNativeR(t, changeAfterConfirmation) {
  const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sdd-native-r-'));
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
  const version = spawnSync(comet, ['--version'], { cwd: root, env, encoding: 'utf8', timeout: 10000 });
  assert.equal(version.stdout.trim(), '0.5.1');
  const change = 'synthetic-r-guard';
  const changeDir = path.join(root, 'openspec/changes', change);
  fs.mkdirSync(changeDir, { recursive: true });
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# Synthetic goal\n\nFixture only; no human or business approval.\n');
  fs.writeFileSync(path.join(changeDir, 'design.md'), '# Synthetic design\n\nFixture only.\n');
  fs.writeFileSync(path.join(changeDir, 'tasks.md'), '# Synthetic tasks\n\n- [ ] Exercise source refusal.\n');
  const preview = run(comet, ['application', 'install', appFile, '--project', root, '--preview', '--json']);
  const installed = run(comet, ['application', 'install', appFile, '--project', root, '--confirmation-hash', preview.confirmationHash, '--json']);
  assert.equal(installed.hostIntegration.length, 0, 'no user host entry is installed');
  const script = path.join(path.dirname(installed.file), 'scripts/comet-run.mjs');
  const request = classicCompositionStartRequest({ change, changeDir: `openspec/changes/${change}`, workflowId: 'comet-classic-full', workflowVersion: '1' });
  const inputPath = path.join(root, 'input.json'), statePath = path.join(root, 'state.json');
  fs.writeFileSync(inputPath, JSON.stringify(request.input)); fs.writeFileSync(statePath, JSON.stringify(request.initialState));
  const sdk = (args, expected = 0) => run(process.execPath, [script, ...args], expected);
  const base = ['--project-root', root, '--run-id', change];
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
  assert.ok(prepare);
  view = sdk(['execute', ...base, '--action-id', prepare.id, '--executor-id', 'comet-classic-composition-prepare']);
  assert.equal(view.receipts.waits.length, 1);
  view = sdk(['resolve-wait', '--project-root', root, '--receipt', view.receipts.waits[0], '--choice', 'approved', '--decision-id', 'synthetic-only-not-human']);
  const open = view.run.current.actions.find((item) => item.stepId === 'full.open'); assert.ok(open);
  view = sdk(['claim', ...base, '--action-id', open.id, '--executor-id', 'sdd-managed-skill-host', '--session-id', 'synthetic-no-model', '--capability', 'skill-host']);
  const openResult = path.join(root, 'open-result.json');
  fs.writeFileSync(openResult, JSON.stringify({ status: 'succeeded', output: { event: 'open-complete', testFixture: true } }));
  view = sdk(['record-outcome', '--project-root', root, '--receipt', view.receipts.actions[0], '--result-file', openResult]);
  const wait = view.run.current.evidenceWaits.find((item) => item.kind === 'classic-open-artifacts'); assert.ok(wait);
  const realCli = fs.realpathSync(comet);
  const globalRoot = path.resolve(path.dirname(realCli), '..');
  const classicModule = pathToFileURL(path.join(globalRoot, 'dist/domains/comet-classic/classic-sdk-application.js')).href;
  const { classicOpenEvidenceReceipt } = await import(classicModule);
  const openEvidence = await classicOpenEvidenceReceipt(root, `openspec/changes/${change}`);
  const evidenceRequest = path.join(root, 'evidence-request.json');
  fs.writeFileSync(evidenceRequest, JSON.stringify({ operation: 'record-evidence', runId: change, expectedRevision: view.run.revision,
    evidenceId: wait.id, kind: 'classic-open-artifacts', ref: openEvidence.ref, contentHash: openEvidence.contentHash, submissionId: 'synthetic-open-evidence' }));
  run(comet, ['runtime', 'dispatch', '--application-file', installed.file, '--project-root', root, '--request', evidenceRequest, '--json']);
  view = sdk(['inspect', ...base]);
  assert.equal(view.run.current.actions.some((item) => item.stepId === 'classic.extension.requirements-open'), false,
    'R must not run before the native Open confirmation');
  const confirmation = view.run.current.waits.find((item) => item.stepId === 'full.open.confirm');
  assert.ok(confirmation, 'the original Comet Open confirmation must precede the R gate');
  const confirmationReceipt = view.receipts.waits.find((encoded) => JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')).waitId === confirmation.id);
  assert.ok(confirmationReceipt);
  view = sdk(['resolve-wait', '--project-root', root, '--receipt', confirmationReceipt, '--choice', 'approved', '--decision-id', 'synthetic-confirmation-not-human']);
  if (changeAfterConfirmation) fs.appendFileSync(path.join(changeDir, 'proposal.md'), '\nChanged after confirmation.\n');
  const revalidate = view.run.current.actions.find((item) => item.stepId === 'full.open.revalidate');
  assert.ok(revalidate, 'Comet must revalidate the confirmed artifacts before R');
  view = sdk(['execute', ...base, '--action-id', revalidate.id, '--executor-id', 'comet-classic-open-revalidate']);
  const gate = view.run.current.actions.find((item) => item.stepId === 'classic.extension.requirements-open'); assert.ok(gate);
  view = sdk(['claim', ...base, '--action-id', gate.id, '--executor-id', 'sdd-managed-skill-host', '--session-id', 'synthetic-no-model', '--capability', 'skill-host']);
  const source = view.run.current.actions.find((item) => item.id === gate.id).input.activation.source;
  const runtimeModule = pathToFileURL(path.join(globalRoot, 'dist/domains/engine/runtime.js')).href;
  const { hashRuntimeValue } = await import(runtimeModule);
  const artifact = '.sdd/delivery/gates/r/receipt-bundle.json';
  const artifactPath = path.join(root, artifact); fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  const artifactBytes = Buffer.from('synthetic fixture only\n'); fs.writeFileSync(artifactPath, artifactBytes);
  const outcome = { status: 'succeeded', output: { verdict: 'pass', sourceHash: hashRuntimeValue(source),
    artifactHashes: { [artifact]: crypto.createHash('sha256').update(artifactBytes).digest('hex') },
    gateEvidence: { gate: 'R', inputs: {}, receipts: [], policy: {}, options: { requireManaged: false } } } };
  const resultPath = path.join(root, 'gate-result.json'); fs.writeFileSync(resultPath, JSON.stringify(outcome));
  const rejected = sdk(['record-outcome', '--project-root', root, '--receipt', view.receipts.actions[0], '--result-file', resultPath], 1);
  assert.equal(rejected.error.code, 'OUTCOME_REJECTED');
  assert.match(rejected.error.message, changeAfterConfirmation
    ? /native Open confirmation and matching revalidation are required/
    : /protected Run, input, policy and source readback are required/);
  const after = sdk(['inspect', ...base]);
  assert.equal(after.run.runId, change);
  assert.equal(after.run.current.actions.find((item) => item.id === gate.id)?.status, 'running');
  assert.equal(after.run.current.actions.some((item) => item.stepId.startsWith('full.design')), false);
  t.diagnostic(JSON.stringify({ scope: 'synthetic-negative-only', comet: '0.5.1', packageContentHash: installed.contentHash, runId: change,
    gateAction: gate.id, revisionBefore: view.run.revision, revisionAfter: after.run.revision,
    rejection: rejected.error.code, reason: rejected.error.message, changedAfterConfirmation:changeAfterConfirmation, hostIntegration: installed.hostIntegration.length }));
}

test('actual Comet 0.5.1 retains the same synthetic Run when R lacks a protected source', async (t)=>exerciseNativeR(t,false));
test('actual Comet refuses R when requirements changed after the native confirmation', async (t)=>exerciseNativeR(t,true));
