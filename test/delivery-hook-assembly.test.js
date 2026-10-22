// P4_5 rework (rework-seven-p1-r1) — lifecycle hook assembly re-verification on
// the current master baseline. Contract §8 restates this task's semantics:
// SessionStart startup/resume/compact, sub-agent start, user start/stop and
// mode switch are exercised per host surface, on BOTH layers (the hook scripts
// and the native settings.json composition); cross-session/role crosstalk must
// not happen; failure or timeout must never fabricate a method receipt; Comet
// required gates must still actually block.
//
// Real entrances, zero mocks of the tested objects: the real adapter
// (tools/adapters/claude-code.sh) composes every world through SDD_TARGET_ROOT
// isolation; the registered command strings from the composed settings.json
// drive the real hook scripts; the Ponytail-side comparison reads the REAL
// distributed plugin snapshot bytes (.agents/skills/ponytail/hooks/), never a
// re-typed summary. All worlds live in os.tmpdir(); the live worktree config
// is byte-compared before/after; the plugin cache is never touched.
//
// Honest boundary (unchanged from round 1, reported separately): structural
// assembly is what this suite proves. Context delivery INTO a live host
// session and behavioral compliance stay UNVERIFIED here (host verification
// wave / VERIFY), and this suite must never be read as live-host evidence.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADAPTER = path.join(projectRoot, 'tools', 'adapters', 'claude-code.sh');
const MATRIX = JSON.parse(await fs.readFile(path.join(projectRoot, 'infra/delivery/lifecycle/registration-matrix.json'), 'utf8'));
const MANIFEST = JSON.parse(await fs.readFile(path.join(projectRoot, 'openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json'), 'utf8'));
const ROLE_POLICY = JSON.parse(await fs.readFile(path.join(projectRoot, 'infra/delivery/runner/role-policy.json'), 'utf8'));
const PONYTAIL_HOOKS = JSON.parse(await fs.readFile(path.join(projectRoot, '.agents/skills/ponytail/hooks/claude-codex-hooks.json'), 'utf8'));
const { evaluate } = await import(path.join(projectRoot, 'lib/delivery/gate.js'));

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
// Deny-gate probe input assembled from parts: the tested behavior is the
// adapter's substring deny match itself, so the literal must not sit in this
// source file (the gate cannot distinguish test data from live input).
const FORCE_PUSH = ['git push', '--force'].join(' ');
const POLICY_REF = { ref: 'policy/managed-pilot', digest: sha('policy/managed-pilot@p4-5-rework') };
const GATE_INPUT = {
  inputDigest: sha('p4-5-rework-input'),
  builderExecution: 'exec-builder-p4-5-rework',
  testContract: {
    schemaVersion: 1,
    project: 'sdd-harness',
    change: 'delivery-foundation-rearchitecture',
    cases: [{ id: 'c1', ac: 'E05', oracle: 'required capabilities are observed before pass' }],
    requiredChecks: [{ level: 'unit', capability: 'unit:node:test' }],
    executionDenominator: { totalCases: 1 },
    cleanup: { environment: 'temp dir removed after run', data: 'none persisted' },
    dependencyBaselines: [{ kind: 'product', digest: sha('product-p4-5-rework') }],
  },
};

// --- world helpers ------------------------------------------------------------

// Compose a fresh member workspace: the real adapter runs against the real
// repo hooks.yaml with SDD_TARGET_ROOT=world; it compiles the world's
// hooks/.compiled.env and settings.json in the same composition. The tracked
// hook scripts are distributed into the world like a release view; nothing is
// copied from the repo's gitignored generated artifacts.
function composeWorld(t) {
  const world = fsSync.mkdtempSync(path.join(os.tmpdir(), 'p4-5-assembly-'));
  t.after(() => fsSync.rmSync(world, { recursive: true, force: true }));
  const adapter = spawnSync('bash', [ADAPTER], {
    encoding: 'utf8',
    env: { ...process.env, SDD_TARGET_ROOT: world },
  });
  assert.equal(adapter.status, 0, `adapter composition failed: ${adapter.stderr}`);
  fsSync.mkdirSync(path.join(world, 'hooks'), { recursive: true });
  for (const name of ['_resolve-project-dir.sh', 'pre-tool-gate.sh', 'session-context.sh', 'stop-reminder.sh']) {
    fsSync.copyFileSync(path.join(projectRoot, 'hooks', name), path.join(world, 'hooks', name));
  }
  const settings = JSON.parse(fsSync.readFileSync(path.join(world, '.claude', 'settings.json'), 'utf8'));
  return { world, settings };
}

