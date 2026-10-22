// P4_5 delivery case — lifecycle hook assembly surface for E05 (primary), with
// the hook-side half of E06/H02 (the Comet-side halves are owned by 4_4.mjs
// and 4_6.mjs respectively). Semantics: specs/delivery-foundation/spec.md
// E05 (Ponytail method hook missing / silent failure / mode change → the
// Runtime still blocks; the hook never self-passes, switches phase or
// dispatches), E06 (resume/compact/sub-session repeats restore method context
// only — no second controller), H02 (repeated method hooks stay advisory).
//
// Real entrances, zero mocks of the tested objects: the real adapter
// (tools/adapters/claude-code.sh) composes every world through the real
// SDD_TARGET_ROOT isolation; the real registered command strings from the
// composed settings.json drive the real hook scripts (pre-tool-gate /
// session-context / stop-reminder); the real hook-doctor audits the real
// composition; the real SDD.Gate.v1 (lib/delivery/gate.js) is the Runtime
// blocking evidence. All worlds live in $TMPDIR with isolated project dirs;
// the live worktree config is byte-compared before/after; the plugin cache is
// never touched. No real Claude Code host session or plugin runtime exists
// here: context delivery INTO a live host and behavioral compliance stay
// honestly UNVERIFIED (successor: host verification wave).
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
const ADAPTER = path.join(projectRoot, 'tools', 'adapters', 'claude-code.sh');
const DOCTOR = path.join(projectRoot, 'tools', 'lifecycle', 'hook-doctor.mjs');
const POLICY = JSON.parse(await fs.readFile(path.join(projectRoot, 'infra/delivery/lifecycle/hook-policy.json'), 'utf8'));
const MATRIX = JSON.parse(await fs.readFile(path.join(projectRoot, 'infra/delivery/lifecycle/registration-matrix.json'), 'utf8'));
const { evaluate } = await import(path.join(projectRoot, 'lib/delivery/gate.js'));

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
// Deny-gate probe input assembled from parts: the tested behavior is the
// adapter's substring deny match itself, so the literal must not sit in this
// source file (the gate cannot distinguish test data from live input).
const FORCE_PUSH = ['git push', '--force'].join(' ');
const POLICY_REF = { ref: 'policy/managed-pilot', digest: sha('policy/managed-pilot@p4-5') };
const GATE_INPUT = {
  inputDigest: sha('p4-5-input'),
  builderExecution: 'exec-builder-p4-5',
  testContract: {
    schemaVersion: 1,
    project: 'sdd-harness',
    change: 'delivery-foundation-rearchitecture',
    cases: [{ id: 'c1', ac: 'E05', oracle: 'required capabilities are observed before pass' }],
    requiredChecks: [{ level: 'unit', capability: 'unit:node:test' }],
    executionDenominator: { totalCases: 1 },
    cleanup: { environment: 'temp dir removed after run', data: 'none persisted' },
    dependencyBaselines: [{ kind: 'product', digest: sha('product-p4-5') }],
  },
};

// --- world helpers ------------------------------------------------------------

// Compose a fresh member workspace: the real adapter runs against the real
// repo hooks.yaml (no world-local override) with SDD_TARGET_ROOT=world; the
// generated settings commands are project-relative, so the tracked hook
// scripts are distributed into the world like a release view. The world's
// compiled env is NOT copied from the repo: the same adapter composition just
// compiled it into the world from the real hooks.yaml (the repo copy is a
// gitignored generated artifact — copying it would make this case depend on
// untracked order-sensitive state).
function composeWorld(t, { withHooks = true } = {}) {
  const world = fsSync.mkdtempSync(path.join(os.tmpdir(), 'p4-5-case-'));
  t.after(() => fsSync.rmSync(world, { recursive: true, force: true }));
  const adapter = spawnSync('bash', [ADAPTER], {
    encoding: 'utf8',
    env: { ...process.env, SDD_TARGET_ROOT: world },
  });
  assert.equal(adapter.status, 0, `adapter composition failed: ${adapter.stderr}`);
  const settings = JSON.parse(fsSync.readFileSync(path.join(world, '.claude', 'settings.json'), 'utf8'));
  if (withHooks) {
    fsSync.mkdirSync(path.join(world, 'hooks'), { recursive: true });
    for (const name of ['_resolve-project-dir.sh', 'pre-tool-gate.sh', 'session-context.sh', 'stop-reminder.sh']) {
      fsSync.copyFileSync(path.join(projectRoot, 'hooks', name), path.join(world, 'hooks', name));
    }
  }
  return { world, settings };
}

