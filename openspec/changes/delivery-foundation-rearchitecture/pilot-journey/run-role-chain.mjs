#!/usr/bin/env node
// Pilot journey role-chain executor (task P3_2) — the real execution half of
// the managed-pilot role chain: the Comet single controller arranges the
// test-author -> builder -> whitebox roles and their dev-task path bounds
// over a real fixture project, and every judgment is made by an independent
// mechanism, never by the role that is being judged:
//   - behavior  : real `node --test` executions, classified by the accepted
//                 lib/delivery/test-contract.js (valid RED vs environment
//                 failure vs pass; zero-execution never counts);
//   - evidence  : admission through lib/delivery/evidence.js admitEvidence
//                 under the P1_3 run-bound launch authority
//                 (lib/adapters/comet.js cometLaunchAuthority) — the HMAC
//                 secret stays inside this controller process, role code
//                 cannot mint dispatches;
//   - acceptance: lib/delivery/gate.js evaluate (pure, receipt-validated);
//   - exclusivity: lib/adapters/harness.js drivers — the planner is a
//                 read-only driver with no execute surface at all, content
//                 writes go through the managed-write driver bounded by the
//                 PlanBundle-derived role path assignments, and the runner
//                 refuses phase fields (no second currentPhase anywhere).
//
// The controller's single RunState file (control/run-state.json) is the only
// control-plane artifact; roles receive no path to it and the case suite
// holds the byte-level oracles over it. A plan-only request persists no
// control state at all (B01).
//
// This tool executes one scenario choreography per invocation, writes the
// structured evidence JSON (one record per role transition: who, input
// summary, verdict, basis) to --evidence and exits:
//   0 = every expected checkpoint of the choreography was observed (OBSERVED)
//   1 = invalid input (unknown scenario, missing options)
//   2 = the choreography diverged from its expected checkpoints (DIVERGED)
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { parseContract } from '../../../../contracts/delivery/index.js';
import { admitEvidence, createLaunchAuthority } from '../../../../lib/delivery/evidence.js';
import { evaluate } from '../../../../lib/delivery/gate.js';
import { classifyRunOutcome, requireValidRed } from '../../../../lib/delivery/test-contract.js';
import { RUNNER_ID, cometLaunchAuthority, gateTestContractFixture } from '../../../../lib/adapters/comet.js';
import { HarnessError, createRunner, defineDriver, requireWriteDriver } from '../../../../lib/adapters/harness.js';

const SCENARIOS = ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'F08', 'A15'];
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const digestFile = (file) => sha256(fs.readFileSync(file));

function usage() {
  return [
    'Usage: node run-role-chain.mjs --scenario <B01|B02|B03|B04|B05|B06|B07|F08|A15>',
    '       --project <fixture project dir> --evidence <evidence.json> [--variant <v>] [--json]',
    '',
    'Exit codes: 0=choreography observed, 1=invalid input, 2=diverged.',
  ].join('\n');
}

class RoleChain {
  constructor({ scenario, variant, project }) {
    this.scenario = scenario;
    this.variant = variant ?? null;
    this.project = project;
    this.runId = `p32-${crypto.randomBytes(6).toString('hex')}`;
    this.environment = 'pilot-role-chain-local-tmpdir';
    this.toolchain = `node ${process.version}`;
    this.checkpoints = [];
    this.transitions = [];
    this.refusals = [];
    this.dispatchLedger = [];
    this.admitted = [];
    this.issuedExecutions = [];
    this.roleAttempts = {};
    this.seq = 0;
    this.gate = null;
    this.gatePhases = {};
    this.gateStale = null;
    this.gaps = [];
    this.probes = [];
    this.sessions = [];
    this.capabilityInventory = [];
    this.journey = null;

    // PlanBundle: the controller derives role dev-task path bounds from it.
    const planBytes = fs.readFileSync(path.join(project, 'plan-bundle.json'));
    this.planRaw = JSON.parse(planBytes);
    const parsedPlan = parseContract('SDD.Delivery.PlanBundle', this.planRaw);
    this.plan = { ok: parsedPlan.ok, errors: parsedPlan.ok ? [] : parsedPlan.errors, bundle: this.planRaw };
    this.policy = { ref: 'policy/managed-pilot', digest: sha256(planBytes) };

    this.candidateFile = path.join(project, 'src', 'feature.js');
    this.candidateDigestBefore = digestFile(this.candidateFile);
    this.candidateDigest = this.candidateDigestBefore;

    // Runner.Dispatch.v1: the secret never leaves this controller closure.
    this.authority = cometLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex'), runId: this.runId });
    this.plannerDriver = defineDriver({
      id: 'pilot-planner',
      kind: 'read-only',
      observe: () => ({ plan: this.plan.bundle.change, validated: this.plan.ok }),
    });
    this.writerDriver = defineDriver({
      id: 'pilot-managed-writer',
      kind: 'managed-write',
      execute: (op) => this.managedWrite(op),
    });
    this.runner = createRunner({ authority: this.authority, driver: this.writerDriver });

    // Comet 安排角色和开发任务: role -> assigned path prefixes (derived from
    // the PlanBundle allowedPaths; workers cannot write outside them).
    this.rolePaths = {
      planner: [],
      'test-author': ['test/', 'artifacts/'],
      builder: ['src/', 'state/', 'artifacts/'],
      whitebox: ['probe/', 'artifacts/'],
    };

    this.runStateFile = path.join(project, 'control', 'run-state.json');
    this.runStateDigestBefore = fs.existsSync(this.runStateFile) ? digestFile(this.runStateFile) : null;
  }

  // --- controller primitives ---------------------------------------------------

  check(id, ok, detail) {
    this.checkpoints.push({ id, ok: ok === true, detail: String(detail ?? '') });
    return ok === true;
  }

  refuse(where, error) {
    this.refusals.push({ where, code: error?.code ?? 'ERROR', reason: String(error?.message ?? error) });
  }

  transition({ role, action, inputSummary, verdict, basis, ...extra }) {
    this.seq += 1;
    const record = {
      seq: this.seq,
      role,
      driver: role === 'planner'
        ? { id: this.plannerDriver.id, kind: this.plannerDriver.kind }
        : { id: this.writerDriver.id, kind: this.writerDriver.kind },
      action,
      inputSummary,
      verdict,
      basis: basis ?? null,
      ...extra,
    };
    this.transitions.push(record);
    return record;
  }

