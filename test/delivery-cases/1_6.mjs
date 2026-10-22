// P1_6 delivery case: the Matt method profile must replace Superpowers as the
// explicit method layer (M01: a globally disabled method is not resurrected;
// M02: no nested planner/implement-spec controller identities) with pinned
// snapshots and a Comet Classic init patch that can no longer select or
// install obra/superpowers. Behavioral probes run the integrated build with an
// isolated HOME and PATH stubs, so live host configuration is never touched.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const changeDir = path.join(projectRoot, 'openspec/changes/delivery-foundation-rearchitecture');
const evidenceDir = path.join(changeDir, 'worker-reports/P1_6/evidence');

const lock = JSON.parse(await fs.readFile(path.join(projectRoot, 'integrations/comet/upstream.lock.json'), 'utf8'));
const manifest = JSON.parse(await fs.readFile(path.join(changeDir, 'method-profile-manifest.json'), 'utf8'));

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

async function skillDigest(name) {
  const root = path.join(projectRoot, '.agents/skills', name);
  const files = {};
  const lines = [];
  async function walk(dir, prefix = '') {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relative);
      } else if (entry.isFile()) {
        const digest = sha256(await fs.readFile(path.join(dir, entry.name)));
        files[`${name}/${relative}`] = digest;
        lines.push(`${digest}  ${name}/${relative}`);
      }
    }
  }
  await walk(root);
  return { files, aggregate: sha256(lines.sort().join('\n')) };
}

// Scenario anchors (P3_1 acceptor repair, grill P1-04): the journey runner
// maps each registered scenario id (M01/M02/B01/B09 in
// verification-case-plan.json) to executed test points by word-boundary token
// in the test name, so a green module with no mapped point is a structured
// refusal, never a scenario pass. The four anchored tests below keep the
// module's assertions attributable to their acceptance ids at the layer this
// case owns (frozen method assets + the Comet init patch).
const hasPython3 = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;

// Executable probe for the planner data-contract entry: plan_guard.py is a
// pure validator (single JSON verdict line, exit 0/1/2, no file writes), so
// planner-only reuse through the vendored tool entry is observable without
// any dispatch or run-state surface.
async function runPlanGuardFixture() {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'p1-6-anchor-'));
  const planText = [
    '# Implementation Plan',
    '',
    '**Goal:** anchor fixture exercises the planner data-contract tool entry only.',
    '',
    '**Architecture:** one plan artifact inside an isolated scratch directory.',
    '',
    '**Tech Stack:** plain markdown plan artifact.',
    '',
    '## Global Constraints',
    '',
    '- The planner entry validates the plan artifact; it never dispatches, monitors or mutates run state.',
    '',
    '### Task T1: anchor fixture task',
    '**Files:** fixture-plan.md',
    '**Interfaces:** none',
    '**Dependencies:** none',
    '**Owns:** fixture-plan.md',
    '**Parallel safe:** true',
    '**Acceptance IDs:** B01',
    '',
    '- [ ] **Step 1 [3 min]: Commit the anchor fixture plan',
    '',
  ].join('\n');
  await fs.writeFile(path.join(scratch, 'fixture-plan.md'), planText);
  const before = (await fs.readdir(scratch)).sort();
  const result = spawnSync('python3', [
    path.join(projectRoot, '.agents/skills/claude-parallel-tdd-planner/scripts/plan_guard.py'),
    '--plan', path.join(scratch, 'fixture-plan.md'),
  ], { encoding: 'utf8', timeout: 30000 });
  const after = (await fs.readdir(scratch)).sort();
  return { scratch, result, before, after };
}

test('method profile fixes one Comet Classic controller with Matt primitives and no nested controller', () => {
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.status, 'ACTIVE');
  const profile = manifest.method_profile;
  assert.equal(profile.controller, 'comet-classic');
  assert.equal(profile.implementation_method, 'matt-primitives');
  assert.equal(profile.spec_source, 'openspec');
  assert.equal(profile.second_controller, 'none');
  assert.ok(Array.isArray(profile.nested_controller_forbidden) && profile.nested_controller_forbidden.length >= 2);
  assert.match(profile.nested_controller_forbidden.join(' '), /claude-parallel-tdd-planner/);
  assert.match(profile.nested_controller_forbidden.join(' '), /implement-spec/);
  assert.match(profile.superpowers.init_install_path, /0001-matt-method-profile\.patch/);
  assert.equal(manifest.method_export_entry.shared_new_version_wholesale_import, 'forbidden');
  assert.match(manifest.method_export_entry.old_plan_guard_negative_preserved, /superpowers/);
});

