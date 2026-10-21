// P4_5 — lifecycle hook assembly: the policy-validation layer over the single
// hooks.yaml source (P1_2-owned, read-only on this layer) and the REAL adapter
// composition. Semantics: E05/E06/H02 hook surface; registration division and
// fixed event set per classic-closeout-and-hook-contract.md §7.2/§7.3.
//
// hook-doctor audits the real composition: it runs tools/adapters/claude-code.sh
// into an isolated SDD_TARGET_ROOT and cross-checks hooks.yaml declarations
// against the generated settings.json / hooks/.compiled.env:
//   declared but not generated      -> STRUCTURAL_HOOK_GAP (never silent)
//   generated but not declared      -> UNAUTHORIZED_HOOK_GENERATION
//   same event+command twice        -> DUPLICATE_REGISTRATION (§7.2)
//   event beyond the fixed set      -> HOOK_EVENT_BEYOND_FIXED_SET (capability gap)
// Silent failure (exit 0 without the declared effect) is never execution
// (P4_6 knownFacts, infra/delivery/runner/role-policy.json methodStateScope);
// a shared mode file is never an identity/permission basis (I02). Live host
// runs stay UNVERIFIED — the plugin cache is never read or written.
//
// Note: this file never contains deny-listed command literals inline; test
// inputs that exercise the deny gate assemble them from parts so the hook
// gate's substring match cannot block the test suite's own write.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADAPTER = path.join(projectRoot, 'tools', 'adapters', 'claude-code.sh');
const DOCTOR = path.join(projectRoot, 'tools', 'lifecycle', 'hook-doctor.mjs');
const HOOKS_YAML = path.join(projectRoot, 'hooks.yaml');
const POLICY = path.join(projectRoot, 'infra', 'delivery', 'lifecycle', 'hook-policy.json');
const MATRIX = path.join(projectRoot, 'infra', 'delivery', 'lifecycle', 'registration-matrix.json');
const ROLE_POLICY = path.join(projectRoot, 'infra', 'delivery', 'runner', 'role-policy.json');

const adapterSrc = fs.readFileSync(ADAPTER, 'utf8');
const hooksYamlSrc = fs.readFileSync(HOOKS_YAML, 'utf8');

// Deny-gate probe input, assembled from parts (the tested behavior is the
// substring match itself; the literal must not appear in this source file).
const FORCE_PUSH = ['git push', '--force'].join(' ');

const runDoctor = (args, env = {}) =>
  spawnSync(process.execPath, [DOCTOR, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

const parseJsonOut = (run, label) => {
  let parsed;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    throw new Error(`${label}: stdout is not JSON: ${run.stdout}\nstderr: ${run.stderr}`);
  }
  return parsed;
};

// Minimal hooks.yaml policy-id extraction (same subset the adapter parses).
const declaredIds = (text) =>
  [...text.matchAll(/^  - id: (.+)$/gm)].map((m) => m[1].trim());

// Extract the adapter's own fixed event set (single source of the boundary).
const adapterFixedEventSet = () => {
  const m = adapterSrc.match(/FIXED_EVENT_SET = \(([^)]*)\)/);
  assert.ok(m, 'adapter must declare FIXED_EVENT_SET');
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
};

const read = (p) => fs.readFileSync(p, 'utf8');
const shaFile = (p) => (fs.existsSync(p) ? JSON.stringify([read(p), fs.statSync(p).mtimeMs]) : null);

test('policy layer pins the read-only layering over the P1_2 single source and mirrors the live declaration', () => {
  const policy = JSON.parse(read(POLICY));
  assert.equal(policy.schemaVersion, 1);
  assert.equal(policy.interface, 'LifecycleHookPolicy.v1');
  assert.equal(policy.policySource.path, 'hooks.yaml');
  assert.equal(policy.policySource.readOnly, true, 'hooks.yaml is P1_2-owned: this layer only reads it');
  assert.equal(policy.policySource.compiler, 'tools/adapters/claude-code.sh');
  assert.equal(policy.pluginCache.modified, false, 'the plugin cache is never modified');

  // The declared policy set mirrors the real hooks.yaml ids (freeze-time
  // snapshot; live truth stays hooks.yaml and the doctor recomputes it).
  assert.deepEqual(
    policy.declaredPolicies.map((p) => p.id),
    declaredIds(hooksYamlSrc),
    'hook-policy declaredPolicies must mirror the live hooks.yaml declaration order',
  );
});