  persistRunState() {
    if (this.scenario === 'B01') return; // a plan-only request writes no control state
    const state = {
      schemaVersion: 1,
      runId: this.runId,
      planDigest: this.policy.digest,
      candidateDigest: this.candidateDigest,
      assignments: Object.entries(this.rolePaths)
        .filter(([role]) => role !== 'planner')
        .map(([role, allowedPaths]) => ({ role, allowedPaths })),
      dispatchLedger: this.dispatchLedger,
      receiptDigests: this.admitted.map((entry) => entry.envelopeDigest),
    };
    fs.mkdirSync(path.dirname(this.runStateFile), { recursive: true });
    const tmp = `${this.runStateFile}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
    fs.renameSync(tmp, this.runStateFile);
  }

  dispatch({ role, gate }) {
    const attempt = (this.roleAttempts[role] ?? 0) + 1;
    this.roleAttempts[role] = attempt;
    const execution = `exec-${role}-${attempt}`;
    // The evidence layer knows exactly two signing roles (evidence.js
    // DISPATCH_ROLES): the test-author signs authoring self-checks, and the
    // whitebox signs under 'verifier' — the independent-acceptance identity.
    const evidenceRole = role === 'whitebox' ? 'verifier' : role;
    const record = this.authority.issueDispatch({
      runnerId: RUNNER_ID,
      run: this.runId,
      gate,
      inputDigest: this.candidateDigest,
      policyDigest: this.policy.digest,
      attempt,
      epoch: 1,
      role: evidenceRole,
      execution,
    });
    this.dispatchLedger.push(record);
    this.persistRunState();
    return record;
  }

  // Controller-side check binding: an envelope may only declare the check its
  // execution was dispatched for (B06: a service-log execution is never a
  // console execution — the dispatch record is the substitution boundary).
  admit({ dispatch, envelope }) {
    if (envelope.check !== dispatch.gate) {
      const error = new Error(`envelope declares check ${JSON.stringify(envelope.check)} but the execution was dispatched for ${JSON.stringify(dispatch.gate)} — an execution cannot observe a check it was not dispatched for`);
      error.code = 'CHECK_BINDING_MISMATCH';
      this.refuse('admit', error);
      return { ok: false };
    }
    const result = admitEvidence({
      envelope,
      dispatch,
      authority: this.authority,
      current: { inputDigest: this.candidateDigest, policyDigest: this.policy.digest, environment: this.environment },
      issuedExecutions: this.issuedExecutions,
    });
    if (!result.ok) {
      this.refuse('admit', { code: result.error, message: result.reason });
      return result;
    }
    this.issuedExecutions.push(dispatch.execution);
    this.admitted.push({
      execution: dispatch.execution,
      role: dispatch.role,
      class: result.entry.class,
      check: envelope.check,
      result: envelope.result,
      envelopeDigest: result.entry.digest,
    });
    this.persistRunState();
    return result;
  }

  // Managed write executor: the managed-write driver's real execute surface.
  // Writes outside the role's assigned prefixes are refused (workers cannot
  // touch paths their dispatched dev task does not grant).
  managedWrite({ role, relPath, sourcePath, bytes }) {
    const allowed = (this.rolePaths[role] ?? []).some((prefix) => relPath.startsWith(prefix));
    if (!allowed) {
      const error = new HarnessError('ROLE_PATH_REFUSED', `role ${role} is dispatched for ${JSON.stringify(this.rolePaths[role] ?? [])} and cannot write ${relPath}`);
      throw error;
    }
    const abs = path.join(this.project, relPath);
    const content = bytes ?? fs.readFileSync(path.join(this.project, sourcePath));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return { written: true, relPath, sha256: sha256(content) };
  }

  writeArtifact(role, name, content) {
    return this.managedWrite({ role, relPath: path.join('artifacts', name), bytes: content });
  }

  // Real behavioral judgment: a fresh node --test execution, classified by the
  // accepted test-contract mechanism (never by the role being judged).
  runNodeTest({ cwd, target, label, role }) {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const started = Date.now();
    // 2026-10-27 VERIFY repair (G-T1-01): node>=24 changed the piped default
    // reporter from TAP to spec, so the artifact named `*.tap.txt` no longer
    // carried `# tests N` lines and classifyRunOutcome fail-closed as
    // environment-failure (broke 3_2 parent runs under the pinned node24).
    // Pin the reporter explicitly; oracle semantics unchanged.
    const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', target], { cwd, encoding: 'utf8', timeout: 60_000, env });
    const output = run.stdout ?? '';
    const artifact = this.writeArtifact(role, `${label}.tap.txt`, output);
    const outcome = classifyRunOutcome({ exitCode: run.status, output, spawnError: run.error });
    return {
      exitCode: run.status,
      output,
      durationMs: Date.now() - started,
      artifact: { uri: `artifacts/${label}.tap.txt`, sha256: artifact.sha256 },
      outcome,
      summary: outcome.summary,
    };
  }

  envelope({ dispatch, run, caseId = 'c1', result, executions, evidence: evidenceItems }) {
    const summary = run?.summary ?? null;
    return {
      schemaVersion: 1,
      candidateDigest: this.candidateDigest,
      caseId,
      check: dispatch.gate,
      origin: { kind: 'registered-runner', id: RUNNER_ID },
      execution: { id: dispatch.execution },
      environment: this.environment,
      toolchain: this.toolchain,
      executions: executions ?? { total: summary?.tests ?? 0, valid: (summary?.pass ?? 0) + (summary?.fail ?? 0) },
      result,
      evidence: evidenceItems ?? (run ? [run.artifact] : []),
      expiry: new Date(Date.now() + 3_600_000).toISOString(),
    };
  }

  gateEvaluate(requiredChecks, receipts) {
    return evaluate(
      {
        inputDigest: this.candidateDigest,
        testContract: gateTestContractFixture(requiredChecks),
        builderExecution: 'exec-builder-candidate',
      },
      receipts,
      this.policy,
    );
  }

  finish() {
    const ok = this.checkpoints.length > 0 && this.checkpoints.every((checkpoint) => checkpoint.ok);
    const runStateDigestAfter = fs.existsSync(this.runStateFile) ? digestFile(this.runStateFile) : null;
    const evidence = {
      schemaVersion: 1,
      tool: 'openspec/changes/delivery-foundation-rearchitecture/pilot-journey/run-role-chain.mjs',
      scenario: this.scenario,
      variant: this.variant,
      runId: this.runId,
      controller: { runnerId: RUNNER_ID },
      environment: this.environment,
      toolchain: this.toolchain,
      policy: this.policy,
      plan: { ok: this.plan.ok, errors: this.plan.errors, bundle: this.plan.bundle, rolePaths: this.rolePaths },
      candidate: { file: 'src/feature.js', digestBefore: this.candidateDigestBefore, digestAfter: this.candidateDigest },
      frozenTests: this.frozenTests ?? [],
      runState: {
        file: 'control/run-state.json',
        digestBefore: this.runStateDigestBefore,
        digestAfter: runStateDigestAfter,
        unchanged: this.runStateDigestBefore === runStateDigestAfter,
      },
      transitions: this.transitions,
      dispatchLedger: this.dispatchLedger,
      refusals: this.refusals,
      admitted: this.admitted,
      gate: this.gate,
      gatePhases: this.gatePhases,
      gateStale: this.gateStale,
      gaps: this.gaps,
      probes: this.probes,
      sessions: this.sessions,
      capabilityInventory: this.capabilityInventory,
      checkpoints: this.checkpoints,
      journey: this.journey,
      verdict: ok ? 'OBSERVED' : 'DIVERGED',
      finishedAt: new Date().toISOString(),
    };
    return { evidence, exitCode: ok ? 0 : 2 };
  }
}