test('snapshot manifest pins real directories byte-for-byte with sources and no symlinks', async () => {
  const required = ['tdd', 'diagnosing-bugs', 'code-review', 'test-authoring', 'whitebox-verify', 'openspec-lifecycle-guard', 'grill-me', 'grilling', 'multi-agent-consensus-review', 'claude-parallel-tdd-planner', 'ponytail'];
  const names = manifest.snapshots.map((snapshot) => snapshot.name);
  for (const name of required) assert.ok(names.includes(name), `snapshot missing: ${name}`);
  for (const snapshot of manifest.snapshots) {
    assert.ok(snapshot.source_path && snapshot.source_path.length > 0, `${snapshot.name} has no source`);
    assert.match(snapshot.content_sha256, /^[a-f0-9]{64}$/);
    const actual = await skillDigest(snapshot.name);
    assert.equal(actual.aggregate, snapshot.content_sha256, `${snapshot.name} content drifted from the manifest`);
    assert.equal(Object.keys(actual.files).length, snapshot.file_count, `${snapshot.name} file count drifted`);
    for (const [relative, digest] of Object.entries(snapshot.files)) {
      assert.equal(actual.files[relative], digest, `${snapshot.name}/${relative} drifted from the manifest`);
    }
  }
  const links = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) links.push(full);
      else if (entry.isDirectory()) await walk(full);
    }
  }
  await walk(path.join(projectRoot, '.agents/skills'));
  assert.deepEqual(links, [], 'vendored skills must be real directories, not symlinks');
});

test('RED cases are eliminated: no Superpowers hard calls in the snapshot layer and evidence is kept', async () => {
  async function collect(dir, out = []) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await collect(full, out);
      else if (entry.isFile()) out.push(full);
    }
    return out;
  }
  const files = await collect(path.join(projectRoot, '.agents/skills'));
  // Dependency forms are forbidden: plugin-style invocations ('superpowers:...'),
  // the installer invocation source, and the old required-sub-skill header.
  // In markdown, github.com/obra/superpowers links stay allowed: the briefing
  // keeps method-source links as attribution references, not runtime
  // dependencies (same for negative declarations like 'Superpowers is not an
  // installation or execution dependency').
  const dependencyPatterns = (file) => file.endsWith('.md')
    ? [/superpowers:\w/i, /REQUIRED SUB-SKILL: Use superpowers/i]
    : [/superpowers:\w/i, /obra\/superpowers/, /REQUIRED SUB-SKILL: Use superpowers/i];
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    for (const pattern of dependencyPatterns(file)) {
      assert.ok(!pattern.test(text), `Superpowers dependency form survived in ${file}: ${pattern}`);
    }
  }
  const requiredFrontmatter = ['grill-me', 'grilling', 'whitebox-verify', 'claude-parallel-tdd-planner', 'multi-agent-consensus-review'];
  for (const name of requiredFrontmatter) {
    const head = await fs.readFile(path.join(projectRoot, '.agents/skills', name, 'SKILL.md'), 'utf8');
    assert.match(head.split('\n').slice(0, 10).join('\n'), /^name:/m, `${name} lost its frontmatter name`);
    assert.match(head.split('\n').slice(0, 10).join('\n'), /^description:/m, `${name} lost its frontmatter description`);
  }
  for (const evidence of ['red-1-vendored-planner-superpowers.txt', 'red-2-comet-init-superpowers-install.txt', 'red-3-method-profile-absent.txt']) {
    await fs.access(path.join(evidenceDir, evidence));
  }
  const red2 = await fs.readFile(path.join(evidenceDir, 'red-2-comet-init-superpowers-install.txt'), 'utf8');
  assert.match(red2, /skills add obra\/superpowers/, 'RED-2 evidence must record the pristine install invocation');
});