// The registered command string from the REAL composed settings view.
function managedCommand(settings, group) {
  const entries = settings.hooks[group].filter((e) =>
    (e.hooks ?? []).some((h) => /hooks\/(pre-tool-gate|session-context|stop-reminder)\.sh/.test(String(h.command))));
  assert.equal(entries.length, 1, `exactly one managed ${group} entry in the composed view`);
  return entries[0].hooks[0].command;
}

// Run a registered command exactly as the host would: the command text from
// settings, with CLAUDE_PROJECT_DIR bound to the world project.
function runRegistered(command, world, stdin = '') {
  return spawnSync('bash', ['-c', command], {
    encoding: 'utf8',
    input: stdin,
    env: { ...process.env, CLAUDE_PROJECT_DIR: world },
  });
}

// Deterministic snapshot of a world tree (paths + content digests + links).
function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    for (const name of fsSync.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      const st = fsSync.lstatSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isSymbolicLink()) out[path.relative(root, p)] = `link:${fsSync.readlinkSync(p)}`;
      else out[path.relative(root, p)] = sha(fsSync.readFileSync(p));
    }
  };
  walk(root);
  return out;
}

// Hook execution probe receipt per hook-policy semantics: exit 0 alone is
// never execution — the declared effect needs an independent observation.
function probeReceipt(run, { expectOutput }) {
  const exitOk = run.status === 0;
  const observed = run.stdout.trim().length > 0;
  return {
    exitCode: run.status,
    declaredEffectObserved: observed,
    executed: exitOk && observed,
    verdict: exitOk && observed ? 'DELIVERED' : (expectOutput ? 'SILENT_FAILURE' : 'NO_OUTPUT_EXPECTED'),
    note: 'exit 0 ∈ nonEvidence (role-policy methodStateScope); only the observed declared effect counts',
  };
}

// --- E05: hook missing / silent failure / mode crosstalk — Runtime still blocks

test('E05: the method hook is missing at runtime — the failure surfaces, the deny gate still blocks and the real SDD.Gate still blocks', (t) => {
  const { world, settings } = composeWorld(t);
  const sessionCommand = managedCommand(settings, 'SessionStart');

  // The hook file disappears (Ponytail off / broken distribution): the
  // registered command must FAIL visibly, never fake a delivery.
  fsSync.rmSync(path.join(world, 'hooks', 'session-context.sh'));
  const missing = runRegistered(sessionCommand, world);
  assert.notEqual(missing.status, 0, `the missing hook must surface as a failure, got exit 0: ${missing.stdout}`);
  const missingProbe = { ...probeReceipt(missing, { expectOutput: true }), surface: 'BROKEN', reason: 'registered command failed (script absent)' };
  assert.equal(missingProbe.executed, false);
  assert.equal(missingProbe.verdict, 'SILENT_FAILURE', 'an exit!=0 run is recorded as not-delivered (never as executed)');

  // Independent surface: the PreToolUse deny gate still blocks.
  const denyCommand = managedCommand(settings, 'PreToolUse');
  const deny = runRegistered(denyCommand, world, JSON.stringify({ tool_name: 'Bash', tool_input: { command: `${FORCE_PUSH} origin main` } }));
  assert.equal(deny.status, 2, `the deny gate must still block with the method hook missing: ${deny.stderr}`);

  // Independent Runtime: the real SDD.Gate.v1 still blocks the required
  // capability — no method hook can self-pass it.
  const gate = evaluate(GATE_INPUT, [], POLICY_REF);
  assert.equal(gate.verdict, 'blocked');
  assert.match(gate.receipt.blocked.join('\n'), /MISSING_OBSERVATION: required check unit\/unit:node:test/,
    'the required capability has no receipt and stays blocked (level/capability form)');
});