// --- scenario choreographies ---------------------------------------------------

// B01 — 用户只请求计划 → planner → 只输出 PlanBundle，不派发、监控或改运行状态。
function runB01(chain) {
  chain.check('plan-validated', chain.plan.ok, chain.plan.errors.join('; ') || 'PlanBundle v1 validates');
  const runStateBefore = fs.existsSync(chain.runStateFile) ? digestFile(chain.runStateFile) : null;

  const observed = chain.plannerDriver.observe();
  chain.transition({
    role: 'planner',
    action: 'plan',
    inputSummary: 'plan-only request: plan-bundle.json',
    verdict: 'plan-bundle-emitted',
    basis: { kind: 'plan-only', note: `the only output is the validated PlanBundle (${observed.plan}); no dispatch, no monitoring, no run-state write` },
  });

  // Negative probes on the exclusivity machinery (expected refusals):
  try {
    requireWriteDriver(chain.plannerDriver, 'product write');
    chain.check('read-only-refused', false, 'requireWriteDriver accepted a read-only driver');
  } catch (error) {
    chain.refuse('driver-write', error);
    chain.check('read-only-refused', error.code === 'DRIVER_WRITE_REFUSED', error.message);
  }
  try {
    chain.runner.dispatch({
      runnerId: RUNNER_ID, run: chain.runId, gate: 'plan', inputDigest: chain.candidateDigest,
      policyDigest: chain.policy.digest, attempt: 1, epoch: 1, role: 'builder', execution: 'exec-phase-probe',
      phase: 'build',
    });
    chain.check('phase-field-refused', false, 'the runner accepted a phase field');
  } catch (error) {
    chain.refuse('runner-dispatch', error);
    chain.check('phase-field-refused', error.code === 'RUNNER_PHASE_FIELD_REFUSED', error.message);
  }

  chain.check('no-dispatch', chain.dispatchLedger.length === 0, `dispatch ledger length ${chain.dispatchLedger.length}`);
  const runStateAfter = fs.existsSync(chain.runStateFile) ? digestFile(chain.runStateFile) : null;
  chain.check('run-state-unchanged', runStateBefore === null && runStateAfter === null, 'a plan-only request persists no control state (byte-level oracle)');
  chain.journey = 'plan-only-observed';
}

// Shared author step: the test-author lands a staged authoring source through
// the managed write executor, then runs it for real.
function authorLandsAndRuns(chain, { staged, target, label, expectOutcome }) {
  const write = chain.managedWrite({ role: 'test-author', relPath: target, sourcePath: staged });
  chain.transition({
    role: 'test-author',
    action: 'write',
    inputSummary: `write ${target} from staged authoring source ${staged}`,
    verdict: 'written',
    basis: { kind: 'authoring', note: `authored bytes sha256 ${write.sha256}` },
  });
  const dispatch = chain.dispatch({ role: 'test-author', gate: 'unit:slugify' });
  const run = chain.runNodeTest({ cwd: chain.project, target, label, role: 'test-author' });
  const validRed = requireValidRed({ exitCode: run.exitCode, output: run.output });
  const result = run.outcome.kind === 'behavior-red' ? 'red' : run.outcome.kind === 'pass' ? 'pass' : 'unverified';
  const admitted = chain.admit({
    dispatch,
    envelope: chain.envelope({ dispatch, run, result }),
  });
  chain.transition({
    role: 'test-author',
    action: 'run-own-suite',
    inputSummary: { suite: target, label },
    verdict: result,
    dispatch: ledgerView(dispatch),
    basis: {
      kind: run.outcome.kind,
      validRed: validRed.ok,
      fail: run.summary?.fail ?? 0,
      total: run.summary?.tests ?? 0,
      note: validRed.ok ? 'valid behavior RED from a real node --test run' : validRed.reason,
    },
    artifacts: [run.artifact],
  });
  chain.check(`author-outcome-${label}`, run.outcome.kind === expectOutcome,
    `expected ${expectOutcome}, observed ${run.outcome.kind}${run.outcome.signatures.length ? ` (${run.outcome.signatures.join('; ')})` : ''}`);
  chain.check(`author-red-valid-${label}`, expectOutcome === 'pass' || validRed.ok, validRed.reason ?? 'valid RED');
  return { run, admitted, validRed };
}

function ledgerView(dispatch) {
  const { execution, role, attempt, epoch, gate, inputDigest, policyDigest, integrity } = dispatch;
  return { execution, role, attempt, epoch, gate, inputDigest, policyDigest, integrity };
}

// B02 — 产品功能缺失 → 测试作者发现行为 RED → 保留 RED 并交 Builder，不擅改产品源码。
function runB02(chain) {
  chain.check('plan-validated', chain.plan.ok, 'PlanBundle v1 validates');
  chain.persistRunState();
  const productBefore = digestFile(chain.candidateFile);

  const { validRed } = authorLandsAndRuns(chain, {
    staged: 'test-sources/feature.strong.test.js',
    target: 'test/feature.strong.test.js',
    label: 'b02-author-strong',
    expectOutcome: 'behavior-red',
  });

  chain.transition({
    role: 'test-author',
    action: 'route',
    route: 'builder',
    inputSummary: { red: true, suite: 'test/feature.strong.test.js' },
    verdict: 'routed',
    basis: { kind: 'behavior-red', note: 'valid behavior RED kept and handed to the Builder (product source untouched)' },
  });

  // 不擅改产品源码: the author's out-of-scope write attempt is refused.
  try {
    chain.managedWrite({ role: 'test-author', relPath: 'src/feature.js', sourcePath: 'variants/correct.js' });
    chain.check('author-path-refused', false, 'the author write into src/ was accepted');
  } catch (error) {
    chain.refuse('driver-write', error);
    chain.check('author-path-refused', error.code === 'ROLE_PATH_REFUSED', error.message);
    chain.transition({
      role: 'test-author',
      action: 'write',
      inputSummary: 'attempted write src/feature.js (out of the author dev-task bounds)',
      verdict: 'refused',
      basis: { kind: 'role-paths', note: error.message },
    });
  }

  const productAfter = digestFile(chain.candidateFile);
  chain.check('product-unchanged', productAfter === productBefore, 'product source stayed byte-identical');
  chain.check('red-kept', validRed.ok, 'the RED is recorded, not silently resolved by the author');
  chain.journey = 'red-kept-routed-to-builder';
}

