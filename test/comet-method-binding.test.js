import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pythonEnvironment = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };

// A private checkout of the check entry tests failure propagation without running
// another copy of the product regression or touching a host configuration.
async function checkFixture(t, mutate = async () => {}) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'method-check-'));
  t.after(() => fs.rm(scratch, { recursive: true, force: true }));
  await fs.mkdir(path.join(scratch, 'scripts'));
  await fs.copyFile(path.join(root, 'scripts/check.sh'), path.join(scratch, 'scripts/check.sh'));
  for (const name of ['agent-instructions-check.sh', 'agent-skill-check.sh']) {
    await fs.writeFile(path.join(scratch, 'scripts', name), '#!/bin/bash\nset -euo pipefail\n');
  }
  const skill = path.join(scratch, '.agents/skills/whitebox-verify');
  await fs.cp(path.join(root, '.agents/skills/whitebox-verify'), skill, { recursive: true });
  const mcr = path.join(scratch, '.agents/skills/multi-agent-consensus-review/scripts');
  await fs.mkdir(mcr, { recursive: true });
  await fs.writeFile(path.join(mcr, 'test_review_gate.py'), 'print("not under test")\n');
  await fs.writeFile(path.join(scratch, '.mcp.json'), '{}\n');
  await fs.writeFile(path.join(scratch, 'package.json'), '{}\n');
  await mutate(skill);
  const result = spawnSync('bash', ['scripts/check.sh'], {
    cwd: scratch, env: pythonEnvironment, encoding: 'utf8', timeout: 90000,
  });
  assert.ifError(result.error);
  return { ...result, output: `${result.stdout}\n${result.stderr}` };
}

test('repository check runs the complete source-owned Whitebox corpus and invariants', async (t) => {
  const result = await checkFixture(t);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /SUMMARY: 15 ok \/ 0 fail/);
  assert.match(result.output, /INVARIANTS_ALL_PASS/);
  assert.match(result.output, /RUN_ALL_PASS/);
});

test('repository check refuses a missing required Whitebox selftest entry', async (t) => {
  const result = await checkFixture(t, (skill) => fs.rm(path.join(skill, 'tests/run_all.sh'), { force: true }));
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /whitebox-verify.*(missing|required|缺少)/i);
});

test('repository check propagates a real Whitebox fixture failure', async (t) => {
  const result = await checkFixture(t, (skill) => fs.writeFile(path.join(skill, 'tests/green-fixture/artifacts/wire.log'), 'deliberately corrupted fixture\n'));
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /(RUN_ALL_FAIL|green fixture failed)/);
});

const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = async (file) => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));

// Distribution is the public seam here: every retained source file, including
// log fixtures, must be pinned. This does not establish execution provenance.
test('method supplier pins complete real source directories and a single assets-packaged runtime-unqualified optional profile', async () => {
  const manifest = await readJson('openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json');
  const profile = await readJson('foundation/profiles/comet-managed.json');
  assert.equal(profile.id, 'comet-managed-v2');
  assert.equal(manifest.current_profile_id, profile.id);
  assert.equal(profile.qualification.status, 'ASSETS_PACKAGED');
  assert.notEqual(profile.qualification.status, 'QUALIFIED');
  assert.equal(profile.runtimeAccepted, false);
  assert.equal(profile.optional, true);
  assert.deepEqual(profile.nativePhases, ['open', 'design', 'build', 'verify', 'archive']);
  assert.equal(profile.controller, 'comet-classic');
  assert.equal(profile.authority.teamai, 'distribution-only');
  assert.equal(profile.failurePolicy.fallbackToRetiredMethods, false);
  assert.equal(manifest.snapshots.length, 11);
  for (const snapshot of manifest.snapshots) {
    const actual = {};
    async function walk(dir) {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        assert.equal(entry.isSymbolicLink(), false, full);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) actual[path.relative(path.join(root, '.agents/skills'), full).split(path.sep).join('/')] = await digest(await fs.readFile(full));
      }
    }
    await walk(path.join(root, snapshot.snapshot_path));
    assert.deepEqual(actual, snapshot.files, `${snapshot.name} source inventory drift`);
    const aggregate = await digest(Object.entries(actual).map(([p, sha]) => `${sha}  ${p}`).sort().join('\n'));
    assert.equal(aggregate, snapshot.content_sha256, snapshot.name);
    assert.equal(Object.keys(actual).length, snapshot.file_count, snapshot.name);
    assert.equal(profile.methods[snapshot.name].sha256, aggregate);
    assert.ok(snapshot.provenance);
  }
});

