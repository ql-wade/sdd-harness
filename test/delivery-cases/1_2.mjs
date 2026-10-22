// P1_2 delivery case: the foundation distribution pipeline must export a
// contract-valid FoundationLock from the unique sources only (F01), compose
// bootstrap/init in both orders over isolated temp configs without losing
// user entries or duplicating the Guard (F02), and pin old runs to their
// frozen baseline with explicit migration instead of silent re-baselining
// (F04) while refusing a second writer on an active run (B09). Every
// settings-mutating step runs against SDD_TARGET_ROOT fixtures in $TMPDIR;
// live repo .claude/settings.json is only read (byte-compared), never written.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const exporterPath = path.join(projectRoot, 'tools', 'foundation-export.mjs');
const bootstrapPath = path.join(projectRoot, 'tools', 'bootstrap.sh');
const repoSettingsPath = path.join(projectRoot, '.claude', 'settings.json');

const { parseContract } = await import(path.join(projectRoot, 'contracts/delivery/index.js'));

const hasPython3 = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;
const bootstrapSrc = fs.existsSync(bootstrapPath) ? fs.readFileSync(bootstrapPath, 'utf8') : '';
const supportsTargetMode = bootstrapSrc.includes('SDD_TARGET_ROOT');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

// Minimal non-git fixture root for CLI-level flows.
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-12case-'));
  fs.mkdirSync(path.join(root, '.agents/skills/alpha'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents/skills/alpha/SKILL.md'), '# alpha v1\n');
  fs.writeFileSync(
    path.join(root, 'hooks.yaml'),
    ['policies:', '  - id: dangerous-command-blocklist', '    hook: PreToolUse', '    matcher: Bash', '    action: deny', '    patterns:', '      - "denied-vector"', '    message: "blocked"'].join('\n') + '\n',
  );
  writeJson(path.join(root, '.mcp.json'), { mcpServers: { probe: { command: 'npx', args: ['-y', 'probe-mcp@1.0.0'] } } });
  writeJson(path.join(root, 'package.json'), { name: 'case-fixture', version: '1.0.0' });
  writeJson(path.join(root, 'integrations/comet/upstream.lock.json'), {
    schemaVersion: 1,
    package: { name: '@rpamis/comet', version: '0.4.5' },
    toolchain: { node: '20.0.0' },
  });
  writeJson(path.join(root, 'openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json'), {
    schema_version: 1,
    method_profile: { controller: 'case-profile' },
  });
  return root;
}

const FIXED_COMMIT = 'b'.repeat(40);

function runExporter(args, env = {}) {
  return spawnSync('node', [exporterPath, ...args], { cwd: projectRoot, encoding: 'utf8', env: { ...process.env, ...env } });
}

test('CLI export produces a contract-valid lock and verify accepts it (real repo)', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-12out-'));
  try {
    const run = runExporter(['export', '--root', projectRoot, '--out', out]);
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const lock = JSON.parse(fs.readFileSync(path.join(out, 'foundation-lock.json'), 'utf8'));
    const parsed = parseContract('SDD.Delivery.FoundationLock', lock);
    assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));

    const verify = runExporter(['verify', '--root', projectRoot, '--lock', path.join(out, 'foundation-lock.json')]);
    assert.equal(verify.status, 0, verify.stderr || verify.stdout);

    // Repeat pull: identical bytes.
    const out2 = path.join(out, 'again');
    const run2 = runExporter(['export', '--root', projectRoot, '--out', out2]);
    assert.equal(run2.status, 0, run2.stderr || run2.stdout);
    assert.equal(
      fs.readFileSync(path.join(out2, 'foundation-lock.json'), 'utf8'),
      fs.readFileSync(path.join(out, 'foundation-lock.json'), 'utf8'),
      'CLI repeat pull must be byte-identical',
    );
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('V_F04: CLI verify fails on drifted assets and check-run blocks an active run (explicit migration path)', () => {
  const root = makeFixture();
  const out = path.join(root, 'foundation');
  try {
    const run = runExporter(['export', '--root', root, '--out', out, '--release-commit', FIXED_COMMIT]);
    assert.equal(run.status, 0, run.stderr || run.stdout);

    const runDir = path.join(root, 'run');
    fs.mkdirSync(runDir, { recursive: true });
    fs.copyFileSync(path.join(out, 'foundation-lock.json'), path.join(runDir, 'foundation-lock.json'));
    writeJson(path.join(runDir, 'run-state.json'), { schemaVersion: 1, runId: 'run-case', status: 'active', owner: 'alice' });

    // Drift the skill body after the run pinned its baseline.
    fs.writeFileSync(path.join(root, '.agents/skills/alpha/SKILL.md'), '# alpha v2\n');

    const verify = runExporter(['verify', '--root', root, '--lock', path.join(out, 'foundation-lock.json')]);
    assert.notEqual(verify.status, 0, 'verify must fail on drift');
    assert.match(verify.stderr + verify.stdout, /alpha/, 'drift report must name the drifted asset');

    const blocked = runExporter(['check-run', '--run-dir', runDir, '--root', root]);
    assert.notEqual(blocked.status, 0, 'active run must not silently re-baseline');
    assert.match(blocked.stderr + blocked.stdout, /--migrate|new run/i, 'block must print the explicit migration path');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI check-run refuses a second writer on an active run (B09) and allows the owner', () => {
  const lockPath = path.join(projectRoot, 'foundation', 'foundation-lock.json');
  assert.ok(fs.existsSync(lockPath), 'committed foundation lock must exist');
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-12run-'));
  try {
    fs.copyFileSync(lockPath, path.join(runDir, 'foundation-lock.json'));
    writeJson(path.join(runDir, 'run-state.json'), { schemaVersion: 1, runId: 'run-b09', status: 'active', owner: 'alice' });

    const refused = runExporter(['check-run', '--run-dir', runDir, '--root', projectRoot, '--acquire', '--owner', 'bob']);
    assert.notEqual(refused.status, 0, 'second writer refused');
    assert.match(refused.stderr + refused.stdout, /second-writer-refused|owner alice/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8')).owner, 'alice');

    const owner = runExporter(['check-run', '--run-dir', runDir, '--root', projectRoot, '--acquire', '--owner', 'alice']);
    assert.equal(owner.status, 0, owner.stderr || owner.stdout);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

function bootstrapTarget(root) {
  return spawnSync('bash', [bootstrapPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, SDD_TARGET_ROOT: root },
  });
}

function bootstrapTargetUninstall(root) {
  return spawnSync('bash', [bootstrapPath, '--uninstall'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, SDD_TARGET_ROOT: root },
  });
}

function caseComposition(name, fn) {
  test(name, { skip: !hasPython3 && 'python3 unavailable' }, () => {
    // RED guard: without target mode the flow could only be exercised by
    // writing the live repo config, which this task forbids — fail, not skip.
    assert.ok(supportsTargetMode, 'RED: bootstrap.sh lacks SDD_TARGET_ROOT target mode — composition flows cannot run isolated');
    fn();
  });
}

caseComposition('V_F02: forward then reverse composition: init, user edit, re-pull, uninstall, re-init', () => {
  const root = makeFixture();
  try {
    const repoSettingsBefore = fs.existsSync(repoSettingsPath) ? fs.readFileSync(repoSettingsPath, 'utf8') : null;

    // Forward: empty target init (adapter + foundation pull composed).
    assert.equal(bootstrapTarget(root).status, 0, 'forward init');
    assert.ok(fs.existsSync(path.join(root, 'foundation/foundation-lock.json')));
    assert.ok(fs.existsSync(path.join(root, '.claude/settings.json')));

    // Reverse: user config lands after init, then bootstrap re-runs.
    const settingsPath = path.join(root, '.claude/settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    settings.permissions = { allow: ['Bash(echo user-keep)'] };
    settings.hooks.SessionStart.push({ matcher: 'startup', hooks: [{ type: 'command', command: 'echo user-case-hook' }] });
    writeJson(settingsPath, settings);

    assert.equal(bootstrapTarget(root).status, 0, 're-pull with user config present');
    const afterPull = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(afterPull.permissions.allow[0], 'Bash(echo user-keep)', 'user permissions survive');
    assert.ok(JSON.stringify(afterPull.hooks).includes('user-case-hook'), 'user hook survives');

    // Uninstall: managed entries gone, user entries kept, still valid JSON.
    assert.equal(bootstrapTargetUninstall(root).status, 0, 'uninstall');
    const afterUninstall = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(!JSON.stringify(afterUninstall.hooks ?? {}).includes('pre-tool-gate'), 'managed gate removed');
    assert.ok(JSON.stringify(afterUninstall.hooks).includes('user-case-hook'), 'user hook kept through uninstall');
    assert.equal(afterUninstall.permissions.allow[0], 'Bash(echo user-keep)');

    // Re-init restores the managed block.
    assert.equal(bootstrapTarget(root).status, 0, 're-init');
    const restored = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(JSON.stringify(restored.hooks).includes('pre-tool-gate'), 'managed gate restored');
    assert.ok(JSON.stringify(restored.hooks).includes('user-case-hook'), 'user hook still present');

    // The repo live config was never part of any of this.
    const repoSettingsAfter = fs.existsSync(repoSettingsPath) ? fs.readFileSync(repoSettingsPath, 'utf8') : null;
    assert.equal(repoSettingsAfter, repoSettingsBefore, 'repo .claude/settings.json untouched');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// V_P1_2_PLUGIN_REGISTRATION_DIVISION (§7.2/§7.3): plugin lifecycle hooks
// belong to the plugin entry; bootstrap composes the project managed block
// without absorbing, deduplicating or removing them, and refuses duplicate
// same event/command registrations with an explicit conflict list.
const PLUGIN_SESSION_COMMAND = '"$CLAUDE_PLUGIN_ROOT"/hooks/session-context.sh';
const PLUGIN_PROMPT_COMMAND = '"$CLAUDE_PLUGIN_ROOT"/dist/ponytail-prompt.js';
const hooksText = (settings) => JSON.stringify(settings.hooks ?? {}).replaceAll(String.fromCharCode(92), '');

caseComposition('plugin registration division: plugin lifecycle hooks survive bootstrap init, re-pull and uninstall untouched', () => {
  const root = makeFixture();
  try {
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    const settingsPath = path.join(root, '.claude/settings.json');
    writeJson(settingsPath, {
      permissions: { allow: ['Bash(echo user-keep)'] },
      hooks: {
        SessionStart: [
          { matcher: 'startup|resume', hooks: [{ type: 'command', command: PLUGIN_SESSION_COMMAND }] },
          { matcher: 'startup', hooks: [{ type: 'command', command: 'echo user-case-hook' }] },
        ],
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: PLUGIN_PROMPT_COMMAND }] }],
      },
    });

    assert.equal(bootstrapTarget(root).status, 0, 'forward init with plugin entries present');
    let after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const pluginPresent = (s) => hooksText(s).includes(PLUGIN_SESSION_COMMAND) && hooksText(s).includes(PLUGIN_PROMPT_COMMAND);
    assert.ok(pluginPresent(after), 'plugin entries survive init');
    assert.equal(hooksText(after).split(PLUGIN_SESSION_COMMAND).length - 1, 1, 'plugin session entry present exactly once');

    assert.equal(bootstrapTarget(root).status, 0, 're-pull');
    after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(pluginPresent(after), 'plugin entries survive re-pull (no managed dedup participation)');
    assert.equal(hooksText(after).split(PLUGIN_SESSION_COMMAND).length - 1, 1, 'plugin session entry still exactly once');

    assert.equal(bootstrapTargetUninstall(root).status, 0, 'uninstall');
    after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(pluginPresent(after), 'uninstall removes project managed entries only');
    assert.ok(!JSON.stringify(after.hooks ?? {}).includes('hooks/pre-tool-gate'), 'project gate removed');
    assert.ok(JSON.stringify(after.hooks).includes('user-case-hook'), 'user hook kept');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

caseComposition('duplicate same event/command registration (plugin entry wrapping the managed command) is refused via bootstrap with a conflict list', () => {
  const root = makeFixture();
  try {
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    const settingsPath = path.join(root, '.claude/settings.json');
    const before = {
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: '"$CLAUDE_PLUGIN_ROOT"/bin/wrap "$CLAUDE_PROJECT_DIR"/hooks/pre-tool-gate.sh' }] },
        ],
      },
    };
    const original = JSON.stringify(before, null, 2) + '\n';
    fs.writeFileSync(settingsPath, original);

    const run = bootstrapTarget(root);
    assert.notEqual(run.status, 0, 'bootstrap must refuse the duplicate registration');
    assert.match(run.stderr + run.stdout, /重复注册|duplicate/i, 'refusal must name the duplicate registration');
    assert.match(run.stderr + run.stdout, /pre-tool-gate/, 'conflict list must name the command');
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), original, 'refused bootstrap must not touch settings.json');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

caseComposition('V_F02: repeat pull idempotency: repeated bootstrap keeps lock bytes and entry counts stable', () => {
  const root = makeFixture();
  try {
    assert.equal(bootstrapTarget(root).status, 0);
    const settingsPath = path.join(root, '.claude/settings.json');
    const lockPath = path.join(root, 'foundation/foundation-lock.json');
    const lock1 = fs.readFileSync(lockPath, 'utf8');
    const countManaged = (s) => JSON.stringify(s.hooks.PreToolUse ?? []).split('pre-tool-gate').length - 1;

    for (let i = 0; i < 3; i += 1) {
      assert.equal(bootstrapTarget(root).status, 0, 'pull ' + (i + 1));
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      assert.equal(countManaged(settings), 1, 'exactly one Guard reference after pull ' + (i + 1));
      assert.equal(fs.readFileSync(lockPath, 'utf8'), lock1, 'lock bytes stable across pulls');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