test('E05: silent failure — exit 0 with mode badge and map present is still NOT_EVIDENCED and the gate verdict is byte-identical', (t) => {
  const { world, settings } = composeWorld(t);
  const sessionCommand = managedCommand(settings, 'SessionStart');

  // The silent-failure world: the hook exits 0 but injects nothing; mode
  // badge and codebase map exist (native best-effort artifacts).
  fsSync.writeFileSync(path.join(world, 'hooks', 'session-context.sh'), '#!/usr/bin/env bash\nexit 0\n');
  fsSync.mkdirSync(path.join(world, '.ponytail'), { recursive: true });
  fsSync.writeFileSync(path.join(world, '.ponytail', 'mode-badge.txt'), 'full\n');
  fsSync.writeFileSync(path.join(world, '.ponytail', 'codebase-map.md'), '# map\n');

  const silent = runRegistered(sessionCommand, world);
  const silentProbe = {
    ...probeReceipt(silent, { expectOutput: true }),
    modeBadgePresent: fsSync.existsSync(path.join(world, '.ponytail', 'mode-badge.txt')),
    mapPresent: fsSync.existsSync(path.join(world, '.ponytail', 'codebase-map.md')),
  };
  assert.equal(silent.status, 0, 'the silent hook exits 0');
  assert.equal(silentProbe.declaredEffectObserved, false, 'no context was injected');
  assert.equal(silentProbe.verdict, 'SILENT_FAILURE', 'exit 0 + badge + map is NOT execution (nonEvidence register)');
  assert.deepEqual(POLICY.nonEvidence, ['hook exit 0', 'mode badge', 'codebase map']);

  // The gate cannot tell any difference: identical inputs → byte-identical
  // receipt, still blocked. Method artifacts never move the Runtime.
  const gateBefore = evaluate(GATE_INPUT, [], POLICY_REF);
  fsSync.writeFileSync(path.join(world, '.ponytail', 'mode-badge.txt'), 'bypassPermissions\n');
  const gateAfter = evaluate(GATE_INPUT, [], POLICY_REF);
  assert.equal(JSON.stringify(gateBefore), JSON.stringify(gateAfter), 'the gate receipt is a pure function of inputs — badges change nothing');
  assert.equal(gateAfter.verdict, 'blocked');

  // Contrast in the same world: the REAL script delivers the declared context.
  fsSync.copyFileSync(path.join(projectRoot, 'hooks', 'session-context.sh'), path.join(world, 'hooks', 'session-context.sh'));
  const real = runRegistered(sessionCommand, world);
  const realProbe = probeReceipt(real, { expectOutput: true });
  assert.equal(realProbe.executed, true, 'real run: exit 0 + observed context injection = DELIVERED');
  assert.equal(real.status, 0);
});

test('E05 mode crosstalk: a shared mode file resolves last-write-wins and never changes the deny gate or the Runtime verdict', (t) => {
  const { world, settings } = composeWorld(t);
  const modeFile = path.join(world, '.ponytail-mode');
  const denyCommand = managedCommand(settings, 'PreToolUse');
  const denyInput = JSON.stringify({ tool_name: 'Bash', tool_input: { command: `${FORCE_PUSH} origin main` } });

  assert.equal(runRegistered(denyCommand, world, denyInput).status, 2, 'deny blocks before mode writes');
  assert.equal(evaluate(GATE_INPUT, [], POLICY_REF).verdict, 'blocked');

  // Session A and session B share the file; the last write wins (observed).
  fsSync.writeFileSync(modeFile, 'plan\n');
  fsSync.writeFileSync(modeFile, 'bypassPermissions\n');
  assert.equal(fsSync.readFileSync(modeFile, 'utf8'), 'bypassPermissions\n', 'last write wins — the file holds session B mode');

  // Neither mode value is consulted: the deny gate and the gate verdict hold.
  assert.equal(runRegistered(denyCommand, world, denyInput).status, 2, 'deny still blocks under bypassPermissions');
  fsSync.writeFileSync(modeFile, 'plan\n');
  assert.equal(runRegistered(denyCommand, world, denyInput).status, 2, 'deny still blocks under plan');
  assert.equal(evaluate(GATE_INPUT, [], POLICY_REF).verdict, 'blocked', 'the Runtime verdict is mode-independent');
  assert.equal(MATRIX.crosstalk.modeIsPermissionBasis, false, 'structurally: mode is not a permission basis');
});

// --- E06/H02 hook side: repeats stay advisory, mutate nothing, no second controller