test('Ponytail supplement: snapshot fixed from the plugin cache and registration/default declarations recorded', async () => {
  const ponytail = manifest.snapshots.find((snapshot) => snapshot.name === 'ponytail');
  assert.ok(ponytail, 'ponytail snapshot entry missing from the manifest');
  assert.equal(ponytail.source_form, 'codex-plugin-cache');
  assert.equal(ponytail.upstream_version, '5.3.2');
  assert.match(ponytail.source_path, /\.codex\/plugins\/cache\/ponytail\/ponytail\/5\.3\.2/);
  assert.match(ponytail.purpose, /V_P1_6_PONYTAIL_ASSETS|supplement_delta/);
  assert.ok(ponytail.file_count >= 30, 'ponytail selection should carry method skills, rules, hooks and commands');
  const skill = await fs.readFile(path.join(projectRoot, '.agents/skills/ponytail/skills/ponytail/SKILL.md'), 'utf8');
  assert.match(skill, /^name: ponytail/m);
  const rules = await fs.readFile(path.join(projectRoot, '.agents/skills/ponytail/.agents/rules/ponytail.md'), 'utf8');
  assert.ok(rules.trim().length > 0);

  const division = manifest.hook_registration_division;
  assert.ok(division, 'hook registration division declaration missing');
  assert.match(division.plugin_lifecycle_hooks, /Ponytail 插件入口/);
  assert.match(division.project_rules_and_recovery_prompts, /hooks\.yaml/);
  assert.match(division.cc_adapter_scope, /PreToolUse/);
  assert.match(division.cc_adapter_scope, /SessionStart/);
  assert.match(division.no_cross_copying, /不互相复制/);
  assert.match(division.no_cross_copying, /不依赖/);

  const isolation = manifest.method_default_and_isolation;
  assert.ok(isolation, 'method default and isolation declaration missing');
  assert.equal(isolation.managed_profile_default, 'full');
  assert.match(isolation.user_toggle_scope, /方法上下文/);
  assert.match(isolation.user_toggle_scope, /Gate/);
  assert.match(isolation.isolation_limitation, /最后写入生效/);
  assert.match(isolation.isolation_limitation, /不得承诺并发角色级不同模式/);
});

test('patches are sha256-pinned in the source lock and scoped to their declared files', async () => {
  // lock revision: 6 patches @ beab355d (P2_4 0002 + P4_6 0003 + tests); the two
  // entries below still pin 0001/tests-1_6 scoping at their indexes
  assert.ok(Array.isArray(lock.patches) && lock.patches.length === 6);
  const expected = [
    { path: 'integrations/comet/patches/0001-matt-method-profile.patch', file: 'app/commands/init.ts' },
    { path: 'integrations/comet/patches/tests/1_6.patch', file: 'test/app/init-e2e.test.ts' },
  ];
  for (const [index, want] of expected.entries()) {
    const entry = lock.patches[index];
    assert.equal(entry.path, want.path);
    const bytes = await fs.readFile(path.join(projectRoot, entry.path));
    assert.equal(sha256(bytes), entry.sha256, `${entry.path} drifted from its lock pin`);
    const text = bytes.toString();
    const touched = [...text.matchAll(/^diff --git a\/(\S+) b\/\S+$/gm)].map((match) => match[1]);
    assert.deepEqual(touched, [want.file], `${entry.path} must touch only ${want.file}`);
  }
  const patch = await fs.readFile(path.join(projectRoot, 'integrations/comet/patches/0001-matt-method-profile.patch'), 'utf8');
  assert.match(patch, /-  const superpowersInstalled/);
  assert.match(patch, /\+.*Matt method profile/);
  assert.ok(!/^\+.*obra/.test(patch), 'the patch must not add new obra references');
});

