// P4_6 delivery case: post-archive continuation and idempotent control (patch
// 0003) on the SAME Classic Run. H01–H09 over the real built CLI: an archived
// managed run with an unmet knowledge obligation stays discoverable,
// selectable and recoverable even when Git delivery is complete (H01); method
// hooks stay advisory and never claim execution (H02); same job_key claims
// are atomic — one open owner, others recover the same operation (H03); the
// Outline document UUID is fixed before the first request and retries never
// mint a second logical document, 403/timeout is never absence (H04);
// lastRevision conflicts stay open and are never overwritten by a revision
// refresh (H05); stale attempt results cannot complete a new task and a new
// revision keeps its own manifest (H06); the native archive
// completed/clear-current path keeps the run open until closeout (H07); a
// lost run state is never fabricated and cleanup cannot remove the only
// recovery copy (H08); a copied workspace is never a second writer — the
// run's authority binding decides, and transfer is explicit (H09).
// Every interaction runs the real built CLI in scratch projects under $TMPDIR
// with an isolated HOME and PATH stubs; live host configuration is untouched.
//
// Build resolution: the fingerprint is derived from the Comet patch lock
// (SDD_COMET_LOCK overrides the lock path, default
// integrations/comet/upstream.lock.json). Before the integration wave
// registers 0003-post-archive-closeout.patch, point SDD_COMET_LOCK at the
// staged lock that carries the 0003 + tests/4_6 entries; after integration
// the default lock resolves to the same build.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lockPath = process.env.SDD_COMET_LOCK ?? 'integrations/comet/upstream.lock.json';
const lock = JSON.parse(await fs.readFile(path.resolve(projectRoot, lockPath), 'utf8'));

const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
  archive: lock.source.sha256,
  patches: lock.patches.map(({ path, sha256 }) => ({ path, sha256 })),
  toolchain: lock.toolchain,
})).digest('hex');
const F2 = '9b95a0ff54ee00abd03ba9fb507cd93f03c8a464a743658898c474a51dc89b10'; // 0001+1_6+0002+2_4
const has0003 = lock.patches.some((entry) => String(entry.path).endsWith('0003-post-archive-closeout.patch'));
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
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// --- scratch world -----------------------------------------------------------
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'p46-case-'));
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

const childEnv = (extra = {}, overProject = project) => {
  const { NODE_TEST_CONTEXT: _stripped, ...inherited } = process.env;
  return {
    ...inherited,
    HOME: fakeHome,
    COMET_PROJECT_ROOT: overProject,
    PATH: `${stubs}:${process.env.PATH ?? ''}`,
    ...extra,
  };
};

