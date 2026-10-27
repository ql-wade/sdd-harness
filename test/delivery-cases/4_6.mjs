// P4_6 delivery case — comet-050 revision (2026-10-26-comet-050-adoption-v1).
//
// Post-archive same-Run Kt recovery on the PINNED 0.5.0 supply
// (upstream aeb1a659 + the 0005 Kt closeout patch, build de39629a…). The
// retired 0.4.5 face of this case (patch 0003, `state init --managed-delivery`
// / dispatch-gate / knowledge-publish under .comet-state.lock) is GONE on the
// new supply — the honest RED for this revision (worker-reports/P4_6-comet-
// 050/evidence/RED-pre050-old-face.txt, 12/12 fail) — and the retired patch
// files stay retired (infra-runner-isolation pins their absence; 0003 was
// superseded by 0005 per ADR-0022 B1).
//
// The four same-Run Kt semantics this revision proves, every one against the
// REAL build in one-shot /tmp worlds (isolated HOME/TMPDIR/PATH, pinned node
// 24.15.0, pinned openspec 1.11.0 through the COMET_OPENSPEC seam — the only
// archive writer):
//
//   KTA post-archive discovery + blocked completion
//        a REAL classic Run is driven open→archive-confirm through the public
//        `comet state`/`comet check` surface, the Kp obligation is sealed
//        BEFORE the archive (sealCloseout over a public-face seal read), the
//        REAL `comet archive` moves the change exactly once — and on the SAME
//        Run (run_id stable): the public continuation face (`state next`)
//        keeps naming delivery ("do not archive again"), never a completion
//        claim; the 0005-patched resolver of the pinned build — evaluated over
//        the run's REAL ClassicState + REAL collected evidence — PARKS the
//        archived run at full.archive.execute while knowledgeCloseout is
//        required and unmet, and reports 'completed' only when the field is
//        completed or absent (fail-open default preserved byte-for-byte).
//   KTB Kt completion flips the SAME Run to completed
//        the write path is the optional state field (the exact in-memory
//        contract the 0005 header declares for the managed host layer): with
//        completed=true the SAME real state resolves 'completed'; the managed
//        mirror predicate (lib/adapters/comet.js) agrees on every truth-table
//        row over the real state; and the live PUBLIC face proves the write
//        gap honestly — `state set <change> knowledgeCloseout.* …` is refused
//        CLASSIC_FIELD_UNKNOWN (the persisted-field write is the declared
//        supply/admission-wave obligation, never faked here).
//   KTC repeated hooks/callbacks/restart never re-archive or re-publish
//        repeated managed closeout on the archived Run reconciles
//        'already-archived' with ZERO native dispatch; repeated `state next`
//        returns the same delivery continuation; a REAL fresh CLI process
//        (bin/comet.js subprocess) re-enters `archive` idempotently — still
//        exactly one archive directory, main specs byte-stable, same run_id;
//        a second Kp seal is refused (single closeout owner).
//   KTD unknown keeps the ORIGINAL handle
//        a publication timeout on the registered Kt operation keeps the SAME
//        operationKey/documentId (the target id is derived and deterministic —
//        a retry re-targets the fixed document, never a second logical page);
//        the ledger judgment stays blocked PUBLICATION_UNKNOWN ("unknown is
//        never absence"), a non-executable directive is refused
//        (DIRECTIVE_NOT_EXECUTABLE — recovery may only read the original
//        operation back), a receipt minted from unknown is refused, and only a
//        two-channel independent readback of the SAME operation satisfies Kt —
//        composing the SAME-Run completion (resolver completed + ledger ok).
//
// Proven UNVERIFIED (registered in team-recovery/comet-050-post-archive-kt-
// recovery-probe.json and the worker report, never papered over): the LIVE
// Outline publication itself (P4_4/VERIFY boundary — here the judgment layer
// over the ledger is the tested object), and the persisted-write of the
// knowledgeCloseout state field through a 0.5.0 public command (supply/
// admission wave; the parked row is proven at the patched resolver seam over
// the run's real state bytes).
//
// Structure (same discipline as 3_3/3_4): the world work runs in a PINNED-node
// scenario subprocess of this same file (`--kt-scenario post-archive-kt`)
// that performs the real drive and emits a bounded proof JSON; the outer
// tests assert the proof sections. Missing build/CLI/node prerequisites skip
// with an explicit reason (P3_3 convention) — they never pass silently.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

// --- pinned supply resolution --------------------------------------------------

const cometLockPath = path.join(projectRoot, 'integrations/comet/upstream.lock.json');
const cometLock = JSON.parse(fs.readFileSync(cometLockPath, 'utf8'));
const cometFingerprint = sha256(JSON.stringify({
  archive: cometLock.source.sha256,
  patches: cometLock.patches.map(({ path: patchPath, sha256: patchSha }) => ({ path: patchPath, sha256: patchSha })),
  toolchain: cometLock.toolchain,
}));
const cometBuildDir = path.join(projectRoot, '.sdd/vendor/comet', cometLock.source.commit, 'builds', cometFingerprint);
const cometEntrypoint = path.join(cometBuildDir, 'work/bin/comet.js');
const cometBuildPresent = fs.existsSync(cometEntrypoint)
  && fs.existsSync(path.join(cometBuildDir, 'distribution.json'))
  && fs.existsSync(path.join(projectRoot, '.sdd/vendor/comet', cometLock.source.commit, 'provenance.json'));