// B03 — 作者测试自检全绿 → 仅记 authoring 自检，不签独立验收。
function runB03(chain) {
  chain.check('plan-validated', chain.plan.ok, 'PlanBundle v1 validates');
  chain.persistRunState();

  const { admitted } = authorLandsAndRuns(chain, {
    staged: 'test-sources/feature.strong.test.js',
    target: 'test/feature.strong.test.js',
    label: 'b03-author-strong',
    expectOutcome: 'pass',
  });

  chain.check('authoring-class', admitted.ok === true, 'the author self-check was admitted');
  chain.check('authoring-class-label', chain.admitted[0]?.class === 'authoring-self-check',
    `admitted class ${chain.admitted[0]?.class}`);

  const gate = chain.gateEvaluate([{ level: 'unit', capability: 'unit:slugify' }], admitted.ok ? [admitted.entry] : []);
  chain.gate = { requiredChecks: [{ level: 'unit', capability: 'unit:slugify' }], verdict: gate.verdict, receipt: gate.receipt };
  chain.check('gate-blocked', gate.verdict === 'blocked', `gate verdict ${gate.verdict}`);
  chain.check('gate-reason', gate.receipt.blocked.some((reason) => /AUTHORING_SELF_CHECK_ONLY/.test(reason)),
    gate.receipt.blocked.join(' | '));
  chain.check('nothing-accepted', gate.receipt.requiredDenominator.valid === 0, 'no required check independently closed');
  chain.journey = 'blocked-authoring-self-check-only';
}

// B04 — Whitebox 发现弱 oracle 或缺 case → 返回测试作者，不偷偷改冻结测试。
function runB04(chain) {
  chain.check('plan-validated', chain.plan.ok, 'PlanBundle v1 validates');
  chain.persistRunState();

  // The author lands both suites; they are frozen from here on.
  const frozen = [];
  for (const [staged, target] of [
    ['test-sources/feature.weak.test.js', 'test/feature.weak.test.js'],
    ['test-sources/feature.strong.test.js', 'test/feature.strong.test.js'],
  ]) {
    chain.managedWrite({ role: 'test-author', relPath: target, sourcePath: staged });
    frozen.push({ file: target, digestBefore: digestFile(path.join(chain.project, target)) });
  }
  chain.frozenTests = frozen.map((entry) => ({ ...entry, digestAfter: entry.digestBefore }));

  // Whitebox mutation probe: run each frozen suite UNCHANGED against a real
  // defective candidate (identity slugify — violates the AC). A suite that
  // passes there has a weak oracle.
  const probeDir = path.join(chain.project, 'probe');
  const defective = fs.readFileSync(path.join(chain.project, 'variants', 'defective.js'));
  chain.managedWrite({ role: 'whitebox', relPath: 'probe/src/feature.js', bytes: defective });

  for (const target of ['test/feature.weak.test.js', 'test/feature.strong.test.js']) {
    const suiteBytes = fs.readFileSync(path.join(chain.project, target));
    chain.managedWrite({ role: 'whitebox', relPath: `probe/${target}`, bytes: suiteBytes });
    const dispatch = chain.dispatch({ role: 'whitebox', gate: `probe:${target}` });
    const run = chain.runNodeTest({ cwd: probeDir, target: `./${target}`, label: `b04-probe-${path.basename(target, '.test.js')}`, role: 'whitebox' });
    const outcome = run.outcome.kind === 'behavior-red' ? 'red' : run.outcome.kind;
    const gap = outcome === 'pass'
      ? { kind: 'weak-oracle', suite: target, probeOutcome: 'pass', basis: 'the suite passed on the defective probe candidate — the oracle cannot detect the AC violation' }
      : null;
    chain.probes.push({ suite: target, probeOutcome: outcome, gap, artifact: run.artifact });
    if (gap) chain.gaps.push(gap);
    chain.transition({
      role: 'whitebox',
      action: 'mutation-probe',
      inputSummary: { suite: target, probeCandidate: 'variants/defective.js (identity slugify)' },
      verdict: outcome,
      dispatch: ledgerView(dispatch),
      basis: { kind: outcome === 'pass' ? 'weak-oracle' : 'detects-defect', note: gap?.basis ?? 'the suite fails on the defective probe candidate' },
      artifacts: [run.artifact],
    });
  }

  const weakGap = chain.gaps.find((entry) => /weak/.test(entry.suite));
  chain.check('weak-gap-raised', Boolean(weakGap) && chain.gaps.length === 1, JSON.stringify(chain.gaps));
  const strongProbe = chain.probes.find((probe) => /strong/.test(probe.suite));
  chain.check('strong-no-gap', Boolean(strongProbe) && strongProbe.probeOutcome === 'red' && strongProbe.gap === null,
    `strong probe outcome ${strongProbe?.probeOutcome}`);

  for (const frozenEntry of chain.frozenTests) {
    frozenEntry.digestAfter = digestFile(path.join(chain.project, frozenEntry.file));
    chain.check(`frozen-${path.basename(frozenEntry.file)}`, frozenEntry.digestBefore === frozenEntry.digestAfter,
      `${frozenEntry.file} byte-identical through the probe`);
  }

  if (weakGap) {
    chain.transition({
      role: 'whitebox',
      action: 'route',
      route: 'test-author',
      inputSummary: { gap: weakGap },
      verdict: 'routed',
      basis: { kind: 'weak-oracle', note: `${weakGap.suite} passed on the defective probe candidate; the gap is returned to the test author — the frozen test is not patched here` },
    });
  }
  chain.check('routed-test-author', Boolean(weakGap), 'weak-oracle gap routes back to the test author');
  chain.journey = 'weak-oracle-routed-to-test-author';
}