// ---- ADR-0022 application packaging (supply side of 0.5.0 composition) ----
// Retired method roster may not re-enter the packaged assets under any name.
const retiredNamePattern = /(superpowers|sdd-|trinity)/i;
const aggregateOf = (files) => digest(Object.entries(files).map(([p, sha]) => `${sha}  ${p}`).sort().join('\n'));

async function walkSkillAssets(dir) {
  const files = {};
  const issues = [];
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const rel = path.relative(dir, full).split(path.sep).join('/');
      if (retiredNamePattern.test(entry.name)) issues.push(`retired-method-name: ${rel}`);
      if (entry.isSymbolicLink()) { issues.push(`symlink-in-application-assets: ${rel}`); continue; }
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files[rel] = digest(await fs.readFile(full));
    }
  }
  await walk(dir);
  return { files, issues };
}

async function walkPlain(dir) {
  const { files } = await walkSkillAssets(dir);
  return files;
}

// Pure, data-driven supplier validation: the same code path runs against the
// real repository tree and against mutated synthetic fixtures.
async function collectApplicationPackagingIssues({ appManifest, skillsRoot, sourceRoot, methodManifest, profile, lock }) {
  const issues = [];
  const no = (code, detail) => issues.push(`${code}: ${detail}`);
  if (appManifest.kind !== 'comet-application-skill-assets') no('manifest-kind', String(appManifest.kind));
  if (appManifest.status !== 'ASSETS_PACKAGED') no('manifest-status', String(appManifest.status));
  if (appManifest.runtime_accepted !== false) no('manifest-runtime-accepted', String(appManifest.runtime_accepted));
  if (appManifest.basis?.upstream_commit !== lock.source.commit) no('upstream-commit-mismatch', `${appManifest.basis?.upstream_commit} != ${lock.source.commit}`);
  if (JSON.stringify(appManifest.basis?.upstream_patches ?? null) !== JSON.stringify(lock.patches)) no('upstream-patches-mismatch', 'manifest basis patches differ from upstream lock patches');
  if (appManifest.basis?.method_profile_manifest !== 'openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json') no('basis-method-profile-manifest', String(appManifest.basis?.method_profile_manifest));
  if (appManifest.basis?.foundation_profile !== 'foundation/profiles/comet-managed.json') no('basis-foundation-profile', String(appManifest.basis?.foundation_profile));
  if (profile.qualification.status !== 'ASSETS_PACKAGED') no('profile-qualification-status', String(profile.qualification.status));
  if (profile.runtimeAccepted !== false) no('profile-runtime-accepted', String(profile.runtimeAccepted));

  const entries = appManifest.skills ?? [];
  for (const entry of entries) if (retiredNamePattern.test(entry.name)) no('retired-method-name', `manifest skill entry ${entry.name}`);
  const manifestNames = entries.map((entry) => entry.name).sort();
  const snapshotNames = methodManifest.snapshots.map((snapshot) => snapshot.name).sort();
  const profileNames = Object.keys(profile.methods).sort();
  if (JSON.stringify(manifestNames) !== JSON.stringify(snapshotNames)) no('skill-set-mismatch', `manifest [${manifestNames}] != snapshots [${snapshotNames}]`);
  if (JSON.stringify(manifestNames) !== JSON.stringify(profileNames)) no('skill-set-mismatch', `manifest [${manifestNames}] != profile methods [${profileNames}]`);
  const actualDirs = (await fs.readdir(skillsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() || entry.isFile() || entry.isSymbolicLink())
    .map((entry) => entry.name).sort();
  if (retiredNamePattern.test(actualDirs.join(' '))) no('retired-method-name', `packaged directory roster ${actualDirs.join(', ')}`);
  if (JSON.stringify(actualDirs) !== JSON.stringify(manifestNames)) no('skill-set-mismatch', `packaged directories [${actualDirs}] != manifest [${manifestNames}]`);

  for (const entry of entries) {
    const packaged = path.join(skillsRoot, entry.name);
    const source = path.join(sourceRoot, entry.name);
    if (entry.source_path !== `.agents/skills/${entry.name}`) no('entry-source-path', `${entry.name}: ${entry.source_path}`);
    if (entry.packaged_path !== `integrations/comet/application/skills/${entry.name}`) no('entry-packaged-path', `${entry.name}: ${entry.packaged_path}`);
    if (entry.verbatim_copy !== true) no('entry-verbatim-copy', entry.name);
    let packagedFiles;
    try {
      const walked = await walkSkillAssets(packaged);
      packagedFiles = walked.files;
      issues.push(...walked.issues.map((issue) => `${issue} (${entry.name})`));
    } catch {
      no('skill-directory-missing', packaged);
      continue;
    }
    const snapshot = methodManifest.snapshots.find((candidate) => candidate.name === entry.name);
    const sourceFiles = await walkPlain(source);
    if (JSON.stringify(packagedFiles) !== JSON.stringify(sourceFiles)) no('packaged-source-mismatch', `${entry.name} packaged bytes/set differ from verbatim source`);
    // The declared digest basis uses skill-name-prefixed relative paths.
    const prefixed = Object.fromEntries(Object.entries(packagedFiles).map(([p, sha]) => [`${entry.name}/${p}`, sha]));
    const aggregate = aggregateOf(prefixed);
    if (aggregate !== entry.content_sha256) no('packaged-digest-drift', `${entry.name} ${aggregate} != ${entry.content_sha256}`);
    if (Object.keys(packagedFiles).length !== entry.file_count) no('packaged-file-count', `${entry.name} ${Object.keys(packagedFiles).length} != ${entry.file_count}`);
    if (snapshot && aggregate !== snapshot.content_sha256) no('cross-digest-mismatch', `${entry.name} != method-profile snapshot ${snapshot.content_sha256}`);
    if (profile.methods[entry.name] && aggregate !== profile.methods[entry.name].sha256) no('cross-digest-mismatch', `${entry.name} != profile method digest`);
  }
  return issues;
}

test('application packaging pins verbatim method assets for 0.5.0 composition with no retired names', async () => {
  const appManifest = await readJson('integrations/comet/application/manifest.json');
  const methodManifest = await readJson('openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json');
  const profile = await readJson('foundation/profiles/comet-managed.json');
  const lock = await readJson('integrations/comet/upstream.lock.json');
  const issues = await collectApplicationPackagingIssues({
    appManifest,
    skillsRoot: path.join(root, 'integrations/comet/application/skills'),
    sourceRoot: path.join(root, '.agents/skills'),
    methodManifest,
    profile,
    lock,
  });
  assert.deepEqual(issues, []);
});

// Minimal coherent synthetic world; the same validator that passes on the real
// tree must reject mutated fixtures (missing piece, hash drift, retired name).
async function packagingFixture(t, mutate) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'method-app-'));
  t.after(() => fs.rm(scratch, { recursive: true, force: true }));
  const sourceRoot = path.join(scratch, 'source');
  const skillsRoot = path.join(scratch, 'app', 'skills');
  await fs.mkdir(path.join(sourceRoot, 'alpha'), { recursive: true });
  await fs.mkdir(path.join(sourceRoot, 'beta'), { recursive: true });
  await fs.writeFile(path.join(sourceRoot, 'alpha/SKILL.md'), '# alpha method\n');
  await fs.writeFile(path.join(sourceRoot, 'beta/SKILL.md'), '# beta method\n');
  await fs.cp(path.join(sourceRoot, 'alpha'), path.join(skillsRoot, 'alpha'), { recursive: true });
  await fs.cp(path.join(sourceRoot, 'beta'), path.join(skillsRoot, 'beta'), { recursive: true });
  const filesOf = async (dir, name) => {
    const files = {};
    files['SKILL.md'] = digest(await fs.readFile(path.join(dir, name, 'SKILL.md')));
    return Object.fromEntries(Object.entries(files).map(([p, sha]) => [`${name}/${p}`, sha]));
  };
  const snapshots = [];
  const skills = [];
  const methods = {};
  for (const name of ['alpha', 'beta']) {
    const files = await filesOf(sourceRoot, name);
    const contentSha = aggregateOf(files);
    snapshots.push({ name, files, file_count: Object.keys(files).length, content_sha256: contentSha });
    skills.push({ name, source_path: `.agents/skills/${name}`, packaged_path: `integrations/comet/application/skills/${name}`, verbatim_copy: true, file_count: Object.keys(files).length, content_sha256: contentSha });
    methods[name] = { sha256: contentSha };
  }
  const lock = { source: { commit: 'c0mmit' }, patches: [] };
  const world = {
    sourceRoot, skillsRoot, lock,
    methodManifest: { snapshots },
    profile: { methods, qualification: { status: 'ASSETS_PACKAGED' }, runtimeAccepted: false },
    appManifest: {
      kind: 'comet-application-skill-assets', status: 'ASSETS_PACKAGED', runtime_accepted: false,
      basis: {
        upstream_commit: 'c0mmit', upstream_patches: [],
        method_profile_manifest: 'openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json',
        foundation_profile: 'foundation/profiles/comet-managed.json',
      },
      skills,
    },
  };
  await mutate(world);
  return collectApplicationPackagingIssues(world);
}

