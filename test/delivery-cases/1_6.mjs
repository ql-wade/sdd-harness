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
  const required = ['tdd', 'diagnosing-bugs', 'code-review', 'test-authoring', 'whitebox-verify', 'openspec-lifecycle-guard', 'grill-me', 'grilling', 'multi-agent-consensus-review', 'claude-parallel-tdd-planner'];
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

test('patches are sha256-pinned in the source lock and scoped to their declared files', async () => {
  assert.ok(Array.isArray(lock.patches) && lock.patches.length === 2);
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