const openspecCli = path.join(projectRoot, '.sdd/tools/openspec-1.11.0/node_modules/.bin/openspec');
const openspecReady = (() => {
  const probe = spawnSync(openspecCli, ['--version'], { encoding: 'utf8', timeout: 30_000 });
  return probe.status === 0 && Boolean(probe.stdout);
})();

let pinnedNode = process.execPath;
if (process.versions.node !== cometLock.toolchain.node) {
  const candidate = path.join(process.env.HOME ?? '', '.nvm/versions/node', `v${cometLock.toolchain.node}`, 'bin/node');
  const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
  if (probe.status === 0 && probe.stdout.trim() === `v${cometLock.toolchain.node}`) pinnedNode = candidate;
}
const pinnedNodeReady = pinnedNode !== process.execPath
  || process.versions.node === cometLock.toolchain.node;

const scenarioSkip = !cometBuildPresent
  ? `UNVERIFIED: patched Comet build ${cometFingerprint.slice(0, 8)} is not present; run tools/comet/prepare-source.mjs && tools/comet/build.mjs --archive first`
  : !openspecReady
    ? `UNVERIFIED: pinned openspec 1.11.0 CLI is not installed at ${path.relative(projectRoot, openspecCli)}`
    : !pinnedNodeReady
      ? `UNVERIFIED: the locked node v${cometLock.toolchain.node} is not available for the pinned-world scenario`
      : false;

const teamRecoveryProbePath = path.join(projectRoot,
  'openspec/changes/delivery-foundation-rearchitecture/team-recovery/comet-050-post-archive-kt-recovery-probe.json');

// --- the pinned-node scenario (real drive + real archive + seams) --------------

const scenarioArgv = process.argv.indexOf('--kt-scenario');
const proofArgv = process.argv.indexOf('--proof');