test('application packaging validation rejects a missing packaged asset', async (t) => {
  const issues = await packagingFixture(t, async (world) => {
    await fs.rm(path.join(world.skillsRoot, 'beta', 'SKILL.md'));
  });
  assert.ok(issues.some((issue) => issue.startsWith('packaged-source-mismatch:')), issues.join('\n'));
  assert.ok(issues.some((issue) => issue.startsWith('packaged-digest-drift:')), issues.join('\n'));
});

test('application packaging validation rejects hash drift in packaged bytes', async (t) => {
  const issues = await packagingFixture(t, async (world) => {
    await fs.writeFile(path.join(world.skillsRoot, 'alpha', 'SKILL.md'), '# alpha method (tampered)\n');
  });
  assert.ok(issues.some((issue) => issue.startsWith('packaged-source-mismatch:')), issues.join('\n'));
  assert.ok(issues.some((issue) => issue.startsWith('packaged-digest-drift:')), issues.join('\n'));
});

test('application packaging validation rejects retired Superpowers/sdd/trinity names', async (t) => {
  const issues = await packagingFixture(t, async (world) => {
    await fs.mkdir(path.join(world.skillsRoot, 'superpowers-brainstorming'), { recursive: true });
    await fs.writeFile(path.join(world.skillsRoot, 'superpowers-brainstorming/SKILL.md'), '# retired\n');
  });
  assert.ok(issues.some((issue) => issue.startsWith('retired-method-name:')), issues.join('\n'));
  assert.ok(issues.some((issue) => issue.startsWith('skill-set-mismatch:')), issues.join('\n'));
});

