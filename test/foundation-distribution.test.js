// P1_2 foundation distribution: asset exporter + FoundationLock (1.2.a),
// composition idempotency with managed-block handover over isolated temp
// configs (1.2.b), and old-run baseline pinning with explicit fallback
// (1.2.c). Live .claude/settings.json is never written by this suite: every
// settings-mutating case runs the adapter/bootstrap against SDD_TARGET_ROOT
// fixtures under $TMPDIR. Sources of truth: .agents/skills/, hooks.yaml,
// mcp-capabilities.yaml (+ .mcp.json as the generated registration artifact).
//
// Note: deny-pattern test vectors are assembled at runtime (FORCE_PUSH)
// because this file is written through the same control plane it tests.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exporterPath = path.join(projectRoot, 'tools', 'foundation-export.mjs');
const adapterPath = path.join(projectRoot, 'tools', 'adapters', 'claude-code.sh');
const bootstrapPath = path.join(projectRoot, 'tools', 'bootstrap.sh');
const repoSettingsPath = path.join(projectRoot, '.claude', 'settings.json');
const repoMcpJsonPath = path.join(projectRoot, '.mcp.json');

const { parseContract } = await import(path.join(projectRoot, 'contracts/delivery/index.js'));
const exporter = await import(exporterPath);

const hasPython3 = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;
const adapterSrc = fs.existsSync(adapterPath) ? fs.readFileSync(adapterPath, 'utf8') : '';
const bootstrapSrc = fs.existsSync(bootstrapPath) ? fs.readFileSync(bootstrapPath, 'utf8') : '';
const supportsIsolation = adapterSrc.includes('SDD_TARGET_ROOT');
const supportsUninstall = adapterSrc.includes('--uninstall');

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const FIXED_COMMIT = 'a'.repeat(40);
const FORCE_PUSH = ['git push', '--force'].join(' ');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

