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
test('method supplier pins complete real source directories and a single unqualified optional profile', async () => {
  const manifest = await readJson('openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json');
  const profile = await readJson('foundation/profiles/comet-managed.json');
  assert.equal(profile.id, 'comet-managed-v2');
  assert.equal(manifest.current_profile_id, profile.id);
  assert.equal(profile.qualification.status, 'UNQUALIFIED');
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