// B05 — Whitebox 发现产品缺陷 → Builder 产生新候选后重新独立验收。
function runB05(chain) {
  chain.check('plan-validated', chain.plan.ok, 'PlanBundle v1 validates');
  chain.persistRunState();

  // The Builder's flawed candidate v1 is the current candidate (defective).
  chain.managedWrite({ role: 'test-author', relPath: 'test/feature.strong.test.js', sourcePath: 'test-sources/feature.strong.test.js' });

  // Whitebox v1 verification: real RED.
  const v1Dispatch = chain.dispatch({ role: 'whitebox', gate: 'unit:slugify' });
  const v1Run = chain.runNodeTest({ cwd: chain.project, target: 'test/feature.strong.test.js', label: 'b05-whitebox-v1', role: 'whitebox' });
  const v1Envelope = chain.envelope({ dispatch: v1Dispatch, run: v1Run, result: 'red' });
  const v1Admitted = chain.admit({ dispatch: v1Dispatch, envelope: v1Envelope });
  chain.check('v1-red', v1Run.outcome.kind === 'behavior-red', `v1 run outcome ${v1Run.outcome.kind}`);
  chain.check('v1-admitted', v1Admitted.ok === true, v1Admitted.ok ? 'v1 RED receipt admitted' : v1Admitted.error);
  chain.transition({
    role: 'whitebox',
    action: 'verify-candidate',
    inputSummary: { candidate: chain.candidateDigest, suite: 'test/feature.strong.test.js' },
    verdict: 'red',
    dispatch: ledgerView(v1Dispatch),
    basis: { kind: 'behavior-red', note: 'product defect: slugify violates the AC on candidate v1' },
    artifacts: [v1Run.artifact],
  });
  chain.transition({
    role: 'whitebox',
    action: 'route',
    route: 'builder',
    inputSummary: { red: true, candidate: chain.candidateDigest },
    verdict: 'routed',
    basis: { kind: 'behavior-red', note: 'product defect found by independent verification; returned to the Builder' },
  });

  // Builder produces a genuinely new candidate; the candidate digest rotates.
  const builderWriteResult = chain.managedWrite({ role: 'builder', relPath: 'src/feature.js', sourcePath: 'variants/correct.js' });
  chain.transition({
    role: 'builder',
    action: 'write',
    inputSummary: `write src/feature.js from variants/correct.js (new candidate sha256 ${builderWriteResult.sha256})`,
    verdict: 'written',
    basis: { kind: 'candidate', note: 'the Builder fixes the product defect; the candidate digest rotates' },
  });
  chain.candidateDigest = digestFile(chain.candidateFile);
  chain.persistRunState();
  const builderWrite = chain.transitions.filter((step) => step.role === 'builder' && step.verdict === 'written');
  chain.check('builder-wrote', builderWrite.length === 1, 'the builder write of the new candidate is recorded');
  chain.check('new-candidate', chain.candidateDigest !== chain.candidateDigestBefore, 'the new candidate digest differs from v1');

  // 候选改变重验 (negative): the v1-era receipt cannot serve the new candidate.
  const staleAdmission = admitEvidence({
    envelope: v1Envelope,
    dispatch: v1Dispatch,
    authority: chain.authority,
    current: { inputDigest: chain.candidateDigest, policyDigest: chain.policy.digest, environment: chain.environment },
    issuedExecutions: chain.issuedExecutions,
  });
  if (!staleAdmission.ok) {
    chain.refuse('admit-stale', { code: staleAdmission.error, message: staleAdmission.reason });
  }
  chain.check('stale-candidate-refused', staleAdmission.error === 'STALE_CANDIDATE', staleAdmission.reason ?? 'v1 envelope admitted at v2?!');

  const staleGate = chain.gateEvaluate([{ level: 'unit', capability: 'unit:slugify' }], v1Admitted.ok ? [v1Admitted.entry] : []);
  chain.gateStale = { verdict: staleGate.verdict, blocked: staleGate.receipt.blocked };
  chain.check('stale-gate-input', staleGate.receipt.blocked.some((reason) => /STALE_INPUT/.test(reason)),
    staleGate.receipt.blocked.join(' | '));

  // Whitebox re-verification: a FRESH dispatch bound to the NEW candidate.
  const v2Dispatch = chain.dispatch({ role: 'whitebox', gate: 'unit:slugify' });
  const v2Run = chain.runNodeTest({ cwd: chain.project, target: 'test/feature.strong.test.js', label: 'b05-whitebox-v2', role: 'whitebox' });
  const v2Envelope = chain.envelope({ dispatch: v2Dispatch, run: v2Run, result: 'pass' });
  const v2Admitted = chain.admit({ dispatch: v2Dispatch, envelope: v2Envelope });
  chain.check('v2-pass', v2Run.outcome.kind === 'pass', `v2 run outcome ${v2Run.outcome.kind}`);
  chain.check('v2-admitted', v2Admitted.ok === true, v2Admitted.ok ? 'v2 pass receipt admitted' : v2Admitted.error);
  chain.transition({
    role: 'whitebox',
    action: 'reverify-candidate',
    inputSummary: { candidate: chain.candidateDigest, suite: 'test/feature.strong.test.js' },
    verdict: 'pass',
    dispatch: ledgerView(v2Dispatch),
    basis: { kind: 'pass', note: 're-verification executed on the new candidate with a fresh dispatch (attempt 2)' },
    artifacts: [v2Run.artifact],
  });
  chain.check('reverify-bound-to-new-candidate', v2Dispatch.inputDigest === chain.candidateDigest && v2Dispatch.attempt === 2,
    `attempt ${v2Dispatch.attempt}, inputDigest bound to ${v2Dispatch.inputDigest === chain.candidateDigest ? 'the new candidate' : 'something else'}`);

  const gate = chain.gateEvaluate([{ level: 'unit', capability: 'unit:slugify' }], v2Admitted.ok ? [v2Admitted.entry] : []);
  chain.gate = { requiredChecks: [{ level: 'unit', capability: 'unit:slugify' }], verdict: gate.verdict, receipt: gate.receipt };
  chain.check('gate-pass-new-candidate', gate.verdict === 'pass' && gate.receipt.inputDigest === chain.candidateDigest,
    `gate ${gate.verdict} bound to ${gate.receipt.inputDigest}`);
  chain.journey = 're-accepted-on-new-candidate';
}

