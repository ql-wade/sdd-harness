// P2_4 delivery case: the managed delivery runtime on the SAME Classic Run
// (patch 0002). Classic-gate-runtime-contract: one shared policy/receipt/
// evaluate surface consumed by every managed entrance — guard (preview and
// apply), direct transitions, the phase-guard write hook, next/continuation
// and recovery, state entry checks, archive/completion. D01–D08: author-
// written receipts without a Runtime dispatch are refused; inputs edited
// mid-review make the review result stale; structured rejections route rework
// on the same run (architecture-repair / test-design-repair / verify-fail);
// requirement/design revisions invalidate downstream receipts without being
// asked; implementation changes only invalidate candidate-scoped evidence;
// unknown knowledge results read back before acceptance; archived never
// completes a run with an unmet knowledge obligation; interrupted acceptance
// recovers to a consistent state. B1: a scope with registered required check
// identities only accepts evidence recorded by those identities — a trivial
// exit-0 command no longer passes. B4: COMET_SKIP_BUILD/COMET_FORCE_PHASE do
// not lower managed gates (upstream source hygiene; P1_4 recorded the
// downstream refusal surface, this pins the source side). Kt: the run-level
// knowledge seat blocks overall completion next to the Kp driver seal.
// Every interaction runs the real built CLI in scratch projects under $TMPDIR
// with an isolated HOME and PATH stubs; live host configuration is untouched.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// COMET_UPSTREAM_LOCK: pre-integration verification seam only. The contract
// commands run without it and resolve the repository lock, which stays the
// single source of truth; while a patch change awaits controller lock
// integration, a worker may point this at an integrity-identical lock copy
// (same archive/toolchain, only patch sha256 entries updated to the candidate).
const lockPath = process.env.COMET_UPSTREAM_LOCK
  ? path.resolve(process.env.COMET_UPSTREAM_LOCK)
  : path.join(projectRoot, 'integrations/comet/upstream.lock.json');
const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));

const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
  archive: lock.source.sha256,
  patches: lock.patches.map(({ path, sha256 }) => ({ path, sha256 })),
  toolchain: lock.toolchain,
})).digest('hex');
const CB1151B4 = 'cb1151b4f3a301c9f2e9da87695155bf05285c925ea4abbbcea7120c9413f187';
const buildDir = path.join(projectRoot, '.sdd/vendor/comet', lock.source.commit, 'builds', fingerprint);
const entrypoint = path.join(buildDir, 'work/bin/comet.js');

const built = await fs.access(path.join(buildDir, 'distribution.json')).then(() => true, () => false);
const prepared = await fs.access(path.join(projectRoot, '.sdd/vendor/comet', lock.source.commit, 'provenance.json')).then(() => true, () => false);

const pinnedNode = lock.toolchain.node;
let nodeExecutable = process.execPath;
if (process.versions.node !== pinnedNode) {
  const candidate = path.join(process.env.HOME ?? '', '.nvm/versions/node', `v${pinnedNode}`, 'bin/node');
  const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
  if (probe.status === 0 && probe.stdout.trim() === `v${pinnedNode}`) nodeExecutable = candidate;
}

