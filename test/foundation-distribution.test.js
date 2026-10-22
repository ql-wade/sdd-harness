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

  // Skill digests must equal the P1_6 method-profile manifest digests — the
  // exporter enumerates the TRACKED file set per skill, which is exactly the
  // P1_6 line basis; both sides are recomputed here (state-independent).
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json'), 'utf8'));
  const byName = new Map(lock.skills.map((s) => [s.name, s.digest]));
  assert.equal(lock.skills.length, manifest.snapshots.length);
  for (const snapshot of manifest.snapshots) {
    const clean = exporter.skillDigest(projectRoot, snapshot.name);
    assert.equal(byName.get(snapshot.name), snapshot.content_sha256, 'skill ' + snapshot.name + ' lock digest must match the method-profile manifest');
    assert.equal(snapshot.content_sha256, clean.digest, 'skill ' + snapshot.name + ' manifest digest must match the tracked source');
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

// Project-managed entries only: commands referencing plugin infrastructure
// (CLAUDE_PLUGIN_ROOT / .claude/plugins/) are plugin registrations even when
// their script NAME collides with ours — they never count as project managed.
function managedCommands(settings) {
  const managed = { PreToolUse: [], SessionStart: [], Stop: [] };
  for (const [group, entries] of Object.entries(settings.hooks ?? {})) {
    for (const entry of entries ?? []) {
      for (const hook of entry.hooks ?? []) {
        const command = String(hook.command ?? '');
        if (/CLAUDE_PLUGIN_ROOT|\.claude\/plugins\//.test(command)) continue;
        if (/hooks\/(pre-tool-gate|session-context|stop-reminder)\.sh/.test(command)) {
          (managed[group] ??= []).push({ matcher: entry.matcher, command });
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
    // The fixture's deny union is Bash-only; the legacy entry's Write|Edit
    // matcher must NOT leak into the registered matcher.
    assert.equal(managed.PreToolUse[0].matcher, 'Bash', 'matcher must be the fixture deny-policy union, not the legacy matcher');
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
    settings.permissions = { allow: ['Bash(echo user-keep)'] };
    settings.hooks.Stop.push({ hooks: [{ type: 'command', command: 'echo user-stop-hook' }] });
    writeJson(settingsPath, settings);

    assert.equal(runAdapter(root, ['--uninstall']).status, 0, 'uninstall');
    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.deepEqual(managedCommands(after), { PreToolUse: [], SessionStart: [], Stop: [] }, 'all managed entries removed');
    assert.ok(JSON.stringify(after.hooks).includes('user-stop-hook'), 'user Stop hook must survive uninstall');
    assert.deepEqual(after.permissions.allow, ['Bash(echo user-keep)'], 'non-hook user settings must survive uninstall');
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

compositionTest('uninstall is locale-safe: UTF-8 locale must not crash bootstrap (regression: unbraced $var before a multibyte char)', () => {
  const root = makeFixture();
  try {
    assert.equal(runAdapter(root).status, 0);
    const run = spawnSync('bash', [bootstrapPath, '--uninstall'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, SDD_TARGET_ROOT: root, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' },
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Defect class pin (RED for the 2026-10-22 rework): under any UTF-8 locale,
// bash parses a non-ASCII first byte as part of an unbraced variable name, so
// `$VAR（…）` becomes `$VAR<0xEF>…` → "unbound variable" crash. Both owned
// scripts must brace every expansion that sits next to multibyte text.
test('owned control-plane scripts never place an unbraced variable expansion adjacent to multibyte text', () => {
  const unbracedAdjacentToMultibyte = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?[^\x00-\x7f]/g;
  for (const source of [adapterSrc, bootstrapSrc]) {
    for (const m of source.matchAll(unbracedAdjacentToMultibyte)) {
      if (m[0].startsWith('${')) continue;
      assert.fail('unbraced variable adjacent to multibyte text (locale-dependent crash): ' + JSON.stringify(m[0]));
    }
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
    assert.ok(matcherParts.includes('Bash') && matcherParts.includes('Task'), 'full deny union required');

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

// ---------------------------------------------------------------------------
// V_P1_2_PLUGIN_REGISTRATION_DIVISION (§7.2/§7.3 supplement): plugin lifecycle
// hooks are owned by the plugin entry — the project managed block never
// absorbs them, plugin entries never participate in project managed dedup or
// handover, same event/command duplicates are refused with a conflict list,
// and hooks.yaml events outside the adapter fixed event set are refused
// instead of silently doing nothing.
// ---------------------------------------------------------------------------

const PLUGIN_SESSION_COMMAND = '"$CLAUDE_PLUGIN_ROOT"/hooks/session-context.sh';
const PLUGIN_PROMPT_COMMAND = '"$CLAUDE_PLUGIN_ROOT"/dist/ponytail-prompt.js';
// JSON serialization escapes the quotes inside hook commands; compare on the
// unescaped form so raw commands match what the file actually stores.
const hooksText = (settings) => JSON.stringify(settings.hooks ?? {}).replaceAll(String.fromCharCode(92), '');

function fixturePluginSettings() {
  const settings = fixtureUserSettings();
  // Ponytail-style plugin registrations: the SessionStart command collides
  // with OUR managed script NAME but lives in the plugin root — source
  // marking must classify it as plugin, not as a stale project entry.
  settings.hooks.SessionStart.push({ matcher: 'startup|resume', hooks: [{ type: 'command', command: PLUGIN_SESSION_COMMAND }] });
  settings.hooks.UserPromptSubmit = [{ hooks: [{ type: 'command', command: PLUGIN_PROMPT_COMMAND }] }];
  return settings;
}

const FIXTURE_DENY_POLICY = ['policies:', '  - id: dangerous-command-blocklist', '    hook: PreToolUse', '    matcher: Bash', '    action: deny', '    patterns:', '      - "' + FORCE_PUSH + '"', '    message: "blocked"'];

test('adapter declares the fixed event set and the plugin registration division', () => {
  assert.match(adapterSrc, /FIXED_EVENT_SET|固定事件集/, 'adapter must document the fixed event set boundary (§7.3)');
  assert.match(adapterSrc, /CLAUDE_PLUGIN_ROOT/, 'adapter must document plugin-source marking (§7.2)');
  assert.match(adapterSrc, /PreToolUse[\s\S]*?SessionStart[\s\S]*?Stop/, 'generated events are exactly PreToolUse/SessionStart/Stop');
});

compositionTest('plugin lifecycle hooks are source-marked: never absorbed by handover, dedup or uninstall', () => {
  const root = makeFixture();
  try {
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    const settingsPath = path.join(root, '.claude/settings.json');
    writeJson(settingsPath, fixturePluginSettings());
    const pluginPresent = (s) => hooksText(s).includes(PLUGIN_SESSION_COMMAND) && hooksText(s).includes(PLUGIN_PROMPT_COMMAND);
    const runInstall = runAdapter(root);
    assert.equal(runInstall.status, 0, (runInstall.stderr || runInstall.stdout) + ' — install with plugin entries present');
    let settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(pluginPresent(settings), 'plugin entries must survive install (never copied into or absorbed by the managed block)');
    assert.equal(managedCommands(settings).SessionStart.length, 1, 'exactly one PROJECT managed SessionStart entry beside the plugin entry');
    assert.equal(hooksText(settings).split(PLUGIN_SESSION_COMMAND).length - 1, 1, 'plugin entry itself must not be duplicated');

    assert.equal(runAdapter(root).status, 0, 're-pull (upgrade path)');
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(pluginPresent(settings), 'plugin entries survive upgrade — they do not participate in project managed dedup');
    assert.equal(managedCommands(settings).SessionStart.length, 1, 'still exactly one project managed SessionStart entry');

    assert.equal(runAdapter(root, ['--uninstall']).status, 0, 'uninstall');
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(pluginPresent(settings), "uninstall removes project managed entries only — plugin registrations belong to the plugin entry");
    assert.deepEqual(managedCommands(settings), { PreToolUse: [], SessionStart: [], Stop: [] }, 'all project managed entries removed');
    assert.ok(userEntriesIntact(settings), 'user entries intact throughout');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

compositionTest('same event/command duplicate registration (plugin entry wrapping the managed command) is refused with a conflict list, settings untouched', () => {
  const root = makeFixture();
  try {
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    const before = fixtureUserSettings();
    // A plugin entry that registers the SAME event/command as the project
    // managed block (plugin wrapper around our gate) is a double registration.
    // Byte-copies of the current managed command WITHOUT a plugin marker are
    // handover upgrades (covered by the legacy-format test) — this is the
    // distinct case the division contract refuses.
    before.hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: '"$CLAUDE_PLUGIN_ROOT"/bin/wrap "$CLAUDE_PROJECT_DIR"/hooks/pre-tool-gate.sh' }] });
    const settingsPath = path.join(root, '.claude/settings.json');
    const original = JSON.stringify(before, null, 2) + '\n';
    fs.writeFileSync(settingsPath, original);

    const run = runAdapter(root);
    assert.notEqual(run.status, 0, 'duplicate registration of the same event/command must be refused');
    assert.match(run.stderr, /重复注册|duplicate/i, 'refusal must name the duplicate registration problem');
    assert.match(run.stderr, /pre-tool-gate/, 'conflict list must name the conflicting command');
    assert.match(run.stderr, /插件|plugin/i, 'conflict list must mark the plugin source');
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), original, 'refused composition must not touch settings.json (plugin entry preserved, never auto-edited)');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

compositionTest('duplicate user entries for the same event/command are refused, not composed twice', () => {
  const root = makeFixture();
  try {
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    const before = fixtureUserSettings();
    before.hooks.SessionStart.push({ matcher: 'startup', hooks: [{ type: 'command', command: 'echo user-own-session-hook' }] });
    const settingsPath = path.join(root, '.claude/settings.json');
    const original = JSON.stringify(before, null, 2) + '\n';
    fs.writeFileSync(settingsPath, original);

    const run = runAdapter(root);
    assert.notEqual(run.status, 0, 'two identical user registrations in the composed view must be refused');
    assert.match(run.stderr, /重复注册|duplicate/i);
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), original, 'refused composition must not touch settings.json');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

compositionTest('hooks.yaml events outside the adapter fixed event set are refused, never silently dropped', () => {
  const root = makeFixture();
  try {
    fs.writeFileSync(
      path.join(root, 'hooks.yaml'),
      FIXTURE_DENY_POLICY.concat(['  - id: ponytail-method-context', '    hook: SubagentStart', '    action: run', '    script: hooks/ponytail-context.sh']).join('\n') + '\n',
    );
    const run = runAdapter(root);
    assert.notEqual(run.status, 0, 'YAML append of an unsupported event must not be a silent no-op');
    assert.match(run.stderr, /SubagentStart/, 'refusal must name the offending event');
    assert.match(run.stderr, /固定事件集|fixed event set/, 'refusal must state the fixed event set boundary (§7.3)');
    assert.ok(!fs.existsSync(path.join(root, '.claude/settings.json')), 'refused compile must not write settings');
    assert.ok(!fs.existsSync(path.join(root, 'hooks/.compiled.env')), 'refused compile must not write compiled policy either');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

compositionTest('plugin lifecycle scripts in hooks.yaml are refused (registration division §7.2)', () => {
  const root = makeFixture();
  try {
    fs.writeFileSync(
      path.join(root, 'hooks.yaml'),
      FIXTURE_DENY_POLICY.concat(['  - id: ponytail-context', '    hook: SessionStart', '    action: run', '    script: "$CLAUDE_PLUGIN_ROOT"/hooks/ponytail-session.sh']).join('\n') + '\n',
    );
    const run = runAdapter(root);
    assert.notEqual(run.status, 0, 'plugin lifecycle scripts must not be compiled into the project managed block');
    assert.match(run.stderr, /插件|plugin/i, 'refusal must name the registration division');
    assert.match(run.stderr, /CLAUDE_PLUGIN_ROOT|ponytail/, 'refusal must name the plugin-sourced script');
    assert.ok(!fs.existsSync(path.join(root, '.claude/settings.json')), 'refused compile must not write settings');
    assert.ok(!fs.existsSync(path.join(root, 'hooks/.compiled.env')), 'refused compile must not write compiled policy either');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('exporter refuses to freeze a policy source carrying plugin-managed lifecycle scripts', async () => {
  const root = makeFixture();
  try {
    fs.writeFileSync(
      path.join(root, 'hooks.yaml'),
      FIXTURE_DENY_POLICY.concat(['  - id: ponytail-context', '    hook: SessionStart', '    action: run', '    script: "$CLAUDE_PLUGIN_ROOT"/hooks/ponytail-session.sh']).join('\n') + '\n',
    );
    await assert.rejects(
      () => exporter.exportRelease(root, path.join(root, 'foundation'), { releaseCommit: FIXED_COMMIT }),
      (err) => /plugin|CLAUDE_PLUGIN_ROOT|注册分工/i.test(String(err && err.message)),
    );
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
  // The old baseline must stay resolvable from history: give the fixture a
  // real commit BEFORE the drift, so migration can prove what it preserves.
  const git = (args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git(['init', '-q']);
  git(['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture', 'add', '-A']);
  git(['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture', 'commit', '-qm', 'fixture baseline']);
  const fixtureCommit = git(['rev-parse', 'HEAD']).stdout.trim();
  assert.match(fixtureCommit, /^[0-9a-f]{40}$/);
  try {
    const { lock: lock1 } = await exporter.exportRelease(root, path.join(root, 'foundation-a'), { releaseCommit: fixtureCommit });
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