async function runScenario() {
  assert.equal(process.versions.node, cometLock.toolchain.node,
    'the world scenario runs on the exact locked Node, not a host alias');
  assert.equal(cometLock.package.version, '0.5.0', 'the pinned supply must be the 0.5.0 baseline');
  assert.equal(cometLock.source.commit, 'aeb1a6598034e28ce46b8422d4dbd8785e607bd7');
  assert.deepEqual(cometLock.patches.map(({ path: patchPath }) => patchPath),
    ['integrations/comet/patches/0005-comet-050-kt-closeout.patch'],
    'the pinned supply must carry exactly the 0005 Kt closeout patch');

  const work = path.join(cometBuildDir, 'work');
  const { pathToFileURL } = await import('node:url');
  const native = await import(pathToFileURL(path.join(work, 'assets/skills/comet/scripts/comet-runtime.mjs')).href);

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'p46-kt-'));
  const home = path.join(scratch, 'home');
  const root = path.join(scratch, 'root');
  fs.mkdirSync(home, { recursive: true });
  for (const rel of ['openspec/changes/archive', 'openspec/specs/cap-a', 'openspec/changes/demo',
    'docs/superpowers/plans', 'docs/superpowers/specs', 'docs/superpowers/reports', '.comet', '.whitebox']) {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
  }
  fs.writeFileSync(path.join(root, '.comet/config.yaml'),
    'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n');
  fs.writeFileSync(path.join(root, 'openspec/config.yaml'), 'schema: spec-driven\n');
  fs.writeFileSync(path.join(root, 'openspec/specs/cap-a/spec.md'), [
    '# cap-a Specification', '', '## Purpose', 'Purpose of cap-a is the P4_6 Kt recovery fixture.', '',
    '## Requirements', '', '### Requirement: Existing auth flow', 'The system SHALL authenticate users.', '',
    '#### Scenario: Valid login', '- **WHEN** valid credentials', '- **THEN** access granted', '',
  ].join('\n'));
  const delta = [
    '## MODIFIED Requirements', '', '### Requirement: Existing auth flow',
    'The system SHALL authenticate users with rate limiting.', '',
    '#### Scenario: Valid login', '- **WHEN** valid credentials', '- **THEN** access granted', '',
    '## ADDED Requirements', '', '### Requirement: Audit trail', 'The system SHALL log auth events.', '',
    '#### Scenario: Login logged', '- **WHEN** any login attempt', '- **THEN** audit record written', '',
  ].join('\n');
  const changeDir = path.join(root, 'openspec/changes/demo');
  fs.writeFileSync(path.join(changeDir, 'proposal.md'),
    '## Why\nThe P4_6 Kt recovery case needs a real change with a meaningful why section.\n\n## What Changes\nRate-limit the auth flow and add an audit trail.\n\n## Impact\ncap-a.\n');
  fs.writeFileSync(path.join(changeDir, 'tasks.md'),
    '- [ ] 1.1 Implement the managed archive proof. <!-- comet-task:task1 -->\n');
  fs.writeFileSync(path.join(changeDir, 'design.md'),
    '---\ncomet_change: demo\nrole: technical-design\ncanonical_spec: openspec\n---\n# Design\nOne original Runtime owns the archive transaction.\n');
  fs.mkdirSync(path.join(changeDir, 'specs/cap-a'), { recursive: true });
  fs.writeFileSync(path.join(changeDir, 'specs/cap-a/spec.md'), delta);

  const prior = { HOME: process.env.HOME, COMET_OPENSPEC: process.env.COMET_OPENSPEC };
  process.env.HOME = home;
  process.env.COMET_OPENSPEC = openspecCli;
  const commands = [];
  const cli = async (argv) => {
    const result = await native.runClassicCli(['--json', ...argv], undefined,
      { projectRoot: root, invocationCwd: root });
    commands.push({ argv, exitCode: result.exitCode,
      stdout: (result.stdout ?? '').slice(0, 2000), stderr: (result.stderr ?? '').slice(0, 2000) });
    return result;
  };
  const ok = async (argv) => {
    const result = await cli(argv);
    assert.equal(result.exitCode, 0, `${argv.join(' ')} -> exit ${result.exitCode}: ${(result.stderr ?? result.stdout ?? '').slice(0, 400)}`);
    return result;
  };
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const subprocess = (argv) => {
    const result = spawnSync(pinnedNode, [cometEntrypoint, ...argv, '--json'], {
      cwd: root, encoding: 'utf8', timeout: 240_000, maxBuffer: 64 * 1024 * 1024, env: childEnv,
    });
    let json = null;
    try { json = JSON.parse(result.stdout ?? ''); } catch { /* keep raw */ }
    commands.push({ argv: ['<subprocess>', ...argv], exitCode: result.status,
      stdout: (result.stdout ?? '').slice(0, 2000), stderr: (result.stderr ?? '').slice(0, 500) });
    return { ...result, json };
  };
  const sections = {};
  const proof = (id, expected, actual, observed = undefined) => {
    assert.deepEqual(actual, expected, id);
    sections[id] = { expected, actual, ...(observed === undefined ? {} : { observed }) };
  };
  const archiveDirs = () => fs.readdirSync(path.join(root, 'openspec/changes/archive'));
  const mainSpec = () => fs.readFileSync(path.join(root, 'openspec/specs/cap-a/spec.md'), 'utf8');
  const step = (name) => process.stderr.write(`[p46-step] ${name}\n`);

  try {
    step('drive-start');
    // ---- the real drive, every step the public state/check surface ----------
    await ok(['state', 'init', 'demo', 'full']);
    await ok(['state', 'transition', 'demo', 'open-complete']);
    await ok(['state', 'set', 'demo', 'design_doc', 'openspec/changes/demo/design.md']);
    await ok(['state', 'complete-design', 'demo', '--design-doc', 'openspec/changes/demo/design.md']);
    await ok(['state', 'set', 'demo', 'build_mode', 'autonomous', 'tdd_mode', 'tdd', 'isolation', 'current']);
    const tasksRun = await ok(['state', 'tasks', 'demo', '--assign-ids']);
    const tasksData = JSON.parse(tasksRun.stdout).data ?? {};
    const task = (tasksData.tasks ?? [])[0];
    assert.ok(task?.id, 'state tasks --assign-ids must return the stable task id');
    await ok(['state', 'task-complete', 'demo', task.id, '--expect', tasksData.revision]);
    fs.writeFileSync(path.join(root, 'docs/superpowers/plans/plan.md'),
      `<!-- comet-task-authority: openspec/changes/demo/tasks.md -->\n# Plan\n\nStep one covers the task <!-- comet-task-ref:${task.id} -->.\n`);
    await ok(['state', 'set', 'demo', 'plan', 'docs/superpowers/plans/plan.md']);
    await ok(['check', 'run', 'demo', 'build', '--', process.execPath, '-e', '0']);
    await ok(['state', 'transition', 'demo', 'build-complete']);
    fs.writeFileSync(path.join(root, '.whitebox/verification.md'),
      '# Component evidence\nP4_6 post-archive Kt recovery world.\n');
    await ok(['state', 'set', 'demo', 'verification_report', '.whitebox/verification.md']);
    await ok(['check', 'run', 'demo', 'verify', '--', process.execPath, '-e', '0']);
    await ok(['state', 'transition', 'demo', 'verify-pass']);
    await ok(['state', 'transition', 'demo', 'archive-confirm']);

    step('drive-done');
    // ---- Kp BEFORE the archive: the managed single-closeout-owner seal over a
    // public-face seal read (Knowledge.Closeout.v1: Kp before every archive).
    const { sealCloseout, knowledgeCloseoutBlocked } = await import(pathToFileURL(path.join(projectRoot, 'lib/adapters/comet.js')).href);
    const sealRead = await ok(['state', 'get', 'demo', 'phase', 'verify_result', 'archive_confirmation', 'archived']);
    const sealFields = JSON.parse(sealRead.stdout).data?.fields ?? {};
    const seal = {
      change: 'demo',
      phase: sealFields.phase,
      verifyResult: sealFields.verify_result,
      archiveConfirmation: sealFields.archive_confirmation,
      archived: sealFields.archived === 'true',
    };
    const kpKnowledge = { id: 'k-project-closeout-demo', digest: sha256('# Project Knowledge\n\nKp sealed before the archive.\n') };
    const sealed = sealCloseout({ seal, execution: 'p46-exec-kp', knowledgeCloseout: kpKnowledge });
    proof('KP_SEALED_BEFORE_ARCHIVE', true, sealed.archived === true);

    // The run identity is fixed before the archive move.
    const runIdRead = await ok(['state', 'get', 'demo', 'run_id']);
    const runIdBefore = (JSON.parse(runIdRead.stdout).data?.fields ?? {}).run_id;
    assert.ok(runIdBefore, 'state get run_id must answer on the active change');

    // ---- the REAL archive through the managed adapter (native = exactly one
    // `comet archive`, which invokes the pinned openspec CLI exactly once).
    const { createManagedSpecAdapter } = await import(pathToFileURL(path.join(projectRoot, 'lib/adapters/spec.js')).href);
    const runModule = await import(pathToFileURL(path.join(work, 'dist/domains/comet-classic/classic-runtime-run.js')).href);
    const spec = createManagedSpecAdapter({
      runtime: { runClassicCli: native.runClassicCli, ensureClassicRuntimeRun: runModule.ensureClassicRuntimeRun },
      projectRoot: root,
    });
    const beforeArchive = spec.inspect({ change: 'demo' });
    proof('PRE_ARCHIVE_INSPECT', { archived: false, phase: 'archive' },
      { archived: beforeArchive.archived, phase: beforeArchive.phase });

    const archiveResult = await spec.closeout({ change: 'demo' });
    assert.equal(archiveResult.ok, true, `managed closeout failed: ${JSON.stringify(archiveResult).slice(0, 400)}`);
    proof('ARCHIVE_OK_SAME_RUN', runIdBefore, archiveResult.runId);
    proof('ARCHIVE_READBACK_OK', true, archiveResult.readback.ok);
    proof('ARCHIVE_NOT_OVERALL_COMPLETION', false, archiveResult.overallCompletionEligible);
    proof('ONE_ARCHIVE_DIR_AFTER_CLOSEOUT', 1, archiveDirs().length);
    const mainAfterArchive = mainSpec();
    assert.match(mainAfterArchive, /#### Scenario: Valid login/, 'the synced main spec keeps the old scenario');

    step('closeout-done');
    // ---- KTA: post-archive same-Run discovery + blocked completion ----------
    const nextAfter = JSON.parse((await ok(['state', 'next', 'demo'])).stdout);
    proof('POST_ARCHIVE_NEXT_KIND', 'delivery', nextAfter.data?.nextAction?.kind);
    proof('POST_ARCHIVE_PHASE_ARCHIVED', { phase: 'archive', archived: true }, {
      phase: nextAfter.data?.configuration?.phase,
      archived: nextAfter.data?.configuration?.archived,
    });
    proof('POST_ARCHIVE_GUIDANCE_NO_REARCHIVE', true,
      /do not archive again/i.test(`${nextAfter.data?.nextAction?.reason ?? ''} ${nextAfter.stdout ?? ''}`));
    step('next-done');
    const archivedName = archiveDirs()[0];
    const archivedChange = path.join(root, 'openspec/changes/archive', archivedName);

    // The run record on disk (authoritative bytes, never CLI memory).
    const store = await import(pathToFileURL(path.join(work, 'dist/domains/comet-classic/classic-store.js')).href);
    const evidenceMod = await import(pathToFileURL(path.join(work, 'dist/domains/comet-classic/classic-evidence.js')).href);
    const resolver = await import(pathToFileURL(path.join(work, 'dist/domains/comet-classic/classic-resolver.js')).href);
    const projection = await store.readClassicState(archivedChange);
    const evidence = await evidenceMod.collectClassicEvidence(archivedChange, projection);
    proof('DISK_RUN_IDENTITY', runIdBefore, projection.run?.runId);
    proof('DISK_CLASSIC_ARCHIVED', { archived: true, phase: 'archive' },
      { archived: projection.classic.archived, phase: projection.classic.phase });

    // 0005 LIVE at the patched resolver seam over the run's REAL state.
    step('store-read');
    const ktPending = { ...projection.classic, knowledgeCloseout: { required: true, completed: false } };
    const ktDone = { ...projection.classic, knowledgeCloseout: { required: true, completed: true } };
    proof('RESOLVER_KT_PENDING_PARKED', 'full.archive.execute', resolver.resolveClassicStepId(ktPending, evidence));
    proof('RESOLVER_KT_PENDING_NOT_COMPLETED', false, resolver.resolveClassicStepId(ktPending, evidence) === 'completed');
    proof('RESOLVER_KT_DONE_COMPLETED', 'completed', resolver.resolveClassicStepId(ktDone, evidence));
    proof('RESOLVER_FIELD_ABSENT_FAIL_OPEN', 'completed', resolver.resolveClassicStepId(projection.classic, evidence));
    proof('RESOLVER_FIELD_NULL_FAIL_OPEN', 'completed',
      resolver.resolveClassicStepId({ ...projection.classic, knowledgeCloseout: null }, evidence));
    proof('RESOLVER_NOT_REQUIRED_FAIL_OPEN', 'completed',
      resolver.resolveClassicStepId({ ...projection.classic, knowledgeCloseout: { required: false, completed: false } }, evidence));
    // The managed mirror predicate agrees on every 0005 truth-table row over
    // the same real state (the lib mirror is the driver-side twin of 0005).
    for (const [label, state, expectedBlocked] of [
      ['absent', projection.classic, false],
      ['null', { ...projection.classic, knowledgeCloseout: null }, false],
      ['pending', ktPending, true],
      ['done', ktDone, false],
      ['not_required', { ...projection.classic, knowledgeCloseout: { required: false } }, false],
    ]) {
      proof(`MIRROR_TRUTH_TABLE_${label.toUpperCase()}`, expectedBlocked, knowledgeCloseoutBlocked(state));
    }

    // The same-Run recovery entry keeps discovering the pending Kt.
    step('recover-enter');
    const pending = await spec.recover({ change: 'demo' });
    proof('RECOVER_SAME_RUN', runIdBefore, pending.runId);
    proof('RECOVER_ARCHIVED_NOT_COMPLETED', { archived: true, eligible: false },
      { archived: pending.archived, eligible: pending.overallCompletionEligible });

    // ---- KTB: the write path is the state field; the public face refuses it --
    const writeRefused = await cli(['state', 'set', 'demo', 'knowledgeCloseout.completed', 'true']);
    proof('KT_FIELD_WRITE_FACE_REFUSED', 1, writeRefused.exitCode);
    proof('KT_FIELD_WRITE_FACE_CODE', 'CLASSIC_FIELD_UNKNOWN',
      writeRefused.exitCode === 0 ? null : (JSON.parse(writeRefused.stdout ?? '{}').data?.issues ?? [{}])[0]?.code);
    sections.KT_FIELD_WRITE_FACE = {
      expected: 'the 0.5.0 public state face has no knowledgeCloseout write (supply/admission wave)',
      actual: 'state set refused with CLASSIC_FIELD_UNKNOWN over the real archived run',
      observed: (JSON.parse(writeRefused.stdout ?? '{}').data?.issues?.[0]?.message ?? '').slice(0, 200),
    };

    step('writeface-done');
    // ---- KTD: unknown keeps the ORIGINAL handle (same-Run ledger semantics) --
    const outline = await import(pathToFileURL(path.join(projectRoot, 'lib/adapters/outline.js')).href);
    const capability = 'k-team-closeout-demo';
    const payload = '# Team Knowledge\n\nPost-archive Kt closeout for demo.\n';
    const payloadDigest = sha256(payload);
    const documentId = outline.deriveOutlineTargetId({ change: 'demo', capability });
    const operation = {
      knowledgeId: capability,
      operationKey: `demo:${capability}:epoch-0:op1`,
      documentId,
      collection: 'engineering',
      payloadDigest,
      state: 'pending',
    };
    operation.lastObservation = outline.buildTimeoutObservation({ operation, at: new Date(0).toISOString() });
    const ledger = { schemaVersion: 1, interface: 'comet.classic.knowledge-publish.v1', operations: [operation] };
    const required = [{ capability, digest: payloadDigest }];

    const unknownJudged = outline.evaluateKtFromLedger({ required, ledger });
    proof('KT_UNKNOWN_BLOCKED', false, unknownJudged.ok);
    proof('KT_UNKNOWN_CODE', 'PUBLICATION_UNKNOWN', unknownJudged.blocked[0]?.code);
    assert.match(unknownJudged.blocked[0]?.reason ?? '', /unknown is never absence/,
      'the blocked reason names the unknown-is-never-absence rule');
    proof('KT_TARGET_ID_DETERMINISTIC', documentId,
      outline.deriveOutlineTargetId({ change: 'demo', capability }));
    const differentCapabilityId = outline.deriveOutlineTargetId({ change: 'demo', capability: 'k-other' });
    assert.notEqual(differentCapabilityId, documentId, 'a different logical entry derives a different fixed target');

    // Recovery can only query the ORIGINAL operation — never a second publish.
    const refusedDirective = { action: 'readback', documentId };
    let directiveRefusal = null;
    try { outline.buildPublishRequest({ directive: refusedDirective, operation }); }
    catch (error) { directiveRefusal = error.code; }
    proof('KT_UNKNOWN_DIRECTIVE_NOT_EXECUTABLE', 'DIRECTIVE_NOT_EXECUTABLE', directiveRefusal);
    let foreignTargetRefusal = null;
    try { outline.buildPublishRequest({ directive: { action: 'create', documentId: differentCapabilityId }, operation }); }
    catch (error) { foreignTargetRefusal = error.code; }
    proof('KT_FOREIGN_TARGET_REFUSED', 'TARGET_ID_MISMATCH', foreignTargetRefusal);
    let unknownReceiptRefusal = null;
    try { outline.buildCloseoutReceipt({ operation, observation: operation.lastObservation, execution: 'p46-exec-kt' }); }
    catch (error) { unknownReceiptRefusal = error.code; }
    proof('KT_RECEIPT_FROM_UNKNOWN_REFUSED', 'PUBLICATION_UNKNOWN', unknownReceiptRefusal);

    // Only a two-channel independent readback of the SAME operation satisfies.
    const readback = outline.buildReadbackObservation({
      operation, revision: 'rev-1', readbackDigest: payloadDigest,
      readbacks: [{ channel: 'api', digest: payloadDigest }, { channel: 'web', digest: payloadDigest }],
    });
    proof('KT_READBACK_OUTCOME_EXISTS', { outcome: 'exists', documentId },
      { outcome: readback.outcome, documentId: readback.documentId });
    const publishedLedger = {
      ...ledger,
      operations: [{ ...operation, state: 'published', lastObservation: readback }],
    };
    const publishedJudged = outline.evaluateKtFromLedger({ required, ledger: publishedLedger });
    proof('KT_READBACK_SATISFIES', true, publishedJudged.ok);
    proof('KT_SATISFIED_SAME_DOCUMENT', documentId, publishedJudged.satisfied[0]?.documentId);
    const receipt = outline.buildCloseoutReceipt({
      operation, observation: readback, execution: 'p46-exec-kt', recordedAt: new Date(0).toISOString(),
    });
    proof('KT_RECEIPT_TARGET_IS_ORIGINAL', documentId, receipt.target);

    // The SAME-Run completion composition: Kt done flips the resolver row, the
    // mirror predicate agrees, and the ledger satisfies — all three together.
    proof('COMPLETION_COMPOSED', true,
      resolver.resolveClassicStepId(ktDone, evidence) === 'completed'
        && !knowledgeCloseoutBlocked(ktDone)
        && publishedJudged.ok);

    step('ktd-done');
    // ---- KTC: repeated hooks/callbacks/restart never re-archive -------------
    const again = await spec.closeout({ change: 'demo' });
    proof('REPEATED_CLOSEOUT_RECONCILED', 'already-archived', again.reconciled);
    proof('REPEATED_CLOSEOUT_ZERO_NATIVE', true, again.native === null);
    proof('REPEATED_CLOSEOUT_SAME_RUN', runIdBefore, again.runId);
    proof('REPEATED_CLOSEOUT_ONE_ARCHIVE', 1, archiveDirs().length);
    proof('REPEATED_CLOSEOUT_MAIN_STABLE', sha256(mainAfterArchive), sha256(mainSpec()));

    const nextReplays = [];
    for (let replay = 1; replay <= 3; replay += 1) {
      const next = JSON.parse((await ok(['state', 'next', 'demo'])).stdout);
      nextReplays.push(next.data?.nextAction?.kind);
    }
    proof('REPEATED_NEXT_STABLE', ['delivery', 'delivery', 'delivery'], nextReplays);

    step('restart-enter');
    // A REAL fresh CLI process (restart) re-enters the archived run.
    const restartArchive = subprocess(['archive', 'demo']);
    proof('RESTART_ARCHIVE_EXIT', 0, restartArchive.status === 0 ? 0 : restartArchive.status);
    proof('RESTART_ARCHIVE_ONE_DIR', 1, archiveDirs().length);
    proof('RESTART_ARCHIVE_MAIN_STABLE', sha256(mainAfterArchive), sha256(mainSpec()));
    const restartIdentity = subprocess(['state', 'get', 'demo', 'run_id']);
    const restartRunId = restartIdentity.json?.data?.fields?.run_id
      ?? (restartIdentity.status === 0 ? JSON.parse(restartIdentity.stdout).data?.fields?.run_id : null);
    proof('RESTART_SAME_RUN_ID', runIdBefore, restartRunId);

    step('restart-done');
    // A second Kp seal is refused — the archive closeout is single-owner even
    // though the upstream CLI converges idempotently.
    let secondSealRefusal = null;
    try { sealCloseout({ seal: { ...seal, archived: true }, execution: 'p46-exec-kp-2', knowledgeCloseout: kpKnowledge }); }
    catch (error) { secondSealRefusal = error.code; }
    proof('SECOND_KP_SEAL_REFUSED', 'ARCHIVE_ALREADY_SEALED', secondSealRefusal);

    fs.writeFileSync(proofPath(), `${JSON.stringify({
      scenario: 'post-archive-kt',
      node: process.version,
      buildFingerprint: cometFingerprint,
      openspec: '1.11.0 (pinned, COMET_OPENSPEC seam)',
      sections,
      commands,
      unverified: [
        'the live Outline publication API (P4_4/VERIFY boundary): the judgment layer over the runtime publish ledger is the tested object here',
        'the persisted write of the knowledgeCloseout state field through a 0.5.0 public command (supply/admission wave; proven at the patched resolver seam over the run real state instead)',
        'the composition-package Run face to archive (P3_2 drove its R→P slice; the full composition journey to archive stays P4_4/VERIFY)',
      ],
    }, null, 2)}\n`);
    process.stdout.write('P4_6 scenario post-archive-kt: PROOF-EMITTED\n');
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (process.env.P46_KEEP_WORLD !== '1') fs.rmSync(scratch, { recursive: true, force: true });
    else process.stderr.write(`P46 world kept at ${scratch}\n`);
  }
}