const plain = (text) => String(text ?? '').replace(/\x1b\[[0-9;]*m/g, '');

// --- scratch world -----------------------------------------------------------
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'p24-case-'));
const fakeHome = path.join(scratch, 'home');
const stubs = path.join(scratch, 'stubs');
const project = path.join(scratch, 'managed');
await fs.mkdir(fakeHome, { recursive: true });
await fs.mkdir(stubs, { recursive: true });
await fs.mkdir(project, { recursive: true });
// The openspec stub creates the layout for init and performs the archive move
// exactly like the upstream CLI; npm/npx are neutralized (registered B6 gap).
await fs.writeFile(path.join(stubs, 'openspec'), `#!/bin/sh
pos1=""; pos2=""; count=0
for arg in "$@"; do
  case "$arg" in --*) ;; *) count=$((count+1)); if [ "$count" -eq 1 ]; then pos1="$arg"; elif [ "$count" -eq 2 ]; then pos2="$arg"; fi ;; esac
done
if [ "$pos1" = "init" ] && [ -n "$pos2" ]; then
  mkdir -p "$pos2/openspec" "$pos2/.claude/commands" "$pos2/.claude/skills"
  printf 'schema: openspec-1.0\\n' > "$pos2/openspec/config.yaml"
  echo "fake skill" > "$pos2/.claude/commands/openspec.md"
fi
if [ "$pos1" = "archive" ] && [ -n "$pos2" ] && [ -n "$COMET_PROJECT_ROOT" ]; then
  cd "$COMET_PROJECT_ROOT" || exit 0
  if [ -d "docs/openspec/changes/$pos2" ]; then
    mkdir -p "docs/openspec/changes/archive"
    mv "docs/openspec/changes/$pos2" "docs/openspec/changes/archive/$(date +%Y-%m-%d)-$pos2"
  fi
fi
exit 0
`, { mode: 0o755 });
for (const name of ['npm', 'npx']) {
  await fs.writeFile(path.join(stubs, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
}

const childEnv = (extra = {}) => {
  const { NODE_TEST_CONTEXT: _stripped, ...inherited } = process.env;
  return {
    ...inherited,
    HOME: fakeHome,
    COMET_PROJECT_ROOT: project,
    PATH: `${stubs}:${process.env.PATH ?? ''}`,
    ...extra,
  };
};

function comet(args, { env = {}, timeout = 180_000, cwd = project } = {}) {
  const result = spawnSync(nodeExecutable, [entrypoint, ...args], {
    cwd,
    encoding: 'utf8',
    timeout,
    env: childEnv(env),
  });
  let json = null;
  try { json = JSON.parse(result.stdout ?? ''); } catch { /* non-JSON output stays raw */ }
  return { ...result, json };
}

const issuesOf = (result) => (result.json?.data?.issues ?? []).map((issue) => issue.message ?? '').join('\n');
// Refusal text lands on stderr (plain mode) or in the JSON envelope's issues;
// both carry the same machine refusal contract.
const refusalText = (result) => {
  const envelope = plain(issuesOf(result));
  const stderrText = plain(result.stderr);
  const stdoutText = plain(result.stdout);
  return `${envelope}\n${stderrText}\n${stdoutText}`;
};
const failLine = (result) => plain(issuesOf(result)).split('\n').filter((line) => line.includes('[FAIL]')).join('\n');
const changeDir = (change) => path.join(project, 'docs/openspec/changes', change);

const writeArtifacts = async (change, { design = 'Managed probe design v1.' } = {}) => {
  const dir = changeDir(change);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'proposal.md'), '# Proposal\n\nManaged probe.\n');
  await fs.writeFile(path.join(dir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Implement probe product code\n');
  await fs.writeFile(path.join(dir, 'design.md'), `---\ncomet_change: ${change}\nrole: technical-design\ncanonical_spec: openspec\n---\n\n# Design\n\n${design}\n`);
  await fs.writeFile(path.join(dir, 'test-intent.md'), '# Test Intent\n\ncases: c1\noracle: probe behavior observed\n');
  // The plan lives in the configured Superpowers plans directory: the build
  // write hook resolves plan readiness relative to it (pre-existing rule).
  const plansDir = path.join(project, 'docs/superpowers/plans');
  await fs.mkdir(plansDir, { recursive: true });
  await fs.writeFile(path.join(plansDir, `${change}-plan.md`), '# Plan\n\n- 1.1 Implement probe product code\n');
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src/feature.js'), 'export const v1 = 1;\n');
  return dir;
};

const sha256Text = (text) => crypto.createHash('sha256').update(text).digest('hex');
const GATE_ROLE_OF = { R: 'requirements-owner', A: 'reviewer', T: 'reviewer', P: 'planner', V: 'verifier', K: 'knowledge-publisher' };

// This run's real multi-agent consensus receipt (read-only positive control):
// the architecture-gate evidence shape is taken verbatim from a genuinely
// executed unanimous review; the artifactDigest is re-bound to the dispatch
// inputDigest because the artifact under review here is the scratch change,
// not the plan bundle. Reviewer-independence itself is the I02 boundary and
// is NOT claimed here — this pins the Runtime's consumption of the result.
const consensusDir = path.join(projectRoot, 'openspec/changes/delivery-foundation-rearchitecture/consensus/2026-10-22-plan-r3');
const realTally = await fs.readFile(path.join(consensusDir, 'tally.json'), 'utf8').then((t) => JSON.parse(t), () => null);
const realConsensusManifest = await fs.readFile(path.join(consensusDir, 'manifest.json'), 'utf8').then((t) => JSON.parse(t), () => null);

const consensusForDispatch = (binding, overrides = {}) => ({
  reviewId: realConsensusManifest?.review_id ?? 'seven-p1-plan-20261022-r3',
  rule: 'unanimous',
  status: 'CLOSED',
  participants: (realConsensusManifest?.participants ?? ['claude-code', 'zcode', 'codex-agent']).slice(),
  ballots: (realTally?.ballots ?? []).map((ballot) => ({
    agent: ballot.agent,
    verdict: ballot.verdict,
    blockingFindings: ballot.blocking_findings,
    summaryDigest: sha256Text(String(ballot.summary ?? '')),
  })),
  artifactDigest: binding.inputDigest,
  ...overrides,
});

const testDesignForDispatch = (binding, overrides = {}) => ({
  verdict: 'sufficient',
  oracle: 'strong',
  inputDigest: binding.inputDigest,
  reviewer: 'test-authoring',
  findings: [],
  ...overrides,
});

// A compliant pass result: the dispatched binding echoed back, a real report
// and its digest, plus the gate-specific independent review evidence (A:
// unanimous consensus tally; T: test-design sufficiency with an adequate
// oracle; R/P/V: report binding).
const passEvidence = (gate, binding, extra = {}) => ({
  execution: binding.execution,
  attempt: binding.attempt,
  verdict: 'pass',
  role: GATE_ROLE_OF[gate],
  inputDigest: binding.inputDigest,
  report: `# Gate ${gate} independent review\n\nReviewed by ${GATE_ROLE_OF[gate]} over the dispatched inputs (${binding.inputDigest.slice(0, 12)}…).\n`,
  reportDigest: null, // filled below
  ...extra,
});
const withReportDigest = (result) => ({ ...result, reportDigest: sha256Text(result.report) });

const dispatchOf = (change, gate) => {
  const dispatched = comet(['state', 'dispatch-gate', change, gate, '--json']);
  assert.equal(dispatched.json?.exitCode, 0, `dispatch-gate ${gate} failed: ${plain(dispatched.stderr).slice(0, 200)}`);
  return dispatched.json?.data?.dispatch
    ?? JSON.parse((dispatched.stdout ?? '').trim().split('\n').pop());
};

const rawAccept = (change, gate, result) => {
  const resultFile = path.join(scratch, `raw-${change}-${gate}-${Math.random().toString(36).slice(2)}.json`);
  fsSync.writeFileSync(resultFile, JSON.stringify(result));
  return comet(['state', 'accept-gate', change, gate, '--file', resultFile, '--json']);
};

// Dispatch one gate and accept a fully evidenced pass result.
const acceptGate = (change, gate, { verdict = 'pass', findings, execution, attempt, evidence = {} } = {}) => {
  const binding = dispatchOf(change, gate);
  let result;
  if (verdict === 'pass') {
    result = withReportDigest(passEvidence(gate, binding, evidence));
    if (gate === 'A' && !('consensus' in evidence)) result.consensus = consensusForDispatch(binding);
    if (gate === 'T' && !('testDesignReview' in evidence)) result.testDesignReview = testDesignForDispatch(binding);
  } else {
    result = {
      execution: binding.execution,
      attempt: binding.attempt,
      verdict,
      ...(findings ? { findings } : {}),
    };
  }
  if (execution) result.execution = execution;
  if (attempt) result.attempt = attempt;
  const resultFile = path.join(scratch, `result-${change}-${gate}-${Math.random().toString(36).slice(2)}.json`);
  fsSync.writeFileSync(resultFile, JSON.stringify(result));
  const accepted = comet(['state', 'accept-gate', change, gate, '--file', resultFile, '--json']);
  assert.equal(accepted.json?.exitCode, 0, `accept-gate ${gate} failed: ${refusalText(accepted).slice(0, 300)}`);
  return { binding, result, accepted };
};

const acceptAll = (change, gates) => {
  for (const gate of gates) {
    const { accepted } = acceptGate(change, gate);
    assert.equal(accepted.json?.exitCode, 0, `accept-gate ${gate} failed: ${refusalText(accepted).slice(0, 250)}`);
  }
};

// Managed drive: init → artifacts → R/A/T accepted → design confirmed (the
// guard apply moves design→build; entering build re-checks R/A/T premises) →
// P accepted (the plan gate is required to dispatch build steps).
let projectInitPromise = null;
// --test-name-pattern runs skip the setup test, so every managed case lazily
// performs the project init itself (idempotent).
const ensureProjectInit = () => {
  if (!projectInitPromise) {
    projectInitPromise = (async () => {
      if (await fs.access(path.join(project, '.comet')).then(() => true, () => false)) return;
      const init = comet(['init', project, '--yes', '--scope', 'project', '--workflow', 'classic', '--platform', 'claude', '--codegraph', 'skip', '--language', 'en'], { timeout: 300_000 });
      assert.equal(init.status, 0, `comet init (classic) failed: ${plain(init.stderr).slice(0, 400)}`);
    })();
  }
  return projectInitPromise;
};

async function initManaged(change) {
  await ensureProjectInit();
  await writeArtifacts(change);
  assert.equal(comet(['state', 'init', change, 'full', '--managed-delivery', '--knowledge-closeout-required', 'true', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'select', change, '--json']).json?.exitCode, 0);
  const rel = `docs/openspec/changes/${change}`;
  assert.equal(comet(['state', 'set', change, 'design_doc', `${rel}/design.md`, 'test_intent', `${rel}/test-intent.md`, 'plan', `docs/superpowers/plans/${change}-plan.md`, '--json']).json?.exitCode, 0);
  // C01/RW_R_ENTRY: entering design is gated on a current R receipt, so the
  // trusted R is accepted before open-complete moves the run forward.
  acceptGate(change, 'R');
  const openComplete = comet(['state', 'transition', change, 'open-complete', '--json']);
  assert.equal(openComplete.json?.exitCode, 0, plain(openComplete.stderr ?? ''));
}

async function driveToBuild(change) {
  await initManaged(change);
  acceptAll(change, ['R', 'A', 'T', 'P']);
  assert.equal(comet(['state', 'complete-design', change, '--design-doc', `docs/openspec/changes/${change}/design.md`, '--json']).json?.exitCode, 0, plain(comet(['state', 'complete-design', change, '--design-doc', `docs/openspec/changes/${change}/design.md`, '--json']).stderr ?? ''));
  return changeDir(change);
}

const setBuildDecisions = (change) => {
  assert.equal(comet(['state', 'set', change, 'build_mode', 'executing-plans', 'tdd_mode', 'tdd', 'isolation', 'current', '--json']).json?.exitCode, 0);
};

const writeCheckPolicy = async () => {
  // The check policy is project-scoped (readCheckPolicy reads it relative to
  // the project root), exactly like the recorded probe evidence.
  await fs.mkdir(path.join(project, '.comet'), { recursive: true });
  await fs.writeFile(path.join(project, '.comet/check-policy.json'), JSON.stringify({
    version: 2,
    commands: [
      { argv: ['node', '-e', 'process.stdout.write("build-ok\\n")'], cwd: '.', requiredScope: 'build', files: ['src/feature.js'] },
      { argv: ['node', '-e', 'process.stdout.write("verify-ok\\n")'], cwd: '.', requiredScope: 'verify', files: ['src/feature.js'] },
    ],
  }, null, 2));
};

const skipIfNoBuild = (t) => {
  if (!prepared || !built) {
    t.skip('patched Comet build is not present in this project; run tools/comet/prepare-source.mjs && tools/comet/build.mjs --archive first');
    return true;
  }
  return false;
};

test('setup: the managed delivery build is manifest-verified and carries the 0002 extension', (t) => {
  if (skipIfNoBuild(t)) return;
  // lock revision: 6 patches @ beab355d (P2_4 0002 + P4_6 0003 + tests)
  assert.equal(lock.patches.length, 6, 'the lock must register 0001, tests/1_6, 0002, tests/2_4, 0003 and tests/4_6');
  assert.notEqual(fingerprint, CB1151B4, 'the 0002 managed delivery patch must produce a new fingerprint');
  const version = comet(['--version']);
  assert.equal(version.status, 0);
  assert.equal((version.stdout ?? '').trim(), lock.package.version);
  const init = comet(['init', project, '--yes', '--scope', 'project', '--workflow', 'classic', '--platform', 'claude', '--codegraph', 'skip', '--language', 'en'], { timeout: 300_000 });
  assert.equal(init.status, 0, `comet init (classic) failed: ${plain(init.stderr).slice(0, 400)}`);
});

test('D01 base: managed init wires machine-owned runtime fields; hand-written receipts are impossible', async (t) => {
  if (skipIfNoBuild(t)) return;
  const change = 'p24-d01';
  await writeArtifacts(change);
  const init = comet(['state', 'init', change, 'full', '--managed-delivery', '--knowledge-closeout-required', 'true', '--json']);
  assert.equal(init.json?.exitCode, 0, plain(init.stderr).slice(0, 300));
  assert.equal(comet(['state', 'get', change, 'managed_delivery']).stdout?.trim(), 'true');
  assert.equal(comet(['state', 'get', change, 'knowledge_closeout_required']).stdout?.trim(), 'true');
  // The gate receipts field is machine-owned: an author cannot self-write a
  // passed receipt into the state transaction.
  const forge = comet(['state', 'set', change, 'gate_receipts', '[{"gate":"R","verdict":"pass"}]', '--json']);
  assert.equal(forge.json?.exitCode !== 0, true, 'hand-setting gate_receipts must be refused');
  assert.match(refusalText(forge), /machine-owned/i);
  const forgePolicy = comet(['state', 'set', change, 'knowledge_closeout_required', 'false', '--json']);
  assert.equal(forgePolicy.json?.exitCode !== 0, true, 'hand-lowering the knowledge obligation must be refused');
  assert.match(refusalText(forgePolicy), /machine-owned/i);
});

test('D01: acceptance without a Runtime dispatch is refused; the dispatched path accepts', async (t) => {
  if (skipIfNoBuild(t)) return;
  const change = 'p24-d01b';
  await initManaged(change);
  // Author-submitted result with a fabricated execution id: no dispatch, no
  // acceptance — file presence and role labels grant nothing.
  const forged = path.join(scratch, 'forged-r.json');
  await fs.writeFile(forged, JSON.stringify({ execution: 'author-fabricated-exec', attempt: 1, verdict: 'pass' }));
  const refused = comet(['state', 'accept-gate', change, 'R', '--file', forged, '--json']);
  assert.equal(refused.json?.exitCode !== 0, true, 'a receipt without a Runtime dispatch must be refused');
  assert.match(refusalText(refused), /no Runtime dispatch/);
  assert.match(refusalText(refused), /D01/);
  // The Runtime-issued path: dispatch binds gate/role/execution/input digest.
  const { accepted, binding } = acceptGate(change, 'R');
  assert.equal(accepted.json?.exitCode, 0, plain(accepted.stderr).slice(0, 300));
  assert.equal(binding.role, 'requirements-owner');
  assert.match(binding.inputDigest, /^[a-f0-9]{64}$/);
  const receipts = JSON.parse(comet(['state', 'get', change, 'gate_receipts']).stdout?.trim() ?? '[]');
  // initManaged's trusted R plus this dispatch's accepted R — append-only.
  assert.equal(receipts.length, 2);
  assert.equal(receipts[0].gate, 'R');
  assert.equal(receipts[1].gate, 'R');
  assert.equal(receipts[1].execution, binding.execution);
});

test('D02: inputs modified while the review is in flight make the result stale — it cannot be accepted', async (t) => {
  if (skipIfNoBuild(t)) return;
  const change = 'p24-d02';
  await initManaged(change);
  acceptAll(change, ['R']);
  const dispatched = comet(['state', 'dispatch-gate', change, 'A', '--json']);
  assert.equal(dispatched.json?.exitCode, 0);
  const binding = dispatched.json?.data?.dispatch
    ?? JSON.parse((dispatched.stdout ?? '').trim().split('\n').pop());
  // The design changes under the in-flight review.
  await fs.writeFile(path.join(changeDir(change), 'design.md'), `---\ncomet_change: ${change}\nrole: technical-design\ncanonical_spec: openspec\n---\n\n# Design\n\nRevised under the review (v2).\n`);
  const staleResult = path.join(scratch, 'stale-a.json');
  await fs.writeFile(staleResult, JSON.stringify({ execution: binding.execution, attempt: binding.attempt, verdict: 'pass' }));
  const refused = comet(['state', 'accept-gate', change, 'A', '--file', staleResult, '--json']);
  assert.equal(refused.json?.exitCode !== 0, true, 'a result over changed inputs must be refused');
  assert.match(refusalText(refused), /stale/);
  assert.match(refusalText(refused), /D02/);
  // The old result stays historical; the CURRENT inputs need a new review.
  const reDispatch = comet(['state', 'dispatch-gate', change, 'A', '--json']);
  assert.equal(reDispatch.json?.exitCode, 0);
  const rebinding = reDispatch.json?.data?.dispatch
    ?? JSON.parse((reDispatch.stdout ?? '').trim().split('\n').pop());
  assert.equal(rebinding.attempt, 1, 'the attempt counter is per input version (rework budget semantics)');
  assert.notEqual(rebinding.inputDigest, binding.inputDigest, 'the re-dispatch binds the revised inputs');
  const good = path.join(scratch, 'good-a.json');
  const goodResult = withReportDigest(passEvidence('A', rebinding));
  goodResult.consensus = consensusForDispatch(rebinding);
  await fs.writeFile(good, JSON.stringify(goodResult));
  const accepted = comet(['state', 'accept-gate', change, 'A', '--file', good, '--json']);
  assert.equal(accepted.json?.exitCode, 0, plain(accepted.stderr).slice(0, 300));
});

test('D03: a structured rejection routes rework on the SAME run — architecture-repair, never hand phase edits', async (t) => {
  if (skipIfNoBuild(t)) return;
  const change = 'p24-d03';
  await initManaged(change);
  acceptAll(change, ['R']);
  const { accepted } = acceptGate(change, 'A', {
    verdict: 'reject',
    findings: ['design omits the failure-mode boundary for the probe writer'],
  });
  assert.equal(accepted.json?.exitCode, 0, 'the rejection itself is accepted as a receipt');
  assert.match(refusalText(accepted), /architecture-repair/);
  // The gate surface names the route; the resolver would block build steps.
  const gates = comet(['state', 'gates', change, '--json']);
  assert.equal(gates.json?.data?.evaluation?.rejected?.includes('A'), true);
  assert.match(JSON.stringify(gates.json?.data?.evaluation?.routes ?? []), /architecture-repair/);
  // The managed rework transition returns the SAME run to design.
  assert.equal(comet(['state', 'get', change, 'phase']).stdout?.trim(), 'design');
  const blockedWrite = comet(['state', 'transition', change, 'design-complete', '--json']);
  // Entering build with a rejected A is refused at the transition entrance.
  assert.equal(blockedWrite.json?.exitCode, 1, 'design-complete must refuse while A is rejected');
  // Hand phase edit stays impossible (with and without the escape variable).
  const handEdit = comet(['state', 'transition', change, 'architecture-repair', '--json']);
  assert.equal(handEdit.json?.exitCode, 1, 'architecture-repair requires the build phase; design-phase repair is direct');
  const forceHandEdit = comet(['state', 'set', change, 'phase', 'build', '--json',], { env: { COMET_FORCE_PHASE: '1' } });
  assert.equal(forceHandEdit.json?.exitCode, 1, 'COMET_FORCE_PHASE cannot hand-edit the phase in managed delivery');
  // Repair the design, re-dispatch, re-accept: the premise clears.
  await fs.writeFile(path.join(changeDir(change), 'design.md'), `---\ncomet_change: ${change}\nrole: technical-design\ncanonical_spec: openspec\n---\n\n# Design\n\nRepaired: the failure-mode boundary is now specified (v2).\n`);
  acceptAll(change, ['A', 'T', 'P']);
  assert.equal(comet(['state', 'complete-design', change, '--design-doc', `docs/openspec/changes/${change}/design.md`, '--json']).json?.exitCode, 0);
});

test('B1: a scope with registered required identities refuses trivial exit-0 evidence and accepts the registered command', async (t) => {
  if (skipIfNoBuild(t)) return;
  const change = 'p24-b1';
  const dir = await driveToBuild(change);
  setBuildDecisions(change);
  await writeCheckPolicy();
  // assign task ids (definition change), then P must be re-accepted: derived
  // invalidation recomputes the plan gate against the current definition.
  const tasks = comet(['state', 'tasks', change, '--assign-ids', '--json']).json;
  const taskId = tasks?.data?.tasks?.[0]?.id;
  acceptAll(change, ['P']);
  assert.equal(comet(['state', 'task-complete', change, taskId, '--expect', tasks?.data?.revision, '--json']).json?.exitCode, 0);
  acceptAll(change, ['P']);
  // A trivial exit-0 command is RECORDED as runtime evidence…
  const trivial = comet(['check', 'run', change, 'build', '--local', '--', 'node', '-e', 'process.exit(0)']);
  assert.equal(trivial.status, 0, 'recording is neutral; acceptance is the gate');
  // …but the build gate only accepts the registered identity.
  const refused = comet(['state', 'transition', change, 'build-complete', '--json']);
  assert.equal(refused.json?.exitCode, 1, 'trivial exit-0 evidence must not pass the registered build scope');
  assert.match(plain(issuesOf(refused)), /not a registered required check identity/);
  assert.match(plain(issuesOf(refused)), /build-ok/);
  const phaseAfterRefusal = comet(['state', 'get', change, 'phase']).stdout?.trim();
  assert.equal(phaseAfterRefusal, 'build');
  // The registered command is accepted and the transition advances.
  const registered = comet(['check', 'run', change, 'build', '--local', '--', 'node', '-e', 'process.stdout.write("build-ok\\n")']);
  assert.equal(registered.status, 0, plain(registered.stderr).slice(0, 200));
  assert.equal(comet(['state', 'transition', change, 'build-complete', '--json']).json?.exitCode, 0);
  void dir;
});

test('B4: COMET_SKIP_BUILD and COMET_FORCE_PHASE do not lower managed gates (source hygiene, upstream side)', async (t) => {
  if (skipIfNoBuild(t)) return;
  const change = 'p24-b4';
  await driveToBuild(change);
  await writeCheckPolicy();
  const tasks = comet(['state', 'tasks', change, '--assign-ids', '--json']).json;
  acceptAll(change, ['P']);
  assert.equal(comet(['state', 'task-complete', change, tasks?.data?.tasks?.[0]?.id, '--expect', tasks?.data?.revision, '--json']).json?.exitCode, 0);
  acceptAll(change, ['P']);
  assert.equal(comet(['state', 'set', change, 'build_mode', 'executing-plans', 'tdd_mode', 'tdd', 'isolation', 'current', '--json']).json?.exitCode, 0);
  // The escape variable must not fabricate a pass over the missing check.
  const skipped = comet(['state', 'transition', change, 'build-complete', '--json'], { env: { COMET_SKIP_BUILD: '1' } });
  assert.equal(skipped.json?.exitCode, 1, 'COMET_SKIP_BUILD=1 must not complete a managed build with zero check evidence');
  const logs = await fs.readdir(path.join(changeDir(change), '.comet', 'checks')).catch(() => []);
  assert.equal(logs.length, 0, 'no skip pseudo-evidence may be produced');
  // The phase escape hatch is dead upstream in managed delivery.
  const forced = comet(['state', 'set', change, 'phase', 'verify', '--json'], { env: { COMET_FORCE_PHASE: '1' } });
  assert.equal(forced.json?.exitCode, 1, 'COMET_FORCE_PHASE must not rewrite the managed phase');
  assert.equal(comet(['state', 'get', change, 'phase']).stdout?.trim(), 'build');
  // Managed-scoping control: without managed delivery the historical escape
  // behaves as before — the hygiene never over-reaches.
  const unmanaged = 'p24-b4-unmanaged';
  await writeArtifacts(unmanaged);
  assert.equal(comet(['state', 'init', unmanaged, 'full', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'transition', unmanaged, 'open-complete', '--json']).json?.exitCode, 0);
  comet(['state', 'complete-design', unmanaged, '--design-doc', `docs/openspec/changes/${unmanaged}/design.md`, '--json']);
  assert.equal(comet(['state', 'set', unmanaged, 'build_mode', 'executing-plans', 'tdd_mode', 'tdd', 'isolation', 'current', '--json']).json?.exitCode, 0);
  const unmanagedTasks = comet(['state', 'tasks', unmanaged, '--assign-ids', '--json']).json;
  assert.equal(comet(['state', 'task-complete', unmanaged, unmanagedTasks?.data?.tasks?.[0]?.id, '--expect', unmanagedTasks?.data?.revision, '--json']).json?.exitCode, 0);
  const escaped = comet(['state', 'transition', unmanaged, 'build-complete', '--json'], { env: { COMET_SKIP_BUILD: '1' } });
  assert.equal(escaped.json?.exitCode, 0, 'the unmanaged historical behavior is unchanged (registered B4 gap stays scoped)');
});

test('D04: a design revision silently invalidates A/T/P at every managed entrance, and recovery routes through repair', async (t) => {
  if (skipIfNoBuild(t)) return;
  const change = 'p24-d04';
  await driveToBuild(change);
  setBuildDecisions(change);
  await writeCheckPolicy();
  const d04Tasks = comet(['state', 'tasks', change, '--assign-ids', '--json']).json;
  assert.equal(comet(['state', 'sync-plan', change, '--json']).json?.exitCode, 0, 'the plan mapping must be synced to the assigned tasks');
  acceptAll(change, ['P']);
  assert.equal(comet(['state', 'task-complete', change, d04Tasks?.data?.tasks?.[0]?.id, '--expect', d04Tasks?.data?.revision, '--json']).json?.exitCode, 0);
  acceptAll(change, ['P']);
  // No revision action is called — the file edit alone is the revision.
  await fs.writeFile(path.join(changeDir(change), 'design.md'), `---\ncomet_change: ${change}\nrole: technical-design\ncanonical_spec: openspec\n---\n\n# Design\n\nSilently revised after acceptance (v2).\n`);
  const gates = comet(['state', 'gates', change, '--json']);
  const evaluation = gates.json?.data?.evaluation;
  assert.equal(evaluation?.allowed, false, 'the premise evaluation must detect the stale chain');
  for (const gate of ['A', 'T', 'P']) {
    assert.ok(evaluation.stale.includes(gate) || evaluation.rejected.includes(gate), `gate ${gate} must be stale after the design revision`);
  }
  assert.ok(!evaluation.stale.includes('R'), 'R stays valid: the requirements inputs did not change');
  // Entrance 1/2: direct transition and guard preview refuse.
  const transition = comet(['state', 'transition', change, 'build-complete', '--json']);
  assert.equal(transition.json?.exitCode, 1);
  assert.match(plain(issuesOf(transition)), /GATE_PREMISES_INVALID|stale|rejected/i);
  const guardPreview = comet(['guard', change, 'build']);
  assert.equal(guardPreview.status, 1);
  // Entrance 3: guard --apply refuses and leaves the phase untouched.
  const guardApply = comet(['guard', change, 'build', '--apply']);
  assert.equal(guardApply.status, 1);
  assert.equal(comet(['state', 'get', change, 'phase']).stdout?.trim(), 'build');
  // Entrance 4: next/continuation carries the same evaluation and route.
  const next = comet(['state', 'next', change, '--json']);
  assert.equal(next.json?.data?.gates?.allowed, false);
  assert.match(String(next.stdout ?? '') + String(next.stderr ?? ''), /architecture-repair/);
  // Entrance 5: the state entry check set includes the gate premises.
  const entryCheck = comet(['state', 'check', change, 'build']);
  assert.equal(entryCheck.status, 1);
  assert.match(plain(entryCheck.stdout), /managed gate A: receipt is stale/);
  // Entrance 6: the attributed write hook refuses the build-phase product write.
  const router = path.join(project, '.claude/skills/comet/scripts/comet-hook-router.mjs');
  const hookProbe = spawnSync(nodeExecutable, [router, '--platform', 'claude', '--project-root', project], {
    cwd: project,
    encoding: 'utf8',
    timeout: 60_000,
    input: JSON.stringify({
      session_id: 'p24-hook-probe',
      hook_event_name: 'PreToolUse',
      cwd: project,
      tool_name: 'Write',
      tool_input: { file_path: path.join(project, 'src/feature.js'), content: 'probe' },
    }),
    env: childEnv({ COMET_PROJECT_ROOT: project }),
  });
  assert.equal(hookProbe.status, 2, 'the managed write entrance must refuse while gates are stale');
  assert.match(hookProbe.stderr ?? '', /gate premises are not current/);
  // Recovery: architecture-repair → design, fix, re-dispatch A/T/P → re-enter build.
  assert.equal(comet(['state', 'transition', change, 'architecture-repair', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'get', change, 'phase']).stdout?.trim(), 'design');
  await fs.writeFile(path.join(changeDir(change), 'design.md'), `---\ncomet_change: ${change}\nrole: technical-design\ncanonical_spec: openspec\n---\n\n# Design\n\nRepaired design for re-review (v3).\n`);
  acceptAll(change, ['A', 'T', 'P']);
  assert.equal(comet(['state', 'complete-design', change, '--design-doc', `docs/openspec/changes/${change}/design.md`, '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'get', change, 'phase']).stdout?.trim(), 'build');
});

test('D05: implementation changes keep R/A/T/P current and only invalidate candidate-scoped evidence', async (t) => {
  if (skipIfNoBuild(t)) return;
  const change = 'p24-d05';
  await driveToBuild(change);
  await writeCheckPolicy();
  setBuildDecisions(change);
  const tasks = comet(['state', 'tasks', change, '--assign-ids', '--json']).json;
  acceptAll(change, ['P']);
  assert.equal(comet(['state', 'task-complete', change, tasks?.data?.tasks?.[0]?.id, '--expect', tasks?.data?.revision, '--json']).json?.exitCode, 0);
  acceptAll(change, ['P']);
  assert.equal(comet(['check', 'run', change, 'build', '--local', '--', 'node', '-e', 'process.stdout.write("build-ok\\n")']).status, 0);
  // The builder produces a new candidate.
  await fs.writeFile(path.join(project, 'src/feature.js'), 'export const v2 = 2;\n');
  const gates = comet(['state', 'gates', change, '--json']);
  const evaluation = gates.json?.data?.evaluation;
  assert.equal(evaluation?.allowed, true, 'R/A/T/P receipts must survive an implementation-only change');
  assert.equal(evaluation?.stale.length ?? 0, 0);
  assert.equal(evaluation?.rejected.length ?? 0, 0);
  // The candidate-scoped evidence is refused natively: the recorded check
  // observed the old input tree, and the transition entrance re-checks it.
  const staleBuild = comet(['state', 'transition', change, 'build-complete', '--json']);
  assert.equal(staleBuild.json?.exitCode, 1, 'stale candidate evidence must not complete the build');
  assert.match(plain(issuesOf(staleBuild)), /Check evidence changed before transition|changed/);
  // A new candidate rebuild restores the path to verify.
  assert.equal(comet(['check', 'run', change, 'build', '--local', '--', 'node', '-e', 'process.stdout.write("build-ok\\n")']).status, 0);
  assert.equal(comet(['state', 'transition', change, 'build-complete', '--json']).json?.exitCode, 0);
});

test('C07/D08: full managed lifecycle reaches archive; knowledge unknown reads back; archived is not completed (D07/D06/Kt)', async (t) => {
  if (skipIfNoBuild(t)) return;
  const change = 'p24-lifecycle';
  const dir = await driveToBuild(change);
  await writeCheckPolicy();
  const tasks = comet(['state', 'tasks', change, '--assign-ids', '--json']).json;
  acceptAll(change, ['P']);
  assert.equal(comet(['state', 'task-complete', change, tasks?.data?.tasks?.[0]?.id, '--expect', tasks?.data?.revision, '--json']).json?.exitCode, 0);
  acceptAll(change, ['P']);
  assert.equal(comet(['state', 'set', change, 'build_mode', 'executing-plans', 'tdd_mode', 'tdd', 'isolation', 'current', '--json']).json?.exitCode, 0);
  assert.equal(comet(['check', 'run', change, 'build', '--local', '--', 'node', '-e', 'process.stdout.write("build-ok\\n")']).status, 0);
  assert.equal(comet(['state', 'transition', change, 'build-complete', '--json']).json?.exitCode, 0);
  // Interrupted-acceptance semantics (D08): a dispatch consumed by a stale
  // refusal leaves no receipt; the retry path re-dispatches cleanly.
  await fs.writeFile(path.join(changeDir(change), 'verification.md'), '# Verification Report\n\nProbe.\n');
  assert.equal(comet(['state', 'set', change, 'verification_report', `docs/openspec/changes/${change}/verification.md`, '--json']).json?.exitCode, 0);
  assert.equal(comet(['check', 'run', change, 'verify', '--local', '--', 'node', '-e', 'process.stdout.write("verify-ok\\n")']).status, 0);
  acceptAll(change, ['V']);
  assert.equal(comet(['state', 'transition', change, 'verify-pass', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'transition', change, 'archive-confirm', '--json']).json?.exitCode, 0);
  assert.equal(comet(['archive', change, '--json']).status, 0, plain(comet(['archive', change]).stderr ?? ''));
  // D07: archived=true, but the knowledge obligation is unmet.
  const next = comet(['state', 'next', change, '--json']);
  assert.equal(next.json?.data?.nextAction?.kind, 'knowledge-closeout', 'next must point at the closeout, not completed');
  const gatesAfterArchive = comet(['state', 'gates', change, '--json']);
  assert.equal(gatesAfterArchive.json?.data?.completionBlocked, true);
  // D06: an unknown/wrong knowledge result is never accepted — the Runtime
  // reads the target back itself.
  const knowledgeFile = path.join(project, 'knowledge', 'llmwiki-entry.md');
  await fs.mkdir(path.dirname(knowledgeFile), { recursive: true });
  await fs.writeFile(knowledgeFile, '# Project Knowledge\n\nManaged probe outcome.\n');
  const wrongDigest = crypto.createHash('sha256').update('not-the-target').digest('hex');
  const badReceipt = path.join(scratch, 'kc-bad.json');
  await fs.writeFile(badReceipt, JSON.stringify({
    targetKind: 'file',
    target: 'knowledge/llmwiki-entry.md',
    revision: 'r1',
    readbackDigest: wrongDigest,
    execution: 'driver-exec-1',
    recordedAt: new Date().toISOString(),
  }));
  const refused = comet(['state', 'knowledge-closeout', change, '--file', badReceipt, '--json']);
  assert.equal(refused.json?.exitCode !== 0, true, 'a readback mismatch must be refused');
  assert.match(refusalText(refused), /D06|read back/i);
  // An external target without a Runtime K dispatch is refused.
  const externalReceipt = path.join(scratch, 'kc-ext.json');
  await fs.writeFile(externalReceipt, JSON.stringify({
    targetKind: 'external',
    target: 'outline://collections/x/entries/y',
    revision: 'rev-1',
    readbackDigest: wrongDigest,
    execution: 'unregistered-exec',
    recordedAt: new Date().toISOString(),
  }));
  const refusedExternal = comet(['state', 'knowledge-closeout', change, '--file', externalReceipt, '--json']);
  assert.equal(refusedExternal.json?.exitCode !== 0, true, 'an external closeout without a Runtime K dispatch must be refused');
  assert.match(refusalText(refusedExternal), /K dispatch/);
  // The real receipt records; the same Run completes only now.
  const realDigest = crypto.createHash('sha256').update(await fs.readFile(knowledgeFile, 'utf8')).digest('hex');
  const receipt = path.join(scratch, 'kc.json');
  await fs.writeFile(receipt, JSON.stringify({
    targetKind: 'file',
    target: 'knowledge/llmwiki-entry.md',
    revision: 'r1',
    readbackDigest: realDigest,
    execution: 'driver-exec-1',
    recordedAt: new Date().toISOString(),
  }));
  const recorded = comet(['state', 'knowledge-closeout', change, '--file', receipt, '--json']);
  assert.equal(recorded.json?.exitCode, 0, plain(recorded.stderr).slice(0, 300));
  const gatesFinal = comet(['state', 'gates', change, '--json']);
  assert.equal(gatesFinal.json?.data?.completionBlocked, false);
  const archivedDirs = await fs.readdir(path.join(project, 'docs/openspec/changes/archive'));
  const archivedDir = archivedDirs.find((name) => name.endsWith(change));
  const runState = JSON.parse(await fs.readFile(path.join(project, 'docs/openspec/changes/archive', archivedDir, '.comet', 'run-state.json'), 'utf8'));
  void dir;
  assert.equal(runState.status, 'completed', 'the run completes only after the knowledge seat is filled');
  const nextFinal = comet(['state', 'next', change, '--json']);
  assert.notEqual(nextFinal.json?.data?.nextAction?.kind, 'knowledge-closeout');
});

// ---- seven-P1 rework: RW_R_ENTRY / RW_TRUSTED_REVIEW / RW_REVISION_NO_REVIVE
// (V_RW_R_ENTRY / V_RW_TRUSTED_REVIEW / V_RW_REVISION_NO_REVIVE). Each block is
// self-contained: it performs its own project init, because the contract
// commands run this file with --test-name-pattern and skip the setup test.

test('RW_R_ENTRY: without a valid R every entrance into design refuses; a trusted R opens it', async (t) => {
  if (skipIfNoBuild(t)) return;
  await ensureProjectInit();
  const change = 'p24-rw-r-entry';
  await writeArtifacts(change);
  assert.equal(comet(['state', 'init', change, 'full', '--managed-delivery', '--knowledge-closeout-required', 'true', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'select', change, '--json']).json?.exitCode, 0);
  const rel = `docs/openspec/changes/${change}`;
  assert.equal(comet(['state', 'set', change, 'design_doc', `${rel}/design.md`, 'test_intent', `${rel}/test-intent.md`, 'plan', `docs/superpowers/plans/${change}-plan.md`, '--json']).json?.exitCode, 0);
  // No R receipt exists. Every managed entrance into design must refuse.
  const direct = comet(['state', 'transition', change, 'open-complete', '--json']);
  assert.equal(direct.json?.exitCode, 1, 'open-complete without an R receipt must be refused');
  assert.match(refusalText(direct), /enter-design/, 'the refusal must name the enter-design premise');
  assert.match(refusalText(direct), /gate R/);
  const preview = comet(['guard', change, 'open']);
  assert.equal(preview.status, 1, 'the guard preview must refuse to enter design without R');
  assert.match(`${plain(preview.stdout)}\n${plain(preview.stderr)}`, /enter-design/, 'the guard preview must carry the enter-design gate premise');
  const applied = comet(['guard', change, 'open', '--apply']);
  assert.equal(applied.status, 1, 'guard --apply must refuse to enter design without R');
  assert.equal(comet(['state', 'get', change, 'phase']).stdout?.trim(), 'open', 'the phase must stay open');
  const next = comet(['state', 'next', change, '--json']);
  assert.equal(next.json?.data?.gates?.allowed, false, 'next must carry the refused enter-design evaluation');
  assert.match(`${String(next.stdout ?? '')}\n${String(next.stderr ?? '')}`, /gate R|requirements-owner/, 'next must route to the R gate');
  const entryCheck = comet(['state', 'check', change, 'open']);
  assert.equal(entryCheck.status, 1, 'the open entry-check set must fail on the missing R');
  assert.match(plain(entryCheck.stdout), /managed gate R/, 'the entry check must name the managed R gate');
  const status = comet(['state', 'gates', change, '--json']);
  assert.equal(status.json?.data?.action, 'enter-design', 'the gate status must evaluate the enter-design action for the open phase');
  assert.deepEqual(status.json?.data?.evaluation?.missing, ['R']);
  // The managed write entrance: a design-doc write in open is formal
  // architecture work and is refused before R.
  const router = path.join(project, '.claude/skills/comet/scripts/comet-hook-router.mjs');
  const hookProbe = spawnSync(nodeExecutable, [router, '--platform', 'claude', '--project-root', project], {
    cwd: project,
    encoding: 'utf8',
    timeout: 60_000,
    input: JSON.stringify({
      session_id: 'p24-rw-r-entry-hook',
      hook_event_name: 'PreToolUse',
      cwd: project,
      tool_name: 'Write',
      tool_input: { file_path: path.join(changeDir(change), 'design.md'), content: 'premature architecture' },
    }),
    env: childEnv({ COMET_PROJECT_ROOT: project }),
  });
  assert.equal(hookProbe.status, 2, 'the open-phase design write must be refused without R');
  assert.match(hookProbe.stderr ?? '', /enter-design|gate R/, 'the write refusal must name the enter-design premise');
  // Hand phase edits stay dead with and without the escape hatch.
  assert.notEqual(comet(['state', 'set', change, 'phase', 'design', '--json'], { env: { COMET_FORCE_PHASE: '1' } }).json?.exitCode, 0, 'COMET_FORCE_PHASE must not hand-edit the phase');
  // A trusted R opens design on the same run.
  const { accepted } = acceptGate(change, 'R');
  assert.equal(accepted.json?.exitCode, 0, plain(accepted.stderr).slice(0, 300));
  const openComplete = comet(['state', 'transition', change, 'open-complete', '--json']);
  assert.equal(openComplete.json?.exitCode, 0, `open-complete after a trusted R must succeed: ${refusalText(openComplete).slice(0, 300)}`);
  assert.equal(comet(['state', 'get', change, 'phase']).stdout?.trim(), 'design');
  // Unmanaged changes keep the historical behavior: the R gate is scoped to managed delivery.
  const unmanaged = 'p24-rw-r-unmanaged';
  await writeArtifacts(unmanaged);
  assert.equal(comet(['state', 'init', unmanaged, 'full', '--json']).json?.exitCode, 0);
  const unmanagedOpen = comet(['state', 'transition', unmanaged, 'open-complete', '--json']);
  assert.equal(unmanagedOpen.json?.exitCode, 0, 'the unmanaged flow must not gain the R gate');
});

test('RW_TRUSTED_REVIEW: a dispatch is not review evidence — same-caller empty/fake/weak passes are refused; real independent results are accepted and advance', async (t) => {
  if (skipIfNoBuild(t)) return;
  const change = 'p24-rw-review';
  await initManaged(change); // R accepted with a real report; phase = design
  // Same caller dispatches R again and submits an empty-report pass: refused.
  const bare = dispatchOf(change, 'R');
  const emptyPass = rawAccept(change, 'R', { execution: bare.execution, attempt: bare.attempt, verdict: 'pass' });
  assert.notEqual(emptyPass.json?.exitCode, 0, 'a same-caller dispatch + empty report pass must be refused');
  assert.match(refusalText(emptyPass), /report/, 'the refusal must name the missing review report');
  // A report whose digest does not match its bytes: refused.
  const wrongDigestResult = withReportDigest(passEvidence('R', bare));
  wrongDigestResult.reportDigest = 'f'.repeat(64);
  const wrongDigest = rawAccept(change, 'R', wrongDigestResult);
  assert.notEqual(wrongDigest.json?.exitCode, 0, 'a report digest that does not bind the report bytes must be refused');
  // A report echoing an older input version's digest: refused.
  const oldDigest = rawAccept(change, 'R', withReportDigest(passEvidence('R', bare, { inputDigest: '0'.repeat(64) })));
  assert.notEqual(oldDigest.json?.exitCode, 0, 'a result bound to an old input digest must be refused');
  // A role the Runtime never assigned at dispatch: refused.
  const fakeRole = rawAccept(change, 'R', withReportDigest(passEvidence('R', bare, { role: 'reviewer' })));
  assert.notEqual(fakeRole.json?.exitCode, 0, 'a result claiming a role the dispatch never assigned must be refused');
  // A fabricated execution (no dispatch at all): refused (D01 restated).
  const noDispatch = rawAccept(change, 'A', { execution: 'phantom-exec', attempt: 1, verdict: 'pass' });
  assert.notEqual(noDispatch.json?.exitCode, 0);
  assert.match(refusalText(noDispatch), /no Runtime dispatch/);
  // Architecture gate: a same-caller pass without any consensus tally: refused.
  const aBare = dispatchOf(change, 'A');
  const aNoConsensus = rawAccept(change, 'A', withReportDigest(passEvidence('A', aBare)));
  assert.notEqual(aNoConsensus.json?.exitCode, 0, 'an A pass without a consensus tally must be refused');
  assert.match(refusalText(aNoConsensus), /consensus/, 'the refusal must name the consensus evidence');
  // Consensus mechanical failures, each on a fresh dispatch.
  const aMissing = dispatchOf(change, 'A');
  const missingBallot = { ...consensusForDispatch(aMissing), ballots: consensusForDispatch(aMissing).ballots.slice(0, -1) };
  const refusedMissing = rawAccept(change, 'A', withReportDigest(passEvidence('A', aMissing, { consensus: missingBallot })));
  assert.notEqual(refusedMissing.json?.exitCode, 0, 'a consensus with a missing ballot (缺票) must be refused');
  const aReject = dispatchOf(change, 'A');
  const rejectBallot = { ...consensusForDispatch(aReject), ballots: consensusForDispatch(aReject).ballots.map((b, i) => (i === 0 ? { ...b, verdict: 'REJECT' } : b)) };
  const refusedReject = rawAccept(change, 'A', withReportDigest(passEvidence('A', aReject, { consensus: rejectBallot })));
  assert.notEqual(refusedReject.json?.exitCode, 0, 'a consensus containing a rejecting vote must not count as a pass');
  const aOld = dispatchOf(change, 'A');
  const oldArtifact = { ...consensusForDispatch(aOld), artifactDigest: '0'.repeat(64) };
  const refusedOld = rawAccept(change, 'A', withReportDigest(passEvidence('A', aOld, { consensus: oldArtifact })));
  assert.notEqual(refusedOld.json?.exitCode, 0, 'a consensus bound to an old input digest must be refused');
  const aPhantom = dispatchOf(change, 'A');
  const phantomBallot = { ...consensusForDispatch(aPhantom), ballots: consensusForDispatch(aPhantom).ballots.map((b, i) => (i === 0 ? { ...b, agent: 'phantom-agent' } : b)) };
  const refusedPhantom = rawAccept(change, 'A', withReportDigest(passEvidence('A', aPhantom, { consensus: phantomBallot })));
  assert.notEqual(refusedPhantom.json?.exitCode, 0, 'a ballot from an agent outside the participant set (假身份) must be refused');
  const aOpen = dispatchOf(change, 'A');
  const openTally = { ...consensusForDispatch(aOpen), status: 'COLLECTING' };
  const refusedOpen = rawAccept(change, 'A', withReportDigest(passEvidence('A', aOpen, { consensus: openTally })));
  assert.notEqual(refusedOpen.json?.exitCode, 0, 'an unclosed (COLLECTING) tally must be refused');
  // Test-design gate: weak oracle designs must not pass.
  const tBare = dispatchOf(change, 'T');
  const tNoReview = rawAccept(change, 'T', withReportDigest(passEvidence('T', tBare)));
  assert.notEqual(tNoReview.json?.exitCode, 0, 'a T pass without a test-design review conclusion must be refused');
  const tWeak = dispatchOf(change, 'T');
  const refusedWeak = rawAccept(change, 'T', withReportDigest(passEvidence('T', tWeak, { testDesignReview: { verdict: 'sufficient', oracle: 'weak', inputDigest: tWeak.inputDigest, reviewer: 'test-authoring', findings: [] } })));
  assert.notEqual(refusedWeak.json?.exitCode, 0, 'a T review attesting a weak oracle must be refused');
  const tInsufficient = dispatchOf(change, 'T');
  const refusedInsufficient = rawAccept(change, 'T', withReportDigest(passEvidence('T', tInsufficient, { testDesignReview: { verdict: 'insufficient', oracle: 'strong', inputDigest: tInsufficient.inputDigest, reviewer: 'test-authoring', findings: ['missing failure-mode coverage'] } })));
  assert.notEqual(refusedInsufficient.json?.exitCode, 0, 'an insufficient T verdict must not pass the gate');
  // Positive: real independent results (consensus shaped from this run's
  // genuine unanimous receipt, re-bound to the reviewed inputs) are accepted
  // and the run advances automatically.
  const { accepted: aAccepted, binding: aBinding } = acceptGate(change, 'A');
  assert.equal(aAccepted.json?.exitCode, 0, plain(aAccepted.stderr).slice(0, 300));
  const receiptsAfterA = JSON.parse(comet(['state', 'get', change, 'gate_receipts']).stdout?.trim() ?? '[]');
  const aReceipt = [...receiptsAfterA].reverse().find((r) => r.gate === 'A');
  assert.equal(aReceipt.reportDigest, sha256Text(aReceipt.report), 'the recorded receipt keeps the original report digest');
  assert.match(String(aReceipt.report ?? ''), /independent review/, 'the recorded receipt carries the original report text');
  void aBinding;
  acceptAll(change, ['T', 'P']);
  assert.equal(comet(['state', 'complete-design', change, '--design-doc', `docs/openspec/changes/${change}/design.md`, '--json']).json?.exitCode, 0, 'a fully evidenced A/T/P chain must advance into build');
  assert.equal(comet(['state', 'get', change, 'phase']).stdout?.trim(), 'build');
});

test('RW_REVISION_NO_REVIVE: restoring the original bytes cannot revive invalidated approvals; only a new-generation re-review passes; late old attempts stay dead', async (t) => {
  if (skipIfNoBuild(t)) return;
  const change = 'p24-rw-revision';
  await driveToBuild(change); // R -> design; A/T/P accepted with evidence; build entered
  const designPath = path.join(changeDir(change), 'design.md');
  const originalDesign = await fs.readFile(designPath, 'utf8');
  // An in-flight dispatch issued against the ORIGINAL inputs, never consumed.
  const spare = dispatchOf(change, 'A');
  // The design changes; the premise evaluation blocks (D04 semantics).
  await fs.writeFile(designPath, `${originalDesign}\n<!-- silently revised v2 -->\n`);
  const blockedNow = comet(['state', 'gates', change, '--json']);
  assert.equal(blockedNow.json?.data?.evaluation?.allowed, false);
  assert.ok((blockedNow.json?.data?.evaluation?.stale ?? []).includes('A'), 'A must be stale after the design revision');
  // Restore the exact original bytes: the observed invalidation is persisted
  // as a monotonic generation — the old approvals must NOT revive.
  await fs.writeFile(designPath, originalDesign);
  const afterRestore = comet(['state', 'gates', change, '--json']);
  assert.equal(afterRestore.json?.data?.evaluation?.allowed, false, 'byte-restoring the design must not revive the stale approval chain');
  assert.ok((afterRestore.json?.data?.evaluation?.stale ?? []).includes('A'), 'A must stay stale across the byte restore');
  const blockedTransition = comet(['state', 'transition', change, 'build-complete', '--json']);
  assert.notEqual(blockedTransition.json?.exitCode, 0, 'a transition over restored-but-invalidated premises must refuse');
  // A late result from the pre-invalidation dispatch: its inputDigest matches
  // the restored bytes, but it belongs to the old generation — refused.
  const lateResult = withReportDigest(passEvidence('A', spare));
  lateResult.consensus = consensusForDispatch(spare);
  const late = rawAccept(change, 'A', lateResult);
  assert.notEqual(late.json?.exitCode, 0, 'a late old-attempt result must not revive the invalidated gate');
  assert.match(refusalText(late), /generation|stale|invalidat/i, 'the refusal must name the stale generation');
  // Recovery/continuation surfaces keep refusing: history reconciliation
  // authorizes nothing new while the premises are invalid.
  const nextBlocked = comet(['state', 'next', change, '--json']);
  assert.equal(nextBlocked.json?.data?.gates?.allowed, false);
  // Receipts stay append-only history — nothing was deleted or rewritten.
  const receiptsMid = JSON.parse(comet(['state', 'get', change, 'gate_receipts']).stdout?.trim() ?? '[]');
  assert.ok(receiptsMid.filter((r) => r.gate === 'A').length >= 1, 'the historical A receipt remains recorded');
  // New generation, independent re-review: repair route -> design, re-dispatch
  // and re-accept A/T/P, re-enter build.
  assert.equal(comet(['state', 'transition', change, 'architecture-repair', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'get', change, 'phase']).stdout?.trim(), 'design');
  const { binding: rebindA } = acceptGate(change, 'A');
  const reReceipts = JSON.parse(comet(['state', 'get', change, 'gate_receipts']).stdout?.trim() ?? '[]');
  const reA = [...reReceipts].reverse().find((r) => r.gate === 'A');
  assert.ok(reA && reA.digest, 'the re-reviewed receipt is recorded');
  void rebindA;
  acceptAll(change, ['T', 'P']);
  const gatesAfter = comet(['state', 'gates', change, '--json']);
  assert.equal(gatesAfter.json?.data?.evaluation?.allowed, true, 'the new-generation re-review clears the premises');
  assert.equal(comet(['state', 'complete-design', change, '--design-doc', `docs/openspec/changes/${change}/design.md`, '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'get', change, 'phase']).stdout?.trim(), 'build');
  // Replaying an already-consumed acceptance is idempotently refused: legal
  // history recovery grants no new authorization.
  const replay = rawAccept(change, 'A', withReportDigest(passEvidence('A', rebindA)));
  assert.notEqual(replay.json?.exitCode, 0, 'a consumed dispatch accepts exactly one result');
  assert.match(refusalText(replay), /already consumed/);
});
