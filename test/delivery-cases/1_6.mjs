// P1_6 supplier qualification only, revision 2026-10-26-comet-050-adoption-v1.
// ADR-0022: the upstream patch chain is retired and Comet is relocked to 0.5.0
// (upstream.lock.json patches == []). This case now pins (a) the locked,
// patch-free 0.5.0 build supply and (b) the packaged application skill assets
// (integrations/comet/application) that feed downstream composition
// replacements. Deep verbatim/digest validation and negative fixtures live in
// comet-method-binding.test.js, imported below. No model or MCP is started, and
// no runtime role/gate acceptance is certified here. Managed init/update
// behavior against the real CLI moves with the composition task; the 0.5.0
// baseline (upstream init offering Superpowers again) is recorded as RED
// evidence in worker-reports/P1_6-comet-050/evidence/.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import '../comet-method-binding.test.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lockFile = process.env.P16_COMET_LOCK ?? 'integrations/comet/upstream.lock.json';
const lock = JSON.parse(await fs.readFile(path.resolve(root, lockFile), 'utf8'));
const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
  archive: lock.source.sha256,
  patches: lock.patches.map(({ path: patchPath, sha256 }) => ({ path: patchPath, sha256 })),
  toolchain: lock.toolchain,
})).digest('hex');
const build = path.join(root, '.sdd/vendor/comet', lock.source.commit, 'builds', fingerprint);
const retiredNamePattern = /(superpowers|sdd-|trinity)/i;
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

test('M01/B09 supplier: the locked 0.5.0 build supply is present with exactly the supply-wave 0005 patch', async () => {
  assert.equal(lock.package.version, '0.5.0');
  assert.equal(lock.source.commit, 'aeb1a6598034e28ce46b8422d4dbd8785e607bd7');
  // P1_4 supply re-lock (controller-granted exception): the baseline moved
  // from patch-free to exactly the 0005 Kt closeout patch; the retired 0.4.5
  // six-patch stack still never satisfies this case.
  assert.deepEqual(lock.patches, [
    { path: 'integrations/comet/patches/0005-comet-050-kt-closeout.patch', sha256: '74e6c8108967ac10b9ac31e2f4c3ba2dfa6d53930dcf2b5068fe7d9be003b18d' },
  ]);
  // Required case: a missing distribution is nonzero UNVERIFIED, never skip/PASS.
  await fs.access(path.join(build, 'distribution.json'));
  await fs.access(path.join(build, 'work/bin/comet.js'));
});

test('M02/N04 supplier: application manifest binds to the locked baseline and packages the declared method roster with no retired names', async () => {
  const appManifest = JSON.parse(await fs.readFile(path.join(root, 'integrations/comet/application/manifest.json'), 'utf8'));
  const methodManifest = JSON.parse(await fs.readFile(path.join(root, 'openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json'), 'utf8'));
  const profile = JSON.parse(await fs.readFile(path.join(root, 'foundation/profiles/comet-managed.json'), 'utf8'));
  assert.equal(appManifest.kind, 'comet-application-skill-assets');
  assert.equal(appManifest.status, 'ASSETS_PACKAGED');
  assert.equal(appManifest.runtime_accepted, false);
  assert.equal(appManifest.basis.upstream_version, lock.package.version);
  assert.equal(appManifest.basis.upstream_commit, lock.source.commit);
  assert.deepEqual(appManifest.basis.upstream_patches, lock.patches,
    'the packaging basis must mirror the live supply lock (repinned at the P1_4 supply re-lock; 0005 touches only the resolver, not method assets)');
  const names = appManifest.skills.map((skill) => skill.name).sort();
  assert.deepEqual(names, methodManifest.snapshots.map((snapshot) => snapshot.name).sort());
  assert.deepEqual(names, Object.keys(profile.methods).sort());
  const skillsRoot = path.join(root, 'integrations/comet/application/skills');
  const directories = (await fs.readdir(skillsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepEqual(directories, names);
  for (const entry of appManifest.skills) {
    assert.doesNotMatch(entry.name, retiredNamePattern);
    assert.equal(entry.source_path, `.agents/skills/${entry.name}`);
    const files = {};
    async function walk(dir) {
      for (const item of await fs.readdir(dir, { withFileTypes: true })) {
        assert.equal(item.isSymbolicLink(), false, path.join(dir, item.name));
        assert.doesNotMatch(item.name, retiredNamePattern, path.join(dir, item.name));
        if (item.isDirectory()) await walk(path.join(dir, item.name));
        else if (item.isFile()) {
          files[`${entry.name}/${path.relative(path.join(skillsRoot, entry.name), path.join(dir, item.name)).split(path.sep).join('/')}`] = digest(await fs.readFile(path.join(dir, item.name)));
        }
      }
    }
    await walk(path.join(skillsRoot, entry.name));
    assert.equal(Object.keys(files).length, entry.file_count, entry.name);
    const aggregate = digest(Object.entries(files).map(([p, sha]) => `${sha}  ${p}`).sort().join('\n'));
    assert.equal(aggregate, entry.content_sha256, `${entry.name} packaged digest drift`);
    assert.equal(aggregate, profile.methods[entry.name].sha256, `${entry.name} profile digest drift`);
  }
  assert.equal(profile.qualification.status, 'ASSETS_PACKAGED');
  assert.notEqual(profile.qualification.status, 'QUALIFIED');
  assert.equal(profile.runtimeAccepted, false);
});