const proofPath = () => (proofArgv >= 0 ? process.argv[proofArgv + 1] : '/tmp/p46-proof.json');

// --- outer tests (NEVER registered in a scenario child — the scenario branch
// above is the leaf: registering tests here would re-enter them recursively
// under a plain `node` execution of this same file, the 3_4 discipline) -------

let cachedProof = null;
function loadProof() {
  if (cachedProof) return cachedProof;
  const proofFile = path.join(os.tmpdir(), `p46-proof-${process.pid}-${Date.now()}.json`);
  const result = spawnSync(pinnedNode, [fileURLToPath(import.meta.url), '--kt-scenario', 'post-archive-kt', '--proof', proofFile], {
    cwd: projectRoot, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024,
    env: (() => { const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; return env; })(),
  });
  assert.equal(result.status, 0,
    `the pinned-world scenario must exit 0, got ${result.status}\nstdout: ${(result.stdout ?? '').slice(0, 800)}\nstderr: ${(result.stderr ?? '').slice(0, 800)}`);
  cachedProof = JSON.parse(fs.readFileSync(proofFile, 'utf8'));
  fs.rmSync(proofFile, { force: true });
  return cachedProof;
}

if (scenarioArgv >= 0) {
  await runScenario();
} else {
  test('setup: the pinned supply carries exactly the 0005 Kt patch and the retired 0003 face stays retired', () => {
    assert.equal(cometLock.package.version, '0.5.0');
    assert.equal(cometLock.source.commit, 'aeb1a6598034e28ce46b8422d4dbd8785e607bd7');
    assert.deepEqual(cometLock.patches.map(({ path: patchPath }) => patchPath),
      ['integrations/comet/patches/0005-comet-050-kt-closeout.patch'],
      'the retired 0003 post-archive patch must stay retired — 0005 is its only successor on this baseline');
    // The retired files this revision stands on (infra-runner-isolation pins the
    // same disposition): recreating them would fork the supply.
    for (const retired of [
      'integrations/comet/patches/0003-post-archive-closeout.patch',
      'integrations/comet/patches/tests/4_6.patch',
    ]) {
      assert.equal(fs.existsSync(path.join(projectRoot, retired)), false,
        `the retired patch file must stay absent: ${retired}`);
    }
    assert.equal(fs.existsSync(path.join(projectRoot, 'integrations/comet/patches/0005-comet-050-kt-closeout.patch')), true);
  });

  test('KTA: post-archive same-Run Kt discovery — the real archive completes, completed is blocked at the 0005 seam, the same Run stays discoverable', { skip: scenarioSkip }, () => {
    const proof = loadProof();
    assert.equal(proof.scenario, 'post-archive-kt');
    assert.equal(proof.buildFingerprint, cometFingerprint, 'the proof names the build it ran on');
    for (const id of [
      'KP_SEALED_BEFORE_ARCHIVE',
      'PRE_ARCHIVE_INSPECT',
      'ARCHIVE_OK_SAME_RUN',
      'ARCHIVE_READBACK_OK',
      'ARCHIVE_NOT_OVERALL_COMPLETION',
      'ONE_ARCHIVE_DIR_AFTER_CLOSEOUT',
      'POST_ARCHIVE_NEXT_KIND',
      'POST_ARCHIVE_PHASE_ARCHIVED',
      'POST_ARCHIVE_GUIDANCE_NO_REARCHIVE',
      'DISK_RUN_IDENTITY',
      'DISK_CLASSIC_ARCHIVED',
      'RESOLVER_KT_PENDING_PARKED',
      'RESOLVER_KT_PENDING_NOT_COMPLETED',
      'RESOLVER_KT_DONE_COMPLETED',
      'RESOLVER_FIELD_ABSENT_FAIL_OPEN',
      'RESOLVER_FIELD_NULL_FAIL_OPEN',
      'RESOLVER_NOT_REQUIRED_FAIL_OPEN',
      'RECOVER_SAME_RUN',
      'RECOVER_ARCHIVED_NOT_COMPLETED',
    ]) {
      assert.ok(proof.sections[id], `the scenario must pin ${id}`);
      assert.deepEqual(proof.sections[id].actual, proof.sections[id].expected, id);
    }
    assert.equal(proof.sections.RESOLVER_KT_PENDING_PARKED.actual, 'full.archive.execute',
      'Kt pending parks the SAME archived Run at the existing archive step — the resolver never reports completed');
  });

  test('KTB: Kt completion flips the SAME Run to completed; the state-field write face is honestly recorded', { skip: scenarioSkip }, () => {
    const proof = loadProof();
    for (const id of [
      'RESOLVER_KT_DONE_COMPLETED',
      'MIRROR_TRUTH_TABLE_ABSENT',
      'MIRROR_TRUTH_TABLE_NULL',
      'MIRROR_TRUTH_TABLE_PENDING',
      'MIRROR_TRUTH_TABLE_DONE',
      'MIRROR_TRUTH_TABLE_NOT_REQUIRED',
      'KT_FIELD_WRITE_FACE_REFUSED',
      'KT_FIELD_WRITE_FACE_CODE',
      'COMPLETION_COMPOSED',
    ]) {
      assert.ok(proof.sections[id], `the scenario must pin ${id}`);
      assert.deepEqual(proof.sections[id].actual, proof.sections[id].expected, id);
    }
    assert.equal(proof.sections.KT_FIELD_WRITE_FACE_CODE.actual, 'CLASSIC_FIELD_UNKNOWN',
      'the public 0.5.0 state face refuses the knowledgeCloseout write — the persisted write path is the supply/admission wave, never faked');
  });

  test('KTC: repeated hooks, callbacks and a real fresh-process restart never re-archive or re-publish', { skip: scenarioSkip }, () => {
    const proof = loadProof();
    for (const id of [
      'REPEATED_CLOSEOUT_RECONCILED',
      'REPEATED_CLOSEOUT_ZERO_NATIVE',
      'REPEATED_CLOSEOUT_SAME_RUN',
      'REPEATED_CLOSEOUT_ONE_ARCHIVE',
      'REPEATED_CLOSEOUT_MAIN_STABLE',
      'REPEATED_NEXT_STABLE',
      'RESTART_ARCHIVE_EXIT',
      'RESTART_ARCHIVE_ONE_DIR',
      'RESTART_ARCHIVE_MAIN_STABLE',
      'RESTART_SAME_RUN_ID',
      'SECOND_KP_SEAL_REFUSED',
    ]) {
      assert.ok(proof.sections[id], `the scenario must pin ${id}`);
      assert.deepEqual(proof.sections[id].actual, proof.sections[id].expected, id);
    }
    assert.equal(proof.sections.REPEATED_CLOSEOUT_ZERO_NATIVE.actual, true,
      'a repeated closeout dispatches zero native archive commands (already-archived reconciliation only)');
  });

  test('KTD: an unknown publication outcome keeps the ORIGINAL operation handle — query-only recovery, no second operation', { skip: scenarioSkip }, () => {
    const proof = loadProof();
    for (const id of [
      'KT_UNKNOWN_BLOCKED',
      'KT_UNKNOWN_CODE',
      'KT_TARGET_ID_DETERMINISTIC',
      'KT_UNKNOWN_DIRECTIVE_NOT_EXECUTABLE',
      'KT_FOREIGN_TARGET_REFUSED',
      'KT_RECEIPT_FROM_UNKNOWN_REFUSED',
      'KT_READBACK_OUTCOME_EXISTS',
      'KT_READBACK_SATISFIES',
      'KT_SATISFIED_SAME_DOCUMENT',
      'KT_RECEIPT_TARGET_IS_ORIGINAL',
    ]) {
      assert.ok(proof.sections[id], `the scenario must pin ${id}`);
      assert.deepEqual(proof.sections[id].actual, proof.sections[id].expected, id);
    }
    assert.equal(proof.sections.KT_UNKNOWN_CODE.actual, 'PUBLICATION_UNKNOWN',
      'unknown is never absence — the same-Run entry keeps discovering the ORIGINAL pending operation');
  });

  test('registration: the team-recovery probe pins the four same-Run Kt semantics with honest UNVERIFIED scope', () => {
    const probe = JSON.parse(fs.readFileSync(teamRecoveryProbePath, 'utf8'));
    assert.equal(probe.schemaVersion, 1);
    assert.equal(probe.interface, 'TeamRecovery.PostArchiveKtRecovery.v1');
    assert.equal(probe.task, 'P4_6');
    assert.equal(probe.caseModule, 'test/delivery-cases/4_6.mjs');
    assert.equal(probe.supply.patch, 'integrations/comet/patches/0005-comet-050-kt-closeout.patch');
    assert.ok(Array.isArray(probe.semantics) && probe.semantics.length === 4,
      'the four semantics (discovery/block, completion, idempotent re-entry, unknown-handle) are registered');
    for (const semantic of probe.semantics) {
      assert.ok(semantic.id && semantic.face && semantic.pinnedBy, `each semantic names its live face and test point: ${JSON.stringify(semantic)}`);
    }
    assert.ok(Array.isArray(probe.unverified) && probe.unverified.length >= 2,
      'the honest UNVERIFIED scope is part of the registration');
    assert.doesNotMatch(JSON.stringify(probe), /"[a-f0-9]{64}"/,
      'the probe pins no concrete hash value (the supply lock owns the pins)');
  });

}