// Hermetic fixture root with the full source layout the exporter reads.
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-fdn-'));
  fs.mkdirSync(path.join(root, '.agents/skills/alpha'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents/skills/alpha/SKILL.md'), '# alpha v1\n');
  fs.mkdirSync(path.join(root, '.agents/skills/beta/references'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents/skills/beta/SKILL.md'), '# beta v1\n');
  fs.writeFileSync(path.join(root, '.agents/skills/beta/references/deep.md'), 'beta ref\n');
  fs.writeFileSync(
    path.join(root, 'hooks.yaml'),
    ['policies:', '  - id: dangerous-command-blocklist', '    hook: PreToolUse', '    matcher: Bash', '    action: deny', '    patterns:', '      - "' + FORCE_PUSH + '"', '    message: "blocked"'].join('\n') + '\n',
  );
  writeJson(path.join(root, '.mcp.json'), {
    mcpServers: { probe: { command: 'npx', args: ['-y', 'probe-mcp@1.2.3'] } },
  });
  writeJson(path.join(root, 'package.json'), { name: 'fdn-fixture', version: '1.0.0' });
  writeJson(path.join(root, 'integrations/comet/upstream.lock.json'), {
    schemaVersion: 1,
    package: { name: '@rpamis/comet', version: '0.4.5' },
    toolchain: { node: '20.0.0' },
  });
  writeJson(path.join(root, 'openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json'), {
    schema_version: 1,
    method_profile: { controller: 'fixture-profile' },
  });
  return root;
}

// ---------------------------------------------------------------------------
// 1.2.a exporter + FoundationLock
// ---------------------------------------------------------------------------

test('exporter builds a contract-valid lock from the unique sources (real repo)', async () => {
  const lock = await exporter.buildLock(projectRoot);
  const parsed = parseContract('SDD.Delivery.FoundationLock', lock);
  assert.deepEqual(parsed.errors ?? [], [], 'lock must validate against the frozen contract');
  assert.equal(parsed.ok, true);

  const head = execFileSync('git', ['-C', projectRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(lock.release.commit, head, 'release commit must pin the actual HEAD');

  // Skill digests must equal the P1_6 method-profile manifest digests (same
  // digest basis; state-independent — both sides recomputed here).
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json'), 'utf8'));
  const byName = new Map(lock.skills.map((s) => [s.name, s.digest]));
  assert.equal(lock.skills.length, manifest.snapshots.length);
  for (const snapshot of manifest.snapshots) {
    assert.equal(byName.get(snapshot.name), snapshot.content_sha256, 'skill ' + snapshot.name + ' digest must match the method-profile manifest');
  }
  assert.equal(lock.policy.schemaRef, 'hooks.yaml');
  assert.equal(lock.policy.digest, sha256(fs.readFileSync(path.join(projectRoot, 'hooks.yaml'))));
});

test('lock emission gates: full digests, no machine paths, no floating versions', async () => {
  const lock = await exporter.buildLock(projectRoot);
  const serialized = exporter.canonicalJson(lock);
  assert.doesNotMatch(serialized, /\/Users\/|\/home\/|\$HOME|%USERPROFILE%/, 'machine absolute path in lock');
  assert.doesNotMatch(serialized, /@latest|unpinned/i, 'floating version in lock');

  assert.deepEqual(exporter.guardLock(lock), { ok: true, errors: [] });

  // Negative: machine path — note the frozen contract alone ACCEPTS this; the
  // exporter gate is the additional emission barrier (documented gap closure).
  const withPath = structuredClone(lock);
  withPath.profile = '/Users/mac/leaked';
  assert.equal(parseContract('SDD.Delivery.FoundationLock', withPath).ok, true, 'contract alone accepts machine paths (known gap)');
  const gatePath = exporter.guardLock(withPath);
  assert.equal(gatePath.ok, false);
  assert.match(gatePath.errors.join(' '), /machine absolute path/);

  const withHead = structuredClone(lock);
  withHead.toolchain.runner.version = 'HEAD';
  assert.equal(exporter.guardLock(withHead).ok, false, 'HEAD ref must be refused');

  const withLatest = structuredClone(lock);
  withLatest.toolchain.cli.version = '@latest';
  assert.equal(exporter.guardLock(withLatest).ok, false, '@latest must be refused');

  const withUnpinned = structuredClone(lock);
  withUnpinned.toolchain.node = 'unpinned';
  assert.equal(exporter.guardLock(withUnpinned).ok, false, 'unpinned must be refused');

  // Missing digest: contract refuses, and the gate surfaces it.
  const missingDigest = structuredClone(lock);
  delete missingDigest.skills[0].digest;
  assert.equal(parseContract('SDD.Delivery.FoundationLock', missingDigest).ok, false, 'missing skill digest must be refused by the contract');
  assert.equal(exporter.guardLock(missingDigest).ok, false);
});

test('exporter refuses to emit when an MCP registration floats (@latest)', async () => {
  const root = makeFixture();
  try {
    writeJson(path.join(root, '.mcp.json'), {
      mcpServers: { probe: { command: 'npx', args: ['-y', 'probe-mcp@latest'] } },
    });
    await assert.rejects(
      () => exporter.exportRelease(root, path.join(root, 'foundation'), { releaseCommit: FIXED_COMMIT }),
      (err) => /floating|@latest/i.test(String(err && err.message)),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('release view + lock are byte-stable across repeated exports (repeat-pull idempotency)', async () => {
  const root = makeFixture();
  try {
    const outA = path.join(root, 'dist-a');
    const outB = path.join(root, 'dist-b');
    await exporter.exportRelease(root, outA, { releaseCommit: FIXED_COMMIT });
    await exporter.exportRelease(root, outB, { releaseCommit: FIXED_COMMIT });
    const lockA = fs.readFileSync(path.join(outA, 'foundation-lock.json'), 'utf8');
    const lockB = fs.readFileSync(path.join(outB, 'foundation-lock.json'), 'utf8');
    assert.equal(lockA, lockB, 'repeat pull must be byte-identical (no timestamps, no machine state)');
    const manifestA = fs.readFileSync(path.join(outA, 'release/skills/MANIFEST.json'), 'utf8');
    const manifestB = fs.readFileSync(path.join(outB, 'release/skills/MANIFEST.json'), 'utf8');
    assert.equal(manifestA, manifestB);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('dual-write drift is detected in both directions (source edit and hand-edited view)', async () => {
  const root = makeFixture();
  try {
    const out = path.join(root, 'foundation');
    await exporter.exportRelease(root, out, { releaseCommit: FIXED_COMMIT, skillsCopy: true });
    const lockPath = path.join(out, 'foundation-lock.json');

    // Direction 1: skill body edited after export → source vs lock drift.
    fs.writeFileSync(path.join(root, '.agents/skills/alpha/SKILL.md'), '# alpha v2 drifted\n');
    const drift1 = await exporter.verifyLock(lockPath, root);
    assert.equal(drift1.ok, false);
    assert.ok(drift1.drifts.some((d) => d.kind === 'lock' && d.item === 'alpha'), JSON.stringify(drift1.drifts));

    // Direction 2: hand-edited release view (distribution dir as second source).
    fs.writeFileSync(path.join(root, '.agents/skills/alpha/SKILL.md'), '# alpha v1\n');
    assert.equal((await exporter.verifyLock(lockPath, root)).ok, true, 'restored source must verify clean');
    const releaseCopy = path.join(out, 'release/skills/alpha/SKILL.md');
    fs.writeFileSync(releaseCopy, 'hand-edited second source\n');
    const drift2 = await exporter.verifyLock(lockPath, root);
    assert.equal(drift2.ok, false, 'hand-edited release view must be detected');
    assert.ok(drift2.drifts.some((d) => d.kind === 'release' && d.item.includes('alpha')), JSON.stringify(drift2.drifts));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('committed foundation artifacts match live sources (repo-level drift gate)', async () => {
  const lockPath = path.join(projectRoot, 'foundation', 'foundation-lock.json');
  assert.ok(fs.existsSync(lockPath), 'foundation/foundation-lock.json must be committed');
  const verdict = await exporter.verifyLock(lockPath, projectRoot);
  assert.deepEqual(verdict.drifts ?? [], [], 'committed foundation drifted from sources: ' + JSON.stringify(verdict.drifts ?? []));
  assert.equal(verdict.ok, true, String(verdict.error));

  const hooksView = path.join(projectRoot, 'foundation', 'release', 'hooks', 'hooks.yaml');
  assert.equal(fs.readFileSync(hooksView, 'utf8'), fs.readFileSync(path.join(projectRoot, 'hooks.yaml'), 'utf8'), 'release hooks view must match the source byte-for-byte');

  const serialized = fs.readFileSync(lockPath, 'utf8');
  assert.doesNotMatch(serialized, /\/Users\/|\$HOME|%USERPROFILE%/, 'committed lock contains a machine path');
  assert.doesNotMatch(serialized, /@latest|unpinned/i, 'committed lock contains a floating version');
});

// ---------------------------------------------------------------------------
// 1.2.b composition idempotency + managed-block handover (isolated fixtures)
// ---------------------------------------------------------------------------

function runAdapter(root, args = []) {
  return spawnSync('bash', [adapterPath, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, SDD_TARGET_ROOT: root },
  });
}

function fixtureUserSettings() {
  return {
    permissions: { allow: ['Bash(npm test)'] },
    hooks: {
      SessionStart: [
        { matcher: 'startup', hooks: [{ type: 'command', command: 'echo user-own-session-hook' }] },
      ],
      PreToolUse: [
        { matcher: 'WebFetch', hooks: [{ type: 'command', command: 'echo user-own-gate' }] },
      ],
    },
  };
}

function managedCommands(settings) {
  const managed = { PreToolUse: [], SessionStart: [], Stop: [] };
  for (const [group, entries] of Object.entries(settings.hooks ?? {})) {
    for (const entry of entries ?? []) {
      for (const hook of entry.hooks ?? []) {
        if (/hooks\/(pre-tool-gate|session-context|stop-reminder)\.sh/.test(String(hook.command))) {
          (managed[group] ??= []).push({ matcher: entry.matcher, command: hook.command });
        }
      }
    }
  }
  return managed;
}

function userEntriesIntact(settings) {
  const flat = JSON.stringify(settings.hooks ?? {});
  return flat.includes('user-own-session-hook') && flat.includes('user-own-gate') && settings.permissions?.allow?.[0] === 'Bash(npm test)';
}

test('composition requires adapter fixture isolation and uninstall capability', () => {
  // RED guard: without SDD_TARGET_ROOT the adapter could only be exercised by
  // writing the live repo config, which this task forbids.
  assert.ok(supportsIsolation, 'RED: adapter lacks SDD_TARGET_ROOT isolation — bootstrap composition cannot be tested in a temp config without touching live settings');
  assert.ok(supportsUninstall, 'RED: adapter has no --uninstall — 配置可回退 (F02) is unimplementable');
  assert.ok(bootstrapSrc.includes('SDD_TARGET_ROOT'), 'RED: bootstrap.sh has no target-root mode — forward/reverse init and repeat pull cannot run isolated');
});

function compositionTest(name, fn) {
  test(name, { skip: (!hasPython3 || !supportsIsolation) && (!hasPython3 ? 'python3 unavailable' : 'adapter lacks SDD_TARGET_ROOT isolation') }, fn);
}

compositionTest('reverse order A: existing user config survives bootstrap, guard installed once', () => {
  const root = makeFixture();
  try {
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    writeJson(path.join(root, '.claude/settings.json'), fixtureUserSettings());
    const run = runAdapter(root);
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8'));
    const managed = managedCommands(settings);
    assert.equal(managed.PreToolUse.length, 1, 'exactly one managed PreToolUse entry');
    assert.ok(userEntriesIntact(settings), 'user entries must survive');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

compositionTest('reverse order B + repeat pull: re-bootstrap never duplicates Guard, user edits kept', () => {
  const root = makeFixture();
  try {
    assert.equal(runAdapter(root).status, 0);
    const settingsPath = path.join(root, '.claude/settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    settings.hooks.SessionStart.push({ matcher: 'resume', hooks: [{ type: 'command', command: 'echo user-later-addition' }] });
    writeJson(settingsPath, settings);

    assert.equal(runAdapter(root).status, 0, 'first re-pull');
    assert.equal(runAdapter(root).status, 0, 'second re-pull');
    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const managed = managedCommands(after);
    assert.equal(managed.PreToolUse.length, 1, 'no duplicate Guard after repeat pulls');
    assert.equal(managed.SessionStart.length, 1);
    assert.ok(JSON.stringify(after.hooks).includes('user-later-addition'), 'user addition after install must survive repeat pull');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

compositionTest('upgrade: stale managed entry in an older command format is replaced, not duplicated', () => {
  const root = makeFixture();
  try {
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    const legacy = fixtureUserSettings();
    legacy.hooks.PreToolUse.push({ matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'hooks/pre-tool-gate.sh' }] });
    writeJson(path.join(root, '.claude/settings.json'), legacy);

    const run = runAdapter(root);
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8'));
    const managed = managedCommands(settings);
    assert.equal(managed.PreToolUse.length, 1, 'upgrade must not leave two Guard entries (不重复 Guard): ' + JSON.stringify(managed.PreToolUse));
    assert.match(managed.PreToolUse[0].command, /CLAUDE_PROJECT_DIR/, 'surviving entry must be the current managed format');
    assert.equal(managed.PreToolUse[0].matcher, 'Write|Edit|MultiEdit|NotebookEdit|Bash', 'matcher must be the full deny-policy union');
    assert.ok(userEntriesIntact(settings), 'user entries must survive upgrade');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

compositionTest('uninstall removes managed entries only, is idempotent, and re-init restores', () => {
  const root = makeFixture();
  try {
    assert.equal(runAdapter(root).status, 0);
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    const settingsPath = path.join(root, '.claude/settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    settings.hooks.Stop.push({ hooks: [{ type: 'command', command: 'echo user-stop-hook' }] });
    writeJson(settingsPath, settings);

    assert.equal(runAdapter(root, ['--uninstall']).status, 0, 'uninstall');
    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.deepEqual(managedCommands(after), { PreToolUse: [], SessionStart: [], Stop: [] }, 'all managed entries removed');
    assert.ok(JSON.stringify(after.hooks).includes('user-stop-hook'), 'user Stop hook must survive uninstall');
    assert.ok(after.permissions, 'non-hook user settings must survive uninstall');
    assert.ok(!fs.existsSync(path.join(root, 'hooks/.compiled.env')), 'compiled policy env must be removed on uninstall');

    assert.equal(runAdapter(root, ['--uninstall']).status, 0, 'uninstall is idempotent');

    assert.equal(runAdapter(root).status, 0, 're-init after uninstall');
    const restored = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(managedCommands(restored).PreToolUse.length, 1);
    assert.ok(JSON.stringify(restored.hooks).includes('user-stop-hook'), 'user hook survives uninstall/init round trip');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

compositionTest('matcher registration and gate script behavior are tested together', () => {
  const root = makeFixture();
  try {
    // Extend the fixture policy set: new deny policy with a NEW matcher part.
    fs.writeFileSync(
      path.join(root, 'hooks.yaml'),
      ['policies:', '  - id: dangerous-command-blocklist', '    hook: PreToolUse', '    matcher: Bash', '    action: deny', '    patterns:', '      - "' + FORCE_PUSH + '"', '    message: "blocked"', '  - id: extra-gate', '    hook: PreToolUse', '    matcher: Task', '    action: deny', '    patterns:', '      - "deploy --prod"', '    message: "blocked task"'].join('\n') + '\n',
    );
    const run = runAdapter(root);
    assert.equal(run.status, 0, run.stderr || run.stdout);

    const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8'));
    const managed = managedCommands(settings);
    const matcherParts = String(managed.PreToolUse[0]?.matcher ?? '').split('|');
    assert.ok(matcherParts.includes('Task'), 'script policy added but settings matcher not registered: ' + managed.PreToolUse[0]?.matcher);
    assert.ok(matcherParts.includes('Bash') && matcherParts.includes('Write'), 'full deny union required');

    // Script behavior against the SAME fixture's compiled env: the fixture
    // gets its own hooks scripts so the gate reads the fixture .compiled.env.
    fs.cpSync(path.join(projectRoot, 'hooks'), path.join(root, 'hooks'), { recursive: true });
    const deny = spawnSync('bash', [path.join(root, 'hooks/pre-tool-gate.sh')], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: FORCE_PUSH + ' origin main' } }),
      encoding: 'utf8',
    });
    assert.equal(deny.status, 2, 'gate script must deny the fixture blocklist pattern');
    assert.ok(deny.stderr.includes(FORCE_PUSH));

    // Drift probe: script/registry mismatch (matcher stripped after install)
    // must be repairable by re-bootstrap.
    const settingsPath = path.join(root, '.claude/settings.json');
    const stale = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    for (const entry of stale.hooks.PreToolUse) {
      for (const hook of entry.hooks ?? []) {
        if (/pre-tool-gate\.sh/.test(String(hook.command))) entry.matcher = 'Bash';
      }
    }
    writeJson(settingsPath, stale);
    const staleMatcher = JSON.parse(fs.readFileSync(settingsPath, 'utf8')).hooks.PreToolUse
      .flatMap((e) => String(e.matcher ?? '').split('|'));
    assert.ok(!staleMatcher.includes('Task'), 'drift probe staged: Task no longer registered');
    assert.equal(runAdapter(root).status, 0, 're-bootstrap must repair matcher drift');
    const repaired = managedCommands(JSON.parse(fs.readFileSync(settingsPath, 'utf8')));
    assert.ok(String(repaired.PreToolUse[0].matcher).split('|').includes('Task'), 'matcher drift repaired');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

compositionTest('bootstrap target mode composes adapter + exporter against $TMPDIR, never the repo', () => {
  const root = makeFixture();
  try {
    const repoSettingsBefore = fs.existsSync(repoSettingsPath) ? fs.readFileSync(repoSettingsPath, 'utf8') : null;
    const repoMcpBefore = fs.readFileSync(repoMcpJsonPath, 'utf8');

    const run1 = spawnSync('bash', [bootstrapPath], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, SDD_TARGET_ROOT: root },
    });
    assert.equal(run1.status, 0, run1.stderr || run1.stdout);
    assert.ok(fs.existsSync(path.join(root, '.claude/settings.json')), 'target settings installed');
    assert.ok(fs.existsSync(path.join(root, 'foundation/foundation-lock.json')), 'target foundation lock pulled');

    // Repo live config untouched.
    const repoSettingsAfter = fs.existsSync(repoSettingsPath) ? fs.readFileSync(repoSettingsPath, 'utf8') : null;
    assert.equal(repoSettingsAfter, repoSettingsBefore, 'repo .claude/settings.json must not be written');
    assert.equal(fs.readFileSync(repoMcpJsonPath, 'utf8'), repoMcpBefore, 'repo .mcp.json must not be written');

    // Repeat pull is idempotent at the lock level.
    const lock1 = fs.readFileSync(path.join(root, 'foundation/foundation-lock.json'), 'utf8');
    const run2 = spawnSync('bash', [bootstrapPath], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, SDD_TARGET_ROOT: root },
    });
    assert.equal(run2.status, 0, run2.stderr || run2.stdout);
    assert.equal(fs.readFileSync(path.join(root, 'foundation/foundation-lock.json'), 'utf8'), lock1, 'repeat pull must be byte-identical');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 1.2.c old-run pinning + explicit fallback (F04/B09)
// ---------------------------------------------------------------------------

function makeRunDir(lockPayload, state) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-run-'));
  fs.writeFileSync(path.join(runDir, 'foundation-lock.json'), JSON.stringify(lockPayload, null, 2) + '\n');
  if (state) writeJson(path.join(runDir, 'run-state.json'), state);
  return runDir;
}

test('old run pinned to the committed lock stays resolvable (real repo, F04 keep-baseline)', async () => {
  const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'foundation/foundation-lock.json'), 'utf8'));
  const runDir = makeRunDir(lock, { schemaVersion: 1, runId: 'run-old', status: 'active', owner: 'alice', pinnedCommit: lock.release.commit });
  try {
    const verdict = await exporter.checkRun(runDir, projectRoot, {});
    assert.equal(verdict.ok, true, JSON.stringify(verdict));
    assert.equal(verdict.baseline.resolvable, true);
    assert.ok(verdict.baseline.resolvedSkills.includes('tdd'), 'pinned skills must resolve from git history');
    assert.equal(verdict.drift, false);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('active run blocks silent re-baseline after asset drift; closed run only notes it', async () => {
  const root = makeFixture();
  try {
    const { lock } = await exporter.exportRelease(root, path.join(root, 'foundation'), { releaseCommit: FIXED_COMMIT });
    const activeDir = makeRunDir(lock, { schemaVersion: 1, runId: 'run-a', status: 'active', owner: 'alice' });
    const closedDir = makeRunDir(lock, { schemaVersion: 1, runId: 'run-c', status: 'closed', owner: 'alice' });
    try {
      fs.writeFileSync(path.join(root, '.agents/skills/beta/SKILL.md'), '# beta v2\n');
      const active = await exporter.checkRun(activeDir, root, {});
      assert.equal(active.ok, false, 'resuming an active run on drifted assets must block');
      assert.equal(active.reason, 'silent-rebaseline-blocked');
      assert.match(active.migration, /--migrate|new run/i, 'block must carry an explicit migration path');

      const closed = await exporter.checkRun(closedDir, root, {});
      assert.equal(closed.ok, true, 'closed runs are history; drift is informational');
      assert.equal(closed.drift, true);
    } finally {
      fs.rmSync(activeDir, { recursive: true, force: true });
      fs.rmSync(closedDir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unresolvable pinned baseline is blocked explicitly, never silently swapped', async () => {
  const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'foundation/foundation-lock.json'), 'utf8'));
  const bogus = structuredClone(lock);
  bogus.release.commit = '0'.repeat(40);
  const runDir = makeRunDir(bogus, { schemaVersion: 1, runId: 'run-x', status: 'active', owner: 'alice' });
  try {
    const verdict = await exporter.checkRun(runDir, projectRoot, {});
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'baseline-unresolvable');
    assert.ok(String(verdict.migration).length > 0, 'explicit migration/referral required');
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('B09: a second writer cannot take over an active run', async () => {
  const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'foundation/foundation-lock.json'), 'utf8'));
  const runDir = makeRunDir(lock, { schemaVersion: 1, runId: 'run-old', status: 'active', owner: 'alice', pinnedCommit: lock.release.commit });
  try {
    const refused = await exporter.checkRun(runDir, projectRoot, { acquire: true, owner: 'bob' });
    assert.equal(refused.ok, false, 'second writer must be refused');
    assert.equal(refused.reason, 'second-writer-refused');
    assert.equal(JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8')).owner, 'alice', 'state unchanged by refused writer');

    const reclaim = await exporter.checkRun(runDir, projectRoot, { acquire: true, owner: 'alice' });
    assert.equal(reclaim.ok, true, 'owner re-claim allowed');
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('explicit migration re-pins only with ownership and a resolvable old baseline', async () => {
  const root = makeFixture();
  try {
    const { lock: lock1 } = await exporter.exportRelease(root, path.join(root, 'foundation-a'), { releaseCommit: FIXED_COMMIT });
    const runDir = makeRunDir(lock1, { schemaVersion: 1, runId: 'run-m', status: 'active', owner: 'alice' });
    try {
      // Asset drift makes migration necessary.
      fs.writeFileSync(path.join(root, '.agents/skills/alpha/SKILL.md'), '# alpha v2\n');

      const refused = await exporter.checkRun(runDir, root, { migrate: true, owner: 'bob' });
      assert.equal(refused.ok, false, 'migration requires the run owner');
      assert.equal(refused.reason, 'second-writer-refused');

      const { lock: lock2 } = await exporter.exportRelease(root, path.join(root, 'foundation-b'), { releaseCommit: FIXED_COMMIT });
      assert.notEqual(lock1.release.exportDigest, lock2.release.exportDigest, 'fixture drift must change the export digest');

      const migrated = await exporter.checkRun(runDir, root, { migrate: true, owner: 'alice' });
      assert.equal(migrated.ok, true, JSON.stringify(migrated));
      const state = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
      assert.equal(state.migrations.length, 1);
      assert.equal(state.migrations[0].from.exportDigest, lock1.release.exportDigest, 'old baseline recorded, not erased');
      assert.equal(state.migrations[0].to.exportDigest, lock2.release.exportDigest);
      assert.equal(JSON.parse(fs.readFileSync(path.join(runDir, 'foundation-lock.json'), 'utf8')).release.exportDigest, lock2.release.exportDigest, 'run re-pinned explicitly');
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