// B06 — 必验 console 缺失但 DOM/截图通过 → 必验项未闭合，服务日志不能冒充 console。
function runB06(chain) {
  chain.check('plan-validated', chain.plan.ok, 'PlanBundle v1 validates');
  chain.persistRunState();
  chain.managedWrite({ role: 'test-author', relPath: 'test/dom.test.js', sourcePath: 'test-sources/dom.test.js' });
  chain.transition({
    role: 'test-author',
    action: 'write',
    inputSummary: 'write test/dom.test.js from staged authoring source',
    verdict: 'written',
    basis: { kind: 'authoring', note: 'DOM check authored' },
  });

  const domDispatch = chain.dispatch({ role: 'whitebox', gate: 'dom' });
  const domRun = chain.runNodeTest({ cwd: chain.project, target: 'test/dom.test.js', label: 'b06-dom', role: 'whitebox' });
  const domEnvelope = chain.envelope({ dispatch: domDispatch, run: domRun, result: 'pass' });
  const domAdmitted = chain.admit({ dispatch: domDispatch, envelope: domEnvelope });
  chain.check('dom-pass', domRun.outcome.kind === 'pass' && domAdmitted.ok === true, `dom ${domRun.outcome.kind}`);

  // The service log is a real artifact of this run: the controller's own
  // transition log. It observes the run, but it is not the program console.
  const logLines = chain.transitions.map((step) => `seq=${step.seq} role=${step.role} action=${step.action} verdict=${step.verdict}`);
  const logArtifact = chain.writeArtifact('whitebox', 'b06-service-log.txt', `${logLines.join('\n')}\n`);
  const logDispatch = chain.dispatch({ role: 'whitebox', gate: 'service-log' });
  const logEnvelope = chain.envelope({
    dispatch: logDispatch,
    run: null,
    result: 'pass',
    executions: { total: 1, valid: 1 },
    evidence: [{ uri: logArtifact.relPath, sha256: logArtifact.sha256 }],
  });
  const logAdmitted = chain.admit({ dispatch: logDispatch, envelope: logEnvelope });
  chain.check('service-log-admitted', logAdmitted.ok === true, 'the service-log observation is admitted for what it is');

  // Substitution attempt: a service-log execution claims the console check.
  const logDispatch2 = chain.dispatch({ role: 'whitebox', gate: 'service-log' });
  const forgedEnvelope = chain.envelope({ dispatch: logDispatch2, run: null, result: 'pass', executions: { total: 1, valid: 1 }, evidence: [logArtifact] });
  forgedEnvelope.check = 'console';
  const forged = chain.admit({ dispatch: logDispatch2, envelope: forgedEnvelope });
  chain.check('binding-refused', forged.ok === false && chain.refusals.some((refusal) => refusal.code === 'CHECK_BINDING_MISMATCH'),
    'a service-log execution cannot observe the console check');

  // Negative-phase gate: console stays open, dom is closed.
  const negativeGate = chain.gateEvaluate(
    [{ level: 'ui', capability: 'console' }, { level: 'ui', capability: 'dom' }],
    [domAdmitted.entry, logAdmitted.entry].filter((entry) => entry),
  );
  chain.gatePhases.negative = { verdict: negativeGate.verdict, receipt: negativeGate.receipt };
  chain.check('console-open', negativeGate.receipt.blocked.some((reason) => /MISSING_OBSERVATION: required check ui\/console/.test(reason)),
    negativeGate.receipt.blocked.join(' | '));
  chain.check('dom-closed', !negativeGate.receipt.blocked.some((reason) => /MISSING_OBSERVATION: required check ui\/dom/.test(reason)),
    'the DOM check closes with its real receipt');

  // Positive phase: the console closes only after a REAL captured console run.
  const consoleDispatch = chain.dispatch({ role: 'whitebox', gate: 'console' });
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const consoleRun = spawnSync(process.execPath, ['src/feature.js'], { cwd: chain.project, encoding: 'utf8', timeout: 60_000, env });
  const consoleArtifact = chain.writeArtifact('whitebox', 'b06-console-capture.txt', consoleRun.stdout ?? '');
  const consoleEnvelope = chain.envelope({
    dispatch: consoleDispatch,
    run: null,
    result: consoleRun.status === 0 ? 'pass' : 'unverified',
    executions: { total: 1, valid: consoleRun.status === 0 ? 1 : 0 },
    evidence: [{ uri: consoleArtifact.relPath, sha256: consoleArtifact.sha256 }],
  });
  const consoleAdmitted = chain.admit({ dispatch: consoleDispatch, envelope: consoleEnvelope });
  chain.transition({
    role: 'whitebox',
    action: 'capture-console',
    inputSummary: { check: 'console', command: 'node src/feature.js' },
    verdict: consoleRun.status === 0 ? 'pass' : 'unverified',
    dispatch: ledgerView(consoleDispatch),
    basis: { kind: 'real-capture', note: 'the console observation is the captured stdout stream of the real program run' },
    artifacts: [{ uri: consoleArtifact.relPath, sha256: consoleArtifact.sha256 }],
  });
  chain.check('console-captured', consoleRun.status === 0 && /hello-world/.test(consoleRun.stdout ?? ''), 'real console stream captured');
  chain.check('console-admitted', consoleAdmitted.ok === true, consoleAdmitted.ok ? 'console receipt admitted' : consoleAdmitted.error);

  const gate = chain.gateEvaluate(
    [{ level: 'ui', capability: 'console' }, { level: 'ui', capability: 'dom' }],
    [domAdmitted.entry, logAdmitted.entry, consoleAdmitted.entry].filter((entry) => entry),
  );
  chain.gate = { requiredChecks: [{ level: 'ui', capability: 'console' }, { level: 'ui', capability: 'dom' }], verdict: gate.verdict, receipt: gate.receipt };
  chain.check('gate-pass-both', gate.verdict === 'pass' && gate.receipt.requiredDenominator.valid === 2,
    `gate ${gate.verdict}, valid ${gate.receipt.requiredDenominator.valid}`);
  chain.journey = 'console-closed-after-real-capture';
}

// B07 — 旧 Journey/Slice 与新契约版本不兼容 → 明确拒绝或经审查迁移，不虚构字段。
function runB07(chain) {
  chain.check('plan-validated', chain.plan.ok, 'PlanBundle v1 validates');
  chain.persistRunState();
  chain.managedWrite({ role: 'test-author', relPath: 'test/feature.strong.test.js', sourcePath: 'test-sources/feature.strong.test.js' });

  const dispatch = chain.dispatch({ role: 'whitebox', gate: 'unit:slugify' });
  const run = chain.runNodeTest({ cwd: chain.project, target: 'test/feature.strong.test.js', label: 'b07-whitebox', role: 'whitebox' });
  const v1Envelope = chain.envelope({ dispatch, run, result: 'pass' });

  // The legacy journey record: the same observation wrapped in the old
  // contract version (schemaVersion 0). It is refused explicitly — nothing is
  // fabricated or silently migrated.
  const legacy = JSON.parse(JSON.stringify(v1Envelope));
  legacy.schemaVersion = 0;
  const legacyResult = chain.admit({ dispatch, envelope: legacy });
  chain.check('legacy-refused', legacyResult.ok === false && chain.refusals.some((refusal) => refusal.code === 'INVALID_ENVELOPE'),
    chain.refusals.find((refusal) => refusal.code === 'INVALID_ENVELOPE')?.reason ?? 'legacy envelope admitted');
  chain.check('legacy-reason', /older than supported/.test(chain.refusals.find((refusal) => refusal.code === 'INVALID_ENVELOPE')?.reason ?? ''),
    'the refusal names the incompatible version explicitly');

  // The current-version record imports.
  const v1Result = chain.admit({ dispatch, envelope: v1Envelope });
  chain.check('v1-admitted', v1Result.ok === true, v1Result.ok ? 'v1 record admitted' : v1Result.error);
  chain.check('exactly-one-admitted', chain.admitted.length === 1 && chain.admitted[0].class === 'independent-acceptance',
    `admitted ${chain.admitted.length}`);
  chain.journey = 'legacy-refused-v1-admitted';
}