test('P exposes original plan protocol and pure validation without the planner controller', async (t) => {
  const profile = await readJson('foundation/profiles/comet-managed.json');
  const planner = profile.methods['claude-parallel-tdd-planner'];
  assert.equal(planner.load, 'references-only');
  assert.deepEqual(planner.references, [{ path: 'references/plan-contract.md', sections: ['One root and acceptance source', 'DAG'] }]);
  for (const capability of ['dispatch', 'goal', 'schedule', 'retry', 'archive', 'publish', 'write-run-state']) {
    assert.ok(planner.deniedCapabilities.includes(capability));
  }
  assert.ok(planner.forbidden.includes('SKILL.md'));
  assert.ok(planner.forbidden.includes('scripts/openspec_lifecycle.py'));
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'method-plan-'));
  t.after(() => fs.rm(scratch, { recursive: true, force: true }));
  const file = path.join(scratch, 'tasks.md');
  const plan = '# Implementation Plan\n\n**Goal:** validate the original protocol only\n\n**Architecture:** isolated plan fixture\n\n**Tech Stack:** Markdown\n\n## Global Constraints\n\n- No controller activation\n\n### Task T1: task\n**Files:** sample.js\n**Interfaces:** none\n**Dependencies:** none\n**Owns:** sample.js\n**Parallel safe:** true\n**Acceptance IDs:** AC1\n\n- [ ] **Step 1 [3 min]: Commit** fixture\n';
  await fs.writeFile(file, plan);
  const run = () => spawnSync('python3', [path.join(root, planner.snapshot, 'scripts/plan_guard.py'), '--plan', file], { env: pythonEnvironment, encoding: 'utf8', timeout: 30000 });
  const good = run();
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).valid, true);
  assert.equal(JSON.parse(good.stdout).handoff_ready, false);
  await fs.writeFile(file, plan.replace('**Owns:** sample.js', '**Owns:** sample.js\n**Owns:** sample.js'));
  const bad = run();
  assert.notEqual(bad.status, 0);
  assert.equal(JSON.parse(bad.stdout).valid, false);
  assert.deepEqual(await fs.readdir(scratch), ['tasks.md']);
});