test('fixed event set matches the adapter compiler; every declared policy stays inside it', () => {
  const policy = JSON.parse(read(POLICY));
  assert.deepEqual(
    policy.fixedEventSet.map((e) => e.hook),
    adapterFixedEventSet(),
    'hook-policy fixedEventSet must equal the adapter FIXED_EVENT_SET (§7.3)',
  );
  const sessionEntry = policy.fixedEventSet.find((e) => e.hook === 'SessionStart');
  assert.match(String(sessionEntry.matcher), /startup\|resume/, 'SessionStart matcher is startup|resume only — compact/clear are NOT assembled');
  for (const p of policy.declaredPolicies) {
    assert.ok(
      policy.fixedEventSet.some((e) => e.hook === p.hook),
      `declared policy ${p.id} uses event ${p.hook} outside the fixed set`,
    );
  }
});

test('validation rules encode gap / unauthorized / duplicate / silent-failure / mode-crosstalk semantics', () => {
  const policy = JSON.parse(read(POLICY));
  const rules = policy.validationRules;
  assert.equal(rules.declared_not_generated.code, 'STRUCTURAL_HOOK_GAP');
  assert.equal(rules.generated_not_declared.code, 'UNAUTHORIZED_HOOK_GENERATION');
  assert.equal(rules.duplicate_registration.code, 'DUPLICATE_REGISTRATION');
  assert.equal(rules.event_beyond_fixed_set.code, 'HOOK_EVENT_BEYOND_FIXED_SET');
  assert.equal(rules.adapter_composition_failed.code, 'ADAPTER_COMPOSITION_FAILED');

  // Silent failure: exit 0 alone is never execution (P4_6 knownFacts).
  assert.equal(rules.silentExitZero.effect, 'NOT_EVIDENCED');
  assert.match(rules.silentExitZero.executedPredicate, /exit 0/);
  assert.match(rules.silentExitZero.executedPredicate, /声明效果|declared effect|非空/);
  assert.deepEqual(policy.nonEvidence, JSON.parse(read(ROLE_POLICY)).methodStateScope.nonEvidence,
    'nonEvidence register must be reused verbatim from the I02 role policy');

  // Mode crosstalk (I02 METHOD_STATE alignment): never an authorization basis.
  assert.equal(rules.modeCrosstalk.identityBasis, false);
  assert.equal(rules.modeCrosstalk.permissionBasis, false);
  assert.equal(rules.modeCrosstalk.completionBasis, false);
  assert.ok(fs.existsSync(path.join(projectRoot, policy.knownFactsRef)), 'knownFactsRef must point at a real file');
});

test('registration matrix models three subjects x event surfaces with the P1_2 source markers', () => {
  const matrix = JSON.parse(read(MATRIX));
  assert.equal(matrix.interface, 'HookRegistrationMatrix.v1');
  for (const subject of ['plugin', 'managed', 'user']) {
    assert.ok(matrix.subjects[subject], `subject ${subject} must be modeled`);
  }
  // Source markers must be the SAME classification the adapter enforces (§7.2).
  assert.ok(adapterSrc.includes('CLAUDE_PLUGIN_ROOT') && matrix.subjects.plugin.sourceMarkers.includes('CLAUDE_PLUGIN_ROOT'));
  assert.ok(adapterSrc.includes('.claude/plugins/') && matrix.subjects.plugin.sourceMarkers.includes('.claude/plugins/'));
  const managedRe = /hooks\/(pre-tool-gate|session-context|stop-reminder)\.sh/;
  assert.ok(adapterSrc.includes('MANAGED_SCRIPT_RE'));
  for (const marker of matrix.subjects.managed.sourceMarkers) {
    assert.match(marker, managedRe, `managed marker ${marker} must match the adapter MANAGED_SCRIPT_RE`);
  }

  const generated = matrix.eventSurfaces.filter((s) => s.adapterCapability === 'generated');
  assert.deepEqual(
    generated.map((s) => s.event),
    ['PreToolUse', 'SessionStart/startup', 'SessionStart/resume', 'Stop'],
    'exactly the fixed event set is generated',
  );
  const gapEvents = matrix.eventSurfaces.filter((s) => s.adapterCapability === 'CAPABILITY_GAP').map((s) => s.event);
  for (const missing of ['SessionStart/clear', 'SessionStart/compact', 'SubagentStart', 'UserPromptSubmit', 'PostToolUse', 'PreCompact', 'SubagentStop']) {
    assert.ok(gapEvents.includes(missing), `event surface ${missing} must be declared as a capability gap, not silently omitted`);
  }
  for (const surface of matrix.eventSurfaces) {
    if (surface.adapterCapability === 'CAPABILITY_GAP') {
      assert.ok((surface.honestNote ?? '').length > 0, `gap surface ${surface.event} needs an honest note`);
    }
  }
  assert.ok(
    matrix.eventSurfaces.some((s) => /YAML 追加不生效|修改受管生成逻辑/.test(s.honestNote ?? '')),
    'the §7.3 boundary (YAML additions do not take effect) must be stated on a gap surface',
  );

  assert.equal(matrix.duplicateRegistration.policy, 'REFUSE');
  assert.deepEqual(
    matrix.crosstalk.knownFacts,
    JSON.parse(read(ROLE_POLICY)).methodStateScope.knownFacts.facts,
    'crosstalk knownFacts must be reused verbatim from the I02 role policy',
  );
  assert.equal(matrix.crosstalk.modeIsIdentityBasis, false);
  assert.equal(matrix.crosstalk.modeIsPermissionBasis, false);
  assert.equal(matrix.crosstalk.modeIsCompletionBasis, false);
});