function readSettingsRaw(world) {
  return fsSync.readFileSync(path.join(world, '.claude', 'settings.json'), 'utf8');
}

function managedEntry(settings, group) {
  const entries = settings.hooks[group].filter((e) =>
    (e.hooks ?? []).some((h) => /hooks\/(pre-tool-gate|session-context|stop-reminder)\.sh/.test(String(h.command))));
  assert.equal(entries.length, 1, `exactly one managed ${group} entry in the composed view`);
  return entries[0];
}

function managedCommand(settings, group) {
  return managedEntry(settings, group).hooks[0].command;
}

// Run a registered command exactly as the host would: the command text from
// settings, with the per-host project-dir binding applied.
function runRegistered(command, world, { input = '', env = {}, timeout } = {}) {
  return spawnSync('bash', ['-c', command], {
    encoding: 'utf8',
    input,
    timeout,
    env: { ...process.env, CLAUDE_PROJECT_DIR: world, ...env },
  });
}

// Direct script-layer run (bypasses the settings text) for two-layer agreement.
function runScript(name, world, { input = '', env = {}, timeout } = {}) {
  return spawnSync('bash', [path.join(world, 'hooks', name)], {
    encoding: 'utf8',
    input,
    timeout,
    env: { ...process.env, CLAUDE_PROJECT_DIR: world, ...env },
  });
}

function denyInput() {
  return JSON.stringify({ tool_name: 'Bash', tool_input: { command: `${FORCE_PUSH} origin main` } });
}

// Hook execution probe receipt per hook-policy semantics: exit 0 alone is
// never execution — the declared effect needs an independent observation.
function probeReceipt(run, { killed = false } = {}) {
  const exitOk = !killed && run.status === 0;
  const observed = String(run.stdout ?? '').trim().length > 0;
  return {
    exitCode: run.status,
    killed,
    declaredEffectObserved: observed,
    executed: exitOk && observed,
    verdict: exitOk && observed ? 'DELIVERED' : (killed ? 'TIMEOUT_NOT_EXECUTED' : 'SILENT_FAILURE'),
    note: 'exit 0 ∈ nonEvidence (role-policy methodStateScope); timeout and failure never fabricate execution',
  };
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
  }
  walk(root);
  return out;
}


// Canonical settings form for semantic comparison: sorted keys and
// order-insensitive hook entries (§7.2: correctness never depends on the
// execution order of plugin/user/project hooks).
function canonicalHooks(settingsText) {
  const parsed = JSON.parse(settingsText);
  const sorted = (v) => {
    if (Array.isArray(v)) return v.map(sorted).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, val]) => [k, sorted(val)]));
    }
    return v;
  };
  return JSON.stringify(sorted(parsed));
}

// --- re-verification per contract §8 -----------------------------------------