function comet(args, { env = {}, timeout = 180_000, cwd = project, root = undefined } = {}) {
  const target = root ?? cwd;
  const result = spawnSync(nodeExecutable, [entrypoint, ...args], {
    cwd: target,
    encoding: 'utf8',
    timeout,
    env: childEnv(env, target),
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
  return `${envelope}\n${plain(result.stderr)}\n${plain(result.stdout)}`;
};
const changeDir = (change, root = project) => path.join(root, 'docs/openspec/changes', change);
const archivedDir = async (change, root = project) => {
  const entries = await fs.readdir(path.join(root, 'docs/openspec/changes/archive'));
  return path.join(root, 'docs/openspec/changes/archive', entries.find((name) => name.endsWith(change)));
};
const runStateOf = async (dir) => JSON.parse(await fs.readFile(path.join(dir, '.comet', 'run-state.json'), 'utf8'));

const writeArtifacts = async (change, root = project) => {
  const dir = changeDir(change, root);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'proposal.md'), '# Proposal\n\nPost-archive probe.\n');
  await fs.writeFile(path.join(dir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Implement probe product code\n');
  await fs.writeFile(path.join(dir, 'design.md'), `---\ncomet_change: ${change}\nrole: technical-design\ncanonical_spec: openspec\n---\n\n# Design\n\nPost-archive probe design v1.\n`);
  await fs.writeFile(path.join(dir, 'test-intent.md'), '# Test Intent\n\ncases: c1\noracle: probe behavior observed\n');
  const plansDir = path.join(root, 'docs/superpowers/plans');
  await fs.mkdir(plansDir, { recursive: true });
  await fs.writeFile(path.join(plansDir, `${change}-plan.md`), '# Plan\n\n- 1.1 Implement probe product code\n');
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/feature.js'), 'export const v1 = 1;\n');
  return dir;
};

const acceptGate = (change, gate, { verdict = 'pass', findings, execution, attempt, root: over, env = {} } = {}) => {
  const dispatched = comet(['state', 'dispatch-gate', change, gate, '--json'], { root: over, env });
  assert.equal(dispatched.json?.exitCode, 0, `dispatch-gate ${gate} failed: ${refusalText(dispatched).slice(0, 400)}`);
  const binding = dispatched.json?.data?.dispatch
    ?? JSON.parse((dispatched.stdout ?? '').trim().split('\n').pop());
  const result = {
    execution: execution ?? binding.execution,
    attempt: attempt ?? binding.attempt,
    verdict,
    ...(findings ? { findings } : {}),
  };
  const resultFile = path.join(scratch, `result-${change}-${gate}-${Math.random().toString(36).slice(2)}.json`);
  fsSync.writeFileSync(resultFile, JSON.stringify(result));
  const accepted = comet(['state', 'accept-gate', change, gate, '--file', resultFile, '--json'], { root: over, env });
  assert.equal(accepted.json?.exitCode, 0, `accept-gate ${gate} failed: ${refusalText(accepted).slice(0, 300)}`);
  return { binding, result, accepted };
};

const acceptAll = (change, gates, over, env = {}) => {
  for (const gate of gates) acceptGate(change, gate, { root: over, env });
};

const writeCheckPolicy = async (root = project) => {
  await fs.mkdir(path.join(root, '.comet'), { recursive: true });
  await fs.writeFile(path.join(root, '.comet/check-policy.json'), JSON.stringify({
    version: 2,
    commands: [
      { argv: ['node', '-e', 'process.stdout.write("build-ok\\n")'], cwd: '.', requiredScope: 'build', files: ['src/feature.js'] },
      { argv: ['node', '-e', 'process.stdout.write("verify-ok\\n")'], cwd: '.', requiredScope: 'verify', files: ['src/feature.js'] },
    ],
  }, null, 2));
};

// Managed drive: init → artifacts → R/A/T accepted → design confirmed →
// build decisions → registered checks → task complete → V → archive-confirm.
// Authority env is set at init: the binding is recorded by the runtime.
async function driveToArchiveReady(change, { root = project, authority } = {}) {
  await writeArtifacts(change, root);
  // The authority environment is the RUNTIME configuration of the whole
  // drive: init binds it and every mutating call re-presents it (H09).
  const authorityEnv = authority ? { COMET_RUN_AUTHORITY: authority } : {};
  const run = (args) => comet(args, { root, env: authorityEnv });
  assert.equal(run(['state', 'init', change, 'full', '--managed-delivery', '--knowledge-closeout-required', 'true', '--json']).json?.exitCode, 0);
  if (root === project) {
    assert.equal(run(['state', 'select', change, '--json']).json?.exitCode, 0);
  }
  const rel = `docs/openspec/changes/${change}`;
  assert.equal(run(['state', 'set', change, 'design_doc', `${rel}/design.md`, 'test_intent', `${rel}/test-intent.md`, 'plan', `docs/superpowers/plans/${change}-plan.md`, '--json']).json?.exitCode, 0);
  assert.equal(run(['state', 'transition', change, 'open-complete', '--json']).json?.exitCode, 0);
  acceptAll(change, ['R', 'A', 'T', 'P'], root, authorityEnv);
  assert.equal(run(['state', 'complete-design', change, '--design-doc', `${rel}/design.md`, '--json']).json?.exitCode, 0);
  assert.equal(run(['state', 'set', change, 'build_mode', 'executing-plans', 'tdd_mode', 'tdd', 'isolation', 'current', '--json']).json?.exitCode, 0);
  await writeCheckPolicy(root);
  const tasks = run(['state', 'tasks', change, '--assign-ids', '--json']).json;
  acceptAll(change, ['P'], root, authorityEnv);
  assert.equal(run(['state', 'task-complete', change, tasks?.data?.tasks?.[0]?.id, '--expect', tasks?.data?.revision, '--json']).json?.exitCode, 0);
  acceptAll(change, ['P'], root, authorityEnv);
  assert.equal(run(['check', 'run', change, 'build', '--local', '--', 'node', '-e', 'process.stdout.write("build-ok\\n")']).status, 0);
  assert.equal(run(['state', 'transition', change, 'build-complete', '--json']).json?.exitCode, 0);
  await fs.writeFile(path.join(changeDir(change, root), 'verification.md'), '# Verification Report\n\nProbe.\n');
  assert.equal(run(['state', 'set', change, 'verification_report', `docs/openspec/changes/${change}/verification.md`, '--json']).json?.exitCode, 0);
  assert.equal(run(['check', 'run', change, 'verify', '--local', '--', 'node', '-e', 'process.stdout.write("verify-ok\\n")']).status, 0);
  acceptAll(change, ['V'], root, authorityEnv);
  assert.equal(run(['state', 'transition', change, 'verify-pass', '--json']).json?.exitCode, 0);
  assert.equal(run(['state', 'transition', change, 'archive-confirm', '--json']).json?.exitCode, 0);
  return changeDir(change, root);
}

// Drive through the real archive move: archived=true with the knowledge
// closeout obligation unmet (the post-archive continuation state).
async function driveToArchived(change, options = {}) {
  await driveToArchiveReady(change, options);
  const root = options.root ?? project;
  assert.equal(comet(['archive', change, '--json'], { root }).status, 0, plain(comet(['archive', change]).stderr ?? ''));
  return archivedDir(change, root);
}

const stateDigests = async (dir) => {
  const read = async (relative) => {
    try { return sha256(await fs.readFile(path.join(dir, relative), 'utf8')); } catch { return 'missing'; }
  };
  return {
    yaml: await read('.comet.yaml'),
    run: await read(path.join('.comet', 'run-state.json')),
    dispatches: await read(path.join('.comet', 'gate-dispatches.json')),
  };
};

const skipIfNoBuild = (t) => {
  if (!prepared || !built) {
    t.skip('patched Comet build is not present in this project; run tools/comet/prepare-source.mjs && tools/comet/build.mjs --archive first');
    return true;
  }
  return false;
};

test('setup: the build is manifest-verified and carries the 0003 post-archive extension', (t) => {
  if (skipIfNoBuild(t)) return;
  assert.notEqual(fingerprint, F2, 'the 0003 post-archive patch must produce a new fingerprint');
  assert.equal(has0003, true, 'the lock must register 0003-post-archive-closeout.patch');
  const version = comet(['--version']);
  assert.equal(version.status, 0);
  assert.equal((version.stdout ?? '').trim(), lock.package.version);
  assert.equal(worldReady, true, 'the scratch worlds must be comet-init (classic) projects');
});

// World setup runs at load (guarded on the build) so the probes below always
// exercise real behavior; without a build every test skips instead.
let worldReady = false;
if (prepared && built) {
  const init = comet(['init', project, '--yes', '--scope', 'project', '--workflow', 'classic', '--platform', 'claude', '--codegraph', 'skip', '--language', 'en'], { timeout: 300_000 });
  if (init.status === 0) worldReady = true;
  else process.stderr.write(`comet init (classic) failed: ${plain(init.stderr).slice(0, 400)}\n`);
}

test('H02: repeated method hooks stay advisory — no execution claim, no dispatch, no gate movement', async (t) => {
  if (skipIfNoBuild(t)) return;
  const change = 'p46-h02';
  await writeArtifacts(change);
  assert.equal(comet(['state', 'init', change, 'full', '--managed-delivery', '--knowledge-closeout-required', 'true', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'select', change, '--json']).json?.exitCode, 0);
  const rel = `docs/openspec/changes/${change}`;
  comet(['state', 'set', change, 'design_doc', `${rel}/design.md`, 'test_intent', `${rel}/test-intent.md`, 'plan', `docs/superpowers/plans/${change}-plan.md`, '--json']);
  comet(['state', 'transition', change, 'open-complete', '--json']);
  acceptAll(change, ['R']);
  // An open review dispatch is in flight; the hook storm must not touch it.
  const dispatched = comet(['state', 'dispatch-gate', change, 'A', '--json']);
  assert.equal(dispatched.json?.exitCode, 0);
  const before = await stateDigests(changeDir(change));
  const gatesBefore = comet(['state', 'gates', change, '--json']).json?.data?.evaluation;
  const router = path.join(project, '.claude/skills/comet/scripts/comet-hook-router.mjs');
  const hookPayload = (event, mode) => JSON.stringify({
    session_id: `p46-hook-${Math.random().toString(36).slice(2)}`,
    hook_event_name: event,
    cwd: project,
    ...(event === 'PreToolUse'
      ? { tool_name: 'Write', tool_input: { file_path: path.join(project, 'src/feature.js'), content: 'probe' } }
      : { ...(mode ? { mode } : {}) }),
  });
  for (const [event, mode] of [
    ['SessionStart', undefined], ['SessionStart', undefined], ['SubagentStart', undefined],
    ['UserPromptSubmit', 'plan'], ['SessionStart', 'bypassPermissions'],
  ]) {
    const probe = spawnSync(nodeExecutable, [router, '--platform', 'claude', '--project-root', project], {
      cwd: project, encoding: 'utf8', timeout: 60_000,
      input: hookPayload(event, mode), env: childEnv(),
    });
    assert.equal(probe.status, 0, `hook ${event} must stay advisory, got ${probe.status}: ${plain(probe.stderr).slice(0, 200)}`);
    const decision = JSON.parse(probe.stdout || '{}');
    assert.notEqual(decision.permissionDecision ?? decision.decision, 'deny', `advisory hook ${event} denied a session event`);
  }
  const after = await stateDigests(changeDir(change));
  assert.deepEqual(after, before, 'repeated method hooks must not mutate Run state, receipts or the dispatch registry');
  const gatesAfter = comet(['state', 'gates', change, '--json']).json?.data?.evaluation;
  assert.deepEqual(gatesAfter?.missing, gatesBefore?.missing, 'a mode change must not alter the managed gate evaluation');
  // The resume-probe entrance is equally read-only over the same state.
  const probeRun = comet(['resume-probe', JSON.stringify({ utterance: 'continue', agent_context: { non_trivial_work: true, already_in_comet_flow: false } }), '--json']);
  assert.equal(probeRun.status, 0, plain(probeRun.stderr).slice(0, 200));
  const afterProbe = await stateDigests(changeDir(change));
  assert.deepEqual(afterProbe, before, 'the resume probe must not write Run state');
});

test('H06: review job keys — an open job recovers in place; stale attempts cannot complete; new revisions keep their own manifest', async (t) => {
  if (skipIfNoBuild(t)) return;
  const change = 'p46-h06';
  await writeArtifacts(change);
  assert.equal(comet(['state', 'init', change, 'full', '--managed-delivery', '--knowledge-closeout-required', 'true', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'select', change, '--json']).json?.exitCode, 0);
  const rel = `docs/openspec/changes/${change}`;
  comet(['state', 'set', change, 'design_doc', `${rel}/design.md`, 'test_intent', `${rel}/test-intent.md`, 'plan', `docs/superpowers/plans/${change}-plan.md`, '--json']);
  comet(['state', 'transition', change, 'open-complete', '--json']);
  acceptAll(change, ['R']);
  const first = comet(['state', 'dispatch-gate', change, 'A', '--json']);
  assert.equal(first.json?.exitCode, 0);
  const firstBinding = first.json?.data?.dispatch;
  // Session restart re-reads the same job: the SAME open operation must come
  // back, not a second dispatch over the same inputs.
  const again = comet(['state', 'dispatch-gate', change, 'A', '--json']);
  assert.equal(again.json?.exitCode, 0);
  const againBinding = again.json?.data?.dispatch;
  assert.equal(againBinding.execution, firstBinding.execution, 'the same open job_key must recover the original dispatch');
  assert.equal(againBinding.attempt, firstBinding.attempt, 'a recovered job is not a new attempt');
  const registryPath = path.join(changeDir(change), '.comet', 'gate-dispatches.json');
  const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
  const openForVersion = registry.dispatches.filter((d) => d.gate === 'A' && d.state === 'open');
  assert.equal(openForVersion.length, 1, 'exactly one open dispatch may exist per job key');
  // The accepted result consumes the dispatch; a late duplicate is refused.
  acceptGate(change, 'A');
  const late = path.join(scratch, 'h06-late.json');
  await fs.writeFile(late, JSON.stringify({ execution: firstBinding.execution, attempt: firstBinding.attempt, verdict: 'pass' }));
  const replay = comet(['state', 'accept-gate', change, 'A', '--file', late, '--json']);
  assert.equal(replay.json?.exitCode !== 0, true, 'a consumed dispatch accepts exactly one result');
  // A design revision creates a NEW job key: its own manifest/attempt space,
  // and the old entry stays in the registry as history.
  await fs.writeFile(path.join(changeDir(change), 'design.md'), `---\ncomet_change: ${change}\nrole: technical-design\ncanonical_spec: openspec\n---\n\n# Design\n\nRevised design (v2).\n`);
  const revised = comet(['state', 'dispatch-gate', change, 'A', '--json']);
  assert.equal(revised.json?.exitCode, 0);
  const revisedBinding = revised.json?.data?.dispatch;
  assert.equal(revisedBinding.attempt, 1, 'the attempt counter is per input version');
  assert.notEqual(revisedBinding.inputDigest, firstBinding.inputDigest, 'a revised review package is a different job key');
  // A result bound to the OLD (superseded) attempt cannot complete the new job.
  const stale = path.join(scratch, 'h06-stale.json');
  await fs.writeFile(stale, JSON.stringify({ execution: firstBinding.execution, attempt: firstBinding.attempt, verdict: 'pass' }));
  const staleRefused = comet(['state', 'accept-gate', change, 'A', '--file', stale, '--json']);
  assert.equal(staleRefused.json?.exitCode !== 0, true, 'an old attempt result cannot complete the new task');
  const history = JSON.parse(await fs.readFile(registryPath, 'utf8'));
  assert.ok(history.dispatches.length >= 2, 'old job history is retained, not deleted');
});

test('H03: same job_key claim is atomic — concurrent dispatchers converge on one open owner', async (t) => {
  if (skipIfNoBuild(t)) return;
  const change = 'p46-h03';
  await writeArtifacts(change);
  assert.equal(comet(['state', 'init', change, 'full', '--managed-delivery', '--knowledge-closeout-required', 'true', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'select', change, '--json']).json?.exitCode, 0);
  const rel = `docs/openspec/changes/${change}`;
  comet(['state', 'set', change, 'design_doc', `${rel}/design.md`, 'test_intent', `${rel}/test-intent.md`, 'plan', `docs/superpowers/plans/${change}-plan.md`, '--json']);
  comet(['state', 'transition', change, 'open-complete', '--json']);
  acceptAll(change, ['R']);
  // Two sessions race the same job_key through the real CLI at once.
  const racer = () => new Promise((resolve) => {
    const child = spawn(nodeExecutable, [entrypoint, 'state', 'dispatch-gate', change, 'A', '--json'], {
      cwd: project, env: childEnv(),
    });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('close', (code) => resolve({ code, out }));
  });
  const [left, right] = await Promise.all([racer(), racer()]);
  assert.equal(left.code, 0, `the first claimant must resolve the job: ${plain(left.out).slice(0, 200)}`);
  assert.equal(right.code, 0, `the second claimant must resolve the job: ${plain(right.out).slice(0, 200)}`);
  const parse = (output) => {
    const parsed = JSON.parse(output.trim().split('\n').pop());
    return parsed.data?.dispatch ?? parsed;
  };
  const leftBinding = parse(left.out);
  const rightBinding = parse(right.out);
  assert.equal(leftBinding.execution, rightBinding.execution, 'both sessions must observe the same open operation');
  assert.equal(leftBinding.attempt, rightBinding.attempt, 'no second attempt may be minted for the same open job');
  const registry = JSON.parse(await fs.readFile(path.join(changeDir(change), '.comet', 'gate-dispatches.json'), 'utf8'));
  const openForVersion = registry.dispatches.filter((d) => d.gate === 'A' && d.inputDigest === leftBinding.inputDigest);
  assert.equal(openForVersion.length, 1, 'the registry holds exactly one open dispatch for the job key');
  // The single owner accepts; the claim is consumed exactly once.
  acceptGate(change, 'A', { execution: leftBinding.execution, attempt: leftBinding.attempt });
});

test('H07: the native archive path keeps the run open — status, continuation and completion disagree with completed', async (t) => {
  if (skipIfNoBuild(t)) return;
  const change = 'p46-h07';
  const dir = await driveToArchived(change);
  // H07: archived proves the spec operation; the run itself must not be
  // completed nor lose its recovery entry through the native completed path.
  const run = await runStateOf(dir);
  assert.notEqual(run.status, 'completed', 'a closeout-pending run must not be stamped completed by the archive path');
  assert.equal(run.currentStep, 'full.closeout.knowledge');
  const next = comet(['state', 'next', change, '--json']);
  assert.equal(next.json?.data?.nextAction?.kind, 'knowledge-closeout');
  const gates = comet(['state', 'gates', change, '--json']);
  assert.equal(gates.json?.data?.completionBlocked, true);
  // Selection: the archive command must not have cleared the current-change
  // recovery entry while the closeout is pending (needsAuthorization here).
  const selection = JSON.parse(await fs.readFile(path.join(project, '.comet', 'current-change.json'), 'utf8'));
  assert.equal(selection.selection?.change ?? selection.change, change, 'the closeout-pending run keeps its selection entry');
  // Close the seat: only now does the same run complete.
  const knowledgeFile = path.join(project, 'knowledge', `llmwiki-${change}.md`);
  await fs.mkdir(path.dirname(knowledgeFile), { recursive: true });
  await fs.writeFile(knowledgeFile, '# Project Knowledge\n\nPost-archive closeout probe.\n');
  const receipt = path.join(scratch, `kc-${change}.json`);
  await fs.writeFile(receipt, JSON.stringify({
    targetKind: 'file',
    target: path.relative(project, knowledgeFile),
    revision: 'r1',
    readbackDigest: sha256(await fs.readFile(knowledgeFile, 'utf8')),
    execution: 'driver-exec-h07',
    recordedAt: new Date().toISOString(),
  }));
  const recorded = comet(['state', 'knowledge-closeout', change, '--file', receipt, '--json']);
  assert.equal(recorded.json?.exitCode, 0, plain(recorded.stderr).slice(0, 300));
  const runAfter = await runStateOf(dir);
  assert.equal(runAfter.status, 'completed', 'the same run completes only after the knowledge seat is filled');
  void dir;
});

test('H01: Git-delivery-complete but knowledge-pending — discovery, selection and re-entry still find the original run', async (t) => {
  if (skipIfNoBuild(t)) return;
  // A real Git coordination root: delivery authorization + an archive commit
  // make the native delivery verification report complete.
  const gitRoot = path.join(scratch, 'git-world');
  await fs.mkdir(gitRoot, { recursive: true });
  const git = (args, cwd = gitRoot) => {
    const result = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: childEnv({}, gitRoot) });
    assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${plain(result.stderr).slice(0, 200)}`);
    return result.stdout.trim();
  };
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'p46@example.test']);
  git(['config', 'user.name', 'p46']);
  git(['commit', '--allow-empty', '-m', 'world init']);
  const gitInit = comet(['init', gitRoot, '--yes', '--scope', 'project', '--workflow', 'classic', '--platform', 'claude', '--codegraph', 'skip', '--language', 'en'], { root: gitRoot, timeout: 300_000 });
  assert.equal(gitInit.status, 0, `comet init (git world) failed: ${plain(gitInit.stderr).slice(0, 300)}`);
  const change = 'p46-h01';
  await driveToArchiveReady(change, { root: gitRoot });
  // Authorization is recorded pre-archive (archive phase, verify pass, not
  // archived). Progress input files live inside the project path base.
  const authFile = path.join(gitRoot, 'h01-delivery-auth.json');
  await fs.writeFile(authFile, JSON.stringify({ action: 'local', targetBranch: 'main' }));
  assert.equal(comet(['state', 'delivery', change, '--file', 'h01-delivery-auth.json', '--json'], { root: gitRoot }).json?.exitCode, 0, refusalText(comet(['state', 'delivery', change, '--file', 'h01-delivery-auth.json'], { root: gitRoot })));
  const dir = await (async () => {
    assert.equal(comet(['archive', change, '--json'], { root: gitRoot }).status, 0);
    return archivedDir(change, gitRoot);
  })();
  git(['add', '-A']);
  git(['commit', '-m', 'archive p46-h01']);
  const commit = git(['rev-parse', 'HEAD']);
  const commitFile = path.join(gitRoot, 'h01-delivery-commit.json');
  await fs.writeFile(commitFile, JSON.stringify({ action: 'local', targetBranch: 'main', commit }));
  const deliveryWrite = comet(['state', 'delivery', change, '--file', 'h01-delivery-commit.json', '--json'], { root: gitRoot });
  await fs.rm(commitFile);
  assert.equal(deliveryWrite.json?.exitCode, 0, refusalText(deliveryWrite).slice(0, 400));
  const delivery = comet(['state', 'delivery', change, '--json'], { root: gitRoot });
  assert.equal(delivery.json?.data?.verification?.status, 'complete', 'the fixture must reach a complete Git delivery verification');
  const runIdBefore = (await runStateOf(dir)).runId;
  // H01 discovery: the resume probe must still find the pending archived run.
  const probe = comet(['resume-probe', JSON.stringify({ utterance: 'continue', agent_context: { non_trivial_work: true, already_in_comet_flow: false } }), '--json'], { root: gitRoot });
  let resolution = {};
  try {
    resolution = probe.json?.action ? probe.json : JSON.parse(probe.json?.stdout ?? probe.stdout ?? '{}');
  } catch {
    resolution = { action: undefined, reason: plain(probe.stdout).slice(0, 200) };
  }
  assert.equal(resolution.action, 'ask_user', `the pending archived run must be discovered, got ${resolution.action} (${resolution.reason}); raw ${plain(probe.stdout).slice(0, 200)}`);
  assert.equal(resolution.changeName, change, 'discovery must name the archived change');
  assert.match(resolution.reason ?? '', /archived/i);
  // H01 selection: the archived closeout-pending change stays selectable and
  // the archive path never cleared the recovery entry.
  assert.equal(comet(['state', 'select', change, '--json'], { root: gitRoot }).json?.exitCode, 0, 'an archived closeout-pending run must remain selectable');
  const selection = JSON.parse(await fs.readFile(path.join(gitRoot, '.comet', 'current-change.json'), 'utf8'));
  assert.equal(selection.selection?.change ?? selection.change, change, 'the selection entry names the archived run');
  const current = comet(['state', 'current', '--json'], { root: gitRoot });
  assert.equal(current.status, 0, plain(current.stderr).slice(0, 200));
  const currentName = String(current.json?.stdout ?? current.stdout ?? '').trim();
  assert.equal(currentName, change, 'state current resolves the archived closeout-pending run');
  // H01 continuation: next points at the closeout of the SAME run; the
  // re-run archive command re-enters without archiving again.
  const next = comet(['state', 'next', change, '--json'], { root: gitRoot });
  assert.equal(next.json?.data?.nextAction?.kind, 'knowledge-closeout');
  assert.equal(comet(['archive', change, '--json'], { root: gitRoot }).status, 0, 'archive re-entry must succeed without re-archiving');
  const archiveEntries = await fs.readdir(path.join(gitRoot, 'docs/openspec/changes/archive'));
  assert.equal(archiveEntries.filter((name) => name.endsWith(change)).length, 1, 're-entry must not create a second archive');
  assert.equal((await runStateOf(dir)).runId, runIdBefore, 'the original run_id survives re-entry');
});

test('H04: the Outline document UUID is fixed before the first request; a lost receipt recovers onto the same document and unknown is never absence', async (t) => {
  if (skipIfNoBuild(t)) return;
  const change = 'p46-h04';
  const dir = await driveToArchived(change);
  // The closeout window must still issue the Runtime K dispatch post-archive.
  const dispatch = comet(['state', 'dispatch-gate', change, 'K', '--json']);
  assert.equal(dispatch.json?.exitCode, 0, `the archived closeout window must dispatch K: ${plain(dispatch.stderr).slice(0, 300)}`);
  const binding = dispatch.json?.data?.dispatch;
  const documentId = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  const op = {
    knowledgeId: 'k-llmwiki-closeout',
    documentId,
    collection: 'engineering',
    payloadDigest: sha256('approved closeout payload v1'),
  };
  const opFile = path.join(scratch, 'h04-op.json');
  await fs.writeFile(opFile, JSON.stringify(op));
  const registered = comet(['state', 'knowledge-publish', change, '--file', opFile, '--json']);
  assert.equal(registered.json?.exitCode, 0, `knowledge-publish refused: ${refusalText(registered).slice(0, 300)}`);
  const operation = registered.json?.data?.operation;
  assert.equal(operation.documentId, documentId, 'the client UUID is persisted as the fixed target identity');
  assert.equal(operation.state, 'pending');
  // Lost receipt: the retry (same job key) recovers the SAME operation and
  // document — never a second logical document.
  const retry = comet(['state', 'knowledge-publish', change, '--file', opFile, '--json']);
  assert.equal(retry.json?.exitCode, 0);
  assert.equal(retry.json?.data?.operation?.operationKey, operation.operationKey);
  assert.equal(retry.json?.data?.operation?.documentId, documentId, 'the retry must reuse the fixed document UUID');
  // A remote outcome of 403/timeout is UNKNOWN, not absence: the directive
  // must not be create, and a receipt over unknown is refused.
  const unknownFile = path.join(scratch, 'h04-unknown.json');
  await fs.writeFile(unknownFile, JSON.stringify({ operationKey: operation.operationKey, documentId, outcome: 'unknown' }));
  const observed = comet(['state', 'knowledge-observe', change, '--file', unknownFile, '--json']);
  assert.equal(observed.json?.exitCode, 0, plain(observed.stderr).slice(0, 300));
  assert.equal(observed.json?.data?.operation?.state, 'pending', 'an unknown outcome keeps the operation open');
  assert.notEqual(observed.json?.data?.directive?.action, 'create', 'unknown must never degrade to create');
  const premature = path.join(scratch, 'h04-premature.json');
  await fs.writeFile(premature, JSON.stringify({
    targetKind: 'external', target: documentId, revision: 'rev-1',
    readbackDigest: op.payloadDigest, execution: binding.execution, recordedAt: new Date().toISOString(),
  }));
  const refused = comet(['state', 'knowledge-closeout', change, '--file', premature, '--json']);
  assert.equal(refused.json?.exitCode !== 0, true, 'a receipt without an independent readback is refused');
  // The readback lands (documents.info over the fixed UUID): only now does
  // the closeout accept, and the same run completes.
  const existsFile = path.join(scratch, 'h04-exists.json');
  await fs.writeFile(existsFile, JSON.stringify({
    operationKey: operation.operationKey, documentId, outcome: 'exists',
    revision: 'rev-1', readbackDigest: op.payloadDigest,
  }));
  const readback = comet(['state', 'knowledge-observe', change, '--file', existsFile, '--json']);
  assert.equal(readback.json?.exitCode, 0, plain(readback.stderr).slice(0, 300));
  const recorded = comet(['state', 'knowledge-closeout', change, '--file', premature, '--json']);
  assert.equal(recorded.json?.exitCode, 0, plain(recorded.stderr).slice(0, 300));
  assert.equal((await runStateOf(dir)).status, 'completed', 'the recovered publication completes the same run');
});

test('H05: a lastRevision conflict stays open — no revision refresh, no blind overwrite, identity is owned', async (t) => {
  if (skipIfNoBuild(t)) return;
  const change = 'p46-h05';
  const dir = await driveToArchived(change);
  assert.equal(comet(['state', 'dispatch-gate', change, 'K', '--json']).json?.exitCode, 0);
  const documentId = '9f2504e0-4f89-11d3-9a0c-0305e82c3302';
  const create = {
    knowledgeId: 'k-llmwiki-conflict',
    documentId,
    collection: 'engineering',
    payloadDigest: sha256('conflict probe payload v1'),
  };
  const createFile = path.join(scratch, 'h05-create.json');
  await fs.writeFile(createFile, JSON.stringify(create));
  assert.equal(comet(['state', 'knowledge-publish', change, '--file', createFile, '--json']).json?.exitCode, 0);
  const createOp = comet(['state', 'knowledge-publish', change, '--file', createFile, '--json']).json?.data?.operation;
  const existsFile = path.join(scratch, 'h05-exists.json');
  await fs.writeFile(existsFile, JSON.stringify({
    operationKey: createOp.operationKey, documentId, outcome: 'exists',
    revision: 'rev-1', readbackDigest: create.payloadDigest,
  }));
  assert.equal(comet(['state', 'knowledge-observe', change, '--file', existsFile, '--json']).json?.exitCode, 0);
  // A revision update must build on the registered last revision and reuse
  // the fixed document identity.
  const update = { ...create, payloadDigest: sha256('conflict probe payload v2'), baseRevision: 'rev-1' };
  const updateFile = path.join(scratch, 'h05-update.json');
  await fs.writeFile(updateFile, JSON.stringify(update));
  const updateOp = comet(['state', 'knowledge-publish', change, '--file', updateFile, '--json']);
  assert.equal(updateOp.json?.exitCode, 0, plain(updateOp.stderr).slice(0, 300));
  assert.equal(updateOp.json?.data?.operation?.documentId, documentId, 'an update reuses the same logical document');
  // Another legitimate writer moves the remote revision first: 409 conflict.
  const conflictFile = path.join(scratch, 'h05-conflict.json');
  await fs.writeFile(conflictFile, JSON.stringify({ operationKey: updateOp.json.data.operation.operationKey, documentId, outcome: 'conflict' }));
  const conflicted = comet(['state', 'knowledge-observe', change, '--file', conflictFile, '--json']);
  assert.equal(conflicted.json?.exitCode, 0);
  assert.equal(conflicted.json?.data?.operation?.state, 'conflict', 'the conflict is retained, not papered over');
  assert.notEqual(conflicted.json?.data?.directive?.action, 'update', 'a conflict must not refresh into another blind update');
  // Refreshing the revision and re-issuing the overwrite is refused.
  const refreshed = { ...update, baseRevision: 'rev-9' };
  const refreshFile = path.join(scratch, 'h05-refresh.json');
  await fs.writeFile(refreshFile, JSON.stringify(refreshed));
  const refreshRefused = comet(['state', 'knowledge-publish', change, '--file', refreshFile, '--json']);
  assert.equal(refreshRefused.json?.exitCode !== 0, true, 'a revision refresh without readback evidence must be refused');
  // A receipt claiming the overwrite landed is refused while unresolved.
  const dispatch2 = comet(['state', 'dispatch-gate', change, 'K', '--json']);
  const binding2 = dispatch2.json?.data?.dispatch;
  const overwrite = path.join(scratch, 'h05-overwrite.json');
  await fs.writeFile(overwrite, JSON.stringify({
    targetKind: 'external', target: documentId, revision: 'rev-2',
    readbackDigest: update.payloadDigest, execution: binding2.execution, recordedAt: new Date().toISOString(),
  }));
  const overwriteRefused = comet(['state', 'knowledge-closeout', change, '--file', overwrite, '--json']);
  assert.equal(overwriteRefused.json?.exitCode !== 0, true, 'a conflicted update cannot be recorded as published');
  assert.notEqual((await runStateOf(dir)).status, 'completed', 'the run stays open with an unresolved conflict');
  // The independent readback shows the merged remote content (v2 at rev-2):
  // the expected result exists, so the conflict resolves onto the receipt.
  const mergedFile = path.join(scratch, 'h05-merged.json');
  await fs.writeFile(mergedFile, JSON.stringify({
    operationKey: updateOp.json.data.operation.operationKey, documentId, outcome: 'exists',
    revision: 'rev-2', readbackDigest: update.payloadDigest,
  }));
  const mergedObserved = comet(['state', 'knowledge-observe', change, '--file', mergedFile, '--json']);
  assert.equal(mergedObserved.json?.exitCode, 0, refusalText(mergedObserved).slice(0, 400));
  // Document identity is owned: a different knowledge entry cannot claim it.
  const identity = {
    knowledgeId: 'k-other-entry',
    documentId,
    collection: 'engineering',
    payloadDigest: sha256('a different payload'),
  };
  const identityFile = path.join(scratch, 'h05-identity.json');
  await fs.writeFile(identityFile, JSON.stringify(identity));
  const identityRefused = comet(['state', 'knowledge-publish', change, '--file', identityFile, '--json']);
  assert.equal(identityRefused.json?.exitCode !== 0, true, 'a document UUID belongs to one knowledge entry');
});

test('H08: a lost run state is never fabricated — the workspace keeps its recovery copy until completed', async (t) => {
  if (skipIfNoBuild(t)) return;
  const change = 'p46-h08';
  const dir = await driveToArchived(change);
  const knowledgeFile = path.join(project, 'knowledge', `llmwiki-${change}.md`);
  await fs.mkdir(path.dirname(knowledgeFile), { recursive: true });
  await fs.writeFile(knowledgeFile, '# Project Knowledge\n\nCleanup probe.\n');
  const receipt = path.join(scratch, `kc-${change}.json`);
  await fs.writeFile(receipt, JSON.stringify({
    targetKind: 'file',
    target: path.relative(project, knowledgeFile),
    revision: 'r1',
    readbackDigest: sha256(await fs.readFile(knowledgeFile, 'utf8')),
    execution: 'driver-exec-h08',
    recordedAt: new Date().toISOString(),
  }));
  const runStateFile = path.join(dir, '.comet', 'run-state.json');
  const preserved = await fs.readFile(runStateFile, 'utf8');
  await fs.rm(runStateFile);
  const yamlBefore = await fs.readFile(path.join(dir, '.comet.yaml'), 'utf8');
  // The recovery entrance must refuse to mutate a run-less state instead of
  // minting a replacement run.
  const refused = comet(['state', 'knowledge-closeout', change, '--file', receipt, '--json']);
  assert.equal(refused.json?.exitCode !== 0, true, 'a run-less closeout state must be refused as recovery-required');
  assert.match(refusalText(refused), /run state|run_id|recovery/i);
  const yamlAfter = await fs.readFile(path.join(dir, '.comet.yaml'), 'utf8');
  assert.equal(yamlAfter, yamlBefore, 'the refused entrance must not mutate the change state');
  await fs.writeFile(runStateFile, preserved);
  // The original state restored, the same closeout completes the same run.
  assert.equal(comet(['state', 'knowledge-closeout', change, '--file', receipt, '--json']).json?.exitCode, 0);
  assert.equal((await runStateOf(dir)).status, 'completed');
});

test('H09: the authority binding decides — a copied workspace is not a second writer and transfer is explicit', async (t) => {
  if (skipIfNoBuild(t)) return;
  const change = 'p46-h09';
  const dir = await driveToArchived(change, { authority: 'auth-alpha' });
  const binding = JSON.parse(await fs.readFile(path.join(dir, '.comet', 'run-authority.json'), 'utf8'));
  assert.equal(binding.authorityId, 'auth-alpha', 'init records the run authority from the runtime environment');
  const knowledgeFile = path.join(project, 'knowledge', `llmwiki-${change}.md`);
  await fs.mkdir(path.dirname(knowledgeFile), { recursive: true });
  await fs.writeFile(knowledgeFile, '# Project Knowledge\n\nAuthority probe.\n');
  const receipt = path.join(scratch, `kc-${change}.json`);
  await fs.writeFile(receipt, JSON.stringify({
    targetKind: 'file',
    target: path.relative(project, knowledgeFile),
    revision: 'r1',
    readbackDigest: sha256(await fs.readFile(knowledgeFile, 'utf8')),
    execution: 'driver-exec-h09',
    recordedAt: new Date().toISOString(),
  }));
  // A copied workspace (the "other machine" state) with a different
  // environment authority must not become a second writer.
  const copy = path.join(scratch, 'copy-of-managed');
  await fs.cp(project, copy, { recursive: true });
  const copied = comet(['state', 'knowledge-closeout', change, '--file', receipt, '--json'], { env: { COMET_RUN_AUTHORITY: 'auth-beta' }, root: copy });
  assert.equal(copied.json?.exitCode !== 0, true, 'a copied workspace under a foreign authority is refused');
  assert.match(refusalText(copied), /authorit/i);
  // The original under a foreign authority is refused equally.
  const foreign = comet(['state', 'knowledge-closeout', change, '--file', receipt, '--json'], { env: { COMET_RUN_AUTHORITY: 'auth-beta' } });
  assert.equal(foreign.json?.exitCode !== 0, true, 'a foreign authority cannot write the bound run');
  // Queries stay readable from any host; the run is untouched.
  const beforeQuery = await stateDigests(dir);
  const query = comet(['state', 'next', change, '--json'], { env: { COMET_RUN_AUTHORITY: 'auth-beta' } });
  assert.equal(query.json?.data?.nextAction?.kind, 'knowledge-closeout', 'a foreign host may still read the next action');
  assert.deepEqual(await stateDigests(dir), beforeQuery, 'a foreign read must not mutate the bound run');
  // Migration is explicit and performed BY the authoritative environment.
  const transferFile = path.join(scratch, 'h09-transfer.json');
  await fs.writeFile(transferFile, JSON.stringify({ to: 'auth-beta', confirm: true }));
  const transfer = comet(['state', 'authority-transfer', change, '--file', transferFile, '--json'], { env: { COMET_RUN_AUTHORITY: 'auth-alpha' } });
  assert.equal(transfer.json?.exitCode, 0, refusalText(transfer).slice(0, 400));
  const after = JSON.parse(await fs.readFile(path.join(dir, '.comet', 'run-authority.json'), 'utf8'));
  assert.equal(after.authorityId, 'auth-beta', 'the confirmed transfer moves the binding');
  assert.equal(comet(['state', 'knowledge-closeout', change, '--file', receipt, '--json'], { env: { COMET_RUN_AUTHORITY: 'auth-beta' } }).json?.exitCode, 0, 'the new authority completes the closeout');
  assert.equal((await runStateOf(dir)).status, 'completed');
  const oldAuthority = comet(['state', 'knowledge-closeout', change, '--file', receipt, '--json'], { env: { COMET_RUN_AUTHORITY: 'auth-alpha' } });
  assert.equal(oldAuthority.json?.exitCode !== 0 || oldAuthority.json?.data?.alreadyRecorded === true, true);
});