// F08 — 关联截图、请求和独立业务读回；缺能力保持未验证。
function runF08(chain) {
  chain.check('plan-validated', chain.plan.ok, 'PlanBundle v1 validates');
  chain.persistRunState();

  // Capability inventory: recorded from what this environment can REALLY do.
  chain.capabilityInventory.push(
    { capability: 'cli-stdout-capture', available: true, basis: 'real program runs are captured to artifacts in this choreography' },
    { capability: 'file-readback', available: true, basis: 'independent file readback is available in this choreography' },
    { capability: 'native-browser', available: false, basis: 'pilot registered CLI-only surface (pilot-contract.md negativeAc.ui); no native browser automation is registered in this environment' },
  );
  const inventoryArtifact = chain.writeArtifact('whitebox', 'f08-capability-inventory.json',
    `${JSON.stringify(chain.capabilityInventory, null, 2)}\n`);

  // Session 1: full correlation — capture + request record + independent
  // business readback, all under one session id.
  const s1 = `s-${crypto.randomBytes(4).toString('hex')}`;
  const stateFile = path.join(chain.project, 'state', 'business-state.json');
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const started = Date.now();
  const interaction = spawnSync(process.execPath, ['src/feature.js', path.relative(chain.project, stateFile)], {
    cwd: chain.project, encoding: 'utf8', timeout: 60_000, env,
  });
  const captureArtifact = chain.writeArtifact('whitebox', `f08-${s1}-capture.txt`, interaction.stdout ?? '');
  const requestRecord = { sessionId: s1, argv: ['node', 'src/feature.js', path.relative(chain.project, stateFile)], exitCode: interaction.status, durationMs: Date.now() - started };
  const requestArtifact = chain.writeArtifact('whitebox', `f08-${s1}-request.json`, `${JSON.stringify(requestRecord, null, 2)}\n`);

  // Independent business readback: the whitebox reads the persisted business
  // state itself and records the digest it observed.
  const stateBytes = fs.existsSync(stateFile) ? fs.readFileSync(stateFile) : null;
  const readbackRecord = { sessionId: s1, file: path.relative(chain.project, stateFile), sha256: stateBytes ? sha256(stateBytes) : null, observed: stateBytes !== null };
  const readbackArtifact = chain.writeArtifact('whitebox', `f08-${s1}-readback.json`, `${JSON.stringify(readbackRecord, null, 2)}\n`);

  const kinds = ['capture', 'request', stateBytes ? 'readback' : null].filter(Boolean);
  const complete = kinds.length === 3 && kinds.every((kind) => kind);
  chain.sessions.push({
    sessionId: s1,
    kinds,
    complete,
    artifacts: [
      { kind: 'capture', uri: captureArtifact.relPath, sha256: captureArtifact.sha256 },
      { kind: 'request', uri: requestArtifact.relPath, sha256: requestArtifact.sha256 },
      { kind: 'readback', uri: readbackArtifact.relPath, sha256: readbackRecord.sha256 },
    ],
  });
  chain.check('correlation-complete', complete && readbackRecord.observed, 'capture + request + independent readback are correlated under one session id');
  chain.check('readback-matches-disk', readbackRecord.sha256 === digestFile(stateFile), 'the recorded readback digest equals the persisted state bytes');

  const iaDispatch = chain.dispatch({ role: 'whitebox', gate: 'cli-interaction' });
  const iaEnvelope = chain.envelope({
    dispatch: iaDispatch,
    run: null,
    result: complete ? 'pass' : 'unverified',
    executions: { total: 1, valid: complete ? 1 : 0 },
    evidence: [
      { uri: captureArtifact.relPath, sha256: captureArtifact.sha256 },
      { uri: requestArtifact.relPath, sha256: requestArtifact.sha256 },
      { uri: readbackArtifact.relPath, sha256: readbackArtifact.sha256 },
    ],
  });
  const iaAdmitted = chain.admit({ dispatch: iaDispatch, envelope: iaEnvelope });
  chain.check('cli-interaction-admitted', iaAdmitted.ok === true && complete, 'the correlated CLI interaction evidence is admitted');

  // Session 2: partial — the interaction ran without its business write, so
  // the readback half is missing. The aggregator refuses the correlation.
  const s2 = `s-${crypto.randomBytes(4).toString('hex')}`;
  const partialStarted = Date.now();
  const partialRun = spawnSync(process.execPath, ['src/feature.js'], { cwd: chain.project, encoding: 'utf8', timeout: 60_000, env });
  const partialCapture = chain.writeArtifact('whitebox', `f08-${s2}-capture.txt`, partialRun.stdout ?? '');
  const partialRequest = chain.writeArtifact('whitebox', `f08-${s2}-request.json`, `${JSON.stringify({ sessionId: s2, argv: ['node', 'src/feature.js'], exitCode: partialRun.status, durationMs: Date.now() - partialStarted }, null, 2)}\n`);
  const expectedPartialState = path.join(chain.project, 'state', 'business-state-s2.json');
  const partialObserved = fs.existsSync(expectedPartialState);
  chain.sessions.push({
    sessionId: s2,
    kinds: ['capture', 'request'],
    complete: false,
    artifacts: [
      { kind: 'capture', uri: partialCapture.relPath, sha256: partialCapture.sha256 },
      { kind: 'request', uri: partialRequest.relPath, sha256: partialRequest.sha256 },
    ],
  });
  if (!partialObserved) {
    chain.refuse('correlation', { code: 'CORRELATION_INCOMPLETE', message: `session ${s2} collected capture and request but the independent business readback found no persisted state at ${path.relative(chain.project, expectedPartialState)} — a partial session never issues a pass` });
  }
  chain.check('partial-refused', chain.refusals.some((refusal) => refusal.code === 'CORRELATION_INCOMPLETE'),
    'the partial session is refused, never converted into a pass');

  // Missing capability: the browser check is recorded as unverified — the
  // honest landing for a capability this pilot does not have.
  const browserDispatch = chain.dispatch({ role: 'whitebox', gate: 'browser-console' });
  const browserEnvelope = chain.envelope({
    dispatch: browserDispatch,
    run: null,
    result: 'unverified',
    executions: { total: 0, valid: 0 },
    evidence: [{ uri: inventoryArtifact.relPath, sha256: inventoryArtifact.sha256 }],
  });
  const browserAdmitted = chain.admit({ dispatch: browserDispatch, envelope: browserEnvelope });
  chain.check('browser-unverified', browserAdmitted.ok === true, 'the absent capability is recorded as unverified, never as pass');

  const gate = chain.gateEvaluate(
    [{ level: 'ui', capability: 'cli-interaction' }, { level: 'ui', capability: 'browser-console' }],
    [iaAdmitted.entry, browserAdmitted.entry].filter((entry) => entry),
  );
  chain.gate = {
    requiredChecks: [{ level: 'ui', capability: 'cli-interaction' }, { level: 'ui', capability: 'browser-console' }],
    verdict: gate.verdict,
    receipt: gate.receipt,
  };
  chain.check('gate-blocked-on-unverified',
    gate.verdict === 'blocked' && gate.receipt.blocked.some((reason) => /UNVERIFIED_CAPABILITY: browser-console/.test(reason)),
    gate.receipt.blocked.join(' | '));
  chain.check('only-correlated-check-closed', gate.receipt.requiredDenominator.valid === 1, `valid ${gate.receipt.requiredDenominator.valid}`);
  chain.journey = 'cli-correlated-browser-unverified';
}