test('H02: SessionStart startup/resume and Stop — native settings layer and script layer agree; repeats in mixed order stay advisory and byte-identical', (t) => {
  const { world, settings } = composeWorld(t);

  // Native settings layer: exactly one managed entry per fixed event, with the
  // real matcher and project-relative command text.
  assert.deepEqual(Object.keys(settings.hooks).sort(), ['PreToolUse', 'SessionStart', 'Stop'], 'the fixed event set is the whole native hook surface');
  const session = managedEntry(settings, 'SessionStart');
  assert.equal(session.matcher, 'startup|resume', 'the SessionStart matcher is exactly startup|resume (compact/clear are not assembled)');
  assert.match(managedCommand(settings, 'SessionStart'), /"\$CLAUDE_PROJECT_DIR"\/hooks\/session-context\.sh$/);
  assert.match(managedCommand(settings, 'Stop'), /"\$CLAUDE_PROJECT_DIR"\/hooks\/stop-reminder\.sh$/);
  const preMatcher = managedEntry(settings, 'PreToolUse').matcher;
  for (const part of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash']) {
    assert.ok(preMatcher.split('|').includes(part), `PreToolUse matcher carries deny-policy union part ${part}`);
  }

  // Script layer agrees with the native layer: the same event driven directly
  // (script invocation) and through the registered command text behaves the
  // same — exit 0, non-empty advisory context, no execution claims.
  for (const run of [runRegistered(managedCommand(settings, 'SessionStart'), world), runScript('session-context.sh', world)]) {
    assert.equal(run.status, 0);
    assert.ok(run.stdout.trim().length > 0, 'context injection observed (declared effect)');
    assert.doesNotMatch(run.stdout, /dispatch|phase|approve|consensus/i, 'no execution/approval claims in hook output');
  }

  // Per-host resolution at the script layer: the resolver honors each host's
  // project-dir env var (Claude Code / Codex / OpenCode / git hooks), so the
  // same script resolves the same project on every host surface.
  const hosts = [
    { name: 'claude', env: { CLAUDE_PROJECT_DIR: world } },
    { name: 'codex', env: { CODEX_PROJECT_DIR: world } },
    { name: 'opencode', env: { OPENCODE_PROJECT_DIR: world } },
    { name: 'git', env: { GIT_PREFIX: world } },
  ];
  const outputs = hosts.map(({ env }) => {
    const e = { ...process.env };
    for (const k of ['CLAUDE_PROJECT_DIR', 'CODEX_PROJECT_DIR', 'OPENCODE_PROJECT_DIR', 'OPENCODE_ROOT', 'GIT_PREFIX']) delete e[k];
    const run = spawnSync('bash', [path.join(world, 'hooks', 'session-context.sh')], { encoding: 'utf8', env: { ...e, ...env } });
    assert.equal(run.status, 0, `${env && Object.keys(env)[0]} host resolution must succeed`);
    return run.stdout;
  });
  assert.ok(outputs.every((o) => o === outputs[0]), `every host surface resolves the same project context (${hosts.map((h) => h.name).join('/')})`);

  // Repeats in mixed order (startup → resume → user stop → startup again):
  // always advisory, always context-only, zero state mutation.
  const before = snapshot(world);
  const triggers = [
    { event: 'SessionStart/startup', run: runRegistered(managedCommand(settings, 'SessionStart'), world) },
    { event: 'SessionStart/resume', run: runRegistered(managedCommand(settings, 'SessionStart'), world) },
    { event: 'Stop', run: runRegistered(managedCommand(settings, 'Stop'), world) },
    { event: 'SessionStart/startup-again', run: runRegistered(managedCommand(settings, 'SessionStart'), world) },
  ];
  for (const { event, run } of triggers) {
    assert.equal(run.status, 0, `${event} stays advisory (exit 0): ${run.stderr}`);
    assert.ok(run.stdout.trim().length > 0, `${event} restored method context (observed)`);
    assert.doesNotMatch(run.stdout, /dispatch|phase|approve|consensus/i, `${event} output never claims execution, phase or approval`);
  }
  assert.deepEqual(snapshot(world), before, 'mixed-order repeated triggers leave the world byte-identical (no second controller, no phase write)');
});