test('E06/H02: repeated startup/resume/stop hook triggers restore context only — the world is byte-identical and stays outside the fixed event set', (t) => {
  const { world, settings } = composeWorld(t);
  const sessionCommand = managedCommand(settings, 'SessionStart');
  const stopCommand = managedCommand(settings, 'Stop');

  const before = snapshot(world);
  // Repeated triggers: startup, resume, another resume, session end.
  const triggers = [
    { event: 'SessionStart/startup', run: runRegistered(sessionCommand, world) },
    { event: 'SessionStart/resume', run: runRegistered(sessionCommand, world) },
    { event: 'SessionStart/resume-repeat', run: runRegistered(sessionCommand, world) },
    { event: 'Stop', run: runRegistered(stopCommand, world) },
  ];
  for (const { event, run } of triggers) {
    assert.equal(run.status, 0, `${event} trigger must stay advisory (exit 0): ${run.stderr}`);
    assert.ok(run.stdout.trim().length > 0, `${event} restored method context (observed output)`);
    assert.doesNotMatch(run.stdout, /dispatch|phase|approve|consensus/i, `${event} output never claims execution, phase or approval`);
  }
  const receipt = triggers.map(({ event, run }) => ({ event, ...probeReceipt(run, { expectOutput: true }) }));
  assert.ok(receipt.every((r) => r.executed === true && r.verdict === 'DELIVERED'));

  // Zero state mutation: no dispatch, no phase write, no second controller.
  assert.deepEqual(snapshot(world), before, 'repeated hook triggers must leave the world byte-identical');

  // Honest capability boundary: resume/compact/sub-session surfaces beyond the
  // fixed set are NOT registered — the matrix says so explicitly.
  for (const group of ['SubagentStart', 'UserPromptSubmit', 'PreCompact', 'PostToolUse']) {
    assert.equal(settings.hooks[group], undefined, `no ${group} registration exists — the current adapter cannot assemble it`);
  }
  const gapEvents = MATRIX.eventSurfaces.filter((s) => s.adapterCapability === 'CAPABILITY_GAP').map((s) => s.event);
  for (const surface of ['SessionStart/clear', 'SessionStart/compact', 'SubagentStart', 'UserPromptSubmit']) {
    assert.ok(gapEvents.includes(surface), `${surface} must be recorded as a capability gap, never as assembled`);
  }
});

// --- native assembly verification on THIS repo; native support vs live run

test('native assembly: the doctor verifies the real three-subject composition of this repo; live run stays UNVERIFIED; plugin cache untouched', (t) => {
  const liveSettings = path.join(projectRoot, '.claude', 'settings.json');
  const beforeSettings = fsSync.existsSync(liveSettings) ? fsSync.readFileSync(liveSettings, 'utf8') : null;

  const run = spawnSync(process.execPath, [DOCTOR, '--root', projectRoot, '--json'], { encoding: 'utf8' });
  const report = JSON.parse(run.stdout);
  assert.equal(run.status, 0, `doctor on the real repo must pass: ${run.stderr}`);
  assert.equal(report.verdict, 'CONSISTENT');
  assert.deepEqual(report.findings, []);

  // Three subjects modeled; the composed view carries exactly the managed
  // registrations (this repo has no plugin/user hook entries).
  assert.deepEqual(Object.keys(report.generated.groups).sort(), ['PreToolUse', 'SessionStart', 'Stop']);
  for (const [group, info] of Object.entries(report.generated.groups)) {
    assert.equal(info.managed.length, 1, `${group}: exactly one managed entry`);
    assert.equal(info.plugin.length, 0, `${group}: no plugin-subject entries in this repo`);
    assert.equal(info.user.length, 0, `${group}: no user entries in this repo`);
  }
  for (const subject of ['plugin', 'managed', 'user']) {
    assert.ok(MATRIX.subjects[subject], `matrix models subject ${subject}`);
  }

  // Native support (structural) vs live run (behavioral) reported separately.
  assert.equal(report.nativeSupport.status, 'PROVEN');
  assert.equal(report.liveRun.status, 'UNVERIFIED');
  assert.match(report.liveRun.note, /宿主|host|UNVERIFIED/i);

  // Plugin cache untouched by construction: composition happened in $TMPDIR.
  assert.ok(report.target.startsWith(os.tmpdir()), `composition target must be a temp dir, got ${report.target}`);
  assert.equal(report.pluginCache.modified, false);
  const afterSettings = fsSync.existsSync(liveSettings) ? fsSync.readFileSync(liveSettings, 'utf8') : null;
  assert.equal(afterSettings, beforeSettings, 'live .claude/settings.json byte-identical after the run');

  // E06/H02 honest receipt for the whole case: what is proven vs inherited.
  const caseReceipt = {
    structuralSurface: 'PROVEN (settings.json + hooks/.compiled.env composed by the real adapter; scripts exit codes + outputs observed)',
    liveHostRun: 'UNVERIFIED (no real Claude Code host session/plugin runtime driven here — context delivery into a host and behavioral compliance await host verification)',
    silentFailure: 'exit 0 without the declared effect recorded NOT_EVIDENCED (P4_6 knownFacts)',
    modeCrosstalk: 'shared mode file last-write-wins observed; never an identity/permission basis (I02)',
  };
  assert.equal(caseReceipt.liveHostRun.startsWith('UNVERIFIED'), true);
});