test('patched build proves the method profile: init cannot install Superpowers and ships no nested controller identities', async (t) => {
  const commit = lock.source.commit;
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    archive: lock.source.sha256,
    patches: lock.patches.map(({ path, sha256 }) => ({ path, sha256 })),
    toolchain: lock.toolchain,
  })).digest('hex');
  const buildDir = path.join(projectRoot, '.sdd/vendor/comet', commit, 'builds', fingerprint);
  const entrypoint = path.join(buildDir, 'work/bin/comet.js');
  const built = await fs.access(path.join(buildDir, 'distribution.json')).then(() => true, () => false);
  const prepared = await fs.access(path.join(projectRoot, '.sdd/vendor/comet', commit, 'provenance.json')).then(() => true, () => false);
  if (!prepared || !built) {
    t.skip('patched Comet build is not present in this project; run tools/comet/build.mjs --archive first');
    return;
  }

  // M02 on the built runtime surface: no planner/implement-spec dispatch identities.
  async function collect(dir, out = []) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await collect(full, out);
      else if (entry.isFile()) out.push(full);
    }
    return out;
  }
  for (const surface of ['dist', 'assets', 'bin']) {
    const files = await collect(path.join(buildDir, 'work', surface));
    for (const file of files) {
      const text = await fs.readFile(file, 'utf8').catch(() => '');
      assert.ok(!text.includes('claude-parallel-tdd-planner'), `nested planner identity in built ${surface}: ${file}`);
      assert.ok(!text.includes('implement-spec'), `implement-spec identity in built ${surface}: ${file}`);
    }
  }

  // M01 behaviorally: on a clean isolated HOME the patched init must not
  // invoke the Superpowers skills installer at all.
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'p1-6-green-'));
  const fakeHome = path.join(scratch, 'home');
  const stubs = path.join(scratch, 'stubs');
  const project = path.join(scratch, 'project');
  const stubLog = path.join(scratch, 'stub-calls.log');
  await fs.mkdir(fakeHome, { recursive: true });
  await fs.mkdir(project, { recursive: true });
  await fs.mkdir(stubs, { recursive: true });
  const writeStub = async (name, body) => {
    const file = path.join(stubs, name);
    await fs.writeFile(file, body, { mode: 0o755 });
  };
  const logger = '#!/bin/sh\necho \"$0 $@\" >> \"$P16_STUB_LOG\"\nexit 0\n';
  await writeStub('npx', logger);
  await writeStub('npm', logger);
  await writeStub('openspec', '#!/bin/sh\necho \"1.11.0\"\n');
  const pinnedNode = lock.toolchain.node;
  let nodeExecutable = process.execPath;
  if (process.versions.node !== pinnedNode) {
    const candidate = path.join(process.env.HOME ?? '', '.nvm/versions/node', `v${pinnedNode}`, 'bin/node');
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout.trim() === `v${pinnedNode}`) nodeExecutable = candidate;
  }
  const result = spawnSync(nodeExecutable, [entrypoint, 'init', project, '--yes', '--scope', 'project', '--workflow', 'classic', '--platform', 'claude', '--codegraph', 'skip', '--language', 'en'], {
    cwd: scratch,
    encoding: 'utf8',
    timeout: 180000,
    env: { ...process.env, HOME: fakeHome, P16_STUB_LOG: stubLog, PATH: `${stubs}:${process.env.PATH ?? ''}` },
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const calls = await fs.readFile(stubLog, 'utf8').catch(() => '');
  assert.ok(!calls.includes('obra/superpowers'), `patched init still invokes the Superpowers installer: ${calls}`);
  assert.ok(!/Installing Superpowers/.test(output), `patched init still announces a Superpowers install: ${output}`);
  assert.match(output, /Superpowers install skipped by user/, `patched init must take the explicit skip branch (pristine would print 'all skipped' or install): ${output}`);
  await fs.rm(scratch, { recursive: true, force: true });
});

test('V_M01: Superpowers stays disabled through Classic init and method load; the pre-pinned Matt method is what actually ships', async () => {
  const sp = manifest.method_profile.superpowers;
  assert.match(sp.status, /globally disabled/);
  assert.match(sp.status, /not an installation or execution dependency/);
  assert.match(sp.init_install_path, /removed/);
  assert.match(sp.init_install_path, /0001-matt-method-profile\.patch/);
  // Compatibility directory names and attribution links stay non-runtime.
  assert.match(sp.legacy_layout_paths, /compatibility artifact/);
  assert.match(sp.legacy_layout_paths, /no permission to execute/i);
  assert.match(sp.attribution_links, /attribution references, not runtime dependencies/i);

  // The frozen patch removes both the pristine selection state and the
  // superpowers npm-dep entry from Comet init, so neither the --yes fast
  // path nor the interactive checklist can select or install it.
  const patch = await fs.readFile(path.join(projectRoot, 'integrations/comet/patches/0001-matt-method-profile.patch'), 'utf8');
  assert.match(patch, /-  const superpowersInstalled = spPlatformIds\.length === 0 \? true : undefined;/);
  assert.match(patch, /-\s+\{ id: 'superpowers' as const, installed: Boolean\(superpowersInstalled\) \},/);
  assert.match(patch, /never select,\n\+  \/\/ install or re-enable obra\/superpowers from init/);

  // The method actually in force is the byte-pinned Matt base method.
  assert.equal(manifest.method_profile.implementation_method, 'matt-primitives');
  for (const name of ['tdd', 'diagnosing-bugs', 'code-review']) {
    assert.match(manifest.method_profile.implementation_method_detail, new RegExp(`\\b${name}\\b`));
    const pinned = manifest.snapshots.find((snapshot) => snapshot.name === name);
    assert.ok(pinned, `matt method snapshot missing: ${name}`);
    const actual = await skillDigest(name);
    assert.equal(actual.aggregate, pinned.content_sha256, `${name} drifted from the pinned method profile`);
  }
});