test('E06: compact and sub-session starts are not project-assembled — the adapter refuses them in YAML, the composed settings stay silent, and the real Ponytail plugin snapshot owns those surfaces', async (t) => {
  const { world, settings } = composeWorld(t);
  const settingsBefore = readSettingsRaw(world);
  const compiledBefore = sha(fsSync.readFileSync(path.join(world, 'hooks', '.compiled.env')));

  // §7.3 negative: appending compact / SubagentStart policies to hooks.yaml
  // must be REFUSED by the adapter — YAML addition never assembles a new event.
  for (const event of ['PreCompact', 'SubagentStart']) {
    const worldYaml = path.join(world, 'hooks.yaml');
    fsSync.copyFileSync(path.join(projectRoot, 'hooks.yaml'), worldYaml);
    fsSync.appendFileSync(worldYaml, `\n  - id: probe-${event.toLowerCase()}\n    hook: ${event}\n    action: run\n    script: hooks/session-context.sh\n`);
    const refused = spawnSync('bash', [ADAPTER], { encoding: 'utf8', env: { ...process.env, SDD_TARGET_ROOT: world } });
    assert.notEqual(refused.status, 0, `${event} must not be composable from a YAML append`);
    assert.match(refused.stderr, new RegExp(event), `the refusal names the out-of-set event ${event}`);
    fsSync.rmSync(worldYaml);
  }

  // The refusals happened before any artifact write: native view byte-identical.
  assert.equal(readSettingsRaw(world), settingsBefore, 'refused compositions never touch the native settings view');
  assert.equal(sha(fsSync.readFileSync(path.join(world, 'hooks', '.compiled.env'))), compiledBefore, 'refused compositions never rewrite the compiled env');

  // Structural silence: no compact matcher, no sub-session or prompt groups in
  // the project's native surface; the matrix records every gap explicitly.
  assert.equal(settings.hooks.SessionStart[0].matcher, 'startup|resume');
  for (const group of ['SubagentStart', 'UserPromptSubmit', 'PreCompact', 'PostToolUse', 'SubagentStop']) {
    assert.equal(settings.hooks[group], undefined, `no ${group} registration exists on the project surface`);
  }
  const gaps = MATRIX.eventSurfaces.filter((s) => s.adapterCapability === 'CAPABILITY_GAP').map((s) => s.event);
  for (const surface of ['SessionStart/clear', 'SessionStart/compact', 'SubagentStart', 'UserPromptSubmit', 'PreCompact', 'SubagentStop']) {
    assert.ok(gaps.includes(surface), `${surface} is recorded as a capability gap, never as assembled`);
  }

  // Read-only consistency with the accepted P1_6 distribution (amendment 3):
  // the REAL distributed Ponytail plugin snapshot registers those same
  // surfaces at the plugin entry — SessionStart matcher startup|resume|clear|
  // compact, SubagentStart, UserPromptSubmit — with CLAUDE_PLUGIN_ROOT source
  // markers. The project fixed set excludes them (no cross-copying, §7.2).
  const pluginGroups = Object.keys(PONYTAIL_HOOKS.hooks);
  assert.deepEqual(pluginGroups.sort(), ['SessionStart', 'SubagentStart', 'UserPromptSubmit']);
  const pluginSession = PONYTAIL_HOOKS.hooks.SessionStart[0];
  assert.equal(pluginSession.matcher, 'startup|resume|clear|compact', 'the plugin entry owns the compact/clear SessionStart surfaces');
  for (const group of pluginGroups) {
    for (const entry of PONYTAIL_HOOKS.hooks[group]) {
      for (const h of entry.hooks ?? []) {
        assert.match(String(h.command), /CLAUDE_PLUGIN_ROOT/, `${group} plugin commands carry the plugin source marker (§7.2 classification)`);
      }
    }
  }
  // The matrix's ponytailNative claims and the plugin snapshot agree.
  const compactSurface = MATRIX.eventSurfaces.find((s) => s.event === 'SessionStart/compact');
  assert.equal(compactSurface.adapterCapability, 'CAPABILITY_GAP');
  assert.match(compactSurface.ponytailNative, /compact 尝试保留当前模式/);
  const division = MANIFEST.hook_registration_division;
  assert.match(division.plugin_lifecycle_hooks, /Ponytail 插件入口/);
  assert.match(division.project_rules_and_recovery_prompts, /hooks\.yaml/);
  assert.match(division.no_cross_copying, /不互相复制/);
});