// A15 — UI 显示保存成功 → 独立检查持久化 → 未落盘则 Journey 失败。
function runA15(chain) {
  chain.check('plan-validated', chain.plan.ok, 'PlanBundle v1 validates');
  chain.persistRunState();
  const claimOnly = chain.variant === 'claim-only';
  const stateFile = path.join(chain.project, 'state', 'saved-state.json');

  // Builder save claim.
  if (claimOnly) {
    chain.transition({
      role: 'builder',
      action: 'save-claim',
      inputSummary: 'claims the save without performing the write (claim-only variant)',
      verdict: 'claim-success',
      basis: { kind: 'claim', note: 'the builder reports save success' },
    });
  } else {
    const write = chain.managedWrite({
      role: 'builder',
      relPath: 'state/saved-state.json',
      bytes: `${JSON.stringify({ claim: 'saved', payload: { slug: 'hello-world' } }, null, 2)}\n`,
    });
    chain.transition({
      role: 'builder',
      action: 'save-claim',
      inputSummary: `write state/saved-state.json (sha256 ${write.sha256})`,
      verdict: 'claim-success',
      basis: { kind: 'claim', note: 'the builder reports save success' },
    });
  }

  // Independent persistence check: the whitebox reads the disk itself.
  const persisted = fs.existsSync(stateFile);
  const readbackArtifact = chain.writeArtifact('whitebox', `a15-readback-${claimOnly ? 'claim' : 'ok'}.json`,
    `${JSON.stringify({ file: path.relative(chain.project, stateFile), persisted, sha256: persisted ? digestFile(stateFile) : null }, null, 2)}\n`);
  chain.transition({
    role: 'whitebox',
    action: 'independent-readback',
    inputSummary: { file: path.relative(chain.project, stateFile) },
    verdict: persisted ? 'ok' : 'failed',
    basis: { kind: persisted ? 'persisted' : 'not-persisted', note: persisted ? 'the claimed save is on disk' : 'the success claim never reached disk (A15)' },
    artifacts: [{ uri: readbackArtifact.relPath, sha256: persisted ? digestFile(stateFile) : readbackArtifact.sha256 }],
  });

  if (persisted) {
    const recorded = JSON.parse(fs.readFileSync(path.join(chain.project, readbackArtifact.relPath), 'utf8'));
    chain.check('persisted-readback', recorded.sha256 === digestFile(stateFile), 'the readback digest matches the real bytes');
    chain.journey = 'persisted-readback-ok';
  } else {
    chain.transition({
      role: 'whitebox',
      action: 'route',
      route: 'builder',
      inputSummary: { persisted: false },
      verdict: 'routed',
      basis: { kind: 'not-persisted', note: 'save claim not persisted — independent readback found no bytes; the journey fails and returns to the Builder (A15)' },
    });
    chain.check('journey-fails', !persisted, 'not persisted means the journey fails, regardless of the success claim');
    chain.journey = 'journey-failed-not-persisted';
  }
}

const CHOREOGRAPHIES = {
  B01: runB01,
  B02: runB02,
  B03: runB03,
  B04: runB04,
  B05: runB05,
  B06: runB06,
  B07: runB07,
  F08: runF08,
  A15: runA15,
};

function main() {
  let options;
  try {
    options = parseArgs({
      strict: true,
      options: {
        scenario: { type: 'string' },
        project: { type: 'string' },
        evidence: { type: 'string' },
        variant: { type: 'string' },
        json: { type: 'boolean', default: false },
      },
    }).values;
  } catch (error) {
    console.error(JSON.stringify({ error: 'INVALID_INPUT', message: String(error?.message ?? error) }, null, 2));
    console.error(usage());
    return 1;
  }
  if (!options.scenario || !options.project || !options.evidence) {
    console.error(JSON.stringify({ error: 'INVALID_INPUT', message: '--scenario, --project and --evidence are required' }, null, 2));
    console.error(usage());
    return 1;
  }
  if (!SCENARIOS.includes(options.scenario)) {
    console.error(JSON.stringify({ error: 'UNKNOWN_SCENARIO', message: `unknown scenario ${JSON.stringify(options.scenario)} — registered scenarios: ${SCENARIOS.join(', ')}` }, null, 2));
    console.error(usage());
    return 1;
  }
  if (!fs.existsSync(options.project) || !fs.statSync(options.project).isDirectory()) {
    console.error(JSON.stringify({ error: 'INVALID_INPUT', message: `--project is not a directory: ${options.project}` }, null, 2));
    return 1;
  }

  const chain = new RoleChain({ scenario: options.scenario, variant: options.variant, project: path.resolve(options.project) });
  try {
    if (!chain.plan.ok) {
      chain.check('plan-validated', false, chain.plan.errors.join('; '));
    }
    CHOREOGRAPHIES[options.scenario](chain);
  } catch (error) {
    chain.checkpoints.push({ id: 'choreography-error', ok: false, detail: String(error?.stack ?? error) });
  }

  const { evidence, exitCode } = chain.finish();
  fs.mkdirSync(path.dirname(path.resolve(options.evidence)), { recursive: true });
  const tmp = `${options.evidence}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(evidence, null, 2)}\n`);
  fs.renameSync(tmp, options.evidence);
  if (options.json) console.log(JSON.stringify(evidence, null, 2));
  else console.log(`role-chain ${options.scenario}${options.variant ? ` [${options.variant}]` : ''}: ${evidence.verdict} (${evidence.journey}) exit=${exitCode}`);
  return exitCode;
}

process.exit(main());