test('V_M02: one Comet authority; planner reuse only through its compatible tool entry, controller contract never activated', { skip: !hasPython3 && 'python3 unavailable — the planner tool entry cannot execute' }, async () => {
  const profile = manifest.method_profile;
  assert.equal(profile.controller, 'comet-classic');
  assert.equal(profile.second_controller, 'none');
  assert.match(profile.plan_source, /one canonical plan/);
  assert.match(profile.plan_source, /no second plan root/);
  assert.match(profile.progress_source, /one progress source/);
  assert.match(profile.progress_source, /no second progress ledger/);
  const forbidden = profile.nested_controller_forbidden.join(' ');
  assert.match(forbidden, /claude-parallel-tdd-planner/);
  assert.match(forbidden, /implement-spec/);

  // The planner snapshot is demoted to data contract + validation tools in
  // both the manifest and the skill architecture page; wholesale import of
  // the shared-source controller stays forbidden.
  assert.equal(manifest.method_export_entry.shared_new_version_wholesale_import, 'forbidden');
  assert.match(manifest.method_export_entry.decision, /only the data contract and validation tools/);
  const architecture = await fs.readFile(path.join(projectRoot, 'docs/agent/skill-architecture.md'), 'utf8');
  assert.match(architecture, /数据契约\/校验工具/);
  assert.match(architecture, /不作为第二 controller 激活/);

  // Test design and independent acceptance stay separate method roles, not
  // nested controllers.
  const authority = profile.acceptance_authority.join(' ');
  assert.match(authority, /whitebox-verify/);
  assert.match(authority, /test-authoring/);

  // Reuse really goes through the explicitly compatible tool entry: the
  // vendored plan validator accepts a valid plan artifact via its CLI.
  const { scratch, result } = await runPlanGuardFixture();
  assert.equal(result.status, 0, `plan_guard tool entry failed: ${result.stderr}`);
  assert.equal(JSON.parse(result.stdout).valid, true);
  await fs.rm(scratch, { recursive: true, force: true });
});

test('V_B01: a planner-only request yields plan-artifact validation only — no dispatch, monitoring or run-state mutation', { skip: !hasPython3 && 'python3 unavailable — the planner tool entry cannot execute' }, async () => {
  // Planning-only reuse of the method layer goes through the plan validator;
  // executing it must produce exactly one verdict and nothing else.
  const { scratch, before, after, result } = await runPlanGuardFixture();
  assert.equal(result.status, 0, `plan_guard tool entry failed: ${result.stderr}`);
  assert.equal(result.stdout.trim().split('\n').length, 1, 'the tool entry must emit a single verdict line');
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.valid, true);
  assert.equal(verdict.handoff_ready, false, 'text-only validation is a verdict, not a dispatch or handoff');
  assert.deepEqual(after, before, 'executing the planner entry must not create dispatch, monitoring or state files');

  // The method profile adopts the planner's planning surface only as a data
  // contract; there is no plan-execution surface to reach from this layer.
  assert.match(manifest.method_export_entry.decision, /only the data contract and validation tools/);
  assert.match(manifest.method_profile.plan_source, /no second plan root/);
  await fs.rm(scratch, { recursive: true, force: true });
});

test('V_B09: the method layer cannot field a second controller writer against the single Comet run authority', async () => {
  const profile = manifest.method_profile;
  assert.equal(profile.second_controller, 'none');
  assert.match(profile.progress_source, /one progress source: the single Comet Run state/);
  assert.match(profile.progress_source, /no second progress ledger/);

  // The control plane wires no second controller: hooks.yaml carries no
  // planner/implement-spec/Superpowers registration the method layer could
  // ride into a run.
  const hooks = await fs.readFile(path.join(projectRoot, 'hooks.yaml'), 'utf8');
  for (const identity of ['claude-parallel-tdd-planner', 'implement-spec', 'superpowers', 'Superpowers']) {
    assert.ok(!hooks.includes(identity), `hooks.yaml must not register a second controller surface: ${identity}`);
  }

  // The only Comet patch in this task's scope removes the Superpowers
  // resurrection path from init instead of adding any dispatch surface, and
  // the registered hook division keeps the three registration lines from
  // copying into each other.
  const patchEntry = manifest.comet_integration.patches.find((entry) => entry.path.endsWith('0001-matt-method-profile.patch'));
  assert.ok(patchEntry, '0001 patch entry missing from the manifest integration block');
  assert.match(patchEntry.role, /can no longer select or install Superpowers/);
  assert.match(manifest.hook_registration_division.no_cross_copying, /不互相复制/);
  assert.match(manifest.hook_registration_division.no_cross_copying, /不依赖/);
});