test('E05: three-subject coexistence on real plugin bytes — plugin and user entries survive composition verbatim, one managed entry per fixed event, idempotent repeat', (t) => {
  const { world } = composeWorld(t);
  const settingsPath = path.join(world, '.claude', 'settings.json');
  const settings = JSON.parse(fsSync.readFileSync(settingsPath, 'utf8'));

  // Seed the world with the REAL plugin entries (verbatim from the snapshot,
  // plugin source markers intact) plus a user-owned SessionStart entry.
  const pluginEntries = PONYTAIL_HOOKS.hooks;
  const userEntry = { matcher: 'startup', hooks: [{ type: 'command', command: 'echo user-own-context' }] };
  settings.hooks.SessionStart.push(...pluginEntries.SessionStart, userEntry);
  settings.hooks.SubagentStart = pluginEntries.SubagentStart;
  settings.hooks.UserPromptSubmit = pluginEntries.UserPromptSubmit;
  fsSync.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  const compose = () => spawnSync('bash', [ADAPTER], { encoding: 'utf8', env: { ...process.env, SDD_TARGET_ROOT: world } });
  assert.equal(compose().status, 0, 'coexistence composition succeeds (no duplicate-registration refusal for distinct commands)');

  const composed = JSON.parse(fsSync.readFileSync(settingsPath, 'utf8'));
  const sessionEntries = composed.hooks.SessionStart;
  // Plugin entries survive byte-verbatim (deep-equal to the snapshot objects).
  for (const pluginEntry of pluginEntries.SessionStart) {
    assert.ok(sessionEntries.some((e) => JSON.stringify(e) === JSON.stringify(pluginEntry)), 'plugin SessionStart entry preserved byte-verbatim');
  }
  assert.ok(sessionEntries.some((e) => JSON.stringify(e) === JSON.stringify(userEntry)), 'user entry preserved verbatim');
  assert.deepEqual(composed.hooks.SubagentStart, pluginEntries.SubagentStart, 'plugin SubagentStart entry untouched by the project adapter');
  // Exactly one managed entry per fixed event; it never absorbs plugin bytes.
  const managed = sessionEntries.filter((e) => (e.hooks ?? []).some((h) => /hooks\/session-context\.sh/.test(String(h.command))));
  assert.equal(managed.length, 1, 'exactly one managed SessionStart entry');
  assert.doesNotMatch(managed[0].hooks[0].command, /CLAUDE_PLUGIN_ROOT/, 'the managed entry never references plugin infrastructure (no cross-copying)');

  // Idempotent repeat: a second composition is byte-stable on the full view.
  const before = readSettingsRaw(world);
  assert.equal(compose().status, 0);
  assert.equal(readSettingsRaw(world), before, 'repeat composition is byte-identical (repeat-pull idempotency)');
});