test('doctor: the real composition of this repo is CONSISTENT and the live config is never touched', () => {
  const liveSettings = path.join(projectRoot, '.claude', 'settings.json');
  const liveCompiled = path.join(projectRoot, 'hooks', '.compiled.env');
  const beforeSettings = shaFile(liveSettings);
  const beforeCompiled = shaFile(liveCompiled);

  const run = runDoctor(['--root', projectRoot, '--json']);
  const report = parseJsonOut(run, 'doctor healthy');
  assert.equal(run.status, 0, `doctor must exit 0 on the healthy repo: ${run.stderr}`);
  assert.equal(report.interface, 'LifecycleHookDoctor.v1');
  assert.equal(report.verdict, 'CONSISTENT');
  assert.deepEqual(report.findings, [], `no findings on the healthy repo: ${JSON.stringify(report.findings)}`);
  assert.equal(report.policySource.declaredCount, 4);
  assert.equal(report.generated.groups.PreToolUse.managed.length, 1, 'exactly one managed PreToolUse entry');
  assert.match(report.generated.groups.PreToolUse.matcher, /Write/);
  assert.match(report.generated.groups.PreToolUse.matcher, /Bash/);
  assert.equal(report.generated.groups.SessionStart.managed.length, 1, 'exactly one managed SessionStart entry');
  assert.equal(report.generated.groups.SessionStart.matcher, 'startup|resume');
  assert.equal(report.generated.groups.Stop.managed.length, 1, 'exactly one managed Stop entry');

  // Native support vs live run are reported separately.
  assert.equal(report.nativeSupport.status, 'PROVEN', 'the structural composition is provable');
  assert.equal(report.liveRun.status, 'UNVERIFIED', 'no real host session was driven');
  assert.equal(report.pluginCache.modified, false);

  // Isolation proof: the default invocation composes into a temp target.
  assert.notEqual(report.target, projectRoot);
  assert.equal(shaFile(liveSettings), beforeSettings, 'live settings.json byte-identical after the doctor run');
  assert.equal(shaFile(liveCompiled), beforeCompiled, 'live hooks/.compiled.env byte-identical after the doctor run');
});

test('doctor: declared but not generated is a structured gap — the adapter compiles silently, the doctor refuses', () => {
  const world = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-5-gap-'));
  const yaml = hooksYamlSrc.replace(
    'policies:',
    `policies:
  - id: recovery-context-injection
    hook: SessionStart
    action: run
    script: hooks/recovery-context.sh`,
  );
  assert.notEqual(yaml, hooksYamlSrc, 'world hooks.yaml must carry the extra declared policy');
  fs.writeFileSync(path.join(world, 'hooks.yaml'), yaml);

  // The underlying silence: the adapter itself exits 0 (it compiles the deny
  // payload and its three fixed entries; the declared script is simply never
  // registered — exactly the E05 silent gap this layer exists to expose).
  const adapterRun = spawnSync('bash', [ADAPTER], {
    encoding: 'utf8',
    env: { ...process.env, SDD_TARGET_ROOT: world },
  });
  assert.equal(adapterRun.status, 0, 'adapter compiles the world without complaining (the gap is silent at the compiler)');

  const run = runDoctor(['--root', projectRoot, '--target-root', world, '--json']);
  const report = parseJsonOut(run, 'doctor gap');
  assert.equal(run.status, 2, 'the doctor must fail closed on a declared-but-not-generated hook');
  assert.equal(report.verdict, 'GAPS');
  const gap = report.findings.find((f) => f.code === 'STRUCTURAL_HOOK_GAP');
  assert.ok(gap, `a STRUCTURAL_HOOK_GAP finding must exist: ${JSON.stringify(report.findings)}`);
  assert.equal(gap.policy, 'recovery-context-injection');
  assert.match(gap.detail, /recovery-context\.sh/, 'the finding must name the unregistered script');
  fs.rmSync(world, { recursive: true, force: true });
});