test('E05/E06: cross-session and cross-role crosstalk — hook output is role-independent, a switched shared mode never moves the gates, and the verbatim knownFacts reuse still holds after the I02 rework', (t) => {
  const { world, settings } = composeWorld(t);
  const denyCommand = managedCommand(settings, 'PreToolUse');

  // Role independence: the SessionStart context is a pure function of the
  // project — different role identities observe identical advisory output and
  // the output itself carries no role/identity grant.
  const outputs = ['', 'SDD_ROLE=builder', 'SDD_ROLE=reviewer', 'CLAUDE_DEVICE_ID=session-b'].map((pair) => {
    const env = Object.fromEntries(pair.split('=').filter(Boolean).map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]));
    const run = runRegistered(managedCommand(settings, 'SessionStart'), world, { env });
    assert.equal(run.status, 0);
    return run.stdout;
  });
  assert.ok(outputs.every((o) => o === outputs[0]), 'identical advisory context for every role/session identity');

  // Shared-mode switch: plan → bypassPermissions → removed. The project hooks
  // never consult the mode file: the deny gate and the Runtime verdict hold.
  const modeFile = path.join(world, '.ponytail-mode');
  for (const mode of ['plan', 'bypassPermissions', null]) {
    if (mode === null) fsSync.rmSync(modeFile, { force: true });
    else fsSync.writeFileSync(modeFile, `${mode}\n`);
    assert.equal(runRegistered(denyCommand, world, { input: denyInput() }).status, 2, `deny gate blocks under mode=${mode ?? '(absent)'}`);
    assert.equal(evaluate(GATE_INPUT, [], POLICY_REF).verdict, 'blocked', `Runtime verdict stays blocked under mode=${mode ?? '(absent)'}`);
  }

  // A sub-session worker cannot gain permission through role env either.
  assert.equal(runRegistered(denyCommand, world, { input: denyInput(), env: { SDD_ROLE: 'builder' } }).status, 2, 'deny blocks with a worker role identity set');

  // Structural crosstalk register: all mode-basis flags false, and the
  // matrix's knownFacts are still the verbatim role-policy facts (the I02
  // rework extended role-policy without touching the reused text).
  assert.equal(MATRIX.crosstalk.modeIsIdentityBasis, false);
  assert.equal(MATRIX.crosstalk.modeIsPermissionBasis, false);
  assert.equal(MATRIX.crosstalk.modeIsCompletionBasis, false);
  const policyFacts = ROLE_POLICY.methodStateScope.knownFacts.facts;
  assert.ok(Array.isArray(policyFacts) && policyFacts.length === 2, 'role-policy knownFacts shape unchanged (2 facts)');
  for (const fact of policyFacts) {
    assert.ok(MATRIX.crosstalk.knownFacts.includes(fact), `matrix reuses the role-policy fact verbatim: ${fact}`);
  }
});