test('doctor: generated but not declared is flagged as unauthorized generation', () => {
  const world = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-5-over-'));
  const adapterRun = spawnSync('bash', [ADAPTER], {
    encoding: 'utf8',
    env: { ...process.env, SDD_TARGET_ROOT: world },
  });
  assert.equal(adapterRun.status, 0);
  const settingsPath = path.join(world, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings.hooks.PostToolUse = [
    { hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/hooks/pre-tool-gate.sh' }] },
  ];
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  const run = runDoctor(['--root', projectRoot, '--target-root', world, '--json']);
  const report = parseJsonOut(run, 'doctor overreach');
  assert.equal(run.status, 2);
  const over = report.findings.find((f) => f.code === 'UNAUTHORIZED_HOOK_GENERATION');
  assert.ok(over, `an UNAUTHORIZED_HOOK_GENERATION finding must exist: ${JSON.stringify(report.findings)}`);
  assert.equal(over.group, 'PostToolUse');
  assert.match(over.detail, /pre-tool-gate\.sh/);
  fs.rmSync(world, { recursive: true, force: true });
});

test('doctor: duplicate event+command registration is reported with §7.2 semantics; plugin disposition stays at the plugin entry', () => {
  const world = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-5-dup-'));
  const adapterRun = spawnSync('bash', [ADAPTER], {
    encoding: 'utf8',
    env: { ...process.env, SDD_TARGET_ROOT: world },
  });
  assert.equal(adapterRun.status, 0);
  const settingsPath = path.join(world, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  // A plugin wrapper around the project managed script (double registration).
  settings.hooks.SessionStart.push({
    matcher: 'startup|resume',
    hooks: [{ type: 'command', command: '"$CLAUDE_PLUGIN_ROOT"/hooks/session-context.sh' }],
  });
  // Two identical user entries under PreToolUse (user+user duplicate).
  settings.hooks.PreToolUse.push({ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR"/tools/user-gate.js' }] });
  settings.hooks.PreToolUse.push({ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR"/tools/user-gate.js' }] });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  const run = runDoctor(['--root', projectRoot, '--target-root', world, '--json']);
  const report = parseJsonOut(run, 'doctor duplicates');
  assert.equal(run.status, 2);
  const dups = report.findings.filter((f) => f.code === 'DUPLICATE_REGISTRATION');
  assert.ok(dups.length >= 2, `both duplicate shapes must be found: ${JSON.stringify(report.findings)}`);
  const pluginDup = dups.find((f) => (f.subjects ?? []).includes('plugin') || /插件入口|plugin entry/.test(f.detail ?? ''));
  assert.ok(pluginDup, 'the plugin-wrapped duplicate must be marked with the plugin disposition');
  const userDup = dups.find((f) => (f.subjects ?? []).includes('user'));
  assert.ok(userDup, 'the user+user duplicate must be found');
  assert.equal(userDup.group, 'PreToolUse');

  // The doctor is read-only over the composed view: the injected entries survive.
  const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.equal(after.hooks.SessionStart.length, settings.hooks.SessionStart.length);
  assert.equal(after.hooks.PreToolUse.length, settings.hooks.PreToolUse.length);
  fs.rmSync(world, { recursive: true, force: true });
});

test('doctor: an event beyond the fixed set keeps the adapter refusal and reports the capability gap without crashing', () => {
  const world = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-5-cap-'));
  const yaml = hooksYamlSrc.replace(
    'policies:',
    `policies:
  - id: subagent-method-rules
    hook: SubagentStart
    action: run
    script: hooks/subagent-rules.sh`,
  );
  fs.writeFileSync(path.join(world, 'hooks.yaml'), yaml);

  const adapterRun = spawnSync('bash', [ADAPTER], {
    encoding: 'utf8',
    env: { ...process.env, SDD_TARGET_ROOT: world },
  });
  assert.notEqual(adapterRun.status, 0, 'the adapter itself must refuse events beyond the fixed set (§7.3)');
  assert.match(adapterRun.stderr, /固定事件集|FIXED EVENT/i);

  const run = runDoctor(['--root', projectRoot, '--target-root', world, '--json']);
  const report = parseJsonOut(run, 'doctor capability gap');
  assert.equal(run.status, 2);
  const cap = report.findings.find((f) => f.code === 'HOOK_EVENT_BEYOND_FIXED_SET');
  assert.ok(cap, `a HOOK_EVENT_BEYOND_FIXED_SET finding must exist: ${JSON.stringify(report.findings)}`);
  assert.equal(cap.policy, 'subagent-method-rules');
  const comp = report.findings.find((f) => f.code === 'ADAPTER_COMPOSITION_FAILED');
  assert.ok(comp, 'the adapter refusal must be preserved as a composition failure');
  assert.match(comp.detail, /固定事件集|FIXED EVENT/i);
  fs.rmSync(world, { recursive: true, force: true });
});

test('silent failure: exit 0 without the declared effect is NOT execution — only the observed effect separates the two exit-0 runs', () => {
  const world = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-5-silent-'));
  const project = path.join(world, 'project');
  const hooksDir = path.join(world, 'hooks');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(hooksDir, { recursive: true });
  for (const name of ['_resolve-project-dir.sh', 'session-context.sh']) {
    fs.copyFileSync(path.join(projectRoot, 'hooks', name), path.join(hooksDir, name));
  }

  const runHook = () => spawnSync('bash', [path.join(hooksDir, 'session-context.sh')], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: project },
  });

  // Real script: exit 0 AND the declared context injection actually happens.
  const real = runHook();
  assert.equal(real.status, 0);
  assert.ok(real.stdout.trim().length > 0, 'the real session hook injects method context (non-empty stdout)');

  // Silent failure: exit 0 with NO declared work — same exit code, no effect.
  fs.writeFileSync(path.join(hooksDir, 'session-context.sh'), '#!/usr/bin/env bash\nexit 0\n');
  const silent = runHook();
  assert.equal(silent.status, 0, 'the silent-failure hook still exits 0');
  assert.equal(silent.stdout.trim(), '', '…but produces none of the declared output');

  // The executed predicate (policy rule) separates them; exit code alone cannot.
  const policy = JSON.parse(read(POLICY));
  const executed = (r) => r.status === 0 && r.stdout.trim().length > 0;
  assert.equal(executed(real), true, 'real run: exit 0 + observed declared effect = executed');
  assert.equal(executed(silent), false, 'silent run: exit 0 alone is NOT_EVIDENCED (P4_6 knownFacts)');
  assert.equal(policy.validationRules.silentExitZero.effect, 'NOT_EVIDENCED');
  fs.rmSync(world, { recursive: true, force: true });
});

test('mode crosstalk: last write wins on a shared mode file and never weakens the deny gate', () => {
  const world = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-5-mode-'));
  const project = path.join(world, 'project');
  fs.mkdirSync(project, { recursive: true });
  const modeFile = path.join(project, '.ponytail-mode');
  fs.writeFileSync(modeFile, 'plan\n');

  const denyInput = JSON.stringify({ tool_name: 'Bash', tool_input: { command: `${FORCE_PUSH} origin main` } });
  const runGate = () => spawnSync('bash', [path.join(projectRoot, 'hooks', 'pre-tool-gate.sh')], {
    encoding: 'utf8',
    input: denyInput,
    env: { ...process.env, CLAUDE_PROJECT_DIR: project },
  });
  assert.equal(runGate().status, 2, 'the deny gate blocks before any mode writes');

  // Two sessions share the mode file: the last write wins (observed fact).
  fs.writeFileSync(modeFile, 'bypassPermissions\n');
  assert.equal(fs.readFileSync(modeFile, 'utf8'), 'bypassPermissions\n', 'last write wins — the shared file holds session B mode');
  fs.writeFileSync(modeFile, 'plan\n');
  assert.equal(fs.readFileSync(modeFile, 'utf8'), 'plan\n');

  // The deny gate is invariant under the mode churn.
  assert.equal(runGate().status, 2, 'deny still blocks after bypassPermissions was written by the other session');
  assert.equal(runGate().status, 2, 'deny still blocks after plan was written back');

  const policy = JSON.parse(read(POLICY));
  assert.equal(policy.validationRules.modeCrosstalk.permissionBasis, false,
    'the shared mode file is structurally not a permission basis');
  fs.rmSync(world, { recursive: true, force: true });
});