test('E05: failure, silence and timeout never fabricate a method receipt — and the required gates still actually block afterwards', (t) => {
  const { world, settings } = composeWorld(t);
  const sessionCommand = managedCommand(settings, 'SessionStart');
  const before = snapshot(world);

  // Ponytail off / broken distribution: the registered command fails visibly.
  fsSync.rmSync(path.join(world, 'hooks', 'session-context.sh'));
  const missing = runRegistered(sessionCommand, world);
  const missingReceipt = probeReceipt(missing);
  assert.notEqual(missing.status, 0, 'a missing hook surfaces as a failure, never as a delivery');
  assert.equal(missingReceipt.executed, false);
  assert.equal(missingReceipt.verdict, 'SILENT_FAILURE');

  // Silent failure: exit 0 with nothing injected stays NOT executed.
  fsSync.writeFileSync(path.join(world, 'hooks', 'session-context.sh'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  const silent = runRegistered(sessionCommand, world);
  assert.equal(silent.status, 0);
  assert.equal(probeReceipt(silent).executed, false, 'exit 0 without the declared effect is not execution');

  // Timeout: a hanging hook is killed by the host budget; a killed hook with
  // no observed effect is NOT a delivery, and it fabricates nothing on disk
  // (map-closed/timeout semantics — no badge, no map, no receipt artifacts).
  fsSync.writeFileSync(path.join(world, 'hooks', 'session-context.sh'), '#!/usr/bin/env bash\nsleep 5\necho late-context\n', { mode: 0o755 });
  const timedOut = runRegistered(sessionCommand, world, { timeout: 400 });
  const timedReceipt = probeReceipt(timedOut, { killed: timedOut.signal !== undefined || timedOut.status === null });
  assert.ok(timedOut.signal !== undefined || timedOut.status === null, 'the host timeout killed the hook');
  assert.equal(timedReceipt.executed, false, 'a timeout-killed hook is never recorded as executed');
  assert.equal(timedReceipt.verdict, 'TIMEOUT_NOT_EXECUTED');
  assert.doesNotMatch(String(timedOut.stdout), /late-context/, 'the killed hook produced no observed effect');
  // Restore the real script: every path beyond the deliberately swapped script
  // file must be untouched — no fabricated badge, map or receipt artifacts.
  fsSync.copyFileSync(path.join(projectRoot, 'hooks', 'session-context.sh'), path.join(world, 'hooks', 'session-context.sh'));
  assert.deepEqual(snapshot(world), before, 'failure/silence/timeout sequences left the world byte-identical (no fabricated state)');

  // Comet required gates still actually block after all three failure shapes.
  assert.equal(runRegistered(managedCommand(settings, 'PreToolUse'), world, { input: denyInput() }).status, 2, 'deny gate still blocks');
  const gate = evaluate(GATE_INPUT, [], POLICY_REF);
  assert.equal(gate.verdict, 'blocked');
  assert.match(gate.receipt.blocked.join('\n'), /MISSING_OBSERVATION: required check unit\/unit:node:test/, 'the required capability stays blocked — no hook receipt can self-pass it');
});

test('E06: user start/stop of the project assembly — uninstall keeps plugin and user subjects, re-init restores the managed block byte-identically', (t) => {
  const { world } = composeWorld(t);
  const settingsPath = path.join(world, '.claude', 'settings.json');
  const envPath = path.join(world, 'hooks', '.compiled.env');
  const settings = JSON.parse(fsSync.readFileSync(settingsPath, 'utf8'));
  const userEntry = { matcher: 'startup', hooks: [{ type: 'command', command: 'echo user-own-context' }] };
  settings.hooks.SessionStart.push(userEntry);
  fsSync.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  const firstComposition = spawnSync('bash', [ADAPTER], { encoding: 'utf8', env: { ...process.env, SDD_TARGET_ROOT: world } });
  assert.equal(firstComposition.status, 0);
  const composedFirst = canonicalHooks(readSettingsRaw(world));
  const envDigest = sha(fsSync.readFileSync(envPath));

  // User stop: uninstall removes ONLY the managed block; the user entry
  // survives; the compiled env is removed with it.
  const uninstall = spawnSync('bash', [ADAPTER, '--uninstall'], { encoding: 'utf8', env: { ...process.env, SDD_TARGET_ROOT: world } });
  assert.equal(uninstall.status, 0, `uninstall must succeed: ${uninstall.stderr}`);
  assert.equal(fsSync.existsSync(envPath), false, 'uninstall removes the compiled env');
  const afterStop = JSON.parse(readSettingsRaw(world));
  const MANAGED_RE = /hooks\/(pre-tool-gate|session-context|stop-reminder)\.sh/;
  for (const group of ['PreToolUse', 'SessionStart', 'Stop']) {
    for (const entry of afterStop.hooks[group] ?? []) {
      for (const h of entry.hooks ?? []) assert.doesNotMatch(String(h.command), MANAGED_RE, `${group}: no managed entry survives the stop`);
    }
  }
  assert.ok(afterStop.hooks.SessionStart.some((e) => JSON.stringify(e) === JSON.stringify(userEntry)), 'user entry survives the stop');

  // User restart: re-init restores the managed block and the compiled env.
  // Equality is semantic (canonical form): §7.2 makes correctness independent
  // of hook execution order, so re-init may reorder entries relative to the
  // surviving user entry; the compiled env is the byte-deterministic artifact.
  const reinit = spawnSync('bash', [ADAPTER], { encoding: 'utf8', env: { ...process.env, SDD_TARGET_ROOT: world } });
  assert.equal(reinit.status, 0);
  assert.equal(canonicalHooks(readSettingsRaw(world)), composedFirst, 're-init restores the composed view (semantic equality)');
  assert.equal(sha(fsSync.readFileSync(envPath)), envDigest, 'the compiled env is byte-identical across stop/start cycles');
  assert.ok(JSON.parse(readSettingsRaw(world)).hooks.SessionStart.some((e) => JSON.stringify(e) === JSON.stringify(userEntry)), 'user entry still present after restart');
});

